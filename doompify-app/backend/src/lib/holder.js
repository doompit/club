import { walletsForUser } from "@doompify/shared/db.js";
import { getHeldTokenIds } from "@doompify/shared";
import { config, keys, verifyOpts } from "../config.js";

/**
 * Is this Discord user a current DOOMPS holder?
 * Pools NFT counts across all their linked wallets for the configured
 * DOOMPS collection contract. Returns { isHolder, count }.
 *
 * Requires config.doompsContract to be set.
 */
export async function isHolder(db, { discordId, guildId }) {
  const contract = config.doompsContract;
  if (!contract) return { isHolder: false, count: 0, reason: "no DOOMPS contract configured" };

  const wallets = walletsForUser(db, { discordId, guildId }).map((w) => w.address);
  if (wallets.length === 0) return { isHolder: false, count: 0, reason: "no linked wallets" };

  let total = 0;
  for (const address of wallets) {
    let pageKey;
    do {
      const { count, pageKey: next } = await getHeldTokenIds(
        address,
        contract,
        keys.alchemy,
        { ...verifyOpts, pageKey }
      );
      total += count;
      pageKey = next;
    } while (pageKey);
  }

  return { isHolder: total > 0, count: total };
}
