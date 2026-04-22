/**
 * Поведение упакованного .exe (pkg): установка браузера Playwright, лог ошибок рядом с exe.
 */

import { spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

type ProcessWithPkg = NodeJS.Process & { pkg?: { entrypoint?: string } };

export function isPackagedExe(): boolean {
  return typeof (process as ProcessWithPkg).pkg !== "undefined";
}

/**
 * Путь «как у текущего модуля»: в .exe (pkg) — process.execPath; при `node bundle.cjs` — argv[1];
 * при tsx — argv[1] или import.meta.url. В CJS-бандле esbuild import.meta.url пустой.
 */
function getAppEntryPathForRequire(): string {
  if (isPackagedExe()) return process.execPath;
  const a = process.argv[1];
  if (a) return a;
  try {
    const u = import.meta.url;
    if (typeof u === "string" && u.length > 0) return fileURLToPath(u);
  } catch {
    /* пустой import.meta в одномфайловом CJS-бандле */
  }
  return join(process.cwd(), "package.json");
}

const require = createRequire(getAppEntryPathForRequire());

/** Каталог, где лежит .exe (pkg) или текущая рабочая директория при `node` / `tsx`. */
export function directoryForLogsAndDeps(): string {
  if (isPackagedExe()) {
    return dirname(process.execPath);
  }
  return process.cwd();
}

export function errorLogFilePath(): string {
  return join(directoryForLogsAndDeps(), "yt-worker-errors.txt");
}

function formatErrorBlock(err: unknown): string {
  const lines: string[] = [];
  lines.push(`=== ${new Date().toISOString()} ===`);
  if (err instanceof Error) {
    lines.push(`${err.name}: ${err.message}`);
    if (err.stack) lines.push(err.stack);
  } else {
    lines.push(String(err));
  }
  lines.push("");
  return lines.join("\n");
}

export function appendErrorLog(err: unknown): void {
  try {
    appendFileSync(errorLogFilePath(), formatErrorBlock(err), "utf8");
  } catch (writeErr) {
    console.error("Не удалось записать yt-worker-errors.txt:", writeErr);
  }
}

export function setupGlobalErrorLogging(): void {
  process.on("uncaughtException", (error: Error) => {
    appendErrorLog(error);
    console.error(error);
    process.exit(1);
  });
  process.on("unhandledRejection", (reason: unknown) => {
    appendErrorLog(reason);
    console.error(reason);
    process.exit(1);
  });
}

function envSkipBrowserInstall(): boolean {
  const v = process.env.SKIP_PLAYWRIGHT_BROWSER_INSTALL?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

function usingExternalBrowserOnly(): boolean {
  const u = process.env.PLAYWRIGHT_CDP_URL?.trim();
  return u !== undefined && u.length > 0;
}

/**
 * При запуске из .exe: `playwright install chromium`, если не отключено и нужен встроенный Chromium.
 */
export function ensurePlaywrightBrowsersIfNeeded(): void {
  if (!isPackagedExe()) return;
  if (envSkipBrowserInstall()) {
    console.log("[exe] SKIP_PLAYWRIGHT_BROWSER_INSTALL — пропуск установки Chromium.");
    return;
  }
  if (usingExternalBrowserOnly()) {
    console.log(
      "[exe] PLAYWRIGHT_CDP_URL задан — установка Chromium Playwright не требуется."
    );
    return;
  }

  let cli: string;
  try {
    const pkgJson = require.resolve("playwright/package.json");
    cli = join(dirname(pkgJson), "cli.js");
  } catch (e) {
    appendErrorLog(e);
    throw new Error(
      "Не найден пакет playwright (cli). Пересоберите exe или установите зависимости."
    );
  }

  console.log("[exe] Установка Chromium для Playwright (первый запуск может занять время)…");
  const r = spawnSync(process.execPath, [cli, "install", "chromium"], {
    env: { ...process.env },
    encoding: "utf-8",
    maxBuffer: 50 * 1024 * 1024,
    windowsHide: true,
  });

  if (r.status !== 0) {
    const detail = [r.stderr, r.stdout].filter(Boolean).join("\n") || "(нет вывода)";
    const err = new Error(
      `playwright install chromium завершился с кодом ${r.status}:\n${detail}`
    );
    appendErrorLog(err);
    throw err;
  }
  console.log("[exe] Chromium для Playwright готов.");
}
