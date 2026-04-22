/**
 * Улучшенный human scroll:
 * - переменная интенсивность
 * - микродвижения мыши во время скролла
 * - паузы "на чтение"
 * - ускорения/замедления
 */

import { mouse, sleep, straightTo } from "@nut-tree-fork/nut-js";
import { Point } from "@nut-tree-fork/shared";
import type { Page } from "playwright";
import { nutHumanMoveAndClickScreenPoint } from "./nut-move-click.js";

function randFloat(lo: number, hi: number): number {
  return lo + Math.random() * (hi - lo);
}

function randInt(lo: number, hi: number): number {
  return lo + Math.floor(Math.random() * (hi - lo + 1));
}

const SCROLL_SPEEDUP = 20;

/** ================= НОВОЕ: микро-движения мыши ================= */

async function microMouseDrift(): Promise<void> {
  if (Math.random() > 0.35) return;

  const dx = randFloat(-30, 30);
  const dy = randFloat(-20, 20);

  await mouse.move(
    straightTo(
      new Point(
        Math.max(0, dx),
        Math.max(0, dy)
      )
    )
  );

  await sleep(randFloat(20, 80));
}

/** ================= НОВОЕ: более "человеческий" burst ================= */

async function smoothScrollBurst(): Promise<void> {
  const ticks = randInt(12, 40);

  for (let i = 0; i < ticks; i++) {
    // умеренная вариативность (без перегиба)
    const amount =
      Math.random() < 0.2
        ? randInt(8, 14)   // иногда быстрее
        : randInt(3, 10);  // обычно

    await mouse.scrollDown(amount);

    // стабильные паузы (важно!)
    const delay =
      Math.random() < 0.15
        ? randFloat(40, 90)   // иногда "задумался"
        : randFloat(12, 40);

    await sleep(Math.max(1, delay / SCROLL_SPEEDUP));
  }
}

/** ================= НОВОЕ: паузы "чтения" ================= */

async function readingPause(): Promise<void> {
  // реже, но правдоподобнее
  if (Math.random() < 0.18) {
    await sleep(randFloat(1800, 3500));
  } else {
    await sleep(randFloat(900, 1600));
  }
}

/** ================= твои функции (без изменений) ================= */

async function viewportCenterScreenPx(page: Page): Promise<{ x: number; y: number }> {
  return page.evaluate(() => {
    const chromeTop = window.outerHeight - window.innerHeight;
    const chromeLeft = window.outerWidth - window.innerWidth;
    const lx = window.innerWidth / 2;
    const ly = window.innerHeight / 2;
    return {
      x: Math.round(window.screenX + chromeLeft / 2 + lx),
      y: Math.round(window.screenY + chromeTop + ly),
    };
  });
}

async function dismissModalboxIfVisible(page: Page): Promise<boolean> {
  const point = await page.evaluate(function () {
    const modal = document.querySelector('[data-testid="modalbox"]') as HTMLElement | null;
    if (!modal) return null;

    const style = window.getComputedStyle(modal);
    if (style.display === "none" || style.visibility === "hidden") return null;

    const r = modal.getBoundingClientRect();
    if (r.width < 20 || r.height < 20) return null;

    const chromeTop = window.outerHeight - window.innerHeight;
    const chromeLeft = window.outerWidth - window.innerWidth;

    const cx = r.left + r.width / 2;
    const cy = r.top - randInt(20, 60);

    return {
      x: Math.round(window.screenX + chromeLeft / 2 + cx),
      y: Math.round(window.screenY + chromeTop + cy),
    };
  });

  if (!point) return false;

  await nutHumanMoveAndClickScreenPoint(point.x, point.y);
  await sleep(randFloat(220, 520));
  return true;
}

function resolveScrollCycleCount(): number {
  let min = 1;
  let max = 20;

  const minRaw = process.env.SCROLL_CYCLES_MIN?.trim();
  const maxRaw = process.env.SCROLL_CYCLES_MAX?.trim();

  if (minRaw) {
    const n = Number(minRaw);
    if (Number.isFinite(n)) min = Math.floor(n);
  }

  if (maxRaw) {
    const n = Number(maxRaw);
    if (Number.isFinite(n)) max = Math.floor(n);
  }

  if (max < min) [min, max] = [max, min];

  return randInt(min, max);
}

/** ================= ГЛАВНАЯ ФУНКЦИЯ ================= */

export async function runHumanScrollDownPhase(
  page: Page,
  _cycles?: number
): Promise<void> {
  mouse.config.autoDelayMs = 0;

  const cycles = _cycles || resolveScrollCycleCount();

  const { x, y } = await viewportCenterScreenPx(page);

  mouse.config.mouseSpeed = randFloat(300, 900);
  await mouse.move(straightTo(new Point(x, y)));

  await sleep(randFloat(200, 700));

  for (let c = 0; c < cycles; c++) {
    await dismissModalboxIfVisible(page);

    await smoothScrollBurst();

    // иногда чуть вверх (очень важно!)
    if (Math.random() < 0.12) {
      await mouse.scrollUp(randInt(1, 6));
      await sleep(randFloat(40, 120));
    }

    // иногда "дергается"
    if (Math.random() < 0.08) {
      await mouse.scrollDown(randInt(15, 30));
    }

    await dismissModalboxIfVisible(page);

    // пауза "чтения"
    await readingPause();
  }

  await sleep(randFloat(100, 400));
}