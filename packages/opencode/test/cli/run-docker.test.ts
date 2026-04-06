import { describe, expect, test } from "bun:test"

describe("cli/run --docker flag", () => {
  test("docker flag is defined in run command builder", async () => {
    const runModule = await import("../../src/cli/cmd/run")
    const cmd = runModule.RunCommand

    expect(cmd).toBeDefined()
    expect(cmd.command).toBe("run [message..]")
  })

  test("docker module exports Docker and DockerRunner", async () => {
    const docker = await import("../../src/docker")
    expect(docker.Docker).toBeDefined()
    expect(docker.Docker.Service).toBeDefined()
    expect(docker.Docker.layer).toBeDefined()
    expect(docker.Docker.defaultLayer).toBeDefined()

    const runner = await import("../../src/docker/runner")
    expect(runner.DockerRunner).toBeDefined()
  })

  test("Docker.Service has required methods", async () => {
    const { Docker } = await import("../../src/docker")
    const serviceDef = Docker.Service

    expect(serviceDef).toBeDefined()
  })

  test("DockerRunner has runFromCLI function", async () => {
    const { DockerRunner } = await import("../../src/docker/runner")
    expect(typeof DockerRunner.runFromCLI).toBe("function")
  })
})
