import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { loadConfig } from "./config.js";
import { OwnSearchError } from "./errors.js";

const execFileAsync = promisify(execFile);

async function runDocker(args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync("docker", args, { windowsHide: true });
    return stdout.trim();
  } catch (error) {
    throw new OwnSearchError("Docker is required for Qdrant setup. Install Docker and ensure `docker` is on PATH.");
  }
}

export async function ensureQdrantDocker(): Promise<{ started: boolean; url: string }> {
  const config = await loadConfig();
  const containerName = config.qdrantContainerName;
  const volumeName = config.qdrantVolumeName;

  const existing = await runDocker(["ps", "-a", "--filter", `name=^/${containerName}$`, "--format", "{{.Names}}"]);
  if (existing === containerName) {
    const running = await runDocker(["inspect", "-f", "{{.State.Running}}", containerName]);
    if (running === "true") {
      return { started: false, url: config.qdrantUrl };
    }

    await runDocker(["start", containerName]);
    return { started: true, url: config.qdrantUrl };
  }

  await runDocker([
    "run",
    "-d",
    "--name",
    containerName,
    "-p",
    "6333:6333",
    "-p",
    "6334:6334",
    "-v",
    `${volumeName}:/qdrant/storage`,
    "qdrant/qdrant:latest"
  ]);

  return { started: true, url: config.qdrantUrl };
}
