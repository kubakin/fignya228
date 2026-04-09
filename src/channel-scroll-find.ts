/**
 * YouTube: после поиска/загрузки результатов скроллить вниз и искать ссылку канала по href.
 * Если не найдено за 10–20 секунд — открыть href в адресной строке «как вставкой» и Enter
 * (в headless: page.goto()).
 */

import { keyboard, mouse, sleep, straightTo } from "@nut-tree-fork/nut-js";
import { Point } from "@nut-tree-fork/shared";
import type { Locator, Page } from "playwright";
import { randFloat } from "./mouse-path.js";
import { nutHumanMoveAndClick } from "./nut-move-click.js";
import { Key } from "@nut-tree-fork/shared";

function envMs(name: string, fallback: number): number {
  const v = Number(process.env[name]?.trim());
  return Number.isFinite(v) && v >= 0 ? v : fallback;
}

function resolveDeadlineMs(): number {
  const min = envMs("CHANNEL_FIND_TIMEOUT_MS_MIN", 10_000);
  const max = envMs("CHANNEL_FIND_TIMEOUT_MS_MAX", 20_000);
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  return Math.round(randFloat(lo, hi));
}

function normalizeTargetHref(raw: string): string {
  const t = raw.trim();
  if (!t) return t;
  // Часто хотят /@name или /channel/... — оставляем как есть.
  return t;
}

type Found = { selector: string; idx: number } | null;

async function findChannelLink(page: Page, targetHref: string): Promise<Found> {
  const target = normalizeTargetHref(targetHref);
  const selectors = [
    "a.ytd-channel-renderer",
    "ytd-channel-renderer a#main-link",
    "a.ytd-channel-renderer[href]",
  ];

  for (const sel of selectors) {
    const idx = await page.evaluate(
      ({ selector, t }: { selector: string; t: string }) => {
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
          if (href === t) return i;
          if (href.includes(t)) return i;
          if (t.includes(href)) return i;
        }
        return -1;
      },
      { selector: sel, t: target }
    );
    if (idx >= 0) return { selector: sel, idx };
  }
  return null;
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

function stage2MouseSpeedMultiplier(): number {
  if ((process.env.STAGE ?? "").trim().toLowerCase() !== "stage2") return 1;
  const raw = process.env.STAGE2_MOUSE_SPEED_MULTIPLIER?.trim();
  const n = raw ? Number(raw) : NaN;
  if (Number.isFinite(n) && n > 0) return Math.min(n, 3);
  return 0.55;
}

async function humanScrollStep(page: Page): Promise<void> {
  // Вести курсор к центру контента (чтобы колесо скроллило нужную область)
  const { x, y } = await viewportCenterScreenPx(page);
  mouse.config.autoDelayMs = 0;
  mouse.config.mouseSpeed = randFloat(380, 920) * stage2MouseSpeedMultiplier();
  await mouse.move(straightTo(new Point(x, y)));
  await sleep(randFloat(120, 380));

  const ticks = Math.floor(randFloat(10, 30));
  for (let i = 0; i < ticks; i++) {
    await mouse.scrollDown(Math.floor(randFloat(3, 12)));
    await sleep(Math.max(0.2, randFloat(16, 52) / 20));
  }
  await sleep(randFloat(650, 1350));
}

async function fallbackNavigateByHref(
  page: Page,
  targetHref: string
): Promise<void> {
  const href = normalizeTargetHref(targetHref);
  if (!href) return;

  // headed: адресная строка (Ctrl/Cmd+L), «как вставкой», Enter
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

export async function scrollFindChannelHrefOrFallbackSearch(opts: {
  page: Page;
  input: Locator;
  targetHref: string;
  useNutKeyboard: boolean;
  typoRatio: number;
}): Promise<"clicked" | "fallback-navigated"> {
  // Этот этап требуется «как пользователь» (системный скролл/клики).
  if ((process.env.HEADLESS ?? "").trim().toLowerCase() === "true") {
    throw new Error("stage2: headless не поддерживается (нужен системный скролл/клики nut.js).");
  }
  const deadlineMs = resolveDeadlineMs();
  const startedAt = Date.now();

  while (Date.now() - startedAt < deadlineMs) {
    const found = await findChannelLink(opts.page, opts.targetHref);
    if (found) {
      const link = opts.page.locator(found.selector).nth(found.idx);
      await link.scrollIntoViewIfNeeded();
      await nutHumanMoveAndClick(link);
      return "clicked";
    }

    await humanScrollStep(opts.page);
  }

  await fallbackNavigateByHref(opts.page, opts.targetHref);
  return "fallback-navigated";
}

