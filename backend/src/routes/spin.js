import express from "express";
import { config } from "../config.js";
import { requireUser } from "../lib/usersession.js";
import { isHolder } from "../lib/holder.js";
import {
  resolveSpin,
  dayKeyUTC,
  WHEEL_SEGMENTS,
  WINNING_TIERS,
} from "@doompify/shared";
import {
  getPrizeConfig,
  getSpinForDay,
  recordSpin,
  userHasUploaded,
  setPayoutAddress,
  winnersByTierToday,
} from "@doompify/shared/db.js";
import { normalizeAddress } from "@doompify/shared";

export function spinRouter(db) {
  const router = express.Router();

  /**
   * GET /api/spin/state — what the client needs to render the wheel + gate.
   * Returns wheel segments, current prize labels, and whether the user can spin
   * today (and their result if they already spun).
   */
  router.get("/spin/state", async (req, res) => {
    const prizes = getPrizeConfig(db);
    const base = { segments: WHEEL_SEGMENTS, prizes };

    const { getUser } = await import("../lib/usersession.js");
    const u = getUser(req);
    if (!u) return res.json({ ...base, authenticated: false });

    const dayKey = dayKeyUTC();
    const existing = getSpinForDay(db, { discordId: u.id, dayKey });
    const uploaded = userHasUploaded(db, { discordId: u.id });

    res.json({
      ...base,
      authenticated: true,
      hasUploaded: uploaded,
      alreadySpun: !!existing,
      todayResult: existing ? { outcome: existing.outcome, label: existing.label } : null,
    });
  });

  /**
   * POST /api/spin/practice — a FREE practice spin. Anyone logged in can do this
   * as often as they like. It returns a random wheel result for show only — it
   * does NOT record a spin, does NOT pay out, and never consumes a daily winner
   * slot. Purely "here's what you might have gotten."
   */
  router.post("/spin/practice", requireUser, (req, res) => {
    const prizes = getPrizeConfig(db);
    // Full odds, no daily-cap awareness — it's just a demo of the wheel.
    const result = resolveSpin({ prizeLabels: prizes });
    res.json({
      ok: true,
      practice: true,
      outcome: result.outcome,
      isWin: result.isWin,
      segmentIndex: result.segmentIndex,
      segmentLabel: result.segmentLabel,
      prize: result.isWin ? result.prize : null,
    });
  });

  /**
   * POST /api/spin — perform today's REAL spin. Holder + uploaded + not-yet-spun.
   */
  router.post("/spin", requireUser, async (req, res) => {
    const discordId = req.user.id;
    const dayKey = dayKeyUTC();

    // Already spun today?
    if (getSpinForDay(db, { discordId, dayKey })) {
      return res.status(409).json({ error: "You already spun today. Come back tomorrow (UTC).", alreadySpun: true });
    }

    // Must have uploaded at least one meme.
    if (!userHasUploaded(db, { discordId })) {
      return res.status(403).json({ error: "Upload a meme first to unlock your spin.", needUpload: true });
    }

    // Must currently hold DOOMPS.
    let holder;
    try {
      holder = await isHolder(db, { discordId, guildId: config.discord.guildId });
    } catch (e) {
      return res.status(502).json({ error: `Holder check failed: ${e.message}` });
    }
    if (!holder.isHolder) {
      return res.status(403).json({ error: "Only current DOOMPS holders can spin.", needVerify: true });
    }

    // Resolve server-side (authoritative), then persist. The unique constraint
    // on (discord_id, day_key) is the final guard against double-spin races.
    // Enforce the daily cap: at most one winner per tier (4 winners/day). A tier
    // whose slot is already filled today can't be won again — it rugs instead.
    const prizes = getPrizeConfig(db);
    const taken = winnersByTierToday(db, { dayKey });
    const availableTiers = WINNING_TIERS.filter((t) => (taken[t] || 0) < 1);
    const result = resolveSpin({ prizeLabels: prizes, availableTiers });
    const rec = recordSpin(db, {
      discordId,
      dayKey,
      outcome: result.outcome,
      label: result.segmentLabel,
      prizeLabel: result.prize,
      username: req.user.username,
      now: Date.now(),
    });
    if (!rec.ok && rec.already) {
      return res.status(409).json({ error: "You already spun today.", alreadySpun: true });
    }

    res.json({
      ok: true,
      outcome: result.outcome, // big|medium|small|tiny|rug
      isWin: result.isWin,
      segmentIndex: result.segmentIndex, // where the wheel should stop
      segmentLabel: result.segmentLabel,
      prize: result.prize, // resolved prize label if win, else null
      needAddress: result.isWin, // client should prompt for payout wallet
    });
  });

  /**
   * POST /api/spin/claim { address } — a winner submits the wallet to receive
   * today's prize. Only valid for the caller's own winning, unpaid spin.
   */
  router.post("/spin/claim", requireUser, (req, res) => {
    let address;
    try {
      address = normalizeAddress(req.body.address);
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }
    const dayKey = dayKeyUTC();
    const r = setPayoutAddress(db, {
      discordId: req.user.id,
      dayKey,
      address,
      now: Date.now(),
    });
    if (!r.ok) {
      return res.status(400).json({ error: `Can't claim: ${r.reason}` });
    }
    res.json({ ok: true, prize: r.prizeLabel });
  });

  return router;
}
