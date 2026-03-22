import { execFile as execFileCallback } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { findRoot, loadConfig } from "./config.js";
import { OwnSearchError } from "./errors.js";
import type { RootDefinition } from "./types.js";

const execFile = promisify(execFileCallback);

export interface LiteralSearchMatch {
  rootId: string;
  rootName: string;
  filePath: string;
  relativePath: string;
  lineNumber: number;
  content: string;
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/");
}

export async function literalSearch(args: {
  query: string;
  rootIds?: string[];
  pathSubstring?: string;
  limit?: number;
}): Promise<LiteralSearchMatch[]> {
  const config = await loadConfig();
  let roots: RootDefinition[];

  if (args.rootIds?.length) {
    const resolved = await Promise.all(args.rootIds.map((rootId) => findRoot(rootId)));
    const missingRootIds = args.rootIds.filter((_, index) => !resolved[index]);
    if (missingRootIds.length) {
      throw new OwnSearchError(
        `Unknown root ID(s) for literal search: ${missingRootIds.join(", ")}. Call \`list-roots\` to see valid root IDs.`
      );
    }

    roots = resolved.filter((root): root is RootDefinition => Boolean(root));
  } else {
    roots = config.roots;
  }

  if (!roots.length) {
    throw new OwnSearchError("No indexed roots are available for literal search. Call `list_roots` or `index_path` first.");
  }

  const limit = Math.max(1, Math.min(args.limit ?? 20, 100));
  const matches: LiteralSearchMatch[] = [];

  for (const root of roots) {
    const { stdout } = await execFile(
      "rg",
      [
        "-n",
        "-i",
        "--fixed-strings",
        "--max-count",
        String(limit),
        args.query,
        root.path
      ],
      {
        windowsHide: true,
        maxBuffer: 1024 * 1024 * 10
      }
    ).catch((error: { code?: number; stdout?: string }) => {
      if (error?.code === 1) {
        return { stdout: "" };
      }
      throw new OwnSearchError("Literal search failed. Ensure `rg` (ripgrep) is installed and available on PATH.");
    });

    for (const line of stdout.split(/\r?\n/)) {
      if (!line.trim()) {
        continue;
      }

      const match = line.match(/^(.*?):(\d+):(.*)$/);
      if (!match) {
        continue;
      }

      const filePath = match[1]!;
      const relativePath = normalizePath(path.relative(root.path, filePath));
      if (args.pathSubstring && !relativePath.toLowerCase().includes(args.pathSubstring.toLowerCase())) {
        continue;
      }

      matches.push({
        rootId: root.id,
        rootName: root.name,
        filePath,
        relativePath,
        lineNumber: Number(match[2]),
        content: match[3]!.trim()
      });

      if (matches.length >= limit) {
        return matches;
      }
    }
  }

  return matches;
}
