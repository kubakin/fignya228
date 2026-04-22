import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import { runTestStrategy } from "./test/test-strategy.js";
import { appendErrorLog, ensurePlaywrightBrowsersIfNeeded, setupGlobalErrorLogging } from "./runtime/exe-runtime.js";

loadEnv({ path: resolve(process.cwd(), ".env") });
setupGlobalErrorLogging();

function parseThemeArg(argv: string[]): string | undefined {
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--theme" && argv[i + 1]) return argv[i + 1];
  }
  return undefined;
}

function parseKeywordsArg(argv: string[]): string[] {
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--keywords" && argv[i + 1]) {
      return argv[i + 1]!
        .split(",")
        .map((x) => x.trim())
        .filter((x) => x.length > 0);
    }
  }
  return [];
}

async function main(): Promise<void> {
  const theme =
    parseThemeArg(process.argv)?.trim() ||
    process.env.TEST_THEME?.trim() ||
    process.env.TEXT?.trim() ||
    "";
  if (!theme) {
    throw new Error(
      "Theme is required. Use: npm run test:strategy -- --theme \"sport\" (or set TEST_THEME in .env)"
    );
  }
  const keywords = parseKeywordsArg(process.argv);

  ensurePlaywrightBrowsersIfNeeded();
  const ok = await runTestStrategy(theme, keywords);
  if (!ok) {
    throw new Error("test strategy finished without success");
  }
  console.log(`[test-strategy] success theme="${theme}"`);
}

void main().catch((err: unknown) => {
  appendErrorLog(err);
  console.error(err);
  process.exit(1);
});

