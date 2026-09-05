#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createDatabase, parseDatabaseTarget, runMigrations } from "./client.js";

function loadDatabaseUrl(): string | undefined {
  if (process.env.DATABASE_URL?.trim()) return process.env.DATABASE_URL.trim();

  const candidates = [
    resolve(process.cwd(), "../../apps/api/.env"),
    resolve(process.cwd(), "../apps/api/.env"),
    resolve(process.cwd(), ".env"),
  ];

  for (const file of candidates) {
    if (!existsSync(file)) continue;
    const line = readFileSync(file, "utf8")
      .split("\n")
      .find((l) => l.startsWith("DATABASE_URL="));
    if (!line) continue;
    let value = line.slice("DATABASE_URL=".length).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    return value || undefined;
  }
  return undefined;
}

const url = loadDatabaseUrl();
if (!url) {
  console.error("DATABASE_URL is required (set env or apps/api/.env)");
  process.exit(1);
}

const target = parseDatabaseTarget(url);
console.log(
  JSON.stringify({
    host: target.host,
    hostKind: target.hostKind,
    usesInternet: target.usesInternet,
    pooler: target.pooler,
  }),
);

const db = await createDatabase(url);
try {
  const applied = await runMigrations(db);
  console.log(applied.length ? `Applied: ${applied.join(", ")}` : "No new migrations");
  const health = await db.healthCheck();
  console.log("Health:", health);
} finally {
  await db.close();
}
