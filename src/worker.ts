/**
 * Worker mode:
 * - polls task endpoint (when idle);
 * - starts existing `fill` flow with env built from task payload.
 *
 * Required env for worker:
 *   TARGET_URL=<task endpoint URL>
 *
 * Task JSON → env (see buildTaskEnv):
 *   youtubeVideoUrl → VIDEO_TARGET_HREF
 *   youtubeChannelUrl → CHANNEL_TARGET_HREF
 *   youtubeChannelName → CHANNEL_TARGET_NAME
 *   youtubeChannelDescription / youtubeChanngelDescription → TEXT (stage1 search)
 *   TEXT: if videoPrefix set → videoPrefix + " " + youtubeVideoDescription (пробел между);
 *         if videoPrefix empty → youtubeChannelDescription / youtubeChanngelDescription (не одно youtubeVideoDescription).
 *   youtubeVideoDescription → VIDEO_TARGET_NAME (optional); в TEXT только вместе с videoPrefix
 *   teamApiKey → TEAM_API_KEY
 *
 * Optional:
 *   TASK_POLL_INTERVAL_MS=120000
 *   UPDATE_CHECK_INTERVAL_MS=15000
 */

import { config as loadEnv } from "dotenv";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";

loadEnv({ path: resolve(process.cwd(), ".env") });

type TaskPayload = {
  hasTask?: boolean;
  videoPrefix?: string;
  taskId?: string;
  /** Server typo; some responses use this instead of taskId */
  tastId?: string;
  teamApiKey?: string;
  youtubeVideoUrl?: string;
  youtubeChannelUrl?: string;
  youtubeChannelName?: string;
  /** Stage1 search query: channel / project description (preferred). */
  youtubeChannelDescription?: string;
  /** Legacy typo in API DTO */
  youtubeChanngelDescription?: string;
  youtubeVideoDescription?: string;
  config?: Record<string, unknown>;
};

function envWorkerScript(): string {
  const s = process.env.WORKER_RUN_SCRIPT?.trim();
  return s && s.length > 0 ? s : "fill";
}

function envPollIntervalMs(): number {
  const n = Number(process.env.TASK_POLL_INTERVAL_MS ?? 120_000);
  return Number.isFinite(n) && n >= 5_000 ? Math.floor(n) : 120_000;
}

function envUpdateIntervalMs(): number {
  const n = Number(process.env.UPDATE_CHECK_INTERVAL_MS ?? 15_000);
  return Number.isFinite(n) && n >= 5_000 ? Math.floor(n) : 15_000;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function taskIdOf(task: TaskPayload): string {
  return (task.taskId ?? task.tastId ?? "").trim();
}

async function fetchTask(): Promise<TaskPayload | null> {
  const endpoint = process.env.TARGET_URL?.trim();
  if (!endpoint) {
    throw new Error("TARGET_URL is required (task endpoint URL).");
  }
  const resp = await fetch(endpoint, {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
  });
  if (!resp.ok) {
    throw new Error(`Task endpoint returned ${resp.status}`);
  }
  const body = (await resp.json()) as unknown;
  if (!body || typeof body !== "object") return null;
  console.log(body)
  const obj = body as Record<string, unknown>;
  if (obj.hasTask === false) return null;
  if (obj.task === null || obj.task === undefined) {
    // server may return {task: null}
    if ("task" in obj) return null;
  }

  // supported response shapes:
  // 1) direct task object
  // 2) { task: {...} }
  // 3) { data: {...} }
  const direct = body as TaskPayload;
  if (
    direct.taskId ||
    direct.tastId ||
    direct.youtubeVideoUrl ||
    direct.youtubeChannelUrl
  ) {
    return direct;
  }
  if (obj.task && typeof obj.task === "object") return obj.task as TaskPayload;
  if (obj.data && typeof obj.data === "object") return obj.data as TaskPayload;
  return null;
}

async function pullAndDetectUpdates(): Promise<boolean> {
  if (!existsSync(resolve(process.cwd(), ".git"))) {
    console.warn("[worker] update check skipped: .git directory not found in current working dir");
    return false;
  }
  // lightweight git check using shell command execution via child process
  const cmd = process.platform === "win32" ? "cmd.exe" : "sh";
  const args =
    process.platform === "win32"
      ? ["/d", "/s", "/c", "git rev-parse HEAD && git pull --ff-only && git rev-parse HEAD"]
      : ["-lc", "git rev-parse HEAD && git pull --ff-only && git rev-parse HEAD"];
  const child = spawn(cmd, args, {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let out = "";
  let err = "";
  child.stdout.on("data", (d) => {
    out += String(d);
  });
  child.stderr.on("data", (d) => {
    err += String(d);
  });
  const code = await new Promise<number>((resolveCode) => {
    child.on("exit", (c) => resolveCode(c ?? 1));
    child.on("error", () => resolveCode(1));
  });
  if (code !== 0) {
    const reason = err.trim() || "git command failed";
    console.warn(`[worker] update check failed: ${reason}`);
    return false;
  }
  const lines = out
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (lines.length < 2) return false;
  const before = lines[0]!;
  const after = lines[lines.length - 1]!;
  return before !== after;
}

function restartWorkerSelf(): void {
  const safeEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined || v === null) continue;
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) continue;
    safeEnv[k] = String(v);
  }
  const child =
    process.platform === "win32"
      ? spawn(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", "npm run worker"], {
          cwd: process.cwd(),
          env: safeEnv,
          stdio: "inherit",
          windowsHide: true,
          detached: true,
        })
      : spawn("npm", ["run", "worker"], {
          cwd: process.cwd(),
          env: safeEnv,
          stdio: "inherit",
          detached: true,
        });
  child.unref();
}

function restartWorkerViaUpdater(): void {
  const safeEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined || v === null) continue;
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) continue;
    safeEnv[k] = String(v);
  }

  const updater =
    process.platform === "win32"
      ? spawn(
          process.env.ComSpec ?? "cmd.exe",
          [
            "/d",
            "/s",
            "/c",
            "timeout /t 2 /nobreak >nul && git pull --ff-only && npm run worker",
          ],
          {
            cwd: process.cwd(),
            env: safeEnv,
            stdio: "inherit",
            windowsHide: true,
            detached: true,
          }
        )
      : spawn("sh", ["-lc", "sleep 2 && git pull --ff-only && npm run worker"], {
          cwd: process.cwd(),
          env: safeEnv,
          stdio: "inherit",
          detached: true,
        });

  updater.unref();
}

function toEnvStringMap(config: Record<string, unknown> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!config) return out;
  for (const [k, v] of Object.entries(config)) {
    if (v === undefined || v === null) continue;
    // Windows child_process can throw EINVAL on invalid env keys.
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) {
      console.warn(`[worker] skip invalid env key from config: ${k}`);
      continue;
    }
    out[k] = String(v);
  }
  return out;
}

function buildTaskEnv(task: TaskPayload): Record<string, string> {
  const cfg = toEnvStringMap(task.config);
  const out: Record<string, string> = { ...cfg };
  // Task DTO → fill env:
  // - youtubeVideoUrl → VIDEO_TARGET_HREF (target watch URL / fallback / video search)
  // - youtubeChannelUrl → CHANNEL_TARGET_HREF
  // - youtubeChannelDescription (or typo youtubeChanngelDescription) → TEXT (stage1 search query)
  // - TEXT: videoPrefix + youtubeVideoDescription; без videoPrefix → описание канала (channgel typo)
  if (task.youtubeChannelUrl) out.CHANNEL_TARGET_HREF = task.youtubeChannelUrl;
  if (task.youtubeChannelName) out.CHANNEL_TARGET_NAME = task.youtubeChannelName;
  if (task.youtubeVideoUrl) out.VIDEO_TARGET_HREF = task.youtubeVideoUrl;
  if (task.youtubeVideoDescription && !out.VIDEO_TARGET_NAME) {
    out.VIDEO_TARGET_NAME = task.youtubeVideoDescription;
  }
  if (task.teamApiKey && !out.TEAM_API_KEY) {
    out.TEAM_API_KEY = task.teamApiKey;
  }

  // Stage1 search TEXT (unless config sets TEXT)
  if (!out.TEXT) {
    const prefix = task.videoPrefix?.trim() ?? "";
    if (prefix.length > 0) {
      const vidDesc = task.youtubeVideoDescription?.trim() ?? "";
      out.TEXT = vidDesc.length > 0 ? `${prefix} ${vidDesc}` : prefix;
    } else {
      out.TEXT =
        task.youtubeChannelDescription?.trim() ||
        task.youtubeChanngelDescription?.trim() ||
        task.youtubeChannelName?.trim() ||
        "";
    }
  }

  // keep reasonable defaults if server config does not provide them
  if (!out.STAGE) out.STAGE = "both";
  if (!out.INPUT_SELECTOR) out.INPUT_SELECTOR = "input[name=\"search_query\"]";
  return out;
}

async function runFillForTask(task: TaskPayload): Promise<number> {
  const taskEnv = buildTaskEnv(task);
  const id = taskIdOf(task);
  if (!id) {
    console.error("[worker] task skipped: missing taskId in payload");
    return 1;
  }
  const runScript = envWorkerScript();
  console.log(`[worker] starting task ${id}`);

  const safeEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries({ ...process.env, ...taskEnv, TASK_ID: id })) {
    if (v === undefined || v === null) continue;
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) continue;
    safeEnv[k] = String(v);
  }

  const child =
    process.platform === "win32"
      ? spawn(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", `npm run ${runScript}`], {
          cwd: process.cwd(),
          env: safeEnv,
          stdio: "inherit",
          windowsHide: true,
        })
      : spawn("npm", ["run", runScript], {
          cwd: process.cwd(),
          env: safeEnv,
          stdio: "inherit",
        });

  const exitCode = await new Promise<number>((resolveExit) => {
    child.on("exit", (code) => resolveExit(code ?? 1));
    child.on("error", () => resolveExit(1));
  });

  console.log(`[worker] task ${id} finished with code ${exitCode} (script=${runScript})`);
  return exitCode;
}

async function main(): Promise<void> {
  const endpoint = process.env.TARGET_URL?.trim();
  if (!endpoint) {
    throw new Error("TARGET_URL is required in worker mode (task endpoint URL).");
  }
  const pollMs = envPollIntervalMs();
  const updateMs = envUpdateIntervalMs();
  console.log(
    `[worker] started, endpoint=${endpoint}, taskPoll=${pollMs}ms, updateCheck=${updateMs}ms`
  );

  let nextTaskAt = Date.now();
  let nextUpdateAt = Date.now();
  let busy = false;

  while (true) {
    if (busy) {
      await sleep(1000);
      continue;
    }

    const now = Date.now();
    try {
      if (now >= nextUpdateAt) {
        busy = true;
        const updated = await pullAndDetectUpdates();
        nextUpdateAt = Date.now() + updateMs;
        busy = false;
        if (updated) {
          console.log("[worker] updates found, stopping worker to apply update");
          restartWorkerViaUpdater();
          process.exit(0);
        }
      }

      if (now >= nextTaskAt) {
        busy = true;
        const task = await fetchTask();
        nextTaskAt = Date.now() + pollMs;
        if (!task) {
          console.log("[worker] no task");
        } else {
          await runFillForTask(task);
        }
        busy = false;
      }
    } catch (e) {
      busy = false;
      console.error("[worker] poll/run error:", e);
    }
    await sleep(1000);
  }
}

void main().catch((e) => {
  console.error("[worker] fatal error:", e);
  process.exit(1);
});

