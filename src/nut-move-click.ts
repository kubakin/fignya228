/**
 * Системный курсор nut.js: точка клика с учётом перекрытий (хедер, оверлеи),
 * центрирование в viewport, траектория Bezier, пауза 0.2–0.5 с перед кликом.
 * Координаты из Playwright (DOM), движение и клик — только nut.
 */

import { mouse, sleep } from "@nut-tree-fork/nut-js";
import { Point } from "@nut-tree-fork/shared";
import type { Locator } from "playwright";
import { humanLikePath, randFloat } from "./mouse-path.js";

function easeOutCubic(t: number) {
  return 1 - Math.pow(1 - t, 3);
}

function easeOutQuint(t: number) {
  return 1 - Math.pow(1 - t, 5);
}

function easeInOutSine(t: number) {
  return -(Math.cos(Math.PI * t) - 1) / 2;
}

function easeInOutCubic(t: number) {
  return t < 0.5
    ? 4 * t * t * t
    : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function choose<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function parseOffset(name: string): number {
  const v = process.env[name]?.trim();
  if (v === undefined || v === "") return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function stage2MouseSpeedMultiplier(): number {
  if ((process.env.STAGE ?? "").trim().toLowerCase() !== "stage2") return 1;
  const raw = process.env.STAGE2_MOUSE_SPEED_MULTIPLIER?.trim();
  const n = raw ? Number(raw) : NaN;
  if (Number.isFinite(n) && n > 0) return Math.min(n, 3);
  return 0.55;
}

function smoothSpeedMultiplier(): number {
  const raw = process.env.MOUSE_SMOOTH_SPEED_MULTIPLIER?.trim();
  const n = raw ? Number(raw) : NaN;
  if (Number.isFinite(n) && n > 0) return Math.min(n, 3);
  // Без микропауз визуально лучше чуть медленнее.
  return 0.72;
}

/**
 * Центр в окне просмотра + точка внутри элемента, где elementFromPoint
 * попадает в сам элемент (а не в перекрывающий хедер).
 * Внутри только обычный function + циклы — без стрелок, иначе tsx внедряет __name в evaluate.
 */
async function unobstructedClickInElementScreenPx(
  locator: Locator
): Promise<{ x: number; y: number }> {
  const raw = process.env.CLICK_VIEWPORT_TOP_SAFE_PX ?? "88";
  const n = Number(raw);
  const safeTopPx = Number.isFinite(n) && n >= 0 ? n : 88;

  return locator.evaluate(
    (el: Element, safeTop: number) => {
      el.scrollIntoView({
        block: "center",
        inline: "nearest",
        behavior: "instant",
      });

      const chromeTop = window.outerHeight - window.innerHeight;
      const chromeLeft = window.outerWidth - window.innerWidth;

      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) {
        const lx = r.left + r.width / 2;
        const ly = r.top + r.height / 2;
        return {
          x: Math.round(window.screenX + chromeLeft / 2 + lx),
          y: Math.round(window.screenY + chromeTop + ly),
        };
      }

      const margin = Math.max(
        2,
        Math.min(r.width, r.height) * (0.08 + Math.random() * 0.1)
      );
      const wIn = Math.max(0, r.width - 2 * margin);
      const hIn = Math.max(0, r.height - 2 * margin);

      let i: number;
      let lx: number;
      let ly: number;
      let h: Element | null;

      for (i = 0; i < 40; i++) {
        lx = r.left + margin + Math.random() * wIn;
        if (r.top < safeTop && hIn > 6) {
          const low = r.top + margin + hIn * 0.35;
          const high = r.bottom - margin;
          ly =
            low < high
              ? low + Math.random() * (high - low)
              : r.top + margin + Math.random() * hIn;
        } else {
          ly = r.top + margin + Math.random() * hIn;
        }
        h = document.elementFromPoint(lx, ly);
        if (h && (h === el || el.contains(h))) {
          return {
            x: Math.round(window.screenX + chromeLeft / 2 + lx),
            y: Math.round(window.screenY + chromeTop + ly),
          };
        }
      }

      const fallback: Array<[number, number]> = [
        [r.left + r.width / 2, r.top + r.height * 0.72],
        [r.left + r.width / 2, r.bottom - margin - 2],
        [r.left + r.width / 2, r.top + r.height / 2],
        [r.left + margin + 2, r.top + r.height * 0.65],
        [r.right - margin - 2, r.top + r.height * 0.65],
      ];
      for (i = 0; i < fallback.length; i++) {
        lx = fallback[i]![0];
        ly = fallback[i]![1];
        h = document.elementFromPoint(lx, ly);
        if (h && (h === el || el.contains(h))) {
          return {
            x: Math.round(window.screenX + chromeLeft / 2 + lx),
            y: Math.round(window.screenY + chromeTop + ly),
          };
        }
      }

      lx = r.left + r.width / 2;
      ly = r.top + r.height / 2;
      return {
        x: Math.round(window.screenX + chromeLeft / 2 + lx),
        y: Math.round(window.screenY + chromeTop + ly),
      };
    },
    safeTopPx
  );
}

export async function nutHumanMoveAndClick(locator: Locator): Promise<void> {
  const { x: sx, y: sy } = await unobstructedClickInElementScreenPx(locator);
  await nutHumanMoveAndClickScreenPoint(sx, sy);
}

export async function nutHumanMoveAndClickScreenPoint(
  sx: number,
  sy: number
): Promise<void> {
  const end = {
    x: Math.round(sx),
    y: Math.round(sy),
  };

  const start = await mouse.getPosition();

  const raw = humanLikePath(
    { x: start.x, y: start.y },
    end
  );

  const points = raw.map(
    (p) => new Point(Math.round(p.x), Math.round(p.y))
  );

  /** ================= SPEED FIX ================= */

  const base = Number("2520"); // 🔥 быстрее

  mouse.config.mouseSpeed =
    base *
    randFloat(1.05, 1.35) * // 🔥 ускорили базу
    stage2MouseSpeedMultiplier() *
    smoothSpeedMultiplier();

  mouse.config.autoDelayMs = 0;

  /** ================= MOVE (SMOOTHER) ================= */

  const len = points.length;

  for (let i = 0; i < len; i++) {
    const p = points[i];

    // 🔥 jitter ТОЛЬКО в финальной трети
    let final = p;

    if (i > len * 0.7 && i < len - 2) {
      final = new Point(
        Math.round(p.x + randFloat(-0.8, 0.8)),
        Math.round(p.y + randFloat(-0.8, 0.8))
      );
    }

    await mouse.move([final]);

    // 🔥 быстрее в целом
    const t = i / (len - 1);
    const delay =
      1 +
      Math.pow(1 - t, 2) * 6 + // мягкое замедление
      Math.random() * 1.5;

    await sleep(delay);
  }

  /** ================= FINAL SNAP ================= */

  // 🔥 одна чистая коррекция в конце (ВАЖНО)
  await mouse.move([
    new Point(
      Math.round(end.x + randFloat(-1.5, 1.5)),
      Math.round(end.y + randFloat(-1.5, 1.5))
    ),
  ]);

  await sleep(randFloat(60, 160));

  /** ================= CLICK ================= */

  await mouse.leftClick();

  if (Math.random() < 0.04) {
    await sleep(randFloat(40, 120));
    await mouse.leftClick();
  }
}