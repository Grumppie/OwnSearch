import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { loadConfig } from "./config.js";
import { OwnSearchError } from "./errors.js";

const execFileAsync = promisify(execFile);
const DOCKER_DESKTOP_WINDOWS_URL = "https://docs.docker.com/desktop/setup/install/windows-install/";
const DOCKER_DESKTOP_MAC_URL = "https://docs.docker.com/desktop/setup/install/mac-install/";
const DOCKER_ENGINE_LINUX_URL = "https://docs.docker.com/engine/install/";
const DOCKER_DESKTOP_OVERVIEW_URL = "https://docs.docker.com/desktop/";

function getDockerInstallLabel(): string {
  if (process.platform === "win32") {
    return "Windows install guide";
  }
  if (process.platform === "darwin") {
    return "macOS install guide";
  }
  return "Linux install guide";
}

function getDockerInstallUrl(): string {
  if (process.platform === "win32") {
    return DOCKER_DESKTOP_WINDOWS_URL;
  }
  if (process.platform === "darwin") {
    return DOCKER_DESKTOP_MAC_URL;
  }
  return DOCKER_ENGINE_LINUX_URL;
}

async function runDocker(args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync("docker", args, { windowsHide: true });
    return stdout.trim();
  } catch (error) {
    throw new OwnSearchError(
      `Docker is required for Qdrant setup. Install Docker and ensure \`docker\` is on PATH. ${getDockerInstallLabel()}: ${getDockerInstallUrl()} Docker docs: ${DOCKER_DESKTOP_OVERVIEW_URL}`
    );
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
