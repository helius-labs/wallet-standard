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
    return Object.prototype.toString.call(value) === '[object Uint8Array]';
}

function isBytes(value: unknown, length: number): value is Uint8Array {
    return isUint8Array(value) && value.length === length;
}

function isTaggedPublicKey(value: unknown): value is Uint8Array {
    return isBytes(value, TAGGED_X25519_PUBLIC_KEY_LENGTH) && value[0] === X25519_PUBLIC_KEY_TAG;
}

function isU32(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_U32;
}

/** Reject a protocol other than `tspp-v1`. */
export function assertShieldedKeysProtocol(protocol: unknown): asserts protocol is 'tspp-v1' {
    if (protocol !== 'tspp-v1') throw new WalletConfigError('Unsupported shielded keys protocol');
}

/** Reject a malformed decrypt batch before it reaches the wallet. */
export function assertDecryptRequests(requests: unknown): asserts requests is readonly TSPPDecryptRequest[] {
    if (!Array.isArray(requests)) throw new WalletConfigError('Decrypt requests must be an array');
    for (const request of requests as unknown[]) {
        const r = request as Partial<Record<keyof TSPPDecryptRequest, unknown>> | null;
        if (
            !r ||
            typeof r !== 'object' ||
            !isUint8Array(r.ciphertext) ||
            !isTaggedPublicKey(r.viewingPublicKey) ||
            !isTaggedPublicKey(r.txViewingPublicKey) ||
            !isBytes(r.salt, SALT_LENGTH) ||
            !isU32(r.slotIndex) ||
            (r.label !== 'transfer' && r.label !== 'ringDeposit') ||
            (r.label === 'ringDeposit' && r.slotIndex !== 0)
        ) {
            throw new WalletConfigError('Malformed decrypt request');
        }
    }
}

/** Reject a malformed derive batch, including build-only kinds, before it reaches the wallet. */
export function assertDeriveRequests(requests: unknown): asserts requests is readonly TSPPDeriveRequest[] {
    if (!Array.isArray(requests)) throw new WalletConfigError('Derive requests must be an array');
    for (const request of requests as unknown[]) {
        const r = request as {
            kind?: unknown;
            utxoHash?: unknown;
            blinding?: unknown;
            firstNullifier?: unknown;
        } | null;
        const valid =
            !!r &&
            typeof r === 'object' &&
            (r.kind === 'nullifier'
                ? isBytes(r.utxoHash, FIELD_LENGTH) && isBytes(r.blinding, FIELD_LENGTH)
                : (r.kind === 'mergeOutputKey' || r.kind === 'mergeOutputBlinding') &&
                  isBytes(r.firstNullifier, FIELD_LENGTH));
        if (!valid) throw new WalletConfigError('Malformed derive request');
    }
}

/** Validate the wallet's public keys and return copies. */
export function checkPublicKeysOutput(output: unknown): TSPPGetPublicKeysOutput {
    const o = output as Partial<Record<keyof TSPPGetPublicKeysOutput, unknown>> | null;
    const keys = o?.viewingPublicKeys;
    if (
        !o ||
        !isBytes(o.shieldedAddress, SHIELDED_ADDRESS_LENGTH) ||
        !Array.isArray(keys) ||
        keys.length === 0 ||
        !keys.every(isTaggedPublicKey)
    ) {
        throw new WalletShieldedKeysError('Wallet returned invalid shielded public keys');
    }
    return {
        shieldedAddress: new Uint8Array(o.shieldedAddress),
        viewingPublicKeys: (keys as Uint8Array[]).map((key) => new Uint8Array(key)),
    };
}

/** Validate the wallet's plaintexts against the requests and return copies. */
export function checkDecryptOutput(requests: readonly TSPPDecryptRequest[], output: unknown): TSPPDecryptOutput {
    const plaintexts = (output as Partial<TSPPDecryptOutput> | null)?.plaintexts;
    if (
        !Array.isArray(plaintexts) ||
        plaintexts.length !== requests.length ||
        !requests.every((request, i) => isBytes(plaintexts[i], request.ciphertext.length))
    ) {
        throw new WalletShieldedKeysError('Wallet returned invalid plaintexts');
    }
    // `slice()` on a `Buffer` shares memory, so construct new arrays.
    return { plaintexts: (plaintexts as Uint8Array[]).map((plaintext) => new Uint8Array(plaintext)) };
}

/** Validate the wallet's derived values against the requests and return copies. */
export function checkDeriveOutput(requests: readonly TSPPDeriveRequest[], output: unknown): TSPPDeriveOutput {
    const values = (output as Partial<TSPPDeriveOutput> | null)?.values;
    if (
        !Array.isArray(values) ||
        values.length !== requests.length ||
        !values.every((value) => isBytes(value, FIELD_LENGTH))
    ) {
        throw new WalletShieldedKeysError('Wallet returned invalid derived values');
    }
    return { values: (values as Uint8Array[]).map((value) => new Uint8Array(value)) };
}
