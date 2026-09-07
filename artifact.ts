import { createHash } from "node:crypto"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

export function snapshotFiles(root: string): Map<string, string> {
  const files = new Map<string, string>()
  const visit = (relative: string) => {
    for (const item of readdirSync(join(root, relative), { withFileTypes: true })) {
      const path = relative ? `${relative}/${item.name}` : item.name
      if (item.isDirectory()) visit(path)
      else if (item.isFile()) files.set(path, createHash("sha256").update(readFileSync(join(root, path))).digest("hex"))
      else throw new Error(`unsupported upstream archive entry: ${path}`)
    }
  }
  visit("")
  return files
}

export function assertFiles(before: Map<string, string>, after: Map<string, string>, allowedChanges = new Set<string>()) {
  for (const name of before.keys()) if (!after.has(name)) throw new Error(`artifact lost file: ${name}`)
  for (const [name, hash] of after) {
    if (before.get(name) !== hash && !allowedChanges.has(name)) throw new Error(`unexpected artifact change: ${name}`)
  }
}
