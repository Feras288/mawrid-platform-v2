"use client";

import QRCode from "qrcode";
import { useTranslations } from "next-intl";
import * as React from "react";
import { toast } from "sonner";
import { useRouter } from "@/i18n/navigation";
import { authClient } from "@/lib/auth-client";
import { Alert, Badge, Button, Card, CardBody, CardHeader, Checkbox, Input, Label } from "@/components/ui/primitives";

function PwInput({ id, label, ...p }: React.InputHTMLAttributes<HTMLInputElement> & { id: string; label: string }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} type="password" dir="ltr" {...p} />
    </div>
  );
}

export function ChangePasswordCard() {
  const t = useTranslations();
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  return (
    <Card>
      <CardHeader title={t("account.changePassword")} />
      <CardBody>
        <form
          className="max-w-md space-y-4"
          onSubmit={async (ev) => {
            ev.preventDefault();
            const form = ev.currentTarget;
            const fd = new FormData(form);
            if (fd.get("newPassword") !== fd.get("confirm")) return setError(t("auth.passwordsDontMatch"));
            setPending(true);
            setError(null);
            const { error: err } = await authClient.changePassword({
              currentPassword: String(fd.get("currentPassword")),
              newPassword: String(fd.get("newPassword")),
              revokeOtherSessions: fd.get("revoke") === "1",
            });
            setPending(false);
            if (err) return setError(err.message ?? t("errors.internal"));
            form.reset();
            toast.success(t("account.passwordChanged"));
          }}
        >
          {error ? <Alert tone="danger">{error}</Alert> : null}
          <PwInput id="currentPassword" name="currentPassword" label={t("account.currentPassword")} autoComplete="current-password" required />
          <PwInput id="newPassword" name="newPassword" label={t("auth.newPassword")} autoComplete="new-password" minLength={10} required />
          <PwInput id="confirm" name="confirm" label={t("auth.confirmPassword")} autoComplete="new-password" minLength={10} required />
          <Checkbox name="revoke" value="1" defaultChecked label={t("account.revokeOthers")} />
          <Button type="submit" disabled={pending}>
            {t("common.save")}
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}

export function TwoFactorCard({ enabled }: { enabled: boolean }) {
  const t = useTranslations();
  const router = useRouter();
  const [stage, setStage] = React.useState<"idle" | "password" | "verify" | "disable">("idle");
  const [qr, setQr] = React.useState<string | null>(null);
  const [codes, setCodes] = React.useState<string[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  return (
    <Card>
      <CardHeader title={t("account.twoFactor")} actions={<Badge tone={enabled ? "success" : "neutral"}>{enabled ? t("account.twoFactorOn") : t("account.twoFactorOff")}</Badge>} />
      <CardBody className="space-y-4">
        {error ? <Alert tone="danger">{error}</Alert> : null}
        {stage === "idle" ? (
          enabled ? (
            <Button variant="outline" onClick={() => setStage("disable")}>
              {t("account.disable2fa")}
            </Button>
          ) : (
            <Button onClick={() => setStage("password")}>{t("account.enable2fa")}</Button>
          )
        ) : null}

        {stage === "password" || stage === "disable" ? (
          <form
            className="max-w-md space-y-3"
            onSubmit={async (ev) => {
              ev.preventDefault();
              setPending(true);
              setError(null);
              const password = String(new FormData(ev.currentTarget).get("password"));
              if (stage === "disable") {
                const { error: err } = await authClient.twoFactor.disable({ password });
                setPending(false);
                if (err) return setError(err.message ?? t("errors.internal"));
                toast.success(t("account.twoFactorDisabled"));
                setStage("idle");
                router.refresh();
                return;
              }
              const { data, error: err } = await authClient.twoFactor.enable({ password });
              setPending(false);
              if (err || !data || !("totpURI" in data)) return setError(err?.message ?? t("errors.internal"));
              setQr(await QRCode.toDataURL(data.totpURI, { margin: 1, width: 200 }));
              setCodes(data.backupCodes);
              setStage("verify");
            }}
          >
            <PwInput id="pw2fa" name="password" label={t("account.confirmWithPassword")} autoComplete="current-password" required />
            <div className="flex gap-2">
              <Button type="submit" variant={stage === "disable" ? "danger" : "primary"} disabled={pending}>
                {t("common.confirm")}
              </Button>
              <Button variant="ghost" onClick={() => setStage("idle")}>
                {t("common.cancel")}
              </Button>
            </div>
          </form>
        ) : null}

        {stage === "verify" ? (
          <div className="space-y-4">
            <p className="text-sm text-ink-600">{t("account.scanQr")}</p>
            {qr ? <img src={qr} alt="TOTP QR" width={200} height={200} className="rounded-lg border border-sand-200" /> : null}
            <div>
              <p className="text-sm font-medium text-ink-700">{t("account.backupCodes")}</p>
              <ul className="mt-2 grid max-w-sm grid-cols-2 gap-1 font-mono text-sm" dir="ltr">
                {codes.map((c) => (
                  <li key={c} className="rounded bg-sand-100 px-2 py-1">
                    {c}
                  </li>
                ))}
              </ul>
            </div>
            <form
              className="flex max-w-md items-end gap-2"
              onSubmit={async (ev) => {
                ev.preventDefault();
                setPending(true);
                setError(null);
                const code = String(new FormData(ev.currentTarget).get("code")).trim();
                const { error: err } = await authClient.twoFactor.verifyTotp({ code });
                setPending(false);
                if (err) return setError(err.message ?? t("errors.internal"));
                toast.success(t("account.twoFactorEnabled"));
                setStage("idle");
                router.refresh();
              }}
            >
              <div className="flex-1 space-y-1.5">
                <Label htmlFor="totp">{t("auth.code")}</Label>
                <Input id="totp" name="code" inputMode="numeric" pattern="[0-9]{6}" autoComplete="one-time-code" required dir="ltr" />
              </div>
              <Button type="submit" disabled={pending}>
                {t("auth.verify")}
              </Button>
            </form>
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}

export function SessionsCard() {
  const t = useTranslations();
  const [sessions, setSessions] = React.useState<{ id: string; token: string; userAgent?: string | null; ipAddress?: string | null; createdAt: Date }[] | null>(null);
  const { data: current } = authClient.useSession();
  const load = React.useCallback(async () => {
    const { data } = await authClient.listSessions();
    setSessions((data ?? []) as never);
  }, []);
  React.useEffect(() => {
    void load();
  }, [load]);
  return (
    <Card>
      <CardHeader title={t("account.sessions")} />
      <CardBody>
        {!sessions ? (
          <p className="text-sm text-ink-500">{t("common.loading")}</p>
        ) : (
          <ul className="divide-y divide-sand-100">
            {sessions.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <div className="min-w-0">
                  <p className="truncate text-ink-700" dir="ltr">
                    {s.userAgent ?? t("common.unknown")}
                  </p>
                  <p className="text-xs text-ink-400" dir="ltr">
                    {s.ipAddress ?? ""} · {new Date(s.createdAt).toLocaleString()}
                  </p>
                </div>
                {current?.session.id === s.id ? (
                  <Badge tone="success">{t("account.currentSession")}</Badge>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      await authClient.revokeSession({ token: s.token });
                      await load();
                    }}
                  >
                    {t("account.revoke")}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
