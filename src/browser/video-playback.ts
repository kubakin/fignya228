import { keyboard, sleep } from "@nut-tree-fork/nut-js";
import { Key } from "@nut-tree-fork/shared";
import type { Page } from "playwright";
import { randFloat } from "./mouse-path.js";
import {
  nutHumanMoveAndClick,
  nutHumanMoveAndClickScreenPoint,
} from "./nut-move-click.js";

/**
 * Screen pixel for a reliable play interaction: overlay play control or lower player area.
 * Avoids clicking the first <video> in DOM (can be wrong/hidden and send cursor off-screen).
 */
async function resolveYoutubePlaybackClickScreenPx(
  page: Page
): Promise<{ x: number; y: number } | null> {
  // One function without nested helpers; avoids transpiled helper references inside evaluate.
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

export async function ensureVideoPlayingIfPaused(page: Page): Promise<void> {
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
