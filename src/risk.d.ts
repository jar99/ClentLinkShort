/** Phishing-shape assessment for the redirector. */

export declare const RISK_NONE: 0;
export declare const RISK_NOTE: 1;
export declare const RISK_BLOCK: 2;

export type RiskLevel = 0 | 1 | 2;

export interface RiskReason {
  code: string;
  level: RiskLevel;
  /** English, always present, so this module works without the page. */
  message: string;
  /** Placeholders for a translation of `code`, when it takes any. */
  values?: Record<string, string>;
}

/** Look for the shapes phishing links take. Never a verdict on a site. */
export declare function assess(url: URL): { level: RiskLevel; reasons: RiskReason[] };
