# Design System — "Modern Saudi"

Status: **Implemented** (2026-11-09). Source of truth for tokens: `apps/web/src/app/globals.css`;
components: `apps/web/src/components/ui/*`, `components/brand`, `components/store/category-art.tsx`.
The brand name is configuration (`BRAND_NAME_AR` / `BRAND_NAME_EN`) and never appears in components.

## 1. Principles
1. **Trust first** — a procurement platform sells reliability: calm surfaces, precise numbers, explicit VAT basis,
   visible verification cues. No decorative motion.
2. **Saudi, not folkloric** — deep palm green, desert gold and warm sand; one restrained geometric motif
   (eight-point star from two rotated squares) used only on dark brand surfaces and the brand mark.
3. **Hierarchy through type and space**, not colour noise. Colour carries meaning (status, primary action).
4. **RTL is the default**: logical properties only (`ms/me/ps/pe/start/end`), numbers and codes isolated LTR
   (`<bdi dir="ltr">`), directional icons mirrored (`.flip-rtl`, `ltr:rotate-180`).
5. **Accessible by construction**: WCAG 2.1 AA contrast for all text tokens, visible focus, 44 px touch targets
   for primary actions, axe (wcag2a/aa) without serious/critical issues on every page.

## 2. Colour
| Token | Values | Use |
|---|---|---|
| `primary-50…950` (palm) | `#eef8f5` … `#0f5c4d` (700) … `#041f1a` | Primary actions (700), active nav, brand surfaces (900/950) |
| `accent-50…700` (desert gold) | `#fbf6ec` … `#93620f` (500) | Commerce CTA (add to cart, checkout), highlights; 500 is AA with white |
| `sand-25…400` | `#fdfcfa` … `#b9b5a6` | Page background (50), table headers (100), borders (200/300) |
| `ink-300…900` | `#9aa19d` … `#1d2622` | Text: 900 headings, 700 body, 500/400 secondary (≥ 4.5:1); 300 decorative only |
| Status | success/warning/danger/info 50 + 600 (danger 700) | Badges, alerts, stock state |

Category illustrations use per-system tints (electrical gold, plumbing blue, HVAC teal, fire red, …) defined in
`CATEGORY_THEME`; they are decorative and always paired with a text label.

## 3. Typography
Fonts: IBM Plex Sans Arabic (Arabic first) + Inter (Latin first in English), self-hosted.

| Token | Size / line-height | Use |
|---|---|---|
| `text-display` | 44 / 1.12, 700 | Store hero (≥ sm) |
| `text-h1` | 30 / 1.2 | Page titles (`PageHeader`, store titles) |
| `text-h2` | 22 / 1.3 | Section titles (`SectionHeading`) |
| `text-h3` | 17 / 1.4 | Card titles (`CardHeader`), dialog titles |
| `text-body` | 15 / 1.65 | Body (set on `body`) |
| `text-sm` / `text-xs` | 14 / 12 | Dense UI, tables, meta |

Weights: 800 for display/prices, 700 headings, 600 labels/buttons, 400–500 text. Prices use
`tabular-nums`. Custom sizes are registered with tailwind-merge (`lib/utils.ts`) so `cn()` never drops them.

## 4. Spacing, radius, elevation
- Spacing: 4 px grid. Rhythm: item 8–12 px · group 16–24 px · section 40–64 px (`space-y-14/16` on store pages,
  `space-y-6` on dashboards). Page container `container-shell` (84 rem, 16/24/32 px gutters).
- Radius: `sm 6` inputs-in-groups · `lg 12` buttons/inputs · `card 16` cards · `2xl/3xl 20–24` hero and media.
- Shadows (warm-tinted): `shadow-xs` controls, `shadow-card` cards, `shadow-raised` hover/auth card,
  `shadow-overlay` dialogs/drawers. No shadow stacking beyond these.

## 5. Components (public API unchanged unless noted)
| Component | Notes |
|---|---|
| `Button` / `buttonVariants` | primary (palm), accent (gold commerce CTA), secondary, outline, ghost, danger, link; sizes sm 32 · md 40 · lg 48 · icon |
| `Input`, `Select`, `Textarea`, `Label`, `Field` | 40 px, focus ring 4 px palm/15 %, invalid state, label 13 px semibold, hint/error under field linked by `aria-describedby` |
| `Card`, `CardHeader`, `CardBody` | 16 px radius, `shadow-card`, header with title/description/actions |
| `PageHeader` | breadcrumbs, `text-h1` title, description, actions, divider |
| `SectionHeading` (new) | `text-h2` + description + trailing action link |
| `Stat` | KPI tile: label, large tabular value, hint, optional icon (new prop), `tone="primary"` |
| `Badge` | 7 tones, ring-inset for definition on tinted backgrounds |
| `Table/Th/Td/Tr` | stronger header (`sand-100`, bold), 12 px row padding, row hover tint |
| `EmptyState`, `Alert`, `Dialog`, `Menu`, `Tabs` | icon medallion, rounded-xl alerts, blurred overlay, `text-h3` dialog titles |
| `QuickActions`, `ActivityList`, `Checklist` (new, `ui/dashboard.tsx`) | dashboard building blocks |
| `BrandMark` (new) | SVG star tile, `default` / `inverse` |
| `CategoryArt`, `CategoryIcon` (new) | original SVG line art per root system; product image fallback |
| `ProductCard` | media (upload or category art + sub-category chip), brand, title, verified seller, price ex-VAT + incl. VAT, special price badge, stock dot, lead time; whole card is one link |
| `CheckoutSteps` (new) | review → delivery & payment → confirmation |

## 6. Navigation
- **Store**: trust bar (≥ lg) · brand · category-scoped search (category select ≥ sm, hidden at md to fit) ·
  locale · account/sign-in · cart with count · department row (horizontal scroll on small screens) · rich footer.
- **Portals**: dark palm sidebar (17 rem) with grouped items (`NavItem.group`, message keys `ux.navGroups.*`),
  gold active indicator, active organisation shown at top, "Back to store" at bottom; mobile drawer uses the
  same groups. Top bar shows portal badge + organisation, locale, notifications, user menu.

## 7. Imagery
No licensed photography exists, so the UI never fakes product photos. Supplier uploads (`image_file_ids`) are
always shown first; otherwise the root system's illustration is used with the sub-category name. All
illustrations are original inline SVG (no external requests, no licensing exposure).

## 8. Responsive rules
| Breakpoint | Behaviour |
|---|---|
| < 640 | single column; product grids 2 columns; listing filters collapsed in a `<details>` drawer below the toolbar; KPI tiles 2-up with compact values; portal brand shows the mark only |
| 640–1023 | 2–3 column grids; search category select visible (sm), header search fills the row |
| ≥ 1024 | store sidebar filters, portal sidebar, trust bar, 3–4 column grids, sticky buy box / order summary |
Rule: no horizontal page scroll at 375 px (asserted by E2E); wide data (comparison matrix, tables) scrolls inside
its own container with sticky header and first column.

## 9. Do / Don't
- Do use `accent` only for the commercial next step (add to cart, checkout, create POs); `primary` elsewhere.
- Do keep one `h1` per page; status changes in `role="status"` regions only where tests and screen readers expect them.
- Don't add new colours inline — extend tokens. Don't animate layout; transitions ≤ 300 ms on colour/shadow/transform.
- Don't rename existing message keys or visible labels used by E2E selectors; add new keys under `ux.*` in both locales.
