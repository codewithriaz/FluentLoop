export interface DiffToken {
  word: string;
  status: "match" | "missing" | "extra";
}

export interface WordDiff {
  tokens: DiffToken[];
  matched: number;
  expected: number;
  /** Share of the original's words that appear, in order, in what was heard (0–1). */
  ratio: number;
}

/** Splits into display words and comparison keys (lowercase, no punctuation except apostrophes). */
function words(text: string): { word: string; key: string }[] {
  return text
    .replace(/[‘’]/g, "'")
    .split(/\s+/)
    .map((w) => ({ word: w, key: w.toLowerCase().replace(/[^\p{L}\p{N}']+/gu, "").replace(/^'+|'+$/g, "") }))
    .filter((w) => w.key);
}

/**
 * Aligns the original sentence with what speech-to-text heard (longest common subsequence of words).
 * This compares transcripts; it is not a pronunciation score.
 */
export function diffWords(original: string, heard: string): WordDiff {
  const a = words(original);
  const b = words(heard);
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      dp[i][j] = a[i].key === b[j].key ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const tokens: DiffToken[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i].key === b[j].key) {
      tokens.push({ word: a[i].word, status: "match" });
      i++;
      j++;
    } else if (j < b.length && (i >= a.length || dp[i][j + 1] >= dp[i + 1][j])) {
      tokens.push({ word: b[j].word, status: "extra" });
      j++;
    } else {
      tokens.push({ word: a[i].word, status: "missing" });
      i++;
    }
  }
  const matched = dp[0][0];
  return { tokens, matched, expected: a.length, ratio: a.length ? matched / a.length : 0 };
}
