import fs from "node:fs/promises";
import path from "node:path";
import { PDFParse } from "pdf-parse";
import { IGNORED_DIRECTORIES, SUPPORTED_TEXT_EXTENSIONS } from "./constants.js";

export interface FileCandidate {
  path: string;
  relativePath: string;
  extension: string;
  sizeBytes: number;
  mtimeMs: number;
  content: string;
}

function sanitizeExtractedText(input: string): string {
  return input
    .replace(/\u0000/g, "")
    .replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .replace(/\r\n/g, "\n");
}

export async function collectTextFiles(rootPath: string, maxFileBytes: number): Promise<FileCandidate[]> {
  const files: FileCandidate[] = [];
  const absoluteRoot = path.resolve(rootPath);
  const debug = process.env.OWNSEARCH_DEBUG_INDEX === "1";

  function debugLog(...parts: unknown[]): void {
    if (debug) {
      console.log("[ownsearch:index]", ...parts);
    }
  }

  async function parsePdf(filePath: string): Promise<string> {
    const buffer = await fs.readFile(filePath);
    const parser = new PDFParse({ data: buffer });
    try {
      const pdfData = await parser.getText();
      return pdfData.text ?? "";
    } finally {
      await parser.destroy();
    }
  }

  async function walk(currentPath: string): Promise<void> {
    const entries = await fs.readdir(currentPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".") && entry.name !== ".env" && entry.name !== ".github") {
        if (entry.isDirectory()) {
          continue;
        }
      }

      const nextPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        if (IGNORED_DIRECTORIES.has(entry.name)) {
          continue;
        }

        await walk(nextPath);
        continue;
      }

      const extension = path.extname(entry.name).toLowerCase();
      if (!SUPPORTED_TEXT_EXTENSIONS.has(extension)) {
        debugLog("skip-extension", nextPath, extension);
        continue;
      }

      const stats = await fs.stat(nextPath);
      if (stats.size > maxFileBytes) {
        debugLog("skip-size", nextPath, stats.size);
        continue;
      }

      let content = "";
      try {
        if (extension === ".pdf") {
          content = await parsePdf(nextPath);
        } else {
          content = await fs.readFile(nextPath, "utf8");
        }
        content = sanitizeExtractedText(content);
      } catch (error) {
        debugLog("skip-parse", nextPath, String(error));
        continue;
      }

      if (!content || !content.trim()) {
        debugLog("skip-empty", nextPath);
        continue;
      }

      files.push({
        path: nextPath,
        relativePath: path.relative(absoluteRoot, nextPath),
        extension,
        sizeBytes: stats.size,
        mtimeMs: stats.mtimeMs,
        content
      });
    }
  }

  await walk(absoluteRoot);
  return files;
}
