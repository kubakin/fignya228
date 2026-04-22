import type { Page } from "playwright";

/** Stage2 watch target ratio (with legacy aliases). */
export function resolveStage2VideoEndRatios(): { min: number; max: number } {
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

export function stage2TimeoutMs(): number {
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

export async function hasCaptchaOrVerification(page: Page): Promise<boolean> {
  try {
    const url = page.url().toLowerCase();
    if (
      url.includes("captcha") ||
      url.includes("sorry") ||
      url.includes("consent.youtube.com")
    ) {
      return true;
    }
    const bodyText = await page.evaluate(
      () => (document.body?.innerText || "").toLowerCase()
    );
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

export async function stage2DirectLinkStrategy(opts: {
  page: Page;
  channelTargetHref?: string;
  videoTargetHref?: string;
  navigateByAddressBar: (query: string) => Promise<void>;
  ensureVideoPlayingIfPaused: (page: Page) => Promise<void>;
}): Promise<void> {
  const directHref =
    opts.videoTargetHref?.trim() || opts.channelTargetHref?.trim() || "";
  if (!directHref) {
    throw new Error(
      "stage2 directLinkStrategy: no direct link available (VIDEO_TARGET_HREF/CHANNEL_TARGET_HREF)."
    );
  }
  console.log(`[stage2] directLinkStrategy navigate: ${directHref}`);
  await opts.navigateByAddressBar(directHref);
  await opts.page
    .waitForLoadState("domcontentloaded", { timeout: 60_000 })
    .catch(() => {});
  await opts.ensureVideoPlayingIfPaused(opts.page);
}
