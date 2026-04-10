/**
 * Ожидание, пока основной HTML5‑плеер на странице watch не дойдёт до доли
 * длительности в интервале [VIDEO_END_MIN_RATIO, VIDEO_END_MAX_RATIO] (по умолчанию 0.9–1.0).
 * Для второго этапа можно передать `ratioMin` / `ratioMax` (например 0.8–1.0) и
 * `ignoreVideoWatchSecLimits: true`, чтобы не смешивать с лимитами stage1 (VIDEO_WATCH_*_SEC).
 *
 * В консоль (console.debug, префикс `[yt-worker:video]`): этапы watch, метаданные плеера,
 * периодический «прогресс» во время ожидания (~каждые 2.5 с), финальный снимок.
 */

import type { Page } from "playwright";
import { randFloat } from "./mouse-path.js";
import { keyboard } from "@nut-tree-fork/nut-js";
import { Key } from "@nut-tree-fork/shared";
import {
  nutHumanMoveAndClick,
  nutHumanMoveAndClickScreenPoint,
} from "./nut-move-click.js";

function envRatio(name: string, fallback: number): number {
  const v = Number(process.env[name]?.trim());
  return Number.isFinite(v) ? v : fallback;
}

function envTimeoutMs(): number {
  const v = Number(process.env.VIDEO_NEAR_END_TIMEOUT_MS?.trim());
  // 0 или не задано — без лимита (Playwright: timeout 0 отключает таймаут)
  if (!Number.isFinite(v) || v < 0) return 0;
  return v;
}

const DBG = "[yt-worker:video]";

function videoLog(msg: string, extra?: Record<string, unknown>): void {
  if (extra !== undefined && Object.keys(extra).length > 0) {
    console.debug(DBG, msg, extra);
  } else {
    console.debug(DBG, msg);
  }
}

function progressTickIntervalMs(): number {
  const v = Number(process.env.VIDEO_PROGRESS_INTERVAL_MS?.trim());
  if (Number.isFinite(v) && v >= 500) return v;
  return 2500;
}

function envRetryMax(): number {
  const v = Number(process.env.VIDEO_WATCH_ERROR_RETRY_MAX?.trim());
  if (Number.isFinite(v) && v >= 0) return Math.min(10, Math.floor(v));
  return 2;
}

function errorCooldownMs(): number {
  const v = Number(process.env.VIDEO_WATCH_ERROR_COOLDOWN_MS?.trim());
  if (Number.isFinite(v) && v >= 0) return Math.min(120_000, Math.floor(v));
  return Math.round(randFloat(1000, 5000));
}

function resumeDriftSec(): number {
  const mag = randFloat(1, 5);
  const sign = Math.random() < 0.5 ? -1 : 1;
  return sign * mag;
}

async function pageTimeOrigin(page: Page): Promise<number | null> {
  try {
    const v = await page.evaluate(() => performance.timeOrigin);
    return Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

async function waitReloadByTimeOrigin(
  page: Page,
  before: number | null,
  timeoutMs: number
): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    await page.waitForTimeout(300);
    const now = await pageTimeOrigin(page);
    if (before === null || now === null) continue;
    if (Math.abs(now - before) > 0.5) {
      await page.waitForLoadState("domcontentloaded", { timeout: 30_000 }).catch(() => {});
      return true;
    }
  }
  return false;
}

async function reloadViaNutJsWithFallback(page: Page): Promise<"f5" | "reload-shortcut"> {
  const before = await pageTimeOrigin(page);
  keyboard.config.autoDelayMs = 0;
  await keyboard.type(Key.F5);
  const okF5 = await waitReloadByTimeOrigin(page, before, 10_000);
  if (okF5) return "f5";

  // Если F5 не сработал, пробуем «Reload» хоткеем браузера.
  if (process.platform === "darwin") {
    await keyboard.type(Key.LeftSuper, Key.R);
  } else {
    await keyboard.type(Key.LeftControl, Key.R);
  }
  await waitReloadByTimeOrigin(page, before, 10_000);
  return "reload-shortcut";
}

async function waitVideoReady(page: Page): Promise<void> {
  await page.waitForFunction(
    function () {
      const v =
        document.querySelector("ytd-player video") ??
        document.querySelector("#movie_player video") ??
        document.querySelector("video");
      if (!v) return false;
      const d = (v as HTMLVideoElement).duration;
      return typeof d === "number" && d > 1 && Number.isFinite(d);
    },
    { timeout: 120_000, polling: 250 }
  );
}

async function seekApproxByNutJs(
  page: Page,
  resumeRatio: number,
  driftSec: number
): Promise<void> {
  await waitVideoReady(page);
  const snap = await page.evaluate(evalVideoSnapshot);
  if (!snap || !Number.isFinite(snap.duration) || snap.duration <= 0) return;
  const target = Math.max(
    0,
    Math.min(snap.duration - 0.5, snap.duration * resumeRatio + driftSec)
  );
  const targetRatio = snap.duration > 0 ? target / snap.duration : 0;

  const video = page.locator("video").first();
  await nutHumanMoveAndClick(video);
  await page.waitForTimeout(randFloat(120, 260));

  // Основной путь: кликнуть по seek-bar в целевой процент.
  const seekPoint = await page.evaluate(
    ({ ratio }: { ratio: number }) => {
      const bar =
        (document.querySelector(".ytp-progress-bar") as HTMLElement | null) ??
        (document.querySelector(".ytp-chapter-hover-container") as HTMLElement | null) ??
        (document.querySelector("div[role='slider'].ytp-progress-bar") as HTMLElement | null);
      if (!bar) return null;
      const r = bar.getBoundingClientRect();
      if (!(r.width > 20 && r.height > 2)) return null;

      const clamped = Math.max(0, Math.min(1, ratio));
      const jitterX = (Math.random() - 0.5) * Math.min(8, r.width * 0.01);
      const jitterY = (Math.random() - 0.5) * Math.min(4, r.height * 0.35);
      const lx = r.left + r.width * clamped + jitterX;
      const ly = r.top + r.height * 0.5 + jitterY;

      const chromeTop = window.outerHeight - window.innerHeight;
      const chromeLeft = window.outerWidth - window.innerWidth;
      return {
        x: Math.round(window.screenX + chromeLeft / 2 + lx),
        y: Math.round(window.screenY + chromeTop + ly),
      };
    },
    { ratio: targetRatio }
  );

  if (seekPoint) {
    await nutHumanMoveAndClickScreenPoint(seekPoint.x, seekPoint.y);
    await page.waitForTimeout(randFloat(220, 420));
  }

  // Доводка клавишами (как человек), если отклонились от цели.
  keyboard.config.autoDelayMs = 0;
  let snapNow = await page.evaluate(evalVideoSnapshot);
  let guard = 0;
  while (snapNow && Math.abs(target - snapNow.currentTime) > 2.2 && guard < 12) {
    const diff = target - snapNow.currentTime;
    if (diff > 7) await keyboard.type("l");
    else if (diff > 0) await keyboard.type(Key.Right);
    else if (diff < -7) await keyboard.type("j");
    else await keyboard.type(Key.Left);
    guard++;
    await page.waitForTimeout(randFloat(70, 150));
    snapNow = await page.evaluate(evalVideoSnapshot);
  }
}

/** Детектор оверлея ошибки YouTube (выполняется в браузере). */
function evalHasYtPlaybackErrorOverlay(): boolean {
  const root = document.querySelector("#movie_player") ?? document;
  const text = (root.textContent || "").toLowerCase();
  // YouTube часто показывает это в оверлее поверх плеера
  return (
    (text.includes("something went wrong") && text.includes("try again")) ||
    (text.includes("try again later") && text.includes("something went wrong"))
  );
}

/** Активен ли рекламный режим YouTube-плеера. */
function evalIsAdShowing(): boolean {
  const player = document.querySelector("#movie_player");
  if (player && (player as Element).classList.contains("ad-showing")) return true;
  const adText = (document.querySelector(".ytp-ad-text") as HTMLElement | null)?.innerText || "";
  if (adText.trim().length > 0) return true;
  return false;
}

/** Снимок плеера для логов (выполняется в браузере). */
function evalVideoSnapshot(): {
  currentTime: number;
  duration: number;
  paused: boolean;
  playbackRate: number;
  readyState: number;
} | null {
  const v =
    document.querySelector("ytd-player video") ??
    document.querySelector("#movie_player video") ??
    document.querySelector("video");
  if (!v) return null;
  const el = v as HTMLVideoElement;
  return {
    currentTime: el.currentTime,
    duration: el.duration,
    paused: el.paused,
    playbackRate: el.playbackRate,
    readyState: el.readyState,
  };
}

function isWatchUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return (
      u.hostname.replace(/^www\./, "") === "youtube.com" &&
      u.pathname === "/watch" &&
      u.searchParams.has("v")
    );
  } catch {
    return false;
  }
}

/**
 * Случайная целевая доля от 0 до 1 в пределах [lo, hi].
 */
function randomTargetRatioInRange(minR: number, maxR: number): number {
  const lo = Math.min(minR, maxR);
  const hi = Math.max(minR, maxR);
  const clampedLo = Math.max(0, Math.min(1, lo));
  const clampedHi = Math.max(0, Math.min(1, hi));
  if (clampedHi <= clampedLo) return clampedLo;
  return randFloat(clampedLo, clampedHi);
}

function envWatchSec(name: string): number | undefined {
  const v = Number(process.env[name]?.trim());
  if (!Number.isFinite(v) || v < 0) return undefined;
  return v;
}

function resolveTargetWatchSec(
  durationSec: number,
  ratio: number,
  ignoreVideoWatchLimits?: boolean
): number {
  const byRatio = durationSec * ratio;
  if (ignoreVideoWatchLimits) {
    return Math.max(0, Math.min(durationSec - 0.5, byRatio));
  }
  const minSecRaw = envWatchSec("VIDEO_WATCH_MIN_SEC");
  const maxSecRaw = envWatchSec("VIDEO_WATCH_MAX_SEC");

  if (minSecRaw !== undefined && maxSecRaw !== undefined) {
    const lo = Math.min(minSecRaw, maxSecRaw);
    const hi = Math.max(minSecRaw, maxSecRaw);
    return Math.max(0, Math.min(durationSec - 0.5, randFloat(lo, hi)));
  }
  if (minSecRaw !== undefined) {
    return Math.max(0, Math.min(durationSec - 0.5, Math.max(byRatio, minSecRaw)));
  }
  if (maxSecRaw !== undefined) {
    return Math.max(0, Math.min(durationSec - 0.5, Math.min(byRatio, maxSecRaw)));
  }
  return Math.max(0, Math.min(durationSec - 0.5, byRatio));
}

export type WaitYoutubeNearEndOptions = {
  /** По умолчанию из VIDEO_END_MIN_RATIO (или 0.9). */
  ratioMin?: number;
  /** По умолчанию из VIDEO_END_MAX_RATIO (или 1). */
  ratioMax?: number;
  /**
   * Если true — не применять VIDEO_WATCH_MIN_SEC / VIDEO_WATCH_MAX_SEC,
   * целевое время только из случайной доли в [ratioMin, ratioMax].
   */
  ignoreVideoWatchSecLimits?: boolean;
};

/**
 * Если открыта страница просмотра YouTube — ждём готовности `video`, при необходимости
 * запускаем воспроизведение и ждём, пока currentTime/duration не достигнет целевой доли.
 */
export async function waitForYoutubeVideoNearEndIfWatch(
  page: Page,
  opts?: WaitYoutubeNearEndOptions
): Promise<boolean> {
  try {
    await page.waitForURL(/youtube\.com\/watch\?v=/, { timeout: 60_000 });
  } catch {
    if (!isWatchUrl(page.url())) return false;
  }

  const minR = opts?.ratioMin ?? envRatio("VIDEO_END_MIN_RATIO", 0.9);
  const maxR = opts?.ratioMax ?? envRatio("VIDEO_END_MAX_RATIO", 1);
  const target = randomTargetRatioInRange(minR, maxR);
  const ignoreVideoWatchLimits = opts?.ignoreVideoWatchSecLimits === true;
  const timeoutMs = envTimeoutMs();
  let lastKnownRatio = 0;
  let targetWatchSec: number | null = null;

  videoLog("страница watch", {
    url: page.url(),
    targetRatio: Number(target.toFixed(4)),
    nearEndTimeoutMs: timeoutMs === 0 ? "none" : timeoutMs,
    progressIntervalMs: progressTickIntervalMs(),
  });

  const retryMax = envRetryMax();
  let attempt = 0;
  while (true) {
    attempt++;
    videoLog("ожидание прогресса", { attempt, retryMax });

    await waitVideoReady(page);

    const snapReady = await page.evaluate(evalVideoSnapshot);
    if (
      snapReady &&
      Number.isFinite(snapReady.duration) &&
      snapReady.duration > 0
    ) {
      if (targetWatchSec === null) {
        targetWatchSec = resolveTargetWatchSec(
          snapReady.duration,
          target,
          ignoreVideoWatchLimits
        );
      }
      const r = snapReady.currentTime / snapReady.duration;
      if (Number.isFinite(r) && r >= 0) lastKnownRatio = Math.max(lastKnownRatio, r);
      const targetRatioNow =
        snapReady.duration > 0
          ? Math.max(0, Math.min(1, (targetWatchSec ?? 0) / snapReady.duration))
          : 0;
      videoLog("метаданные плеера", {
        durationSec: Number(snapReady.duration.toFixed(2)),
        targetTimeSec: Number((targetWatchSec ?? 0).toFixed(2)),
        targetRatioNow: Number(targetRatioNow.toFixed(4)),
        watchMinSec: envWatchSec("VIDEO_WATCH_MIN_SEC") ?? null,
        watchMaxSec: envWatchSec("VIDEO_WATCH_MAX_SEC") ?? null,
        paused: snapReady.paused,
        playbackRate: snapReady.playbackRate,
        readyState: snapReady.readyState,
      });
    }

    await page.evaluate(function () {
      const v =
        document.querySelector("ytd-player video") ??
        document.querySelector("#movie_player video") ??
        document.querySelector("video");
      if (v && (v as HTMLVideoElement).paused) void (v as HTMLVideoElement).play();
    });

    if (targetWatchSec === null) {
      const s = await page.evaluate(evalVideoSnapshot);
      if (s && Number.isFinite(s.duration) && s.duration > 0) {
        targetWatchSec = resolveTargetWatchSec(
          s.duration,
          target,
          ignoreVideoWatchLimits
        );
      }
    }

    const tickMs = progressTickIntervalMs();
    const logProgressSnapshot = (): void => {
      void Promise.all([
        page.evaluate(evalVideoSnapshot),
        page.evaluate(evalIsAdShowing),
      ]).then(([s, isAd]) => {
        if (!s || !Number.isFinite(s.duration) || s.duration <= 0) return;
        const pct = (s.currentTime / s.duration) * 100;
        const rr = s.currentTime / s.duration;
        if (!isAd && Number.isFinite(rr) && rr >= 0) {
          lastKnownRatio = Math.max(lastKnownRatio, rr);
        }
        const needPercent =
          targetWatchSec !== null && s.duration > 0
            ? (targetWatchSec / s.duration) * 100
            : target * 100;
        videoLog("прогресс", {
          currentSec: Number(s.currentTime.toFixed(2)),
          durationSec: Number(s.duration.toFixed(2)),
          percent: Number(pct.toFixed(2)),
          paused: s.paused,
          ad: isAd,
          needPercent: Number(needPercent.toFixed(2)),
        });
      });
    };
    logProgressSnapshot();
    const tick = setInterval(logProgressSnapshot, tickMs);

    try {
      await page.waitForFunction(
        function ({ targetSec }: { targetSec: number }) {
          const player = document.querySelector("#movie_player");
          if (player && (player as Element).classList.contains("ad-showing")) {
            return false;
          }
          const root = document.querySelector("#movie_player") ?? document;
          const text = (root.textContent || "").toLowerCase();
          if (
            (text.includes("something went wrong") && text.includes("try again")) ||
            (text.includes("try again later") && text.includes("something went wrong"))
          ) {
            throw new Error("YT_PLAYBACK_ERROR_OVERLAY");
          }

          const v =
            document.querySelector("ytd-player video") ??
            document.querySelector("#movie_player video") ??
            document.querySelector("video");
          if (!v) return false;
          const d = (v as HTMLVideoElement).duration;
          if (typeof d !== "number" || !Number.isFinite(d) || d <= 0) return false;
          return (v as HTMLVideoElement).currentTime >= targetSec;
        },
        { targetSec: targetWatchSec ?? Number.MAX_SAFE_INTEGER },
        {
          timeout: timeoutMs === 0 ? 0 : timeoutMs,
          polling: 500,
        }
      );
      break;
    } catch (e) {
      // Если это оверлей ошибки YouTube — пробуем восстановиться.
      const hasOverlay = await page.evaluate(evalHasYtPlaybackErrorOverlay).catch(() => false);
      if (!hasOverlay) throw e;

      if (attempt > retryMax) {
        videoLog("ошибка YouTube, превышен лимит ретраев", { attempt, retryMax });
        throw e;
      }
      const cd = errorCooldownMs();
      const before = await page.evaluate(evalVideoSnapshot).catch(() => null);
      const beforeRatio =
        before && Number.isFinite(before.duration) && before.duration > 0
          ? before.currentTime / before.duration
          : 0;
      const resumeRatio = Math.max(
        0,
        Math.min(1, Math.max(lastKnownRatio, beforeRatio))
      );
      const driftSec = resumeDriftSec();
      videoLog("ошибка YouTube, восстановление через F5", {
        attempt,
        cooldownMs: cd,
        resumeRatio: Number(resumeRatio.toFixed(4)),
        driftSec: Number(driftSec.toFixed(2)),
      });
      await page.waitForTimeout(cd);
      const reloadWay = await reloadViaNutJsWithFallback(page);
      videoLog("перезагрузка через nut.js", { way: reloadWay });
      await page.waitForTimeout(randFloat(3000, 5000));
      await seekApproxByNutJs(page, resumeRatio, driftSec);
      continue;
    } finally {
      clearInterval(tick);
    }
  }

  const snapDone = await page.evaluate(evalVideoSnapshot);
  if (snapDone && Number.isFinite(snapDone.duration) && snapDone.duration > 0) {
    const finalPct = (snapDone.currentTime / snapDone.duration) * 100;
    videoLog("целевая доля достигнута", {
      currentSec: Number(snapDone.currentTime.toFixed(2)),
      durationSec: Number(snapDone.duration.toFixed(2)),
      percent: Number(finalPct.toFixed(2)),
    });
  } else {
    videoLog("целевая доля достигнута (снимок плеера недоступен)");
  }

  return true;
}
