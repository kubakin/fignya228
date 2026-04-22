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
import path from "path";
import fs from "fs";
function fileExists(p: string): boolean {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

export function getChromeExecutablePath(): string {
  const platform = process.platform;

  const candidates: string[] = [];

  if (platform === "darwin") {
    candidates.push(
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium"
    );
  }

  if (platform === "win32") {
    const programFiles = process.env["PROGRAMFILES"] || "C:\\Program Files";
    const programFilesx86 = process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)";
    const localAppData = process.env["LOCALAPPDATA"];

    candidates.push(
      path.join(programFiles, "Google/Chrome/Application/chrome.exe"),
      path.join(programFilesx86, "Google/Chrome/Application/chrome.exe"),
      localAppData
        ? path.join(localAppData, "Google/Chrome/Application/chrome.exe")
        : ""
    );
  }

  if (platform === "linux") {
    candidates.push(
      "/usr/bin/google-chrome",
      "/usr/bin/google-chrome-stable",
      "/usr/bin/chromium",
      "/usr/bin/chromium-browser"
    );
  }

  for (const candidate of candidates) {
    if (candidate && fileExists(candidate)) {
      console.log(`[browser] using executablePath: ${candidate}`);
      return candidate;
    }
  }

  throw new Error(
    `Chrome executable not found. Tried:\n${candidates.filter(Boolean).join("\n")}`
  );
}
export type BrowserSession = {
  page: Page;
  close: () => Promise<void>;
};

function envTrim(name: string): string | undefined {
  const v = process.env[name]?.trim();
  return v === undefined || v === "" ? undefined : v;
}

function defaultChromeUserDataDir(): string | undefined {
  if (process.platform === "win32") {
    const local = process.env.LOCALAPPDATA?.trim();
    if (!local) return undefined;
    return `${local}\\Google\\Chrome\\User Data`;
  }
  if (process.platform === "darwin") {
    const home = process.env.HOME?.trim();
    if (!home) return undefined;
    return `${home}/Library/Application Support/Google/Chrome`;
  }
  const home = process.env.HOME?.trim();
  if (!home) return undefined;
  return `${home}/.config/google-chrome`;
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
  const executablePath = getChromeExecutablePath();

  console.log(`[browser] launch via executablePath: ${executablePath}`);

  const browser = await chromium.launch({
    headless: false,
    executablePath,
  });

  const context = await browser.newContext({
    viewport: null,
  });

  const page: Page = await context.newPage();

  await ensureWindowMaximized(page);

  return {
    page,
    close: async () => {
      await context.close();
      await browser.close();
    },
  };
}