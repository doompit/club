import express from "express";
import multer from "multer";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import { requireUser } from "../lib/usersession.js";
import { isHolder } from "../lib/holder.js";
import {
  addMeme,
  listMemes,
  countMemes,
} from "@doompify/shared/db.js";

const ALLOWED = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/gif": ".gif",
  "image/webp": ".webp",
};

export function memeRouter(db) {
  const router = express.Router();

  const uploadsDir = path.resolve(config.uploadsDir);
  fs.mkdirSync(uploadsDir, { recursive: true });

  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadsDir),
    filename: (_req, file, cb) => {
      const ext = ALLOWED[file.mimetype] || "";
      cb(null, `${Date.now()}-${crypto.randomBytes(8).toString("hex")}${ext}`);
    },
  });

  const upload = multer({
    storage,
    limits: { fileSize: config.maxUploadBytes, files: 1 },
    fileFilter: (_req, file, cb) => {
      if (ALLOWED[file.mimetype]) return cb(null, true);
      cb(new Error("Only JPG, PNG, GIF, or WEBP images are allowed."));
    },
  });

  /**
   * GET /api/memes?limit=&offset=  — public gallery feed.
   */
  router.get("/memes", (req, res) => {
    const limit = Math.min(parseInt(req.query.limit, 10) || 40, 100);
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

  /**
   * POST /api/memes  (multipart: image, caption) — holders only.
   * Auto-published. Grants the uploader eligibility for today's spin.
   */
  router.post("/memes", requireUser, (req, res) => {
    upload.single("image")(req, res, async (err) => {
      if (err) return res.status(400).json({ error: err.message });
      if (!req.file) return res.status(400).json({ error: "No image uploaded." });

      // Holder gate — remove the file if they don't qualify.
      let holder;
      try {
        holder = await isHolder(db, {
          discordId: req.user.id,
          guildId: config.discord.guildId,
        });
      } catch (e) {
        fs.unlink(req.file.path, () => {});
        return res.status(502).json({ error: `Holder check failed: ${e.message}` });
      }
      if (!holder.isHolder) {
        fs.unlink(req.file.path, () => {});
        return res.status(403).json({
          error:
            "Only DOOMPS holders can upload. Verify a wallet that holds DOOMPS first.",
          needVerify: true,
        });
      }

      const caption = String(req.body.caption || "").slice(0, 280) || null;
      const id = addMeme(db, {
        discordId: req.user.id,
        username: req.user.username,
        filename: req.file.filename,
        caption,
        now: Date.now(),
      });

      res.json({
        ok: true,
        meme: { id, url: `/uploads/${req.file.filename}`, caption, username: req.user.username },
      });
    });
  });

  return router;
}
