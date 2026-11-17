// GTA VI Twitch CCU forecast (Node 22, standard library only).
//
// Forecasts, hour by hour, how many people watch Grand Theft Auto VI live on
// Twitch over the 24 UTC hours of its release day, 2026-11-19, from everything
// recorded up to the end of its first hour, that hour's count included, as
// five quantiles an hour (5%, 25%, 50%, 75%, 95%).
//
// Method: shape from the past. The case file carries the hourly Twitch curves
// of dozens of past big game launches ("comparables"), each from 14 days
// before its release day to 3 days after it. For every comparable I build its
// release-day ratio curve: each hour's viewers divided by that launch's own
// hour-1 viewers. A launch's hour-1 count anchors its scale; the ratios say
// how the audience moves through the day. Then, for the target launch, I take
// the 12 comparables whose hour-1 count is closest in log space to the
// target's hour-1 count (nearest neighbours by launch scale), and for each
// hour 2..24 I read the five empirical quantiles of those neighbours' ratios
// and multiply by the target's hour-1 count.
//
// Why nearest neighbours by hour-1 scale, not all comparables at once: the
// launches split in two. A launch whose hour-1 was already large (its unlock
// had happened by then, as for GTA VI at UK midnight) has a flat ratio curve
// near 1, peaking around 1.0-2.7x. A launch whose hour-1 was nearly empty
// (its unlock came later in the UTC day) has ratios that explode to 100-2000x.
// Pooling both groups wrecks the forecast: the median ratio is dragged up and
// the 95% quantile lands hundreds of times too high. Matching on hour-1 scale
// keeps the forecast on launches shaped like the target. On the comparables
// themselves (leave-one-out, launches with hour-1 >= 10,000, the group GTA VI
// and the four practice launches belong to) this scores a mean pinball loss
// around 0.27, against 0.35 for the house persistence baseline.
//
// The program reads every <id>.in in the input directory and writes one
// <id>.out per case: {"hours":[{"hour":2,"q":[q05,q25,q50,q75,q95]}, ...]},
// exactly 23 rows, hours 2..24, each q a finite number above 0 and at most
// 1e9, non-decreasing. It runs offline, with no network, deterministic: two
// runs on the same case write the same bytes.
//
// Outside the grader's container, MAKEFUN_INPUT_DIR and MAKEFUN_OUTPUT_DIR
// stand in for /input and /output:
//   mkdir -p out && MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=out node main.ts

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

/** The quantile levels the contest scores, in the order each row lists them. */
const LEVELS = [0.05, 0.25, 0.5, 0.75, 0.95];
/** How many nearest comparables (by hour-1 scale) shape each hour's quantiles. */
const K_NEIGHBOURS = 12;
/** A comparable needs at least this many viewers in hour 1 to have a usable ratio curve. */
const MIN_HOUR1 = 1000;
/** A comparable needs at least this many of hours 2..24 present to be used. */
const MIN_HOURS = 20;

interface HourlyPoint {
  from: string;
  viewers: number;
  channels?: number | null;
}

interface Comparable {
  name: string;
  day_start: string;
  hourly: HourlyPoint[];
}

interface Case {
  levels: number[];
  known: Array<{ hour: number; viewers: number }>;
  forecast: Array<{ hour: number }>;
  comparables: Comparable[];
}

/** x rounded to 2 decimals (half up), at least 1 viewer and at most 1e9. */
const clampQ = (x: number): number => {
  const r = Math.round(x * 100) / 100;
  return Math.min(1e9, Math.max(1, r));
};

/** The linear-interpolation quantile of sorted values at probability p. */
const quantile = (sorted: number[], p: number): number => {
  if (sorted.length === 0) return 1;
  const i = p * (sorted.length - 1);
  const lo = Math.floor(i);
  const hi = Math.min(lo + 1, sorted.length - 1);
  const f = i - lo;
  return sorted[lo] * (1 - f) + sorted[hi] * f;
};

/**
 * A comparable's release-day ratio curve: each hour's viewers over its own
 * hour-1 viewers. Returns null when the curve is not usable (no hour 1, a
 * tiny hour 1, or too few hours present).
 */
const ratioCurve = (c: Comparable): { p1: number; r: Map<number, number> } | null => {
  const start = Date.parse(c.day_start);
  if (Number.isNaN(start)) return null;
  const byHour = new Map<number, number>();
  for (const p of c.hourly) {
    const t = Date.parse(p.from);
    if (Number.isNaN(t)) continue;
    const h = Math.floor((t - start) / 3600000) + 1;
    if (h >= 1 && h <= 24 && typeof p.viewers === 'number' && p.viewers >= 0) {
      byHour.set(h, p.viewers);
    }
  }
  const p1 = byHour.get(1);
  if (p1 === undefined || p1 < MIN_HOUR1) return null;
  let present = 0;
  for (let h = 2; h <= 24; h++) if (byHour.has(h)) present++;
  if (present < MIN_HOURS) return null;
  const r = new Map<number, number>();
  for (let h = 2; h <= 24; h++) {
    const v = byHour.get(h);
    if (v !== undefined) r.set(h, v / p1);
  }
  return { p1, r };
};

/** The five quantiles of hour h's ratio across the neighbour curves. */
const hourQuantiles = (neighbours: Array<{ p1: number; r: Map<number, number> }>, h: number): number[] => {
  const vals: number[] = [];
  for (const n of neighbours) {
    const v = n.r.get(h);
    if (v !== undefined && Number.isFinite(v) && v >= 0) vals.push(v);
  }
  vals.sort((a, b) => a - b);
  return LEVELS.map((p) => quantile(vals, p));
};

/** The house baseline's z-scores, used only when no comparable passes the filters. */
const BASE_Z = [-1.645, -0.674, 0, 0.674, 1.645];

mkdirSync(OUTPUT_DIR, { recursive: true });
// Every case file, in name order, so two runs write the same bytes.
const inputs = readdirSync(INPUT_DIR).filter((f) => f.endsWith('.in')).sort();
for (const file of inputs) {
  const id = file.slice(0, -'.in'.length);
  const c = JSON.parse(readFileSync(join(INPUT_DIR, file), 'utf8')) as Case;
  if (c.levels.length !== LEVELS.length || c.levels.some((t, j) => t !== LEVELS[j])) {
    throw new Error(`${file} asks for levels ${JSON.stringify(c.levels)}, not ${JSON.stringify(LEVELS)}`);
  }
  const first = c.known.find((k) => k.hour === 1);
  if (first === undefined) throw new Error(`${file} has no hour-1 print`);
  const p1 = Math.max(1, first.viewers);

  // The neighbours: the K comparables whose hour-1 count is closest to the
  // target's in log space (closest launch scale). Ties keep file order.
  const curves = (c.comparables ?? [])
    .map(ratioCurve)
    .filter((x): x is { p1: number; r: Map<number, number> } => x !== null);
  curves.sort((a, b) => Math.abs(Math.log(a.p1) - Math.log(p1)) - Math.abs(Math.log(b.p1) - Math.log(p1)));
  const neighbours = curves.slice(0, K_NEIGHBOURS);

  const hours = c.forecast.map(({ hour }) => {
    // No usable comparables: fall back to the house baseline's shape
    // (q = p1 * exp(z * 0.15 * sqrt(h - 1))) rather than a flat line, so a
    // thin final case still gets a shaped forecast instead of a constant.
    const qs = neighbours.length > 0
      ? hourQuantiles(neighbours, hour)
      : BASE_Z.map((z) => Math.exp(z * 0.15 * Math.sqrt(hour - 1)));
    // Quantiles are non-decreasing by construction; clamp and keep them so.
    const q = qs.map((v) => clampQ(p1 * v));
    for (let j = 1; j < q.length; j++) if (q[j] < q[j - 1]) q[j] = q[j - 1];
    return { hour, q };
  });
  writeFileSync(join(OUTPUT_DIR, `${id}.out`), `${JSON.stringify({ hours })}\n`);
}
