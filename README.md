# @nyssance/dsh-code-runtime-worker-thread

A focused fork of `@deepseek-ai/dsh-code-runtime-worker-thread` that enables Bun
TypeScript execution, preserves synchronous Node loading, and retains workers through
termination and pipe drainage. It repackages the exact upstream npm artifact; it does
not replace the worker protocol or introduce a Node subprocess backend.

**Bun 1.4.0 does not enforce `computeMs` or `maxOldGenerationSizeMb` in this adapter.**
Both hosts default to a 600-second wall limit. Node additionally enforces a 60-second
compute budget; on Bun, wall time is the only execution-time budget. Choose a deliberate
`maxWallMs` for Bun workloads. Use Node when those configured compute/heap caps are
required. Neither backend is a security boundary for hostile code.

## Use and capability checks

Install a **published** exact fork version or explicitly choose `@next`:

```bash
bun add @nyssance/dsh-code-runtime-worker-thread@<fork-version>
```

```js
import {
  runtimeCapabilities,
  assertEnforcedLimits,
} from '@nyssance/dsh-code-runtime-worker-thread/capabilities'

// Optional composition-time check, before mounting the runtime:
assertEnforcedLimits()                  // requires both limits
assertEnforcedLimits(['computeMs'])     // requires only this limit
```

The pure preflight starts no workers. Unknown names and empty requirement lists are
rejected. The capability object is frozen, with one boolean for each named limit.
Bun flags are conservative, tested on 1.4.0, and remain false until support is
revalidated. The first Bun runtime construction per module instance warns once about
the limits and the selected type-stripper. Known unsupported ELU polling is skipped;
wall-clock enforcement stays active. Existing `./worker` exports and peers are retained.

## Runtime changes and boundaries

- Detect native type stripping through the module namespace. Node uses it without
  parsing at import time. A present Bun shim is probed; only a missing API or
  `ERR_NOT_IMPLEMENTED` selects synchronous, pinned `amaro@1.1.11`. Diagnostic records
  become `Error` objects with useful messages. No top-level await breaks `require()`.
- A settled worker remains tracked until termination and pipe drainage complete.
  Cleanup failure resolves the run with `worker-exit`, retains the worker, and permits
  one additional termination attempt during teardown. Teardown can remain pending if
  the worker never exits. A run result alone does not prove termination succeeded.
- Finalization failures are reported after confirmed termination. No worker protocol,
  binding namespace, output encoding, or upstream configuration shape is redesigned.

Spawned OS processes and already-running host bindings need separate lifecycle
management. Node's heap limit is a worker V8 heap control, not a process-wide RSS cap.
In a bounded local experiment with a 64 MiB worker setting, Node returned `worker-exit`
for heap exhaustion; Bun returned after allocating 32 ordinary arrays of 1,048,576
slots. Both host processes survived under an independent 800 MiB RSS cutoff and
8-second deadline. This establishes lack of configured heap enforcement on tested Bun,
not absence of all system memory bounds.

## Build, verification and release

`UPSTREAM_VERSION` selects an exact upstream release; `FORK_REVISION` is a positive
integer. A stable `1.2.3` becomes `1.2.3-nyssance.N`; `1.2.3-rc.1` becomes
`1.2.3-rc.1.nyssance.N`. New revisions target `next`. Ordinary stable ranges do not
select these SemVer prereleases. Legacy versions/tags are separate and are not
rewritten by local builds. A generated local archive is not a published release.

```bash
bun test
bun build.ts                    # dist/*.tgz; no publication
bun version.ts                  # derived fork version
# After unpacking an archive and installing its dependencies:
node runtime-smoke.mjs /path/to/package
bun runtime-smoke.mjs /path/to/package
node lifecycle-smoke.mjs /path/to/package
bun lifecycle-smoke.mjs /path/to/package
node capabilities-smoke.mjs /path/to/package
bun capabilities-smoke.mjs /path/to/package
```

Builds disable lifecycle scripts, isolate temporary directories, and replace only the
requested archive after packing and content verification succeed. They retain unrelated
`dist/` files and a prior good archive on failure. The build checks npm's reported
integrity against the downloaded bytes, and allows changes only to the manifest,
entry, README and additive capability files; the worker and LICENSE are unchanged.
The packed README includes [the fork notice](FORK_NOTES.md) before upstream docs.

The manifest records upstream name/version/integrity. This identifies the downloaded
bytes; it is not an independently pinned trust anchor. Upstream dependency ranges stay
unlocked, so the consumer graph is not hermetic. amaro adds dependency install footprint
also for Node consumers, although Node does not load it. Same-machine archive hashes
can be compared with the tested toolchain; cross-platform byte determinism is not promised.

The publish workflow runs offline regressions and actual packed-worker checks under
Node 24 and Bun 1.4.0, checks completion sentinels, rejects existing versions, and stops
on registry errors other than E404. Release tags must be `v<fork-version>`. Publication
uses npm trusted publishing; local build/test commands never publish. Linux CI execution
and publishing must be verified separately from local macOS checks.

## License

The upstream LICENSE is shipped unchanged. Fork tooling and additions are MIT.
