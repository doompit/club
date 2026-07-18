import { allWalletUsers } from "@doompify/shared/db.js";
import { config } from "./config.js";
import { syncMemberRoles } from "./rolesync.js";

/**
 * Periodically re-check every verified user's pooled holdings and reconcile
 * their roles. Holdings-only (no bio re-check) so users may clear their bio
 * after verifying.
 */
export function startRecheckLoop({ client, db }) {
  const intervalMs = config.recheckIntervalMin * 60 * 1000;
  const run = () => sweep({ client, db }).catch((e) => console.error("recheck error:", e));
  setTimeout(run, 30_000);
  setInterval(run, intervalMs);
  console.log(`Re-check loop every ${config.recheckIntervalMin} min`);
}

async function sweep({ client, db }) {
  const users = allWalletUsers(db);
  if (!users.length) return;
  console.log(`[recheck] sweeping ${users.length} member(s)`);

  for (const { discord_id, guild_id } of users) {
    try {
      const guild = await client.guilds.fetch(guild_id);
      const member = await guild.members.fetch(discord_id).catch(() => null);
      if (!member) continue; // left the server
      const r = await syncMemberRoles(db, { member, guildId: guild_id });
      if (r.added.length || r.removed.length) {
        console.log(`[recheck] ${discord_id}: +${r.added.length}/-${r.removed.length}`);
      }
    } catch (e) {
      console.error(`[recheck] ${discord_id} failed:`, e.message);
    }
    await new Promise((r) => setTimeout(r, 300)); // pace API calls
  }
}
