import { grantsForUser } from "@doompify/shared/db.js";
import { config } from "../config.js";
import { isHolder } from "./holder.js";
import { isGuildAdmin } from "./admin.js";
import { getUser } from "./usersession.js";

/**
 * Build the permission context for a request's viewer:
 *   { loggedIn, isAdmin, isHolder, roleIds:Set, user }
 *
 * roleIds come from Doompify's role_grants (the roles we've assigned based on
 * holdings). isHolder is checked live against Alchemy. isAdmin uses the Discord
 * admin-role check. Logged-out visitors get a minimal context (can read public
 * channels only).
 */
export async function buildViewerContext(db, req, { needHolder = true } = {}) {
  const user = getUser(req);
  if (!user) {
    return { loggedIn: false, isAdmin: false, isHolder: false, roleIds: new Set(), user: null };
  }

  const guildId = config.discord.guildId;
  const roleIds = new Set(grantsForUser(db, { discordId: user.id, guildId }));

  let admin = false;
  try { admin = await isGuildAdmin(user.id); } catch (_) {}

  let holder = false;
  if (needHolder) {
    try {
      const h = await isHolder(db, { discordId: user.id, guildId });
      holder = h.isHolder;
    } catch (_) {}
  }

  return { loggedIn: true, isAdmin: admin, isHolder: holder, roleIds, user };
}
