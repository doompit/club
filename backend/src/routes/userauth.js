import express from "express";
import { config } from "../config.js";
import { buildOAuthUrl, exchangeCodeForUser } from "../lib/discord.js";
import { sign, verify } from "../lib/session.js";
import { userCookie, clearUserCookie, getUser } from "../lib/usersession.js";

/**
 * Website user login (separate from admin login). Identifies the visitor via
 * Discord so uploads and the daily spin can be tied to them. Their DOOMPS
 * holder status is checked against wallets already linked through verification.
 */
export function userAuthRouter() {
  const router = express.Router();

  router.get("/login", (_req, res) => {
    const state = sign({ t: Date.now() }, 10 * 60 * 1000);
    res.redirect(buildOAuthUrl(state, config.discord.userRedirectUri, "identify"));
  });

  router.get("/callback", async (req, res) => {
    const code = String(req.query.code || "");
    if (!verify(String(req.query.state || ""))) {
      return res.status(400).send("Invalid login state.");
    }
    try {
      const user = await exchangeCodeForUser(code, config.discord.userRedirectUri);
      res.setHeader("Set-Cookie", userCookie(user));
      res.redirect("/#gallery");
    } catch (e) {
      res.status(500).send(`Login failed: ${e.message}`);
    }
  });

  router.post("/logout", (_req, res) => {
    res.setHeader("Set-Cookie", clearUserCookie());
    res.json({ ok: true });
  });

  router.get("/me", (req, res) => {
    const user = getUser(req);
    res.json({ authenticated: !!user, user: user || null });
  });

  return router;
}
