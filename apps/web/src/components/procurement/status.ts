import type { BadgeTone } from "@/components/ui/primitives";

const TONES: Record<string, BadgeTone> = {
  draft: "neutral",
  pending_review: "warning",
  pending_approval: "warning",
  pending: "warning",
  approved_for_sending: "info",
  sending: "info",
  open: "primary",
  partially_responded: "primary",
  under_evaluation: "accent",
  revision_requested: "warning",
  awarded: "success",
  approved: "success",
  auto_approved: "success",
  closed: "neutral",
  cancelled: "danger",
  rejected: "danger",
  invalidated: "danger",
  failed: "danger",
  sent: "info",
  responded: "success",
  declined: "neutral",
  prepared: "info",
  submitted: "success",
  superseded: "neutral",
  withdrawn: "neutral",
  not_started: "neutral",
  preparing: "info",
  partially_fulfilled: "info",
  shipped: "primary",
  partially_delivered: "accent",
  delivered: "success",
  completed: "success",
};

export function toneFor(status: string | null | undefined): BadgeTone {
  return (status && TONES[status]) || "neutral";
}
