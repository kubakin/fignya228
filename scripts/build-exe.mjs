/**
 * Сборка `dist/yt-worker.cjs` (esbuild) и `dist/yt-worker.exe` (@yao-pkg/pkg).
 *
 * Нативные модули @nut-tree-fork (системная мышь/клавиатура) платформенные:
 * итоговый .exe для Windows нужно собирать на Windows (или с node_modules под win32),
 * иначе внутри снимка останутся .node от текущей ОС.
 *
 * Playwright: при первом запуске .exe сам вызывает `playwright install chromium` (если не заданы
 *   PLAYWRIGHT_CDP_URL и SKIP_PLAYWRIGHT_BROWSER_INSTALL). Ошибки пишутся в yt-worker-errors.txt
 *   рядом с exe.
 *
 * Использование:
 *   npm run build:bundle   — только esbuild → dist/yt-worker.cjs
 *   npm run build:exe      — bundle + yt-worker.exe (цель node20-win-x64)
 */

import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const bundleOnly = process.argv.includes("--bundle-only");

const nutExternals = [
  "@nut-tree-fork/nut-js",
  "@nut-tree-fork/libnut",
  "@nut-tree-fork/shared",
  "@nut-tree-fork/provider-interfaces",
  "@nut-tree-fork/default-clipboard-provider",
  "@nut-tree-fork/node-mac-permissions",
];

async function runEsbuild() {
  mkdirSync(dist, { recursive: true });
  await esbuild.build({
    entryPoints: [join(root, "src/fill-input.ts")],
    bundle: true,
    platform: "node",
    target: "node20",
    format: "cjs",
    outfile: join(dist, "yt-worker.cjs"),
    external: ["playwright", ...nutExternals],
    logLevel: "info",
  });
}

function runPkg() {
  const target = process.env.PKG_TARGET?.trim() || "node20-win-x64";
  const out = join(dist, "yt-worker.exe");
  const pkgBin = join(
    dirname(require.resolve("@yao-pkg/pkg/package.json")),
    "lib-es5",
    "bin.js"
  );
  const r = spawnSync(
    process.execPath,
    [pkgBin, join(dist, "yt-worker.cjs"), "-t", target, "-o", out],
    { cwd: root, stdio: "inherit" }
  );
  if (r.error) throw r.error;
  if (r.status !== 0) process.exit(r.status ?? 1);
}

await runEsbuild();
console.log("esbuild: OK → dist/yt-worker.cjs");

if (bundleOnly) {
  process.exit(0);
}

if (process.platform !== "win32") {
  console.warn(
    "[build:exe] Сборка не на Windows: в .exe попадут нативные модули текущей ОС; " +
      "для реального использования на Windows пересоберите на Windows после npm ci."
  );
}

runPkg();
console.log("pkg: OK → dist/yt-worker.exe");
