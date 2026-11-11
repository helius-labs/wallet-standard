import type { WalletAccount } from '@wallet-standard/base';

/** Name of the feature. Custom; not an official Solana feature. */
export const TSPPDeriveSeed = 'tspp:deriveSeed';

/** The wallet returns a privacy seed after the user approves the requesting website. */
export type TSPPDeriveSeedFeature = {
    /** Name of the feature. */
    readonly [TSPPDeriveSeed]: {
        /** Version of the feature API. */
        readonly version: TSPPDeriveSeedVersion;

        /** Sign the protocol's derivation message with the account's secret key. */
        readonly deriveSeed: TSPPDeriveSeedMethod;
    };
};

/** Version of the feature. */
export type TSPPDeriveSeedVersion = '1.0.0';

/** Derivation protocol. */
export type TSPPDeriveSeedProtocol = 'tspp-v1';

/** Derives a privacy seed. */
export type TSPPDeriveSeedMethod = (input: TSPPDeriveSeedInput) => Promise<TSPPDeriveSeedOutput>;

/** Input for deriving a privacy seed. */
export interface TSPPDeriveSeedInput {
    /** Account to use. */
    readonly account: WalletAccount;

    /** Derivation protocol. */
    readonly protocol: TSPPDeriveSeedProtocol;
}

/** Output of deriving a privacy seed. */
export interface TSPPDeriveSeedOutput {
    /** 64-byte Ed25519 signature over the protocol's derivation message. Secret. */
    readonly derivationSeed: Uint8Array;
}
