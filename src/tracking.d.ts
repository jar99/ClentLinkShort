/** Tracking-parameter removal policy. */

/** Parameters removed on every host. */
export declare const TRACKING_PARAMS: RegExp;

/** Parameters that are only safe to remove on particular hosts. */
export declare const TRACKING_BY_HOST: ReadonlyArray<{ host: RegExp; params: RegExp }>;

/** Remove known tracking parameters in place; returns the names removed. */
export declare function stripTracking(url: URL): string[];
