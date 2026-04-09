/**
 * stage2: на странице канала кликнуть вкладку «Видео», затем скроллить и найти видео по href.
 * Всё взаимодействие (скролл, клики, адресная строка) — через nut.js.
 */

import { keyboard, mouse, sleep, straightTo } from "@nut-tree-fork/nut-js";
import { Key, Point } from "@nut-tree-fork/shared";
import type { Page } from "playwright";
import { randFloat } from "./mouse-path.js";
import { nutHumanMoveAndClick } from "./nut-move-click.js";

function envMs(name: string, fallback: number): number {
  const v = Number(process.env[name]?.trim());
  return Number.isFinite(v) && v >= 0 ? v : fallback;
}

function resolveDeadlineMs(): number {
  const min = envMs("VIDEO_FIND_TIMEOUT_MS_MIN", 15_000);
  const max = envMs("VIDEO_FIND_TIMEOUT_MS_MAX", 20_000);
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  return Math.round(randFloat(lo, hi));
}

function stage2MouseSpeedMultiplier(): number {
  const rawStage = (process.env.STAGE ?? "").trim().toLowerCase();
  if (rawStage !== "stage2") return 1;
  const raw = process.env.STAGE2_MOUSE_SPEED_MULTIPLIER?.trim();
  const n = raw ? Number(raw) : NaN;
  if (Number.isFinite(n) && n > 0) return Math.min(n, 3);
  return 0.55;
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

async function humanScrollStep(page: Page): Promise<void> {
  const { x, y } = await viewportCenterScreenPx(page);
  mouse.config.autoDelayMs = 0;
  mouse.config.mouseSpeed = randFloat(360, 900) * stage2MouseSpeedMultiplier();
  await mouse.move(straightTo(new Point(x, y)));
  await sleep(randFloat(120, 420));

  const ticks = Math.floor(randFloat(10, 28));
  for (let i = 0; i < ticks; i++) {
    await mouse.scrollDown(Math.floor(randFloat(3, 12)));
    await sleep(Math.max(0.2, randFloat(16, 52) / 20));
  }
  await sleep(randFloat(650, 1400));
}

async function atBottom(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const el = document.scrollingElement || document.documentElement;
    const bottomGap = el.scrollHeight - (el.scrollTop + window.innerHeight);
    return bottomGap < 8;
  });
}

async function clickVideosTab(page: Page): Promise<boolean> {
  const sel = "div.ytTabShapeTab";

  try {
    await page.waitForSelector(sel, { timeout: 30_000 });
  } catch {
    return false;
  }

  const idx = await page.evaluate(
    ({ selector }: { selector: string }) => {
      const nodes = document.querySelectorAll(selector);
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      for (let i = 0; i < nodes.length; i++) {
        const el = nodes[i] as HTMLElement;
        const t = (el.innerText || el.textContent || "").trim().toLowerCase();
        if (!t) continue;
        if (!(t === "видео" || t === "videos")) continue;
        const r = el.getBoundingClientRect();
        const intersects =
          r.width > 0 &&
          r.height > 0 &&
          r.bottom > 0 &&
          r.right > 0 &&
          r.left < vw &&
          r.top < vh;
        if (!intersects) continue;
        return i;
      }
      return -1;
    },
    { selector: sel }
  );

  if (idx < 0) return false;
  const tab = page.locator(sel).nth(idx);
  await tab.scrollIntoViewIfNeeded();
  await nutHumanMoveAndClick(tab);
  return true;
}

async function findVisibleVideoLinkIndex(page: Page, targetHref: string): Promise<{ selector: string; idx: number } | null> {
  const t = targetHref.trim();
  if (!t) return null;
  const selectors = [
    "a#video-title",
    "ytd-thumbnail a#thumbnail",
    "a[href][id='video-title']",
    "a[href*='watch']",
  ];

  for (const sel of selectors) {
    const idx = await page.evaluate(
      ({ selector, tHref }: { selector: string; tHref: string }) => {
        const nodes = document.querySelectorAll(selector);
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        for (let i = 0; i < nodes.length; i++) {
          const n = nodes[i] as Element;
          const a = n as unknown as HTMLAnchorElement;
          const r = n.getBoundingClientRect();
          const intersects =
            r.width > 0 &&
            r.height > 0 &&
            r.bottom > 0 &&
            r.right > 0 &&
            r.left < vw &&
            r.top < vh;
          if (!intersects) continue;
          const href =
            typeof a.href === "string" && a.href
              ? a.href
              : a.getAttribute("href") || "";
          if (!href) continue;
          if (href === tHref) return i;
          if (href.includes(tHref)) return i;
          if (tHref.includes(href)) return i;
        }
        return -1;
      },
      { selector: sel, tHref: t }
    );
    if (idx >= 0) return { selector: sel, idx };
  }
  return null;
}

async function fallbackNavigateByAddressBar(targetHref: string): Promise<void> {
  const href = targetHref.trim();
  if (!href) return;

  keyboard.config.autoDelayMs = 0;
  await sleep(randFloat(180, 420));
  if (process.platform === "darwin") {
    await keyboard.type(Key.LeftSuper, Key.L);
  } else {
    await keyboard.type(Key.LeftControl, Key.L);
  }
  await sleep(randFloat(120, 260));
  await keyboard.type(href);
  await sleep(randFloat(120, 260));
  await keyboard.type(Key.Enter);
  await sleep(randFloat(250, 650));
}

export async function stage2ClickVideosAndOpenVideoByHref(page: Page, targetVideoHref: string): Promise<"clicked" | "fallback-navigated"> {
  if ((process.env.HEADLESS ?? "").trim().toLowerCase() === "true") {
    throw new Error("stage2: headless не поддерживается (нужны системные скролл/клики nut.js).");
  }

  const tabClicked = await clickVideosTab(page);
  if (tabClicked) {
    await page.waitForLoadState("domcontentloaded", { timeout: 60_000 }).catch(() => {});
  }
  await sleep(randFloat(1000, 2000));

  const deadlineMs = resolveDeadlineMs();
  const startedAt = Date.now();
  let noProgress = 0;
  let lastTop = await page.evaluate(() => (document.scrollingElement || document.documentElement).scrollTop);

  while (Date.now() - startedAt < deadlineMs) {
    const found = await findVisibleVideoLinkIndex(page, targetVideoHref);
    if (found) {
      const link = page.locator(found.selector).nth(found.idx);
      await link.scrollIntoViewIfNeeded();
      // Кликаем по yt-formatted-string (текст заголовка), если он есть.
      const title = link.locator("yt-formatted-string").first();
      try {
        await title.waitFor({ state: "visible", timeout: 1200 });
        await nutHumanMoveAndClick(title);
      } catch {
        await nutHumanMoveAndClick(link);
      }
      return "clicked";
    }

    if (await atBottom(page)) break;

    await humanScrollStep(page);
    const top = await page.evaluate(() => (document.scrollingElement || document.documentElement).scrollTop);
    if (Math.abs(top - lastTop) < 2) noProgress++;
    else noProgress = 0;
    lastTop = top;
    if (noProgress >= 4) break;
  }

  await fallbackNavigateByAddressBar(targetVideoHref);
  return "fallback-navigated";
}

