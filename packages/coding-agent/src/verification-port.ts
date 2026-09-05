import { createServer } from "node:net";

/** Default ports often occupied on dev machines — never kill foreign processes. */
const DEFAULT_CANDIDATES = [3000, 8080, 5000, 4000, 3456, 4567, 8765];

/**
 * Pick a local TCP port for verification without binding unrelated services.
 * Tries ephemeral bind first, then a small fallback list.
 */
export async function pickVerificationPort(
  occupied: readonly number[] = DEFAULT_CANDIDATES,
): Promise<number> {
  const ephemeral = await tryEphemeralPort();
  if (ephemeral != null && !occupied.includes(ephemeral)) {
    return ephemeral;
  }
  for (let port = 9100; port <= 9199; port++) {
    if (occupied.includes(port)) continue;
    if (await isPortAvailable(port)) return port;
  }
  throw new Error("no verification port available in safe range");
}

async function tryEphemeralPort(): Promise<number | null> {
  return new Promise((resolve) => {
    const server = createServer();
    server.unref();
    server.once("error", () => resolve(null));
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : null;
      server.close(() => resolve(port));
    });
  });
}

async function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.unref();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => {
      server.close(() => resolve(true));
    });
  });
}

export function verificationPortEnv(port: number): Record<string, string> {
  return {
    PORT: String(port),
    VERIFICATION_PORT: String(port),
  };
}
