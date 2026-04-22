/**
 * Режимы браузера:
 * - по умолчанию: встроенный Chromium Playwright;
 * - PLAYWRIGHT_CDP_URL — подключение к уже запущенному Chrome/Edge с remote debugging (куки, аккаунты);
 * - PLAYWRIGHT_USER_DATA_DIR — отдельная папка профиля Chromium/Chrome (сохранённые сессии между запусками).
 */

import { chromium, type Page } from "playwright";
import { keyboard, sleep } from "@nut-tree-fork/nut-js";
import { Key } from "@nut-tree-fork/shared";
import { nutHumanMoveAndClickScreenPoint } from "./nut-move-click.js";

export type BrowserSession = {
  page: Page;
  close: () => Promise<void>;
};

function envTrim(name: string): string | undefined {
  const v = process.env[name]?.trim();
  return v === undefined || v === "" ? undefined : v;
}

async function closeChromeServiceTabs(page: Page): Promise<void> {
  const url = page.url().toLowerCase();
  const isService =
    url.startsWith("chrome://") ||
    url.startsWith("edge://") ||
    url.includes("whats-new") ||
    url.includes("/chrome/") ||
    url.includes("settings/help");
  if (!isService) return;
  try {
    await page.close({ runBeforeUnload: false });
  } catch {
    // ignore
  }
}

async function closeExtraPagesKeepFirst(context: { pages(): Page[] }): Promise<Page> {
  const pages = context.pages();
  let main = pages[0];
  if (!main) {
    throw new Error("No pages available to keep as main tab");
  }
  for (let i = 1; i < pages.length; i++) {
    try {
      await pages[i]!.close({ runBeforeUnload: false });
    } catch {
      // ignore
    }
  }
  return main;
}

async function closeAllPages(context: { pages(): Page[] }): Promise<void> {
  const pages = context.pages();
  for (const p of pages) {
    try {
      await p.close({ runBeforeUnload: false });
    } catch {
      // ignore
    }
  }
}

async function isWindowMaximized(page: Page): Promise<boolean> {
  return page.evaluate(function () {
    const dw = Math.abs(window.outerWidth - screen.availWidth);
    const dh = Math.abs(window.outerHeight - screen.availHeight);
    return dw <= 16 && dh <= 16;
  });
}

async function resolveWindowsMaximizeButtonPoint(
  page: Page
): Promise<{ x: number; y: number } | null> {
  return page.evaluate(function () {
    if (typeof window.screenX !== "number" || typeof window.screenY !== "number") {
      return null;
    }
    // Typical Windows caption buttons are on top-right:
    // [minimize][maximize][close], each ~46px wide on 100% scale.
    const closeBtnWidth = 46;
    const x = Math.round(window.screenX + window.outerWidth - closeBtnWidth * 1.5);
    const y = Math.round(window.screenY + 14);
    return { x, y };
  });
}

async function ensureWindowMaximized(page: Page): Promise<void> {
  if (await isWindowMaximized(page)) return;
  keyboard.config.autoDelayMs = 0;

  for (let attempt = 1; attempt <= 3; attempt++) {
    await page.bringToFront().catch(() => {});
    await sleep(220);

    if (process.platform === "win32") {
      const p = await resolveWindowsMaximizeButtonPoint(page);
      if (p) {
        console.log(`[browser] maximize attempt ${attempt}: click caption maximize button`);
        await nutHumanMoveAndClickScreenPoint(p.x, p.y);
        await sleep(850);
        if (await isWindowMaximized(page)) return;
      }

      console.log(`[browser] maximize attempt ${attempt}: Alt+Space then X`);
      await keyboard.type(Key.LeftAlt, Key.Space);
      await sleep(180);
      await keyboard.type("x");
      await sleep(750);
      if (await isWindowMaximized(page)) return;

      console.log(`[browser] maximize attempt ${attempt}: Win+Up`);
      await keyboard.type(Key.LeftSuper, Key.Up);
      await sleep(650);
      if (await isWindowMaximized(page)) return;
      continue;
    }

    // Non-Windows fallback.
    await keyboard.type(Key.F11);
    await sleep(700);
    if (await isWindowMaximized(page)) return;
  }

  console.warn("[browser] failed to maximize window after retries");
}

/**
 * Открывает страницу: либо новая вкладка в подключённом/постоянном контексте (общие cookie с профилем).
 */
export async function createBrowserSession(): Promise<BrowserSession> {
  const cdpUrl = envTrim("PLAYWRIGHT_CDP_URL");
  if (cdpUrl) {
    console.log(`[browser] connectOverCDP ${cdpUrl}`);
    const browser = await chromium.connectOverCDP(cdpUrl);
    const context = browser.contexts()[0];
    if (!context) {
      throw new Error(
        "CDP: у браузера нет контекста. Запустите Chrome с --remote-debugging-port=..."
      );
    }
    const existing = context.pages();
    for (const p of existing) {
      await closeChromeServiceTabs(p);
    }
    let page: Page;
    if (context.pages().length === 0) {
      page = await context.newPage();
    } else {
      page = await closeExtraPagesKeepFirst(context);
    }
    await ensureWindowMaximized(page);
    return {
      page,
      close: async () => {
        await closeAllPages(context);
        await browser.close();
      },
    };
  }

  const userDataDir = envTrim("PLAYWRIGHT_USER_DATA_DIR");
  if (userDataDir) {
    const ch = envTrim("PLAYWRIGHT_BROWSER_CHANNEL");
    const channel =
      ch === "chrome" || ch === "msedge" || ch === "chromium" ? ch : undefined;
    const label = channel ?? "bundled-chromium";
    console.log(`[browser] launchPersistentContext dir=${userDataDir} channel=${label}`);
    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      ...(channel !== undefined ? { channel } : {}),
      viewport: null,
    });
    const page = context.pages()[0] ?? (await context.newPage());
    if (context.pages().length > 1) {
      await closeExtraPagesKeepFirst(context);
    }
    await ensureWindowMaximized(page);
    return {
      page,
      close: async () => {
        await context.close();
      },
    };
  }

  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  await ensureWindowMaximized(page);
  return {
    page,
    close: async () => {
      await browser.close();
    },
  };
}
