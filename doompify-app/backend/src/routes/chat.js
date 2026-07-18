import express from "express";
import multer from "multer";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import { requireUser } from "../lib/usersession.js";
import { buildViewerContext } from "../lib/viewer.js";
import {
  canRead,
  canPost,
  readableChannels,
} from "@doompify/shared";
import {
  listChannels,
  getChannel,
  addMessage,
  listMessages,
  getMessage,
  softDeleteMessage,
  toggleReaction,
  reactionsFor,
  userReactionsFor,
  seedDefaultChannels,
} from "@doompify/shared/db.js";

const ALLOWED = { "image/jpeg": ".jpg", "image/png": ".png", "image/gif": ".gif", "image/webp": ".webp" };

export function chatRouter(db) {
  const router = express.Router();
  const guildId = config.discord.guildId;

  // Ensure a starter set of channels exists.
  seedDefaultChannels(db, { guildId, now: Date.now() });

  const chatUploads = path.resolve(config.uploadsDir, "chat");
  fs.mkdirSync(chatUploads, { recursive: true });
  const upload = multer({
    storage: multer.diskStorage({
      destination: (_r, _f, cb) => cb(null, chatUploads),
      filename: (_r, file, cb) =>
        cb(null, `${Date.now()}-${crypto.randomBytes(6).toString("hex")}${ALLOWED[file.mimetype] || ""}`),
    }),
    limits: { fileSize: config.maxUploadBytes, files: 1 },
    fileFilter: (_r, file, cb) => (ALLOWED[file.mimetype] ? cb(null, true) : cb(new Error("Unsupported image type."))),
  });

  /**
   * GET /api/chat/channels — channels the viewer can read, with post flags.
   */
  router.get("/chat/channels", async (req, res) => {
    const ctx = await buildViewerContext(db, req);
    const all = listChannels(db, { guildId });
    const visible = readableChannels(all, ctx).map((c) => ({
      id: c.id,
      category: c.category,
      name: c.name,
      topic: c.topic,
      canPost: canPost(c, ctx),
    }));
    res.json({ channels: visible, me: { loggedIn: ctx.loggedIn, isAdmin: ctx.isAdmin, isHolder: ctx.isHolder } });
  });

  /**
   * GET /api/chat/channels/:id/messages?after=ID — poll messages.
   */
  router.get("/chat/channels/:id/messages", async (req, res) => {
    const channel = getChannel(db, parseInt(req.params.id, 10));
    if (!channel) return res.status(404).json({ error: "No such channel." });
    const ctx = await buildViewerContext(db, req, { needHolder: false });
    if (!canRead(channel, ctx)) return res.status(403).json({ error: "You can't read this channel." });

    const afterId = parseInt(req.query.after, 10) || 0;
    const rows = listMessages(db, { channelId: channel.id, afterId, limit: 60 });
    const ids = rows.map((m) => m.id);
    const rx = reactionsFor(db, ids);
    const mine = ctx.loggedIn ? userReactionsFor(db, { messageIds: ids, discordId: ctx.user.id }) : {};

    res.json({
      messages: rows.map((m) => ({
        id: m.id,
        username: m.username,
        discordId: m.discord_id,
        body: m.body,
        image: m.image ? `/uploads/chat/${m.image}` : null,
        createdAt: m.created_at,
        mine: ctx.loggedIn && m.discord_id === ctx.user.id,
        reactions: rx[m.id] || {},
        myReactions: mine[m.id] || [],
      })),
    });
  });

  /**
   * POST /api/chat/channels/:id/messages (multipart or json) — post a message.
   * Gated by canPost (holder + role rules; admins always).
   */
  router.post("/chat/channels/:id/messages", requireUser, (req, res) => {
    upload.single("image")(req, res, async (err) => {
      if (err) return res.status(400).json({ error: err.message });
      const channel = getChannel(db, parseInt(req.params.id, 10));
      if (!channel) { cleanup(req); return res.status(404).json({ error: "No such channel." }); }

      const ctx = await buildViewerContext(db, req);
      if (!canPost(channel, ctx)) {
        cleanup(req);
        return res.status(403).json({ error: "You don't have permission to post here." });
      }

      const body = String(req.body.body || "").slice(0, 2000).trim();
      const image = req.file ? req.file.filename : null;
      if (!body && !image) return res.status(400).json({ error: "Empty message." });

      const id = addMessage(db, {
        channelId: channel.id,
        discordId: ctx.user.id,
        username: ctx.user.username,
        body: body || null,
        image,
        now: Date.now(),
      });
      res.json({ ok: true, id });
    });
  });

  /**
   * POST /api/chat/messages/:id/react { emoji } — toggle a reaction.
   */
  router.post("/chat/messages/:id/react", requireUser, async (req, res) => {
    const msg = getMessage(db, parseInt(req.params.id, 10));
    if (!msg || msg.deleted) return res.status(404).json({ error: "No such message." });
    const channel = getChannel(db, msg.channel_id);
    const ctx = await buildViewerContext(db, req, { needHolder: false });
    if (!canRead(channel, ctx)) return res.status(403).json({ error: "No access." });

    const emoji = String(req.body.emoji || "").slice(0, 8);
    const allowed = ["🐸", "🔥", "💀", "🚀", "😂", "👀", "🤮", "🧪"];
    if (!allowed.includes(emoji)) return res.status(400).json({ error: "Emoji not allowed." });

    const r = toggleReaction(db, { messageId: msg.id, discordId: ctx.user.id, emoji, now: Date.now() });
    res.json({ ok: true, on: r.on });
  });

  /**
   * DELETE /api/chat/messages/:id — author or admin can delete.
   */
  router.delete("/chat/messages/:id", requireUser, async (req, res) => {
    const msg = getMessage(db, parseInt(req.params.id, 10));
    if (!msg) return res.status(404).json({ error: "No such message." });
    const ctx = await buildViewerContext(db, req, { needHolder: false });
    if (msg.discord_id !== ctx.user.id && !ctx.isAdmin) {
      return res.status(403).json({ error: "Not allowed." });
    }
    softDeleteMessage(db, msg.id);
    if (msg.image) {
      const p = path.resolve(chatUploads, msg.image);
      if (p.startsWith(chatUploads)) fs.unlink(p, () => {});
    }
    res.json({ ok: true });
  });

  function cleanup(req) {
    if (req.file) fs.unlink(req.file.path, () => {});
  }

  return router;
}
