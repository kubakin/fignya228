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
 *   HEADLESS=true — без окна (для CI); по умолчанию окно браузера открыто и видно
 *   --headless — то же из командной строки
 *   USE_SYSTEM_MOUSE=false — только виртуальный курсор Playwright (в headless всегда так)
 *   MOUSE_SPEED — базовая скорость системного курсора, px/сек (±20% на каждый запуск)
 *   MOUSE_OFFSET_X, MOUSE_OFFSET_Y — тонкая подстройка после автоучёта панелей браузера
 *   CLICK_VIEWPORT_TOP_SAFE_PX — зона «под хедером» (px сверху viewport); клик смещается ниже
 *   USE_SYSTEM_KEYBOARD=false — ввод через Playwright (например в headless уже так)
 *   TYPO_MAX_PERCENT — доля опечаток (соседняя клавиша), по умолчанию 5 (то есть 5%);
 *     для nut-ввода системная раскладка клавиатуры должна совпадать с языком текста
 *   TYPING_DELAY_MULTIPLIER — множитель пауз между символами (например 1.5 или 2)
 *   USE_SYSTEM_SCROLL=false — отключить фазу скролла колесом nut.js (скролл только после Enter)
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
 *   после клика по заголовку на watch: ожидание прогресса плеера VIDEO_END_MIN_RATIO–VIDEO_END_MAX_RATIO (по умолчанию 0.9–1.0),
 *     затем в консоль: hello world; VIDEO_NEAR_END_TIMEOUT_MS — лимит ожидания (мс), 0 = без лимита;
 *     VIDEO_PROGRESS_INTERVAL_MS — интервал лога «прогресс» (мс), по умолчанию 2500, минимум 500
 *   Свой браузер / аккаунты:
 *     PLAYWRIGHT_CDP_URL=http://127.0.0.1:9222 — подключение к уже запущенному Chrome/Edge с remote debugging
 *       (запуск, например: chrome --remote-debugging-port=9222 --user-data-dir=…);
 *     PLAYWRIGHT_USER_DATA_DIR=путь — постоянный профиль (куки между запусками); опционально PLAYWRIGHT_BROWSER_CHANNEL=chrome|msedge|chromium
 */

import { keyboard, sleep } from "@nut-tree-fork/nut-js";
import { Key } from "@nut-tree-fork/shared";
import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import type { Locator, Page } from "playwright";
import {
  clearFocusedField,
  pressEnterAfterTyping,
  resolveTypoRatio,
  shouldUseNutKeyboard,
  typeTextWithNut,
  typeTextWithPlaywright,
} from "./human-typing.js";
import { nutClickVideoTitleLink } from "./click-video-title.js";
import {
  getPartialTypingSplitForSuggestion,
  maybeClickRandomYtSuggestion,
} from "./yt-search-suggestion.js";
import {
  runHumanScrollDownPhase,
  shouldRunNutScroll,
} from "./human-scroll.js";
import { dedupeConsecutive, humanLikePath, randFloat } from "./mouse-path.js";
import { nutHumanMoveAndClick } from "./nut-move-click.js";
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
  url?: string;
  selector?: string;
  text?: string;
  headed?: boolean;
  headless?: boolean;
};

function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--url" && argv[i + 1]) {
      out.url = argv[++i];
    } else if (a === "--selector" && argv[i + 1]) {
      out.selector = argv[++i];
    } else if (a === "--text" && argv[i + 1]) {
      out.text = argv[++i];
    } else if (a === "--headed") {
      out.headed = true;
    } else if (a === "--headless") {
      out.headless = true;
    }
  }
  return out;
}

/** По умолчанию окно видно; headless только с --headless или HEADLESS=true */
function resolveHeadless(args: ParsedArgs): boolean {
  if (args.headed) return false;
  if (args.headless) return true;
  const v = process.env.HEADLESS?.trim().toLowerCase();
  if (v === "true" || v === "1" || v === "yes") return true;
  return false;
}

function postLoadDelayMs(): number {
  const min = Number(process.env.POST_LOAD_MS_MIN ?? 1000);
  const max = Number(process.env.POST_LOAD_MS_MAX ?? 3000);
  if (!Number.isFinite(min) || !Number.isFinite(max)) return randFloat(1000, 3000);
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  return randFloat(lo, hi);
}

/**
 * Точка в координатах viewport (для Playwright mouse).
 */
async function randomClickInElementViewportPx(locator: Locator): Promise<{
  x: number;
  y: number;
}> {
  return locator.evaluate((el: Element) => {
    const r = el.getBoundingClientRect();
    const margin = Math.max(
      2,
      Math.min(r.width, r.height) * (0.08 + Math.random() * 0.1)
    );
    const w = Math.max(0, r.width - 2 * margin);
    const h = Math.max(0, r.height - 2 * margin);
    return {
      x: r.left + margin + Math.random() * w,
      y: r.top + margin + Math.random() * h,
    };
  });
}

/** Случайная точка у края viewport (откуда «входит» курсор после старта с 0,0). */
function randomViewportEdgePoint(vp: { width: number; height: number }): {
  x: number;
  y: number;
} {
  const edge = Math.floor(Math.random() * 4);
  if (edge === 0) return { x: randFloat(0, vp.width), y: 0 };
  if (edge === 1)
    return { x: vp.width - 1, y: randFloat(0, vp.height) };
  if (edge === 2)
    return { x: randFloat(0, vp.width), y: vp.height - 1 };
  return { x: 0, y: randFloat(0, vp.height) };
}

/** Виртуальный курсор только внутри Chromium (в headless или при USE_SYSTEM_MOUSE=false). */
async function movePlaywrightCursorAndClick(
  page: Page,
  locator: Locator
): Promise<void> {
  await locator.scrollIntoViewIfNeeded();
  const target = await randomClickInElementViewportPx(locator);
  const vp = page.viewportSize();
  const path =
    vp === null
      ? humanLikePath({ x: 0, y: 0 }, target)
      : (() => {
          const edge = randomViewportEdgePoint(vp);
          const leg1 = humanLikePath({ x: 0, y: 0 }, edge);
          const start2 = leg1[leg1.length - 1] ?? edge;
          const leg2 = humanLikePath(start2, target);
          return dedupeConsecutive([...leg1.slice(0, -1), ...leg2]);
        })();
  for (const p of path) {
    await page.mouse.move(p.x, p.y, { steps: 1 });
  }
  await sleep(randFloat(200, 500));
  await page.mouse.click(target.x, target.y);
}

/** Реальный системный курсор: кривая траектория и левый клик. */
async function moveSystemCursorAndClick(locator: Locator): Promise<void> {
  await nutHumanMoveAndClick(locator);
}

function useSystemMouse(headless: boolean): boolean {
  if (headless) return false;
  const v = process.env.USE_SYSTEM_MOUSE?.trim().toLowerCase();
  if (v === "false" || v === "0" || v === "no") return false;
  return true;
}

async function moveCursorAndClickToFocus(
  page: Page,
  locator: Locator,
  headless: boolean
): Promise<void> {
  if (useSystemMouse(headless)) {
    await moveSystemCursorAndClick(locator);
  } else {
    await movePlaywrightCursorAndClick(page, locator);
  }
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
type Stage2Variant = "variant1" | "variant2" | "variant3" | "variant4";

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

function pickWeightedVariant(candidates: Array<{ variant: Stage2Variant; weight: number }>): Stage2Variant {
  const sanitized = candidates
    .map((x) => ({ ...x, weight: Number.isFinite(x.weight) ? Math.max(0, x.weight) : 0 }))
    .filter((x) => x.weight > 0);
  if (sanitized.length === 0) return "variant1";
  const sum = sanitized.reduce((acc, x) => acc + x.weight, 0);
  let r = Math.random() * sum;
  for (const x of sanitized) {
    r -= x.weight;
    if (r <= 0) return x.variant;
  }
  return sanitized[sanitized.length - 1]!.variant;
}

function resolveStage2Variant(opts: {
  stage2Name?: string;
  channelTargetHref?: string;
  videoTargetHref?: string;
  videoTargetName?: string;
}): Stage2Variant {
  const candidates: Array<{ variant: Stage2Variant; weight: number }> = [];
  const v1w = parseProb("STAGE2_VARIANT1_PROB", 0.0);
  const v2w = parseProb("STAGE2_VARIANT2_PROB", 0.30);
  const v3w = parseProb("STAGE2_VARIANT3_PROB", 0.70);
  if (opts.channelTargetHref && opts.videoTargetHref) candidates.push({ variant: "variant1", weight: v1w });
  if (opts.stage2Name && opts.videoTargetHref) candidates.push({ variant: "variant2", weight: v2w });
  if (opts.videoTargetName || opts.videoTargetHref) candidates.push({ variant: "variant3", weight: v3w });
  console.log(
    `[stage2] weights v1=${v1w} v2=${v2w} v3=${v3w}; inputs channelName=${Boolean(
      opts.stage2Name
    )} channelHref=${Boolean(opts.channelTargetHref)} videoHref=${Boolean(
      opts.videoTargetHref
    )} videoName=${Boolean(opts.videoTargetName)}`
  );
  return pickWeightedVariant(candidates);
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
  const n = Number(process.env.STAGE2_VARIANT_TIMEOUT_MS ?? 120_000);
  return Number.isFinite(n) && n >= 10_000 ? Math.floor(n) : 120_000;
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

async function stage2Variant4DirectNavigate(opts: {
  page: Page;
  channelTargetHref?: string;
  videoTargetHref?: string;
}): Promise<void> {
  const directHref = (opts.videoTargetHref?.trim() || opts.channelTargetHref?.trim() || "");
  if (!directHref) {
    throw new Error("stage2 variant4: no direct link available (VIDEO_TARGET_HREF/CHANNEL_TARGET_HREF).");
  }
  console.log(`[stage2] fallback variant4 direct navigate: ${directHref}`);
  await nutSearchFromAddressBar(directHref);
  await opts.page.waitForLoadState("domcontentloaded", { timeout: 60_000 }).catch(() => {});
  await ensureVideoPlayingIfPaused(opts.page);
}

async function ensureVideoPlayingIfPaused(page: Page): Promise<void> {
  const snap = await page.evaluate(() => {
    const v =
      document.querySelector("ytd-player video") ??
      document.querySelector("#movie_player video") ??
      document.querySelector("video");
    if (!v) return { hasVideo: false, paused: false };
    const vv = v as HTMLVideoElement;
    return { hasVideo: true, paused: vv.paused };
  });

  if (!snap.hasVideo) return;
  if (!snap.paused) return;

  console.log("[stage2] variant4: video is paused, trying to start playback");
  const video = page.locator("#movie_player video, ytd-player video, video").first();
  try {
    await video.waitFor({ state: "visible", timeout: 7000 });
    await nutHumanMoveAndClick(video);
    await sleep(randFloat(180, 360));
    await keyboard.type("k");
    await sleep(randFloat(300, 700));
  } catch {
    // Fallback: try hotkey only.
    await keyboard.type("k");
    await sleep(randFloat(300, 700));
  }

  const after = await page.evaluate(() => {
    const v =
      document.querySelector("ytd-player video") ??
      document.querySelector("#movie_player video") ??
      document.querySelector("video");
    return v ? !(v as HTMLVideoElement).paused : true;
  });
  console.log(`[stage2] variant4: playback active=${after}`);
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

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const url = 'https://youtube.com'
  const selector = 'input[name="search_query"]'
  const headless = resolveHeadless(args);
  const stage = (process.env.STAGE ?? "both").trim().toLowerCase();
  const runStage1Base = stage !== "stage2";
  const runStage2 = stage !== "stage1";
  const runStage1 = runStage1Base && !shouldSkipStage1ByChance(runStage1Base);
  const stage2Name = process.env.CHANNEL_TARGET_NAME?.trim();
  const channelTargetHref = process.env.CHANNEL_TARGET_HREF?.trim();
  const channelMode = runStage2 && Boolean(channelTargetHref);
  const videoTargetHref = process.env.VIDEO_TARGET_HREF?.trim();
  const videoTargetName = process.env.VIDEO_TARGET_NAME?.trim();
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

  const { page, close } = await createBrowserSession(headless);
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await sleep(postLoadDelayMs());
    const input = page.locator(selector).first();
    await input.waitFor({ state: "visible", timeout: 30_000 });
    await moveCursorAndClickToFocus(page, input, headless);
    const typoRatio = resolveTypoRatio();
    const useNutKb = shouldUseNutKeyboard(headless);
    let stage1Completed = false;
    if (runStage1) {
      try {
        const ytSplit = getPartialTypingSplitForSuggestion(text, headless);
        /** true: частичный ввод + подсказка, без Enter, сразу скролл. false: полный ввод, Enter, скролл. */
        const partialFlowNoEnter = Math.random() < 0.5;

        if (partialFlowNoEnter) {
          if (ytSplit) {
            if (useNutKb) {
              await typeTextWithNut(ytSplit.first, { typoRatio });
            } else {
              await typeTextWithPlaywright(page, ytSplit.first, { typoRatio });
            }
            await maybeClickRandomYtSuggestion(page, text, headless);
            if (ytSplit.rest.length > 0) {
              if (useNutKb) {
                await typeTextWithNut(ytSplit.rest, { typoRatio });
              } else {
                await typeTextWithPlaywright(page, ytSplit.rest, { typoRatio });
              }
            }
          } else {
            if (useNutKb) {
              await typeTextWithNut(text, { typoRatio });
            } else {
              await typeTextWithPlaywright(page, text, { typoRatio });
            }
          }
          // Во втором этапе нужен переход на результаты, поэтому Enter обязателен.
          if (channelMode) {
            await pressEnterAfterTyping(page, useNutKb);
          }
        } else {
          if (useNutKb) {
            await typeTextWithNut(text, { typoRatio });
          } else {
            await typeTextWithPlaywright(page, text, { typoRatio });
          }
          await maybeClickRandomYtSuggestion(page, text, headless);
          await pressEnterAfterTyping(page, useNutKb);
        }
        stage1Completed = true;
      } catch (e) {
        console.warn("[stage1] failed, continuing to stage2:", e);
      }
    } else if (runStage1Base) {
      console.log("[stage1] skipped by STAGE1_SKIP_PROB");
    }

    let videoNearEndDone = false;
    if (stage1Completed && shouldRunNutScroll(headless)) {
      await runHumanScrollDownPhase(page);
      if (!headless) {
        await nutClickVideoTitleLink(page);
        videoNearEndDone = await waitForYoutubeVideoNearEndIfWatch(page);
        if (videoNearEndDone) {
          console.log("hello world");
          // После частичного просмотра stage1: 50% шанс перейти на случайное боковое видео.
          if (Math.random() < 0.5) {
            const picked = await pickRandomVisibleSidebarVideo(page);
            if (picked) {
              const side = page.locator(picked.selector).nth(picked.idx);
              await nutHumanMoveAndClick(side);
              await page.waitForLoadState("domcontentloaded", {
                timeout: 60_000,
              }).catch(() => {});
              await sleep(randFloat(900, 1700));
              await waitForYoutubeVideoNearEndIfWatch(page);
            }
          }
        }
      }
    }
    if (stage1Completed) {
      await reportTeamTaskStatus(taskId, "process");
    }

    if (runStage2) {
      if (headless) {
        throw new Error("stage2: only headed mode is supported (nut.js real-user actions).");
      }
      const stage2UseNutKb = true;
      const chosenVariant = resolveStage2Variant({
        stage2Name,
        channelTargetHref,
        videoTargetHref,
        videoTargetName,
      });
      console.log(`[stage2] chosen flow: ${chosenVariant}`);

      const runChosenVariant = async (): Promise<void> => {
        if (chosenVariant === "variant1") {
          if (stage2Name) {
            await input.waitFor({ state: "visible", timeout: 30_000 });
            await moveCursorAndClickToFocus(page, input, headless);
            await clearFocusedField(page);
            await typeTextWithNut(stage2Name, { typoRatio });
            await pressEnterAfterTyping(page, stage2UseNutKb);
            await sleep(randFloat(1000, 3000));
          }
          if (channelMode && channelTargetHref) {
            await sleep(randFloat(350, 900));
            const res = await scrollFindChannelHrefOrFallbackSearch({
              page,
              input,
              targetHref: channelTargetHref,
              useNutKeyboard: useNutKb,
              typoRatio,
            });
            console.log(`[stage2] channel href result: ${res}`);
          }
          if (videoTargetHref) {
            const r = await stage2ClickVideosAndOpenVideoByHref(page, videoTargetHref);
            console.log(`[stage2] video href result: ${r}`);
          }
          return;
        }

        if (chosenVariant === "variant2") {
          if (!stage2Name) {
            throw new Error("stage2 variant2: CHANNEL_TARGET_NAME is empty");
          }
          const query = `"${stage2Name}" site:youtube.com`;
          await nutSearchFromAddressBar(query);
          const clicked = await findAndClickVisibleSearchLink(page, {
            hrefNeedle: channelTargetHref,
            textNeedle: stage2Name,
            timeoutMs: Math.round(randFloat(12_000, 24_000)),
          });
          if (!clicked && channelTargetHref) {
            await nutSearchFromAddressBar(channelTargetHref);
          }
          await page.waitForLoadState("domcontentloaded", { timeout: 60_000 }).catch(() => {});
          if (videoTargetHref) {
            const r = await stage2ClickVideosAndOpenVideoByHref(page, videoTargetHref);
            console.log(`[stage2] video href result: ${r}`);
          }
          return;
        }

        if (chosenVariant === "variant3") {
          const queryBase = videoTargetName || videoTargetHref || "";
          if (!queryBase) {
            throw new Error("stage2 variant3: VIDEO_TARGET_NAME/VIDEO_TARGET_HREF is empty");
          }
          const query = `"${queryBase}" site:youtube.com`;
          await nutSearchFromAddressBar(query);
          const clicked = await findAndClickVisibleSearchLink(page, {
            hrefNeedle: videoTargetHref,
            textNeedle: videoTargetName,
            timeoutMs: Math.round(randFloat(12_000, 26_000)),
          });
          if (!clicked && videoTargetHref) {
            await nutSearchFromAddressBar(videoTargetHref);
          }
          await page.waitForLoadState("domcontentloaded", { timeout: 60_000 }).catch(() => {});
          return;
        }

        await stage2Variant4DirectNavigate({
          page,
          channelTargetHref,
          videoTargetHref,
        });
      };

      try {
        const timeoutMs = stage2TimeoutMs();
        await Promise.race([
          runChosenVariant(),
          new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error(`stage2 variant timeout ${timeoutMs}ms`)), timeoutMs);
          }),
        ]);

        if (await hasCaptchaOrVerification(page)) {
          throw new Error("captcha/verification detected");
        }
      } catch (e) {
        console.warn("[stage2] variant failed, switching to variant4 direct link:", e);
        await stage2Variant4DirectNavigate({
          page,
          channelTargetHref,
          videoTargetHref,
        });
      }
    }
    if (runStage2) {
      await reportTeamTaskStatus(taskId, "completed");
    }

    //не убирать! (пауза перед закрытием, если не ждали конец ролика)
    if (!videoNearEndDone) {
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
