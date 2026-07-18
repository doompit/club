import express from "express";
import { normalizeAddress } from "@doompify/shared";
import {
  addRoleRule,
  listRoleRules,
  deleteRoleRule,
  getPrizeConfig,
  setPrizeLabel,
  listMemes,
  countMemes,
  softDeleteMeme,
  getMeme,
  listWins,
  markPaid,
  listChannels,
  createChannel,
  updateChannel,
  deleteChannel,
} from "@doompify/shared/db.js";
import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import { buildOAuthUrl, exchangeCodeForUser, listGuildRoles } from "../lib/discord.js";
import { isGuildAdmin } from "../lib/admin.js";
import { sign, verify } from "../lib/session.js";

const ADMIN_COOKIE = "doompify_admin";

function parseCookies(req) {
  const raw = req.headers.cookie || "";
  return Object.fromEntries(
    raw.split(";").map((c) => c.trim().split("=").map(decodeURIComponent)).filter((p) => p[0])
  );
}

function requireAdmin(req, res, next) {
  const cookies = parseCookies(req);
  const session = verify(cookies[ADMIN_COOKIE]);
  if (!session?.admin) {
    return res.status(401).json({ error: "Not authenticated as admin." });
  }
  req.admin = session;
  next();
}

export function adminRouter(db) {
  const router = express.Router();

  /* ---- OAuth login for admins ---- */
  router.get("/login", (_req, res) => {
    const state = sign({ t: Date.now() }, 10 * 60 * 1000);
    res.redirect(buildOAuthUrl(state, config.admin.redirectUri, "identify"));
  });

  router.get("/callback", async (req, res) => {
    const code = String(req.query.code || "");
    if (!verify(String(req.query.state || ""))) {
      return res.status(400).send("Invalid admin OAuth state.");
    }
    try {
      const user = await exchangeCodeForUser(code, config.admin.redirectUri);
      const ok = await isGuildAdmin(user.id);
      if (!ok) {
        return res
          .status(403)
          .send("You don't have an admin role in this server. Access denied.");
      }
      const token = sign({ admin: true, id: user.id, username: user.username }, 6 * 60 * 60 * 1000);
      res.setHeader(
        "Set-Cookie",
        `${ADMIN_COOKIE}=${encodeURIComponent(token)}; HttpOnly; Path=/; Max-Age=21600; SameSite=Lax`
      );
      res.redirect("/admin/");
    } catch (e) {
      res.status(500).send(`Admin login failed: ${e.message}`);
    }
  });

  router.post("/logout", (_req, res) => {
    res.setHeader("Set-Cookie", `${ADMIN_COOKIE}=; HttpOnly; Path=/; Max-Age=0`);
    res.json({ ok: true });
  });

  /* ---- Session probe ---- */
  router.get("/me", (req, res) => {
    const cookies = parseCookies(req);
    const session = verify(cookies[ADMIN_COOKIE]);
    if (!session?.admin) return res.json({ authenticated: false });
    res.json({ authenticated: true, username: session.username, id: session.id });
  });

  /* ---- Guild roles (for the picker) ---- */
  router.get("/roles", requireAdmin, async (_req, res) => {
    try {
      res.json({ roles: await listGuildRoles() });
    } catch (e) {
      res.status(502).json({ error: e.message });
    }
  });

  /* ---- Rule CRUD ---- */
  router.get("/rules", requireAdmin, (_req, res) => {
    res.json({ rules: listRoleRules(db, { guildId: config.discord.guildId }) });
  });

  router.post("/rules", requireAdmin, (req, res) => {
    let collection;
    try {
      collection = normalizeAddress(req.body.collection);
    } catch {
      return res.status(400).json({ error: "Invalid collection contract address." });
    }
    const minCount = parseInt(req.body.minCount, 10);
    const roleId = String(req.body.roleId || "").trim();
    const collectionName = String(req.body.collectionName || "").trim() || null;
    if (!Number.isInteger(minCount) || minCount < 1) {
      return res.status(400).json({ error: "minCount must be a positive integer." });
    }
    if (!/^\d{5,}$/.test(roleId)) {
      return res.status(400).json({ error: "roleId must be a Discord role id." });
    }
    const id = addRoleRule(db, {
      guildId: config.discord.guildId,
      collection,
      collectionName,
      minCount,
      roleId,
      now: Date.now(),
    });
    res.json({ ok: true, id });
  });

  router.delete("/rules/:id", requireAdmin, (req, res) => {
    const changes = deleteRoleRule(db, {
      guildId: config.discord.guildId,
      id: parseInt(req.params.id, 10),
    });
    res.json({ ok: changes > 0 });
  });

  /* ---- Prize labels (Memematic 3000) ---- */
  router.get("/prizes", requireAdmin, (_req, res) => {
    res.json({ prizes: getPrizeConfig(db) });
  });

  router.post("/prizes", requireAdmin, (req, res) => {
    const updates = req.body || {};
    const tiers = ["big", "medium", "small", "tiny"];
    const now = Date.now();
    for (const tier of tiers) {
      if (typeof updates[tier] === "string" && updates[tier].trim()) {
        setPrizeLabel(db, { tier, label: updates[tier].trim().slice(0, 60), now });
      }
    }
    res.json({ ok: true, prizes: getPrizeConfig(db) });
  });

  /* ---- Meme moderation ---- */
  router.get("/memes", requireAdmin, (req, res) => {
    const limit = Math.min(parseInt(req.query.limit, 10) || 60, 200);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
    const rows = listMemes(db, { limit, offset });
    res.json({
      total: countMemes(db),
      memes: rows.map((m) => ({
        id: m.id,
        url: `/uploads/${m.filename}`,
        caption: m.caption,
        username: m.username,
        createdAt: m.created_at,
      })),
    });
  });

  router.delete("/memes/:id", requireAdmin, (req, res) => {
    const id = parseInt(req.params.id, 10);
    const meme = getMeme(db, id);
    if (!meme) return res.status(404).json({ error: "Not found." });
    softDeleteMeme(db, id);
    // Best-effort remove the file from disk too.
    try {
      const p = path.resolve(config.uploadsDir, meme.filename);
      if (p.startsWith(path.resolve(config.uploadsDir))) fs.unlink(p, () => {});
    } catch (_) {}
    res.json({ ok: true });
  });

  /* ---- Memematic 3000 winners / payouts ---- */
  router.get("/wins", requireAdmin, (req, res) => {
    const onlyPending = req.query.pending === "1";
    const rows = listWins(db, { onlyPending });
    res.json({
      wins: rows.map((w) => ({
        id: w.id,
        username: w.username,
        discordId: w.discord_id,
        outcome: w.outcome,
        prize: w.prize_label,
        address: w.payout_address,
        status: w.payout_status,
        day: w.day_key,
        createdAt: w.created_at,
      })),
    });
  });

  router.post("/wins/:id/paid", requireAdmin, (req, res) => {
    const changes = markPaid(db, { id: parseInt(req.params.id, 10) });
    res.json({ ok: changes > 0 });
  });

  /* ---- The Swamp: channel management ---- */
  router.get("/channels", requireAdmin, (_req, res) => {
    res.json({ channels: listChannels(db, { guildId: config.discord.guildId }) });
  });

  router.post("/channels", requireAdmin, (req, res) => {
    const name = String(req.body.name || "").trim().toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 32);
    if (!name) return res.status(400).json({ error: "Channel name required." });
    const id = createChannel(db, {
      guildId: config.discord.guildId,
      category: String(req.body.category || "SWAMP").slice(0, 32),
      name,
      topic: String(req.body.topic || "").slice(0, 200) || null,
      readRoles: Array.isArray(req.body.readRoles) ? req.body.readRoles : [],
      postRoles: Array.isArray(req.body.postRoles) ? req.body.postRoles : [],
      position: parseInt(req.body.position, 10) || 0,
      now: Date.now(),
    });
    res.json({ ok: true, id });
  });

  router.put("/channels/:id", requireAdmin, (req, res) => {
    const changes = updateChannel(db, {
      id: parseInt(req.params.id, 10),
      topic: req.body.topic,
      readRoles: Array.isArray(req.body.readRoles) ? req.body.readRoles : undefined,
      postRoles: Array.isArray(req.body.postRoles) ? req.body.postRoles : undefined,
      position: req.body.position != null ? parseInt(req.body.position, 10) : undefined,
    });
    res.json({ ok: changes > 0 });
  });

  router.delete("/channels/:id", requireAdmin, (req, res) => {
    const changes = deleteChannel(db, { id: parseInt(req.params.id, 10) });
    res.json({ ok: changes > 0 });
  });

  return router;
}
