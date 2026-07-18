import { bioContainsChallenge, buildChallengeString } from "./challenge.js";
import { fetchOpenSeaBio } from "./opensea.js";

/**
 * Prove CONTROL of a wallet via its OpenSea bio containing the challenge.
 * Holdings/role evaluation is handled separately (see roles.js) because
 * Doompify pools holdings across multiple wallets and maps them to roles.
 *
 * @returns {Promise<{controlProven, reason, bioUsername, accountExists}>}
 */
export async function proveControl({ address, nonce, keys, opts = {} }) {
  const challenge = buildChallengeString(address, nonce);
  const account = await fetchOpenSeaBio(address, keys.opensea, opts);
  const controlProven = bioContainsChallenge(account.bio, challenge);

  return {
    controlProven,
    accountExists: account.exists,
    bioUsername: account.username,
    reason: controlProven
      ? "Address control confirmed via OpenSea bio."
      : account.exists
        ? "Challenge string not found in OpenSea bio. Make sure you saved it exactly."
        : "No OpenSea profile found for this address. Edit your OpenSea profile bio first.",
  };
}
