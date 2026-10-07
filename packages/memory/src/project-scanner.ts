import { promises as fs, createReadStream } from "node:fs";
import { join, resolve, relative } from "node:path";
import crypto from "node:crypto";

export interface ScanOptions {
  rootDir: string;
  ignoredPatterns?: string[];
}

export type FileCategory = 
  | "SOURCE"
  | "TEST"
  | "DOCUMENTATION"
  | "CONFIG"
  | "DATABASE"
  | "MIGRATION"
  | "DEPENDENCY"
  | "BUILD"
  | "DEPLOYMENT"
  | "ASSET"
  | "GENERATED"
  | "SECRET"
  | "UNKNOWN";

export interface ScannedFile {
  path: string;
  relativePath: string;
  name: string;
  extension: string;
  category: FileCategory;
  hash: string;
  size: number;
}

export interface ProjectScanResult {
  rootDir: string;
  files: ScannedFile[];
  directories: string[];
}

const DEFAULT_IGNORED = [
  "node_modules",
  ".git",
  ".next",
  "dist",
  "build",
  "coverage",
  ".cache",
];

const SECRET_FILES = new Set([
  ".env",
  ".env.local",
  ".env.production",
  ".env.development",
  "id_rsa",
  "id_rsa.pub",
  "secrets.json",
  "credentials.json"
]);

export class ProjectScanner {
  private async getFileHash(filePath: string): Promise<string> {
    return new Promise((res, rej) => {
      const hash = crypto.createHash("sha256");
      const stream = createReadStream(filePath);
      stream.on("data", (data) => hash.update(data));
      stream.on("end", () => res(hash.digest("hex")));
      stream.on("error", rej);
    });
  }

  private classifyFile(fileName: string, relativePath: string): FileCategory {
    if (SECRET_FILES.has(fileName) || fileName.endsWith(".pem") || fileName.endsWith(".key")) {
      return "SECRET";
    }

    if (fileName === "package.json" || fileName === "package-lock.json" || fileName === "pnpm-lock.yaml" || fileName === "yarn.lock" || fileName === "requirements.txt" || fileName === "pom.xml" || fileName === "pyproject.toml") {
      return "DEPENDENCY";
    }

    if (fileName.endsWith(".test.ts") || fileName.endsWith(".test.js") || fileName.endsWith(".spec.ts") || relativePath.includes("/tests/") || relativePath.includes("/__tests__/")) {
      return "TEST";
    }

    if (fileName.endsWith(".md") || fileName.endsWith(".txt") || relativePath.includes("/docs/")) {
      return "DOCUMENTATION";
    }

    if (fileName.endsWith(".ts") || fileName.endsWith(".js") || fileName.endsWith(".py") || fileName.endsWith(".go") || fileName.endsWith(".java") || fileName.endsWith(".rs") || fileName.endsWith(".tsx") || fileName.endsWith(".jsx")) {
      return "SOURCE";
    }

    if (fileName.endsWith(".json") || fileName.endsWith(".yaml") || fileName.endsWith(".yml") || fileName.endsWith(".toml") || fileName.endsWith(".ini") || fileName.includes("config")) {
      return "CONFIG";
    }

    if (relativePath.includes("/migrations/") || fileName.endsWith(".sql") || fileName === "schema.prisma") {
      return "MIGRATION";
    }

    if (fileName === "Dockerfile" || fileName === "docker-compose.yml" || relativePath.includes(".github/workflows/")) {
      return "DEPLOYMENT";
    }

    if (fileName.endsWith(".png") || fileName.endsWith(".jpg") || fileName.endsWith(".svg") || fileName.endsWith(".ico")) {
      return "ASSET";
    }

    return "UNKNOWN";
  }

  async scan(options: ScanOptions): Promise<ProjectScanResult> {
    const rootPath = resolve(options.rootDir);
    const ignored = new Set(options.ignoredPatterns ?? DEFAULT_IGNORED);
    const files: ScannedFile[] = [];
    const directories: string[] = [];

    const walk = async (currentPath: string) => {
      const entries = await fs.readdir(currentPath, { withFileTypes: true });
      for (const entry of entries) {
        if (ignored.has(entry.name)) continue;

        const fullPath = join(currentPath, entry.name);
        
        // Prevent symlink escape
        if (entry.isSymbolicLink()) {
            const realPath = await fs.realpath(fullPath);
            if (!realPath.startsWith(rootPath)) continue;
        }

        const relativeP = relative(rootPath, fullPath);

        if (entry.isDirectory()) {
          directories.push(relativeP);
          await walk(fullPath);
        } else if (entry.isFile()) {
          const stat = await fs.stat(fullPath);
          const category = this.classifyFile(entry.name, relativeP);
          // Do not hash secrets, just identify them
          const hash = category === "SECRET" ? "REDACTED" : await this.getFileHash(fullPath);
          
          files.push({
            path: fullPath,
            relativePath: relativeP,
            name: entry.name,
            extension: entry.name.split(".").pop() ?? "",
            category,
            hash,
            size: stat.size
          });
        }
      }
    }

    await walk(rootPath);

    return {
      rootDir: rootPath,
      files,
      directories
    };
  }
}
