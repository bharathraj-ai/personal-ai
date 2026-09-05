import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { assertPublicHttpUrl } from "./ssrf.js";

function expectBlocked(url: string) {
  try {
    const parsed = assertPublicHttpUrl(url);
    assert.fail(`expected SSRF block for ${url}, got hostname=${parsed.hostname}`);
  } catch (err) {
    assert.equal(err instanceof Error && err.name === "SsrfBlockedError", true, String(err));
  }
}

describe("SSRF URL gate", () => {
  it("allows public https", () => {
    const u = assertPublicHttpUrl("https://en.wikipedia.org/wiki/Test");
    assert.equal(u.hostname, "en.wikipedia.org");
  });

  it("blocks localhost and loopback", () => {
    expectBlocked("http://localhost:3001/health");
    expectBlocked("http://127.0.0.1/");
    expectBlocked("http://[::1]/");
  });

  it("blocks private IPv4 and metadata", () => {
    expectBlocked("http://10.0.0.5/");
    expectBlocked("http://192.168.1.1/admin");
    expectBlocked("http://169.254.169.254/latest/meta-data/");
    expectBlocked("http://172.16.0.8/");
  });

  it("blocks file and non-http schemes", () => {
    expectBlocked("file:///etc/passwd");
  });
});
