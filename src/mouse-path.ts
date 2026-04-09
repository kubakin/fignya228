/** Общая «человеческая» траектория курсора (Bezier + джиттер). */

export function randFloat(lo: number, hi: number): number {
  return lo + Math.random() * (hi - lo);
}

type Pt = { x: number; y: number };

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function choose<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

function add(a: Pt, b: Pt): Pt {
  return { x: a.x + b.x, y: a.y + b.y };
}

function sub(a: Pt, b: Pt): Pt {
  return { x: a.x - b.x, y: a.y - b.y };
}

function mult(a: Pt, k: number): Pt {
  return { x: a.x * k, y: a.y * k };
}

function magnitude(a: Pt): number {
  return Math.hypot(a.x, a.y);
}

function unit(a: Pt): Pt {
  const m = magnitude(a) || 1;
  return { x: a.x / m, y: a.y / m };
}

function setMagnitude(a: Pt, m: number): Pt {
  return mult(unit(a), m);
}

function direction(a: Pt, b: Pt): Pt {
  return sub(b, a);
}

function perpendicular(a: Pt): Pt {
  return { x: a.y, y: -a.x };
}

function randomVectorOnLine(a: Pt, b: Pt): Pt {
  const vec = direction(a, b);
  return add(a, mult(vec, Math.random()));
}

function cubicPoint(p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: number): Pt {
  const u = 1 - t;
  const tt = t * t;
  const uu = u * u;
  const uuu = uu * u;
  const ttt = tt * t;
  return {
    x: uuu * p0.x + 3 * uu * t * p1.x + 3 * u * tt * p2.x + ttt * p3.x,
    y: uuu * p0.y + 3 * uu * t * p1.y + 3 * u * tt * p2.y + ttt * p3.y,
  };
}

function randomNormalLine(a: Pt, b: Pt, range: number): [Pt, Pt] {
  const randMid = randomVectorOnLine(a, b);
  const normal = setMagnitude(perpendicular(direction(a, randMid)), range);
  return [randMid, normal];
}

function generateBezierAnchors(a: Pt, b: Pt, spread: number): [Pt, Pt] {
  const side = Math.random() < 0.5 ? -1 : 1;
  const calc = (): Pt => {
    const [randMid, normal] = randomNormalLine(a, b, spread);
    const choice = mult(normal, side);
    return randomVectorOnLine(randMid, add(randMid, choice));
  };
  const p1 = calc();
  const p2 = calc();
  return p1.x <= p2.x ? [p1, p2] : [p2, p1];
}

function bezierLength(p0: Pt, p1: Pt, p2: Pt, p3: Pt): number {
  let len = 0;
  let prev = p0;
  const samples = 45;
  for (let i = 1; i <= samples; i++) {
    const t = i / samples;
    const cur = cubicPoint(p0, p1, p2, p3, t);
    len += magnitude(sub(cur, prev));
    prev = cur;
  }
  return len;
}

function fitts(distance: number, width: number): number {
  return 2 * Math.log2(distance / width + 1);
}

function shouldOvershoot(from: Pt, to: Pt, threshold = 500): boolean {
  return magnitude(sub(to, from)) > threshold;
}

function overshootPoint(to: Pt, radius: number): Pt {
  const a = Math.random() * 2 * Math.PI;
  const r = radius * Math.sqrt(Math.random());
  return add(to, { x: r * Math.cos(a), y: r * Math.sin(a) });
}

type SegmentOptions = {
  spreadOverride?: number;
  moveSpeed?: number;
};

function segmentPath(start: Pt, end: Pt, opts: SegmentOptions = {}): Pt[] {
  const width = 100;
  const minSpread = 2;
  const maxSpread = 200;
  const vec = direction(start, end);
  const dist = magnitude(vec);
  const spread = opts.spreadOverride ?? clamp(dist, minSpread, maxSpread);
  const [a1, a2] = generateBezierAnchors(start, end, spread);
  const length = bezierLength(start, a1, a2, end) * 0.8;

  const moveSpeed =
    opts.moveSpeed !== undefined && opts.moveSpeed > 0
      ? opts.moveSpeed
      : randFloat(0.7, 1.7);
  const speed = 25 / moveSpeed;
  const minSteps = 25;
  const baseTime = speed * minSteps;
  const steps = Math.max(
    8,
    Math.ceil((Math.log2(fitts(length, width) + 1) + baseTime) * 3)
  );

  const out: Pt[] = [];
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);
    const p = cubicPoint(start, a1, a2, end, t);
    out.push({ x: Math.max(0, Math.round(p.x)), y: Math.max(0, Math.round(p.y)) });
  }
  return out;
}

function easeLinear(t: number): number {
  return t;
}
function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}
function easeOutQuint(t: number): number {
  return 1 - (1 - t) ** 5;
}
function easeInOutSine(t: number): number {
  return -(Math.cos(Math.PI * t) - 1) / 2;
}
function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;
}

export function dedupeConsecutive(
  pts: { x: number; y: number }[]
): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (!last || last.x !== p.x || last.y !== p.y) out.push(p);
  }
  return out;
}

export function humanLikePath(
  from: { x: number; y: number },
  to: { x: number; y: number }
): { x: number; y: number }[] {
  const start = { x: from.x, y: from.y };
  const end = { x: to.x, y: to.y };
  if (magnitude(sub(end, start)) < 2) return [from, to];

  const threshold = Number(process.env.MOUSE_OVERSHOOT_THRESHOLD ?? 500);
  const radius = Number(process.env.MOUSE_OVERSHOOT_RADIUS ?? 120);
  const overshootSpread = Number(process.env.MOUSE_OVERSHOOT_SPREAD ?? 10);
  const canOvershoot =
    Number.isFinite(threshold) &&
    Number.isFinite(radius) &&
    Number.isFinite(overshootSpread) &&
    shouldOvershoot(start, end, threshold);

  if (canOvershoot) {
    const over = overshootPoint(end, radius);
    const p1 = segmentPath(start, over);
    const p2 = segmentPath(over, end, { spreadOverride: overshootSpread });
    return dedupeConsecutive([...p1, ...p2]);
  }
  return dedupeConsecutive(segmentPath(start, end));
}
