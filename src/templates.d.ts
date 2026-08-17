/** Known URL shapes. Append-only: an index is a wire encoding. */
import type { BitWriter, BitReader } from "./bits.js";

export interface Charset {
  chars: string;
  bits: number;
}

export declare const CHARSETS: Readonly<Record<string, Charset>>;

export interface Template {
  pattern: string;
  slots: string[];
}

export declare const TEMPLATES: ReadonlyArray<Template>;

/** Longest slot value a template will hold; the length field is 6 bits. */
export declare const MAX_SLOT: 63;

export interface CompiledTemplate extends Template {
  index: number;
  literals: string[];
  host: string;
  match: RegExp;
}

export declare const COMPILED: CompiledTemplate[];
export declare const BY_HOST: ReadonlyMap<string, CompiledTemplate[]>;

/** Wildcard-host templates, keyed by the literal tail after the host slot. */
export declare const BY_HOST_SUFFIX: ReadonlyMap<string, CompiledTemplate[]>;
export declare const CHARSET_INDEX: Record<string, { set: Charset; index: Map<string, number> }>;

export interface TemplateMatch {
  index: number;
  values: string[];
  bits: number;
}

/** Try to express a URL as one of the templates; null unless it round-trips. */
export declare function asTemplate(url: URL): TemplateMatch | null;

/** Write index and slots after a caller-written header; returns the payload. */
export declare function writeTemplate(w: BitWriter, template: { index: number; values: string[] }): string;

/** Read a template payload (after the header) back into its URL. @throws {ClentError} */
export declare function readTemplate(reader: BitReader): string;

/** Rebuild a URL from a template index and its slot values. @throws {ClentError} */
export declare function fill(index: number, values: string[]): string;
