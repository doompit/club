import { evaluateRoles } from "@doompify/shared";
import {
  walletsForUser,
  listRoleRules,
  recordGrant,
  removeGrant,
  grantsForUser,
} from "@doompify/shared/db.js";
import { config, keys, verifyOpts } from "./config.js";

/**
 * Reconcile one member's roles against pooled holdings, using a discord.js
 * GuildMember for the actual add/remove. Mirrors the backend's rolesync but
 * uses the gateway client instead of REST helpers.
 */
export async function syncMemberRoles(db, { member, guildId }) {
  const discordId = member.id;
  const wallets = walletsForUser(db, { discordId, guildId }).map((w) => w.address);
  const rules = listRoleRules(db, { guildId });
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

  for (const roleId of targetRoleIds) {
    if (!currentGrants.has(roleId)) {
      await member.roles.add(roleId).catch(() => {});
      recordGrant(db, { discordId, guildId, roleId, now });
      added.push(roleId);
    }
  }
  for (const roleId of managedRoleIds) {
    if (currentGrants.has(roleId) && !targetRoleIds.has(roleId)) {
      await member.roles.remove(roleId).catch(() => {});
      removeGrant(db, { discordId, guildId, roleId });
      removed.push(roleId);
    }
  }

  return { added, removed, counts, walletCount: wallets.length };
}
