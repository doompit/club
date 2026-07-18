import { getHeldTokenIds } from "./alchemy.js";

/**
 * Count how many NFTs a set of wallets holds from a single collection,
 * pooled across all wallets (deduplicated by tokenId is unnecessary since an
 * NFT can only be in one wallet, but we sum counts).
 */
async function pooledCountForCollection(addresses, collection, alchemyKey, opts) {
  let total = 0;
  for (const address of addresses) {
    let pageKey;
    do {
      const { count, pageKey: next } = await getHeldTokenIds(
        address,
        collection,
        alchemyKey,
        { ...opts, pageKey }
      );
      total += count;
      pageKey = next;
    } while (pageKey);
  }
  return total;
}

/**
 * Given a user's linked wallets and the guild's role rules, determine the set
 * of role_ids the user QUALIFIES for, pooling holdings across all wallets.
 *
 * @returns {Promise<{ targetRoleIds: Set<string>, counts: Record<string, number> }>}
 *   counts is keyed by collection contract -> pooled count (for display/logs).
 */
export async function evaluateRoles({ addresses, rules, alchemyKey, opts = {} }) {
  const counts = {};
  const collections = [...new Set(rules.map((r) => r.collection))];

  for (const collection of collections) {
    counts[collection] = await pooledCountForCollection(
      addresses,
      collection,
      alchemyKey,
      opts
    );
  }

  const targetRoleIds = new Set();
  for (const rule of rules) {
    if ((counts[rule.collection] ?? 0) >= rule.min_count) {
      targetRoleIds.add(rule.role_id);
    }
  }

  return { targetRoleIds, counts };
}
