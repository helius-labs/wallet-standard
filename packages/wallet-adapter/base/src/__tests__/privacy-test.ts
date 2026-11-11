import {
    BaseWalletAdapter,
    type WalletAdapterCompatibleStandardWallet,
    WalletAccountError,
    WalletConfigError,
    WalletError,
    type WalletName,
    WalletNotConnectedError,
    WalletReadyState,
} from '@solana/wallet-adapter-base';
import {
    SolanaSignMessage,
    SolanaSignTransaction,
    TSPPDeriveSeed,
    type TSPPDeriveSeedFeature,
} from '@solana/wallet-standard-features';
import { PublicKey } from '@solana/web3.js';
import { runInNewContext } from 'node:vm';
import type { WalletAccount } from '@wallet-standard/base';
import { StandardConnect, StandardEvents, type StandardEventsListeners } from '@wallet-standard/features';
import { StandardWalletAdapter } from '../adapter.js';
import { type DerivePrivacySeedInput, WalletDerivePrivacySeedError } from '../privacy.js';
import { SolanaWalletAdapterWallet } from '../wallet.js';

const publicKey = new PublicKey('Foo11111111111111111111111111111111111111111');

describe('StandardWalletAdapter.derivePrivacySeed', () => {
    let adapter: StandardWalletAdapter;
    let wallet: WalletAdapterCompatibleStandardWallet;
    let account: WalletAccount;
    let deriveSeed: jest.Mock;
    let signMessage: jest.Mock;
    let onError: jest.Mock;
    let feature: TSPPDeriveSeedFeature[typeof TSPPDeriveSeed];
    let change: StandardEventsListeners['change'];

    beforeEach(async () => {
        account = {
            address: publicKey.toBase58(),
            publicKey: publicKey.toBytes(),
            chains: ['solana:devnet'],
            features: [TSPPDeriveSeed, SolanaSignMessage, SolanaSignTransaction],
        };
        deriveSeed = jest.fn().mockResolvedValue({ derivationSeed: new Uint8Array(64).fill(7) });
        signMessage = jest.fn();
        feature = { version: '1.0.0', deriveSeed };
        wallet = {
            version: '1.0.0',
            name: 'Test wallet',
            icon: 'data:image/png;base64,',
            chains: ['solana:devnet'],
            accounts: [account],
            features: {
                [StandardConnect]: { version: '1.0.0', connect: jest.fn() },
                [StandardEvents]: {
                    version: '1.0.0',
                    on: (_event, listener) => {
                        change = listener;
                        return jest.fn();
                    },
                },
                [SolanaSignTransaction]: {
                    version: '1.0.0',
                    supportedTransactionVersions: ['legacy'],
                    signTransaction: jest.fn(),
                },
                [SolanaSignMessage]: { version: '1.0.0', signMessage },
                ...{ [TSPPDeriveSeed]: feature },
            },
        };
        adapter = new StandardWalletAdapter({ wallet });
        onError = jest.fn();
        adapter.on('error', onError);
        await adapter.connect();
    });

    afterEach(() => adapter.destroy());

    it('passes the connected account to the dedicated feature without calling signMessage', async () => {
        await expect(adapter.derivePrivacySeed?.({ protocol: 'tspp-v1' })).resolves.toEqual({
            derivationSeed: new Uint8Array(64).fill(7),
        });
        expect(deriveSeed).toHaveBeenCalledWith({ account, protocol: 'tspp-v1' });
        expect(signMessage).not.toHaveBeenCalled();
    });

    it.each([
        ['Uint8Array', new Uint8Array(128).fill(7)],
        ['Buffer', Buffer.alloc(128, 7)],
    ])('returns a copy that does not expose the wallet buffer (%s)', async (_name, backing) => {
        deriveSeed.mockResolvedValue({ derivationSeed: backing.subarray(32, 96) });
        const output = await adapter.derivePrivacySeed?.({ protocol: 'tspp-v1' });
        expect(output?.derivationSeed).toEqual(new Uint8Array(64).fill(7));
        expect(output?.derivationSeed.buffer).not.toBe(backing.buffer);
        output?.derivationSeed.fill(0);
        expect(backing.every((byte) => byte === 7)).toBe(true);
    });

    it('does not forward a caller-supplied origin or permission grant', async () => {
        const input = { protocol: 'tspp-v1' as const, origin: 'https://trusted.example', approved: true };
        await adapter.derivePrivacySeed?.(input);
        expect(deriveSeed).toHaveBeenCalledWith({ account, protocol: 'tspp-v1' });
    });

    it.each([undefined, null, {}, { version: '2.0.0', deriveSeed: jest.fn() }, { version: '1.0.0' }])(
        'does not expose unsupported or malformed features (%p)',
        (unsupportedFeature) => {
            Object.assign(wallet.features, { [TSPPDeriveSeed]: unsupportedFeature });
            change({ features: wallet.features });
            expect('derivePrivacySeed' in adapter).toBe(false);
            expect(signMessage).not.toHaveBeenCalled();
        }
    );

    it('does not expose derivation for an account without the feature', () => {
        Object.assign(account, { features: [SolanaSignMessage] });
        change({ features: wallet.features });
        expect('derivePrivacySeed' in adapter).toBe(false);
    });

    it('does not use another account that advertises the feature', () => {
        const otherAccount = { ...account, address: PublicKey.default.toBase58() };
        Object.assign(account, { features: [SolanaSignMessage] });
        Object.assign(wallet, { accounts: [account, otherAccount] });
        change({ accounts: wallet.accounts, features: wallet.features });
        expect('derivePrivacySeed' in adapter).toBe(false);
    });

    it('sets the optional method only after connecting and deletes it when disconnected', async () => {
        await adapter.disconnect();
        expect('derivePrivacySeed' in adapter).toBe(false);
        await adapter.connect();
        expect(typeof adapter.derivePrivacySeed).toBe('function');
    });

    it('checks connection state again when a saved callback is invoked', async () => {
        const derive = adapter.derivePrivacySeed?.bind(adapter);
        await adapter.disconnect();
        await expect(derive?.({ protocol: 'tspp-v1' })).rejects.toThrow(WalletNotConnectedError);
        expect(deriveSeed).not.toHaveBeenCalled();
        expect(onError).toHaveBeenCalledTimes(1);
    });

    it('rejects an unknown protocol at runtime before contacting the wallet', async () => {
        await expect(
            adapter.derivePrivacySeed?.({ protocol: 'unknown' } as unknown as DerivePrivacySeedInput)
        ).rejects.toThrow(WalletConfigError);
        expect(deriveSeed).not.toHaveBeenCalled();
    });

    it('rechecks account capabilities when a saved callback is invoked', async () => {
        const derive = adapter.derivePrivacySeed?.bind(adapter);
        Object.assign(account, { features: [] });
        change({ features: wallet.features });
        await expect(derive?.({ protocol: 'tspp-v1' })).rejects.toThrow(WalletAccountError);
        expect(deriveSeed).not.toHaveBeenCalled();
    });

    it('rechecks the feature version when a saved callback is invoked', async () => {
        const derive = adapter.derivePrivacySeed?.bind(adapter);
        Object.assign(feature, { version: '2.0.0' });
        change({ features: wallet.features });
        await expect(derive?.({ protocol: 'tspp-v1' })).rejects.toThrow(WalletConfigError);
        expect(deriveSeed).not.toHaveBeenCalled();
    });

    it('rechecks feature presence when a saved callback is invoked', async () => {
        const derive = adapter.derivePrivacySeed?.bind(adapter);
        Reflect.deleteProperty(wallet.features, TSPPDeriveSeed);
        change({ features: wallet.features });
        await expect(derive?.({ protocol: 'tspp-v1' })).rejects.toThrow(WalletConfigError);
        expect(deriveSeed).not.toHaveBeenCalled();
    });

    it.each([undefined, {}, { derivationSeed: new Uint8Array(32) }, { derivationSeed: Array(64).fill(7) }])(
        'rejects malformed wallet output (%p)',
        async (output) => {
            deriveSeed.mockResolvedValue(output);
            await expect(adapter.derivePrivacySeed?.({ protocol: 'tspp-v1' })).rejects.toThrow(
                WalletDerivePrivacySeedError
            );
            expect(onError).toHaveBeenCalledTimes(1);
        }
    );

    it('discards the result if the account changes during approval', async () => {
        deriveSeed.mockImplementation(async () => {
            Object.assign(wallet, { accounts: [{ ...account, address: PublicKey.default.toBase58() }] });
            change({ accounts: wallet.accounts });
            return { derivationSeed: new Uint8Array(64) };
        });
        await expect(adapter.derivePrivacySeed?.({ protocol: 'tspp-v1' })).rejects.toThrow(WalletAccountError);
        expect(onError).toHaveBeenCalledTimes(1);
    });

    it('keeps the result if the wallet replaces the account object with the same address', async () => {
        deriveSeed.mockImplementation(async () => {
            Object.assign(wallet, { accounts: [{ ...account }] });
            change({ accounts: wallet.accounts });
            return { derivationSeed: new Uint8Array(64).fill(7) };
        });
        await expect(adapter.derivePrivacySeed?.({ protocol: 'tspp-v1' })).resolves.toEqual({
            derivationSeed: new Uint8Array(64).fill(7),
        });
        expect(onError).not.toHaveBeenCalled();
    });

    it('accepts a Uint8Array from another realm', async () => {
        const foreign = runInNewContext('new Uint8Array(64).fill(7)') as Uint8Array;
        expect(foreign instanceof Uint8Array).toBe(false);
        deriveSeed.mockResolvedValue({ derivationSeed: foreign });
        const output = await adapter.derivePrivacySeed?.({ protocol: 'tspp-v1' });
        expect(output?.derivationSeed).toEqual(new Uint8Array(64).fill(7));
        expect(output?.derivationSeed instanceof Uint8Array).toBe(true);
    });

    it('discards the result if the wallet disconnects while prompting', async () => {
        deriveSeed.mockImplementation(async () => {
            await adapter.disconnect();
            return { derivationSeed: new Uint8Array(64) };
        });
        await expect(adapter.derivePrivacySeed?.({ protocol: 'tspp-v1' })).rejects.toThrow(WalletNotConnectedError);
        expect(onError).toHaveBeenCalledTimes(1);
    });

    it.each([new Error('secret material'), new WalletError('secret material', new Uint8Array(64))])(
        'propagates denial without retrying or exposing wallet error details (%p)',
        async (cause) => {
            deriveSeed.mockRejectedValue(cause);
            const result = adapter.derivePrivacySeed?.({ protocol: 'tspp-v1' });
            await expect(result).rejects.toThrow('Wallet denied or failed privacy seed derivation');
            expect(deriveSeed).toHaveBeenCalledTimes(1);
            expect(signMessage).not.toHaveBeenCalled();
            expect(onError).toHaveBeenCalledTimes(1);
            const error = onError.mock.calls.at(0)?.at(0);
            expect(error).toBeInstanceOf(WalletDerivePrivacySeedError);
            expect(error.error).toBeUndefined();
            expect(error.cause).toBeUndefined();
            await expect(result).rejects.toBe(error);
        }
    );
});

describe('SolanaWalletAdapterWallet privacy feature', () => {
    class LegacyAdapter extends BaseWalletAdapter {
        name = 'Legacy wallet' as WalletName;
        url = 'https://example.com';
        icon = 'data:image/png;base64,';
        readyState = WalletReadyState.Installed;
        publicKey: PublicKey | null = publicKey;
        connecting = false;
        supportedTransactionVersions = null;
        sendTransaction = jest.fn();
        signMessage = jest.fn();
        derivePrivacySeed?: (input: DerivePrivacySeedInput) => Promise<{ derivationSeed: Uint8Array }> = jest.fn(
            async () => ({ derivationSeed: new Uint8Array(64).fill(9) })
        );

        async connect(): Promise<void> {
            this.publicKey = publicKey;
            this.emit('connect', publicKey);
        }

        async disconnect(): Promise<void> {
            this.publicKey = null;
            this.emit('disconnect');
        }
    }

    let legacy: LegacyAdapter;
    let wallet: SolanaWalletAdapterWallet;

    beforeEach(() => {
        legacy = new LegacyAdapter();
        wallet = new SolanaWalletAdapterWallet(legacy, 'solana:devnet');
    });

    afterEach(() => wallet.destroy());

    function getInput() {
        const account = wallet.accounts[0];
        if (!account) throw new Error('Missing test account');
        return { account, protocol: 'tspp-v1' as const };
    }

    it('advertises the feature on both the wallet and account', () => {
        expect(wallet.features[TSPPDeriveSeed]?.version).toBe('1.0.0');
        expect(wallet.accounts[0]?.features).toContain(TSPPDeriveSeed);
    });

    it('does not advertise the feature if the wrapped adapter lacks the method', () => {
        delete legacy.derivePrivacySeed;
        const unsupported = new SolanaWalletAdapterWallet(legacy, 'solana:devnet');
        expect(unsupported.features[TSPPDeriveSeed]).toBeUndefined();
        expect(unsupported.accounts[0]?.features).not.toContain(TSPPDeriveSeed);
        unsupported.destroy();
    });

    it('calls the legacy method with its adapter as this and forwards only the protocol', async () => {
        legacy.derivePrivacySeed = jest.fn(async function (this: LegacyAdapter, input: DerivePrivacySeedInput) {
            expect(this).toBe(legacy);
            expect(input).toEqual({ protocol: 'tspp-v1' });
            return { derivationSeed: new Uint8Array(64).fill(9) };
        });
        await expect(
            wallet.features[TSPPDeriveSeed]?.deriveSeed({
                ...getInput(),
                origin: 'https://trusted.example',
                approved: true,
            } as ReturnType<typeof getInput>)
        ).resolves.toEqual({ derivationSeed: new Uint8Array(64).fill(9) });
    });

    it('rejects an account not issued by this wallet', async () => {
        const input = getInput();
        await expect(
            wallet.features[TSPPDeriveSeed]?.deriveSeed({
                ...input,
                account: {
                    address: input.account.address,
                    publicKey: input.account.publicKey,
                    chains: input.account.chains,
                    features: input.account.features,
                },
            })
        ).rejects.toThrow(WalletAccountError);
        expect(legacy.derivePrivacySeed).not.toHaveBeenCalled();
    });

    it('rejects an unsupported protocol before calling the legacy adapter', async () => {
        await expect(
            wallet.features[TSPPDeriveSeed]?.deriveSeed({ ...getInput(), protocol: 'unknown' } as unknown as ReturnType<
                typeof getInput
            >)
        ).rejects.toThrow(WalletConfigError);
        expect(legacy.derivePrivacySeed).not.toHaveBeenCalled();
    });

    it('rejects a saved feature callback after disconnecting', async () => {
        const feature = wallet.features[TSPPDeriveSeed];
        const input = getInput();
        await legacy.disconnect();
        await expect(feature?.deriveSeed(input)).rejects.toThrow(WalletNotConnectedError);
        expect(legacy.derivePrivacySeed).not.toHaveBeenCalled();
    });

    it('round-trips through StandardWalletAdapter without calling signMessage', async () => {
        // The published wallet-adapter-base types predate this workspace's feature types.
        const adapter = new StandardWalletAdapter({
            wallet: wallet as unknown as WalletAdapterCompatibleStandardWallet,
        });
        await adapter.connect();
        await expect(adapter.derivePrivacySeed?.({ protocol: 'tspp-v1' })).resolves.toEqual({
            derivationSeed: new Uint8Array(64).fill(9),
        });
        expect(legacy.derivePrivacySeed).toHaveBeenCalledWith({ protocol: 'tspp-v1' });
        expect(legacy.signMessage).not.toHaveBeenCalled();
        adapter.destroy();
    });
});
