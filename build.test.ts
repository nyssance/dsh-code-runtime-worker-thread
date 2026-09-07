import { afterEach, expect, test } from "bun:test"
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { tmpdir } from "node:os"
import { join } from "node:path"

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function fixture(options: { source?: string; name?: string; packFails?: boolean; fetchFails?: boolean; badIntegrity?: boolean; corruptPack?: boolean } = {}) {
  const root = mkdtempSync(join(tmpdir(), "dsh-build-test-"))
  roots.push(root)
  for (const dir of ["bin", "tmp", "dist/keep", ".work", "upstream/package/lib"]) mkdirSync(join(root, dir), { recursive: true })
  cpSync(join(import.meta.dirname, "build.ts"), join(root, "build.ts"))
  cpSync(join(import.meta.dirname, "version.ts"), join(root, "version.ts"))
  cpSync(join(import.meta.dirname, "artifact.ts"), join(root, "artifact.ts"))
  cpSync(join(import.meta.dirname, "runtime"), join(root, "runtime"), { recursive: true })
  cpSync(join(import.meta.dirname, "FORK_NOTES.md"), join(root, "FORK_NOTES.md"))
  writeFileSync(join(root, "upstream/package/README.md"), "Upstream README\n")
  writeFileSync(join(root, "FORK_REVISION"), "1\n")
  writeFileSync(join(root, "UPSTREAM_VERSION"), "0.1.2-rc.1\n")
  writeFileSync(join(root, "dist/keep/user.txt"), "preserve")
  writeFileSync(join(root, ".work/user.txt"), "preserve")
  const out = join(root, "dist/nyssance-dsh-code-runtime-worker-thread-0.1.2-rc.1.nyssance.1.tgz")
  writeFileSync(out, "previous good artifact")
  writeFileSync(join(root, "upstream/package/lib/index.js"), options.source ?? "import { stripTypeScriptTypes } from \"node:module\";\n\t\tawait Promise.all(runs.map((run) => run.finished));\n\t\t\tlet settled = false;\n\t\t\t\tthis.live.delete(live);\n\t\t\t\t\tconst result = terminalOverride;\n\t\t\t\t\tfinishResolve();\n\t\t\t\t\tresolve(result);\n\t\t\t\t});\n\t\t\tworker.on(\"exit\", (exitCode) => {\n\t\t\t\tfinished,\n\t\tsuper(ctx);\nconst eluTimer = setInterval(() => {}, ELU_POLL_INTERVAL_MS);\nexport const preserved = 42;\n")
  writeFileSync(join(root, "upstream/package/lib/worker.cjs"), "// worker unchanged\n")
  writeFileSync(join(root, "upstream/package/package.json"), JSON.stringify({
    name: options.name ?? "@deepseek-ai/dsh-code-runtime-worker-thread", version: "0.1.2-rc.1",
    exports: { "./worker": "./lib/worker.cjs" }, peerDependencies: { peer: "^1.0.0" },
    dependencies: { dep: "^2.0.0" }, publishConfig: { registry: "https://example.invalid" },
  }))
  expect(Bun.spawnSync(["tar", "-czf", join(root, "upstream.tgz"), "-C", join(root, "upstream"), "package"]).exitCode).toBe(0)
  const integrity = `sha512-${createHash("sha512").update(readFileSync(join(root, "upstream.tgz"))).digest("base64")}`
  writeFileSync(join(root, "metadata.json"), JSON.stringify([{ filename: "upstream.tgz", integrity: options.badIntegrity ? "wrong" : integrity }]))
  const scripts = {
    npm: `#!/bin/sh\nset -eu\nprintf '%s\\n' "$@" > "$FIXTURE/npm-args"\n${options.fetchFails ? "exit 1" : 'cp "$FIXTURE/upstream.tgz" upstream.tgz\ncat "$FIXTURE/metadata.json"'}\n`,
    bun: `#!/bin/sh\nset -eu\n${options.corruptPack ? 'printf tampered > lib/worker.cjs\n' : ''}${options.packFails ? "exit 1" : 'while [ "$1" != "--filename" ]; do shift; done\nshift\ntar -czf "$1" -C .. package'}\n`,
  }
  for (const [name, script] of Object.entries(scripts)) {
    writeFileSync(join(root, "bin", name), script)
    chmodSync(join(root, "bin", name), 0o755)
  }
  const run = (args: string[] = []) => Bun.spawnSync([process.execPath, join(root, "build.ts"), ...args], {
    env: { ...process.env, PATH: `${join(root, "bin")}:${process.env.PATH}`, TMPDIR: join(root, "tmp"), FIXTURE: root },
  })
  const preserved = () => {
    expect(readFileSync(join(root, "dist/keep/user.txt"), "utf8")).toBe("preserve")
    expect(readFileSync(join(root, ".work/user.txt"), "utf8")).toBe("preserve")
    expect(readdirSync(join(root, "tmp"))).toEqual([])
    expect(readdirSync(join(root, "dist")).some(name => name.startsWith(".pack-"))).toBe(false)
  }
  return { root, out, run, preserved }
}

test("successful build applies only allowed changes and preserves unrelated files", () => {
  const f = fixture()
  const result = f.run()
  expect(result.stderr.toString()).toBe("")
  expect(result.exitCode).toBe(0)
  f.preserved()
  expect(readFileSync(join(f.root, "npm-args"), "utf8")).toContain("--ignore-scripts")
  const unpack = (file: string) => Bun.spawnSync(["tar", "-xOzf", f.out, `package/${file}`]).stdout.toString()
  const manifest = JSON.parse(unpack("package.json"))
  expect(manifest.name).toBe("@nyssance/dsh-code-runtime-worker-thread")
  expect(manifest.version).toBe("0.1.2-rc.1.nyssance.1")
  expect(manifest.upstream.version).toBe("0.1.2-rc.1")
  expect(manifest.dependencies).toEqual({ dep: "^2.0.0", amaro: "1.1.11" })
  expect(manifest.peerDependencies).toEqual({ peer: "^1.0.0" })
  expect(manifest.exports["./worker"]).toBe("./lib/worker.cjs")
  expect(manifest.exports["./capabilities"].default).toBe("./lib/capabilities.js")
  expect(unpack("README.md")).toContain("Bun 1.4.0 does not enforce")
  expect(unpack("README.md")).toEndWith("Upstream README\n")
  expect(manifest.publishConfig).toBeUndefined()
  expect(manifest.upstream.integrity).toMatch(/^sha512-/)
  expect(unpack("lib/worker.cjs")).toBe("// worker unchanged\n")
  expect(unpack("lib/index.js")).toContain('import * as nodeModule from "node:module";')
  expect(unpack("lib/index.js")).not.toContain("await import")
  expect(unpack("lib/index.js")).toEndWith("export const preserved = 42;\n")
  const entry = unpack("lib/index.js")
  const selection = entry.slice(entry.indexOf("let typeStripperBackend"), entry.indexOf("\n})();") + 7).replaceAll("import.meta.url", '"file:///fixture.js"')
  const select = new Function("nodeModule", "process", selection + "\nreturn { strip: stripTypeScriptTypes, backend: typeStripperBackend };")
  let nativeCalls = 0
  const native = { stripTypeScriptTypes: (text: string) => { nativeCalls++; return text } }
  const node = select(native, { versions: {} })
  expect(nativeCalls).toBe(0) // no eager parser work on Node import
  expect(node.strip("native")).toBe("native")
  expect(node.backend).toBe("native")
  const bun = { versions: { bun: "1.4.0" } }
  const fallback = { createRequire: () => () => ({ transformSync: (text: string) => {
    if (text === "bad") throw { message: "useful diagnostic" }
    return { code: "stripped" }
  } }) }
  const absent = select(fallback, bun)
  expect(absent.backend).toBe("amaro")
  expect(absent.strip("typed")).toBe("stripped")
  expect(() => absent.strip("bad")).toThrow("useful diagnostic")
  const stub = select({ ...fallback, stripTypeScriptTypes: () => { throw Object.assign(new Error("stub"), { code: "ERR_NOT_IMPLEMENTED" }) } }, bun)
  expect(stub.backend).toBe("amaro")
  expect(select(native, bun).backend).toBe("native")
  expect(() => select({ ...fallback, stripTypeScriptTypes: () => { throw new Error("native regression") } }, bun)).toThrow("native regression")
})

for (const [name, options] of Object.entries({
  "integrity mismatch": { badIntegrity: true },
  "packed worker corruption": { corruptPack: true },
  "download failure": { fetchFails: true },
  "upstream source drift": { source: "export const changed = true;\n" },
  "upstream lifecycle drift": { source: 'import { stripTypeScriptTypes } from "node:module";\nexport const changed = true;\n' },
  "upstream manifest mismatch": { name: "unexpected" },
  "pack failure": { packFails: true },
})) {
  test(`${name} preserves previous artifact and cleans temporary files`, () => {
    const f = fixture(options)
    expect(f.run().exitCode).not.toBe(0)
    expect(readFileSync(f.out, "utf8")).toBe("previous good artifact")
    f.preserved()
  })
}

test("invalid version is rejected before npm runs", () => {
  const f = fixture()
  expect(f.run(["1.2.3;touch injected"]).exitCode).not.toBe(0)
  expect(readdirSync(f.root)).not.toContain("npm-args")
  f.preserved()
})
