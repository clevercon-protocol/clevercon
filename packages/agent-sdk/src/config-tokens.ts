/**
 * CleverCon agent config tokens: one opaque, copy-paste string per thing an agent
 * needs, so a config is a couple of lines instead of raw rule JSON, bare salts, and
 * a handful of network ids.
 *
 * A token is `<prefix><base64url(json)>`. It is an ENCODING, not encryption: whoever
 * holds the token holds what it carries (the same as pasting the raw JSON did), so
 * keep a policy/session token as private as the salt or key inside it. The win is
 * ergonomic - the dapp shows a single opaque string, and the SDK/MCP decode it - not
 * a new security boundary.
 *
 * Isomorphic (no Node builtins): the dapp PACKS tokens in the browser and the
 * SDK/MCP UNPACK them in Node, so this module is imported by both.
 */

// ── base64url of UTF-8 JSON, in browser or Node ───────────────────────────────
function bytesToB64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  const b64 =
    typeof btoa !== 'undefined'
      ? btoa(bin)
      : // eslint-disable-next-line no-undef
        Buffer.from(bin, 'binary').toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin =
    typeof atob !== 'undefined'
      ? atob(b64)
      : // eslint-disable-next-line no-undef
        Buffer.from(b64, 'base64').toString('binary');
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function encode(prefix: string, payload: unknown): string {
  return prefix + bytesToB64url(new TextEncoder().encode(JSON.stringify(payload)));
}

function decode<T>(prefix: string, token: string): T {
  const t = token.trim();
  if (!t.startsWith(prefix)) {
    throw new Error(`not a ${prefix}… token`);
  }
  try {
    return JSON.parse(new TextDecoder().decode(b64urlToBytes(t.slice(prefix.length)))) as T;
  } catch {
    throw new Error(`malformed ${prefix}… token`);
  }
}

// ── Private policy key: packs the owner's { rules, salt } bundle ───────────────
export const POLICY_KEY_PREFIX = 'ccpk1_';
export interface PolicyKeyPayload {
  v: 1;
  rules: unknown;
  salt: string;
}
/** Pack a private rule bundle into a single opaque CLEVERCON_POLICY_KEY string. */
export function packPolicyKey(bundle: { rules: unknown; salt: string }): string {
  if (!bundle?.rules || !bundle?.salt) throw new Error('policy bundle needs { rules, salt }');
  return encode(POLICY_KEY_PREFIX, { v: 1, rules: bundle.rules, salt: bundle.salt });
}
/** Decode a CLEVERCON_POLICY_KEY (or accept a legacy raw `{rules,salt}` JSON string). */
export function unpackPolicyKey(token: string): { rules: unknown; salt: string } {
  const t = token.trim();
  if (t.startsWith(POLICY_KEY_PREFIX)) {
    const p = decode<PolicyKeyPayload>(POLICY_KEY_PREFIX, t);
    if (!p.rules || !p.salt) throw new Error('policy key missing rules/salt');
    return { rules: p.rules, salt: p.salt };
  }
  // Back-compat: a raw bundle JSON pasted directly.
  const b = JSON.parse(t) as { rules?: unknown; salt?: string };
  if (!b.rules || !b.salt) throw new Error('policy key must be a ccpk1_… token or { rules, salt }');
  return { rules: b.rules, salt: b.salt };
}

// ── Public rule key: packs a public rule id (the dapp's public handle) ─────────
export const RULE_KEY_PREFIX = 'ccrk1_';
export interface RuleKeyPayload {
  v: 1;
  rule: string;
}
/** Pack a public rule id into a single opaque CLEVERCON_RULE_KEY string. */
export function packRuleKey(ruleIdHex: string): string {
  if (!/^[0-9a-fA-F]{64}$/.test(ruleIdHex)) throw new Error('rule id must be 32-byte hex');
  return encode(RULE_KEY_PREFIX, { v: 1, rule: ruleIdHex.toLowerCase() });
}
/** Decode a CLEVERCON_RULE_KEY to its rule id (or accept a bare 64-hex id). */
export function unpackRuleKey(token: string): string {
  const t = token.trim();
  if (t.startsWith(RULE_KEY_PREFIX)) {
    const p = decode<RuleKeyPayload>(RULE_KEY_PREFIX, t);
    if (!/^[0-9a-fA-F]{64}$/.test(p.rule)) throw new Error('rule key holds an invalid id');
    return p.rule.toLowerCase();
  }
  if (/^[0-9a-fA-F]{64}$/.test(t)) return t.toLowerCase();
  throw new Error('rule key must be a ccrk1_… token or a 64-hex rule id');
}

// ── Session key: packs a LOCAL session key + the network it spends on ──────────
export const SESSION_KEY_PREFIX = 'ccsk1_';
export interface SessionKeyPayload {
  v: 1;
  /** The session key secret (S…) the agent signs with. */
  s: string;
  /** Vault contract id. */
  vault: string;
  /** USDC Stellar Asset Contract id. */
  usdc: string;
  /** Soroban RPC URL (optional; defaults to testnet). */
  rpc?: string;
  /** The public rule the session runs under, if any (32-byte hex). */
  rule?: string;
}
/** Pack a local session key + its network into a single CLEVERCON_SESSION_KEY string. */
export function packSessionKey(p: {
  sessionSecret: string;
  vaultId: string;
  usdcSac: string;
  rpcUrl?: string;
  ruleId?: string;
}): string {
  return encode(SESSION_KEY_PREFIX, {
    v: 1,
    s: p.sessionSecret,
    vault: p.vaultId,
    usdc: p.usdcSac,
    ...(p.rpcUrl ? { rpc: p.rpcUrl } : {}),
    ...(p.ruleId ? { rule: p.ruleId.toLowerCase() } : {}),
  });
}
/** Decode a CLEVERCON_SESSION_KEY into its parts. */
export function unpackSessionKey(token: string): {
  sessionSecret: string;
  vaultId: string;
  usdcSac: string;
  rpcUrl?: string;
  ruleId?: string;
} {
  const p = decode<SessionKeyPayload>(SESSION_KEY_PREFIX, token);
  if (!p.s || !p.vault || !p.usdc) throw new Error('session key missing secret/vault/usdc');
  return {
    sessionSecret: p.s,
    vaultId: p.vault,
    usdcSac: p.usdc,
    rpcUrl: p.rpc,
    ruleId: p.rule,
  };
}
