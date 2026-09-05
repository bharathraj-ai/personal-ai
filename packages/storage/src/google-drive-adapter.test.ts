import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createGoogleDriveFromEnv } from "./google-drive-adapter.js";

describe("GoogleDriveAdapter", () => {
  it("is not created when Drive is unconfigured", () => {
    const prevFolder = process.env.GOOGLE_DRIVE_FOLDER_ID;
    const prevToken = process.env.GOOGLE_DRIVE_ACCESS_TOKEN;
    delete process.env.GOOGLE_DRIVE_FOLDER_ID;
    delete process.env.GOOGLE_DRIVE_ACCESS_TOKEN;
    assert.equal(createGoogleDriveFromEnv(), null);
    if (prevFolder) process.env.GOOGLE_DRIVE_FOLDER_ID = prevFolder;
    if (prevToken) process.env.GOOGLE_DRIVE_ACCESS_TOKEN = prevToken;
  });
});
