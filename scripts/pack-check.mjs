import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"

const output = execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
  encoding: "utf8",
})
const result = JSON.parse(output)
const files = new Set(result[0]?.files?.map((file) => file.path) ?? [])

for (const file of [
  "dist/server.js",
  "dist/tui.js",
  "dist/shared/index.js",
  "assets/beads-picker-demo.gif",
  "README.md",
  "LICENSE",
  "CHANGELOG.md",
]) {
  assert.ok(files.has(file), `npm package is missing ${file}`)
}

for (const file of ["src/server.ts", "test/server.test.ts", "tsconfig.json", "package-lock.json"]) {
  assert.equal(files.has(file), false, `npm package unexpectedly contains ${file}`)
}

console.log(`npm package contains ${files.size} files`)
