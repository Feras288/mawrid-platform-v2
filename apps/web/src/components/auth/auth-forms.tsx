"use client";

import { useLocale, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { Link, useRouter } from "@/i18n/navigation";
import { authClient } from "@/lib/auth-client";
import { Alert, Button, Checkbox, Input, Label } from "@/components/ui/primitives";

type Err = { code?: string; message?: string; status?: number } | null | undefined;

function useAuthError() {
  const t = useTranslations("auth");
  const e = useTranslations("errors");
  return (err: Err) => {
    if (!err) return e("internal");
    if (err.status === 429) return t("tooManyAttempts");
    if (err.code === "INVALID_EMAIL_OR_PASSWORD") return t("invalidCredentials");
    if (err.code === "EMAIL_NOT_VERIFIED") return t("verifyFirst");
    return err.message ?? e("internal");
  };
}

function TextField({ id, label, hint, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { id: string; label: string; hint?: string }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} aria-describedby={hint ? `${id}-hint` : undefined} {...props} />
      {hint ? (
        <p id={`${id}-hint`} className="text-xs text-ink-500">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function LoginForm() {
  const t = useTranslations("auth");
  const router = useRouter();
  const sp = useSearchParams();
  const locale = useLocale();
  const errText = useAuthError();
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const next = sp.get("next");
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/account";
  return (
    <form
      className="space-y-4"
      onSubmit={async (ev) => {
        ev.preventDefault();
        setPending(true);
        setError(null);
        const fd = new FormData(ev.currentTarget);
        const { data, error: err } = await authClient.signIn.email({
          email: String(fd.get("email")),
          password: String(fd.get("password")),
          callbackURL: `/${locale}/account`,
        });
        setPending(false);
        if (err) {
          setError(errText(err));
          return;
        }
        if (data && "twoFactorRedirect" in data && data.twoFactorRedirect) {
          router.push(`/two-factor?next=${encodeURIComponent(safeNext)}`);
          return;
        }
        router.push(safeNext);
        router.refresh();
      }}
    >
      {sp.get("verified") ? <Alert tone="success">{t("emailVerified")}</Alert> : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <TextField id="email" name="email" type="email" autoComplete="email" required label={t("email")} dir="ltr" />
      <TextField id="password" name="password" type="password" autoComplete="current-password" required label={t("password")} dir="ltr" />
      <div className="flex justify-end">
        <Link href="/forgot-password" className="text-sm text-primary-700 hover:underline">
          {t("forgot")}
        </Link>
      </div>
      <Button type="submit" className="w-full" disabled={pending} aria-busy={pending}>
        {t("loginTitle")}
      </Button>
    </form>
  );
}

export function RegisterForm() {
  const t = useTranslations("auth");
  const locale = useLocale();
  const router = useRouter();
  const errText = useAuthError();
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  return (
    <form
      className="space-y-4"
      onSubmit={async (ev) => {
        ev.preventDefault();
        const fd = new FormData(ev.currentTarget);
        if (fd.get("password") !== fd.get("confirm")) return setError(t("passwordsDontMatch"));
        if (!fd.get("terms")) return setError(t("termsRequired"));
        setPending(true);
        setError(null);
        const email = String(fd.get("email")).trim().toLowerCase();
        const { error: err } = await authClient.signUp.email({
          email,
          password: String(fd.get("password")),
          name: String(fd.get("name")).trim(),
          locale,
          acceptTerms: true,
          callbackURL: `/${locale}/login?verified=1`,
        } as Parameters<typeof authClient.signUp.email>[0]);
        setPending(false);
        if (err) return setError(errText(err));
        router.push(`/check-email?email=${encodeURIComponent(email)}`);
      }}
    >
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <TextField id="name" name="name" autoComplete="name" required minLength={2} label={t("name")} />
      <TextField id="email" name="email" type="email" autoComplete="email" required label={t("email")} dir="ltr" />
      <TextField id="password" name="password" type="password" autoComplete="new-password" required minLength={10} label={t("password")} hint={t("passwordHint")} dir="ltr" />
      <TextField id="confirm" name="confirm" type="password" autoComplete="new-password" required minLength={10} label={t("confirmPassword")} dir="ltr" />
      <Checkbox name="terms" value="1" required label={t("acceptTerms")} />
      <Button type="submit" className="w-full" disabled={pending} aria-busy={pending}>
        {t("registerTitle")}
      </Button>
    </form>
  );
}

export function ResendVerification({ email }: { email: string }) {
  const t = useTranslations("auth");
  const locale = useLocale();
  const [pending, setPending] = React.useState(false);
  return (
    <Button
      variant="outline"
      disabled={pending || !email}
      onClick={async () => {
        setPending(true);
        await authClient.sendVerificationEmail({ email, callbackURL: `/${locale}/login?verified=1` });
        setPending(false);
        toast.success(t("checkEmailTitle"));
      }}
    >
      {t("resendVerification")}
    </Button>
  );
}

export function ForgotForm() {
  const t = useTranslations("auth");
  const locale = useLocale();
  const [sent, setSent] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  if (sent) return <Alert tone="success">{t("forgotSent")}</Alert>;
  return (
    <form
      className="space-y-4"
      onSubmit={async (ev) => {
        ev.preventDefault();
        setPending(true);
        const fd = new FormData(ev.currentTarget);
        await authClient.requestPasswordReset({ email: String(fd.get("email")), redirectTo: `/${locale}/reset-password` });
        setPending(false);
        setSent(true); // same response whether or not the email exists
      }}
    >
      <TextField id="email" name="email" type="email" autoComplete="email" required label={t("email")} dir="ltr" />
      <Button type="submit" className="w-full" disabled={pending}>
        {t("sendLink")}
      </Button>
    </form>
  );
}

export function ResetForm() {
  const t = useTranslations("auth");
  const sp = useSearchParams();
  const router = useRouter();
  const errText = useAuthError();
  const token = sp.get("token");
  const [error, setError] = React.useState<string | null>(sp.get("error") ? t("invalidLink") : null);
  const [pending, setPending] = React.useState(false);
  if (!token) return <Alert tone="danger">{t("invalidLink")}</Alert>;
  return (
    <form
      className="space-y-4"
      onSubmit={async (ev) => {
        ev.preventDefault();
        const fd = new FormData(ev.currentTarget);
        if (fd.get("password") !== fd.get("confirm")) return setError(t("passwordsDontMatch"));
        setPending(true);
        const { error: err } = await authClient.resetPassword({ newPassword: String(fd.get("password")), token });
        setPending(false);
        if (err) return setError(errText(err));
        toast.success(t("resetDone"));
        router.push("/login");
      }}
    >
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <TextField id="password" name="password" type="password" autoComplete="new-password" required minLength={10} label={t("newPassword")} hint={t("passwordHint")} dir="ltr" />
      <TextField id="confirm" name="confirm" type="password" autoComplete="new-password" required minLength={10} label={t("confirmPassword")} dir="ltr" />
      <Button type="submit" className="w-full" disabled={pending}>
        {t("resetTitle")}
      </Button>
    </form>
  );
}

export function TwoFactorForm() {
  const t = useTranslations("auth");
  const router = useRouter();
  const sp = useSearchParams();
  const errText = useAuthError();
  const [backup, setBackup] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const next = sp.get("next");
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/account";
  return (
    <form
      className="space-y-4"
      onSubmit={async (ev) => {
        ev.preventDefault();
        setPending(true);
        setError(null);
        const fd = new FormData(ev.currentTarget);
        const code = String(fd.get("code")).trim();
        const trustDevice = fd.get("trust") === "1";
        const { error: err } = backup ? await authClient.twoFactor.verifyBackupCode({ code, trustDevice }) : await authClient.twoFactor.verifyTotp({ code, trustDevice });
        setPending(false);
        if (err) return setError(errText(err));
        router.push(safeNext);
        router.refresh();
      }}
    >
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <TextField
        id="code"
        name="code"
        required
        autoComplete="one-time-code"
        inputMode={backup ? "text" : "numeric"}
        pattern={backup ? undefined : "[0-9]{6}"}
        label={backup ? t("backupCode") : t("code")}
        dir="ltr"
        className="text-center tracking-[0.4em]"
      />
      <Checkbox name="trust" value="1" label={t("trustDevice")} />
      <Button type="submit" className="w-full" disabled={pending}>
        {t("verify")}
      </Button>
      <Button variant="link" className="w-full" onClick={() => setBackup((b) => !b)}>
        {backup ? t("code") : t("useBackupCode")}
      </Button>
    </form>
  );
}
