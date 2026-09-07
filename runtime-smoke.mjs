import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
if (!process.argv[2]) throw new Error('Usage: node|bun runtime-smoke.mjs /path/to/unpacked/package');
const packageRoot = resolve(process.argv[2]);
const require = createRequire(resolve(packageRoot, 'package.json'));
const { Context } = await import(pathToFileURL(require.resolve('@deepseek-ai/cordis')).href);
const { default: Runtime } = await import(pathToFileURL(resolve(packageRoot, 'lib/index.js')).href);
const watchdog = setTimeout(() => { console.error('Worker smoke test exceeded 20 seconds'); process.exit(1); }, 20_000);
const ctx = new Context();
await ctx.plugin(Runtime, {computeMs:100,maxWallMs:1000,maxOutputBytes:1024,maxOldGenerationSizeMb:64});
const runtime = ctx.codeRuntime;
try {
 for (const [label, program, expected, bindings] of [
  ['typescript','const x: number = 42; console.log("ok"); return x;', {value:42,logs:['ok']}],
  ['binding','return await api.add({x:2});',{value:3,logs:[]},[{global:'api',functions:{add:({x})=>x+1}}]],
  ['environment','return Object.keys(process.env);',{value:[],logs:[]}],
  ['raw-stdout','process.stdout.write("raw");',{logs:['raw']}],
  ['global-console','globalThis.console.log("leak");',{logs:['leak\n']}],
  ['worker-exit','process.exit(3);','worker-exit'],
  ['exception','throw new Error("boom");','exception'],
  ['syntax','const x: = ;','exception'],
  ['enum','enum X { A }; return X.A;','exception'],
  ['invalid-output','return () => 1;','invalid-output'],
  ['output-limit','return "x".repeat(2048);','output-limit'],
  ['compute-timeout','while(true){}','timeout'],
  ['wall-timeout','await new Promise(() => {});','timeout'],
 ]) {
  const start = performance.now();
  const result = await runtime.run({program,bindings:bindings??[]});
  if(typeof expected==='string') assert.equal(result.error?.kind,expected,label); else assert.deepEqual(result,expected,label);
  if (label === 'syntax' || label === 'enum') assert.notEqual(result.error.message, '[object Object]', label);
  if (label === 'compute-timeout') {
   const expected = process.versions.bun ? /wall-clock ceiling/ : /compute budget exhausted/;
   assert.match(result.error.message, expected);
   if (process.versions.bun) console.log('LIMITATION: Bun worker busy-time API is unavailable; wall-clock backstop only');
  }
  assert.ok(performance.now() - start < 5000, `${label} must finish within 5s`);
  console.log('PASS',label);
 }
 const signal=AbortSignal.abort('test');
 assert.equal((await runtime.run({program:'return 1;',bindings:[],signal})).error?.kind,'abort');
 console.log('PASS pre-abort');
 const controller=new AbortController();
 const abortStart=performance.now();
 const pending=runtime.run({program:'while(true){}',bindings:[],signal:controller.signal});
 setTimeout(()=>controller.abort('test'),20);
 assert.equal((await pending).error?.kind,'abort');assert.ok(performance.now()-abortStart<2000,'active abort must terminate within 2s');console.log('PASS active-abort');
 const running=runtime.run({program:'await new Promise(() => {});',bindings:[]});
 await ctx.fiber.dispose();
 assert.equal((await running).error?.kind,'abort');console.log('PASS dispose');
 await assert.rejects(runtime.run({program:'return 1;',bindings:[]}));console.log('PASS disposed rejection');
 console.log('SMOKE_COMPLETE runtime');
} finally { await ctx.fiber.dispose(); clearTimeout(watchdog); }
