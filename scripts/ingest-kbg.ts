#!/usr/bin/env tsx
/**
 * Ingestion script to index the DATA-GUARDIAN-2.0 Knowledge-Based Graph (KBG)
 * into Personal AI's Neon PostgreSQL RAG and Memory stores.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createDatabase } from "@personal-ai/db";
import {
  createEmbeddingProvider,
  PostgresMemoryService,
} from "@personal-ai/memory";
import { PostgresRagService } from "@personal-ai/rag";

// Zero-dependency env loader
function loadEnv(filePath: string) {
  if (!existsSync(filePath)) return;
  const content = readFileSync(filePath, "utf-8");
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

loadEnv(resolve(__dirname, "../apps/api/.env"));
loadEnv(resolve(__dirname, "../.env"));

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("ERROR: DATABASE_URL is not configured in apps/api/.env");
  process.exit(1);
}

const USER_ID = process.env.AUTH_DEV_USER_ID ?? "default-user";

const RAG_CONFIG = {
  topK: Number(process.env.RAG_TOP_K ?? 5),
  similarityThreshold: Number(process.env.RAG_SIMILARITY_THRESHOLD ?? 0.15),
  chunkSize: Number(process.env.RAG_CHUNK_SIZE ?? 600),
  chunkOverlap: Number(process.env.RAG_CHUNK_OVERLAP ?? 100),
  maxContextChars: Number(process.env.RAG_MAX_CONTEXT_CHARS ?? 6000),
};

async function main() {
  console.log("=================================================");
  console.log(" DATA-GUARDIAN-2.0 KBG Ingestion to Personal AI ");
  console.log("=================================================");
  console.log(`Target User ID: ${USER_ID}`);
  console.log("Connecting to PostgreSQL...");

  const db = await createDatabase(DATABASE_URL!);
  const health = await db.healthCheck();
  console.log("Database Status:", {
    healthy: health.healthy,
    pgvector: health.pgvector,
    hostKind: health.hostKind,
  });

  if (!health.healthy) {
    console.error("Database health check failed:", health.message);
    process.exit(1);
  }

  const embeddings = createEmbeddingProvider({
    dimensions: Number(process.env.EMBEDDING_DIMENSIONS ?? 384),
    apiUrl: process.env.EMBEDDING_API_URL,
    apiKey: process.env.EMBEDDING_API_KEY,
    model: process.env.EMBEDDING_MODEL,
  });
  console.log(`Initialized Embedding Provider: ${embeddings.id} (${embeddings.dimensions} dimensions)`);

  const rag = new PostgresRagService(db, embeddings, RAG_CONFIG);
  const memory = new PostgresMemoryService(db, embeddings, {
    topK: RAG_CONFIG.topK,
    similarityThreshold: RAG_CONFIG.similarityThreshold,
  });

  // 1. Ingest Knowledge Base Markdown Document
  const knowledgePath = resolve(__dirname, "../data/knowledge/data_guardian_kbg.md");
  if (!existsSync(knowledgePath)) {
    console.error(`ERROR: Knowledge base file not found at ${knowledgePath}`);
    process.exit(1);
  }

  const knowledgeContent = readFileSync(knowledgePath, "utf-8");
  console.log(`\n1. Ingesting Document: data_guardian_kbg.md (${Buffer.byteLength(knowledgeContent, "utf-8")} bytes)...`);

  const doc = await rag.ingestDocument({
    userId: USER_ID,
    filename: "data_guardian_kbg.md",
    content: knowledgeContent,
    mimeType: "text/markdown",
  });

  console.log(`Document Ingested Successfully! ID: ${doc.id}, Status: ${doc.status}`);

  // 2. Ingest Core Invariant & Architectural Memories
  console.log("\n2. Ingesting Core Architectural Invariants as Persistent Memories...");
  const coreMemories = [
    "DATA-GUARDIAN-2.0 INV-001 (Plaintext Storage Prohibition): Plaintext sensitive files must never be persisted directly to MongoDB GridFS or PostgreSQL. Enforced in create-link-stage.ts:stagePlainFile.",
    "DATA-GUARDIAN-2.0 INV-002 (DEK Envelope Protection): Ephemeral 32-byte Data Encryption Keys (DEKs) are wrapped with 256-bit Master KEK or KMS (prefix kms:http:), never stored plaintext in PostgreSQL.",
    "DATA-GUARDIAN-2.0 INV-003 (OTP Rate Limiting & Lockout): Max 10 attempts per 15 min per IP via Redis Lua script; 3 failed OTP attempts permanently locks the SecureLink.",
    "DATA-GUARDIAN-2.0 INV-004 (Immediate Revocation Propagation): Owner kill-switch revokes SecureLink and sets revoked:{token} in Upstash Redis (24h TTL); checked before DB lookups for sub-second termination.",
    "DATA-GUARDIAN-2.0 INV-005 (Active Device Fingerprint Binding): Vendor session is bound to SHA-256 hash of IP + User-Agent + Accept-Language; mismatch returns 401.",
    "DATA-GUARDIAN-2.0 INV-006 (Tamper-Evident Audit Hash Chaining): AuditLog entries are hashed with AUDIT_HMAC_SECRET linking entryHash to prevHash to guarantee forensic immutability.",
    "DATA-GUARDIAN-2.0 INV-007 (Zero-Knowledge Server Limitation): Documented as NOT ENFORCED because server-side Node.js memory unwraps DEKs for in-browser Word/Excel conversions.",
    "DATA-GUARDIAN-2.0 INV-008 (Compliance Record Survival): SendRecord tombstones and stamped AuditLogs survive link expiration and file deletion for compliance reporting.",
    "DATA-GUARDIAN-2.0 INV-009 (Dual File Validation): Staging verifies both extension allowlist and first 4100 bytes magic binary signature to block masquerading and polyglot files.",
    "DATA-GUARDIAN-2.0 INV-010 (Hierarchical Concurrency Preemption): Owner (Rank 1) preempts Vendor (Rank 2) edit locks with a 15-second grace period for auto-saving work.",
  ];

  let memoryCount = 0;
  for (const item of coreMemories) {
    const res = await memory.createMemory({
      userId: USER_ID,
      content: item,
      memoryType: "context",
      importance: 5,
      userApproved: true,
    });
    if (!("rejected" in res && res.rejected)) {
      memoryCount++;
    }
  }
  console.log(`Ingested ${memoryCount}/${coreMemories.length} Core Invariant Memories.`);

  // 3. Verification Search Queries
  console.log("\n3. Testing Semantic RAG Retrieval...");
  const queries = [
    "DEK envelope encryption master KEK",
    "How does OTP rate limiting and lockout work?",
    "Hierarchical priority takeover grace period",
  ];

  for (const q of queries) {
    console.log(`\nQuery: "${q}"`);
    const results = await rag.search({
      userId: USER_ID,
      query: q,
      limit: 2,
    });
    console.log(`Found ${results.length} relevant chunks:`);
    for (const r of results) {
      console.log(`  - [Score: ${r.score.toFixed(3)}] ${r.content.slice(0, 140).replace(/\n/g, " ")}...`);
    }
  }

  await db.close();
  console.log("\n=================================================");
  console.log(" KBG Ingestion & Verification Completed! ");
  console.log("=================================================");
}

main().catch((err) => {
  console.error("Ingestion failed:", err);
  process.exit(1);
});
