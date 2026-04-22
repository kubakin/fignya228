import { keyboard, sleep } from "@nut-tree-fork/nut-js";
import { Key } from "@nut-tree-fork/shared";
import type { Page } from "playwright";
import { createBrowserSession } from "../browser/browser-session.js";
import { clearFocusedField, pressEnterAfterTyping, resolveTypoRatio, typeTextWithNut } from "../browser/human-typing.js";
import { runHumanScrollDownPhase } from "../browser/human-scroll.js";
import { nutHumanMoveAndClick } from "../browser/nut-move-click.js";
import { waitForYoutubeVideoNearEndIfWatch } from "../watch/wait-youtube-near-end.js";
import { randFloat } from "../browser/mouse-path.js";

function homeVideosCount(): number {
  const n = Number(process.env.TEST_HOME_VIDEOS_COUNT ?? "2");
  if (!Number.isFinite(n) || n < 1) return 2;
  return Math.min(5, Math.floor(n));
}

async function gotoByAddressBar(url: string): Promise<void> {
  keyboard.config.autoDelayMs = 0;
  await sleep(randFloat(180, 420));
  if (process.platform === "darwin") {
    await keyboard.type(Key.LeftSuper, Key.L);
  } else {
    await keyboard.type(Key.LeftControl, Key.L);
  }
  await sleep(randFloat(120, 260));
  await keyboard.type(url);
  await sleep(randFloat(120, 260));
  await keyboard.type(Key.Enter);
  await sleep(randFloat(900, 1800));
}

async function clickYoutubeHomeLogo(page: Page): Promise<boolean> {
  const idx = await page.evaluate(function () {
    const selectors = [
      "a#logo",
      "ytd-topbar-logo-renderer a#logo",
      "a[aria-label='YouTube Home']",
      "a[title='YouTube Home']",
      "a[href='/']",
    ];
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    for (let s = 0; s < selectors.length; s++) {
      const nodes = document.querySelectorAll(selectors[s]!);
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i] as Element;
        const r = n.getBoundingClientRect();
        const intersects =
          r.width > 0 &&
          r.height > 0 &&
          r.bottom > 0 &&
          r.right > 0 &&
          r.left < vw &&
          r.top < vh;
        if (!intersects) continue;
        return { selector: selectors[s]!, idx: i };
      }
    }
    return null;
  });
  if (!idx) return false;
  const logo = page.locator(idx.selector).nth(idx.idx);
  await logo.scrollIntoViewIfNeeded();
  await nutHumanMoveAndClick(logo);
  return true;
}

async function clickRandomVisibleWatchVideo(
  page: Page,
  keywords?: string[]
): Promise<boolean> {
  const kw = (keywords ?? [])
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
  const idx = await page.evaluate(function ({ keywords }: { keywords: string[] }) {
    const selectors = [
      "a#video-title",
      "a[href*='watch']",
      "ytd-rich-grid-media a#video-title-link",
      "ytd-rich-item-renderer a#video-title-link",
    ];
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const candidates: number[] = [];
    const nodes = document.querySelectorAll(selectors.join(","));
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i] as Element;
      const a = n as unknown as HTMLAnchorElement;
      const href = (a.href || a.getAttribute("href") || "").toLowerCase();
      if (!href.includes("watch")) continue;
      if (href.includes("/shorts/")) continue;
      if (href.includes("googleads") || href.includes("doubleclick")) continue;
      if (
        n.closest("ytd-display-ad-renderer") ||
        n.closest("ytd-promoted-sparkles-web-renderer") ||
        n.closest("ytd-promoted-video-renderer") ||
        n.closest("[data-ad-impressions]") ||
        n.closest("ad-button-hover-overlay-view-model")
      ) {
        continue;
      }
      const txt = (n.textContent || "").toLowerCase();
      if (txt.includes("реклама") || txt.includes("sponsored")) continue;
      if (keywords.length > 0) {
        let ok = false;
        for (let k = 0; k < keywords.length; k++) {
          if (txt.includes(keywords[k]!)) {
            ok = true;
            break;
          }
        }
        if (!ok) continue;
      }
      const r = n.getBoundingClientRect();
      const intersects =
        r.width > 0 &&
        r.height > 0 &&
        r.bottom > 0 &&
        r.right > 0 &&
        r.left < vw &&
        r.top < vh;
      if (!intersects) continue;
      candidates.push(i);
    }
    if (candidates.length === 0) return -1;
    return candidates[Math.floor(Math.random() * candidates.length)] ?? -1;
  }, { keywords: kw });

  if (idx < 0) return false;
  const link = page.locator("a#video-title, a[href*='watch'], ytd-rich-grid-media a#video-title-link, ytd-rich-item-renderer a#video-title-link").nth(idx);
  await link.scrollIntoViewIfNeeded();
  await nutHumanMoveAndClick(link);
  return true;
}

async function watchRandomRatio(page: Page): Promise<boolean> {
  return waitForYoutubeVideoNearEndIfWatch(page, {
    ratioMin: +process.env.WARMUP_RATIO_MIN! || 0.01,
    ratioMax: +process.env.WARMUP_RATIO_MAX! || 0.01,
    ignoreVideoWatchSecLimits: true,
  });
}

async function findRandomVideoByKeywordsAfterPhase(
  page: Page,
  keywords?: string[]
): Promise<void> {
  while (true) {
    // 1) после завершенной фазы скролла сначала ищем подходящее видео
    const clicked = await clickRandomVisibleWatchVideo(page, keywords);
    if (clicked) return;
    // 2) если не нашли — делаем один human scroll и повторяем
    await runHumanScrollDownPhase(page, 1);
  }
}

export async function runTestStrategy(
  theme: string,
  keywords?: string[]
): Promise<boolean> {
  const q = theme.trim();
  if (!q) {
    console.warn("[test-strategy] empty theme, skip");
    return false;
  }

  const typoRatio = resolveTypoRatio();
  const { page, close } = await createBrowserSession();
  try {
    await page.goto("https://youtube.com", { waitUntil: "domcontentloaded", timeout: 60_000 });
    await sleep(randFloat(900, 1800));

    const input = page.locator("input[name='search_query']").first();
    await input.waitFor({ state: "visible", timeout: 30_000 });
    console.log("Before click");
    await nutHumanMoveAndClick(input);
    console.log("After click");
    await clearFocusedField();
    console.log("Before type");
    await typeTextWithNut(q, { typoRatio });
    console.log("After type");
    await pressEnterAfterTyping();
    console.log("After press enter");
    await sleep(randFloat(1100, 2200));
    console.log("Before scroll down");
    await runHumanScrollDownPhase(page);
    console.log("After scroll down");
    await findRandomVideoByKeywordsAfterPhase(page, keywords);
    console.log("After click from search");
    await watchRandomRatio(page);

    const homeCount = homeVideosCount();
    for (let i = 0; i < homeCount; i++) {
      const byLogo = await clickYoutubeHomeLogo(page);
      if (!byLogo) {
        await gotoByAddressBar("https://youtube.com");
      }
      await page.waitForLoadState("domcontentloaded", { timeout: 60_000 }).catch(() => {});
      await sleep(randFloat(900, 1700));
      await runHumanScrollDownPhase(page);
      await findRandomVideoByKeywordsAfterPhase(page, keywords);
      await watchRandomRatio(page);
    }

    return true;
  } finally {
    await close();
  }
}

