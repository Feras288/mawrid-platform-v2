"use client";

import { useRouter } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import * as React from "react";
import { useFormStatus } from "react-dom";
import { toast } from "sonner";
import type { ActionError, ActionResult } from "@/lib/action";
import { cn } from "@/lib/utils";
import { Button, type ButtonProps, Input, Label, Select, Textarea } from "./primitives";

const ErrorCtx = React.createContext<ActionError | null>(null);

export function useErrorMessage() {
  const t = useTranslations("errors");
  return React.useCallback(
    (e: ActionError) => {
      const key = e.key && t.has(e.key) ? e.key : null;
      return key ? t(key) : e.message || t("internal");
    },
    [t],
  );
}

export interface ActionFormProps<T> extends Omit<React.FormHTMLAttributes<HTMLFormElement>, "action" | "onSubmit"> {
  action: (fd: FormData) => Promise<ActionResult<T>>;
  successMessage?: string;
  /** Navigate after success (string or derived from result). */
  redirectTo?: string | ((data: T) => string | null);
  refresh?: boolean;
  resetOnSuccess?: boolean;
  onSuccess?: (data: T) => void;
}

/**
 * Progressive form bound to a server action returning ActionResult. Shows toasts, maps field
 * errors to <Field name=…>, refreshes server components on success.
 */
export function ActionForm<T>({ action, successMessage, redirectTo, refresh = true, resetOnSuccess, onSuccess, children, className, ...rest }: ActionFormProps<T>) {
  const router = useRouter();
  const errMsg = useErrorMessage();
  const ref = React.useRef<HTMLFormElement>(null);
  const [state, formAction] = React.useActionState<ActionResult<T> | null, FormData>(async (_prev, fd) => {
    const r = await action(fd);
    if (r.ok) {
      if (successMessage) toast.success(successMessage);
      onSuccess?.(r.data);
      if (resetOnSuccess) ref.current?.reset();
      const to = typeof redirectTo === "function" ? redirectTo(r.data) : redirectTo;
      if (to) router.push(to);
      else if (refresh) router.refresh();
    } else {
      toast.error(errMsg(r.error));
    }
    return r;
  }, null);
  return (
    <ErrorCtx.Provider value={state && !state.ok ? state.error : null}>
      <form ref={ref} action={formAction} className={cn("space-y-4", className)} noValidate={false} {...rest}>
        {children}
      </form>
    </ErrorCtx.Provider>
  );
}

export function FormError() {
  const e = React.useContext(ErrorCtx);
  const errMsg = useErrorMessage();
  if (!e) return null;
  return (
    <p role="alert" className="rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-700">
      {errMsg(e)}
    </p>
  );
}

type FieldProps = {
  name: string;
  label: React.ReactNode;
  hint?: React.ReactNode;
  className?: string;
  required?: boolean;
} & (
  | ({ as?: "input" } & React.InputHTMLAttributes<HTMLInputElement>)
  | ({ as: "textarea" } & React.TextareaHTMLAttributes<HTMLTextAreaElement>)
  | ({ as: "select"; options: { value: string; label: React.ReactNode }[]; placeholder?: string } & React.SelectHTMLAttributes<HTMLSelectElement>)
);

/** Labelled control wired to server-side field errors and ARIA attributes. */
export function Field(props: FieldProps) {
  const { name, label, hint, className, required } = props;
  const e = React.useContext(ErrorCtx);
  const errors = e?.fieldErrors?.[name];
  const id = React.useId();
  const describedBy = [hint ? `${id}-hint` : null, errors ? `${id}-err` : null].filter(Boolean).join(" ") || undefined;
  const common = { id, name, required, "aria-invalid": errors ? true : undefined, "aria-describedby": describedBy };
  let control: React.ReactNode;
  if (props.as === "textarea") {
    const { as: _a, label: _l, hint: _h, className: _c, ...rest } = props;
    control = <Textarea {...rest} {...common} />;
  } else if (props.as === "select") {
    const { as: _a, label: _l, hint: _h, className: _c, options, placeholder, ...rest } = props;
    control = (
      <Select {...rest} {...common}>
        {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
    );
  } else {
    const { as: _a, label: _l, hint: _h, className: _c, ...rest } = props;
    control = <Input {...rest} {...common} />;
  }
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={id}>
        {label}
        {required ? <span className="text-danger-600" aria-hidden> *</span> : null}
      </Label>
      {control}
      {hint ? (
        <p id={`${id}-hint`} className="text-xs text-ink-500">
          {hint}
        </p>
      ) : null}
      {errors ? (
        <p id={`${id}-err`} className="text-xs text-danger-600">
          {errors.join(" ")}
        </p>
      ) : null}
    </div>
  );
}

export function SubmitButton({ children, pendingLabel, ...props }: ButtonProps & { pendingLabel?: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending || props.disabled} aria-busy={pending} {...props}>
      {pending ? (
        <>
          <span className="size-4 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden />
          {pendingLabel ?? children}
        </>
      ) : (
        children
      )}
    </Button>
  );
}

/** One-click action button with optional confirmation. */
export function ActionButton<T>({
  action,
  confirm,
  successMessage,
  redirectTo,
  children,
  ...props
}: Omit<ButtonProps, "onClick"> & { action: () => Promise<ActionResult<T>>; confirm?: string; successMessage?: string; redirectTo?: string }) {
  const router = useRouter();
  const errMsg = useErrorMessage();
  const [pending, start] = React.useTransition();
  return (
    <Button
      {...props}
      disabled={pending || props.disabled}
      aria-busy={pending}
      onClick={() => {
        if (confirm && !window.confirm(confirm)) return;
        start(async () => {
          const r = await action();
          if (r.ok) {
            if (successMessage) toast.success(successMessage);
            if (redirectTo) router.push(redirectTo);
            else router.refresh();
          } else toast.error(errMsg(r.error));
        });
      }}
    >
      {children}
    </Button>
  );
}
