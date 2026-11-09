import { cn } from "@/lib/utils";

/**
 * Brand mark: an eight-point star (two overlapping squares, a motif found across Saudi architecture)
 * in desert gold on a palm-green tile. Purely decorative — the brand name next to it carries the meaning.
 * The name itself is configuration (BRAND_NAME_*), never part of this graphic.
 */
export function BrandMark({ className, tone = "default" }: { className?: string; tone?: "default" | "inverse" }) {
  const tile = tone === "inverse" ? "#ffffff" : "#0f5c4d";
  const star = tone === "inverse" ? "#0f5c4d" : "#ddb877";
  return (
    <svg viewBox="0 0 40 40" className={cn("size-9 shrink-0", className)} aria-hidden focusable="false">
      <rect width="40" height="40" rx="11" fill={tile} />
      <g fill="none" stroke={star} strokeWidth="2.4" strokeLinejoin="round">
        <rect x="11.5" y="11.5" width="17" height="17" rx="1.5" />
        <rect x="11.5" y="11.5" width="17" height="17" rx="1.5" transform="rotate(45 20 20)" />
      </g>
      <circle cx="20" cy="20" r="3.2" fill={star} />
    </svg>
  );
}
