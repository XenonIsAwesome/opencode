import { Effect } from "effect"
import path from "path"
import os from "os"
import fs from "fs/promises"
import { Docker } from "./index"
import { AppFileSystem } from "@/filesystem"
import { Log } from "../util/log"
import { Config } from "../config/config"

export namespace DockerRunner {
  const log = Log.create({ service: "docker-runner" })

  const tempDir = () => path.join(os.tmpdir(), `opencode-sandbox-${Date.now()}`)

  export interface CLIArgs {
    command?: string
    model?: string
    agent?: string
    variant?: string
    continue?: boolean
    session?: string
    fork?: boolean
    prompt?: string
  }

  export interface RunInput {
    directory: string
    message: string
    files: { type: string; url: string; filename: string; mime: string }[]
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

    log.info("starting docker sandbox", { directory: input.directory })

    const temp = tempDir()
    let containerID: string | undefined

    try {
      console.log("Starting Docker container...")
      containerID = await Docker.start({ directory: input.directory })

      console.log(`Container started: ${containerID.substring(0, 12)}`)

      const changes = await Docker.diff(containerID)

      if (changes.length === 0) {
        console.log("No changes detected in container")
        return
      }

      console.log("\n=== Changes in Container ===")
      for (const change of changes) {
        console.log(`  ${change.status}: ${change.file}`)
      }
      console.log("============================\n")

      console.log("To accept these changes, copy them out of the container:")
      console.log("  docker cp <container>:/project <destination>")
      console.log("\nNote: Full diff-based change acceptance will be implemented in a future update.")
    } finally {
      if (containerID) {
        console.log(`Stopping container ${containerID.substring(0, 12)}...`)
        await Docker.stop(containerID)
      }

      try {
        await Bun.write(path.join(temp, ".gitkeep"), "").catch(() => {})
        await fs.rm(temp, { recursive: true, force: true }).catch(() => {})
      } catch {}
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

    log.info("starting docker sandbox for TUI", { directory: input.directory })

    let containerID: string | undefined

    try {
      console.log("Starting Docker container for interactive session...")
      containerID = await Docker.start({ directory: input.directory })

      console.log(`Container started: ${containerID.substring(0, 12)}`)
      console.log("Run 'opencode' inside the container to start the TUI")
      console.log("Changes will be tracked and can be reviewed after the session ends")
      console.log("\nTo exit and review changes, type /exit or Ctrl+C")
      console.log("To copy changes out: docker cp <container>:/project .\n")

      const runProc = Bun.spawn(["docker", "exec", "-it", containerID!, "opencode"], {
        cwd: "/project",
        stdio: ["inherit", "inherit", "inherit"] as any,
        env: process.env,
      })

      const exitCode = await runProc.exited

      console.log(`\nSession ended (exit code: ${exitCode})`)

      const changes = await Docker.diff(containerID)

      if (changes.length === 0) {
        console.log("No changes made in container")
      } else {
        console.log("\n=== Changes in Container ===")
        for (const change of changes) {
          console.log(`  ${change.status}: ${change.file}`)
        }
        console.log("============================\n")

        console.log("To accept these changes, copy them out of the container:")
        console.log(`  docker cp ${containerID}:/project .`)
      }
    } finally {
      if (containerID) {
        console.log(`Stopping container ${containerID.substring(0, 12)}...`)
        await Docker.stop(containerID)
      }
    }
  }

  async function checkDocker(): Promise<boolean> {
    try {
      const proc = Bun.spawn(["docker", "version"], { stderr: "ignore" })
      const code = await proc.exited
      return code === 0
    } catch {
      return false
    }
  }

  async function checkDockerEnabled(): Promise<boolean> {
    try {
      const cfg = await Config.get()
      return cfg.docker?.enabled ?? false
    } catch {
      return false
    }
  }
}
