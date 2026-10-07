import type { MemoryService } from "@personal-ai/memory";
import { ProjectScanner, ProjectAnalyzer } from "@personal-ai/memory";
import type { RagService } from "@personal-ai/rag";
import { promises as fs } from "node:fs";

export class ProjectIntelligenceService {
  private scanner = new ProjectScanner();
  private analyzer = new ProjectAnalyzer();

  constructor(
    private memory: MemoryService,
    private rag: RagService
  ) {}

  async ingestProject(userId: string, projectId: string, rootDir: string): Promise<void> {
    // 1. Scan the project
    const scanResult = await this.scanner.scan({ rootDir });

    // 2. Analyze
    const knowledge = await this.analyzer.analyze(scanResult);

    // 3. Store structural metadata in Memory
    await this.memory.createMemory({
      userId,
      projectId,
      content: `Project structure: ${knowledge.structure.type} using ${knowledge.structure.packageManager}. Applications: ${knowledge.structure.applications.join(", ")}. Packages: ${knowledge.structure.packages.join(", ")}.`,
      memoryType: "project",
      importance: 0.8,
      userApproved: true, // Auto-ingested facts
    });

    for (const tech of knowledge.technologies) {
      await this.memory.createMemory({
        userId,
        projectId,
        content: `Project uses technology: ${tech.name} (detected in ${tech.source})`,
        memoryType: "project",
        importance: 0.7,
        userApproved: true,
      });
    }

    if (knowledge.apiRoutes.length > 0) {
      // Group by source file
      const routesByFile = knowledge.apiRoutes.reduce((acc, route) => {
        if (!acc[route.sourceFile]) acc[route.sourceFile] = [];
        acc[route.sourceFile].push(`${route.method} ${route.path}`);
        return acc;
      }, {} as Record<string, string[]>);

      for (const [file, routes] of Object.entries(routesByFile)) {
        await this.memory.createMemory({
          userId,
          projectId,
          content: `API Routes in ${file}:\n${routes.join("\n")}`,
          memoryType: "project",
          importance: 0.6,
          userApproved: true,
        });
      }
    }

    // 4. Index important documents into RAG
    const docsToIndex = scanResult.files.filter(f => f.category === "DOCUMENTATION" && f.size < 500_000);
    for (const doc of docsToIndex) {
      try {
        const content = await fs.readFile(doc.path, "utf-8");
        await this.rag.ingestDocument({
          userId,
          filename: doc.relativePath,
          content,
          mimeType: "text/plain",
          projectId,
        });
      } catch (err) {
        // Skip on read error
      }
    }
  }
}
