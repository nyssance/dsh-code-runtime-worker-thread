import { expect, test } from "bun:test"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const workflow = Bun.YAML.parse(readFileSync(join(import.meta.dirname, ".github/workflows/publish.yml"), "utf8")) as any
const check = workflow.jobs.publish.steps.find((step: any) => step.name === "Refuse to republish an existing version").run

for (const [label, response, status, version, expectedTag, event = "workflow_dispatch", ref = "main"] of [
  ["absent prerelease", '{"error":{"code":"E404"}}', 1, "0.1.2-rc.1", "next"],
  ["absent stable", '{"error":{"code":"E404"}}', 1, "0.1.2", "latest"],
  ["already published", '"0.1.2"', 0, "0.1.2", null],
  ["auth failure", '{"error":{"code":"E401"}}', 1, "0.1.2", null],
  ["network failure", '{"error":{"code":"ETIMEDOUT"}}', 1, "0.1.2", null],
  ["matching release tag", '{"error":{"code":"E404"}}', 1, "0.1.2-nyssance.1", "next", "release", "v0.1.2-nyssance.1"],
  ["mismatched release tag", '{"error":{"code":"E404"}}', 1, "0.1.2-nyssance.1", null, "release", "v0.1.2"],
  ["invalid response", "", 1, "0.1.2", null],
] as const) {
  test(`release preflight: ${label}`, () => {
    const root = mkdtempSync(join(tmpdir(), "dsh-release-test-"))
    try {
      mkdirSync(join(root, "bin"))
      writeFileSync(join(root, "response"), response)
      writeFileSync(join(root, "manifest"), JSON.stringify({ name: "@nyssance/dsh-code-runtime-worker-thread", version }))
      writeFileSync(join(root, "env"), "")
      for (const [name, script] of Object.entries({
        npm: `#!/bin/sh\ncat "$FIXTURE/response"\nexit ${status}\n`,
        tar: '#!/bin/sh\ncat "$FIXTURE/manifest"\n',
      })) {
        writeFileSync(join(root, "bin", name), script)
        chmodSync(join(root, "bin", name), 0o755)
      }
      const result = Bun.spawnSync(["bash", "-c", check], { env: {
        ...process.env, PATH: `${root}/bin:${process.env.PATH}`, FIXTURE: root,
        GITHUB_EVENT_NAME: event, GITHUB_REF_NAME: ref, RUNNER_TEMP: root, GITHUB_ENV: join(root, "env"), PACKAGE_TARBALL: "./dist/fixture.tgz",
      } })
      expect(result.exitCode === 0).toBe(expectedTag !== null)
      expect(readFileSync(join(root, "env"), "utf8")).toBe(expectedTag ? `NPM_DIST_TAG=${expectedTag}\n` : "")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
}

test("dispatch version stays one literal argument and cannot run shell substitutions", () => {
  const root = mkdtempSync(join(tmpdir(), "dsh-dispatch-test-"))
  try {
    mkdirSync(join(root, "bin"))
    writeFileSync(join(root, "env"), "")
    writeFileSync(join(root, "bin/bun"), '#!/bin/sh\nprintf "%s\\n" "$#" "$1" "$2" > "$FIXTURE/args"\nexit 1\n')
    chmodSync(join(root, "bin/bun"), 0o755)
    const input = '1.2.3;$(touch "$FIXTURE/injected")';
    const build = workflow.jobs.publish.steps.find((step: any) => step.name === "Build").run
    const result = Bun.spawnSync(["bash", "-c", build], { env: {
      ...process.env, PATH: `${root}/bin:${process.env.PATH}`, FIXTURE: root,
      UPSTREAM_VERSION_INPUT: input, GITHUB_ENV: join(root, "env"),
    } })
    expect(result.exitCode).not.toBe(0)
    expect(readFileSync(join(root, "args"), "utf8")).toBe(`2\nbuild.ts\n${input}\n`)
    expect(existsSync(join(root, "injected"))).toBe(false)
    expect(readFileSync(join(root, "env"), "utf8")).toBe("")
  } finally { rmSync(root, { recursive: true, force: true }) }
})
