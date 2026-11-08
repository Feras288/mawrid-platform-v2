"use client";
import { acceptInviteAction } from "@/app/actions/account";
import { ActionButton } from "@/components/ui/form";

export function AcceptInviteButton({ token, label, done }: { token: string; label: string; done: string }) {
  return (
    <ActionButton action={() => acceptInviteAction(token)} successMessage={done} redirectTo="/account/organizations" className="w-full">
      {label}
    </ActionButton>
  );
}
