import type { CodingWorkspace } from "@personal-ai/coding-agent";
import { isSystemFilePath } from "@personal-ai/coding-agent";
import type { StorageService } from "./storage-service.js";

export interface ProjectSyncResult {
  uploaded: number;
  errors: string[];
  s3Prefix: string;
}

export interface ProjectRestoreResult {
  restored: number;
  errors: string[];
  s3Prefix: string;
}

export type ProjectRestoreStatus = "RESTORED" | "REUSED_LOCAL" | "RESTORE_FAILED";

export interface ProjectRestoreOutcome {
  workspaceId: string;
  restore: ProjectRestoreResult;
  status: ProjectRestoreStatus;
}

function workspaceS3Prefix(workspaceId: string): string {
  return `workspaces/${workspaceId}`;
}

type WorkspaceWithArtifacts = CodingWorkspace & {
  listAllFiles?(workspaceId: string): Promise<string[]>;
  ensureWorkspace?(userId: string, workspaceId: string, projectName: string): Promise<unknown>;
  countArtifactFiles?(workspaceId: string): Promise<number>;
  getOwned?(workspaceId: string, userId: string): { status: string } | undefined;
};

/**
 * Sync workspace files to durable storage and restore them into the SAME workspace id.
 * Storage = durable artifacts; CodingWorkspace = temporary execution.
 */
export class ProjectPersistenceService {
  constructor(
    private readonly storage: StorageService,
    private readonly workspaces: WorkspaceWithArtifacts,
  ) {}

  async listWorkspaceFiles(workspaceId: string): Promise<string[]> {
    if (this.workspaces.listAllFiles) {
      return this.workspaces.listAllFiles(workspaceId);
    }
    return this.workspaces.listFiles(workspaceId);
  }

  async syncWorkspaceToS3(
    userId: string,
    projectId: string,
    workspaceId: string,
  ): Promise<ProjectSyncResult> {
    const s3Prefix = workspaceS3Prefix(workspaceId);
    const result: ProjectSyncResult = { uploaded: 0, errors: [], s3Prefix };

    let files: string[];
    try {
      files = await this.listWorkspaceFiles(workspaceId);
    } catch (err) {
      result.errors.push(err instanceof Error ? err.message : String(err));
      return result;
    }

    for (const rel of files) {
      if (isSystemFilePath(rel)) continue;
      try {
        const content = await this.workspaces.readFile(workspaceId, rel);
        await this.storage.upload(userId, projectId, `${s3Prefix}/${rel}`, content);
        result.uploaded++;
      } catch (err) {
        result.errors.push(`${rel}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return result;
  }

  async restoreProjectFromS3(
    userId: string,
    projectId: string,
    projectName: string,
    sourceWorkspaceId: string,
  ): Promise<ProjectRestoreOutcome> {
    const s3Prefix = workspaceS3Prefix(sourceWorkspaceId);
    const restore: ProjectRestoreResult = { restored: 0, errors: [], s3Prefix };

    const owned = this.workspaces.getOwned?.(sourceWorkspaceId, userId);
    if (owned?.status === "active") {
      const artifactCount = this.workspaces.countArtifactFiles
        ? await this.workspaces.countArtifactFiles(sourceWorkspaceId)
        : (await this.listWorkspaceFiles(sourceWorkspaceId)).filter((f) => !isSystemFilePath(f))
            .length;
      if (artifactCount > 0) {
        return { workspaceId: sourceWorkspaceId, restore, status: "REUSED_LOCAL" };
      }
    }

    let objects;
    try {
      objects = await this.storage.list(userId, projectId, s3Prefix);
    } catch (err) {
      restore.errors.push(err instanceof Error ? err.message : String(err));
      return { workspaceId: sourceWorkspaceId, restore, status: "RESTORE_FAILED" };
    }

    if (objects.length === 0) {
      restore.errors.push("RESTORE_FAILED: no artifacts found for workspace");
      return { workspaceId: sourceWorkspaceId, restore, status: "RESTORE_FAILED" };
    }

    if (!this.workspaces.ensureWorkspace) {
      restore.errors.push("RESTORE_FAILED: workspace backend cannot ensure fixed workspace id");
      return { workspaceId: sourceWorkspaceId, restore, status: "RESTORE_FAILED" };
    }

    try {
      await this.workspaces.ensureWorkspace(userId, sourceWorkspaceId, projectName);
    } catch (err) {
      restore.errors.push(err instanceof Error ? err.message : String(err));
      return { workspaceId: sourceWorkspaceId, restore, status: "RESTORE_FAILED" };
    }

    for (const obj of objects) {
      const marker = `/workspaces/${sourceWorkspaceId}/`;
      const idx = obj.key.indexOf(marker);
      if (idx < 0) continue;
      const relativePath = obj.key.slice(idx + marker.length);
      if (!relativePath || relativePath.endsWith("/") || isSystemFilePath(relativePath)) continue;
      try {
        const buf = await this.storage.download(userId, projectId, `${s3Prefix}/${relativePath}`);
        await this.workspaces.writeFile(sourceWorkspaceId, relativePath, buf.toString("utf8"));
        restore.restored++;
      } catch (err) {
        restore.errors.push(`${relativePath}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (restore.restored === 0) {
      restore.errors.push("RESTORE_FAILED: artifacts listed but none restored");
      return { workspaceId: sourceWorkspaceId, restore, status: "RESTORE_FAILED" };
    }

    return { workspaceId: sourceWorkspaceId, restore, status: "RESTORED" };
  }
}
