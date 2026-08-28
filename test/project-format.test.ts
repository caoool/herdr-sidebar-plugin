import { test } from "node:test"
import assert from "node:assert/strict"
import { divergence, projectBlock, type ProjectInfo } from "../src/sections/project/format.js"
import { PLAIN, TERMINAL } from "../src/ansi.js"

const strip = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "")
const info: ProjectInfo = {
  workspace: "herdr-sidebar-plugin", branch: "main", ahead: 2, behind: 1, worktree: null,
}

test("divergence reads like herdr's own", () => {
  assert.equal(divergence(2, 1), "↑2 ↓1")
  assert.equal(divergence(3, 0), "↑3")
  assert.equal(divergence(0, 4), "↓4")
})

test("a branch level with its upstream reports nothing", () => {
  // "↑0 ↓0" would make the ordinary case the loudest thing on the row.
  assert.equal(divergence(0, 0), "")
})

test("a branch with no upstream has no divergence to describe", () => {
  assert.equal(divergence(null, null), "")
})

test("the block is workspace, then branch with its divergence", () => {
  const lines = projectBlock(info, 30, PLAIN)
  assert.equal(lines[0], "PROJECT")
  assert.equal(lines[1], "")
  assert.equal(lines[2], "herdr-sidebar-plugin")
  assert.ok(lines[3].startsWith("main") && lines[3].endsWith("↑2 ↓1"))
  assert.equal(lines[3].length, 30)
  assert.equal(lines.length, 4, "no worktree row on a main checkout")
})

test("a worktree adds a row, and only then", () => {
  const lines = projectBlock({ ...info, worktree: "feature-x" }, 30, PLAIN)
  assert.equal(lines.length, 5)
  assert.equal(lines[4], "feature-x")
})

test("a clean branch still renders, without a divergence column", () => {
  const lines = projectBlock({ ...info, ahead: 0, behind: 0 }, 30, PLAIN)
  assert.equal(lines[3].trimEnd(), "main")
})

test("nothing known means no block at all", () => {
  assert.deepEqual(projectBlock(null, 30, PLAIN), [])
  assert.deepEqual(projectBlock({ workspace: null, branch: null, ahead: null, behind: null, worktree: null }, 30, PLAIN), [])
})

test("styling leaves the rows the same width", () => {
  assert.deepEqual(projectBlock(info, 30, TERMINAL).map(strip), projectBlock(info, 30, PLAIN))
})
