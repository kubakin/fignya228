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

import { keyboard, sleep } from "@nut-tree-fork/nut-js";
import { Key } from "@nut-tree-fork/shared";
import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import type { Locator, Page } from "playwright";
import {
  clearFocusedField,
  pressEnterAfterTyping,
  resolveTypoRatio,
  typeTextWithNut,
} from "./browser/human-typing.js";
import { randFloat } from "./browser/mouse-path.js";
import {
  nutHumanMoveAndClick,
} from "./browser/nut-move-click.js";
import { waitForYoutubeVideoNearEndIfWatch } from "./watch/wait-youtube-near-end.js";
import { createBrowserSession } from "./browser/browser-session.js";
import { scrollFindChannelHrefOrFallbackSearch } from "./stage2/channel-scroll-find.js";
import { stage2ClickVideosAndOpenVideoByHref } from "./stage2/stage2-channel-videos.js";
import { ensureVideoPlayingIfPaused } from "./browser/video-playback.js";
import {
  resolveStage2Strategy,
  type Stage2Strategy,
} from "./stage2/stage2-strategy.js";
import {
  hasCaptchaOrVerification,
  resolveStage2VideoEndRatios,
  stage2DirectLinkStrategy,
  stage2TimeoutMs,
} from "./stage2/stage2-runtime.js";
import { runExternalLinkPatchAndClickStrategy } from "./stage2/stage2-external-link.js";
import { executeStage1Flow } from "./stage1/stage1-flow.js";
import {
  appendErrorLog,
  ensurePlaywrightBrowsersIfNeeded,
  setupGlobalErrorLogging,
} from "./runtime/exe-runtime.js";

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

function parseProb(name: string, fallback: number): number {
  const n = Number(process.env[name]?.trim());
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, n);
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

async function stage2VkStrategy(opts: {
  page: Page;
  vkGroupUrl: string;
  videoTargetHref: string;
}): Promise<void> {
  await runExternalLinkPatchAndClickStrategy({
    page: opts.page,
    strategyName: "vkStrategy",
    entryUrl: opts.vkGroupUrl,
    videoTargetHref: opts.videoTargetHref,
    hoverCountMax: 4,
    requireLoadBeforeScroll: true,
    linkClassPrefix: "vkitLink__link",
    navigateByAddressBar: nutSearchFromAddressBar,
    ensureVideoPlayingIfPaused,
  });
}

async function stage2LandingStrategy(opts: {
  page: Page;
  landingUrl: string;
  videoTargetHref: string;
}): Promise<void> {
  await runExternalLinkPatchAndClickStrategy({
    page: opts.page,
    strategyName: "landingStrategy",
    entryUrl: opts.landingUrl,
    videoTargetHref: opts.videoTargetHref,
    hoverCountMax: 5,
    requireLoadBeforeScroll: false,
    navigateByAddressBar: nutSearchFromAddressBar,
    ensureVideoPlayingIfPaused,
  });
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
    navigateByAddressBar: nutSearchFromAddressBar,
    ensureVideoPlayingIfPaused,
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
      navigateByAddressBar: nutSearchFromAddressBar,
      ensureVideoPlayingIfPaused,
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
    const { videoNearEndDone } = await executeStage1Flow({
      runStage1,
      runStage1Base,
      channelMode,
      text,
      typoRatio,
      page,
      input,
      onStage1Process: () => reportTeamTaskStatus(taskId, "process"),
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
