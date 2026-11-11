import type { WalletAccount } from '@wallet-standard/base';

/** Custom Wallet Standard feature; this is not an official Solana feature. */
export const TSPPDeriveSeed = 'tspp:deriveSeed';

/** Input for deriving a privacy seed. */
export interface DerivePrivacySeedInput {
    readonly protocol: 'tspp-v1';
}

/** Output of deriving a privacy seed. */
export interface DerivePrivacySeedOutput {
    /** Secret 64-byte signature over the protocol's exact off-chain message v0 bytes. */
    readonly derivationSeed: Uint8Array;
}

/** Wallet feature for releasing a privacy seed after authorizing the requesting origin. */
export type TSPPDeriveSeedFeature = {
    readonly [TSPPDeriveSeed]: {
        readonly version: '1.0.0';
        /** Construct the message and enforce origin permissions inside the wallet. */
        readonly deriveSeed: (
            input: DerivePrivacySeedInput & { readonly account: WalletAccount }
        ) => Promise<DerivePrivacySeedOutput>;
    };
};
