import type { ProjectScanResult } from "./project-scanner.js";
import { promises as fs } from "node:fs";

export interface ProjectStructure {
  type: "monorepo" | "single" | "unknown";
  packageManager: "npm" | "pnpm" | "yarn" | "unknown";
  applications: string[];
  packages: string[];
}

export interface Technology {
  name: string;
  source: string;
  confidence: "HIGH" | "MEDIUM" | "LOW";
}

export interface ExtractedKnowledge {
  structure: ProjectStructure;
  technologies: Technology[];
  apiRoutes: { method: string; path: string; sourceFile: string }[];
}

export class ProjectAnalyzer {
  async analyze(scanResult: ProjectScanResult): Promise<ExtractedKnowledge> {
    const structure = this.analyzeStructure(scanResult);
    const technologies = await this.analyzeTechnologies(scanResult);
    const apiRoutes = await this.discoverApis(scanResult);

    return {
      structure,
      technologies,
      apiRoutes
    };
  }

  private analyzeStructure(scanResult: ProjectScanResult): ProjectStructure {
    let type: "monorepo" | "single" | "unknown" = "unknown";
    let packageManager: "npm" | "pnpm" | "yarn" | "unknown" = "unknown";
    const applications = new Set<string>();
    const packages = new Set<string>();

    if (scanResult.files.some(f => f.name === "pnpm-workspace.yaml")) {
      type = "monorepo";
      packageManager = "pnpm";
    } else if (scanResult.files.some(f => f.name === "package.json")) {
      type = "single";
    }

    if (scanResult.files.some(f => f.name === "yarn.lock")) packageManager = "yarn";
    else if (scanResult.files.some(f => f.name === "package-lock.json")) packageManager = "npm";
    else if (scanResult.files.some(f => f.name === "pnpm-lock.yaml")) packageManager = "pnpm";

    for (const dir of scanResult.directories) {
      if (dir.startsWith("apps/") && dir.split("/").length === 2) {
        applications.add(dir.split("/")[1]);
      } else if (dir.startsWith("packages/") && dir.split("/").length === 2) {
        packages.add(dir.split("/")[1]);
      } else if (type === "single" && dir === "src") {
        applications.add("root");
      }
    }

    return {
      type,
      packageManager,
      applications: Array.from(applications),
      packages: Array.from(packages)
    };
  }

  private async analyzeTechnologies(scanResult: ProjectScanResult): Promise<Technology[]> {
    const techs: Technology[] = [];
    
    const packageJsons = scanResult.files.filter(f => f.name === "package.json");
    for (const pkg of packageJsons) {
      try {
        const content = await fs.readFile(pkg.path, "utf-8");
        const json = JSON.parse(content);
        const deps = { ...json.dependencies, ...json.devDependencies };
        
        if (deps["next"]) techs.push({ name: "Next.js", source: pkg.relativePath, confidence: "HIGH" });
        if (deps["react"]) techs.push({ name: "React", source: pkg.relativePath, confidence: "HIGH" });
        if (deps["fastify"]) techs.push({ name: "Fastify", source: pkg.relativePath, confidence: "HIGH" });
        if (deps["pg"] || deps["postgres"]) techs.push({ name: "PostgreSQL", source: pkg.relativePath, confidence: "HIGH" });
        if (deps["prisma"]) techs.push({ name: "Prisma", source: pkg.relativePath, confidence: "HIGH" });
        if (deps["typescript"]) techs.push({ name: "TypeScript", source: pkg.relativePath, confidence: "HIGH" });
      } catch (err) {
        // Ignore parse errors safely
      }
    }

    if (scanResult.files.some(f => f.name === "tsconfig.json")) {
      if (!techs.some(t => t.name === "TypeScript")) {
        techs.push({ name: "TypeScript", source: "tsconfig.json", confidence: "HIGH" });
      }
    }

    return techs;
  }

  private async discoverApis(scanResult: ProjectScanResult) {
    const routes: { method: string; path: string; sourceFile: string }[] = [];
    const sourceFiles = scanResult.files.filter(f => f.category === "SOURCE" && !f.relativePath.includes("node_modules"));
    
    for (const file of sourceFiles) {
      if (file.size > 1_000_000) continue; // Skip huge files
      try {
        const content = await fs.readFile(file.path, "utf-8");
        // Simple regex heuristic for fastify/express routes
        const regex = /app\.(get|post|put|patch|delete)\s*\(\s*["']([^"']+)["']/gi;
        let match;
        while ((match = regex.exec(content)) !== null) {
          routes.push({
            method: match[1].toUpperCase(),
            path: match[2],
            sourceFile: file.relativePath
          });
        }
      } catch (err) {
        // ignore
      }
    }
    
    return routes;
  }
}
