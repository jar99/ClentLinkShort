/** Bounded DEFLATE over the browser-native compression streams. */

/** Whether this runtime can compress. Without it links are simply longer. */
export declare const canCompress: boolean;

/** Upper bound on decompressed size; hostile streams abort past it. */
export declare const MAX_INFLATED: 16384;

/** Compress; resolves null where the runtime cannot DEFLATE. */
export declare function deflate(bytes: Uint8Array): Promise<Uint8Array | null>;

/** Decompress. @throws {ClentError} on corrupt input or output past MAX_INFLATED. */
export declare function inflate(bytes: Uint8Array): Promise<Uint8Array>;
