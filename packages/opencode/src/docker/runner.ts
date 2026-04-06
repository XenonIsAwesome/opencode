import { Effect } from "effect"
import path from "path"
import { Config } from "../config/config"

export namespace DockerRunner {
  export interface TUIInput {
    directory: string
    args: {
      continue?: boolean
      session?: string
      agent?: string
      model?: string
      fork?: boolean
    }
  }

  export async function runTUI(input: TUIInput): Promise<void> {
    const isDockerAvailable = await checkDocker()
    if (!isDockerAvailable) {
      console.error("Docker is not available. Please install Docker and try again.")
      process.exit(1)
    }

    const isEnabled = await checkDockerEnabled()
    if (!isEnabled) {
      console.error("Docker sandbox is not enabled. Add 'docker: { enabled: true }' to your opencode.json")
      process.exit(1)
    }

    const image = await getDockerImage()

    console.log("Starting Docker container with volume mount...")

    const uid = process.getuid?.() ?? 1000
    const gid = process.getgid?.() ?? 1000

    const runProc = Bun.spawn({
      cmd: [
        "docker",
        "run",
        "-d",
        "--rm",
        "--name",
        `opencode-${Date.now()}`,
        "-v",
        `${input.directory}:/project`,
        "-w",
        "/project",
        "--entrypoint",
        "sleep",
        "--user",
        `${uid}:${gid}`,
        image,
        "infinity",
      ],
      stderr: "pipe",
    })

    const runCode = await runProc.exited
    if (runCode !== 0) {
      const errMsg = await new Response(runProc.stderr).text()
      console.error("Failed to start container:", errMsg)
      process.exit(1)
    }

    let containerID = (await new Response(runProc.stdout).text()).trim()
    const shortID = containerID.substring(0, 12)
    console.log(`Container started: ${shortID}`)

    await new Promise((r) => setTimeout(r, 500))

    console.log("=== Session started ===\n")

    const dockerProc = Bun.spawn({
      cmd: [
        "docker",
        "exec",
        "-it",
        "-e",
        "HOME=/tmp/opencode-home",
        "-e",
        "XDG_CONFIG_HOME=/tmp/opencode-home/.config",
        "-e",
        "XDG_CACHE_HOME=/tmp/opencode-home/.cache",
        containerID,
        "opencode",
      ],
      cwd: input.directory,
      stdout: "inherit",
      stderr: "inherit",
      stdin: "inherit",
    })

    await dockerProc.exited

    console.log("\n=== Session ended ===")
    console.log("Container stopped")
  }

  async function checkDocker(): Promise<boolean> {
    try {
      const proc = Bun.spawn(["docker", "version"], { stderr: "ignore" })
      return (await proc.exited) === 0
    } catch {
      return false
    }
  }

  async function checkDockerEnabled(): Promise<boolean> {
    try {
      const cfg = await Config.getGlobal()
      return cfg.docker?.enabled ?? false
    } catch {
      return false
    }
  }

  async function getDockerImage(): Promise<string> {
    try {
      const cfg = await Config.getGlobal()
      return cfg.docker?.image ?? "ghcr.io/anomalyco/opencode:latest"
    } catch {
      return "ghcr.io/anomalyco/opencode:latest"
    }
  }
}
