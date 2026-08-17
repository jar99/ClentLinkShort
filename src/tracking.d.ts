/** Tracking-parameter removal policy. */

/** Parameters removed on every host. */
export declare const TRACKING_PARAMS: RegExp;

/** Parameters that are only safe to remove on particular hosts. */
export declare const TRACKING_BY_HOST: ReadonlyArray<{ host: RegExp; params: RegExp }>;

/** Remove known tracking parameters in place; returns the names removed. */
/** Path rewrites for sites that bury tracking in the path itself. */
export declare const PATH_BY_HOST: ReadonlyArray<{
  host: RegExp; match: RegExp; rewrite: string; label: string;
}>;

export declare function stripTracking(url: URL): string[];
