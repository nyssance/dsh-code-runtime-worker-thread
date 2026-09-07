#!/usr/bin/env bun
/** Repackage an exact upstream artifact with guarded Bun compatibility and lifecycle fixes.
 * Lifecycle scripts are disabled, untouched files are verified, and publication is CI-only.
 * Usage: bun build.ts [upstream-version]
 */
import { $ } from "bun"
import { forkVersion } from "./version"
import { snapshotFiles, assertFiles } from "./artifact"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

const UPSTREAM = "@deepseek-ai/dsh-code-runtime-worker-thread"
const FORK = "@nyssance/dsh-code-runtime-worker-thread"
const AMARO = "1.1.11"

const root = import.meta.dirname
const version = process.argv[2] ?? readFileSync(join(root, "UPSTREAM_VERSION"), "utf8").trim()
const publishedVersion = forkVersion(version, readFileSync(join(root, "FORK_REVISION"), "utf8").trim())

const work = mkdtempSync(join(tmpdir(), "dsh-worker-build-"))
try {
  const packed = JSON.parse(await $`npm pack ${UPSTREAM}@${version} --ignore-scripts --json`.cwd(work).text())
  if (!Array.isArray(packed) || packed.length !== 1) throw new Error("npm pack must produce exactly one tarball")
  const tarball = packed[0].filename
  if (typeof tarball !== "string" || !/^[a-zA-Z0-9_.-]+\.tgz$/.test(tarball)) throw new Error("npm pack returned an invalid filename")
  const integrity = `sha512-${createHash("sha512").update(readFileSync(join(work, tarball))).digest("base64")}`
  if (packed[0].integrity !== integrity) throw new Error("npm pack integrity does not match downloaded bytes")
  await $`tar -xzf ${tarball}`.cwd(work)
  const pkg = join(work, "package")
  const originalFiles = snapshotFiles(pkg)

  // Feature detection: feature-detect the Node API, fall back to amaro under Bun.
  const entry = join(pkg, "lib", "index.js")
  let source = readFileSync(entry, "utf8")
  const importLine = 'import { stripTypeScriptTypes } from "node:module";\n'
  if (source.split(importLine).length !== 2) throw new Error(`upstream entry changed: expected exactly one ${JSON.stringify(importLine)}`)
  source = source.replace(importLine, `// FORK (@nyssance): preserve synchronous Node loading; amaro handles Bun type stripping.
import * as nodeModule from "node:module";
import { runtimeCapabilities, warnUnsupportedLimits } from "./capabilities.js";
let typeStripperBackend = "native";
const stripTypeScriptTypes = (() => {
  if (typeof nodeModule.stripTypeScriptTypes === "function") {
    if (!process.versions.bun) return (source) => nodeModule.stripTypeScriptTypes(source);
    try {
      nodeModule.stripTypeScriptTypes("const value: number = 1;");
      return (source) => nodeModule.stripTypeScriptTypes(source);
    } catch (error) {
      if (error?.code !== "ERR_NOT_IMPLEMENTED") throw error;
    }
  }
  typeStripperBackend = "amaro";
  const { transformSync } = nodeModule.createRequire(import.meta.url)("amaro");
  return (source) => {
    try { return transformSync(source).code; }
    catch (error) {
      // amaro throws diagnostic records; upstream messageOf expects Error.
      throw error instanceof Error ? error : new Error(error && typeof error.message === "string" ? error.message : String(error));
    }
  };
})();
`)
  // Preserve quiescence even when settlement races teardown or termination fails.
  const replaceOnce = (before: string, after: string) => {
    if (source.split(before).length !== 2) throw new Error(`upstream lifecycle changed: expected one ${JSON.stringify(before)}`)
    source = source.replace(before, () => after)
  }
  replaceOnce("\t\t\tlet settled = false;", "\t\t\tlet settled = false;\n\t\t\tlet workerExited = false;\n\t\t\tlet terminatedAndDrained = false;\n\t\t\tlet cleanupFailed = false;\n\t\t\tlet retried = false;\n\t\t\tconst retryCleanup = () => {\n\t\t\t\tif (!cleanupFailed || retried) return;\n\t\t\t\tretried = true;\n\t\t\t\tPromise.resolve().then(() => worker.terminate()).catch(() => {});\n\t\t\t};")
  replaceOnce("\t\t\t\tthis.live.delete(live);\n", "")
  replaceOnce("\t\t\t\t\tconst result = terminalOverride", "\t\t\t\t\tterminatedAndDrained = true;\n\t\t\t\t\tconst result = terminalOverride")
  replaceOnce("\t\t\t\t\tfinishResolve();\n", "\t\t\t\t\tthis.live.delete(live);\n\t\t\t\t\tfinishResolve();\n")
  replaceOnce("\t\t\t\t\tresolve(result);\n\t\t\t\t});", `\t\t\t\t\tresolve(result);
\t\t\t\t}).catch((error) => {
\t\t\t\t\tcleanupFailed = true;
\t\t\t\t\tresolve(output.failure([...logs, ...strayLogs], {
\t\t\t\t\t\tkind: "worker-exit",
\t\t\t\t\t\tmessage: (terminatedAndDrained ? "result finalization failed: " : "worker cleanup failed: ") + messageOf(error)
\t\t\t\t\t}));
\t\t\t\t\tlet releasing = false;
\t\t\t\t\tconst release = async () => {
\t\t\t\t\t\tif (releasing) return;
\t\t\t\t\t\treleasing = true;
\t\t\t\t\t\tawait Promise.all([waitForPipeDrain(worker.stdout), waitForPipeDrain(worker.stderr)]);
\t\t\t\t\t\tthis.live.delete(live);
\t\t\t\t\t\tfinishResolve();
\t\t\t\t\t};
\t\t\t\t\tif (workerExited || worker.threadId === -1 || terminatedAndDrained) void release();
\t\t\t\t\telse {
\t\t\t\t\t\tworker.once("exit", release);
\t\t\t\t\t\tif (this.disposed) retryCleanup();
\t\t\t\t\t}
\t\t\t\t});`)
  replaceOnce('\t\t\tworker.on("exit", (exitCode) => {', '\t\t\tworker.on("exit", (exitCode) => {\n\t\t\t\tworkerExited = true;')
  replaceOnce("\t\t\t\tfinished,\n", "\t\t\t\tfinished,\n\t\t\t\tretryCleanup,\n")
  replaceOnce("\t\tawait Promise.all(runs.map((run) => run.finished));", "\t\tfor (const run of runs) run.retryCleanup();\n\t\tawait Promise.all(runs.map((run) => run.finished));")
  replaceOnce("\t\tsuper(ctx);\n", "\t\tsuper(ctx);\n\t\twarnUnsupportedLimits(typeStripperBackend);\n")
  replaceOnce("const eluTimer = setInterval(", "const eluTimer = runtimeCapabilities.computeMs ? setInterval(")
  replaceOnce("}, ELU_POLL_INTERVAL_MS);", "}, ELU_POLL_INTERVAL_MS) : undefined;")
  writeFileSync(entry, source)
  mkdirSync(join(pkg, "lib/types"), { recursive: true })
  writeFileSync(join(pkg, "lib/capabilities.js"), readFileSync(join(root, "runtime/capabilities.js")))
  writeFileSync(join(pkg, "lib/types/capabilities.d.ts"), readFileSync(join(root, "runtime/capabilities.d.ts")))
  const readme = join(pkg, "README.md")
  writeFileSync(readme, readFileSync(join(root, "FORK_NOTES.md"), "utf8") + "\n---\n\n" + readFileSync(readme, "utf8"))

  const manifestPath = join(pkg, "package.json")
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>
  if (manifest.name !== UPSTREAM || manifest.version !== version) throw new Error("upstream manifest mismatch")
  manifest.name = FORK
  manifest.version = publishedVersion
  manifest.description = `${String(manifest.description ?? "")} (fork: strips TypeScript types via amaro under Bun)`.trim()
  manifest.dependencies = { ...(manifest.dependencies as Record<string, string>), amaro: AMARO }
  manifest.upstream = { name: UPSTREAM, version, integrity, patch: "lib/index.js: amaro fallback with diagnostics; track cleanup through exit, report failures and retry once during teardown" }
  manifest.exports = { ...(manifest.exports as Record<string, unknown>), "./capabilities": {
    types: "./lib/types/capabilities.d.ts", default: "./lib/capabilities.js",
  } }
  if (Array.isArray(manifest.files)) manifest.files = [...manifest.files, "lib/capabilities.js", "lib/types/capabilities.d.ts"]
  manifest.repository = { type: "git", url: "https://github.com/nyssance/dsh-code-runtime-worker-thread.git" }
  delete manifest.publishConfig
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

  const patchedFiles = snapshotFiles(pkg)
  assertFiles(originalFiles, patchedFiles, new Set(["package.json", "lib/index.js", "README.md", "lib/capabilities.js", "lib/types/capabilities.d.ts"]))
  const dist = join(root, "dist")
  mkdirSync(dist, { recursive: true })
  const filename = `nyssance-dsh-code-runtime-worker-thread-${publishedVersion}.tgz`
  // Stage beside the destination so the final rename is atomic, including across volumes.
  const stage = mkdtempSync(join(dist, ".pack-"))
  const out = join(dist, filename)
  try {
    const pending = join(stage, filename)
    await $`bun pm pack --ignore-scripts --filename ${pending}`.cwd(pkg)
    if (!existsSync(pending)) throw new Error("bun pm pack produced no tarball")
    const verification = join(work, "verification")
    mkdirSync(verification)
    await $`tar -xzf ${pending} -C ${verification}`
    assertFiles(patchedFiles, snapshotFiles(join(verification, "package")))
    renameSync(pending, out)
  } finally {
    rmSync(stage, { recursive: true, force: true })
  }
  console.log(`${FORK}@${publishedVersion} ← ${UPSTREAM}@${version} (${integrity.slice(0, 24)}…)\n${out}`)

} finally {
  rmSync(work, { recursive: true, force: true })
}
