import { BellRing, BrickWall, Cctv, Cog, Construction, Droplet, Fan, FireExtinguisher, Package, Zap, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/*
 * Original, license-free line illustrations for the nine root systems. Used for category tiles and as the
 * fallback visual of products without supplier photos (real uploads always take precedence). Decorative only:
 * every use sits next to a text label, so the SVG is aria-hidden.
 */

type Theme = { bg: string; fg: string; icon: LucideIcon };

export const CATEGORY_THEME: Record<string, Theme> = {
  electrical: { bg: "#fbf3df", fg: "#8a5a07", icon: Zap },
  plumbing: { bg: "#e8f1fa", fg: "#2c6aa0", icon: Droplet },
  hvac: { bg: "#e4f4f0", fg: "#157060", icon: Fan },
  "fire-fighting": { bg: "#fbecea", fg: "#a12d22", icon: FireExtinguisher },
  "fire-alarm": { bg: "#fdf0e6", fg: "#a2490f", icon: BellRing },
  "mechanical-equipment": { bg: "#edf0ee", fg: "#333b37", icon: Cog },
  "building-materials": { bg: "#f4efe6", fg: "#7f560d", icon: BrickWall },
  "low-current": { bg: "#ecebf8", fg: "#4b47a0", icon: Cctv },
  infrastructure: { bg: "#e9f0eb", fg: "#3f5a4a", icon: Construction },
};
const FALLBACK: Theme = { bg: "#f4f3ee", fg: "#5f6763", icon: Package };

export function categoryTheme(slug?: string | null): Theme {
  return (slug && CATEGORY_THEME[slug]) || FALLBACK;
}

const ART: Record<string, React.ReactNode> = {
  electrical: (
    <>
      <path d="M50 38h30v24a15 15 0 0 1-30 0z" className="art-fill" />
      <path d="M58 38V26M72 38V26M65 77v9c0 10 8 16 18 16h18" />
      <path d="M114 26l-14 26h14l-12 26" className="art-fill" />
    </>
  ),
  plumbing: (
    <>
      <path d="M24 48h64a24 24 0 0 1 24 24v32M24 64h64a8 8 0 0 1 8 8v32" />
      <path d="M24 42v28M90 104h28" />
      <path d="M56 48V36M44 30h24" />
      <circle cx="56" cy="30" r="4" className="art-fill" />
      <path d="M128 70c4 6 6 9 6 12a6 6 0 0 1-12 0c0-3 2-6 6-12z" className="art-fill" />
    </>
  ),
  hvac: (
    <>
      <rect x="34" y="22" width="92" height="70" rx="9" />
      <circle cx="80" cy="57" r="24" className="art-fill" />
      <path d="M80 57c0-11 6-17 15-15-2 9-7 13-15 15zM80 57c11 0 17 6 15 15-9-2-13-7-15-15zM80 57c0 11-6 17-15 15 2-9 7-13 15-15zM80 57c-11 0-17-6-15-15 9 2 13 7 15 15z" />
      <path d="M46 104c6-4 12-4 18 0s12 4 18 0 12-4 18 0" />
    </>
  ),
  "fire-fighting": (
    <>
      <rect x="64" y="40" width="34" height="66" rx="14" className="art-fill" />
      <path d="M64 64h34M64 82h34M74 40v-8h14v8M78 26h20l8 6" />
      <path d="M74 30c-18 0-28 10-30 26l-6 10" />
    </>
  ),
  "fire-alarm": (
    <>
      <path d="M60 84V64a20 20 0 0 1 40 0v20l7 8H53z" className="art-fill" />
      <path d="M80 44v-7M73 92a7 7 0 0 0 14 0" />
      <path d="M42 54a26 26 0 0 0 0 30M31 46a38 38 0 0 0 0 46M118 54a26 26 0 0 1 0 30M129 46a38 38 0 0 1 0 46" />
    </>
  ),
  "mechanical-equipment": (
    <>
      <circle cx="66" cy="58" r="26" strokeWidth="9" strokeDasharray="7.4 7.45" strokeLinecap="butt" />
      <circle cx="66" cy="58" r="20" className="art-fill" />
      <circle cx="66" cy="58" r="7" />
      <circle cx="110" cy="86" r="15" strokeWidth="8" strokeDasharray="6.3 6.3" strokeLinecap="butt" />
      <circle cx="110" cy="86" r="10" className="art-fill" />
      <circle cx="110" cy="86" r="3.5" />
    </>
  ),
  "building-materials": (
    <>
      <rect x="32" y="40" width="96" height="60" rx="3" className="art-fill" />
      <path d="M32 55h96M32 70h96M32 85h96" />
      <path d="M56 40v15M80 40v15M104 40v15M44 55v15M68 55v15M92 55v15M116 55v15M56 70v15M80 70v15M104 70v15M44 85v15M68 85v15M92 85v15M116 85v15" />
      <path d="M100 30l22-10 6 8" />
    </>
  ),
  "low-current": (
    <>
      <path d="M40 46l54-12 6 22-54 12z" className="art-fill" />
      <path d="M58 64l-6 20H38M38 74v20" />
      <path d="M110 36a10 10 0 0 1 0 14M117 30a18 18 0 0 1 0 26" />
      <circle cx="114" cy="88" r="6" className="art-fill" />
      <circle cx="94" cy="102" r="5" />
      <circle cx="132" cy="104" r="5" />
      <path d="M109 92l-10 6M119 92l9 8" />
    </>
  ),
  infrastructure: (
    <>
      <path d="M22 100h116" />
      <circle cx="60" cy="78" r="20" className="art-fill" />
      <circle cx="100" cy="78" r="20" className="art-fill" />
      <circle cx="80" cy="42" r="20" className="art-fill" />
      <circle cx="60" cy="78" r="11" />
      <circle cx="100" cy="78" r="11" />
      <circle cx="80" cy="42" r="11" />
    </>
  ),
};

const FALLBACK_ART = (
  <>
    <path d="M80 28l38 19v38l-38 19-38-19V47z" className="art-fill" />
    <path d="M42 47l38 19 38-19M80 66v38M61 37l38 19" />
  </>
);

/** Tinted illustration panel for a root category slug. Fills its container; size it from the outside. */
export function CategoryArt({ slug, className, compact, inset, children }: { slug?: string | null; className?: string; compact?: boolean; inset?: boolean; children?: React.ReactNode }) {
  const theme = categoryTheme(slug);
  const art = (slug && ART[slug]) || FALLBACK_ART;
  return (
    <div className={cn("relative overflow-hidden", className)} style={{ backgroundColor: theme.bg, color: theme.fg }}>
      <svg viewBox="0 0 160 120" className={inset ? "absolute inset-[12%] size-[76%]" : "absolute inset-0 size-full"} preserveAspectRatio="xMidYMid meet" focusable="false" aria-hidden>
        {/* faint eight-point star motif in the corner */}
        <g fill="currentColor" opacity="0.07">
          <rect x="122" y="-8" width="40" height="40" />
          <rect x="122" y="-8" width="40" height="40" transform="rotate(45 142 12)" />
        </g>
        <g
          fill="none"
          stroke="currentColor"
          strokeWidth={compact ? 3.5 : 3}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="[&_.art-fill]:fill-[currentColor] [&_.art-fill]:[fill-opacity:0.12]"
        >
          {art}
        </g>
      </svg>
      {children}
    </div>
  );
}

/** Small icon for a root category (navigation chips). */
export function CategoryIcon({ slug, className }: { slug?: string | null; className?: string }) {
  const Icon = categoryTheme(slug).icon;
  return <Icon className={cn("size-4", className)} aria-hidden />;
}
