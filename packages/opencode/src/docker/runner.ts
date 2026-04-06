import { Effect } from "effect"
import path from "path"
import { Config } from "../config/config"

export namespace DockerRunner {
  export interface CLIArgs {
    command?: string
    model?: string
    agent?: string
    variant?: string
    continue?: boolean
    session?: string
    fork?: boolean
  }

  export interface RunInput {
    directory: string
    message: string
    files: Array<{ type: string; url: string; filename: string; mime: string }>
    args: CLIArgs
  }

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

  export async function runFromCLI(input: RunInput): Promise<void> {
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

    const dockerArgs = ["opencode", "run", input.message]
    if (input.args.command) dockerArgs.push(input.args.command)
    if (input.args.model) dockerArgs.push("--model", input.args.model)
    if (input.args.agent) dockerArgs.push("--agent", input.args.agent)
    if (input.args.variant) dockerArgs.push("--variant", input.args.variant)
    if (input.args.continue) dockerArgs.push("--continue")
    if (input.args.session) dockerArgs.push("--session", input.args.session)
    if (input.args.fork) dockerArgs.push("--fork")

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
        ...dockerArgs,
      ],
      cwd: input.directory,
      stdout: "inherit",
      stderr: "inherit",
      stdin: "inherit",
    })

    const exitCode = await dockerProc.exited

    console.log("\n=== Session ended ===")
    console.log("Container stopped")

    process.exit(exitCode)
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
