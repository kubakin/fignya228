import { mouse, sleep, straightTo } from "@nut-tree-fork/nut-js";
import { Point } from "@nut-tree-fork/shared";
import type { Page } from "playwright";
import { runHumanScrollDownPhase } from "../browser/human-scroll.js";
import { randFloat } from "../browser/mouse-path.js";
import {
  nutHumanMoveAndClick,
  nutHumanMoveAndClickScreenPoint,
} from "../browser/nut-move-click.js";

function stage2PostClickNavigateTimeoutMs(): number {
  const n = Number(process.env.STAGE2_POST_CLICK_NAV_TIMEOUT_MS ?? 12_000);
  if (!Number.isFinite(n)) return 12_000;
  const ms = Math.floor(n);
  if (ms < 2_000) return 2_000;
  return Math.min(ms, 60_000);
}

async function waitForYoutubeWatchUrl(page: Page, timeoutMs: number): Promise<boolean> {
  try {
    await page.waitForFunction(
      function () {
        const url = location.href.toLowerCase();
        return url.includes("youtube.com/watch?v=");
      },
      { timeout: timeoutMs, polling: 300 }
    );
    return true;
  } catch {
    return false;
  }
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

export async function runExternalLinkPatchAndClickStrategy(opts: {
  page: Page;
  strategyName: "vkStrategy" | "landingStrategy";
  entryUrl: string;
  videoTargetHref: string;
  hoverCountMax: number;
  requireLoadBeforeScroll: boolean;
  linkClassPrefix?: string;
  navigateByAddressBar: (query: string) => Promise<void>;
  ensureVideoPlayingIfPaused: (page: Page) => Promise<void>;
}): Promise<void> {
  const tag = `[stage2][${opts.strategyName}]`;
  console.log(`${tag} start`, {
    entryUrl: opts.entryUrl,
    videoTargetHref: opts.videoTargetHref,
  });
  await opts.navigateByAddressBar(opts.entryUrl);
  await opts.page.waitForLoadState("domcontentloaded", { timeout: 60_000 }).catch(() => {});
  if (opts.requireLoadBeforeScroll) {
    await opts.page.waitForLoadState("load", { timeout: 60_000 }).catch(() => {});
  }
  await sleep(randFloat(1000, 2200));

  console.log(`${tag} initial human scroll`);
  await runHumanScrollDownPhase(opts.page);
  const hoverPoints = await opts.page.evaluate(
    function ({ hoverMax }: { hoverMax: number }) {
      const els = document.querySelectorAll("a, button, div, img, span");
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const chromeTop = window.outerHeight - window.innerHeight;
      const chromeLeft = window.outerWidth - window.innerWidth;
      const points: Array<{ x: number; y: number }> = [];
      for (let i = 0; i < els.length && points.length < hoverMax; i++) {
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
    },
    { hoverMax: opts.hoverCountMax }
  );
  console.log(`${tag} hover points prepared`, { count: hoverPoints.length });
  for (const p of hoverPoints) {
    mouse.config.autoDelayMs = 0;
    mouse.config.mouseSpeed = randFloat(340, 860);
    await mouse.move(straightTo(new Point(p.x, p.y)));
    await sleep(randFloat(250, 700));
  }
  console.log(`${tag} hover simulation done`);

  const linkInfo = await opts.page.evaluate(
    function ({
      youtubeHref,
      classPrefix,
    }: {
      youtubeHref: string;
      classPrefix?: string;
    }) {
      const links = document.querySelectorAll("a[href]");
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const absHrefRe = /^https?:\/\//i;
      for (let j = 0; j < links.length; j++) {
        (links[j] as HTMLAnchorElement).removeAttribute("data-yt-worker-patched");
      }
      for (let i = 0; i < links.length; i++) {
        const a = links[i] as HTMLAnchorElement;
        if (classPrefix) {
          const classMatches = Array.from(a.classList).some((cls) =>
            cls.startsWith(classPrefix)
          );
          if (!classMatches) continue;
        }
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
    },
    { youtubeHref: opts.videoTargetHref, classPrefix: opts.linkClassPrefix }
  );
  console.log(`${tag} link patch result`, linkInfo);
  if (!linkInfo) {
    throw new Error(`stage2 ${opts.strategyName}: no visible absolute link found to patch href`);
  }
  const link = opts.page.locator("a[data-yt-worker-patched='1']").first();
  await link.scrollIntoViewIfNeeded();
  const modalDismissed = await dismissModalboxIfVisible(opts.page);
  if (modalDismissed) {
    console.log(`${tag} modalbox dismissed before link click`);
  }
  console.log(`${tag} clicking patched link`);
  await nutHumanMoveAndClick(link);
  await opts.page.waitForLoadState("domcontentloaded", { timeout: 60_000 }).catch(() => {});
  const navOk = await waitForYoutubeWatchUrl(opts.page, stage2PostClickNavigateTimeoutMs());
  if (!navOk) {
    console.warn(`${tag} post-click navigation stalled, fallback to direct URL`);
    await opts.navigateByAddressBar(opts.videoTargetHref);
    await opts.page.waitForLoadState("domcontentloaded", { timeout: 60_000 }).catch(() => {});
  }
  console.log(`${tag} reached target page, ensure playback`);
  await opts.ensureVideoPlayingIfPaused(opts.page);
  console.log(`${tag} done`);
}
