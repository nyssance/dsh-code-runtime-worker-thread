/** Conservative support declaration for the tested Node/Bun worker adapters, not isolation. */
const isBun = Boolean(process.versions.bun);
export const runtimeCapabilities = Object.freeze({
  computeMs: !isBun,
  maxOldGenerationSizeMb: !isBun,
});

/** Pure, opt-in composition check; never constructs a runtime or a worker. */
export function assertEnforcedLimits(required = ["computeMs", "maxOldGenerationSizeMb"]) {
  if (!Array.isArray(required) || required.length === 0 || required.some(name => !Object.hasOwn(runtimeCapabilities, name))) {
    throw new TypeError("required must be a nonempty array of computeMs and/or maxOldGenerationSizeMb");
  }
  const missing = required.filter(name => !runtimeCapabilities[name]);
  if (missing.length) throw new Error(`This host does not enforce: ${missing.join(", ")}. Use Node when these configured limits are required; neither backend is a security boundary.`);
}

let warned = false;
/** @internal Called at runtime construction, after synchronous stripper selection. */
export function warnUnsupportedLimits(backend) {
  if (!isBun || warned) return;
  warned = true;
  console.warn("@nyssance/dsh-code-runtime-worker-thread: Bun does not enforce computeMs or maxOldGenerationSizeMb; maxWallMs is enforced by this package on both hosts. See @nyssance/dsh-code-runtime-worker-thread/capabilities for strict preflight. Type stripping: " + backend + ".");
}
