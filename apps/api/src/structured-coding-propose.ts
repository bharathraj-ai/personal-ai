import type { FastifyBaseLogger } from "fastify";
import {
  CODING_STRUCTURED_SYSTEM,
  FILE_SPEC_SYSTEM,
  compactModuleContractForPrompt,
  parseFileSpecification,
  parseStructuredCodingOutput,
  toProposedFiles,
  type FileSpecification,
  type ModuleContract,
} from "@personal-ai/coding-agent";
import type { ProviderManager, StructuredExecuteResult } from "@personal-ai/providers";

type ProposedFile = {
  path: string;
  content: string;
  purpose?: string;
  operation: "create" | "edit" | "delete";
};

type StructuredOpts = {
  capability: "json_structured_output";
  preferOwnModel: boolean;
  taskType: "complex_coding";
  preferredProvider?: string;
};

function waitMarker<T>(
  executed: StructuredExecuteResult<T>,
): ProposedFile[] | null {
  if (executed.waitingForProvider) {
    return [
      {
        path: ".__wait",
        content: JSON.stringify(executed.waitingForProvider),
        purpose: "WAITING_FOR_PROVIDER",
        operation: "create",
      },
    ];
  }
  if (!executed.parsed) {
    const reason =
      executed.failureKind ??
      (executed.fallbackReason?.includes("invalid structured output")
        ? "INVALID_STRUCTURED_OUTPUT"
        : "NO_ELIGIBLE_PROVIDER");
    return [
      {
        path: ".__wait",
        content: JSON.stringify({
          reason,
          detail: executed.fallbackReason ?? executed.error,
          failureKind: executed.failureKind,
          attempted: executed.attempted,
          attemptCount: executed.attemptCount,
        }),
        purpose: "WAITING_FOR_PROVIDER",
        operation: "create",
      },
    ];
  }
  return null;
}

function logStructured(
  log: FastifyBaseLogger,
  stage: string,
  executed: StructuredExecuteResult<unknown>,
  extra?: Record<string, unknown>,
): void {
  log.info(
    {
      stage,
      selectedProvider: executed.selectedProvider,
      fallbackUsed: executed.fallbackUsed,
      fallbackReason: executed.fallbackReason,
      error: executed.error,
      attemptCount: executed.attemptCount,
      validation: executed.validation,
      failureKind: executed.failureKind,
      attempted: executed.attempted,
      responseSize: (executed.result?.content ?? "").length,
      ...extra,
    },
    "coding structured output",
  );
}

export async function proposeStructuredModuleFile(input: {
  providerManager: ProviderManager;
  log: FastifyBaseLogger;
  structuredOpts: StructuredOpts;
  moduleContract?: ModuleContract;
  target: { path: string; purpose?: string };
  allowedPaths: string[];
  relevantSnippets?: string;
}): Promise<ProposedFile[] | null> {
  const { providerManager, log, structuredOpts, moduleContract, target, allowedPaths, relevantSnippets } =
    input;
  const compact = moduleContract ? compactModuleContractForPrompt(moduleContract) : "";
  const jsonMode = { responseFormat: "json_object" as const };

  const specAttempts: Array<{ label: string; system: string; user: string; maxTokens: number }> = [
    {
      label: "spec-normal",
      system: FILE_SPEC_SYSTEM,
      user: [
        compact ? `Module: ${compact}` : "",
        `Specify ONLY this file: ${target.path}`,
        target.purpose ? `Purpose: ${target.purpose}` : "",
        relevantSnippets ? relevantSnippets.slice(0, 600) : "",
      ]
        .filter(Boolean)
        .join("\n"),
      maxTokens: 512,
    },
    {
      label: "spec-strict-json",
      system: `${FILE_SPEC_SYSTEM}\nReturn ONLY raw JSON. No markdown fences. No explanation.`,
      user: [
        compact ? `Module: ${compact}` : "",
        `File: ${target.path}`,
        `Schema: {"path":"${target.path}","purpose":"...","exports":[],"dependencies":[]}`,
      ]
        .filter(Boolean)
        .join("\n"),
      maxTokens: 512,
    },
    {
      label: "spec-reduced",
      system: FILE_SPEC_SYSTEM,
      user: [`File: ${target.path}`, compact ? `Module id: ${moduleContract?.moduleId ?? ""}` : ""]
        .filter(Boolean)
        .join("\n"),
      maxTokens: 384,
    },
  ];

  let specRun: StructuredExecuteResult<FileSpecification> | undefined;
  for (const attempt of specAttempts) {
    specRun = await providerManager.executeStructured(
      structuredOpts,
      {
        messages: [
          { role: "system", content: attempt.system },
          { role: "user", content: attempt.user },
        ],
        temperature: 0.1,
        maxTokens: attempt.maxTokens,
        ...jsonMode,
      },
      (text) => parseFileSpecification(text),
      { maxAttempts: 4 },
    );
    logStructured(log, attempt.label, specRun, { path: target.path });
    if (specRun.parsed) break;
    if (specRun.waitingForProvider) {
      return waitMarker(specRun);
    }
  }

  if (!specRun?.parsed) {
    return waitMarker(specRun!);
  }

  const spec = specRun.parsed;
  const contentRun = await providerManager.executeStructured(
    structuredOpts,
    {
      messages: [
        { role: "system", content: CODING_STRUCTURED_SYSTEM },
        {
          role: "user",
          content: [
            "Write ONLY this file as structured JSON (one files[] entry).",
            `path: ${spec.path}`,
            spec.purpose ? `purpose: ${spec.purpose}` : "",
            spec.exports?.length ? `exports: ${spec.exports.join(", ")}` : "",
            spec.dependencies?.length ? `depends on: ${spec.dependencies.join(", ")}` : "",
            moduleContract ? `constraints: ${moduleContract.constraints.join("; ")}` : "",
            "Stack: node:http stdlib, pg for PostgreSQL, node:test for tests. No express, jest, or supertest.",
            "Tests must use ESM import syntax (import from node:test), not require().",
            "Do not include other files. No markdown.",
          ]
            .filter(Boolean)
            .join("\n"),
        },
      ],
      temperature: 0.2,
      maxTokens: /\.test\.|\.spec\./i.test(spec.path) ? 1280 : 1536,
      ...jsonMode,
    },
    (text) =>
      parseStructuredCodingOutput(text, {
        allowedPaths: allowedPaths.length ? allowedPaths : [spec.path],
      }),
    { maxAttempts: 4 },
  );
  logStructured(log, "file-content", contentRun, { path: spec.path });

  if (!contentRun.parsed) {
    return waitMarker(contentRun);
  }
  return toProposedFiles(contentRun.parsed);
}
