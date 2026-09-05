import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));

export type DatabaseHostKind = "neon" | "local" | "remote" | "none";

export interface DatabaseHealth {
  healthy: boolean;
  pgvector: boolean;
  message?: string;
  latencyMs?: number;
  hostKind?: DatabaseHostKind;
  /** Hostname only — never includes credentials */
  host?: string;
  usesInternet?: boolean;
  pooler?: boolean;
}

export interface DatabaseClient {
  query<T extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    params?: unknown[],
  ): Promise<pg.QueryResult<T>>;
  /** Full check including pgvector extension probe (startup / diagnostics). */
  healthCheck(): Promise<DatabaseHealth>;
  /** Lightweight cached ping for frequent /health — single SELECT 1, deduped. */
  healthCheckLite(): Promise<DatabaseHealth>;
  close(): Promise<void>;
  readonly pool: pg.Pool;
  readonly hostKind: DatabaseHostKind;
  readonly usesInternet: boolean;
}

export function parseDatabaseTarget(databaseUrl: string): {
  host: string;
  hostKind: DatabaseHostKind;
  usesInternet: boolean;
  pooler: boolean;
  isNeon: boolean;
} {
  let host = "unknown";
  try {
    const u = new URL(databaseUrl);
    host = u.hostname || "unknown";
  } catch {
    host = "invalid-url";
  }

  const lower = databaseUrl.toLowerCase();
  const isNeon = host.includes("neon.tech") || lower.includes("neon.tech");
  const pooler = host.includes("-pooler") || lower.includes("pooler");
  const isLocal =
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host.endsWith(".local");

  const hostKind: DatabaseHostKind = isNeon
    ? "neon"
    : isLocal
      ? "local"
      : host === "unknown" || host === "invalid-url"
        ? "none"
        : "remote";

  return {
    host,
    hostKind,
    usesInternet: hostKind === "neon" || hostKind === "remote",
    pooler,
    isNeon,
  };
}

/** Neon serverless prefers fewer long-lived connections; use the pooler URL when possible. */
export function createPoolConfig(databaseUrl: string): pg.PoolConfig {
  const target = parseDatabaseTarget(databaseUrl);
  const defaultMax = target.isNeon ? (target.pooler ? 5 : 3) : 10;

  return {
    connectionString: databaseUrl,
    max: Number(process.env.DB_POOL_MAX ?? defaultMax),
    idleTimeoutMillis: Number(process.env.DB_IDLE_TIMEOUT_MS ?? (target.isNeon ? 10_000 : 30_000)),
    connectionTimeoutMillis: Number(
      process.env.DB_CONNECT_TIMEOUT_MS ??
        (target.isNeon ? 45_000 : target.usesInternet ? 20_000 : 5_000),
    ),
    ssl:
      target.isNeon || databaseUrl.includes("sslmode=require")
        ? { rejectUnauthorized: false }
        : undefined,
    allowExitOnIdle: true,
  };
}

export async function createDatabase(databaseUrl: string): Promise<DatabaseClient> {
  const trimmed = databaseUrl.trim();
  if (!trimmed) {
    throw new Error("DATABASE_URL is empty");
  }

  const target = parseDatabaseTarget(trimmed);
  let connectionString = trimmed;
  // Avoid pg v8 SSL mode warning / future breakage with Neon sslmode=require
  if (target.isNeon && !connectionString.includes("uselibpqcompat=")) {
    connectionString += connectionString.includes("?")
      ? "&uselibpqcompat=true"
      : "?uselibpqcompat=true";
  }

  const pool = new pg.Pool(createPoolConfig(connectionString));

  // Prefer Personal AI schema so we never collide with Bharath AI public tables
  pool.on("connect", (c) => {
    void c.query("SET search_path TO personal_ai, public");
  });

  const probe = await pool.connect();
  try {
    await probe.query("SET search_path TO personal_ai, public");
    await probe.query("SELECT 1");
  } finally {
    probe.release();
  }

  const client: DatabaseClient = {
    pool,
    hostKind: target.hostKind,
    usesInternet: target.usesInternet,
    async query(text, params) {
      return pool.query(text, params);
    },
    async healthCheckLite() {
      return runDedupedHealthCheck(client as DatabaseClient, target, { lite: true });
    },
    async healthCheck() {
      return runDedupedHealthCheck(client as DatabaseClient, target, { lite: false });
    },
    async close() {
      await pool.end();
    },
  };

  return client;
}

const HEALTH_LITE_TTL_MS = Number(process.env.DB_HEALTH_LITE_TTL_MS ?? 5_000);
const HEALTH_LITE_TIMEOUT_MS = Number(process.env.DB_HEALTH_LITE_TIMEOUT_MS ?? 10_000);

type HealthState = {
  liteInFlight?: Promise<DatabaseHealth>;
  fullInFlight?: Promise<DatabaseHealth>;
  liteCache?: { at: number; result: DatabaseHealth };
  fullCache?: { at: number; result: DatabaseHealth };
};

const healthStateByPool = new WeakMap<pg.Pool, HealthState>();

function poolHealthState(pool: pg.Pool): HealthState {
  let state = healthStateByPool.get(pool);
  if (!state) {
    state = {};
    healthStateByPool.set(pool, state);
  }
  return state;
}

async function runDedupedHealthCheck(
  client: DatabaseClient,
  target: ReturnType<typeof parseDatabaseTarget>,
  opts: { lite: boolean },
): Promise<DatabaseHealth> {
  const state = poolHealthState(client.pool);
  const cache = opts.lite ? state.liteCache : state.fullCache;
  const ttl = opts.lite ? HEALTH_LITE_TTL_MS : HEALTH_LITE_TTL_MS * 2;
  if (cache && Date.now() - cache.at < ttl) {
    return cache.result;
  }

  const inFlightKey = opts.lite ? "liteInFlight" : "fullInFlight";
  if (state[inFlightKey]) {
    return state[inFlightKey]!;
  }

  state[inFlightKey] = executeHealthCheck(client, target, opts.lite).then((result) => {
    if (opts.lite) {
      state.liteCache = { at: Date.now(), result };
    } else {
      state.fullCache = { at: Date.now(), result };
    }
    return result;
  }).finally(() => {
    state[inFlightKey] = undefined;
  });

  return state[inFlightKey]!;
}

async function executeHealthCheck(
  client: DatabaseClient,
  target: ReturnType<typeof parseDatabaseTarget>,
  lite: boolean,
): Promise<DatabaseHealth> {
  const started = Date.now();
  const timeoutMs = lite ? HEALTH_LITE_TIMEOUT_MS : HEALTH_LITE_TIMEOUT_MS * 2;

  try {
    await withQueryTimeout(client.pool.query("SELECT 1"), timeoutMs);
    if (lite) {
      return {
        healthy: true,
        pgvector: false,
        latencyMs: Date.now() - started,
        hostKind: target.hostKind,
        host: target.host,
        usesInternet: target.usesInternet,
        pooler: target.pooler,
        message: target.usesInternet
          ? `Connected to ${target.hostKind} over the internet`
          : "Connected to local Postgres",
      };
    }

    const ext = await withQueryTimeout(
      client.pool.query<{ exists: boolean }>(
        `SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname = 'vector') AS exists`,
      ),
      timeoutMs,
    );
    return {
      healthy: true,
      pgvector: Boolean(ext.rows[0]?.exists),
      latencyMs: Date.now() - started,
      hostKind: target.hostKind,
      host: target.host,
      usesInternet: target.usesInternet,
      pooler: target.pooler,
      message: target.usesInternet
        ? `Connected to ${target.hostKind} over the internet`
        : "Connected to local Postgres",
    };
  } catch (err) {
    return {
      healthy: false,
      pgvector: false,
      latencyMs: Date.now() - started,
      hostKind: target.hostKind,
      host: target.host,
      usesInternet: target.usesInternet,
      pooler: target.pooler,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

function withQueryTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`database query timeout after ${timeoutMs}ms`)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

export async function runMigrations(db: DatabaseClient): Promise<string[]> {
  await db.query(`CREATE SCHEMA IF NOT EXISTS personal_ai`);
  await db.query(`SET search_path TO personal_ai, public`);
  await db.query(`
    CREATE TABLE IF NOT EXISTS personal_ai.schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const applied: string[] = [];
  const migrations = [
    "001_phase6_memory_rag.sql",
    "002_users_external_id.sql",
    "003_audit_s3_artifacts.sql",
    "004_project_plans.sql",
  ];

  for (const file of migrations) {
    const id = file.replace(/\.sql$/, "");
    const existing = await db.query<{ id: string }>(
      "SELECT id FROM personal_ai.schema_migrations WHERE id = $1",
      [id],
    );
    if (existing.rows.length > 0) continue;

    const sql = await readFile(join(__dirname, "../migrations", file), "utf8");
    await db.query(sql);
    await db.query("INSERT INTO personal_ai.schema_migrations (id) VALUES ($1)", [id]);
    applied.push(id);
  }

  return applied;
}

export async function ensureUser(
  db: DatabaseClient,
  externalId: string,
  name?: string,
): Promise<{ id: string; externalId: string }> {
  // Always qualify schema — never hit a colliding public.users table
  const existing = await db.query<{ id: string; external_id: string }>(
    "SELECT id, external_id FROM personal_ai.users WHERE external_id = $1",
    [externalId],
  );
  if (existing.rows[0]) {
    return { id: existing.rows[0].id, externalId: existing.rows[0].external_id };
  }

  const inserted = await db.query<{ id: string; external_id: string }>(
    `INSERT INTO personal_ai.users (external_id, name) VALUES ($1, $2)
     RETURNING id, external_id`,
    [externalId, name ?? null],
  );
  return { id: inserted.rows[0].id, externalId: inserted.rows[0].external_id };
}

export type { pg };
