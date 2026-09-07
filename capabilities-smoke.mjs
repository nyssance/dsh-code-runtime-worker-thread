import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
if (!process.argv[2]) throw new Error('Usage: node|bun capabilities-smoke.mjs /path/to/unpacked/package');
const require = createRequire(resolve(process.argv[2], 'package.json'));
const name = '@nyssance/dsh-code-runtime-worker-thread';
const { runtimeCapabilities, assertEnforcedLimits } = await import(pathToFileURL(require.resolve(`${name}/capabilities`)).href);
assert.equal(Object.isFrozen(runtimeCapabilities), true);
const isBun = Boolean(process.versions.bun);
assert.deepEqual(runtimeCapabilities, { computeMs: !isBun, maxOldGenerationSizeMb: !isBun });
for (const required of [undefined, ['computeMs'], ['maxOldGenerationSizeMb']]) {
  isBun ? assert.throws(() => assertEnforcedLimits(required), /does not enforce/) : assertEnforcedLimits(required);
}
for (const invalid of [[], ['unknown'], null, 'computeMs']) assert.throws(() => assertEnforcedLimits(invalid), TypeError);
// Synchronous package entry loads without ERR_REQUIRE_ASYNC_MODULE.
const { default: Runtime } = require(name);
assert.match(require.resolve(`${name}/worker`), /worker\.cjs$/);
if (!isBun) assert.equal(Object.keys(require.cache).some(path => path.includes('/amaro/')), false, 'Node must not load amaro');
const { Context } = await import(pathToFileURL(require.resolve('@deepseek-ai/cordis')).href);
const warnings = [];
const originalWarn = console.warn;
console.warn = (...args) => warnings.push(args.join(' '));
try {
  for (let i = 0; i < 2; i++) { const ctx = new Context(); await ctx.plugin(Runtime); await ctx.fiber.dispose(); }
} finally { console.warn = originalWarn; }
assert.equal(warnings.length, isBun ? 1 : 0, 'one Bun warning per module across constructions');
if (isBun) {
  assert.match(warnings[0], /computeMs.*maxOldGenerationSizeMb/);
  assert.match(warnings[0], /\/capabilities/);
  assert.match(warnings[0], /Type stripping: amaro\./);
}
console.log('PASS capabilities, strict preflight, exports, synchronous require and warnings');
console.log('SMOKE_COMPLETE capabilities');
