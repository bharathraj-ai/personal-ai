#!/usr/bin/env tsx
/**
 * GitHub Ingestion Script for Personal AI
 * Fetches user repositories and contributions and ingests them into RAG/Memory.
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
const GITHUB_USERNAME = process.argv[2] || process.env.GITHUB_USERNAME;

if (!GITHUB_USERNAME) {
  console.error("ERROR: Please provide a GitHub username as an argument or set GITHUB_USERNAME in .env");
  console.error("Usage: pnpm tsx scripts/ingest-github.ts <username>");
  process.exit(1);
}

const RAG_CONFIG = {
  topK: Number(process.env.RAG_TOP_K ?? 5),
  similarityThreshold: Number(process.env.RAG_SIMILARITY_THRESHOLD ?? 0.15),
  chunkSize: Number(process.env.RAG_CHUNK_SIZE ?? 600),
  chunkOverlap: Number(process.env.RAG_CHUNK_OVERLAP ?? 100),
  maxContextChars: Number(process.env.RAG_MAX_CONTEXT_CHARS ?? 6000),
};

async function fetchGitHubData(username: string) {
  console.log(`Fetching public repositories for GitHub user: ${username}...`);
  const res = await fetch(`https://api.github.com/users/${username}/repos?per_page=100&sort=updated`);
  if (!res.ok) {
    throw new Error(`Failed to fetch GitHub repos: ${res.statusText}`);
  }
  const repos = await res.json();
  return repos;
}

async function fetchRepoReadme(username: string, repoName: string, defaultBranch: string = "main") {
  const res = await fetch(`https://raw.githubusercontent.com/${username}/${repoName}/${defaultBranch}/README.md`);
  if (res.ok) {
    return await res.text();
  }
  
  // fallback to master if main fails
  if (defaultBranch === "main") {
    const resMaster = await fetch(`https://raw.githubusercontent.com/${username}/${repoName}/master/README.md`);
    if (resMaster.ok) return await resMaster.text();
  }
  return null;
}

async function main() {
  console.log("=================================================");
  console.log(" GitHub Ingestion to Personal AI ");
  console.log("=================================================");
  console.log(`Target User ID: ${USER_ID}`);
  console.log("Connecting to PostgreSQL...");

  const db = await createDatabase(DATABASE_URL!);
  const health = await db.healthCheck();

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

  const rag = new PostgresRagService(db, embeddings, RAG_CONFIG);
  const memory = new PostgresMemoryService(db, embeddings, {
    topK: RAG_CONFIG.topK,
    similarityThreshold: RAG_CONFIG.similarityThreshold,
  });

  const repos = await fetchGitHubData(GITHUB_USERNAME!);
  console.log(`Found ${repos.length} public repositories for ${GITHUB_USERNAME}.\n`);

  let ingestedCount = 0;

  for (const repo of repos) {
    if (repo.fork) continue; // Skip forks by default to focus on original contributions

    console.log(`Processing repo: ${repo.name}`);
    
    // 1. Create a Memory for the repository metadata
    const repoContext = `GitHub Repository by ${GITHUB_USERNAME}: ${repo.name}. Description: ${repo.description || "No description"}. Language: ${repo.language || "Unknown"}. Stars: ${repo.stargazers_count}.`;
    await memory.createMemory({
      userId: USER_ID,
      content: repoContext,
      memoryType: "context",
      importance: repo.stargazers_count > 10 ? 4 : 2,
      userApproved: true,
    });

    // 2. Try to fetch and ingest the README as a RAG document
    const readme = await fetchRepoReadme(GITHUB_USERNAME!, repo.name, repo.default_branch);
    if (readme) {
      console.log(`  -> Ingesting README for ${repo.name} (${Buffer.byteLength(readme, "utf-8")} bytes)`);
      try {
        await rag.ingestDocument({
          userId: USER_ID,
          filename: `github_${repo.name}_readme.md`,
          content: readme,
          mimeType: "text/markdown",
        });
        ingestedCount++;
      } catch (err: any) {
        console.error(`  -> Failed to ingest README for ${repo.name}: ${err.message}`);
      }
    } else {
      console.log(`  -> No README found for ${repo.name}.`);
    }
  }

  await db.close();
  console.log("\n=================================================");
  console.log(` GitHub Ingestion Completed! Ingested ${ingestedCount} READMEs and created memories for repos.`);
  console.log("=================================================");
}

main().catch((err) => {
  console.error("Ingestion failed:", err);
  process.exit(1);
});
