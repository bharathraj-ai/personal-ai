/**
 * P10-K: CodingAgent must not call providers directly — only via injected proposeFiles.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const srcDir = join(dirname(fileURLToPath(import.meta.url)));

describe("CodingAgent provider boundary", () => {
  it("K: no direct Groq/Gemini/Cerebras provider calls in CodingAgent sources", () => {
    const forbidden = [
      /from\s+["']@personal-ai\/providers/,
      /GroqAdapter|GeminiAdapter|CerebrasAdapter/,
      /fetch\s*\(\s*["']https:\/\/api\.(groq|google)/,
      /openai\.com\/v1/,
    ];
    const files = readdirSync(srcDir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
    for (const file of files) {
      const body = readFileSync(join(srcDir, file), "utf8");
      for (const re of forbidden) {
        assert.equal(re.test(body), false, `${file} must route through ProviderManager (${re})`);
      }
    }
  });
});
