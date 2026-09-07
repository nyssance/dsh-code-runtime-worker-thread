/** Support declaration for tested adapters, not a security or isolation guarantee. */
export declare const runtimeCapabilities: Readonly<{
  computeMs: boolean;
  maxOldGenerationSizeMb: boolean;
}>;
export type EnforcedLimit = keyof typeof runtimeCapabilities;
/** Throws if a required limit is unsupported, or the list is empty/invalid. No workers are spawned. */
export declare function assertEnforcedLimits(required?: readonly EnforcedLimit[]): void;
/** @internal */
export declare function warnUnsupportedLimits(backend: "native" | "amaro"): void;
