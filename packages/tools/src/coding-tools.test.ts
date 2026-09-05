import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { CodingWorkspace, WorkspaceInfo } from "@personal-ai/coding-agent";
import { createCodingTools } from "./coding-tools.js";

function baseInfo(id: string, projectName: string): WorkspaceInfo {
  return {
    id,
    projectName,
    userId: "u1",
    status: "active",
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 86400000),
    sandboxProvider: "self-hosted",
  };
}

function mockWorkspace(workspaces: WorkspaceInfo[]) {
  let created = 0;
  const api = {
    async create(_userId: string, projectName = "project") {
      created += 1;
      const info = baseInfo(`ws-new-${created}`, projectName);
      workspaces.push(info);
      return info;
    },
    list() {
      return workspaces.filter((w) => w.status === "active");
    },
    get(id: string) {
      return workspaces.find((x) => x.id === id);
    },
    async listFiles() {
      return [".workspace.json"];
    },
    async readFile() {
      return "";
    },
    async writeFile() {},
    async deleteFile() {},
    async exec() {
      return { exitCode: 0, stdout: "", stderr: "", timedOut: false, durationMs: 1 };
    },
  } satisfies Partial<CodingWorkspace>;
  return api as unknown as CodingWorkspace;
}

describe("create_workspace forceNew", () => {
  it("does not reuse an existing workspace when forceNew is true", async () => {
    const store = [baseInfo("b0a22cdb-old", "rest-api")];
    const tools = createCodingTools({
      workspaces: mockWorkspace(store),
      getUserId: () => "u1",
    });
    const createWs = tools.find((t) => t.definition.name === "create_workspace");
    assert.ok(createWs);

    const reused = await createWs!.execute({ projectName: "rest-api" });
    assert.equal((reused.output as { reused?: boolean }).reused, true);
    assert.equal((reused.output as { workspaceId: string }).workspaceId, "b0a22cdb-old");

    const fresh = await createWs!.execute({ projectName: "rest-api", forceNew: true });
    assert.equal((fresh.output as { reused?: boolean }).reused, false);
    assert.notEqual((fresh.output as { workspaceId: string }).workspaceId, "b0a22cdb-old");
    assert.equal(store.length, 2);
  });
});
