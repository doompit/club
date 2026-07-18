/**
 * Channel access rules for The Swamp.
 *
 * A channel has read_roles and post_roles (arrays of Discord role ids). Special
 * sentinel "__admin__" means "admins only".
 *
 *   read_roles:
 *     []            -> everyone (including logged-out) can read
 *     ["__admin__"] -> only admins
 *     ["r1","r2"]   -> anyone holding r1 or r2 (admins always allowed)
 *
 *   post_roles:
 *     []            -> any logged-in holder can post
 *     ["__admin__"] -> only admins
 *     ["r1"]        -> only holders of r1 (admins always allowed)
 *
 * `ctx` describes the viewer:
 *   { loggedIn, isAdmin, isHolder, roleIds: Set<string> }
 */

const ADMIN = "__admin__";

export function canRead(channel, ctx) {
  const roles = channel.read_roles || [];
  if (roles.length === 0) return true; // public
  if (ctx.isAdmin) return true;
  if (roles.includes(ADMIN)) return false; // admin-only and not admin
  if (!ctx.loggedIn) return false;
  return roles.some((r) => ctx.roleIds?.has(r));
}

export function canPost(channel, ctx) {
  if (!ctx.loggedIn) return false;
  if (ctx.isAdmin) return true;
  const roles = channel.post_roles || [];
  if (roles.includes(ADMIN)) return false; // admin-only channel
  // Posting anywhere requires being a current holder.
  if (!ctx.isHolder) return false;
  if (roles.length === 0) return true; // any holder
  return roles.some((r) => ctx.roleIds?.has(r));
}

/** Filter a channel list to those the viewer can at least read. */
export function readableChannels(channels, ctx) {
  return channels.filter((c) => canRead(c, ctx));
}

export const ADMIN_ROLE_SENTINEL = ADMIN;
