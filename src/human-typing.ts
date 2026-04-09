/**
 * Ввод текста с переменными паузами и редкими «опечатками» (соседняя клавиша),
 * максимум ~5% позиций. Системный ввод — nut.js keyboard; в headless — Playwright.
 */

import { keyboard, sleep } from "@nut-tree-fork/nut-js";
import { Key } from "@nut-tree-fork/shared";
import { kStringMaxLength } from "node:buffer";
import type { Page } from "playwright";

function randFloat(lo: number, hi: number): number {
  return lo + Math.random() * (hi - lo);
}

/** ЙЦУКЕН (нижний регистр), строки как на типичной PC-раскладке */
const CYR_ROWS = [
  "ёйцукенгшщзхъ",
  "фывапролджэ",
  "ячсмитьбю",
];

/** QWERTY (нижний регистр) */
const LAT_ROWS = [
  "qwertyuiop[]",
  "asdfghjkl;'",
  "zxcvbnm,./",
];

const DIGITS = "0123456789";

function neighborsOnRows(rows: string[], lowerChar: string): string[] {
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    const c = row.indexOf(lowerChar);
    if (c === -1) continue;
    const set = new Set<string>();
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const nr = r + dr;
        const nc = c + dc;
        if (nr >= 0 && nr < rows.length && nc >= 0 && nc < rows[nr].length) {
          const ch = rows[nr][nc];
          if (ch !== undefined && ch !== " ") set.add(ch);
        }
      }
    }
    return [...set];
  }
  return [];
}

function digitNeighbors(ch: string): string[] {
  const i = DIGITS.indexOf(ch);
  if (i < 0) return [];
  const out: string[] = [];
  if (i > 0) out.push(DIGITS[i - 1]!);
  if (i < DIGITS.length - 1) out.push(DIGITS[i + 1]!);
  return out;
}

/** Соседние по физической клавиатуре (8 направлений), русская или латинская раскладка */
function neighborKeysForChar(ch: string): string[] {
  if (ch.length !== 1) return [];
  const lower = ch.toLowerCase();
  if (lower === " ") return ["б", "ю", "е", "о", "м", "."];
  let n = neighborsOnRows(CYR_ROWS, lower);
  if (n.length > 0) return n;
  n = neighborsOnRows(LAT_ROWS, lower);
  if (n.length > 0) return n;
  return digitNeighbors(lower);
}

function applySameCaseAs(template: string, oneChar: string): string {
  if (template.length !== 1 || oneChar.length !== 1) return oneChar;
  const t = template[0]!;
  const o = oneChar[0]!;
  const upper = t === t.toUpperCase() && t !== t.toLowerCase();
  return upper ? o.toUpperCase() : o.toLowerCase();
}

function pickTypoNeighbor(template: string): string | null {
  const nbs = neighborKeysForChar(template);
  if (nbs.length === 0) return null;
  const pick = nbs[Math.floor(Math.random() * nbs.length)]!;
  return applySameCaseAs(template, pick);
}

/** Доп. замедление из env (например 1.5 = на 50% дольше между символами). */
function delayScale(): number {
  const raw = process.env.TYPING_DELAY_MULTIPLIER?.trim();
  if (raw === undefined || raw === "") return 1;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 8) : 1;
}

function delayAfterChar(ch: string): number {
  let ms: number;
  if (ch === " ") ms = randFloat(220, 580);
  else if (",.;:!?—–-".includes(ch)) ms = randFloat(320, 880);
  else if (ch === "\n") ms = randFloat(450, 1100);
  else ms = randFloat(85, 420) * randFloat(0.65, 1.65);
  return ms * delayScale();
}

function maxTypoCount(len: number, ratio: number): number {
  if (len <= 0) return 0;
  return Math.floor(len * ratio);
}

function pickTypoIndices(
  chars: string[],
  maxTypos: number
): Set<number> {
  const pool: number[] = [];
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]!;
    if (pickTypoNeighbor(ch) !== null) pool.push(i);
  }
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  return new Set(pool.slice(0, Math.min(maxTypos, pool.length)));
}

async function typeOneNut(ch: string): Promise<void> {
  if (ch === "\n") {
    await keyboard.type(Key.Enter);
  } else {
    await keyboard.type(ch);
  }
}

export type HumanTypeOptions = {
  /** Доля позиций с опечаткой (по умолчанию 0.05) */
  typoRatio: number;
};

export async function typeTextWithNut(
  text: string,
  opts: HumanTypeOptions
): Promise<void> {
  keyboard.config.autoDelayMs = 0;
  const chars = [...text];
  const maxTypos = maxTypoCount(chars.length, opts.typoRatio);
  const typoAt = pickTypoIndices(chars, maxTypos);

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]!;
    if (typoAt.has(i)) {
      const wrong = pickTypoNeighbor(ch);
      if (wrong !== null) {
        await typeOneNut(wrong);
        await sleep(randFloat(140, 420) * delayScale());
        await keyboard.type(Key.Backspace);
        await sleep(randFloat(80, 260) * delayScale());
      }
    }
    await typeOneNut(ch);
    await sleep(delayAfterChar(ch));
  }
}

/** После текста — Enter (системно через nut или в сфокусированное поле в Playwright). */
export async function pressEnterAfterTyping(
  page: Page,
  useNutKeyboard: boolean
): Promise<void> {
  await sleep(randFloat(80, 260) * delayScale());
  if (useNutKeyboard) {
    keyboard.config.autoDelayMs = 0;
    await keyboard.type(Key.Enter);
  } else {
    await page.keyboard.press("Enter");
  }
  await sleep(randFloat(45, 160) * delayScale());
}

/** Очистка сфокусированного поля (Ctrl/Cmd+A, затем Backspace). */
export async function clearFocusedField(
  page: Page
): Promise<void> {
  await sleep(randFloat(60, 180) * delayScale());
  const combo = process.platform === "darwin" ? "Meta+A" : "Control+A";
  await page.keyboard.press(combo);
  await sleep(randFloat(40, 120) * delayScale());
  await page.keyboard.press("Backspace");
  await sleep(randFloat(50, 160) * delayScale());
}

export async function typeTextWithPlaywright(
  page: Page,
  text: string,
  opts: HumanTypeOptions
): Promise<void> {
  const chars = [...text];
  const maxTypos = maxTypoCount(chars.length, opts.typoRatio);
  const typoAt = pickTypoIndices(chars, maxTypos);

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]!;
    if (typoAt.has(i)) {
      const wrong = pickTypoNeighbor(ch);
      if (wrong !== null) {
        await page.keyboard.type(wrong);
        await sleep(randFloat(140, 420) * delayScale());
        await page.keyboard.press("Backspace");
        await sleep(randFloat(80, 260) * delayScale());
      }
    }
    if (ch === "\n") {
      await page.keyboard.press("Enter");
    } else {
      await page.keyboard.type(ch);
    }
    await sleep(delayAfterChar(ch));
  }
}

export function resolveTypoRatio(): number {
  const raw = process.env.TYPO_MAX_PERCENT ?? process.env.TYPO_RATIO;
  if (raw === undefined || raw === "") return 0.05;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 0.05;
  if (n > 1) return Math.min(n / 100, 0.25);
  return Math.min(n, 0.25);
}

export function shouldUseNutKeyboard(headless: boolean): boolean {
  if (headless) return false;
  const v = process.env.USE_SYSTEM_KEYBOARD?.trim().toLowerCase();
  if (v === "false" || v === "0" || v === "no") return false;
  return true;
}
