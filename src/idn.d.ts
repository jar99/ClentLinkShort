/** Internationalised names: telling a real one from a homograph. */

/** Decode one punycode label (without its "xn--" prefix); null if invalid. */
export declare function decodePunycode(input: string): string | null;

/** Does this decoded label mix scripts in a way no language does? */
export declare function mixesScripts(text: string): boolean;

/** Is this hostname deceptive rather than merely international? */
export declare function deceptiveIdn(hostname: string): boolean;
