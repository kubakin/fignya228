/**
 * Режимы браузера:
 * - по умолчанию: встроенный Chromium Playwright;
 * - PLAYWRIGHT_CDP_URL — подключение к уже запущенному Chrome/Edge с remote debugging (куки, аккаунты);
 * - PLAYWRIGHT_USER_DATA_DIR — отдельная папка профиля Chromium/Chrome (сохранённые сессии между запусками).
 */

import { chromium, type Page } from "playwright";

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
    const page = await context.newPage();
    return {
      page,
      close: async () => {
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
    const page = await context.newPage();
    return {
      page,
      close: async () => {
        await context.close();
      },
    };
  }

  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  return {
    page,
    close: async () => {
      await browser.close();
    },
  };
}
