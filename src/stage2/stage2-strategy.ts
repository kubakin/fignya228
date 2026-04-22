export type Stage2Strategy =
  | "channelSearchStrategy"
  | "webChannelSearchStrategy"
  | "webVideoSearchStrategy"
  | "directLinkStrategy"
  | "vkStrategy"
  | "landingStrategy";

type ResolveStage2StrategyOptions = {
  stage2Name?: string;
  channelTargetHref?: string;
  videoTargetHref?: string;
  videoTargetName?: string;
  vkGroupUrl?: string;
  landingUrl?: string;
};

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

export function resolveStage2Strategy(
  opts: ResolveStage2StrategyOptions
): Stage2Strategy {
  // return 'channelSearchStrategy'
  const candidates: Array<{ strategy: Stage2Strategy; weight: number }> = [];
  const s1 = parseProb("STAGE2_STRATEGY_CHANNEL_SEARCH_PROB", parseProb("STAGE2_VARIANT1_PROB", 0.0));
  // const s2 = parseProb("STAGE2_STRATEGY_WEB_CHANNEL_PROB", parseProb("STAGE2_VARIANT2_PROB", 0.3));
  // const s3 = parseProb("STAGE2_STRATEGY_WEB_VIDEO_PROB", parseProb("STAGE2_VARIANT3_PROB", 0.7));
  const s4 = parseProb("STAGE2_STRATEGY_DIRECT_LINK_PROB", 0.1);
  const s5 = parseProb("STAGE2_STRATEGY_VK_PROB", 0.1);
  const s6 = parseProb("STAGE2_STRATEGY_LANDING_PROB", 0.1);
  if (opts.channelTargetHref && opts.videoTargetHref) {
    candidates.push({ strategy: "channelSearchStrategy", weight: s1 });
  }
  //пока не используем
  // if (opts.stage2Name && opts.videoTargetHref) {
  //   candidates.push({ strategy: "webChannelSearchStrategy", weight: s2 });
  // }
  // if (opts.videoTargetName || opts.videoTargetHref) {
  //   candidates.push({ strategy: "webVideoSearchStrategy", weight: s3 });
  // }
  if (opts.videoTargetHref || opts.channelTargetHref) {
    candidates.push({ strategy: "directLinkStrategy", weight: s4 });
  }
  if (opts.vkGroupUrl && opts.videoTargetHref) {
    candidates.push({ strategy: "vkStrategy", weight: s5 });
  }
  if (opts.landingUrl && opts.videoTargetHref) {
    candidates.push({ strategy: "landingStrategy", weight: s6 });
  }
  console.log(
    `[stage2] strategy weights channel=${s1} direct=${s4} vk=${s5} landing=${s6}; inputs channelName=${Boolean(
      opts.stage2Name
    )} channelHref=${Boolean(opts.channelTargetHref)} videoHref=${Boolean(
      opts.videoTargetHref
    )} videoName=${Boolean(opts.videoTargetName)} vkGroup=${Boolean(
      opts.vkGroupUrl
    )} landingUrl=${Boolean(opts.landingUrl)}`
  );
  return pickWeightedStrategy(candidates);
}
