/** Message lookup for the page. */
export declare const CATALOGUES: Record<string, Record<string, string>>;
export declare function choose(preferred?: readonly string[]): string;
export declare function setLanguage(code: string): string;
export declare function language(): string;
export declare function has(key: string): boolean;
export declare function t(key: string, values?: Record<string, string | number>): string;
export declare function translate(root?: ParentNode): void;
