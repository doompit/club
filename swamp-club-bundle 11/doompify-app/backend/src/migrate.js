import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { openDb } from "@doompify/shared/db.js";

dotenv.config();

// Migration only needs the database path — it must NOT require API keys or
// Discord secrets, so it can run during a build step (e.g. Render) where those
// runtime secrets may not be present. Read DB_PATH directly instead of pulling
// in the full config (which validates all runtime env vars).
const dbPath = process.env.DB_PATH || "../data/doompify.db";

const dir = path.dirname(dbPath);
fs.mkdirSync(dir, { recursive: true });

const db = openDb(dbPath);
console.log(`Migrated DB at ${dbPath}`);
db.close();
