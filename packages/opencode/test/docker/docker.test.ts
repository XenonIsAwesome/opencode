import { describe, expect, test } from "bun:test"
import { Docker } from "../../src/docker"

describe("docker", () => {
  describe("Docker.Change type", () => {
    test("Change interface has correct shape for added file", () => {
      const change: Docker.Change = {
        file: "src/index.ts",
        status: "added",
      }
      expect(change.file).toBe("src/index.ts")
      expect(change.status).toBe("added")
    })

    test("Change interface has correct shape for modified file", () => {
      const change: Docker.Change = {
        file: "src/app.ts",
        status: "modified",
        diff: "some diff content",
      }
      expect(change.file).toBe("src/app.ts")
      expect(change.status).toBe("modified")
      expect(change.diff).toBe("some diff content")
    })

    test("Change interface has correct shape for deleted file", () => {
      const change: Docker.Change = {
        file: "src/old.ts",
        status: "deleted",
      }
      expect(change.file).toBe("src/old.ts")
      expect(change.status).toBe("deleted")
    })
  })

  describe("Docker.Service exists", () => {
    test("Service class is defined", () => {
      expect(Docker.Service).toBeDefined()
    })

    test("layer is defined", () => {
      expect(Docker.layer).toBeDefined()
    })

    test("defaultLayer is defined", () => {
      expect(Docker.defaultLayer).toBeDefined()
    })

    test("start function is defined", () => {
      expect(typeof Docker.start).toBe("function")
    })

    test("stop function is defined", () => {
      expect(typeof Docker.stop).toBe("function")
    })

    test("diff function is defined", () => {
      expect(typeof Docker.diff).toBe("function")
    })
  })
})
