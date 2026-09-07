# Fork runtime capabilities

This package enables TypeScript execution on Bun and changes worker teardown to retain
workers until exit and pipe drainage. It is a fork of the upstream documentation below.

**Bun 1.4.0 does not enforce `computeMs` or `maxOldGenerationSizeMb` in this adapter.**
Both hosts default to 600 seconds of wall time. Node additionally enforces a 60-second
compute budget; on Bun, wall time is the only execution-time budget. Lower `maxWallMs`
deliberately for Bun workloads. Use Node when those configured compute/heap caps must
be enforced. This is about honoring configured limits, not isolation: **neither backend
is a security boundary for hostile code**. Spawned OS processes and already-running
host bindings require separate lifecycle management.

The additive capability API is pure and starts no workers:

```js
import {
  runtimeCapabilities,
  assertEnforcedLimits,
} from '@nyssance/dsh-code-runtime-worker-thread/capabilities'

// Optional: fail before mounting when both limits are required.
assertEnforcedLimits()
// Or require just one supported limit:
assertEnforcedLimits(['computeMs'])
```

Capability flags are conservative on Bun, tested with 1.4.0, and remain false until
support is revalidated. A warning at the first Bun runtime construction per module
instance names the missing limits and selected type stripper. The known unsupported
busy-time polling is skipped; the wall timer remains active.

A termination failure returns a `worker-exit` error. The worker is retained until exit
and pipe drainage, with one additional termination attempt during teardown. Teardown
may remain pending if the worker never exits; a completed run result alone does not
prove termination succeeded. Neither a cleanup failure nor a finalizer failure is
silently treated as successful execution.

New fork revisions derive `.nyssance.N` prerelease versions from `UPSTREAM_VERSION` and
`FORK_REVISION` and target the `next` tag. Install a published exact fork version or
explicitly choose `@next`; ordinary stable ranges do not select these prereleases.
Historical tags are separate. The manifest retains upstream name, version and integrity.
Node uses native type stripping without an import-time parse; fallback hosts load pinned
amaro synchronously, which adds dependency install footprint. Inherited dependency
ranges remain unlocked; this is not a hermetic consumer dependency graph.
