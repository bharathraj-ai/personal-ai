import { ContainerCodingWorkspace, dockerAvailable } from "./container-workspace.js";
import { LocalCodingWorkspace, type LocalWorkspaceManagerOptions } from "./local-workspace.js";

/**
 * Select LocalCodingWorkspace (dev) or ContainerCodingWorkspace (isolated exec).
 * Never claims cloud sandbox. Container backend requires Docker.
 */
export async function createCodingWorkspaceFromEnv(
  options: LocalWorkspaceManagerOptions,
  log?: { info: (obj: object, msg: string) => void; warn: (obj: object, msg: string) => void },
): Promise<LocalCodingWorkspace> {
  const requested = (process.env.WORKSPACE_BACKEND ?? "").toLowerCase();
  const preferContainer =
    requested === "container" ||
    (requested !== "local" && process.env.NODE_ENV === "production");

  if (!preferContainer) {
    log?.info({ backend: "local" }, "CodingWorkspace: LocalCodingWorkspace (development host exec)");
    return new LocalCodingWorkspace(options);
  }

  const docker = await dockerAvailable();
  if (!docker) {
    log?.warn(
      { requested: requested || "production", docker: false },
      "ContainerCodingWorkspace requested but Docker is unavailable — falling back to LocalCodingWorkspace. Not a production sandbox.",
    );
    return new LocalCodingWorkspace(options);
  }

  log?.info(
    { backend: "container", image: process.env.WORKSPACE_CONTAINER_IMAGE ?? "node:22-bookworm-slim" },
    "CodingWorkspace: ContainerCodingWorkspace (docker network=none; not a cloud VM)",
  );
  return new ContainerCodingWorkspace(options);
}
