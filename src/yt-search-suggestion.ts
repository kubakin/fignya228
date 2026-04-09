/**
 * Если в запросе больше одного слова — подождать подсказки поиска YouTube
 * и кликнуть случайный вариант (курсор + клик через nut.js).
 */

import type { Page } from "playwright";
import { nutHumanMoveAndClick } from "./nut-move-click.js";

const DEFAULT_OPTION_SELECTOR =
  'div[role="option"].ytSuggestionComponentText.ytSuggestionComponentScrollMargin';

function randFloat(lo: number, hi: number): number {
  return lo + Math.random() * (hi - lo);
}

export function hasMultipleWords(text: string): boolean {
  return text.trim().split(/\s+/).filter(Boolean).length > 1;
}

/**
 * Для многословного запроса с окном браузера: разрез после случайной доли 50–80% символов,
 * чтобы клик по подсказке шёл «в процессе» набора, а не в конце.
 */
export function getPartialTypingSplitForSuggestion(
  text: string,
  headless: boolean
): { first: string; rest: string } | null {
  if (headless || !hasMultipleWords(text)) return null;
  const chars = [...text];
  if (chars.length < 2) return null;
  const frac = randFloat(0.5, 0.8);
  let splitAt = Math.floor(chars.length * frac);
  splitAt = Math.max(1, Math.min(chars.length - 1, splitAt));
  return {
    first: chars.slice(0, splitAt).join(""),
    rest: chars.slice(splitAt).join(""),
  };
}

export async function maybeClickRandomYtSuggestion(
  page: Page,
  text: string,
  headless: boolean
): Promise<void> {
  if (!hasMultipleWords(text) || headless) return;

  const sel =
    process.env.YT_SUGGESTION_OPTION_SELECTOR?.trim() || DEFAULT_OPTION_SELECTOR;
  const options = page.locator(sel);

  try {
    await options.first().waitFor({ state: "visible", timeout: 12_000 });
  } catch {
    return;
  }

  const count = await options.count();
  if (count === 0) return;

  const idx = Math.floor(Math.random() * count);
  await nutHumanMoveAndClick(options.nth(idx));
}
