import crypto from "node:crypto";

/**
 * Memematic 3000 — outcome model.
 *
 * One spin per holder per UTC day. Fixed odds:
 *   big 5% · medium 10% · small 15% · tiny 20% · rug 50%
 *
 * The wheel FACE shows many crypto-flavored segments, but each segment maps to
 * one of these weighted outcomes, so the real odds never change no matter how
 * the wheel is drawn.
 */

export const OUTCOME_WEIGHTS = {
  big: 5,
  medium: 10,
  small: 15,
  tiny: 20,
  rug: 50,
};

export const WINNING_TIERS = ["big", "medium", "small", "tiny"];

/** Current UTC day key, 'YYYY-MM-DD'. */
export function dayKeyUTC(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

/**
 * Pick a weighted outcome using crypto-strength randomness.
 * Returns one of: 'big' | 'medium' | 'small' | 'tiny' | 'rug'.
 */
export function pickOutcome(rng = secureUnit) {
  const total = Object.values(OUTCOME_WEIGHTS).reduce((a, b) => a + b, 0); // 100
  let roll = rng() * total;
  for (const [outcome, weight] of Object.entries(OUTCOME_WEIGHTS)) {
    if (roll < weight) return outcome;
    roll -= weight;
  }
  return "rug"; // numerical safety net
}

/** Cryptographically-strong float in [0, 1). */
export function secureUnit() {
  // 32 random bits -> [0,1)
  return crypto.randomBytes(4).readUInt32BE(0) / 2 ** 32;
}

/**
 * The wheel face: ordered segments the UI renders around the circle.
 * `kind` is win|rug (for color/animation); `tier` maps winning segments to a
 * payout tier. Losing segments are all 'rug'. Each has an `emoji` for flair.
 * The labels/emojis are flavor only — odds come from OUTCOME_WEIGHTS, not from
 * how many segments share a tier.
 *
 * 16 slices: 8 win + 8 rug, interleaved so the wheel looks fair and lands on a
 * rug half the time. Adding/removing slices does NOT change the odds — the real
 * result is picked by pickOutcome() using OUTCOME_WEIGHTS, then we land the
 * wheel on a matching slice.
 */
export const WHEEL_SEGMENTS = [
  { label: "WAGMI", emoji: "🚀", kind: "win", tier: "big" },
  { label: "REKT", emoji: "💀", kind: "rug" },
  { label: "MOON", emoji: "🌕", kind: "win", tier: "medium" },
  { label: "NGMI", emoji: "📉", kind: "rug" },
  { label: "GM", emoji: "☀️", kind: "win", tier: "small" },
  { label: "RUGGED", emoji: "🫠", kind: "rug" },
  { label: "PUMP", emoji: "📈", kind: "win", tier: "tiny" },
  { label: "DUMP", emoji: "🗑️", kind: "rug" },
  { label: "DIAMOND", emoji: "💎", kind: "win", tier: "medium" },
  { label: "PAPER", emoji: "🧻", kind: "rug" },
  { label: "LFG", emoji: "🔥", kind: "win", tier: "small" },
  { label: "JEETED", emoji: "🤡", kind: "rug" },
  { label: "HODL", emoji: "🐸", kind: "win", tier: "tiny" },
  { label: "COPE", emoji: "😭", kind: "rug" },
  { label: "GIGACHAD", emoji: "🗿", kind: "win", tier: "big" },
  { label: "EXIT SCAM", emoji: "🏃", kind: "rug" },
];

/**
 * Given a chosen outcome, pick a wheel segment INDEX to visually land on.
 * - rug outcome -> a random rug segment
 * - a winning tier -> a random segment of that tier (fallback: any win segment)
 * This keeps the animation honest: the landed label matches the real result.
 */
export function segmentIndexForOutcome(outcome, rng = secureUnit) {
  let pool;
  if (outcome === "rug") {
    pool = indicesWhere((s) => s.kind === "rug");
  } else {
    pool = indicesWhere((s) => s.kind === "win" && s.tier === outcome);
    if (pool.length === 0) pool = indicesWhere((s) => s.kind === "win");
  }
  return pool[Math.floor(rng() * pool.length)];
}

function indicesWhere(pred) {
  const out = [];
  WHEEL_SEGMENTS.forEach((s, i) => {
    if (pred(s)) out.push(i);
  });
  return out;
}

/**
 * Full server-side spin resolution. Returns everything the client needs to
 * animate and everything the DB needs to record.
 */
export function resolveSpin({ prizeLabels } = {}) {
  const outcome = pickOutcome();
  const segmentIndex = segmentIndexForOutcome(outcome);
  const segment = WHEEL_SEGMENTS[segmentIndex];

  const isWin = outcome !== "rug";
  const prize = isWin && prizeLabels ? prizeLabels[outcome] : null;

  return {
    outcome, // big|medium|small|tiny|rug
    isWin,
    segmentIndex, // where the wheel should stop
    segmentLabel: segment.label, // flavor label landed on
    prize, // resolved prize label for winning tiers
  };
}
