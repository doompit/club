import { sign, verify } from "./session.js";

export const USER_COOKIE = "doompify_user";

export function parseCookies(req) {
  const raw = req.headers.cookie || "";
  return Object.fromEntries(
    raw
      .split(";")
      .map((c) => c.trim().split("=").map(decodeURIComponent))
      .filter((p) => p[0])
  );
}

/** Read the logged-in website user from their cookie, or null. */
export function getUser(req) {
  const cookies = parseCookies(req);
  const data = verify(cookies[USER_COOKIE]);
  if (!data || !data.uid) return null;
  return { id: data.uid, username: data.username };
}

/** Build a Set-Cookie value for a 7-day user session. */
export function userCookie(user) {
  const token = sign({ uid: user.id, username: user.username }, 7 * 24 * 60 * 60 * 1000);
  return `${USER_COOKIE}=${encodeURIComponent(token)}; HttpOnly; Path=/; Max-Age=604800; SameSite=Lax`;
}

export function clearUserCookie() {
  return `${USER_COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`;
}

/** Express middleware: require a logged-in user, else 401. */
export function requireUser(req, res, next) {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: "Not logged in.", needLogin: true });
  req.user = user;
  next();
}
