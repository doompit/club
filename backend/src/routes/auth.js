import express from "express";
import { linkWallet } from "@doompify/shared/db.js";
import { config } from "../config.js";
import { buildOAuthUrl, exchangeCodeForUser } from "../lib/discord.js";
import { syncUserRoles } from "../lib/rolesync.js";
import { sign, verify } from "../lib/session.js";

export function authRouter(db) {
  const router = express.Router();

  /**
   * GET /auth/discord/start?proof=...
   * proof = signed {addresses[], verified} from /api/confirm. Folded into state.
   */
  router.get("/discord/start", (req, res) => {
    const data = verify(String(req.query.proof || ""));
    if (!data || !data.verified || !data.addresses?.length) {
      return res.status(400).send("Invalid or expired verification proof.");
    }
    const state = sign({ addresses: data.addresses }, 10 * 60 * 1000);
    res.redirect(buildOAuthUrl(state, config.discord.redirectUri, "identify"));
  });

  /**
   * GET /auth/discord/callback?code&state
   * Links every verified address to the Discord user, then syncs roles from
   * pooled holdings.
   */
  router.get("/discord/callback", async (req, res) => {
    const code = String(req.query.code || "");
    const stateData = verify(String(req.query.state || ""));
    if (!code || !stateData?.addresses?.length) {
      return res.status(400).send("Invalid OAuth callback.");
    }

    try {
      const user = await exchangeCodeForUser(code, config.discord.redirectUri);
      const now = Date.now();
      const guildId = config.discord.guildId;

      const conflicts = [];
      for (const address of stateData.addresses) {
        const r = linkWallet(db, { discordId: user.id, guildId, address, now });
        if (!r.ok && r.conflict) conflicts.push(address);
      }

      const sync = await syncUserRoles(db, { discordId: user.id, guildId });

      // Stash a small result for the success page to read.
      const summary = sign(
        {
          added: sync.added.length,
          removed: sync.removed.length,
          wallets: sync.walletCount,
          conflicts,
          roleErrors: (sync.roleErrors || []).length,
        },
        5 * 60 * 1000
      );
      res.redirect(`/success.html?s=${encodeURIComponent(summary)}`);
    } catch (e) {
      res.status(500).send(`Linking failed: ${e.message}`);
    }
  });

  return router;
}
