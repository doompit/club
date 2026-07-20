import express from "express";
import { config, keys } from "../config.js";
import { requireUser } from "../lib/usersession.js";
import { getHeldNftsWithImages } from "@doompify/shared";
import {
  getProfile,
  upsertProfile,
  walletsForUser,
} from "@doompify/shared/db.js";

export function profileRouter(db) {
  const router = express.Router();

  /**
   * GET /api/profile/me — the logged-in user's profile (or defaults).
   */
  router.get("/profile/me", requireUser, (req, res) => {
    const p = getProfile(db, req.user.id);
    res.json({
      discordId: req.user.id,
      displayName: (p && p.display_name) || req.user.username || null,
      bio: (p && p.bio) || "",
      avatarUrl: (p && p.avatar_url) || null,
      avatarToken: (p && p.avatar_token) || null,
      notdisabled: p ? !!p.notify_disabled : false, // notifications default ON
    });
  });

  /**
   * GET /api/profile/avatars — the NFTs (with images) the user can pick as an
   * avatar, gathered across all their linked wallets. DOOMPS only.
   */
  router.get("/profile/avatars", requireUser, async (req, res) => {
    if (!config.doompsContract) {
      return res.status(500).json({ error: "Collection not configured." });
    }
    const wallets = walletsForUser(db, {
      discordId: req.user.id,
      guildId: config.discord.guildId,
    });
    if (!wallets.length) {
      return res.json({ nfts: [], reason: "no linked wallets" });
    }

    const seen = new Set();
    const nfts = [];
    for (const w of wallets) {
      try {
        const held = await getHeldNftsWithImages(
          w.address,
          config.doompsContract,
          keys.alchemy,
          { network: config.alchemyNetwork, limit: 50 }
        );
        for (const n of held) {
          if (!n.image || seen.has(n.tokenId)) continue;
          seen.add(n.tokenId);
          nfts.push({ tokenId: n.tokenId, name: n.name, image: n.image });
        }
      } catch (e) {
        // Skip a wallet that errors, keep going with the others.
        console.error(`[profile] avatar fetch failed for ${w.address}: ${e.message}`);
      }
    }
    res.json({ nfts });
  });

  /**
   * POST /api/profile — save display name, bio, avatar, and notify pref.
   * Body: { displayName?, bio?, avatarUrl?, avatarToken?, notifyDisabled? }
   */
  router.post("/profile", requireUser, (req, res) => {
    const b = req.body || {};
    const displayName =
      typeof b.displayName === "string" ? b.displayName.trim().slice(0, 32) : undefined;
    const bio = typeof b.bio === "string" ? b.bio.slice(0, 300) : undefined;
    const avatarUrl = typeof b.avatarUrl === "string" ? b.avatarUrl.slice(0, 500) : undefined;
    const avatarToken =
      b.avatarToken === null || typeof b.avatarToken === "string" ? b.avatarToken : undefined;
    const notifyDisabled =
      typeof b.notifyDisabled === "boolean" ? b.notifyDisabled : undefined;

    try {
      const saved = upsertProfile(db, {
        discordId: req.user.id,
        displayName,
        bio,
        avatarUrl,
        avatarToken,
        notifyDisabled,
        now: Date.now(),
      });
      res.json({
        ok: true,
        profile: {
          displayName: saved.display_name,
          bio: saved.bio,
          avatarUrl: saved.avatar_url,
          avatarToken: saved.avatar_token,
          notifyDisabled: !!saved.notify_disabled,
        },
      });
    } catch (e) {
      console.error("[profile] save failed:", e.message);
      res.status(500).json({ error: "Couldn't save your profile. Try again." });
    }
  });

  return router;
}
