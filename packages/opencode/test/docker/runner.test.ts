import { describe, expect, test } from "bun:test"
import { DockerRunner } from "../../src/docker/runner"
import path from "path"

describe("docker/runner", () => {
  describe("CLIArgs interface", () => {
    test("CLIArgs accepts valid options", () => {
      const args: DockerRunner.CLIArgs = {
        command: "test",
        model: "anthropic/claude-3",
        agent: "build",
        variant: "high",
        continue: true,
        session: "abc123",
        fork: true,
      }
      expect(args.command).toBe("test")
      expect(args.model).toBe("anthropic/claude-3")
      expect(args.agent).toBe("build")
      expect(args.variant).toBe("high")
      expect(args.continue).toBe(true)
      expect(args.session).toBe("abc123")
      expect(args.fork).toBe(true)
    })

    test("CLIArgs accepts empty options", () => {
      const args: DockerRunner.CLIArgs = {}
      expect(args.command).toBeUndefined()
      expect(args.model).toBeUndefined()
      expect(args.agent).toBeUndefined()
    })
  })

  describe("RunInput interface", () => {
    test("RunInput accepts valid structure", () => {
      const input: DockerRunner.RunInput = {
        directory: "/project",
        message: "fix the bug",
        files: [{ type: "file", url: "file:///project/src/main.ts", filename: "main.ts", mime: "text/plain" }],
        args: {
          model: "anthropic/claude-3",
        },
      }
      expect(input.directory).toBe("/project")
      expect(input.message).toBe("fix the bug")
      expect(input.files).toHaveLength(1)
      expect(input.args.model).toBe("anthropic/claude-3")
    })

    test("RunInput accepts empty files array", () => {
      const input: DockerRunner.RunInput = {
        directory: "/project",
        message: "hello",
        files: [],
        args: {},
      }
      expect(input.files).toHaveLength(0)
    })
  })
})
