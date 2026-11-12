import { WalletConfigError, WalletError } from '@solana/wallet-adapter-base';
import {
    TSPPShieldedKeys,
    type TSPPDecryptInput,
    type TSPPDecryptOutput,
    type TSPPDecryptRequest,
    type TSPPDeriveInput,
    type TSPPDeriveOutput,
    type TSPPDeriveRequest,
    type TSPPGetPublicKeysInput,
    type TSPPGetPublicKeysOutput,
    type TSPPShieldedKeysFeature,
} from '@solana/wallet-standard-features';

/** Input of `getShieldedPublicKeys` on an adapter. The adapter supplies the account. */
export type GetShieldedPublicKeysInput = Omit<TSPPGetPublicKeysInput, 'account'>;

/** Output of `getShieldedPublicKeys` on an adapter. */
export type GetShieldedPublicKeysOutput = TSPPGetPublicKeysOutput;

/** `getShieldedPublicKeys` on an adapter. */
export type GetShieldedPublicKeysMethod = (input: GetShieldedPublicKeysInput) => Promise<GetShieldedPublicKeysOutput>;

/** Input of `decryptShielded` on an adapter. The adapter supplies the account. */
export type DecryptShieldedInput = Omit<TSPPDecryptInput, 'account'>;

/** Output of `decryptShielded` on an adapter. */
export type DecryptShieldedOutput = TSPPDecryptOutput;

/** `decryptShielded` on an adapter. */
export type DecryptShieldedMethod = (input: DecryptShieldedInput) => Promise<DecryptShieldedOutput>;

/** Input of `deriveShielded` on an adapter. The adapter supplies the account. */
export type DeriveShieldedInput = Omit<TSPPDeriveInput, 'account'>;

/** Output of `deriveShielded` on an adapter. */
export type DeriveShieldedOutput = TSPPDeriveOutput;

/** `deriveShielded` on an adapter. */
export type DeriveShieldedMethod = (input: DeriveShieldedInput) => Promise<DeriveShieldedOutput>;

/** The wallet denied or failed a shielded keys request. Wallet error details are dropped. */
export class WalletShieldedKeysError extends WalletError {
    name = 'WalletShieldedKeysError';
}

/** Byte length of a shielded address. */
export const SHIELDED_ADDRESS_LENGTH = 99;

/** Byte length of a tagged X25519 public key. */
export const TAGGED_X25519_PUBLIC_KEY_LENGTH = 33;

/** First byte of a tagged X25519 public key. */
export const X25519_PUBLIC_KEY_TAG = 0x04;

const SALT_LENGTH = 16;
const FIELD_LENGTH = 32;
const MAX_U32 = 0xffffffff;

/** Return the wallet's `tspp:shieldedKeys` feature if it has version 1.0.0 and all methods. */
export function getShieldedKeysFeature(features: object): TSPPShieldedKeysFeature[typeof TSPPShieldedKeys] | undefined {
    const feature = (features as Partial<TSPPShieldedKeysFeature>)[TSPPShieldedKeys];
    return feature &&
        typeof feature === 'object' &&
        feature.version === '1.0.0' &&
        typeof feature.getPublicKeys === 'function' &&
        typeof feature.decrypt === 'function' &&
        typeof feature.derive === 'function'
        ? feature
        : undefined;
}

/** Check for a `Uint8Array`, including a `Buffer` or an array from another realm. */
export function isUint8Array(value: unknown): value is Uint8Array {
    return ArrayBuffer.isView(value) && Object.prototype.toString.call(value) === '[object Uint8Array]';
}

/**
 * Copy a byte array into a new `Uint8Array` that the adapter owns, or return
 * `undefined` if the value is not a `Uint8Array` of the expected length. The copy
 * cannot change after validation, and `slice()` on a `Buffer` would share memory.
 */
function copyBytes(value: unknown, length?: number): Uint8Array | undefined {
    if (!isUint8Array(value)) return undefined;
    const copy = new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice();
    return length === undefined || copy.length === length ? copy : undefined;
}

function copyTaggedPublicKey(value: unknown): Uint8Array | undefined {
    const copy = copyBytes(value, TAGGED_X25519_PUBLIC_KEY_LENGTH);
    return copy && copy[0] === X25519_PUBLIC_KEY_TAG ? copy : undefined;
}

function isU32(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_U32;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
    return a.length === b.length && a.every((byte, i) => byte === b[i]);
}

/** Reject a protocol other than `tspp-v1`. */
export function assertShieldedKeysProtocol(protocol: unknown): asserts protocol is 'tspp-v1' {
    if (protocol !== 'tspp-v1') throw new WalletConfigError('Unsupported shielded keys protocol');
}

/**
 * Validate a decrypt batch and return a copy built from plain objects and new byte
 * arrays. Each field is read once, so the wallet receives exactly what was checked.
 */
export function parseDecryptRequests(requests: unknown): TSPPDecryptRequest[] {
    if (!Array.isArray(requests)) throw new WalletConfigError('Decrypt requests must be an array');
    return Array.from(requests as unknown[], (request) => {
        if (!request || typeof request !== 'object') throw new WalletConfigError('Malformed decrypt request');
        const r = request as Partial<Record<keyof TSPPDecryptRequest, unknown>>;
        const ciphertext = copyBytes(r.ciphertext);
        const viewingPublicKey = copyTaggedPublicKey(r.viewingPublicKey);
        const txViewingPublicKey = copyTaggedPublicKey(r.txViewingPublicKey);
        const salt = copyBytes(r.salt, SALT_LENGTH);
        const slotIndex = r.slotIndex;
        const label = r.label;
        if (
            !ciphertext ||
            !viewingPublicKey ||
            !txViewingPublicKey ||
            !salt ||
            !isU32(slotIndex) ||
            (label !== 'transfer' && label !== 'ringDeposit') ||
            (label === 'ringDeposit' && slotIndex !== 0)
        ) {
            throw new WalletConfigError('Malformed decrypt request');
        }
        return { ciphertext, viewingPublicKey, txViewingPublicKey, salt, slotIndex, label };
    });
}

/**
 * Validate a derive batch, rejecting build-only kinds, and return a copy built from
 * plain objects and new byte arrays.
 */
export function parseDeriveRequests(requests: unknown): TSPPDeriveRequest[] {
    if (!Array.isArray(requests)) throw new WalletConfigError('Derive requests must be an array');
    return Array.from(requests as unknown[], (request): TSPPDeriveRequest => {
        if (!request || typeof request !== 'object') throw new WalletConfigError('Malformed derive request');
        const r = request as { kind?: unknown; utxoHash?: unknown; blinding?: unknown; firstNullifier?: unknown };
        const kind = r.kind;
        if (kind === 'nullifier') {
            const utxoHash = copyBytes(r.utxoHash, FIELD_LENGTH);
            const blinding = copyBytes(r.blinding, FIELD_LENGTH);
            if (utxoHash && blinding) return { kind, utxoHash, blinding };
        } else if (kind === 'mergeOutputKey' || kind === 'mergeOutputBlinding') {
            const firstNullifier = copyBytes(r.firstNullifier, FIELD_LENGTH);
            if (firstNullifier) return { kind, firstNullifier };
        }
        throw new WalletConfigError('Malformed derive request');
    });
}

/**
 * Validate the wallet's public keys and return copies. The first viewing key must be
 * the one in the shielded address, or every decryption under it would yield noise.
 */
export function checkPublicKeysOutput(output: unknown): TSPPGetPublicKeysOutput {
    const o = output as Partial<Record<keyof TSPPGetPublicKeysOutput, unknown>> | null;
    const shieldedAddress = copyBytes(o?.shieldedAddress, SHIELDED_ADDRESS_LENGTH);
    const keys = o?.viewingPublicKeys;
    const viewingPublicKeys = Array.isArray(keys) ? Array.from(keys as unknown[], copyTaggedPublicKey) : [];
    const current = viewingPublicKeys[0];
    if (
        !shieldedAddress ||
        !current ||
        !viewingPublicKeys.every((key): key is Uint8Array => key !== undefined) ||
        !bytesEqual(current, shieldedAddress.subarray(SHIELDED_ADDRESS_LENGTH - TAGGED_X25519_PUBLIC_KEY_LENGTH))
    ) {
        throw new WalletShieldedKeysError('Wallet returned invalid shielded public keys');
    }
    return { shieldedAddress, viewingPublicKeys };
}

/** Validate the wallet's plaintexts against the parsed requests and return copies. */
export function checkDecryptOutput(requests: readonly TSPPDecryptRequest[], output: unknown): TSPPDecryptOutput {
    const plaintexts = (output as Partial<TSPPDecryptOutput> | null)?.plaintexts;
    const copies =
        Array.isArray(plaintexts) && plaintexts.length === requests.length
            ? requests.map((request, i) => copyBytes((plaintexts as unknown[])[i], request.ciphertext.length))
            : [];
    if (copies.length !== requests.length || !copies.every((copy): copy is Uint8Array => copy !== undefined)) {
        throw new WalletShieldedKeysError('Wallet returned invalid plaintexts');
    }
    return { plaintexts: copies };
}

/** Validate the wallet's derived values against the parsed requests and return copies. */
export function checkDeriveOutput(requests: readonly TSPPDeriveRequest[], output: unknown): TSPPDeriveOutput {
    const values = (output as Partial<TSPPDeriveOutput> | null)?.values;
    const copies =
        Array.isArray(values) && values.length === requests.length
            ? Array.from(values as unknown[], (value) => copyBytes(value, FIELD_LENGTH))
            : [];
    if (copies.length !== requests.length || !copies.every((copy): copy is Uint8Array => copy !== undefined)) {
        throw new WalletShieldedKeysError('Wallet returned invalid derived values');
    }
    return { values: copies };
}
