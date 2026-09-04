# @nyssance/dsh-code-runtime-worker-thread

A fork of [`@deepseek-ai/dsh-code-runtime-worker-thread`](https://www.npmjs.com/package/@deepseek-ai/dsh-code-runtime-worker-thread)
(DeepSeek Harness's Code Mode worker) that runs under **Bun**.

Upstream strips TypeScript types with `node:module`'s `stripTypeScriptTypes`, which Bun
(1.4 still) does not implement — and Bun rejects a named import of a missing export at
link time — so every `run_code` program fails before the worker starts. Upstream accepts
no external pull requests (its CONTRIBUTING.md) and has issues disabled, hence this fork.

**What differs:** exactly one thing. The published upstream artifact is taken as-is and
`lib/index.js` probes the API through the module namespace, falling back to
[`amaro`](https://www.npmjs.com/package/amaro) — the library Node itself vendors for that
call, same offset-preserving output. Node behaviour is unchanged. The package.json carries
`upstream` provenance (name / version / integrity) so the base can be verified.

Versions track upstream one-to-one: `@nyssance/dsh-code-runtime-worker-thread@X` is
`@deepseek-ai/dsh-code-runtime-worker-thread@X` plus the fallback.

## Use

```bash
bun add @nyssance/dsh-code-runtime-worker-thread@<upstream version>
```

Import it where you would import the upstream package; the `./worker` export and the
peer dependencies are identical.

## Release

`UPSTREAM_VERSION` names the upstream release. Publishing is CI-only
(`.github/workflows/publish.yml`, run manually or on a GitHub Release): it rebuilds from the
upstream artifact, refuses to republish an existing version, and publishes with provenance.

```bash
bun build.ts            # local build for inspection → dist/*.tgz
```

Delete this fork the day upstream ships the fallback.

## License

The repackaged code is upstream's, under upstream's license (see `LICENSE`, shipped
unchanged inside the tarball). The build script is MIT.
