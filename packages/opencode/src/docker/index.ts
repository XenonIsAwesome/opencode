import { Effect, Layer, ServiceMap, Stream } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import path from "path"
import { Log } from "../util/log"
import { Config } from "../config/config"
import { AppFileSystem } from "@/filesystem"
import { makeRuntime } from "@/effect/run-service"
import * as CrossSpawnSpawner from "@/effect/cross-spawn-spawner"

export namespace Docker {
  const log = Log.create({ service: "docker" })

  const fail = (err: unknown): never => {
    throw err
  }

  export interface Change {
    file: string
    status: "added" | "modified" | "deleted"
    diff?: string
  }

  export interface Interface {
    readonly isEnabled: () => Effect.Effect<boolean>
    readonly start: (input: { directory: string }) => Effect.Effect<string, never, never>
    readonly stop: (containerID: string) => Effect.Effect<void, never, never>
    readonly copyIn: (containerID: string, sourceDir: string) => Effect.Effect<void, never, never>
    readonly copyOut: (containerID: string, outputDir: string) => Effect.Effect<Change[], never, never>
    readonly diff: (containerID: string) => Effect.Effect<Change[], never, never>
  }

  export class Service extends ServiceMap.Service<Service, Interface>()("@opencode/Docker") {}

  const dockerfileContent = () => `
FROM ghcr.io/anomalyco/opencode:latest

# Install git and common tools
RUN apk add --no-cache git ripgrep

# Copy project files
COPY --chown=opencode:opencode . /project

# Set working directory
WORKDIR /project

# Set environment
ENV OPENCODE_CONTAINER=true
`

  export const layer: Layer.Layer<
    Service,
    never,
    AppFileSystem.Service | ChildProcessSpawner.ChildProcessSpawner | Config.Service
  > = Layer.effect(
    Service,
    Effect.gen(function* () {
      const fs = yield* AppFileSystem.Service
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
      const config = yield* Config.Service

      const isEnabled = Effect.fn("Docker.isEnabled")(function* () {
        const cfg = yield* config.get()
        return cfg.docker?.enabled ?? false
      })

      const buildImage = Effect.fn("Docker.buildImage")(function* (projectDir: string) {
        const tag = `opencode-sandbox-${Date.now()}`
        const dockerfile = path.join(projectDir, "Dockerfile.opencode-sandbox")

        yield* fs.writeFileString(dockerfile, dockerfileContent())

        const buildProc = yield* spawner.spawn(
          ChildProcess.make("docker", ["build", "-t", tag, "-f", dockerfile, "."], {
            cwd: projectDir,
            extendEnv: true,
          }),
        )

        const output = yield* Stream.runFold(
          () => "",
          (acc: string, chunk: string) => acc + chunk,
        )(Stream.decodeText(buildProc.stdout))

        const code = yield* buildProc.exitCode

        yield* fs.remove(dockerfile).pipe(Effect.ignore)

        if (code !== 0) {
          throw new Error(`Docker build failed: ${output}`)
        }

        log.info("built docker image", { tag })
        return tag
      })

      const startContainer = Effect.fn("Docker.startContainer")(function* (imageTag: string) {
        const proc = yield* spawner.spawn(
          ChildProcess.make("docker", ["run", "-d", "--rm", "-w", "/project", imageTag, "sleep", "infinity"], {
            extendEnv: true,
          }),
        )

        const output = yield* Stream.mkString(Stream.decodeText(proc.stdout))
        const code = yield* proc.exitCode

        if (code !== 0) {
          throw new Error(`Failed to start container: ${output}`)
        }

        const containerID = output.trim()
        log.info("started container", { containerID })
        return containerID
      })

      const copyToContainer = Effect.fn("Docker.copyToContainer")(function* (containerID: string, sourceDir: string) {
        const proc = yield* spawner.spawn(
          ChildProcess.make("docker", ["cp", ".", `${containerID}:/project`], {
            cwd: sourceDir,
            extendEnv: true,
          }),
        )

        const code = yield* proc.exitCode
        if (code !== 0) {
          const stderr = yield* Stream.mkString(Stream.decodeText(proc.stderr))
          throw new Error(`Failed to copy files to container: ${stderr}`)
        }

        log.info("copied files to container", { containerID })
      })

      const copyFromContainer = Effect.fn("Docker.copyFromContainer")(function* (
        containerID: string,
        outputDir: string,
      ) {
        yield* fs.ensureDir(outputDir)

        const proc = yield* spawner.spawn(
          ChildProcess.make("docker", ["cp", `${containerID}:/project/.`, outputDir], {
            extendEnv: true,
          }),
        )

        const code = yield* proc.exitCode
        if (code !== 0) {
          const stderr = yield* Stream.mkString(Stream.decodeText(proc.stderr))
          throw new Error(`Failed to copy files from container: ${stderr}`)
        }

        log.info("copied files from container", { containerID, outputDir })
      })

      const getChanges = Effect.fn("Docker.getChanges")(function* (containerID: string) {
        const proc = yield* spawner.spawn(
          ChildProcess.make("docker", ["exec", containerID, "sh", "-c", "cd /project && git status --porcelain"], {
            extendEnv: true,
          }),
        )

        const output = yield* Stream.mkString(Stream.decodeText(proc.stdout))
        const code = yield* proc.exitCode

        if (code !== 0) {
          return []
        }

        const changes: Change[] = []
        for (const line of output.trim().split("\n")) {
          if (!line.trim()) continue

          const status = line.substring(0, 2).trim()
          const file = line.substring(3).trim()

          if (status === "??") {
            changes.push({ file, status: "added" })
          } else if (status === "D") {
            changes.push({ file, status: "deleted" })
          } else {
            changes.push({ file, status: "modified" })
          }
        }

        return changes
      })

      const stopContainer = Effect.fn("Docker.stopContainer")(function* (containerID: string) {
        const proc = yield* spawner.spawn(ChildProcess.make("docker", ["stop", containerID], { extendEnv: true }))

        const code = yield* proc.exitCode
        if (code !== 0) {
          log.warn("failed to stop container", { containerID, code })
        }

        log.info("stopped container", { containerID })
      })

      const start = Effect.fn("Docker.start")(
        function* (input: { directory: string }) {
          const cfg = yield* config.get()
          const image = cfg.docker?.image

          const tag = image ?? (yield* buildImage(input.directory))
          const containerID = yield* startContainer(tag)
          yield* copyToContainer(containerID, input.directory)

          return containerID
        },
        Effect.scoped,
        Effect.catch((err) => Effect.succeed(fail(err))),
      )

      const stop = Effect.fn("Docker.stop")(
        function* (containerID: string) {
          yield* stopContainer(containerID)
        },
        Effect.scoped,
        Effect.catch((err) => Effect.succeed(fail(err))),
      )

      const copyIn = Effect.fn("Docker.copyIn")(
        function* (containerID: string, sourceDir: string) {
          yield* copyToContainer(containerID, sourceDir)
        },
        Effect.scoped,
        Effect.catch((err) => Effect.succeed(fail(err))),
      )

      const copyOut = Effect.fn("Docker.copyOut")(
        function* (containerID: string, outputDir: string) {
          yield* copyFromContainer(containerID, outputDir)
          return yield* getChanges(containerID)
        },
        Effect.scoped,
        Effect.catch((err) => Effect.succeed(fail(err))),
      )

      const diff = Effect.fn("Docker.diff")(
        function* (containerID: string) {
          return yield* getChanges(containerID)
        },
        Effect.scoped,
        Effect.catch((err) => Effect.succeed(fail(err))),
      )

      return Service.of({
        isEnabled,
        start,
        stop,
        copyIn,
        copyOut,
        diff,
      })
    }),
  )

  export const defaultLayer = layer.pipe(
    Layer.provide(AppFileSystem.defaultLayer),
    Layer.provide(Config.defaultLayer),
    Layer.provide(CrossSpawnSpawner.defaultLayer),
  )

  const { runPromise } = makeRuntime(Service, defaultLayer)

  export async function start(input: { directory: string }) {
    return runPromise((svc) => svc.start(input))
  }

  export async function stop(containerID: string) {
    return runPromise((svc) => svc.stop(containerID))
  }

  export async function diff(containerID: string) {
    return runPromise((svc) => svc.diff(containerID))
  }
}
