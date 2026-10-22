import { Account, Operation, TransactionBuilder, TimeoutInfinite } from '@stellar/stellar-sdk';
import { NETWORK_PASSPHRASE } from './network';
import { signTransaction } from './wallet';
import { useSession } from '../store/session';
import type { PolicyBundleRules } from '@clevercon/agent-sdk/prover';

/**
 * The owner's private rule as it must persist to be re-proven later: the exact
 * prover rules plus the device salt that pins the commitment. Losing the salt
 * means the rule can never be proven again, so this is backed up (encrypted)
 * rather than kept only in volatile memory.
 */
export interface RuleBundle {
  rules: PolicyBundleRules;
  /** Decimal field-element salt (< r); see newSalt in the SDK. */
  salt: string;
}

// Domain-separation tag for the key-derivation transaction. Fixed forever: the
// derived key depends on it, so changing it would orphan every existing backup.
const KEY_TAG = 'clevercon:rule-backup';
const KEY_VERSION = 'v1';

/**
 * Derive the AES-GCM backup key from a WALLET SIGNATURE, so only the owner's
 * wallet can decrypt their private rules and the server never holds the key.
 *
 * The signed payload is a FIXED transaction (the connected account as source,
 * sequence 0, a single manage-data op carrying the domain tag, no time bounds):
 * ed25519 signatures are deterministic, so signing this exact envelope yields the
 * same 64 bytes every time and on every device for the same account. SHA-256 of
 * that signature is the symmetric key. The transaction is never submitted; it is
 * only a deterministic message the wallet will sign.
 */
async function deriveKey(): Promise<CryptoKey> {
  const address = useSession.getState().session?.address;
  if (!address) throw new Error('Connect a wallet first');
  const tx = new TransactionBuilder(new Account(address, '0'), {
    fee: '100',
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(Operation.manageData({ name: KEY_TAG, value: KEY_VERSION }))
    .setTimeout(TimeoutInfinite)
    .build();
  const signedXdr = await signTransaction(tx.toXDR(), NETWORK_PASSPHRASE);
  const signed = TransactionBuilder.fromXDR(signedXdr, NETWORK_PASSPHRASE);
  const sig = signed.signatures[0]?.signature();
  if (!sig || sig.length === 0) throw new Error('Wallet returned no signature');
  const keyBytes = await crypto.subtle.digest('SHA-256', u8(sig));
  return crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

// A derived key is stable for the session (same wallet, same message), so cache
// it in memory to avoid a wallet prompt on every encrypt/decrypt. Never persisted.
let cachedKey: Promise<CryptoKey> | null = null;
function backupKey(): Promise<CryptoKey> {
  if (!cachedKey) cachedKey = deriveKey().catch((e) => ((cachedKey = null), Promise.reject(e)));
  return cachedKey;
}

const enc = new TextEncoder();
const dec = new TextDecoder();
const toB64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
// WebCrypto's BufferSource must be ArrayBuffer-backed; copy into a fresh
// Uint8Array so TS does not widen the input to ArrayBufferLike (SharedArrayBuffer).
const u8 = (src: ArrayLike<number>): Uint8Array<ArrayBuffer> => Uint8Array.from(src);

/**
 * Encrypt a {@link RuleBundle} into the opaque ciphertext the API stores as
 * `encryptedBackup`. Output is base64 of `iv(12) || AES-GCM(ciphertext)`; the
 * server cannot read it (the key is wallet-derived and never leaves the device).
 */
export async function encryptRuleBundle(bundle: RuleBundle): Promise<string> {
  const key = await backupKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      u8(enc.encode(JSON.stringify(bundle))),
    ),
  );
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv, 0);
  out.set(ct, iv.length);
  return toB64(out);
}

/** Decrypt an `encryptedBackup` blob back into the owner's {@link RuleBundle}. */
export async function decryptRuleBundle(blob: string): Promise<RuleBundle> {
  const key = await backupKey();
  const raw = fromB64(blob);
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: u8(raw.subarray(0, 12)) },
    key,
    u8(raw.subarray(12)),
  );
  return JSON.parse(dec.decode(pt)) as RuleBundle;
}
