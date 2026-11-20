import type { WalletAccount } from '@wallet-standard/base';

/** Name of the feature. Custom; not an official Solana feature. */
export const TSPPShieldedKeys = 'tspp:shieldedKeys';

/**
 * The wallet holds the account's TSPP viewing and nullifier keys and answers
 * read requests with them. No method returns a secret key. Mirrors the read
 * side of the Zolana SDK's `ShieldedKeys` interface.
 */
export type TSPPShieldedKeysFeature = {
    /** Name of the feature. */
    readonly [TSPPShieldedKeys]: {
        /** Version of the feature API. */
        readonly version: TSPPShieldedKeysVersion;

        /** Return the account's public shielded address and viewing public keys. */
        readonly getPublicKeys: TSPPGetPublicKeysMethod;

        /** Decrypt output ciphertexts with the account's viewing keys. */
        readonly decrypt: TSPPDecryptMethod;

        /** Derive nullifiers and merge recovery values with the account's nullifier key. */
        readonly derive: TSPPDeriveMethod;
    };
};

/** Version of the feature. */
export type TSPPShieldedKeysVersion = '1.0.0';

/** Key derivation and cipher protocol. */
export type TSPPShieldedKeysProtocol = 'tspp-v1';

/** Returns the account's public keys. */
export type TSPPGetPublicKeysMethod = (input: TSPPGetPublicKeysInput) => Promise<TSPPGetPublicKeysOutput>;

/** Input for returning the account's public keys. */
export interface TSPPGetPublicKeysInput {
    /** Account to use. */
    readonly account: WalletAccount;

    /** Protocol. */
    readonly protocol: TSPPShieldedKeysProtocol;
}

/** Output of returning the account's public keys. */
export interface TSPPGetPublicKeysOutput {
    /** 99-byte shielded address: signing identity, nullifier public key, and tagged viewing public key. */
    readonly shieldedAddress: Uint8Array;

    /** 33-byte tagged X25519 viewing public keys held by the wallet, current first. */
    readonly viewingPublicKeys: readonly Uint8Array[];
}

/** Cipher label of a ciphertext. */
export type TSPPDecryptLabel = 'transfer' | 'ringDeposit';

/** One ciphertext to decrypt. */
export interface TSPPDecryptRequest {
    /** Output ciphertext. */
    readonly ciphertext: Uint8Array;

    /** 33-byte tagged viewing public key of the held key to decrypt with. */
    readonly viewingPublicKey: Uint8Array;

    /** 33-byte tagged transaction viewing public key. */
    readonly txViewingPublicKey: Uint8Array;

    /** 16-byte transaction salt. */
    readonly salt: Uint8Array;

    /** Output slot index, a u32. Zero for a ring deposit. */
    readonly slotIndex: number;

    /** Cipher label. */
    readonly label: TSPPDecryptLabel;
}

/** Decrypts ciphertexts. */
export type TSPPDecryptMethod = (input: TSPPDecryptInput) => Promise<TSPPDecryptOutput>;

/** Input for decrypting ciphertexts. */
export interface TSPPDecryptInput {
    /** Account to use. */
    readonly account: WalletAccount;

    /** Protocol. */
    readonly protocol: TSPPShieldedKeysProtocol;

    /** Ciphertexts to decrypt. A malformed request rejects the batch. */
    readonly requests: readonly TSPPDecryptRequest[];
}

/** Output of decrypting ciphertexts. */
export interface TSPPDecryptOutput {
    /**
     * Raw cipher output, one per request in request order, each as long as its
     * ciphertext. Unauthenticated: the caller must verify the decoded commitment.
     */
    readonly plaintexts: readonly Uint8Array[];
}

/** One value to derive with the nullifier key. */
export type TSPPDeriveRequest =
    | {
          /** Nullifier of an owned UTXO, for spent detection. */
          readonly kind: 'nullifier';
          /** 32-byte UTXO hash. */
          readonly utxoHash: Uint8Array;
          /** 32-byte UTXO blinding. */
          readonly blinding: Uint8Array;
      }
    | {
          /** Key of a merge output ciphertext, for merge recovery. */
          readonly kind: 'mergeOutputKey';
          /** 32-byte first nullifier of the merge. */
          readonly firstNullifier: Uint8Array;
      }
    | {
          /** Blinding of a merge output, for merge recovery. */
          readonly kind: 'mergeOutputBlinding';
          /** 32-byte first nullifier of the merge. */
          readonly firstNullifier: Uint8Array;
      };

/** Kind of a derived value. */
export type TSPPDeriveKind = TSPPDeriveRequest['kind'];

/** Derives values with the nullifier key. */
export type TSPPDeriveMethod = (input: TSPPDeriveInput) => Promise<TSPPDeriveOutput>;

/** Input for deriving values. */
export interface TSPPDeriveInput {
    /** Account to use. */
    readonly account: WalletAccount;

    /** Protocol. */
    readonly protocol: TSPPShieldedKeysProtocol;

    /** Values to derive. A malformed request rejects the batch. */
    readonly requests: readonly TSPPDeriveRequest[];
}

/** Output of deriving values. */
export interface TSPPDeriveOutput {
    /** 32-byte values, one per request in request order. */
    readonly values: readonly Uint8Array[];
}
