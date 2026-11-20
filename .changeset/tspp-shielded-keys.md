---
'@solana/wallet-standard-features': minor
'@solana/wallet-standard-wallet-adapter-base': minor
---

Add the custom `tspp:shieldedKeys` feature and `StandardWalletAdapter` methods `getShieldedPublicKeys`,
`decryptShielded`, and `deriveShielded`. The wallet keeps the TSPP viewing and nullifier keys and returns only
public keys, raw plaintexts, and derived values. Legacy adapters with these methods expose the feature when wrapped.
