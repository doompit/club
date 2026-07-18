/**
 * start-all.js — runs the backend API and the Discord bot in ONE process.
 *
 * Why: this app uses a local SQLite file for its database and a local folder
 * for uploaded images. On Render, a persistent disk can be mounted to only one
 * service, and both the API and the bot must read/write that same database.
 * Running them together in a single service (sharing the mounted disk) is the
 * simplest correct setup.
 *
 * This script:
 *   1. Registers the Discord slash commands (idempotent — safe every boot).
 *   2. Starts the bot.
 *   3. Starts the backend web server.
 *
 * If you'd rather run them as separate Render services, you'll need an external
 * shared database (e.g. Postgres) instead of the local SQLite file — see
 * RENDER.md, "Advanced: separate services".
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function run(name, cwd, args, { optional = false } = {}) {
  return new Promise((resolve) => {
    const child = spawn("node", args, {
      cwd: path.join(__dirname, cwd),
      stdio: "inherit",
      env: process.env,
    });
    child.on("exit", (code) => {
      console.log(`[${name}] exited with code ${code}`);
      if (!optional && code !== 0) {
        // A fatal exit of a long-running process should bring the container
        // down so Render restarts it.
        process.exit(code || 1);
      }
      resolve(code);
    });
    child.on("error", (err) => {
      console.error(`[${name}] failed to start:`, err.message);
      if (!optional) process.exit(1);
      resolve(1);
    });
    // Stash the handle so we don't garbage-collect long-running children.
    run._children = run._children || [];
    run._children.push(child);
  });
}

async function main() {
  // 1. Register slash commands (runs to completion, then continues).
  console.log("[start-all] registering slash commands…");
  await run("register", "bot", ["src/register-commands.js"], { optional: true });

  // 2. Start the bot (long-running).
  console.log("[start-all] starting Discord bot…");
  run("bot", "bot", ["src/index.js"]);

  // 3. Start the backend web server (long-running).
  console.log("[start-all] starting backend API…");
  run("backend", "backend", ["src/server.js"]);
}

main();
