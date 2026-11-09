# Visual Audit — before redesign (2026-11-09)

Method: real screenshots of the running app (Next.js dev server, seeded data + 100k generated catalog rows) at
1440×900 (desktop) and 375×812 (mobile), Arabic and English. Each finding names the page, the problem and its
impact. Severity: **H** high (hurts trust or task completion) · **M** medium (clarity / consistency) · **L** low.

## Cross-cutting
| # | Finding | Sev |
|---|---|---|
| X1 | No brand mark: a single letter «م» in a green square. Nothing signals "trusted Saudi B2B marketplace". | H |
| X2 | Flat type scale: titles 24 px, body 14 px, captions 12 px; weights barely differ, so pages read as one grey block. | H |
| X3 | Colour is used only for the primary button; sand background + white cards + thin borders give very low depth. Shadows are near-invisible (`shadow-xs`). | M |
| X4 | Gold accent is used for the main purchase CTA but reads as secondary; the primary green is used for everything else, so the most important action does not stand out. | H |
| X5 | Spacing is uniform (16–24 px everywhere); no rhythm between section, group and item levels. | M |
| X6 | Status badges, tables and forms are correct but generic; no density options, no row hover affordance in some lists, tiny monospace codes. | M |

## Public store
| # | Page | Finding | Sev |
|---|---|---|---|
| S1 | Header | Search box is a plain input; no category scope, no department navigation, no trust/utility bar (delivery coverage, VAT invoices, verified suppliers). Account/cart icons have no labels on desktop. | H |
| S2 | Home | Hero is a flat green gradient with two buttons; no imagery, no proof points, no search. | H |
| S3 | Home | Categories are text lists inside identical white boxes — no visual cue for 9 very different systems (electrical, plumbing, HVAC, fire…). | H |
| S4 | Product cards | Grey square with a generic box icon for every product; price, unit, VAT basis, stock and supplier are small and equally weighted; no verified-supplier or lead-time cues; no quick add. | H |
| S5 | Listing | Filters are a long form on the side; on mobile they render **above** the results, pushing products below the fold (first product at ~900 px). Sort lives inside the filter form; no active-filter chips; no result toolbar. | H |
| S6 | Product page | 40% of the first screen is an empty placeholder; buy box has weak hierarchy (price, VAT, stock and CTA blend); supplier identity is one grey line; specs and quantity pricing are below the fold. | H |
| S7 | Cart / checkout | Functional but plain: no line thumbnails, summary not sticky, no step indication, delivery options rendered as a bare select. | M |
| S8 | Footer | One line of text; no navigation, no legal links, no business information. | M |

## Portals (buyer, supplier, admin)
| # | Page | Finding | Sev |
|---|---|---|---|
| P1 | Sidebar | 15–16 links in one flat list with 16 px icons and no grouping; active state is a pale tint; long Arabic labels truncate. | H |
| P2 | Dashboards | Supplier dashboard = status card + two numbers on an otherwise empty canvas; buyer and admin dashboards similar. No KPIs, next actions or recent activity. | H |
| P3 | Page headers | Titles small, no eyebrow/context; primary actions not visually separated from secondary ones. | M |
| P4 | Tables | Light header row with low contrast, no sticky header, numeric columns not right-aligned in LTR / left-aligned in RTL consistently, codes in tiny monospace. | M |
| P5 | Forms / dialogs | Labels and help text identical weight; fields 40 px everywhere; no section grouping inside long forms. | M |
| P6 | RFQ comparison | Dense grid without a clear "best offer" signal hierarchy; supplier header cards and matrix headers use the same weight as cells; horizontal scroll without a sticky first column on mobile. | M |
| P7 | Empty states | Icon + one line; no guidance or call to action in several lists. | L |

## Responsive / RTL
| # | Finding | Sev |
|---|---|---|
| R1 | Mobile store header stacks logo, three icons and a full-width search: no categories access. | M |
| R2 | RTL is correct structurally (mirrored layout, LTR numbers), but icons that imply direction (chevrons/arrows) are not consistently mirrored. | L |

## Accessibility baseline (kept)
Previous work already guarantees: axe (wcag2a/aa) without serious/critical issues on every portal page in both
languages, AA text contrast tokens, no horizontal overflow at 375 px. The redesign must keep all of that.

## Imagery
No licensed product photography exists in the project or seed data. Product records support uploaded images
(`image_file_ids`); when none exist the UI must not fake photos. Decision: an original, license-free set of
category illustrations (inline SVG line art per system/category) on tinted backgrounds, used for category
tiles and as product fallbacks; real supplier uploads take precedence automatically.
