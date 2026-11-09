import { Card } from "@/components/ui/primitives";

export function AuthCard({ title, subtitle, children, footer }: { title: string; subtitle?: string; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <Card className="p-6 shadow-raised sm:p-8">
      <h1 className="text-h1 font-extrabold tracking-tight text-ink-900">{title}</h1>
      {subtitle ? <p className="mt-1 text-sm text-ink-500">{subtitle}</p> : null}
      <div className="mt-6">{children}</div>
      {footer ? <div className="mt-6 border-t border-sand-200 pt-4 text-center text-sm text-ink-600">{footer}</div> : null}
    </Card>
  );
}
