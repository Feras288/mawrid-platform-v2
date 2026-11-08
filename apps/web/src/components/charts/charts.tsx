"use client";

import * as React from "react";

/**
 * Small dependency-free SVG charts following the project's data-viz rules:
 * single-series marks in the validated chart hue (#1f8a72 — passes lightness, chroma and 3:1 contrast
 * on the light surface), columns ≤ 24px with 4px rounded data-ends and square baselines, 2px lines,
 * ≥ 8px end markers with a 2px surface ring, hairline solid gridlines, text in ink tokens, hover
 * tooltips on every mark, and a table view for screen readers / exact values. Time runs left→right.
 */

const HUE = "#1f8a72";
const SURFACE = "#ffffff";
const GRID = "#e7e5df";
const INK_MUTED = "#5f6763";

function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * p;
}
const compact = (v: number, locale: string) => new Intl.NumberFormat(locale === "ar" ? "ar-SA-u-nu-latn" : "en", { notation: v >= 10_000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(v);

export interface Point {
  label: string;
  value: number;
  /** formatted value for tooltips / table */
  display: string;
}

function TableView({ caption, rows, headers }: { caption: string; rows: string[][]; headers: string[] }) {
  return (
    <details className="mt-2 text-xs text-ink-500">
      <summary className="cursor-pointer select-none">{caption}</summary>
      <table className="mt-2 w-full text-start">
        <thead>
          <tr>
            {headers.map((h) => (
              <th key={h} scope="col" className="py-1 text-start font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-sand-100">
              {r.map((c, j) => (
                <td key={j} className="py-1" dir={j > 0 ? "ltr" : undefined}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

export function ColumnChart({ title, points, locale, tableLabel, valueHeader, height = 200 }: { title: string; points: Point[]; locale: string; tableLabel: string; valueHeader: string; height?: number }) {
  const [hover, setHover] = React.useState<number | null>(null);
  const W = 640;
  const pad = { t: 16, r: 8, b: 26, l: 44 };
  const max = niceMax(Math.max(0, ...points.map((p) => p.value)));
  const ih = height - pad.t - pad.b;
  const slot = (W - pad.l - pad.r) / Math.max(points.length, 1);
  const bw = Math.min(24, slot * 0.6);
  const y = (v: number) => pad.t + ih - (v / max) * ih;
  const ticks = [0, max / 2, max];
  const maxIdx = points.reduce((m, p, i) => (p.value > (points[m]?.value ?? -1) ? i : m), 0);
  const r = 4;
  return (
    <figure className="w-full">
      <figcaption className="sr-only">{title}</figcaption>
      <div className="relative" dir="ltr">
        <svg viewBox={`0 0 ${W} ${height}`} className="h-auto w-full" role="img" aria-label={title} onMouseLeave={() => setHover(null)}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke={GRID} strokeWidth={1} />
              <text x={pad.l - 6} y={y(t) + 4} textAnchor="end" fontSize={11} fill={INK_MUTED}>
                {compact(t, locale)}
              </text>
            </g>
          ))}
          {points.map((p, i) => {
            const cx = pad.l + slot * i + slot / 2;
            const top = y(p.value);
            const h = pad.t + ih - top;
            const x0 = cx - bw / 2;
            const rr = Math.min(r, h);
            const path = h > 0 ? `M${x0},${pad.t + ih} V${top + rr} Q${x0},${top} ${x0 + rr},${top} H${x0 + bw - rr} Q${x0 + bw},${top} ${x0 + bw},${top + rr} V${pad.t + ih} Z` : "";
            return (
              <g key={p.label} onMouseEnter={() => setHover(i)}>
                <rect x={cx - slot / 2} y={pad.t} width={slot} height={ih} fill="transparent" />
                {path ? <path d={path} fill={HUE} opacity={hover === null || hover === i ? 1 : 0.55} /> : null}
                {(i % Math.ceil(points.length / 6) === 0 || i === points.length - 1) && (
                  <text x={cx} y={height - 8} textAnchor="middle" fontSize={11} fill={INK_MUTED}>
                    {p.label}
                  </text>
                )}
                {i === maxIdx && p.value > 0 && hover === null ? (
                  <text x={cx} y={top - 6} textAnchor="middle" fontSize={11} fill="#2b2f36">
                    {compact(p.value, locale)}
                  </text>
                ) : null}
              </g>
            );
          })}
        </svg>
        {hover !== null && points[hover] ? (
          <div className="pointer-events-none absolute top-1 rounded-md border border-sand-200 bg-white px-2 py-1 text-xs shadow" style={{ left: `${((pad.l + slot * hover + slot / 2) / W) * 100}%`, transform: "translateX(-50%)" }} role="status">
            <div className="text-ink-500">{points[hover].label}</div>
            <div className="font-semibold text-ink-800">{points[hover].display}</div>
          </div>
        ) : null}
      </div>
      <TableView caption={tableLabel} headers={["", valueHeader]} rows={points.map((p) => [p.label, p.display])} />
    </figure>
  );
}

export interface BandPoint {
  label: string;
  median: number;
  p25: number;
  p75: number;
  n: number;
  display: { median: string; p25: string; p75: string };
}

/** Median line over an interquartile band (one series → no legend; the title names it). */
export function BandLineChart({ title, points, locale, tableLabel, headers, height = 220 }: { title: string; points: BandPoint[]; locale: string; tableLabel: string; headers: [string, string, string, string, string]; height?: number }) {
  const [hover, setHover] = React.useState<number | null>(null);
  const W = 640;
  const pad = { t: 16, r: 16, b: 26, l: 48 };
  const ih = height - pad.t - pad.b;
  const iw = W - pad.l - pad.r;
  const hi = niceMax(Math.max(...points.map((p) => p.p75), 0) * 1.05);
  const lo = 0;
  const x = (i: number) => pad.l + (points.length <= 1 ? iw / 2 : (iw * i) / (points.length - 1));
  const y = (v: number) => pad.t + ih - ((v - lo) / (hi - lo)) * ih;
  const line = points.map((p, i) => `${i ? "L" : "M"}${x(i)},${y(p.median)}`).join(" ");
  const band = points.length ? `M${points.map((p, i) => `${x(i)},${y(p.p75)}`).join(" L")} L${[...points].reverse().map((p, k) => `${x(points.length - 1 - k)},${y(p.p25)}`).join(" L")} Z` : "";
  const last = points.length - 1;
  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * W;
    if (points.length <= 1) return setHover(0);
    const i = Math.round(((px - pad.l) / iw) * (points.length - 1));
    setHover(Math.max(0, Math.min(points.length - 1, i)));
  };
  return (
    <figure className="w-full">
      <figcaption className="sr-only">{title}</figcaption>
      <div className="relative" dir="ltr">
        <svg viewBox={`0 0 ${W} ${height}`} className="h-auto w-full" role="img" aria-label={title} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
          {[lo, hi / 2, hi].map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke={GRID} strokeWidth={1} />
              <text x={pad.l - 6} y={y(t) + 4} textAnchor="end" fontSize={11} fill={INK_MUTED}>
                {compact(t, locale)}
              </text>
            </g>
          ))}
          <path d={band} fill={HUE} opacity={0.1} />
          <path d={line} fill="none" stroke={HUE} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {points.map((p, i) =>
            i === 0 || i === last || i % Math.ceil(points.length / 6) === 0 ? (
              <text key={p.label} x={x(i)} y={height - 8} textAnchor="middle" fontSize={11} fill={INK_MUTED}>
                {p.label}
              </text>
            ) : null,
          )}
          {hover !== null && points[hover] ? <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={pad.t + ih} stroke={GRID} strokeWidth={1} /> : null}
          {last >= 0 ? <circle cx={x(hover ?? last)} cy={y(points[hover ?? last]!.median)} r={4} fill={HUE} stroke={SURFACE} strokeWidth={2} /> : null}
        </svg>
        {hover !== null && points[hover] ? (
          <div className="pointer-events-none absolute top-1 rounded-md border border-sand-200 bg-white px-2 py-1 text-xs shadow" style={{ left: `${(x(hover) / W) * 100}%`, transform: `translateX(${hover > points.length / 2 ? "-105%" : "5%"})` }} role="status">
            <div className="text-ink-500">{points[hover].label}</div>
            <div className="font-semibold text-ink-800">{points[hover].display.median}</div>
            <div className="text-ink-500">
              {points[hover].display.p25} – {points[hover].display.p75} · n={points[hover].n}
            </div>
          </div>
        ) : null}
      </div>
      <TableView caption={tableLabel} headers={headers} rows={points.map((p) => [p.label, p.display.median, p.display.p25, p.display.p75, String(p.n)])} />
    </figure>
  );
}
