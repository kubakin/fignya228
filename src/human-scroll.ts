/**
 * Скролл вниз через системное колесо nut.js: вызывается после нажатия Enter по полю.
 * Один цикл = прокрутка (серия шагов колеса) + пауза 1–2 с. Таких циклов случайно 1–20 (настраивается).
 */

import { mouse, sleep, straightTo } from "@nut-tree-fork/nut-js";
import { Point } from "@nut-tree-fork/shared";
import type { Page } from "playwright";

function randFloat(lo: number, hi: number): number {
  return lo + Math.random() * (hi - lo);
}

function randInt(lo: number, hi: number): number {
  return lo + Math.floor(Math.random() * (hi - lo + 1));
}

/** Делитель скорости (микропаузы и паузы между сериями). */
const SCROLL_SPEEDUP = 20;

/** Центр viewport в экранных координатах (как в fill-input для клика). */
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

/**
 * Один «свайп» колесом: короткая серия шагов с микропаузами (~в SCROLL_SPEEDUP раз короче,
 * чем базовые 16–52 ms) и пакетами scrollDown, чтобы не терять плавность.
 */
async function smoothScrollBurst(): Promise<void> {
  const ticks = randInt(12, 48);
  for (let i = 0; i < ticks; i++) {
    await mouse.scrollDown(randInt(3, 14));
    await sleep(
      Math.max(0.2, randFloat(16, 52) / SCROLL_SPEEDUP)
    );
  }
}

/** Сколько циклов «прокрутка + пауза» выполнить (случайное число в диапазоне). */
function resolveScrollCycleCount(): number {
  let min = 1;
  let max = 20;
  const minRaw = process.env.SCROLL_CYCLES_MIN?.trim();
  const maxRaw = process.env.SCROLL_CYCLES_MAX?.trim();
  if (minRaw) {
    const n = Number(minRaw);
    if (Number.isFinite(n) && n >= 1) min = Math.min(500, Math.floor(n));
  }
  if (maxRaw) {
    const n = Number(maxRaw);
    if (Number.isFinite(n) && n >= 1) max = Math.min(500, Math.floor(n));
  }
  if (max < min) [min, max] = [max, min];
  return randInt(min, max);
}

export function shouldRunNutScroll(headless: boolean): boolean {
  if (headless) return false;
  const v = process.env.USE_SYSTEM_SCROLL?.trim().toLowerCase();
  if (v === "false" || v === "0" || v === "no") return false;
  return true;
}

/**
 * Плавно вести курсор в центр окна контента, затем повторить циклы «прокрутка + пауза».
 */
export async function runHumanScrollDownPhase(page: Page): Promise<void> {
  mouse.config.autoDelayMs = 0;
  const cycles = resolveScrollCycleCount();

  const { x, y } = await viewportCenterScreenPx(page);
  const target = new Point(x, y);
  mouse.config.mouseSpeed = randFloat(380, 920);
  await mouse.move(straightTo(target));
  await sleep(randFloat(120, 450));

  for (let c = 0; c < cycles; c++) {
    await smoothScrollBurst();

    if (Math.random() < 0.07) {
      await sleep(Math.max(2, randFloat(40, 120) / SCROLL_SPEEDUP));
      await mouse.scrollUp(randInt(1, 4));
      await sleep(Math.max(2, randFloat(60, 160) / SCROLL_SPEEDUP));
    }

    await sleep(randFloat(1000, 2000));
  }

  await sleep(randFloat(80, 320));
}
