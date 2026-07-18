import { config } from "../config.js";

const API = "https://discord.com/api/v10";

/**
 * Fetch a guild member via the BOT token and check whether they have any of the
 * configured admin role ids, or the Administrator permission bit.
 *
 * ADMIN_ROLE_IDS is a comma-separated env of role ids that may manage rules.
 */
export async function isGuildAdmin(discordId) {
  const { guildId, botToken } = config.discord;
  const res = await fetch(`${API}/guilds/${guildId}/members/${discordId}`, {
    headers: { Authorization: `Bot ${botToken}` },
  });
  if (!res.ok) return false;
  const member = await res.json();

  const adminRoleIds = config.admin.roleIds;
  const memberRoles = member.roles || [];
  if (adminRoleIds.some((r) => memberRoles.includes(r))) return true;

  // Also allow the guild owner explicitly if configured.
  if (config.admin.ownerId && discordId === config.admin.ownerId) return true;

  return false;
}
