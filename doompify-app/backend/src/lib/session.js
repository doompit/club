import crypto from "node:crypto";
import { config } from "../config.js";

/**
 * Tiny stateless signed-token helper (avoids adding a session store).
 * Used to carry {address, nonce} through the Discord OAuth redirect via `state`,
 * and to bind the web verify flow. Not a full auth system — short TTL only.
 */
export function sign(payload, ttlMs = 30 * 60 * 1000) {
  const data = { ...payload, exp: Date.now() + ttlMs };
  const json = Buffer.from(JSON.stringify(data)).toString("base64url");
  const mac = crypto
    .createHmac("sha256", config.sessionSecret)
    .update(json)
    .digest("base64url");
  return `${json}.${mac}`;
}

export function verify(token) {
  if (!token || !token.includes(".")) return null;
  const [json, mac] = token.split(".");
  const expected = crypto
    .createHmac("sha256", config.sessionSecret)
    .update(json)
    .digest("base64url");
  if (
    mac.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))
  ) {
    return null;
  }
  const data = JSON.parse(Buffer.from(json, "base64url").toString());
  if (data.exp < Date.now()) return null;
  return data;
}
