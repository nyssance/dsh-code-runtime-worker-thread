import { readFileSync } from "node:fs"
import { join } from "node:path"

/** Derive a collision-free prerelease revision without changing upstream provenance. */
export function forkVersion(upstream: string, revision: string): string {
  const numeric = "(?:0|[1-9][0-9]*)"
  const identifier = `(?:${numeric}|[0-9]*[A-Za-z-][0-9A-Za-z-]*)`
  const exactVersion = new RegExp(`^${numeric}\\.${numeric}\\.${numeric}(?:-${identifier}(?:\\.${identifier})*)?$`)
  if (!exactVersion.test(upstream)) throw new Error(`upstream version looks wrong: ${upstream}`)
  if (!/^[1-9][0-9]*$/.test(revision) || !Number.isSafeInteger(Number(revision))) {
    throw new Error(`fork revision must be a positive safe integer: ${revision}`)
  }
  return `${upstream}${upstream.includes("-") ? "." : "-"}nyssance.${revision}`
}

if (import.meta.main) {
  const root = import.meta.dirname
  console.log(forkVersion(
    process.argv[2] ?? readFileSync(join(root, "UPSTREAM_VERSION"), "utf8").trim(),
    readFileSync(join(root, "FORK_REVISION"), "utf8").trim(),
  ))
}
