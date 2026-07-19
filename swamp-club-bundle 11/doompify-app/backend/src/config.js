import dotenv from "dotenv";
dotenv.config();

function req(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

// Normalized public base URL (no trailing slash) — all OAuth redirect URIs
// derive from this so they match what's registered in Discord.
const PUBLIC = (process.env.PUBLIC_URL || "http://localhost:4000").replace(/\/+$/, "");

export const config = {
  port: parseInt(process.env.PORT || "4000", 10),
  publicUrl: (process.env.PUBLIC_URL || "http://localhost:4000").replace(/\/+$/, ""),
  dbPath: process.env.DB_PATH || "../data/doompify.db",

  brandName: process.env.BRAND_NAME || "Doompify",

  // DOOMPS collection used to gate meme uploads + daily spins.
  doompsContract: (process.env.DOOMPS_CONTRACT || "").trim().toLowerCase() || null,

  // Where uploaded memes are stored on local disk.
  uploadsDir: process.env.UPLOADS_DIR || "../data/uploads",
  maxUploadBytes: parseInt(process.env.MAX_UPLOAD_BYTES || String(8 * 1024 * 1024), 10),

  alchemyKey: req("ALCHEMY_API_KEY"),
  alchemyNetwork: process.env.ALCHEMY_NETWORK || "eth-mainnet",
  openseaKey: req("OPENSEA_API_KEY"),

  discord: {
    clientId: req("DISCORD_CLIENT_ID"),
    clientSecret: req("DISCORD_CLIENT_SECRET"),
    // All three redirect URIs derive from PUBLIC_URL by default so they always
    // match what you register in Discord. Override individually only if needed.
    redirectUri: process.env.DISCORD_REDIRECT_URI || PUBLIC + "/auth/discord/callback",
    guildId: req("DISCORD_GUILD_ID"),
    botToken: req("DISCORD_BOT_TOKEN"),
    // Login for the website itself (uploads/spin identity).
    userRedirectUri: process.env.USER_REDIRECT_URI || PUBLIC + "/auth/user/callback",
  },

  admin: {
    // roles allowed to manage rules (comma-separated ids)
    roleIds: (process.env.ADMIN_ROLE_IDS || "").split(",").map((s) => s.trim()).filter(Boolean),
    ownerId: process.env.ADMIN_OWNER_ID || null,
    redirectUri: process.env.ADMIN_REDIRECT_URI || PUBLIC + "/admin/api/callback",
  },

  sessionSecret: process.env.SESSION_SECRET || "dev-insecure-secret",
};

export const keys = { opensea: config.openseaKey, alchemy: config.alchemyKey };
export const verifyOpts = { network: config.alchemyNetwork };
