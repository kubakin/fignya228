/**
 * Открывает страницу, находит инпут по CSS-селектору: курсор плавно
 * подводится к полю, выполняется клик для фокуса, затем вводится текст.
 *
 * В режиме с окном по умолчанию двигается системный курсор ОС (реальный указатель
 * на экране), не только внутренний курсор Chromium. На macOS: «Настройки →
 * Конфиденциальность и безопасность → Универсальный доступ» — разрешить для
 * терминала/Cursor/Node. При смещении клика подстройте MOUSE_OFFSET_X/Y.
 *
 * Использование:
 *   npm run fill -- --url https://example.com --selector "#my-input"
 *   TARGET_URL=... INPUT_SELECTOR=... npm run fill
 *
 * Файл `.env` подхватывается из текущей рабочей директории (`process.cwd()`): рядом с exe положите `.env` и
 * запускайте из этой папки. Сборка Windows: `npm run build:exe` → `dist/yt-worker.exe` (лучше собирать на Windows;
 * после установки на ПК: `npx playwright install chromium`).
 * Упакованный .exe: при старте автоматически выполняется установка Chromium Playwright (если не задан
 *   PLAYWRIGHT_CDP_URL и не SKIP_PLAYWRIGHT_BROWSER_INSTALL). Ошибки дополнительно пишутся в
 *   yt-worker-errors.txt рядом с .exe (или в cwd при запуске через node/tsx).
 * Переменные окружения (если нет флагов):
 *   TARGET_URL, INPUT_SELECTOR
 * Опционально:
 *   Приложение работает только в режиме с окном (headed).
 *   Системная мышь nut.js используется всегда (обязательный режим).
 *   MOUSE_SPEED — базовая скорость системного курсора, px/сек (±20% на каждый запуск)
 *   MOUSE_OFFSET_X, MOUSE_OFFSET_Y — тонкая подстройка после автоучёта панелей браузера
 *   CLICK_VIEWPORT_TOP_SAFE_PX — зона «под хедером» (px сверху viewport); клик смещается ниже
 *   Системная клавиатура nut.js используется всегда.
 *   TYPO_MAX_PERCENT — доля опечаток (соседняя клавиша), по умолчанию 5 (то есть 5%);
 *     для nut-ввода системная раскладка клавиатуры должна совпадать с языком текста
 *   TYPING_DELAY_MULTIPLIER — множитель пауз между символами (например 1.5 или 2)
 *   Скролл колёсиком nut.js используется всегда.
 *   SCROLL_CYCLES_MIN, SCROLL_CYCLES_MAX — число циклов «прокрутка + пауза 1–2 с», по умолчанию 1–20
 *   после скролла — системный клик по a#video-title (nut.js); VIDEO_TITLE_SELECTOR — свой CSS при необходимости
 *   50/50: (1) частичный ввод + подсказка YouTube при ≥2 словах, без Enter → скролл;
 *     (2) полный ввод, подсказка после полного текста при ≥2 словах, Enter → скролл. YT_SUGGESTION_OPTION_SELECTOR
 *   POST_LOAD_MS_MIN, POST_LOAD_MS_MAX — пауза после загрузки страницы перед действиями (мс), по умолчанию 1000–3000
 *   TEXT — текст для ввода (по умолчанию: Hello world)
 *   Второй этап (вариант 1): после Enter скроллить и искать канал по href:
 *     CHANNEL_TARGET_NAME=SomeChannelName — текст, который вводится в поиск при STAGE=stage2;
 *     CHANNEL_TARGET_HREF=https://www.youtube.com/@SomeChannel (или /@SomeChannel) — включить режим;
 *     CHANNEL_FIND_TIMEOUT_MS_MIN, CHANNEL_FIND_TIMEOUT_MS_MAX — окно ожидания (мс), по умолчанию 10000–20000.
 *   Stage2 продолжение: на канале → вкладка «Видео» → поиск видео по href:
 *     VIDEO_TARGET_HREF=https://www.youtube.com/watch?v=... — какое видео открыть;
 *     VIDEO_FIND_TIMEOUT_MS_MIN, VIDEO_FIND_TIMEOUT_MS_MAX — окно ожидания (мс), по умолчанию 15000–20000;
 *     вкладка выбирается строго по тексту: «Видео» или «Videos».
 *   после клика по заголовку на watch (stage1): ожидание прогресса плеера VIDEO_END_MIN_RATIO–VIDEO_END_MAX_RATIO (по умолчанию 0.9–1.0);
 *   stage2: успех и отчёт completed после просмотра в доле STAGE2_VIDEO_END_MIN–MAX (или, если не заданы, VIDEO_END_MIN_RATIO–VIDEO_END_MAX_RATIO из config/.env; по умолчанию 0.8–1.0);
 *     затем в консоль: hello world; VIDEO_NEAR_END_TIMEOUT_MS — лимит ожидания (мс), 0 = без лимита;
 *     VIDEO_PROGRESS_INTERVAL_MS — интервал лога «прогресс» (мс), по умолчанию 2500, минимум 500
 *   Свой браузер / аккаунты:
 *     PLAYWRIGHT_CDP_URL=http://127.0.0.1:9222 — подключение к уже запущенному Chrome/Edge с remote debugging
 *       (запуск, например: chrome --remote-debugging-port=9222 --user-data-dir=…);
 *     PLAYWRIGHT_USER_DATA_DIR=путь — постоянный профиль (куки между запусками); опционально PLAYWRIGHT_BROWSER_CHANNEL=chrome|msedge|chromium
 */

import { keyboard, mouse, sleep, straightTo } from "@nut-tree-fork/nut-js";
import { Key, Point } from "@nut-tree-fork/shared";
import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import type { Locator, Page } from "playwright";
import {
  clearFocusedField,
  pressEnterAfterTyping,
  resolveTypoRatio,
  typeTextWithNut,
} from "./human-typing.js";
import { nutClickVideoTitleLink } from "./click-video-title.js";
import {
  getPartialTypingSplitForSuggestion,
  maybeClickRandomYtSuggestion,
} from "./yt-search-suggestion.js";
import {
  runHumanScrollDownPhase,
} from "./human-scroll.js";
import { randFloat } from "./mouse-path.js";
import {
  nutHumanMoveAndClick,
  nutHumanMoveAndClickScreenPoint,
} from "./nut-move-click.js";
import { waitForYoutubeVideoNearEndIfWatch } from "./wait-youtube-near-end.js";
import { createBrowserSession } from "./browser-session.js";
import { scrollFindChannelHrefOrFallbackSearch } from "./channel-scroll-find.js";
import { stage2ClickVideosAndOpenVideoByHref } from "./stage2-channel-videos.js";
import {
  appendErrorLog,
  ensurePlaywrightBrowsersIfNeeded,
  setupGlobalErrorLogging,
} from "./exe-runtime.js";

/** Рядом с рабочей директорией (для exe — папка, откуда запускают). */
loadEnv({ path: resolve(process.cwd(), ".env") });
setupGlobalErrorLogging();

type ParsedArgs = {
  text?: string;
};

function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--text" && argv[i + 1]) {
      out.text = argv[++i];
    }
  }
  return out;
}

function postLoadDelayMs(): number {
  const min = Number(process.env.POST_LOAD_MS_MIN ?? 1000);
  const max = Number(process.env.POST_LOAD_MS_MAX ?? 3000);
  if (!Number.isFinite(min) || !Number.isFinite(max)) return randFloat(1000, 3000);
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  return randFloat(lo, hi);
}

async function moveCursorAndClickToFocus(
  _page: Page,
  locator: Locator
): Promise<void> {
  await nutHumanMoveAndClick(locator);
}

type TeamTaskStatus = "prepare" | "process" | "completed";

async function reportTeamTaskStatus(
  taskId: string | undefined,
  status: TeamTaskStatus
): Promise<void> {
  if (!taskId || taskId.trim().length === 0) return;
  console.log(`[team-report] reportTeamTaskStatus: ${taskId} ${status}!`);
  const reportUrl =
    process.env.TARGET_URL?.trim() || "http://localhost:3000/team/task";
  try {
    const resp = await fetch(reportUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        taskId: taskId.trim(),
        status,
      }),
    });
    if (!resp.ok) {
      console.warn(
        `[team-report] POST failed status=${resp.status} taskId=${taskId} status=${status}`
      );
    }
  } catch (e) {
    console.warn(
      `[team-report] POST error taskId=${taskId} status=${status}`,
      e
    );
  }
}

type SidebarPick = { selector: string; idx: number } | null;
type Stage2Strategy =
  | "channelSearchStrategy"
  | "webChannelSearchStrategy"
  | "webVideoSearchStrategy"
  | "directLinkStrategy"
  | "vkStrategy"
  | "landingStrategy";

/** Stage2 «досмотр»: STAGE2_VIDEO_END_MIN_RATIO или короткий алиас STAGE2_VIDEO_END_MIN, затем VIDEO_END_MIN_RATIO. */
function resolveStage2VideoEndRatios(): { min: number; max: number } {
  const minStr =
    process.env.STAGE2_VIDEO_END_MIN_RATIO?.trim() ||
    process.env.STAGE2_VIDEO_END_MIN?.trim() ||
    process.env.VIDEO_END_MIN_RATIO?.trim() ||
    "";
  const maxStr =
    process.env.STAGE2_VIDEO_END_MAX_RATIO?.trim() ||
    process.env.STAGE2_VIDEO_END_MAX?.trim() ||
    process.env.VIDEO_END_MAX_RATIO?.trim() ||
    "";
  const minN = minStr !== "" ? Number(minStr) : NaN;
  const maxN = maxStr !== "" ? Number(maxStr) : NaN;
  return {
    min: Number.isFinite(minN) ? minN : 0.8,
    max: Number.isFinite(maxN) ? maxN : 1.0,
  };
}

async function pickRandomVisibleSidebarVideo(page: Page): Promise<SidebarPick> {
  const selectors = [
    "a.ytLockupMetadataViewModelTitle",
    "ytd-compact-video-renderer a#video-title",
    "ytd-watch-next-secondary-results-renderer a#video-title",
  ];

  for (const sel of selectors) {
    const idx = await page.evaluate(
      ({ selector }: { selector: string }) => {
        const nodes = document.querySelectorAll(selector);
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const visible: number[] = [];
        for (let i = 0; i < nodes.length; i++) {
          const r = (nodes[i] as Element).getBoundingClientRect();
          const intersects =
            r.width > 0 &&
            r.height > 0 &&
            r.bottom > 0 &&
            r.right > 0 &&
            r.left < vw &&
            r.top < vh;
          if (intersects) visible.push(i);
        }
        if (visible.length === 0) return -1;
        return visible[Math.floor(Math.random() * visible.length)]!;
      },
      { selector: sel }
    );
    if (idx >= 0) return { selector: sel, idx };
  }
  return null;
}

function parseProb(name: string, fallback: number): number {
  const n = Number(process.env[name]?.trim());
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, n);
}

function pickWeightedStrategy(
  candidates: Array<{ strategy: Stage2Strategy; weight: number }>
): Stage2Strategy {
  const sanitized = candidates
    .map((x) => ({ ...x, weight: Number.isFinite(x.weight) ? Math.max(0, x.weight) : 0 }))
    .filter((x) => x.weight > 0);
  if (sanitized.length === 0) return "directLinkStrategy";
  const sum = sanitized.reduce((acc, x) => acc + x.weight, 0);
  let r = Math.random() * sum;
  for (const x of sanitized) {
    r -= x.weight;
    if (r <= 0) return x.strategy;
  }
  return sanitized[sanitized.length - 1]!.strategy;
}

function resolveStage2Strategy(opts: {
  stage2Name?: string;
  channelTargetHref?: string;
  videoTargetHref?: string;
  videoTargetName?: string;
  vkGroupUrl?: string;
  landingUrl?: string;
}): Stage2Strategy {
  return 'landingStrategy';
  const candidates: Array<{ strategy: Stage2Strategy; weight: number }> = [];
  const s1 = parseProb("STAGE2_STRATEGY_CHANNEL_SEARCH_PROB", parseProb("STAGE2_VARIANT1_PROB", 0.0));
  const s2 = parseProb("STAGE2_STRATEGY_WEB_CHANNEL_PROB", parseProb("STAGE2_VARIANT2_PROB", 0.30));
  const s3 = parseProb("STAGE2_STRATEGY_WEB_VIDEO_PROB", parseProb("STAGE2_VARIANT3_PROB", 0.70));
  const s4 = parseProb("STAGE2_STRATEGY_DIRECT_LINK_PROB", 0.10);
  const s5 = parseProb("STAGE2_STRATEGY_VK_PROB", 0.10);
  const s6 = parseProb("STAGE2_STRATEGY_LANDING_PROB", 0.10);
  if (opts.channelTargetHref && opts.videoTargetHref) candidates.push({ strategy: "channelSearchStrategy", weight: s1 });
  if (opts.stage2Name && opts.videoTargetHref) candidates.push({ strategy: "webChannelSearchStrategy", weight: s2 });
  if (opts.videoTargetName || opts.videoTargetHref) candidates.push({ strategy: "webVideoSearchStrategy", weight: s3 });
  if (opts.videoTargetHref || opts.channelTargetHref) candidates.push({ strategy: "directLinkStrategy", weight: s4 });
  if (opts.vkGroupUrl && opts.videoTargetHref) candidates.push({ strategy: "vkStrategy", weight: s5 });
  if (opts.landingUrl && opts.videoTargetHref) candidates.push({ strategy: "landingStrategy", weight: s6 });
  console.log(
    `[stage2] strategy weights channel=${s1} webChannel=${s2} webVideo=${s3} direct=${s4} vk=${s5} landing=${s6}; inputs channelName=${Boolean(
      opts.stage2Name
    )} channelHref=${Boolean(opts.channelTargetHref)} videoHref=${Boolean(
      opts.videoTargetHref
    )} videoName=${Boolean(opts.videoTargetName)} vkGroup=${Boolean(opts.vkGroupUrl)} landingUrl=${Boolean(
      opts.landingUrl
    )}`
  );
  return pickWeightedStrategy(candidates);
}

function shouldSkipStage1ByChance(baseRunStage1: boolean): boolean {
  if (!baseRunStage1) return false;
  const p = Math.min(1, parseProb("STAGE1_SKIP_PROB", 0));
  return Math.random() < p;
}

async function nutSearchFromAddressBar(query: string): Promise<void> {
  const q = query.trim();
  if (!q) return;
  keyboard.config.autoDelayMs = 0;
  await sleep(randFloat(160, 360));
  if (process.platform === "darwin") await keyboard.type(Key.LeftSuper, Key.L);
  else await keyboard.type(Key.LeftControl, Key.L);
  await sleep(randFloat(100, 220));
  await keyboard.type(q);
  await sleep(randFloat(120, 260));
  await keyboard.type(Key.Enter);
  await sleep(randFloat(1200, 2400));
}

function stage2TimeoutMs(): number {
  const n = Number(
    process.env.STAGE2_STRATEGY_TIMEOUT_MS ??
      process.env.STAGE2_VARIANT_TIMEOUT_MS ??
      300_000
  );
  if (!Number.isFinite(n)) return 300_000;
  const ms = Math.floor(n);
  if (ms < 10_000) return 10_000;
  // Hard cap: if strategy hangs, force fallback to direct URL after <= 5 minutes.
  return Math.min(ms, 300_000);
}

async function hasCaptchaOrVerification(page: Page): Promise<boolean> {
  try {
    const url = page.url().toLowerCase();
    if (
      url.includes("captcha") ||
      url.includes("sorry") ||
      url.includes("consent.youtube.com")
    ) {
      return true;
    }
    const bodyText = await page.evaluate(() => (document.body?.innerText || "").toLowerCase());
    return (
      bodyText.includes("captcha") ||
      bodyText.includes("verify you are human") ||
      bodyText.includes("подтвердите") ||
      bodyText.includes("я не робот")
    );
  } catch {
    return false;
  }
}

async function stage2DirectLinkStrategy(opts: {
  page: Page;
  channelTargetHref?: string;
  videoTargetHref?: string;
}): Promise<void> {
  const directHref = (opts.videoTargetHref?.trim() || opts.channelTargetHref?.trim() || "");
  if (!directHref) {
    throw new Error("stage2 directLinkStrategy: no direct link available (VIDEO_TARGET_HREF/CHANNEL_TARGET_HREF).");
  }
  console.log(`[stage2] directLinkStrategy navigate: ${directHref}`);
  await nutSearchFromAddressBar(directHref);
  await opts.page.waitForLoadState("domcontentloaded", { timeout: 60_000 }).catch(() => {});
  await ensureVideoPlayingIfPaused(opts.page);
}

async function dismissModalboxIfVisible(page: Page): Promise<boolean> {
  const point = await page.evaluate(function () {
    const modal = document.querySelector('[data-testid="modalbox"]') as HTMLElement | null;
    if (!modal) return null;
    const style = window.getComputedStyle(modal);
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      Number(style.opacity || "1") < 0.05
    ) {
      return null;
    }

    const r = modal.getBoundingClientRect();
    if (r.width < 20 || r.height < 20) return null;
    if (
      r.bottom <= 0 ||
      r.top >= window.innerHeight ||
      r.right <= 0 ||
      r.left >= window.innerWidth
    ) {
      return null;
    }

    const chromeTop = window.outerHeight - window.innerHeight;
    const chromeLeft = window.outerWidth - window.innerWidth;
    const cx = Math.min(window.innerWidth - 8, Math.max(8, r.left + r.width / 2));
    const offset = 18 + Math.floor(Math.random() * (54 - 18 + 1));
    const cy = Math.min(window.innerHeight - 8, Math.max(8, r.top - offset));
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

async function stage2VkStrategy(opts: {
  page: Page;
  vkGroupUrl: string;
  videoTargetHref: string;
}): Promise<void> {
  console.log("[stage2][vkStrategy] start", {
    vkGroupUrl: opts.vkGroupUrl,
    videoTargetHref: opts.videoTargetHref,
  });
  await nutSearchFromAddressBar(opts.vkGroupUrl);
  await opts.page.waitForLoadState("domcontentloaded", { timeout: 60_000 }).catch(() => {});
  await sleep(randFloat(1000, 2200));

  console.log("[stage2][vkStrategy] initial human scroll");
  await runHumanScrollDownPhase(opts.page);
  const hoverPoints = await opts.page.evaluate(function () {
    const els = document.querySelectorAll("a, button, div, img, span");
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const chromeTop = window.outerHeight - window.innerHeight;
    const chromeLeft = window.outerWidth - window.innerWidth;
    const points: Array<{ x: number; y: number }> = [];
    for (let i = 0; i < els.length && points.length < 4; i++) {
      const e = els[i] as Element;
      const r = e.getBoundingClientRect();
      const intersects =
        r.width > 10 &&
        r.height > 10 &&
        r.bottom > 0 &&
        r.right > 0 &&
        r.left < vw &&
        r.top < vh;
      if (!intersects) continue;
      points.push({
        x: Math.round(window.screenX + chromeLeft / 2 + r.left + r.width / 2),
        y: Math.round(window.screenY + chromeTop + r.top + r.height / 2),
      });
    }
    return points;
  });
  console.log("[stage2][vkStrategy] hover points prepared", { count: hoverPoints.length });
  for (const p of hoverPoints) {
    mouse.config.autoDelayMs = 0;
    mouse.config.mouseSpeed = randFloat(340, 860);
    await mouse.move(straightTo(new Point(p.x, p.y)));
    await sleep(randFloat(250, 700));
  }
  console.log("[stage2][vkStrategy] hover simulation done");

  const linkInfo = await opts.page.evaluate(function ({ youtubeHref }: { youtubeHref: string }) {
    const links = document.querySelectorAll("a[href]");
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const absHrefRe = /^https?:\/\//i;
    for (let j = 0; j < links.length; j++) {
      (links[j] as HTMLAnchorElement).removeAttribute("data-yt-worker-patched");
    }
    for (let i = 0; i < links.length; i++) {
      const a = links[i] as HTMLAnchorElement;
      const classMatches = Array.from(a.classList).some((cls) => cls.startsWith("vkitLink__link"));
      if (!classMatches) continue;
      const rawHref = (a.getAttribute("href") || "").trim();
      if (!absHrefRe.test(rawHref)) continue;
      const r = a.getBoundingClientRect();
      const intersects =
        r.width > 8 &&
        r.height > 8 &&
        r.bottom > 0 &&
        r.right > 0 &&
        r.left < vw &&
        r.top < vh;
      if (!intersects) continue;
      const beforeHref = a.getAttribute("href") || a.href || "";
      a.setAttribute("href", youtubeHref);
      a.setAttribute("target", "_self");
      a.removeAttribute("onclick");
      a.setAttribute("rel", "noopener");
      a.setAttribute("data-yt-worker-patched", "1");
      const afterHref = a.getAttribute("href") || a.href || "";
      return { i, beforeHref, afterHref };
    }
    return null;
  }, { youtubeHref: opts.videoTargetHref });
  console.log("[stage2][vkStrategy] link patch result", linkInfo);
  if (!linkInfo) {
    throw new Error("stage2 vkStrategy: no visible link found to patch href");
  }
  const link = opts.page.locator("a[data-yt-worker-patched='1']").first();
  await link.scrollIntoViewIfNeeded();
  const modalDismissed = await dismissModalboxIfVisible(opts.page);
  if (modalDismissed) {
    console.log("[stage2][vkStrategy] modalbox dismissed before link click");
  }
  console.log("[stage2][vkStrategy] clicking patched link");
  await nutHumanMoveAndClick(link);
  await opts.page.waitForLoadState("domcontentloaded", { timeout: 60_000 }).catch(() => {});
  console.log("[stage2][vkStrategy] reached target page, ensure playback");
  await ensureVideoPlayingIfPaused(opts.page);
  console.log("[stage2][vkStrategy] done");
}

async function stage2LandingStrategy(opts: {
  page: Page;
  landingUrl: string;
  videoTargetHref: string;
}): Promise<void> {
  console.log("[stage2][landingStrategy] start", {
    landingUrl: opts.landingUrl,
    videoTargetHref: opts.videoTargetHref,
  });
  await nutSearchFromAddressBar(opts.landingUrl);
  await opts.page.waitForLoadState("domcontentloaded", { timeout: 60_000 }).catch(() => {});
  await sleep(randFloat(1000, 2200));

  console.log("[stage2][landingStrategy] initial human scroll");
  await runHumanScrollDownPhase(opts.page);
  const hoverPoints = await opts.page.evaluate(function () {
    const els = document.querySelectorAll("a, button, div, img, span");
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const chromeTop = window.outerHeight - window.innerHeight;
    const chromeLeft = window.outerWidth - window.innerWidth;
    const points: Array<{ x: number; y: number }> = [];
    for (let i = 0; i < els.length && points.length < 5; i++) {
      const e = els[i] as Element;
      const r = e.getBoundingClientRect();
      const intersects =
        r.width > 10 &&
        r.height > 10 &&
        r.bottom > 0 &&
        r.right > 0 &&
        r.left < vw &&
        r.top < vh;
      if (!intersects) continue;
      points.push({
        x: Math.round(window.screenX + chromeLeft / 2 + r.left + r.width / 2),
        y: Math.round(window.screenY + chromeTop + r.top + r.height / 2),
      });
    }
    return points;
  });
  console.log("[stage2][landingStrategy] hover points prepared", { count: hoverPoints.length });
  for (const p of hoverPoints) {
    mouse.config.autoDelayMs = 0;
    mouse.config.mouseSpeed = randFloat(340, 860);
    await mouse.move(straightTo(new Point(p.x, p.y)));
    await sleep(randFloat(250, 700));
  }
  console.log("[stage2][landingStrategy] hover simulation done");

  const linkInfo = await opts.page.evaluate(function ({ youtubeHref }: { youtubeHref: string }) {
    const links = document.querySelectorAll("a[href]");
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const absHrefRe = /^https?:\/\//i;
    for (let j = 0; j < links.length; j++) {
      (links[j] as HTMLAnchorElement).removeAttribute("data-yt-worker-patched");
    }
    for (let i = 0; i < links.length; i++) {
      const a = links[i] as HTMLAnchorElement;
      const rawHref = (a.getAttribute("href") || "").trim();
      if (!absHrefRe.test(rawHref)) continue;
      const r = a.getBoundingClientRect();
      const intersects =
        r.width > 8 &&
        r.height > 8 &&
        r.bottom > 0 &&
        r.right > 0 &&
        r.left < vw &&
        r.top < vh;
      if (!intersects) continue;
      const beforeHref = a.getAttribute("href") || a.href || "";
      a.setAttribute("href", youtubeHref);
      a.setAttribute("target", "_self");
      a.removeAttribute("onclick");
      a.setAttribute("rel", "noopener");
      a.setAttribute("data-yt-worker-patched", "1");
      const afterHref = a.getAttribute("href") || a.href || "";
      return { i, beforeHref, afterHref };
    }
    return null;
  }, { youtubeHref: opts.videoTargetHref });
  console.log("[stage2][landingStrategy] link patch result", linkInfo);
  if (!linkInfo) {
    throw new Error("stage2 landingStrategy: no visible absolute link found to patch href");
  }
  const link = opts.page.locator("a[data-yt-worker-patched='1']").first();
  await link.scrollIntoViewIfNeeded();
  const modalDismissed = await dismissModalboxIfVisible(opts.page);
  if (modalDismissed) {
    console.log("[stage2][landingStrategy] modalbox dismissed before link click");
  }
  console.log("[stage2][landingStrategy] clicking patched link");
  await nutHumanMoveAndClick(link);
  await opts.page.waitForLoadState("domcontentloaded", { timeout: 60_000 }).catch(() => {});
  console.log("[stage2][landingStrategy] reached target page, ensure playback");
  await ensureVideoPlayingIfPaused(opts.page);
  console.log("[stage2][landingStrategy] done");
}

/**
 * Screen pixel for a reliable play interaction: overlay play control or lower player area.
 * Avoids clicking the first <video> in DOM (can be wrong/hidden and send cursor off-screen).
 */
async function resolveYoutubePlaybackClickScreenPx(
  page: Page
): Promise<{ x: number; y: number } | null> {
  // Одна function без вложенных хелперов — иначе esbuild/tsx подставляет __name в evaluate и падает в браузере.
  return page.evaluate(function () {
    const chromeTop = window.outerHeight - window.innerHeight;
    const chromeLeft = window.outerWidth - window.innerWidth;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const playSelectors = [
      ".ytp-play-button",
      ".ytp-large-play-button",
      "button.ytp-play-button",
      ".ytp-cued-thumbnail-overlay",
    ];
    let i: number;
    let el: Element | null;
    let r: DOMRect;
    let lx: number;
    let ly: number;
    for (i = 0; i < playSelectors.length; i++) {
      el = document.querySelector(playSelectors[i]!);
      if (!el) continue;
      r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) continue;
      lx = r.left + r.width / 2;
      ly = r.top + r.height / 2;
      if (lx < 0 || ly < 0 || lx > vw || ly > vh) continue;
      return {
        x: Math.round(window.screenX + chromeLeft / 2 + lx),
        y: Math.round(window.screenY + chromeTop + ly),
      };
    }
    el =
      document.querySelector("#movie_player") ??
      document.querySelector("ytd-player#player") ??
      document.querySelector("ytd-player");
    if (el) {
      r = el.getBoundingClientRect();
      if (r.width > 20 && r.height > 20) {
        lx = r.left + r.width / 2;
        ly = r.top + Math.min(r.height * 0.58, r.height - 28);
        if (lx >= 0 && ly >= 0 && lx <= vw && ly <= vh) {
          return {
            x: Math.round(window.screenX + chromeLeft / 2 + lx),
            y: Math.round(window.screenY + chromeTop + ly),
          };
        }
      }
    }
    lx = vw / 2;
    ly = vh * 0.48;
    return {
      x: Math.round(window.screenX + chromeLeft / 2 + lx),
      y: Math.round(window.screenY + chromeTop + ly),
    };
  });
}

async function evalMainVideoPaused(page: Page): Promise<boolean | null> {
  return page.evaluate(function () {
    const v =
      document.querySelector("ytd-player video") ??
      document.querySelector("#movie_player video") ??
      document.querySelector("video");
    if (!v) return null;
    return (v as HTMLVideoElement).paused;
  });
}

async function ensureVideoPlayingIfPaused(page: Page): Promise<void> {
  await sleep(randFloat(500, 1100));

  let paused = await evalMainVideoPaused(page);
  if (paused === null) return;
  if (!paused) return;

  console.log("[stage2] directLinkStrategy: video is paused, starting playback (nut.js)");

  keyboard.config.autoDelayMs = 0;

  const tryHotkeys = async (): Promise<void> => {
    if ((await evalMainVideoPaused(page)) !== true) return;
    await sleep(randFloat(120, 280));
    await keyboard.type(" ");
    await sleep(randFloat(280, 520));
    if ((await evalMainVideoPaused(page)) !== true) return;
    await sleep(randFloat(80, 200));
    await keyboard.type(Key.K);
    await sleep(randFloat(280, 520));
  };

  for (let attempt = 0; attempt < 3 && paused === true; attempt++) {
    const pt = await resolveYoutubePlaybackClickScreenPx(page);
    if (pt) {
      try {
        await nutHumanMoveAndClickScreenPoint(pt.x, pt.y);
        await sleep(randFloat(220, 480));
      } catch (e) {
        console.warn("[stage2] directLinkStrategy: mouse click failed, trying keys only:", e);
      }
    }

    await tryHotkeys();
    paused = await evalMainVideoPaused(page);
    if (paused === null || paused === false) break;
  }

  const playBtn = page.locator(".ytp-play-button, .ytp-large-play-button").first();
  try {
    if ((await evalMainVideoPaused(page)) === true) {
      await playBtn.waitFor({ state: "visible", timeout: 2500 });
      await nutHumanMoveAndClick(playBtn);
      await sleep(randFloat(300, 600));
    }
  } catch {
    // ignore
  }

  if ((await evalMainVideoPaused(page)) === true) {
    await tryHotkeys();
  }

  const after = await evalMainVideoPaused(page);
  const playing = after === false;
  console.log(
    `[stage2] directLinkStrategy: video playing=${playing}${after === null ? " (no <video>)" : ""}`
  );
}

async function findAndClickVisibleSearchLink(page: Page, opts: {
  hrefNeedle?: string;
  textNeedle?: string;
  timeoutMs: number;
}): Promise<boolean> {
  const started = Date.now();
  const hrefNeedle = (opts.hrefNeedle ?? "").trim().toLowerCase();
  const textNeedle = (opts.textNeedle ?? "").trim().toLowerCase();

  while (Date.now() - started < opts.timeoutMs) {
    const idx = await page.evaluate(
      ({ hNeedle, tNeedle }: { hNeedle: string; tNeedle: string }) => {
        const links = document.querySelectorAll("a[href]");
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const normalizeHref = (rawHref: string): string => {
          try {
            const u = new URL(rawHref, window.location.href);
            if ((u.hostname.includes("google.") || u.hostname.includes("yandex.")) && u.searchParams.get("q")) {
              return (u.searchParams.get("q") || "").toLowerCase();
            }
            return u.href.toLowerCase();
          } catch {
            return rawHref.toLowerCase();
          }
        };

        for (let i = 0; i < links.length; i++) {
          const el = links[i] as HTMLAnchorElement;
          const r = el.getBoundingClientRect();
          const intersects =
            r.width > 0 &&
            r.height > 0 &&
            r.bottom > 0 &&
            r.right > 0 &&
            r.left < vw &&
            r.top < vh;
          if (!intersects) continue;
          const hrefNorm = normalizeHref(el.href || el.getAttribute("href") || "");
          const txt = (el.innerText || el.textContent || "").trim().toLowerCase();
          if (!hrefNorm) continue;
          const hrefOk = !hNeedle || hrefNorm.includes(hNeedle);
          const textOk = !tNeedle || txt.includes(tNeedle);
          if (hrefOk && textOk) return i;
        }
        return -1;
      },
      { hNeedle: hrefNeedle, tNeedle: textNeedle }
    );

    if (idx >= 0) {
      const link = page.locator("a[href]").nth(idx);
      await link.scrollIntoViewIfNeeded();
      await nutHumanMoveAndClick(link);
      return true;
    }

    await keyboard.type(Key.PageDown);
    await sleep(randFloat(600, 1400));
  }

  return false;
}

async function executeStage1(opts: {
  runStage1: boolean;
  runStage1Base: boolean;
  channelMode: boolean;
  text: string;
  typoRatio: number;
  page: Page;
  input: Locator;
  taskId: string | undefined;
}): Promise<{ stage1Completed: boolean; videoNearEndDone: boolean }> {
  let stage1Completed = false;
  if (opts.runStage1) {
    try {
      const ytSplit = getPartialTypingSplitForSuggestion(opts.text);
      const partialFlowNoEnter = Math.random() < 0.5;

      if (partialFlowNoEnter) {
        if (ytSplit) {
          await typeTextWithNut(ytSplit.first, { typoRatio: opts.typoRatio });
          await maybeClickRandomYtSuggestion(opts.page, opts.text);
          if (ytSplit.rest.length > 0) {
            await typeTextWithNut(ytSplit.rest, { typoRatio: opts.typoRatio });
          }
        } else {
          await typeTextWithNut(opts.text, { typoRatio: opts.typoRatio });
        }
        if (opts.channelMode) {
          await pressEnterAfterTyping();
        }
      } else {
        await typeTextWithNut(opts.text, { typoRatio: opts.typoRatio });
        await maybeClickRandomYtSuggestion(opts.page, opts.text);
        await pressEnterAfterTyping();
      }
      stage1Completed = true;
    } catch (e) {
      console.warn("[stage1] failed, continuing to stage2:", e);
    }
  } else if (opts.runStage1Base) {
    console.log("[stage1] skipped by STAGE1_SKIP_PROB");
  }

  let videoNearEndDone = false;
  if (stage1Completed) {
    await runHumanScrollDownPhase(opts.page);
    await nutClickVideoTitleLink(opts.page);
    videoNearEndDone = await waitForYoutubeVideoNearEndIfWatch(opts.page);
    if (videoNearEndDone) {
      console.log("hello world");
      if (Math.random() < 0.5) {
        const picked = await pickRandomVisibleSidebarVideo(opts.page);
        if (picked) {
          const side = opts.page.locator(picked.selector).nth(picked.idx);
          await nutHumanMoveAndClick(side);
          await opts.page.waitForLoadState("domcontentloaded", {
            timeout: 60_000,
          }).catch(() => {});
          await sleep(randFloat(900, 1700));
          await waitForYoutubeVideoNearEndIfWatch(opts.page);
        }
      }
    }
  }

  if (stage1Completed) {
    await reportTeamTaskStatus(opts.taskId, "process");
  }
  return { stage1Completed, videoNearEndDone };
}

async function runChosenStage2Strategy(opts: {
  chosenStrategy: Stage2Strategy;
  stage2Name?: string;
  channelTargetHref?: string;
  channelMode: boolean;
  videoTargetHref?: string;
  videoTargetName?: string;
  vkGroupUrl?: string;
  landingUrl?: string;
  typoRatio: number;
  page: Page;
  input: Locator;
}): Promise<void> {
  if (opts.chosenStrategy === "channelSearchStrategy") {
    if (opts.stage2Name) {
      await opts.input.waitFor({ state: "visible", timeout: 30_000 });
      await moveCursorAndClickToFocus(opts.page, opts.input);
      await clearFocusedField();
      await typeTextWithNut(opts.stage2Name, { typoRatio: opts.typoRatio });
      await pressEnterAfterTyping();
      await sleep(randFloat(1000, 3000));
    }
    if (opts.channelMode && opts.channelTargetHref) {
      await sleep(randFloat(350, 900));
      const res = await scrollFindChannelHrefOrFallbackSearch({
        page: opts.page,
        input: opts.input,
        targetHref: opts.channelTargetHref,
      });
      console.log(`[stage2] channel href result: ${res}`);
    }
    if (opts.videoTargetHref) {
      const r = await stage2ClickVideosAndOpenVideoByHref(opts.page, opts.videoTargetHref);
      console.log(`[stage2] video href result: ${r}`);
    }
    return;
  }

  if (opts.chosenStrategy === "webChannelSearchStrategy") {
    if (!opts.stage2Name) {
      throw new Error("stage2 webChannelSearchStrategy: CHANNEL_TARGET_NAME is empty");
    }
    const query = `"${opts.stage2Name}" site:youtube.com`;
    await nutSearchFromAddressBar(query);
    const clicked = await findAndClickVisibleSearchLink(opts.page, {
      hrefNeedle: opts.channelTargetHref,
      textNeedle: opts.stage2Name,
      timeoutMs: Math.round(randFloat(12_000, 24_000)),
    });
    if (!clicked && opts.channelTargetHref) {
      await nutSearchFromAddressBar(opts.channelTargetHref);
    }
    await opts.page.waitForLoadState("domcontentloaded", { timeout: 60_000 }).catch(() => {});
    if (opts.videoTargetHref) {
      const r = await stage2ClickVideosAndOpenVideoByHref(opts.page, opts.videoTargetHref);
      console.log(`[stage2] video href result: ${r}`);
    }
    return;
  }

  if (opts.chosenStrategy === "webVideoSearchStrategy") {
    const queryBase = opts.videoTargetName || opts.videoTargetHref || "";
    if (!queryBase) {
      throw new Error("stage2 webVideoSearchStrategy: VIDEO_TARGET_NAME/VIDEO_TARGET_HREF is empty");
    }
    const query = `"${queryBase}" site:youtube.com`;
    await nutSearchFromAddressBar(query);
    const clicked = await findAndClickVisibleSearchLink(opts.page, {
      hrefNeedle: opts.videoTargetHref,
      textNeedle: opts.videoTargetName,
      timeoutMs: Math.round(randFloat(12_000, 26_000)),
    });
    if (!clicked && opts.videoTargetHref) {
      await nutSearchFromAddressBar(opts.videoTargetHref);
    }
    await opts.page.waitForLoadState("domcontentloaded", { timeout: 60_000 }).catch(() => {});
    return;
  }

  if (opts.chosenStrategy === "vkStrategy") {
    if (!opts.vkGroupUrl || !opts.videoTargetHref) {
      throw new Error("stage2 vkStrategy: VK_GROUP_URL and VIDEO_TARGET_HREF are required");
    }
    await stage2VkStrategy({
      page: opts.page,
      vkGroupUrl: opts.vkGroupUrl,
      videoTargetHref: opts.videoTargetHref,
    });
    return;
  }

  if (opts.chosenStrategy === "landingStrategy") {
    if (!opts.landingUrl || !opts.videoTargetHref) {
      throw new Error("stage2 landingStrategy: LANDING_URL and VIDEO_TARGET_HREF are required");
    }
    await stage2LandingStrategy({
      page: opts.page,
      landingUrl: opts.landingUrl,
      videoTargetHref: opts.videoTargetHref,
    });
    return;
  }

  await stage2DirectLinkStrategy({
    page: opts.page,
    channelTargetHref: opts.channelTargetHref,
    videoTargetHref: opts.videoTargetHref,
  });
}

async function executeStage2(opts: {
  runStage2: boolean;
  stage2Name?: string;
  channelTargetHref?: string;
  channelMode: boolean;
  videoTargetHref?: string;
  videoTargetName?: string;
  vkGroupUrl?: string;
  landingUrl?: string;
  typoRatio: number;
  page: Page;
  input: Locator;
  taskId: string | undefined;
}): Promise<boolean> {
  if (!opts.runStage2) return false;

  const chosenStrategy = resolveStage2Strategy({
    stage2Name: opts.stage2Name,
    channelTargetHref: opts.channelTargetHref,
    videoTargetHref: opts.videoTargetHref,
    videoTargetName: opts.videoTargetName,
    vkGroupUrl: opts.vkGroupUrl,
    landingUrl: opts.landingUrl,
  });
  console.log(`[stage2] chosen strategy: ${chosenStrategy}`);

  try {
    const timeoutMs = stage2TimeoutMs();
    await Promise.race([
      runChosenStage2Strategy({
        chosenStrategy,
        stage2Name: opts.stage2Name,
        channelTargetHref: opts.channelTargetHref,
        channelMode: opts.channelMode,
        videoTargetHref: opts.videoTargetHref,
        videoTargetName: opts.videoTargetName,
        vkGroupUrl: opts.vkGroupUrl,
        landingUrl: opts.landingUrl,
        typoRatio: opts.typoRatio,
        page: opts.page,
        input: opts.input,
      }),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(`stage2 strategy timeout ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);

    if (await hasCaptchaOrVerification(opts.page)) {
      throw new Error("captcha/verification detected");
    }
  } catch (e) {
    console.warn("[stage2] strategy failed, switching to directLinkStrategy:", e);
    await stage2DirectLinkStrategy({
      page: opts.page,
      channelTargetHref: opts.channelTargetHref,
      videoTargetHref: opts.videoTargetHref,
    });
  }

  const { min: minR, max: maxR } = resolveStage2VideoEndRatios();
  console.log(
    `[stage2] target watch ratio range: ${minR}..${maxR} (STAGE2_VIDEO_END_MIN[_RATIO] / MAX[_RATIO] or VIDEO_END_*)`
  );
  const stage2WatchOk = await waitForYoutubeVideoNearEndIfWatch(opts.page, {
    ratioMin: minR,
    ratioMax: maxR,
    ignoreVideoWatchSecLimits: true,
  });

  if (stage2WatchOk) {
    await reportTeamTaskStatus(opts.taskId, "completed");
  } else {
    console.warn(
      "[stage2] целевой просмотр по заданным VIDEO_END_/STAGE2_VIDEO_END_ долям не достигнут — completed не отправляем"
    );
  }

  return stage2WatchOk;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const url = 'https://youtube.com'
  const selector = 'input[name="search_query"]'
  const stage = (process.env.STAGE ?? "both").trim().toLowerCase();
  const runStage1Base = stage !== "stage2";
  const runStage2 = stage !== "stage1";
  const runStage1 = runStage1Base && !shouldSkipStage1ByChance(runStage1Base);
  const stage2Name = process.env.CHANNEL_TARGET_NAME?.trim();
  const channelTargetHref = process.env.CHANNEL_TARGET_HREF?.trim();
  const channelMode = runStage2 && Boolean(channelTargetHref);
  const videoTargetHref = process.env.VIDEO_TARGET_HREF?.trim();
  const videoTargetName = process.env.VIDEO_TARGET_NAME?.trim();
  const vkGroupUrl = process.env.VK_GROUP_URL?.trim();
  const landingUrl = process.env.LANDING_URL?.trim();
  const taskId = process.env.TASK_ID ?? process.env.TASKID;
  const text = args.text ?? process.env.TEXT ?? "Hello world";

  ensurePlaywrightBrowsersIfNeeded();

  // if (!url || !selector) {
  //   console.error(
  //     "Укажите URL и селектор инпута:\n" +
  //       "  npm run fill -- --url <URL> --selector <CSS_SELECTOR>\n" +
  //       "или переменные TARGET_URL и INPUT_SELECTOR"
  //   );
  //   process.exit(1);
  // }

  const { page, close } = await createBrowserSession();
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await sleep(postLoadDelayMs());
    const input = page.locator(selector).first();
    await input.waitFor({ state: "visible", timeout: 30_000 });
    await moveCursorAndClickToFocus(page, input);
    const typoRatio = resolveTypoRatio();
    const { videoNearEndDone } = await executeStage1({
      runStage1,
      runStage1Base,
      channelMode,
      text,
      typoRatio,
      page,
      input,
      taskId,
    });

    const stage2WatchOk = await executeStage2({
      runStage2,
      stage2Name,
      channelTargetHref,
      channelMode,
      videoTargetHref,
      videoTargetName,
      vkGroupUrl,
      landingUrl,
      typoRatio,
      page,
      input,
      taskId,
    });

    //не убирать! (пауза перед закрытием, если не ждали конец ролика)
    if (!videoNearEndDone && !(runStage2 && stage2WatchOk)) {
      await page.waitForTimeout(15000);
    }
    console.log(`Введено "${text}" в ${selector} на ${url}`);
  } finally {
    await close();
  }
}

void main().catch((err: unknown) => {
  appendErrorLog(err);
  console.error(err);
  process.exit(1);
});
