import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
if (!process.argv[2]) throw new Error('Usage: node|bun lifecycle-smoke.mjs /path/to/unpacked/package');
const packageRoot = resolve(process.argv[2]);
const require = createRequire(resolve(packageRoot, 'package.json'));
const { Context } = await import(pathToFileURL(require.resolve('@deepseek-ai/cordis')).href);
const probe = resolve(packageRoot, `lib/lifecycle-probe-${process.pid}.js`);
const watchdog = setTimeout(() => { console.error('Lifecycle smoke exceeded 10 seconds'); process.exit(1); }, 10000);
const tick = () => new Promise(resolve => setImmediate(resolve));
let worker, mode = 'staged';
const unhandled = [];
const onUnhandled = error => unhandled.push(error);
process.on('unhandledRejection', onUnhandled);
class FakeWorker extends EventEmitter {
  stdout = new PassThrough(); stderr = new PassThrough(); threadId = 1; attempts = 0;
  performance = { eventLoopUtilization: () => ({ active: 0 }) };
  mode = mode;
  constructor() { super(); worker = this; }
  exit() { this.threadId = -1; this.emit('exit', 0); }
  drain() { this.stdout.end(); this.stderr.end(); }
  terminate() {
    this.attempts++;
    if (this.mode === 'exit-before-reject') { this.exit(); this.drain(); return Promise.reject(new Error('termination rejected after exit')); }
    if (this.mode === 'reject-always' || (this.mode === 'reject-once' && this.attempts === 1)) return Promise.reject(new Error('termination rejected'));
    return new Promise(resolve => { this.releaseTerminate = () => { this.exit(); resolve(0); }; });
  }
}
globalThis.ProbeWorker = FakeWorker;
let source = readFileSync(resolve(packageRoot, 'lib/index.js'), 'utf8');
assert.ok(source.includes('import { Worker } from "node:worker_threads";'));
source = source.replace('import { Worker } from "node:worker_threads";', 'const Worker = globalThis.ProbeWorker;');
source = source.replace('const result = terminalOverride', 'if (globalThis.ProbeFinalize) throw new Error("injected finalizer failure");\nconst result = terminalOverride');
writeFileSync(probe, source);
try {
  const { default: Runtime } = await import(pathToFileURL(probe).href);
  const create = async () => {
    const ctx = new Context();
    await ctx.plugin(Runtime, { computeMs: 100, maxWallMs: 1000, maxOutputBytes: 1024, maxOldGenerationSizeMb: 64 });
    return [ctx, ctx.codeRuntime];
  };
  for (const first of ['pipes', 'exit']) {
    mode = 'staged';
    const [ctx, runtime] = await create();
    const pending = runtime.run({ program: 'return 1;', bindings: [] });
    worker.emit('message', { type: 'done' });
    let disposed = false;
    const disposal = runtime.teardown().then(() => { disposed = true; });
    await tick();
    assert.equal(disposed, false);
    assert.equal(runtime.live.size, 1);
    first === 'pipes' ? worker.drain() : worker.releaseTerminate();
    await tick();
    assert.equal(disposed, false, 'teardown must wait for BOTH exit and pipe drainage');
    first === 'pipes' ? worker.releaseTerminate() : worker.drain();
    await pending; await disposal;
    assert.equal(runtime.live.size, 0);
    await ctx.fiber.dispose();
    console.log('PASS lifecycle both-stage ordering', first);
  }
  for (const failure of ['reject-once', 'reject-always', 'exit-before-reject']) {
    mode = failure;
    const [ctx, runtime] = await create();
    const pending = runtime.run({ program: 'return 1;', bindings: [] });
    const failedWorker = worker;
    failure === 'reject-always' ? worker.emit('error', new Error('worker emitted error')) : worker.emit('message', { type: 'done' });
    let disposed = false, disposal;
    // Cover teardown starting BEFORE the initial termination rejects, as well as after.
    if (failure === 'reject-always') disposal = runtime.teardown().then(() => { disposed = true; });
    const result = await pending;
    assert.equal(result.error.kind, 'worker-exit');
    assert.match(result.error.message, /worker cleanup failed:.*termination rejected/s);
    if (failure !== 'exit-before-reject') {
      assert.equal(runtime.live.size, 1);
      assert.equal(disposed, false);
    }
    if (failure === 'reject-once') {
      mode = 'staged';
      const fresh = runtime.run({ program: 'return 2;', bindings: [] });
      const freshWorker = worker;
      freshWorker.emit('message', { type: 'done' }); await tick();
      freshWorker.releaseTerminate(); freshWorker.drain();
      assert.equal((await fresh).error, undefined, 'one cleanup failure must not disable independent runs');
    }
    if (!disposal) disposal = runtime.teardown().then(() => { disposed = true; });
    await tick(); await tick();
    if (failure === 'reject-once') {
      assert.equal(failedWorker.attempts, 2, 'one teardown retry');
      assert.equal(disposed, false);
      failedWorker.releaseTerminate();
      await tick(); assert.equal(disposed, false, 'exit without drain is insufficient');
      failedWorker.drain();
    } else if (failure === 'reject-always') {
      assert.equal(failedWorker.attempts, 2, 'retry is bounded, even when it rejects');
      assert.equal(disposed, false, 'a still-live worker must keep teardown pending');
      failedWorker.drain(); await tick(); assert.equal(disposed, false);
      failedWorker.exit(); // external eventual exit releases retention
    }
    await disposal;
    assert.equal(runtime.live.size, 0);
    await ctx.fiber.dispose();
    console.log('PASS lifecycle cleanup failure', failure);
  }
  mode = 'staged'; globalThis.ProbeFinalize = true;
  const [ctx, runtime] = await create();
  const pending = runtime.run({ program: 'return 1;', bindings: [] });
  worker.emit('message', { type: 'done' }); await tick();
  worker.releaseTerminate(); worker.drain();
  const result = await pending;
  assert.equal(result.error.kind, 'worker-exit');
  assert.match(result.error.message, /result finalization failed:.*injected finalizer failure/s);
  await runtime.teardown(); assert.equal(runtime.live.size, 0); await ctx.fiber.dispose();
  console.log('PASS lifecycle finalizer failure after termination');
  await tick(); assert.deepEqual(unhandled, []);
  console.log('SMOKE_COMPLETE lifecycle');
} finally {
  unlinkSync(probe); delete globalThis.ProbeWorker; delete globalThis.ProbeFinalize;
  process.removeListener('unhandledRejection', onUnhandled); clearTimeout(watchdog);
}
