import dotenv from "dotenv";
dotenv.config();

function req(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export const config = {
  dbPath: process.env.DB_PATH || "../data/doompify.db",
  brandName: process.env.BRAND_NAME || "Doompify",

  alchemyKey: req("ALCHEMY_API_KEY"),
  alchemyNetwork: process.env.ALCHEMY_NETWORK || "eth-mainnet",
  openseaKey: req("OPENSEA_API_KEY"),

  botToken: req("DISCORD_BOT_TOKEN"),
  clientId: req("DISCORD_CLIENT_ID"),
  guildId: req("DISCORD_GUILD_ID"),

  recheckIntervalMin: parseInt(process.env.RECHECK_INTERVAL_MIN || "360", 10),
};

export const keys = { opensea: config.openseaKey, alchemy: config.alchemyKey };
export const verifyOpts = { network: config.alchemyNetwork };
