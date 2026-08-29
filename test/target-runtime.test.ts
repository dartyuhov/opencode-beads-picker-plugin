import test from "node:test"
import assert from "node:assert/strict"
import { createServer } from "node:http"
import { execFileSync } from "node:child_process"
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { fileURLToPath } from "node:url"
import { dirname, join, resolve } from "node:path"

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const targetBinary = process.env.OPENCODE_BIN
const hasTmux = Boolean(commandPath("tmux"))
const interceptorPlugin = resolve(repoRoot, "test/fixtures/prompt-interceptor.ts")
const capturePlugin = resolve(repoRoot, "test/fixtures/server-capture.ts")
const competingPlugin = process.env.VIMCODE_PLUGIN ?? interceptorPlugin

test(
  "OpenCode 1.18.25 renders the native prompt and submits through it",
  { skip: !targetBinary || !hasTmux ? "Set OPENCODE_BIN and install tmux to run target smoke test" : false },
  async () => {
    assert.equal(execFileSync(targetBinary!, ["--version"], { encoding: "utf8" }).trim(), "1.18.25")

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
    const capturePath = join(temporaryRoot, "events.jsonl")
    const provider = await startProviderCapture()
    let stage = "startup"
    const issueJSON = JSON.stringify([{
      id: issueID,
      title: "Target runtime smoke issue",
      status: "open",
      priority: "P1",
      created_at: "2099-01-01T00:00:00.000Z",
      updated_at: "2099-01-01T00:00:00.000Z",
    }])
    const detailJSON = JSON.stringify([{
      id: issueID,
      title: "Target runtime smoke issue",
      status: "open",
      priority: "P1",
      issue_type: "task",
      owner: "smoke-owner",
      description: "Target runtime enriched description",
      created_at: "2099-01-01T00:00:00.000Z",
      updated_at: "2099-01-01T00:00:00.000Z",
    }])

    await mkdir(binDirectory)
    await mkdir(homeDirectory)
    await mkdir(configDirectory)
    await mkdir(dataDirectory)
    await mkdir(stateDirectory)
    await mkdir(cacheDirectory)
    await writeFile(join(binDirectory, "bd"), `#!/bin/sh\nprintf '%s\n' "$PWD $*" >> '${bdLog}'\ncase "$1" in\n  show) printf '%s\n' '${detailJSON}' >> '${bdLog}'; printf '%s' '${detailJSON}' ;;\n  *) printf '%s\n' '${issueJSON}' >> '${bdLog}'; printf '%s' '${issueJSON}' ;;\nesac\n`)
    await chmod(join(binDirectory, "bd"), 0o755)

    const env = {
      ...process.env,
      HOME: homeDirectory,
      XDG_CONFIG_HOME: configDirectory,
      XDG_DATA_HOME: dataDirectory,
      XDG_STATE_HOME: stateDirectory,
      XDG_CACHE_HOME: cacheDirectory,
      OPENCODE_CONFIG_DIR: configDirectory,
      OPENCODE_BEADS_CAPTURE: capturePath,
      PATH: `${binDirectory}:${process.env.PATH ?? ""}`,
    }

    await writeFile(join(configDirectory, "opencode.json"), JSON.stringify({
      $schema: "https://opencode.ai/config.json",
      plugin: [resolve(repoRoot, "dist/server.js"), capturePlugin],
      model: "smoke/test-model",
      provider: {
        smoke: {
          name: "Smoke provider",
          id: "smoke",
          env: [],
          npm: "@ai-sdk/openai-compatible",
          models: {
            "test-model": {
              id: "test-model",
              name: "Smoke model",
              attachment: false,
              reasoning: false,
              temperature: false,
              tool_call: false,
              release_date: "2026-01-01",
              limit: { context: 100000, output: 1000 },
              cost: { input: 0, output: 0 },
              options: {},
            },
          },
          options: { apiKey: "smoke", baseURL: provider.url },
        },
      },
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
      await sendLiteralKeys(tmuxSocket, session, ["b", "d", ":"], env)
      await waitForFrame(tmuxSocket, session, (frame) => frame.includes(issueID))

      stage = "selection"
      runTmux(tmuxSocket, ["send-keys", "-t", session, "Enter"], env)
      await waitForFrame(tmuxSocket, session, (frame) => frame.includes(`[Beads:${issueID}]`))

      stage = "submission"
      const callsBeforeSubmit = countBeadsCalls(await readFile(bdLog, "utf8"))
      runTmux(tmuxSocket, ["send-keys", "-t", session, "Enter"], env)
      await waitForBeadsCall(bdLog, callsBeforeSubmit)
      await waitForBeadsShowCall(bdLog)
      const submittedFrame = await waitForFrame(tmuxSocket, session, (frame) => frame.includes(`[Beads:${issueID}]`))
      assert.match(submittedFrame, new RegExp(`\\[Beads:${issueID}\\]`))
      const persisted = await waitForCapturedPart(capturePath, issueID)
      assert.equal(persisted.type, "file")
      assert.equal(persisted.filename, `[Beads:${issueID}]`)
      assert.equal(persisted.mime, "text/markdown")
      assert.match(decodeDataUrl(String(persisted.url)), /Target runtime smoke issue/)
      assert.doesNotMatch(JSON.stringify(persisted), /invalid user part/i)
      assert.match(JSON.stringify(provider.requests), /Target runtime smoke issue/)
      assert.match(JSON.stringify(provider.requests), /Target runtime enriched description/)
      assert.equal((await capturedRecords(capturePath)).some((record) => record.kind === "session-error"), false)

      stage = "post-submission typing"
      await new Promise((resolve) => setTimeout(resolve, 250))
      runTmux(tmuxSocket, ["send-keys", "-t", session, "-l", "--", "second prompt"], env)
      await waitForFrame(tmuxSocket, session, (frame) => frame.includes("second prompt"))
    } catch (error) {
      const bdOutput = await readFile(bdLog, "utf8").catch(() => "<bd was not invoked>")
      const captureOutput = await readFile(capturePath, "utf8").catch(() => "<capture was not written>")
      throw new Error(`${error instanceof Error ? error.message : String(error)}\nStage: ${stage}\nBeads invocations:\n${bdOutput}\nCapture:\n${captureOutput}`)
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
      await provider.close()
    }
  },
)

test(
  "Beads picker works beside a competing TUI plugin",
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
    await writeFile(join(binDirectory, "bd"), `#!/bin/sh\nprintf '%s\\n' "$PWD $*" >> '${bdLog}'\nprintf '%s' '${issueJSON}'\n`)
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
      await sendLiteralKeys(tmuxSocket, session, ["b", "d", ":"], env)
      await waitForFrame(tmuxSocket, session, (frame) => frame.includes("compatibility-issue"))
      runTmux(tmuxSocket, ["send-keys", "-t", session, "Enter"], env)
      await waitForFrame(tmuxSocket, session, (current) => current.includes("[Beads:compatibility-issue]"))
      await new Promise((resolve) => setTimeout(resolve, 250))
      runTmux(tmuxSocket, ["send-keys", "-t", session, "-l", "--", "second prompt"], env)
      await waitForFrame(tmuxSocket, session, (current) => current.includes("second prompt"))
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

type ProviderCapture = {
  url: string
  requests: unknown[]
  close(): Promise<void>
}

async function startProviderCapture(): Promise<ProviderCapture> {
  const requests: unknown[] = []
  const server = createServer((request, response) => {
    let body = ""
    request.on("data", (chunk: Buffer) => {
      body += chunk.toString("utf8")
    })
    request.on("end", () => {
      try {
        requests.push(JSON.parse(body))
      } catch {
        requests.push(body)
      }
      response.writeHead(200, { "content-type": "text/event-stream" })
      response.end("data: [DONE]\n\n")
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => resolve())
  })
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Provider capture server did not bind to TCP port")
  return {
    url: `http://127.0.0.1:${address.port}/v1`,
    requests,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  }
}

async function sendLiteralKeys(socket: string, session: string, keys: string[], env: NodeJS.ProcessEnv): Promise<void> {
  for (const key of keys) {
    runTmux(socket, ["send-keys", "-t", session, "-l", "--", key], env)
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

function countBeadsCalls(contents: string): number {
  return contents.split("\n").filter((line) => line.endsWith(" list --json --limit 1000 --sort updated")).length
}

type CapturedRecord = {
  kind?: string
  part?: { type?: string; filename?: string; mime?: string; url?: string }
}

async function capturedRecords(path: string): Promise<CapturedRecord[]> {
  const contents = await readFile(path, "utf8").catch(() => "")
  return contents.split("\n").filter(Boolean).flatMap((line) => {
    try {
      return [JSON.parse(line) as CapturedRecord]
    } catch {
      return []
    }
  })
}

async function waitForCapturedPart(path: string, issueID: string): Promise<NonNullable<CapturedRecord["part"]>> {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    const matches = (await capturedRecords(path)).filter((item) =>
      item.kind === "persisted-part" && item.part?.type === "file" && item.part.filename === `[Beads:${issueID}]`,
    )
    const record = matches[matches.length - 1]
    if (record?.part) return record.part
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`Timed out waiting for persisted Beads file part: ${await readFile(path, "utf8").catch(() => "<no capture>")}`)
}

function decodeDataUrl(url: string): string {
  const separator = url.indexOf(",")
  if (separator === -1) return ""
  const body = url.slice(separator + 1)
  return url.slice(0, separator).includes(";base64")
    ? Buffer.from(body, "base64").toString("utf8")
    : decodeURIComponent(body)
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
    `OPENCODE_BEADS_CAPTURE=${env.OPENCODE_BEADS_CAPTURE}`,
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

async function waitForBeadsShowCall(logPath: string): Promise<void> {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    if ((await readFile(logPath, "utf8")).split("\n").some((line) => line.includes(" show "))) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`Timed out waiting for Beads detail lookup. Invocations:\n${await readFile(logPath, "utf8")}`)
}
