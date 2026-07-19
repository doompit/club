import { evaluateRoles } from "@doompify/shared";
import {
  walletsForUser,
  listRoleRules,
  recordGrant,
  removeGrant,
  grantsForUser,
} from "@doompify/shared/db.js";
import { addRole, removeRole } from "./discord.js";
import { config, keys, verifyOpts } from "../config.js";

/**
 * Reconcile one user's roles against pooled holdings.
 * - Pools NFT counts across all their linked wallets.
 * - Grants roles they qualify for, revokes managed roles they no longer do.
 * Only touches roles that appear in this guild's rules (never other roles).
 *
 * @returns {Promise<{added: string[], removed: string[], counts: object}>}
 */
export async function syncUserRoles(db, { discordId, guildId }) {
  const wallets = walletsForUser(db, { discordId, guildId }).map((w) => w.address);
  const rules = listRoleRules(db, { guildId });

  // The universe of roles this system manages in this guild.
  const managedRoleIds = new Set(rules.map((r) => r.role_id));

  let targetRoleIds = new Set();
  let counts = {};
  if (wallets.length > 0 && rules.length > 0) {
    const res = await evaluateRoles({
      addresses: wallets,
      rules,
      alchemyKey: keys.alchemy,
      opts: verifyOpts,
    });
    targetRoleIds = res.targetRoleIds;
    counts = res.counts;
  }

  const currentGrants = new Set(grantsForUser(db, { discordId, guildId }));
  const now = Date.now();
  const added = [];
  const removed = [];

  // Grant qualifying roles. A single role failure (e.g. the bot's role sits
  // below this role, or a transient Discord error) must NOT fail the whole
  // verification — the wallet is already linked. Log and continue.
  const roleErrors = [];
  for (const roleId of targetRoleIds) {
    if (!currentGrants.has(roleId)) {
      try {
        await addRole(discordId, roleId);
        recordGrant(db, { discordId, guildId, roleId, now });
        added.push(roleId);
      } catch (e) {
        console.error(`[rolesync] could not add role ${roleId} to ${discordId}: ${e.message}`);
        roleErrors.push({ roleId, action: "add", message: e.message });
      }
    }
  }

  // Revoke managed roles no longer qualified for.
  for (const roleId of managedRoleIds) {
    if (currentGrants.has(roleId) && !targetRoleIds.has(roleId)) {
      try {
        await removeRole(discordId, roleId);
        removeGrant(db, { discordId, guildId, roleId });
        removed.push(roleId);
      } catch (e) {
        console.error(`[rolesync] could not remove role ${roleId} from ${discordId}: ${e.message}`);
        roleErrors.push({ roleId, action: "remove", message: e.message });
      }
    }
  }

  return { added, removed, counts, walletCount: wallets.length, roleErrors };
}
