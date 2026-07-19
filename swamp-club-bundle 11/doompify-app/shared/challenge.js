import crypto from "node:crypto";

// Short, easy-to-paste prefix. The full string a user pastes looks like:  doomp:Zk9mQ2aB
const CHALLENGE_PREFIX = "doomp";

/**
 * A normalized lowercase 0x address, or throws.
 * We do NOT checksum-validate here to keep it dependency-free; the Alchemy /
 * OpenSea calls will reject truly invalid addresses. Basic shape check only.
 */
export function normalizeAddress(input) {
  if (typeof input !== "string") throw new Error("address must be a string");
  const addr = input.trim().toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(addr)) {
    throw new Error("invalid Ethereum address");
  }
  return addr;
}

/**
 * Generate a short random URL-safe nonce.
 * 6 bytes -> 8 base64url chars (2^48 entropy). The nonce is single-use, tied to
 * one wallet in the DB, and expires, so it doesn't need to be long.
 */
export function generateNonce(bytes = 6) {
  return crypto.randomBytes(bytes).toString("base64url");
}

/**
 * Build the exact string the user pastes into their OpenSea bio.
 * Format: doomp:<nonce>   (e.g. "doomp:Zk9mQ2aB")
 *
 * The wallet address is intentionally NOT included — it's redundant (the
 * backend already knows which wallet this challenge belongs to) and only made
 * the string longer. `address` is still accepted/validated for backwards
 * compatibility with existing callers, but isn't part of the output.
 */
export function buildChallengeString(address, nonce) {
  if (address !== undefined && address !== null) normalizeAddress(address);
  return `${CHALLENGE_PREFIX}:${nonce}`;
}

/**
 * Returns true if `bioText` contains the exact challenge string.
 */
export function bioContainsChallenge(bioText, challengeString) {
  if (!bioText || typeof bioText !== "string") return false;
  // Robust match: OpenSea bios often come back with odd spacing, line breaks,
  // smart punctuation, or invisible characters. Normalize both sides before
  // comparing so a correctly-pasted code isn't rejected over formatting.
  const norm = (s) =>
    s
      .normalize("NFKC")
      .replace(/[\u200B-\u200D\uFEFF]/g, "") // zero-width chars
      .replace(/\s+/g, "")                    // all whitespace
      .toLowerCase();
  return norm(bioText).includes(norm(challengeString));
}

export const CHALLENGE_TTL_MS = 30 * 60 * 1000; // 30 minutes
