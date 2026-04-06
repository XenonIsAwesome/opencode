import { Effect, Layer, ServiceMap, Stream } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
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
  }

  export class Service extends ServiceMap.Service<Service, Interface>()("@opencode/Docker") {}

  export const layer: Layer.Layer<
    Service,
    never,
    AppFileSystem.Service | ChildProcessSpawner.ChildProcessSpawner | Config.Service
  > = Layer.effect(
    Service,
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
      const config = yield* Config.Service

      const isEnabled = Effect.fn("Docker.isEnabled")(function* () {
        const cfg = yield* config.getGlobal()
        return cfg.docker?.enabled ?? false
      })

      const startContainer = Effect.fn("Docker.startContainer")(function* (imageTag: string, projectDir: string) {
        const proc = yield* spawner.spawn(
          ChildProcess.make(
            "docker",
            ["run", "-d", "--rm", "-v", `${projectDir}:/project`, "-w", "/project", imageTag, "sleep", "infinity"],
            {
              extendEnv: true,
            },
          ),
        )

        const output = yield* Stream.mkString(Stream.decodeText(proc.stdout))
        const code = yield* proc.exitCode

        if (code !== 0) {
          throw new Error(`Failed to start container: ${output}`)
        }

        const containerID = output.trim()
        log.info("started container", { containerID, projectDir })
        return containerID
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
          const cfg = yield* config.getGlobal()
          const image = cfg.docker?.image ?? "ghcr.io/anomalyco/opencode:latest"

          const containerID = yield* startContainer(image, input.directory)

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

      return Service.of({
        isEnabled,
        start,
        stop,
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
}
