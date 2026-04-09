/**
 * Worker mode:
 * - polls task endpoint every 5 minutes (when idle);
 * - starts existing `fill` flow with env built from task payload.
 *
 * Required env for worker:
 *   TARGET_URL=<task endpoint URL>
 *
 * Optional:
 *   TASK_POLL_INTERVAL_MS=300000
 */

import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import { spawn } from "node:child_process";

loadEnv({ path: resolve(process.cwd(), ".env") });

type TaskPayload = {
  taskId?: string;
  youtubeVideoUrl?: string;
  youtubeChannelUrl?: string;
  youtubeChannelName?: string;
  youtubeChanngelDescription?: string;
  youtubeVideoDescription?: string;
  config?: Record<string, unknown>;
};

function envWorkerScript(): string {
  const s = process.env.WORKER_RUN_SCRIPT?.trim();
  return s && s.length > 0 ? s : "fill";
}

function envPollIntervalMs(): number {
  const n = Number(process.env.TASK_POLL_INTERVAL_MS ?? 300_000);
  return Number.isFinite(n) && n >= 5_000 ? Math.floor(n) : 300_000;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function taskIdOf(task: TaskPayload): string {
  return (task.taskId ?? "").trim();
}

async function fetchTask(): Promise<TaskPayload | null> {
  const resp = await fetch(process.env.TARGET_URL?.trim()!, {
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

  const obj = body as Record<string, unknown>;
  if (obj.task === null || obj.task === undefined) {
    // server may return {task: null}
    if ("task" in obj) return null;
  }

  // supported response shapes:
  // 1) direct task object
  // 2) { task: {...} }
  // 3) { data: {...} }
  const direct = body as TaskPayload;
  if (direct.taskId || direct.youtubeVideoUrl || direct.youtubeChannelUrl) {
    return direct;
  }
  if (obj.task && typeof obj.task === "object") return obj.task as TaskPayload;
  if (obj.data && typeof obj.data === "object") return obj.data as TaskPayload;
  return null;
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

  // map task fields to current automation env keys (config can override these later)
  if (task.youtubeChannelUrl) out.CHANNEL_TARGET_HREF = task.youtubeChannelUrl;
  if (task.youtubeChannelName) out.CHANNEL_TARGET_NAME = task.youtubeChannelName;
  if (task.youtubeVideoUrl) out.VIDEO_TARGET_HREF = task.youtubeVideoUrl;

  // stage1 search text fallback from task payload if config/TEXT not provided
  if (!out.TEXT) {
    out.TEXT =
      task.youtubeVideoDescription ??
      task.youtubeChanngelDescription ??
      task.youtubeChannelName ??
      "";
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
  const endpoint = 'https://youtube.com'
  console.log(process.env.TARGET_URL?.trim())

  const pollMs = envPollIntervalMs();
  console.log(`[worker] started, endpoint=${endpoint}, poll=${pollMs}ms`);

  while (true) {
    try {
      const task = await fetchTask();
      if (!task) {
        console.log("[worker] no task");
      } else {
        await runFillForTask(task);
      }
    } catch (e) {
      console.error("[worker] poll/run error:", e);
    }
    await sleep(pollMs);
  }
}

void main().catch((e) => {
  console.error("[worker] fatal error:", e);
  process.exit(1);
});

