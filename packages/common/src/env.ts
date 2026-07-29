/**
 * Fail-fast environment variable validation.
 *
 * Each service calls `requireEnv(spec)` once at the top of its entrypoint,
 * before starting its HTTP server. All violations are collected and thrown
 * together as a single `EnvValidationError` so a misconfigured deploy
 * reports everything wrong in one shot instead of dying on the first
 * `undefined` it happens to touch at runtime.
 */

export type EnvVarType = 'string' | 'url' | 'number' | 'stellarSecret' | 'stellarContract';

export interface EnvVarSpec {
  /** Expected shape of the value. Defaults to 'string'. */
  type?: EnvVarType;
  /** If true, missing/empty values are allowed and no error is raised. */
  optional?: boolean;
  /** Human-readable explanation appended to the error message when invalid. */
  description?: string;
}

export type EnvSpec = Record<string, EnvVarSpec>;

export class EnvValidationError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(
      `Environment validation failed with ${issues.length} issue(s):\n` +
        issues.map((issue) => `  - ${issue}`).join('\n')
    );
    this.name = 'EnvValidationError';
    this.issues = issues;
  }
}

const STELLAR_SECRET_RE = /^S[A-Z2-7]{55}$/;
const STELLAR_CONTRACT_RE = /^C[A-Z2-7]{55}$/;

function isBlank(value: string | undefined): value is undefined {
  return value === undefined || value.trim().length === 0;
}

function validateShape(key: string, value: string, type: EnvVarType): string | null {
  switch (type) {
    case 'string':
      return null;
    case 'url':
      try {
        new URL(value);
        return null;
      } catch {
        return `${key} must be a valid URL (got "${value}")`;
      }
    case 'number':
      return Number.isFinite(Number(value)) ? null : `${key} must be a number (got "${value}")`;
    case 'stellarSecret':
      return STELLAR_SECRET_RE.test(value)
        ? null
        : `${key} must be a valid Stellar secret key starting with "S" (got "${value.slice(0, 4)}...")`;
    case 'stellarContract':
      return STELLAR_CONTRACT_RE.test(value)
        ? null
        : `${key} must be a valid Stellar contract ID starting with "C" (got "${value.slice(0, 4)}...")`;
    default:
      return null;
  }
}

/**
 * Validates `process.env` against `spec`, collecting every issue before
 * throwing. Returns a trimmed copy of the validated values on success.
 *
 * Empty and whitespace-only values are treated as missing.
 */
export function requireEnv<S extends EnvSpec>(
  spec: S,
  source: NodeJS.ProcessEnv = process.env
): { [K in keyof S]: string } {
  const issues: string[] = [];
  const result = {} as { [K in keyof S]: string };

  for (const key of Object.keys(spec) as Array<keyof S & string>) {
    const { type = 'string', optional = false, description } = spec[key];
    const raw = source[key];

    if (isBlank(raw)) {
      if (!optional) {
        const suffix = description ? ` (${description})` : '';
        issues.push(`${key} is required but missing or empty${suffix}`);
      }
      continue;
    }

    const trimmed = raw.trim();
    const shapeIssue = validateShape(key, trimmed, type);
    if (shapeIssue) {
      issues.push(shapeIssue);
      continue;
    }

    result[key] = trimmed;
  }

  if (issues.length > 0) {
    throw new EnvValidationError(issues);
  }

  return result;
}

/**
 * Runs `requireEnv` and exits the process with code 1 on failure, printing
 * an aggregated, human-readable error. Intended for use at the top of each
 * service's `server.ts`, before the HTTP listener starts.
 */
export function validateEnvOrExit<S extends EnvSpec>(
  serviceName: string,
  spec: S,
  source: NodeJS.ProcessEnv = process.env
): { [K in keyof S]: string } {
  try {
    return requireEnv(spec, source);
  } catch (err) {
    if (err instanceof EnvValidationError) {
      console.error(`[${serviceName}] refusing to start:\n${err.message}`);
      process.exit(1);
    }
    throw err;
  }
}
