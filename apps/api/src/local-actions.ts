import { homedir } from "node:os";
import {
  access,
  mkdir,
  writeFile,
  appendFile,
  readFile,
  rm,
  stat,
} from "node:fs/promises";
import { constants } from "node:fs";
import { join, normalize, resolve, extname } from "node:path";

/**
 * Host-FS product shortcuts are DISABLED by default (Phase P0).
 * Set ENABLE_HOST_FS_ACTIONS=true only for legacy/dev — never on the Chat product path.
 * Coding file ops must go: Orchestrator → CodingWorkspace → tools.
 */
export function hostFsActionsEnabled(): boolean {
  return process.env.ENABLE_HOST_FS_ACTIONS === "true";
}

/** Detect local laptop actions that must NOT trigger web search / model stub. */
export function isLocalActionIntent(message: string): boolean {
  if (!hostFsActionsEnabled()) return false;
  const m = message.toLowerCase();
  const hasPlace = /\b(downloads?|downlaod|desktop|documents?|laptop|pc|computer)\b/.test(
    m,
  );
  const hasFsWord = /\b(folder|directory|dir|file|program)\b/.test(m);
  const hasCreate = /\b(create|make|mkdir|add|write|put|save)\b/.test(m);
  const hasDelete = /\b(delete|remove|rm|erase)\b/.test(m);
  const hasCpp =
    /\b(c\s*\+\+|c\s*plus\s*plus|cpp|c\s*plus)\b/.test(m) &&
    /\b(file|program|code|folder)\b/.test(m);

  return (
    (hasCreate && (hasFsWord || hasPlace || hasCpp)) ||
    (hasDelete && (hasFsWord || hasPlace || /personal\s*ai/i.test(m))) ||
    /\bin(side)?\s+(the\s+)?(folder|file|personal\s*ai|downloads?|desktop)\b/.test(m) ||
    /\bin my (laptop|pc|computer|downloads?|desktop|documents?)\b/.test(m) ||
    hasCpp
  );
}

function cleanName(raw: string): string {
  return raw
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/[\\/]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

const STOP_WORDS =
  "downloads?|downlaod|desktop|documents?|laptop|pc|computer|folder|directory|dir|file|named|called|name|the|a|an|my|under|inside|in|on|by|of|to|for|me|us|you|please|hey|hi|hello|some|any|new|one|this|that|here|there|now|just|also|then|delete|remove|and|with|create|make|program|programming|plus|code|something|anything";

function isStopName(name: string): boolean {
  const n = name.trim();
  if (!n || n.length < 2) return true;
  return new RegExp(`^(?:${STOP_WORDS})$`, "i").test(n);
}

/** Cut trailing instruction noise from a captured name. */
function trimNameTail(raw: string): string {
  return cleanName(
    raw
      .replace(
        /\s+(?:and|inside|under|in|on|with|create|make|for|then|also)\b[\s\S]*$/i,
        "",
      )
      .replace(/\s+(?:c\s*\+\+|c\s*plus\s*plus|cpp|program|programming|file|folder)\b[\s\S]*$/i, ""),
  );
}

function wantsCpp(message: string): boolean {
  return /\b(c\s*\+\+|c\s*plus\s*plus|cpp|c\s*plus)\b/i.test(message);
}

function sampleCpp(folderHint?: string): string {
  const title = folderHint ? ` // ${folderHint}` : "";
  return `#include <iostream>
using namespace std;

int main() {${title}
    cout << "Hello from Personal AI" << endl;
    return 0;
}
`;
}

/**
 * Extract the folder/file name the user asked for — never invent a default name.
 */
export function extractRequestedName(
  message: string,
  kind: "folder" | "file",
): string | null {
  const text = message.trim();

  // folder name X / file name X
  let m =
    /\b(?:folder|file|directory)\s+name\s+(?:is\s+|of\s+)?["']?([a-z0-9][a-z0-9 _.-]*?)["']?(?=\s+(?:and|inside|under|in|on|with|create|make|c\b|for|then|also)|$)/i.exec(
      text,
    );
  if (m?.[1] && !isStopName(m[1])) return trimNameTail(m[1]);

  // delete/remove the X in desktop
  m =
    /\b(?:delete|remove|rm|erase)\s+(?:the\s+)?(?:folder\s+|file\s+|directory\s+)?["']?([a-z0-9][a-z0-9 _.-]*?)["']?(?:\s+(?:in|on|under|from|folder|file|and)\b|\s*$)/i.exec(
      text,
    );
  if (m?.[1] && !isStopName(m[1])) return trimNameTail(m[1]);

  // named / called X
  m =
    /\b(?:named|called)\s+["']?([a-z0-9][a-z0-9 _.-]*?)["']?(?:\s+(?:in|on|under|inside|and|with)\b|\s*$)/i.exec(
      text,
    );
  if (m?.[1] && !isStopName(m[1])) return trimNameTail(m[1]);

  // name of file/folder X   OR   name by X
  m =
    /\bname(?:\s+of(?:\s+the)?\s+(?:file|folder))?\s+(?:by\s+|is\s+)?["']?([a-z0-9][a-z0-9 _.-]*?)["']?(?=\s+(?:in|on|and|inside|under|with)|$)/i.exec(
      text,
    ) ||
    /\bname\s+by\s+["']?([a-z0-9][a-z0-9 _.-]*?)["']?/i.exec(text);
  if (m?.[1] && !isStopName(m[1])) return trimNameTail(m[1]);

  // create folder X in/on desktop|downloads  OR create folder X and ...
  m = new RegExp(
    `\\b(?:create|make|mkdir)\\s+(?:a\\s+|an\\s+|the\\s+|new\\s+)?(?:${kind}|directory|dir)\\s+["']?([a-z0-9][a-z0-9_.-]{1,40})["']?(?=\\s+(?:in|on|under|inside|and|with)\\b|$)`,
    "i",
  ).exec(text);
  if (m?.[1] && !isStopName(m[1])) return trimNameTail(m[1]);

  // quoted name
  m = /["']([^"']{1,64})["']/.exec(text);
  if (m?.[1] && !isStopName(m[1])) return trimNameTail(m[1]);

  return null;
}

/** Prefer short folder name for compound “folder name X …” utterances. */
export function extractFolderName(message: string): string | null {
  const text = message.trim();

  // Never treat "folder for me" / "create a folder please" as a name
  if (/\bfolder\s+(?:for\s+me|for\s+us|please|here|now)\b/i.test(text)) {
    return null;
  }
  if (
    /\b(?:create|make)\s+(?:a\s+|an\s+|the\s+|new\s+)?(?:folder|directory|dir)\s+(?:for\s+me|for\s+us|please|here|now)\b/i.test(
      text,
    )
  ) {
    return null;
  }

  // Explicit: folder name X / named X / called X
  let m =
    /\bfolder\s+name\s+(?:is\s+|of\s+)?["']?([a-z0-9][a-z0-9_.-]{1,40})["']?/i.exec(text) ||
    /\b(?:folder|directory|dir)\s+(?:named|called)\s+["']?([a-z0-9][a-z0-9_.-]{1,40})["']?/i.exec(
      text,
    ) ||
    /\b(?:named|called)\s+["']?([a-z0-9][a-z0-9_.-]{1,40})["']?/i.exec(text);

  if (m?.[1] && !isStopName(m[1])) return trimNameTail(m[1]);

  // create folder X in/on/under/and…  (X must not be filler like "for")
  m =
    /\b(?:create|make|mkdir)\s+(?:a\s+|an\s+|the\s+|new\s+)?(?:folder|directory|dir)\s+["']?([a-z0-9][a-z0-9_.-]{1,40})["']?\s+(?:in|on|under|inside|and|with)\b/i.exec(
      text,
    );
  if (m?.[1] && !isStopName(m[1])) return trimNameTail(m[1]);

  // create folder X  (end of sentence only)
  m =
    /\b(?:create|make|mkdir)\s+(?:a\s+|an\s+|the\s+|new\s+)?(?:folder|directory|dir)\s+["']?([a-z0-9][a-z0-9_.-]{1,40})["']?\s*$/i.exec(
      text,
    );
  if (m?.[1] && !isStopName(m[1])) return trimNameTail(m[1]);

  return extractRequestedName(message, "folder");
}

export function extractFileName(message: string): string | null {
  if (wantsCpp(message)) {
    // Explicit name before cpp mention
    const m =
      /\b(?:file|program)\s+(?:name\s+)?(?:is\s+|of\s+)?["']?([a-z0-9][a-z0-9_.-]*)["']?/i.exec(
        message,
      );
    if (m?.[1] && !isStopName(m[1]) && !/^c$/i.test(m[1])) {
      const base = trimNameTail(m[1]);
      return extname(base) ? base : `${base}.cpp`;
    }
    return "main.cpp";
  }

  const named = extractRequestedName(message, "file");
  if (named) {
    return extname(named) ? named : `${named}.txt`;
  }
  return null;
}

export function extractParentFolder(message: string): string | null {
  // Prefer explicit folder name in compound commands
  const folderFirst = extractFolderName(message);
  if (folderFirst && /\b(file|program|cpp|c\s*\+\+|inside|under)\b/i.test(message)) {
    return folderFirst;
  }

  const m =
    /(?:under|inside|in)\s+(?:the\s+)?(?:folder\s+)?["']?([a-z0-9][a-z0-9 _.-]*?)["']?(?:\s+(?:name|named|called|folder|file|and|create)|$)/i.exec(
      message,
    );
  if (!m?.[1]) {
    if (/personal\s*ai/i.test(message) && /\bfile\b/i.test(message)) {
      return "personal ai";
    }
    return null;
  }
  let name = cleanName(m[1]).replace(/\s+name.*$/i, "").trim();
  if (isStopName(name)) return null;
  return trimNameTail(name) || null;
}

function resolveAllowedRoot(message: string): { root: string; label: string } {
  const m = message.toLowerCase();
  const home = homedir();
  if (/\bdownloads?\b|downlaod/.test(m)) {
    return { root: join(home, "Downloads"), label: "Downloads" };
  }
  if (/\bdesktop\b/.test(m)) {
    return { root: join(home, "Desktop"), label: "Desktop" };
  }
  if (/\bdocuments?\b/.test(m)) {
    return { root: join(home, "Documents"), label: "Documents" };
  }
  return { root: join(home, "Downloads"), label: "Downloads" };
}

function assertInside(root: string, target: string, label: string): string | null {
  const allowedRoot = normalize(resolve(root));
  const resolved = normalize(resolve(target));
  if (resolved !== allowedRoot && !resolved.startsWith(allowedRoot + "/")) {
    return `Refused: path must stay under ${label}.`;
  }
  if (resolved === allowedRoot) {
    return `Refused: cannot delete ${label} itself.`;
  }
  return null;
}

export interface LocalActionResult {
  handled: boolean;
  message: string;
  path?: string;
}

export async function tryHandleLocalAction(message: string): Promise<LocalActionResult> {
  // P0: host Downloads/Desktop/Documents writes are off the Chat product path.
  if (!hostFsActionsEnabled()) {
    const looksLikeHostFs =
      /\b(create|make|mkdir|delete|remove|rm)\b/i.test(message) &&
      /\b(folder|directory|file|downloads?|desktop|documents?)\b/i.test(message);
    const looksLikeOrchestrationProductGoal =
      /\b(school management|management system|rest api|phase-1|phase 1|postgresql|neon persistence|rbac|automated behavioral tests|orchestrat)\b/i.test(
        message,
      );
    // Coding/product goals (Project O, build a model, etc.) must reach Orchestrator → CodingWorkspace
    const looksLikeCodingWorkspace =
      /\b(build a model|build a complete|build a phase|predict|ocean temperature|project\s+o|typescript|python|npm|workspace|coding)\b/i.test(
        message,
      ) ||
      /\band\s+build\b/i.test(message) ||
      looksLikeOrchestrationProductGoal;
    if (looksLikeHostFs && !looksLikeCodingWorkspace) {
      return {
        handled: true,
        message:
          "Host filesystem create/delete is disabled. " +
          "Create a workspace (Spaces tab) and use Orchestrate with coding tools instead. " +
          "LOCAL WORKSPACE ≠ CLOUD SANDBOX — tools stay inside the workspace path boundary.",
      };
    }
    return { handled: false, message: "" };
  }

  if (!isLocalActionIntent(message)) {
    return { handled: false, message: "" };
  }

  const lower = message.toLowerCase();
  const wantsDelete = /\b(delete|remove|rm|erase)\b/.test(lower);
  const mentionsFolder = /\b(folder|directory|dir)\b/.test(lower);
  const mentionsFile =
    /\b(file|program)\b/.test(lower) || wantsCpp(message);
  const wantsCreate = /\b(create|make|mkdir|add|write|put|save)\b/.test(lower) || mentionsFolder;

  // Compound: folder + file/program in one utterance
  const compoundCreate =
    !wantsDelete && mentionsFolder && mentionsFile && (wantsCreate || wantsCpp(message));

  const wantsFolderOnly =
    !wantsDelete && mentionsFolder && !mentionsFile && wantsCreate;

  const wantsFileOnly =
    !wantsDelete && mentionsFile && !mentionsFolder && wantsCreate;

  const { root, label } = resolveAllowedRoot(message);

  try {
    await access(root, constants.W_OK);
  } catch {
    return {
      handled: true,
      message: `Cannot write to ${label} (${root}). Check folder permissions.`,
    };
  }

  if (wantsDelete) {
    const name = extractRequestedName(message, "folder");
    if (!name) {
      return {
        handled: true,
        message:
          'Say what to delete, e.g.\n“delete the personal ai folder in desktop”',
      };
    }

    const candidates = [join(root, name), join(root, `${name}.txt`), join(root, `${name}.cpp`)];
    let target: string | null = null;
    for (const c of candidates) {
      try {
        await access(c, constants.F_OK);
        target = c;
        break;
      } catch {
        // continue
      }
    }

    if (!target) {
      return {
        handled: true,
        message: `Nothing found named “${name}” under ${label}.`,
      };
    }

    const bad = assertInside(root, target, label);
    if (bad) return { handled: true, message: bad };

    const info = await stat(target);
    await rm(target, { recursive: info.isDirectory(), force: true });
    return {
      handled: true,
      path: target,
      message: `Deleted ${info.isDirectory() ? "folder" : "file"}:\n${target}`,
    };
  }

  if (compoundCreate || (wantsFolderOnly && wantsCpp(message))) {
    const folderName = extractFolderName(message);
    if (!folderName) {
      return {
        handled: true,
        message:
          'Say the folder name clearly, e.g.\n“create folder Bharat and inside create a C++ file”',
      };
    }

    const fileName = extractFileName(message) ?? (wantsCpp(message) ? "main.cpp" : "notes.txt");
    const dir = join(root, folderName);
    const target = join(dir, fileName);
    const bad = assertInside(root, target, label);
    if (bad) return { handled: true, message: bad };

    await mkdir(dir, { recursive: true });
    const content = wantsCpp(message)
      ? sampleCpp(folderName)
      : `Created by Personal AI\n${new Date().toISOString()}\n`;
    await writeFile(target, content, "utf8");

    return {
      handled: true,
      path: target,
      message:
        `Created folder “${folderName}” and file “${fileName}” under ${label}:\n` +
        `${target}\n\n` +
        (wantsCpp(message) ? "C++ starter program written inside." : "File ready."),
    };
  }

  if (wantsFolderOnly) {
    const folderName = extractFolderName(message);
    if (!folderName) {
      return {
        handled: true,
        message:
          "What should I name the folder?\n" +
          'Say it like: “create folder Bharat in downloads”',
      };
    }
    const target = join(root, folderName);
    const bad = assertInside(root, target, label);
    if (bad) return { handled: true, message: bad };
    await mkdir(target, { recursive: true });
    return {
      handled: true,
      path: target,
      message: `Created folder “${folderName}”:\n${target}`,
    };
  }

  if (wantsFileOnly || (mentionsFile && wantsCreate)) {
    const parent = extractParentFolder(message);
    let fileName = extractFileName(message);

    // If only cpp mentioned with a folder name phrase like "folder name Bharat"
    if (!fileName && wantsCpp(message)) fileName = "main.cpp";

    if (!fileName || !parent) {
      return {
        handled: true,
        message:
          'Say folder + file clearly, e.g.\n' +
          '“create folder Bharat and inside create a C++ file”\n' +
          '“create file notes under personal ai in desktop”',
      };
    }

    const dir = join(root, parent);
    const target = join(dir, fileName);
    const bad = assertInside(root, target, label);
    if (bad) return { handled: true, message: bad };

    await mkdir(dir, { recursive: true });

    const contentMatch =
      /(?:with\s+(?:content|text)|content\s*[:=])\s*["']([\s\S]+?)["']\s*$/i.exec(message);
    const content =
      contentMatch?.[1]?.trim() ||
      (wantsCpp(message)
        ? sampleCpp(parent)
        : `Created by Personal AI\n${new Date().toISOString()}\n`);

    const append = /\b(add|append)\b/.test(lower) && !/\bcreate\b/.test(lower);
    if (append) {
      try {
        await access(target, constants.F_OK);
        await appendFile(target, `\n${content}`, "utf8");
      } catch {
        await writeFile(target, content, "utf8");
      }
    } else {
      await writeFile(target, content, "utf8");
    }

    const preview = (await readFile(target, "utf8")).slice(0, 240);
    return {
      handled: true,
      path: target,
      message: `Created file “${fileName}” inside “${parent}”:\n${target}\n\nPreview:\n${preview}`,
    };
  }

  return {
    handled: true,
    message:
      "I can create/delete folders and files under Downloads, Desktop, or Documents.\n" +
      '• “create folder Bharat in desktop”\n' +
      '• “create folder Bharat and inside create a C++ file”\n' +
      '• “delete the personal ai in desktop”',
  };
}
