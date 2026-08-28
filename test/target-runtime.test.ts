import test from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { fileURLToPath } from "node:url"
import { dirname, join, resolve } from "node:path"

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const targetBinary = process.env.OPENCODE_BIN
const hasTmux = Boolean(commandPath("tmux"))
const interceptorPlugin = resolve(repoRoot, "test/fixtures/prompt-interceptor.ts")
const competingPlugin = process.env.VIMCODE_PLUGIN ?? interceptorPlugin

test(
  "OpenCode 1.18.23 renders the native prompt and submits through it",
  { skip: !targetBinary || !hasTmux ? "Set OPENCODE_BIN and install tmux to run target smoke test" : false },
  async () => {
    assert.equal(execFileSync(targetBinary!, ["--version"], { encoding: "utf8" }).trim(), "1.18.23")

    const temporaryRoot = await mkdtemp(join(tmpdir(), "opencode-beads-smoke-"))
    const binDirectory = join(temporaryRoot, "bin")
    const homeDirectory = join(temporaryRoot, "home")
    const configDirectory = join(temporaryRoot, "config")
    const dataDirectory = join(temporaryRoot, "data")
    const stateDirectory = join(temporaryRoot, "state")
    const cacheDirectory = join(temporaryRoot, "cache")
    const session = `opencode-beads-smoke-${process.pid}`
    const tmuxSocket = `opencode-beads-smoke-${process.pid}`
    const issueID = "target-runtime-smoke"
    const bdLog = join(temporaryRoot, "bd.log")
    let stage = "startup"
    const issueJSON = JSON.stringify([{
      id: issueID,
      title: "Target runtime smoke issue",
      status: "open",
      priority: "P1",
      created_at: "2099-01-01T00:00:00.000Z",
      updated_at: "2099-01-01T00:00:00.000Z",
    }])

    await mkdir(binDirectory)
    await mkdir(homeDirectory)
    await mkdir(configDirectory)
    await mkdir(dataDirectory)
    await mkdir(stateDirectory)
    await mkdir(cacheDirectory)
    await writeFile(join(binDirectory, "bd"), `#!/bin/sh\nprintf '%s\n' "$PWD $*" >> '${bdLog}'\nprintf '%s' '${issueJSON}' >> '${bdLog}'\nprintf '\n' >> '${bdLog}'\nprintf '%s' '${issueJSON}'\n`)
    await chmod(join(binDirectory, "bd"), 0o755)

    const env = {
      ...process.env,
      HOME: homeDirectory,
      XDG_CONFIG_HOME: configDirectory,
      XDG_DATA_HOME: dataDirectory,
      XDG_STATE_HOME: stateDirectory,
      XDG_CACHE_HOME: cacheDirectory,
      OPENCODE_CONFIG_DIR: configDirectory,
      PATH: `${binDirectory}:${process.env.PATH ?? ""}`,
    }

    await writeFile(join(configDirectory, "opencode.json"), JSON.stringify({
      $schema: "https://opencode.ai/config.json",
      plugin: [resolve(repoRoot, "dist/server.js")],
    }))
    await writeFile(join(configDirectory, "tui.json"), JSON.stringify({
      $schema: "https://opencode.ai/tui.json",
      plugin: [resolve(repoRoot, "dist/tui.js")],
    }))

    try {
      runTmux(tmuxSocket, ["new-session", "-d", "-s", session, "-x", "100", "-y", "30", "--", "env", ...environmentArguments(env), targetBinary!, repoRoot], env)
      stage = "home prompt"
      const initialFrame = await waitForFrame(tmuxSocket, session, (frame) => frame.includes("Ask anything..."))
      assert.equal((initialFrame.match(/Ask anything\.\.\./g) ?? []).length, 1)
      assert.match(initialFrame, /tab agents/)
      assert.match(initialFrame, /ctrl\+p commands/)
      assert.match(initialFrame, /Build ·/)
      assert.match(initialFrame, /┃/u)
      assert.match(initialFrame, /╹/u)

      stage = "picker result"
      runTmux(tmuxSocket, ["send-keys", "-t", session, "-l", "--", "bd:"], env)
      await waitForFrame(tmuxSocket, session, (frame) => frame.includes(issueID))

      stage = "selection"
      runTmux(tmuxSocket, ["send-keys", "-t", session, "Enter"], env)
      await waitForFrame(tmuxSocket, session, (frame) => frame.includes(`bd:${issueID}`))

      stage = "submission"
      const callsBeforeSubmit = countBeadsCalls(await readFile(bdLog, "utf8"))
      runTmux(tmuxSocket, ["send-keys", "-t", session, "Enter"], env)
      await waitForBeadsCall(bdLog, callsBeforeSubmit)
      const submittedFrame = await captureFrame(tmuxSocket, session)
      assert.doesNotMatch(submittedFrame, new RegExp(`bd:${issueID} `))
    } catch (error) {
      const bdOutput = await readFile(bdLog, "utf8").catch(() => "<bd was not invoked>")
      throw new Error(`${error instanceof Error ? error.message : String(error)}\nStage: ${stage}\nBeads invocations:\n${bdOutput}`)
    } finally {
      try {
        runTmux(tmuxSocket, ["kill-session", "-t", session], env)
      } catch {
        // Session may already have exited after the smoke submission.
      }
      try {
        runTmux(tmuxSocket, ["kill-server"], env)
      } catch {
        // The isolated server may already have exited.
      }
      await rm(temporaryRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    }
  },
)

test(
  "Beads picker stays disabled beside a competing TUI plugin",
  { skip: !targetBinary || !hasTmux ? "Set OPENCODE_BIN and install tmux to run target compatibility test" : false },
  async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), "opencode-beads-compatibility-"))
    const binDirectory = join(temporaryRoot, "bin")
    const homeDirectory = join(temporaryRoot, "home")
    const configDirectory = join(temporaryRoot, "config")
    const dataDirectory = join(temporaryRoot, "data")
    const stateDirectory = join(temporaryRoot, "state")
    const cacheDirectory = join(temporaryRoot, "cache")
    const session = `opencode-beads-compatibility-${process.pid}`
    const tmuxSocket = `opencode-beads-compatibility-${process.pid}`
    const bdLog = join(temporaryRoot, "bd.log")
    const issueJSON = JSON.stringify([{
      id: "compatibility-issue",
      title: "Compatibility issue",
      status: "open",
      priority: "P1",
      created_at: "2099-01-01T00:00:00.000Z",
      updated_at: "2099-01-01T00:00:00.000Z",
    }])

    await mkdir(binDirectory)
    await mkdir(homeDirectory)
    await mkdir(configDirectory)
    await mkdir(dataDirectory)
    await mkdir(stateDirectory)
    await mkdir(cacheDirectory)
    await writeFile(join(binDirectory, "bd"), `#!/bin/sh\nprintf '%s' "$PWD $*" >> '${bdLog}'\nprintf '%s' '${issueJSON}'\n`)
    await chmod(join(binDirectory, "bd"), 0o755)

    const env = {
      HOME: homeDirectory,
      XDG_CONFIG_HOME: configDirectory,
      XDG_DATA_HOME: dataDirectory,
      XDG_STATE_HOME: stateDirectory,
      XDG_CACHE_HOME: cacheDirectory,
      OPENCODE_CONFIG_DIR: configDirectory,
      PATH: `${binDirectory}:${process.env.PATH ?? ""}`,
    }

    await writeFile(join(configDirectory, "opencode.json"), JSON.stringify({ plugin: [] }))
    await writeFile(join(configDirectory, "tui.json"), JSON.stringify({
      $schema: "https://opencode.ai/tui.json",
      plugin: [resolve(repoRoot, "dist/tui.js"), competingPlugin],
    }))

    try {
      runTmux(tmuxSocket, ["new-session", "-d", "-s", session, "-x", "100", "-y", "30", "--", "env", ...environmentArguments(env), targetBinary!, repoRoot], env)
      await waitForFrame(tmuxSocket, session, (frame) => frame.includes("Ask anything..."))
      runTmux(tmuxSocket, ["send-keys", "-t", session, "-l", "--", "bd:"], env)
      await new Promise((resolve) => setTimeout(resolve, 500))
      const frame = await captureFrame(tmuxSocket, session)
      assert.equal((frame.match(/bd:/g) ?? []).length, 1, frame)
      assert.doesNotMatch(frame, /Compatibility issue/, frame)
      assert.equal((await readFile(bdLog, "utf8").catch(() => "")).trim(), "")
    } finally {
      try {
        runTmux(tmuxSocket, ["kill-session", "-t", session], env)
      } catch {
        // Session may already have exited.
      }
      try {
        runTmux(tmuxSocket, ["kill-server"], env)
      } catch {
        // Isolated server may already have exited.
      }
      await rm(temporaryRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    }
  },
)

function commandPath(command: string): string | undefined {
  try {
    return execFileSync("which", [command], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || undefined
  } catch {
    return undefined
  }
}

async function captureFrame(socket: string, session: string): Promise<string> {
  return execFileSync("tmux", ["-L", socket, "capture-pane", "-p", "-t", session, "-S", "-100"], { encoding: "utf8" })
}

function countBeadsCalls(contents: string): number {
  return contents.split("\n").filter((line) => line.endsWith(" list --json --limit 1000 --sort updated")).length
}


function runTmux(socket: string, args: string[], env: NodeJS.ProcessEnv) {
  execFileSync("tmux", ["-L", socket, ...args], { env, stdio: "ignore" })
}

function environmentArguments(env: NodeJS.ProcessEnv): string[] {
  return [
    `HOME=${env.HOME}`,
    `XDG_CONFIG_HOME=${env.XDG_CONFIG_HOME}`,
    `XDG_DATA_HOME=${env.XDG_DATA_HOME}`,
    `XDG_STATE_HOME=${env.XDG_STATE_HOME}`,
    `XDG_CACHE_HOME=${env.XDG_CACHE_HOME}`,
    `OPENCODE_CONFIG_DIR=${env.OPENCODE_CONFIG_DIR}`,
    "OPENCODE_API_KEY=smoke",
    `PATH=${env.PATH}`,
  ]
}

async function waitForFrame(socket: string, session: string, predicate: (frame: string) => boolean): Promise<string> {
  const deadline = Date.now() + 20_000
  let frame = ""
  while (Date.now() < deadline) {
    try {
      frame = execFileSync("tmux", ["-L", socket, "capture-pane", "-p", "-t", session, "-S", "-100"], { encoding: "utf8" })
    } catch {
      frame = ""
    }
    if (predicate(frame)) return frame
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`Target TUI condition timed out. Last frame:\n${frame}`)
}

async function waitForBeadsCall(logPath: string, previousCalls: number): Promise<void> {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    if (countBeadsCalls(await readFile(logPath, "utf8")) > previousCalls) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`Timed out waiting for server Beads refresh after ${previousCalls} calls`)
}
