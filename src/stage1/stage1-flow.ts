import { sleep } from "@nut-tree-fork/nut-js";
import type { Locator, Page } from "playwright";
import { typeTextWithNut, pressEnterAfterTyping } from "../browser/human-typing.js";
import {
  getPartialTypingSplitForSuggestion,
  maybeClickRandomYtSuggestion,
} from "../browser/yt-search-suggestion.js";
import { runHumanScrollDownPhase } from "../browser/human-scroll.js";
import { nutClickVideoTitleLink } from "../browser/click-video-title.js";
import { waitForYoutubeVideoNearEndIfWatch } from "../watch/wait-youtube-near-end.js";
import { nutHumanMoveAndClick } from "../browser/nut-move-click.js";
import { randFloat } from "../browser/mouse-path.js";

type SidebarPick = { selector: string; idx: number } | null;

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

export async function executeStage1Flow(opts: {
  runStage1: boolean;
  runStage1Base: boolean;
  channelMode: boolean;
  text: string;
  typoRatio: number;
  page: Page;
  input: Locator;
  onStage1Process: () => Promise<void>;
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
    await opts.onStage1Process();
  }
  return { stage1Completed, videoNearEndDone };
}
