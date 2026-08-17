/** A dependency-free QR encoder: byte mode, EC level M, versions 1-11. */

/** Byte capacity of a version (1..11) at error correction level M. */
export declare function qrCapacity(version: number): number;

/**
 * Build the QR matrix for a string: row-major 0/1 modules, or null when the
 * text exceeds version 11's 251 bytes.
 */
export declare function qrMatrix(
  text: string,
): { size: number; modules: Uint8Array } | null;
