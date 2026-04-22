/** ================== UTILS ================== */

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

/** ================== BEZIER ================== */

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

  for (let i = 1; i <= 45; i++) {
    const t = i / 45;
    const cur = cubicPoint(p0, p1, p2, p3, t);
    len += magnitude(sub(cur, prev));
    prev = cur;
  }

  return len;
}

/** ================== HUMAN MODEL ================== */

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

/** ================== PATH ================== */

type SegmentOptions = {
  spreadOverride?: number;
  moveSpeed?: number;
};

function segmentPath(start: Pt, end: Pt, opts: SegmentOptions = {}): Pt[] {
  const width = 100;
  const minSpread = 2;
  const maxSpread = 200;

  const dist = magnitude(direction(start, end));
  const spread = opts.spreadOverride ?? clamp(dist, minSpread, maxSpread);

  const [a1, a2] = generateBezierAnchors(start, end, spread);
  const length = bezierLength(start, a1, a2, end) * 0.8;

  const moveSpeed =
    opts.moveSpeed && opts.moveSpeed > 0
      ? opts.moveSpeed
      : randFloat(0.7, 1.7);

  const speed = 25 / moveSpeed;
  const baseTime = speed * 25;

  const steps = Math.max(
    10,
    Math.ceil((Math.log2(fitts(length, width) + 1) + baseTime) * 3)
  );

  const out: Pt[] = [];

  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);
    const p = cubicPoint(start, a1, a2, end, t);

    out.push({
      x: Math.round(p.x),
      y: Math.round(p.y),
    });
  }

  return out;
}

/** ================== EASING ================== */

function easeOutCubic(t: number) {
  return 1 - (1 - t) ** 3;
}

function easeOutQuint(t: number) {
  return 1 - (1 - t) ** 5;
}

function easeInOutSine(t: number) {
  return -(Math.cos(Math.PI * t) - 1) / 2;
}

function easeInOutCubic(t: number) {
  return t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;
}

function pickEasing() {
  return choose([
    easeOutCubic,
    easeOutQuint,
    easeInOutSine,
    easeInOutCubic,
  ]);
}

function buildDelays(count: number): number[] {
  const easing = pickEasing();
  const delays: number[] = [];

  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    const e = easing(t);

    const base = 2 + (1 - e) * 10;
    delays.push(base + Math.random() * 4);
  }

  return delays;
}

/** ================== JITTER ================== */

function jitter(p: Pt): Pt {
  return {
    x: p.x + (Math.random() - 0.5) * 1.5,
    y: p.y + (Math.random() - 0.5) * 1.5,
  };
}

/** ================== PUBLIC ================== */

export function dedupeConsecutive(pts: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (!last || last.x !== p.x || last.y !== p.y) out.push(p);
  }
  return out;
}

export function humanLikePath(from: Pt, to: Pt): Pt[] {
  const threshold = Number(process.env.MOUSE_OVERSHOOT_THRESHOLD ?? 500);
  const radius = Number(process.env.MOUSE_OVERSHOOT_RADIUS ?? 120);
  const spread = Number(process.env.MOUSE_OVERSHOOT_SPREAD ?? 10);

  const base = segmentPath(from, to);

  if (shouldOvershoot(from, to, threshold)) {
    const over = overshootPoint(to, radius);

    const p1 = segmentPath(from, over);
    const p2 = segmentPath(over, to, {
      spreadOverride: spread,
      moveSpeed: randFloat(1.2, 2.2), // быстрее возврат
    });

    return dedupeConsecutive([...p1, ...p2]);
  }

  return dedupeConsecutive(base);
}

/** ================== MOUSE ================== */

export async function moveMouseHuman(
  page: any,
  from: Pt,
  to: Pt
) {
  const path = humanLikePath(from, to);
  const delays = buildDelays(path.length);

  for (let i = 0; i < path.length; i++) {
    let p = path[i];

    if (i < path.length - 1) {
      p = jitter(p);
    }

    await page.mouse.move(p.x, p.y);
    await page.waitForTimeout(delays[i]);
  }
}