import { bioContainsChallenge, buildChallengeString } from "./challenge.js";
import { fetchOpenSeaBio } from "./opensea.js";
import { isHolderOfCollection } from "./alchemy.js";

/**
 * Prove CONTROL of a wallet via its OpenSea bio containing the challenge.
 * Holdings/role evaluation is handled separately (see roles.js) because
 * Doompify pools holdings across multiple wallets and maps them to roles.
 *
 * If `keys.alchemy` and `contract` are provided, we also check whether the
 * wallet holds any of the collection, so the caller can give an accurate
 * message (e.g. "no DOOMPS in this wallet" vs. "code not found in bio").
 *
 * @returns {Promise<{controlProven, holdsCollection, reason, bioUsername, accountExists}>}
 */
export async function proveControl({ address, nonce, keys, contract, opts = {} }) {
  const challenge = buildChallengeString(address, nonce);
  const account = await fetchOpenSeaBio(address, keys.opensea, opts);
  const controlProven = bioContainsChallenge(account.bio, challenge);

  // Diagnostic logging (shows in server logs) — helps pinpoint why a match
  // failed without exposing anything sensitive. Turn off with VERIFY_DEBUG=0.
  if (process.env.VERIFY_DEBUG !== "0") {
    const preview = (account.bio || "").slice(0, 120).replace(/\s+/g, " ");
    console.log(
      `[verify] addr=${address.slice(0, 8)}… status=${account.status ?? "?"} exists=${account.exists} ` +
      `bioLen=${(account.bio || "").length} matched=${controlProven} ` +
      `expected="${challenge}" bioPreview="${preview}"`
    );
  }

  // Optionally check holdings so we can tell the user WHY it failed.
  let holdsCollection = null;
  if (keys.alchemy && contract) {
    try {
      const r = await isHolderOfCollection(address, contract, keys.alchemy, opts);
      holdsCollection = !!r.isHolder;
    } catch {
      holdsCollection = null; // unknown (API blip) — don't block on this
    }
  }

  let reason;
  if (controlProven) {
    reason = "Address control confirmed via OpenSea bio.";
  } else if (holdsCollection === false) {
    // Control not proven AND the wallet holds no DOOMPS — most useful message.
    reason =
      "This wallet doesn't hold any DOOMPS. Make sure you entered the wallet that holds your DOOMPS, then paste the code into its OpenSea bio and try again.";
  } else if (account.exists) {
    reason =
      "We couldn't find your code in your OpenSea bio yet. Paste the exact code into your OpenSea profile bio, press Save, wait a few seconds, then try again.";
  } else {
    reason =
      "No OpenSea profile found for this address. Open the wallet's OpenSea profile, add the code to your bio, and save it first.";
  }

  return {
    controlProven,
    holdsCollection,
    accountExists: account.exists,
    bioUsername: account.username,
    reason,
  };
}
