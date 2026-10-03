import test from "node:test"
import assert from "node:assert/strict"
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createBeadsDiscovery } from "../src/shared/discovery.js"

test("discovery drains stderr while collecting issue JSON from a real process", async () => {
  const directory = await mkdtemp(join(tmpdir(), "beads-stderr-"))
  try {
    const executable = join(directory, "bd")
    await writeFile(executable, `#!/usr/bin/env node
process.stderr.write("warning: workspace configuration\\n".repeat(8000))
process.stdout.write(JSON.stringify([{ id: "stderr-issue", title: "Issue with warnings", status: "closed" }]))
`)
    await chmod(executable, 0o755)
    const discovery = createBeadsDiscovery({ directory, env: { ...process.env, PATH: `${directory}:${process.env.PATH}` } })
    assert.deepEqual(await discovery.search(""), [{ id: "stderr-issue", title: "Issue with warnings", status: "closed" }], discovery.lastFailure)
    assert.equal(discovery.lastFailure, undefined)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
