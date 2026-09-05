import { ToolPermissionLevel, type ToolResult } from "@personal-ai/shared";
import type { MemoryService } from "@personal-ai/memory";
import type { RagService } from "@personal-ai/rag";
import type { ToolHandler } from "./registry.js";

export interface KnowledgeToolsDeps {
  memory?: MemoryService;
  rag?: RagService;
  getUserId?: () => string;
  getProjectId?: () => string | undefined;
}

export function createKnowledgeTools(deps: KnowledgeToolsDeps): ToolHandler[] {
  const userId = () => deps.getUserId?.() ?? "anonymous";
  const projectId = () => deps.getProjectId?.();

  return [
    {
      definition: {
        name: "search_memory",
        description: "Search personal/project memory for preferences and approved facts",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string" },
            projectId: { type: "string" },
          },
          required: ["query"],
        },
        permissionLevel: ToolPermissionLevel.READ,
      },
      async execute(args): Promise<ToolResult> {
        if (!deps.memory) {
          return {
            success: false,
            output: null,
            error: "Memory service unavailable",
          };
        }
        const results = await deps.memory.searchMemory({
          userId: userId(),
          query: String(args.query),
          projectId: (args.projectId as string | undefined) ?? projectId(),
        });
        return {
          success: true,
          output: {
            results: results.map((r) => ({
              id: r.id,
              content: r.content,
              memoryType: r.memoryType,
              score: r.score,
            })),
          },
        };
      },
    },
    {
      definition: {
        name: "save_memory",
        description: "Store an approved personal or project memory (secrets are rejected)",
        parameters: {
          type: "object",
          properties: {
            content: { type: "string" },
            memoryType: { type: "string" },
            projectId: { type: "string" },
          },
          required: ["content"],
        },
        permissionLevel: ToolPermissionLevel.WRITE,
      },
      async execute(args): Promise<ToolResult> {
        if (!deps.memory) {
          return { success: false, output: null, error: "Memory service unavailable" };
        }
        const result = await deps.memory.createMemory({
          userId: userId(),
          content: String(args.content),
          memoryType: (args.memoryType as "preference" | "context" | undefined) ?? "context",
          projectId: (args.projectId as string | undefined) ?? projectId(),
          userApproved: true,
        });
        if ("rejected" in result && result.rejected) {
          return { success: false, output: null, error: result.reason };
        }
        return { success: true, output: result };
      },
    },
    {
      definition: {
        name: "search_documents",
        description: "Semantic search over indexed user/project documents (RAG)",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string" },
            projectId: { type: "string" },
          },
          required: ["query"],
        },
        permissionLevel: ToolPermissionLevel.READ,
      },
      async execute(args): Promise<ToolResult> {
        if (!deps.rag) {
          return { success: false, output: null, error: "RAG service unavailable" };
        }
        const chunks = await deps.rag.search({
          userId: userId(),
          query: String(args.query),
          projectId: (args.projectId as string | undefined) ?? projectId(),
        });
        return {
          success: true,
          output: {
            chunks,
            context: deps.rag.buildProtectedContext(chunks),
          },
        };
      },
    },
    {
      definition: {
        name: "get_project_context",
        description: "Retrieve combined memory + document context for the active project",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string" },
            projectId: { type: "string" },
          },
          required: ["query"],
        },
        permissionLevel: ToolPermissionLevel.READ,
      },
      async execute(args): Promise<ToolResult> {
        const q = String(args.query);
        const pid = (args.projectId as string | undefined) ?? projectId();
        const memories = deps.memory
          ? await deps.memory.searchMemory({
              userId: userId(),
              query: q,
              projectId: pid,
            })
          : [];
        const chunks = deps.rag
          ? await deps.rag.search({ userId: userId(), query: q, projectId: pid })
          : [];
        const docContext = deps.rag?.buildProtectedContext(chunks) ?? "";
        const memContext = memories.map((m) => m.content).join("\n");
        return {
          success: true,
          output: {
            memories,
            chunks,
            context: [memContext && `Memories:\n${memContext}`, docContext]
              .filter(Boolean)
              .join("\n\n"),
          },
        };
      },
    },
  ];
}
