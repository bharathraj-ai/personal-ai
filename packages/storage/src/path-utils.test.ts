import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  assertSafeSegment,
  isKeyOwnedByProject,
  isKeyOwnedByUser,
  userProjectKey,
  userProjectPrefix,
} from "./path-utils.js";

describe("S3 path security", () => {
  it("rejects path traversal in segments", () => {
    assert.throws(() => assertSafeSegment("../evil", "userId"), /Invalid userId/);
    assert.throws(() => userProjectKey("u1", "p1", "../../etc/passwd"), /Invalid relative path/);
  });

  it("builds scoped keys", () => {
    assert.equal(userProjectPrefix("user-a", "proj-1"), "users/user-a/projects/proj-1");
    assert.equal(
      userProjectKey("user-a", "proj-1", "artifacts/model.pkl"),
      "users/user-a/projects/proj-1/artifacts/model.pkl",
    );
  });

  it("enforces ownership checks", () => {
    const key = userProjectKey("user-a", "proj-1", "file.txt");
    assert.equal(isKeyOwnedByUser(key, "user-a"), true);
    assert.equal(isKeyOwnedByUser(key, "user-b"), false);
    assert.equal(isKeyOwnedByProject(key, "user-a", "proj-1"), true);
    assert.equal(isKeyOwnedByProject(key, "user-a", "proj-2"), false);
  });
});
