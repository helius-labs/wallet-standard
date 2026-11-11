---
'@solana/wallet-standard-features': minor
'@solana/wallet-standard-wallet-adapter-base': minor
'@solana/wallet-standard-wallet-adapter-react': patch
---

Add the custom `tspp:deriveSeed` feature types and expose an optional
`StandardWalletAdapter.derivePrivacySeed` method for supporting accounts. Check
connection state, account identity, feature version, and output length, sanitize
wallet errors, and return an independent copy of the seed. Wrapped legacy adapters
with a `derivePrivacySeed` method also expose the feature.

Wallets must authorize the requesting website before returning the signature.
