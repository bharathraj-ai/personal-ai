/** Build identifiers surfaced at gateway startup and /health diagnostics. */
export const GATEWAY_BUILD_ID = process.env.GATEWAY_BUILD_ID ?? "p14-live";
export const VERIFICATION_PIPELINE_VERSION = "p14-neon-health-resume";
export const ORCHESTRATOR_VERSION = "p14-resume-local-workspace";

export function gatewayDiagnostics(input: {
  port: number;
  workspaceBackend: string;
  neonConnected: boolean;
  neonSelect1?: boolean;
  s3Configured: boolean;
  providers: Record<string, { healthy?: boolean }>;
}) {
  return {
    gatewayBuildId: GATEWAY_BUILD_ID,
    verificationPipelineVersion: VERIFICATION_PIPELINE_VERSION,
    orchestratorVersion: ORCHESTRATOR_VERSION,
    port: input.port,
    workspaceBackend: input.workspaceBackend,
    neonConnected: input.neonConnected,
    neonSelect1: input.neonSelect1 ?? input.neonConnected,
    s3Configured: input.s3Configured,
    providers: input.providers,
    startedAt: new Date().toISOString(),
  };
}
