/**
 * После скролла: ссылка (например a#video-title), которая пересекает viewport,
 * и клик через nut.js — не .first() в DOM, а первый реально «на экране».
 */

import { mouse, sleep, straightTo } from "@nut-tree-fork/nut-js";
import { Point } from "@nut-tree-fork/shared";
import type { Page } from "playwright";
import { nutHumanMoveAndClick } from "./nut-move-click.js";

const DEFAULT_SELECTOR = "a#video-title";

/** Выполняется в браузере: индекс первого НЕ-shorts элемента, пересекающего viewport. */
function evalFirstNonShortInViewportIndex(selector: string): number {
  const nodes = document.querySelectorAll(selector);
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i] as Element;
    const a = n as unknown as HTMLAnchorElement;
    const href =
      typeof a.href === "string" && a.href
        ? a.href
        : a.getAttribute("href") || "";
    if (href.toLowerCase().includes("/shorts/")) continue;

    const r = n.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const intersects =
      r.width > 0 &&
      r.height > 0 &&
      r.bottom > 0 &&
      r.right > 0 &&
      r.left < vw &&
      r.top < vh;
    if (intersects) return i;
  }
  return -1;
}

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

async function nutNudgeScrollDown(page: Page): Promise<void> {
  const { x, y } = await viewportCenterScreenPx(page);
  mouse.config.autoDelayMs = 0;
  await mouse.move(straightTo(new Point(x, y)));
  await sleep(120 + Math.random() * 260);
  const ticks = 8 + Math.floor(Math.random() * 16);
  for (let i = 0; i < ticks; i++) {
    await mouse.scrollDown(3 + Math.floor(Math.random() * 9));
    await sleep(4 + Math.random() * 12);
  }
  await sleep(350 + Math.random() * 900);
}

export async function nutClickVideoTitleLink(page: Page): Promise<void> {
  const sel =
    process.env.VIDEO_TITLE_SELECTOR?.trim() || DEFAULT_SELECTOR;

  const started = Date.now();
  const timeoutMs = 60_000;
  while (Date.now() - started < timeoutMs) {
    const idx = await page.evaluate(evalFirstNonShortInViewportIndex, sel);
    if (idx >= 0) {
      const link = page.locator(sel).nth(idx);
      await nutHumanMoveAndClick(link);
      return;
    }
    // Если в viewport только shorts — прокручиваем дальше.
    await nutNudgeScrollDown(page);
  }

  console.warn(
    `На экране не найден видимый НЕ-shorts «${sel}» за 60 с — клик пропущен.`
  );
}
