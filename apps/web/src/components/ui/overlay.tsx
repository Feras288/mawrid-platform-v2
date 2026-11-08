"use client";

import { X } from "lucide-react";
import { Dialog as D, DropdownMenu as DM, Tabs as T } from "radix-ui";
import * as React from "react";
import { cn } from "@/lib/utils";

export function Modal({
  trigger,
  title,
  description,
  children,
  open,
  onOpenChange,
  wide,
  closeLabel = "Close",
}: {
  trigger?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  open?: boolean;
  onOpenChange?: (o: boolean) => void;
  wide?: boolean;
  closeLabel?: string;
}) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      {trigger ? <D.Trigger asChild>{trigger}</D.Trigger> : null}
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-40 bg-ink-900/40 data-[state=open]:animate-in" />
        <D.Content
          className={cn(
            "fixed start-1/2 top-1/2 z-50 max-h-[90vh] w-[calc(100vw-2rem)] -translate-y-1/2 overflow-y-auto rounded-xl bg-white p-5 shadow-xl ltr:-translate-x-1/2 rtl:translate-x-1/2",
            wide ? "max-w-3xl" : "max-w-lg",
          )}
        >
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <D.Title className="text-lg font-semibold">{title}</D.Title>
              {description ? <D.Description className="mt-1 text-sm text-ink-500">{description}</D.Description> : <D.Description className="sr-only">{title}</D.Description>}
            </div>
            <D.Close className="rounded-md p-1 text-ink-500 hover:bg-sand-100" aria-label={closeLabel}>
              <X className="size-5" />
            </D.Close>
          </div>
          {children}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

export const ModalClose = D.Close;

export function Menu({ trigger, children, align = "end" }: { trigger: React.ReactNode; children: React.ReactNode; align?: "start" | "end" }) {
  return (
    <DM.Root>
      <DM.Trigger asChild>{trigger}</DM.Trigger>
      <DM.Portal>
        <DM.Content align={align} sideOffset={6} className="z-50 min-w-48 rounded-lg border border-sand-200 bg-white p-1 shadow-lg">
          {children}
        </DM.Content>
      </DM.Portal>
    </DM.Root>
  );
}

export function MenuItem({ children, onSelect, asChild, className }: { children: React.ReactNode; onSelect?: () => void; asChild?: boolean; className?: string }) {
  return (
    <DM.Item asChild={asChild} onSelect={onSelect} className={cn("flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm text-ink-700 outline-none data-[highlighted]:bg-sand-100", className)}>
      {children}
    </DM.Item>
  );
}
export const MenuLabel = ({ children }: { children: React.ReactNode }) => <DM.Label className="px-3 py-1.5 text-xs text-ink-500">{children}</DM.Label>;
export const MenuSeparator = () => <DM.Separator className="my-1 h-px bg-sand-200" />;

export function Tabs({ tabs, defaultValue }: { tabs: { value: string; label: React.ReactNode; content: React.ReactNode }[]; defaultValue?: string }) {
  return (
    <T.Root defaultValue={defaultValue ?? tabs[0]?.value}>
      <T.List className="mb-4 flex gap-1 overflow-x-auto border-b border-sand-200">
        {tabs.map((t) => (
          <T.Trigger
            key={t.value}
            value={t.value}
            className="-mb-px whitespace-nowrap border-b-2 border-transparent px-3 py-2 text-sm font-medium text-ink-500 hover:text-ink-900 data-[state=active]:border-primary-700 data-[state=active]:text-primary-800"
          >
            {t.label}
          </T.Trigger>
        ))}
      </T.List>
      {tabs.map((t) => (
        <T.Content key={t.value} value={t.value}>
          {t.content}
        </T.Content>
      ))}
    </T.Root>
  );
}
