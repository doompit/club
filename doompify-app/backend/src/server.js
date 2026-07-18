import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import { openDb } from "@doompify/shared/db.js";
import { config } from "./config.js";
import { verifyRouter } from "./routes/verify.js";
import { authRouter } from "./routes/auth.js";
import { adminRouter } from "./routes/admin.js";
import { userAuthRouter } from "./routes/userauth.js";
import { memeRouter } from "./routes/memes.js";
import { spinRouter } from "./routes/spin.js";
import { chatRouter } from "./routes/chat.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
fs.mkdirSync(path.resolve(config.uploadsDir), { recursive: true });
const db = openDb(config.dbPath);

const app = express();
app.use(cors());
app.use(express.json());

// Tight limiter for sensitive/mutating actions; looser for general reads.
const tight = rateLimit({ windowMs: 60_000, max: 20 });
const loose = rateLimit({ windowMs: 60_000, max: 120 });

// Verification + auth (sensitive)
app.use("/api/challenge", tight);
app.use("/api/confirm", tight);
app.use("/api/spin", tight);
app.use("/api", loose);

app.use("/api", verifyRouter(db));
app.use("/api", memeRouter(db));
app.use("/api", spinRouter(db));
app.use("/api", chatRouter(db));
app.use("/auth", authRouter(db));
app.use("/auth/user", userAuthRouter());
app.use("/admin/api", adminRouter(db));

app.get("/api/config", (_req, res) => {
  res.json({
    brandName: config.brandName,
    publicUrl: config.publicUrl,
    hasDoomps: !!config.doompsContract,
  });
});
app.get("/api/health", (_req, res) => res.json({ ok: true }));

// Static: uploaded memes, public site, admin panel.
const webDir = path.resolve(__dirname, "../../web/public");
const adminDir = path.resolve(__dirname, "../../web/admin");
app.use("/uploads", express.static(path.resolve(config.uploadsDir), {
  maxAge: "7d",
  setHeaders: (res) => res.setHeader("X-Content-Type-Options", "nosniff"),
}));
app.use("/admin", express.static(adminDir));

// Clean routes for The Swamp Club app pages.
// /chat -> the chat page; /memematic and /gallery -> the swamp page
// (its JS reads the #memematic / #gallery hash to scroll to the right section).
app.get("/chat", (_req, res) => res.sendFile(path.join(webDir, "chat.html")));
app.get("/memematic", (_req, res) => res.redirect("/swamp.html#memematic"));
app.get("/gallery", (_req, res) => res.redirect("/swamp.html#gallery"));

app.use(express.static(webDir));

app.listen(config.port, () => {
  console.log(`${config.brandName} backend on ${config.publicUrl} (port ${config.port})`);
});
