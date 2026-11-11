import { WalletError } from '@solana/wallet-adapter-base';
import {
    TSPPDeriveSeed,
    type TSPPDeriveSeedFeature,
    type TSPPDeriveSeedInput,
    type TSPPDeriveSeedOutput,
} from '@solana/wallet-standard-features';

/** Input of `derivePrivacySeed` on an adapter. The adapter supplies the account. */
export type DerivePrivacySeedInput = Omit<TSPPDeriveSeedInput, 'account'>;

/** Output of `derivePrivacySeed` on an adapter. */
export type DerivePrivacySeedOutput = TSPPDeriveSeedOutput;

/** `derivePrivacySeed` on an adapter. */
export type DerivePrivacySeedMethod = (input: DerivePrivacySeedInput) => Promise<DerivePrivacySeedOutput>;

/** The wallet denied or failed privacy seed derivation. Wallet error details are dropped. */
export class WalletDerivePrivacySeedError extends WalletError {
    name = 'WalletDerivePrivacySeedError';
}

/** Return the wallet's `tspp:deriveSeed` feature if it has version 1.0.0. */
export function getDeriveSeedFeature(features: object): TSPPDeriveSeedFeature[typeof TSPPDeriveSeed] | undefined {
    const feature = (features as Partial<TSPPDeriveSeedFeature>)[TSPPDeriveSeed];
    return feature &&
        typeof feature === 'object' &&
        feature.version === '1.0.0' &&
        typeof feature.deriveSeed === 'function'
        ? feature
        : undefined;
}

/** Check for a `Uint8Array`, including a `Buffer` or an array from another realm. */
export function isUint8Array(value: unknown): value is Uint8Array {
    return Object.prototype.toString.call(value) === '[object Uint8Array]';
}
