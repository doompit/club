import express from "express";
import {
  normalizeAddress,
  generateNonce,
  buildChallengeString,
  proveControl,
  isHolderOfCollection,
  CHALLENGE_TTL_MS,
} from "@doompify/shared";
import {
  createChallenge,
  findActiveChallenge,
  consumeChallenge,
  linkWallet,
} from "@doompify/shared/db.js";
import { config, keys, verifyOpts } from "../config.js";
import { sign, verify } from "../lib/session.js";

export function verifyRouter(db) {
  const router = express.Router();

  /**
   * POST /api/challenge  { address }
   * Issues a per-wallet challenge string.
   */
  router.post("/challenge", (req, res) => {
    let address;
    try {
      address = normalizeAddress(req.body.address);
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }

    const nonce = generateNonce();
    const now = Date.now();
    createChallenge(db, { address, nonce, createdAt: now, expiresAt: now + CHALLENGE_TTL_MS });

    res.json({
      address,
      challengeString: buildChallengeString(address, nonce),
      brandName: config.brandName,
      expiresInMs: CHALLENGE_TTL_MS,
    });
  });

  /**
   * POST /api/confirm  { address, nonce }
   * Verifies control via OpenSea bio. On success returns a signed proof token
   * carrying the verified address, which the web flow presents at the OAuth
   * step to link it to a Discord account. Multiple wallets each go through this.
   */
  router.post("/confirm", async (req, res) => {
    let address;
    try {
      address = normalizeAddress(req.body.address);
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }
    const nonce = String(req.body.nonce || "");
    const now = Date.now();

    const challenge = findActiveChallenge(db, { address, nonce, now });
    if (!challenge) {
      return res.status(400).json({ error: "No active challenge (expired or not found)." });
    }

    let result;
    try {
      result = await proveControl({ address, nonce, keys, contract: config.doompsContract, opts: verifyOpts });
    } catch (e) {
      return res.status(502).json({ error: `Verification error: ${e.message}` });
    }

    if (!result.controlProven) {
      return res.status(200).json({ ok: false, ...result });
    }

    // Control proven. Now check the wallet actually holds DOOMPS, so we can give
    // a clear "no DOOMPS found" message instead of a confusing failure.
    if (config.doompsContract) {
      try {
        const { isHolder } = await isHolderOfCollection(
          address,
          config.doompsContract,
          keys.alchemy,
          verifyOpts
        );
        if (!isHolder) {
          return res.status(200).json({
            ok: false,
            controlProven: true,
            holdsDoomps: false,
            reason:
              "Wallet verified, but no DOOMPS were found in it. Link a wallet that holds DOOMPS, or buy one and try again.",
          });
        }
      } catch (e) {
        // Don't hard-fail verification on a holdings-check blip — control is
        // already proven; roles get re-synced on a schedule anyway.
        console.error("Holder check during confirm failed:", e.message);
      }
    }

    consumeChallenge(db, challenge.id);
    // Proof can carry an existing session of already-verified addresses so a
    // user can stack multiple wallets before linking Discord once.
    const prior = verify(String(req.body.session || "")) || { addresses: [] };
    const addresses = Array.from(new Set([...(prior.addresses || []), address]));
    const proof = sign({ addresses, verified: true }, 20 * 60 * 1000);

    res.json({ ok: true, ...result, address, addresses, proof });
  });

  return router;
}
