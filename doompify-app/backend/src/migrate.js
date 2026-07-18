import fs from "node:fs";
import path from "node:path";
import { openDb } from "@doompify/shared/db.js";
import { config } from "./config.js";

const dir = path.dirname(config.dbPath);
fs.mkdirSync(dir, { recursive: true });

const db = openDb(config.dbPath);
console.log(`Migrated DB at ${config.dbPath}`);
db.close();
