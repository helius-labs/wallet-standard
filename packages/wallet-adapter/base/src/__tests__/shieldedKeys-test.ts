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
    type TSPPDecryptRequest,
    type TSPPDeriveRequest,
    TSPPShieldedKeys,
    type TSPPShieldedKeysFeature,
} from '@solana/wallet-standard-features';
import { PublicKey } from '@solana/web3.js';
import { runInNewContext } from 'node:vm';
import type { WalletAccount } from '@wallet-standard/base';
import { StandardConnect, StandardEvents, type StandardEventsListeners } from '@wallet-standard/features';
import { StandardWalletAdapter } from '../adapter.js';
import {
    type DecryptShieldedInput,
    type DecryptShieldedOutput,
    type DeriveShieldedInput,
    type DeriveShieldedOutput,
    type GetShieldedPublicKeysInput,
    type GetShieldedPublicKeysOutput,
    WalletShieldedKeysError,
} from '../shieldedKeys.js';
import { SolanaWalletAdapterWallet } from '../wallet.js';

const publicKey = new PublicKey('Foo11111111111111111111111111111111111111111');
const protocol = 'tspp-v1' as const;

function taggedKey(fill: number): Uint8Array {
    const key = new Uint8Array(33).fill(fill);
    key[0] = 0x04;
    return key;
}

function shieldedAddress(viewingPublicKey: Uint8Array): Uint8Array {
    const address = new Uint8Array(99).fill(1);
    address.set(viewingPublicKey, 66);
    return address;
}

const publicKeys: GetShieldedPublicKeysOutput = {
    shieldedAddress: shieldedAddress(taggedKey(2)),
    viewingPublicKeys: [taggedKey(2), taggedKey(3)],
};

function decryptRequest(overrides: Partial<Record<keyof TSPPDecryptRequest, unknown>> = {}): TSPPDecryptRequest {
    return {
        ciphertext: new Uint8Array(13).fill(5),
        viewingPublicKey: taggedKey(2),
        txViewingPublicKey: taggedKey(4),
        salt: new Uint8Array(16),
        slotIndex: 0,
        label: 'transfer',
        ...overrides,
    } as TSPPDecryptRequest;
}

const deriveRequests: TSPPDeriveRequest[] = [
    { kind: 'nullifier', utxoHash: new Uint8Array(32).fill(1), blinding: new Uint8Array(32).fill(2) },
    { kind: 'mergeOutputKey', firstNullifier: new Uint8Array(32).fill(3) },
    { kind: 'mergeOutputBlinding', firstNullifier: new Uint8Array(32).fill(4) },
];

describe('StandardWalletAdapter shielded keys', () => {
    let adapter: StandardWalletAdapter;
    let wallet: WalletAdapterCompatibleStandardWallet;
    let account: WalletAccount;
    let getPublicKeys: jest.Mock;
    let decrypt: jest.Mock;
    let derive: jest.Mock;
    let signMessage: jest.Mock;
    let onError: jest.Mock;
    let feature: TSPPShieldedKeysFeature[typeof TSPPShieldedKeys];
    let change: StandardEventsListeners['change'];

    const methods = ['getShieldedPublicKeys', 'decryptShielded', 'deriveShielded'] as const;

    beforeEach(async () => {
        account = {
            address: publicKey.toBase58(),
            publicKey: publicKey.toBytes(),
            chains: ['solana:devnet'],
            features: [TSPPShieldedKeys, SolanaSignMessage, SolanaSignTransaction],
        };
        getPublicKeys = jest.fn().mockResolvedValue(publicKeys);
        decrypt = jest.fn(async ({ requests }: { requests: TSPPDecryptRequest[] }) => ({
            plaintexts: requests.map((request) => new Uint8Array(request.ciphertext.length).fill(6)),
        }));
        derive = jest.fn(async ({ requests }: { requests: TSPPDeriveRequest[] }) => ({
            values: requests.map(() => new Uint8Array(32).fill(8)),
        }));
        signMessage = jest.fn();
        feature = { version: '1.0.0', getPublicKeys, decrypt, derive };
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
                ...{ [TSPPShieldedKeys]: feature },
            },
        };
        adapter = new StandardWalletAdapter({ wallet });
        onError = jest.fn();
        adapter.on('error', onError);
        await adapter.connect();
    });

    afterEach(() => adapter.destroy());

    function expectNoMethods() {
        for (const method of methods) expect(method in adapter).toBe(false);
    }

    function expectNoWalletCalls() {
        expect(getPublicKeys).not.toHaveBeenCalled();
        expect(decrypt).not.toHaveBeenCalled();
        expect(derive).not.toHaveBeenCalled();
    }

    describe('feature detection', () => {
        it('exposes all three methods after connecting', () => {
            for (const method of methods) expect(typeof adapter[method]).toBe('function');
        });

        it.each([
            undefined,
            null,
            {},
            { version: '2.0.0', getPublicKeys: jest.fn(), decrypt: jest.fn(), derive: jest.fn() },
            { version: '1.0.0', getPublicKeys: jest.fn(), decrypt: jest.fn() },
        ])('does not expose unsupported or malformed features (%p)', (unsupportedFeature) => {
            Object.assign(wallet.features, { [TSPPShieldedKeys]: unsupportedFeature });
            change({ features: wallet.features });
            expectNoMethods();
        });

        it('does not expose the methods for an account without the feature', () => {
            Object.assign(account, { features: [SolanaSignMessage] });
            change({ features: wallet.features });
            expectNoMethods();
        });

        it('does not use another account that advertises the feature', () => {
            const otherAccount = { ...account, address: PublicKey.default.toBase58() };
            Object.assign(account, { features: [SolanaSignMessage] });
            Object.assign(wallet, { accounts: [account, otherAccount] });
            change({ accounts: wallet.accounts, features: wallet.features });
            expectNoMethods();
        });

        it('deletes the methods when disconnected and sets them again on connect', async () => {
            await adapter.disconnect();
            expectNoMethods();
            await adapter.connect();
            for (const method of methods) expect(typeof adapter[method]).toBe('function');
        });
    });

    describe('getShieldedPublicKeys()', () => {
        it('passes the connected account and returns copies of the public keys', async () => {
            const output = await adapter.getShieldedPublicKeys?.({ protocol });
            expect(output).toEqual(publicKeys);
            expect(output?.shieldedAddress).not.toBe(publicKeys.shieldedAddress);
            expect(output?.viewingPublicKeys[0]).not.toBe(publicKeys.viewingPublicKeys[0]);
            expect(getPublicKeys).toHaveBeenCalledWith({ account, protocol });
            expect(signMessage).not.toHaveBeenCalled();
        });

        it.each([
            undefined,
            {},
            { ...publicKeys, shieldedAddress: new Uint8Array(98) },
            { ...publicKeys, viewingPublicKeys: [] },
            { ...publicKeys, viewingPublicKeys: [new Uint8Array(33)] },
            { ...publicKeys, viewingPublicKeys: [new Uint8Array(32).fill(4)] },
            { ...publicKeys, shieldedAddress: Array.from(publicKeys.shieldedAddress) },
            { ...publicKeys, viewingPublicKeys: [taggedKey(3), taggedKey(2)] },
            { ...publicKeys, viewingPublicKeys: [taggedKey(2), new Uint8Array(33)] },
        ])('rejects malformed wallet output (%p)', async (output) => {
            getPublicKeys.mockResolvedValue(output);
            await expect(adapter.getShieldedPublicKeys?.({ protocol })).rejects.toThrow(WalletShieldedKeysError);
            expect(onError).toHaveBeenCalledTimes(1);
        });
    });

    describe('decryptShielded()', () => {
        it('forwards the requests with the connected account and returns copies', async () => {
            const requests = [decryptRequest(), decryptRequest({ label: 'ringDeposit' })];
            const output = await adapter.decryptShielded?.({ protocol, requests });
            expect(output).toEqual({ plaintexts: [new Uint8Array(13).fill(6), new Uint8Array(13).fill(6)] });
            expect(decrypt).toHaveBeenCalledWith({ account, protocol, requests });
        });

        it('forwards an empty batch so the wallet keeps control of the prompt', async () => {
            await expect(adapter.decryptShielded?.({ protocol, requests: [] })).resolves.toEqual({ plaintexts: [] });
            expect(decrypt).toHaveBeenCalledTimes(1);
        });

        it.each([
            ['Uint8Array', new Uint8Array(64).fill(6)],
            ['Buffer', Buffer.alloc(64, 6)],
        ])('returns a copy that does not expose the wallet buffer (%s)', async (_name, backing) => {
            decrypt.mockResolvedValue({ plaintexts: [backing.subarray(10, 23)] });
            const output = await adapter.decryptShielded?.({ protocol, requests: [decryptRequest()] });
            expect(output?.plaintexts[0]?.buffer).not.toBe(backing.buffer);
            output?.plaintexts[0]?.fill(0);
            expect(backing.every((byte) => byte === 6)).toBe(true);
        });

        it.each([
            ['requests not an array', undefined],
            ['null request', [null]],
            ['ciphertext not bytes', [decryptRequest({ ciphertext: [1, 2, 3] })]],
            ['short viewing key', [decryptRequest({ viewingPublicKey: new Uint8Array(32).fill(4) })]],
            ['untagged viewing key', [decryptRequest({ viewingPublicKey: new Uint8Array(33) })]],
            ['untagged tx viewing key', [decryptRequest({ txViewingPublicKey: new Uint8Array(33).fill(5) })]],
            ['short salt', [decryptRequest({ salt: new Uint8Array(15) })]],
            ['negative slot', [decryptRequest({ slotIndex: -1 })]],
            ['fractional slot', [decryptRequest({ slotIndex: 1.5 })]],
            ['slot above u32', [decryptRequest({ slotIndex: 2 ** 32 })]],
            ['unknown label', [decryptRequest({ label: 'merge' })]],
            ['ring deposit with nonzero slot', [decryptRequest({ label: 'ringDeposit', slotIndex: 1 })]],
            ['one bad request in a batch', [decryptRequest(), decryptRequest({ salt: new Uint8Array(17) })]],
        ])('rejects malformed input before contacting the wallet (%s)', async (_name, requests) => {
            await expect(
                adapter.decryptShielded?.({ protocol, requests } as unknown as DecryptShieldedInput)
            ).rejects.toThrow(WalletConfigError);
            expectNoWalletCalls();
            expect(onError).toHaveBeenCalledTimes(1);
        });

        it.each([
            ['missing output', undefined],
            ['plaintexts not an array', { plaintexts: new Uint8Array(13) }],
            ['too few plaintexts', { plaintexts: [] }],
            ['too many plaintexts', { plaintexts: [new Uint8Array(13), new Uint8Array(13)] }],
            ['wrong length', { plaintexts: [new Uint8Array(12)] }],
            ['not bytes', { plaintexts: [Array(13).fill(0)] }],
        ])('rejects malformed wallet output (%s)', async (_name, output) => {
            decrypt.mockResolvedValue(output);
            await expect(adapter.decryptShielded?.({ protocol, requests: [decryptRequest()] })).rejects.toThrow(
                WalletShieldedKeysError
            );
            expect(onError).toHaveBeenCalledTimes(1);
        });

        it('passes the wallet a copy of the validated requests, not the caller objects', async () => {
            const ciphertext = new Uint8Array(13).fill(5);
            let reads = 0;
            const request = {
                ...decryptRequest({ ciphertext }),
                get slotIndex() {
                    reads += 1;
                    return reads === 1 ? 0 : 5;
                },
                get label() {
                    return reads <= 1 ? 'transfer' : 'ringDeposit';
                },
            };
            await adapter.decryptShielded?.({ protocol, requests: [request] as unknown as TSPPDecryptRequest[] });
            const forwarded = decrypt.mock.calls[0]?.[0]?.requests?.[0];
            expect(forwarded).not.toBe(request);
            expect(forwarded.ciphertext).not.toBe(ciphertext);
            expect(forwarded).toEqual({ ...decryptRequest({ ciphertext }), slotIndex: 0, label: 'transfer' });
            expect(Object.getOwnPropertyDescriptor(forwarded, 'slotIndex')?.get).toBeUndefined();
        });

        it.each([
            ['spoofed toStringTag', { [Symbol.toStringTag]: 'Uint8Array', length: 13 }],
            ['DataView', new DataView(new ArrayBuffer(13))],
        ])('rejects a ciphertext that only looks like a Uint8Array (%s)', async (_name, ciphertext) => {
            await expect(
                adapter.decryptShielded?.({
                    protocol,
                    requests: [decryptRequest({ ciphertext })],
                })
            ).rejects.toThrow(WalletConfigError);
            expectNoWalletCalls();
        });

        it('accepts a Uint8Array from another realm', async () => {
            const foreign = runInNewContext('new Uint8Array(13).fill(6)') as Uint8Array;
            expect(foreign instanceof Uint8Array).toBe(false);
            decrypt.mockResolvedValue({ plaintexts: [foreign] });
            const output = await adapter.decryptShielded?.({ protocol, requests: [decryptRequest()] });
            expect(output?.plaintexts[0]).toEqual(new Uint8Array(13).fill(6));
            expect(output?.plaintexts[0] instanceof Uint8Array).toBe(true);
        });
    });

    describe('deriveShielded()', () => {
        it('forwards the read-side kinds with the connected account and returns copies', async () => {
            const output = await adapter.deriveShielded?.({ protocol, requests: deriveRequests });
            expect(output).toEqual({ values: deriveRequests.map(() => new Uint8Array(32).fill(8)) });
            expect(derive).toHaveBeenCalledWith({ account, protocol, requests: deriveRequests });
        });

        it.each([
            ['requests not an array', undefined],
            [
                'build-only mergeDummyNullifier',
                [{ kind: 'mergeDummyNullifier', firstNullifier: new Uint8Array(32), slotIndex: 0 }],
            ],
            [
                'build-only mergePrivateTxBlinding',
                [{ kind: 'mergePrivateTxBlinding', firstNullifier: new Uint8Array(32) }],
            ],
            ['unknown kind', [{ kind: 'viewingKey' }]],
            ['short utxo hash', [{ kind: 'nullifier', utxoHash: new Uint8Array(31), blinding: new Uint8Array(32) }]],
            ['missing blinding', [{ kind: 'nullifier', utxoHash: new Uint8Array(32) }]],
            ['short first nullifier', [{ kind: 'mergeOutputKey', firstNullifier: new Uint8Array(33) }]],
            ['first nullifier not bytes', [{ kind: 'mergeOutputBlinding', firstNullifier: Array(32).fill(0) }]],
        ])('rejects malformed input before contacting the wallet (%s)', async (_name, requests) => {
            await expect(
                adapter.deriveShielded?.({ protocol, requests } as unknown as DeriveShieldedInput)
            ).rejects.toThrow(WalletConfigError);
            expectNoWalletCalls();
        });

        it.each([
            ['missing output', undefined],
            ['too few values', { values: [new Uint8Array(32)] }],
            ['wrong width', { values: deriveRequests.map(() => new Uint8Array(31)) }],
        ])('rejects malformed wallet output (%s)', async (_name, output) => {
            derive.mockResolvedValue(output);
            await expect(adapter.deriveShielded?.({ protocol, requests: deriveRequests })).rejects.toThrow(
                WalletShieldedKeysError
            );
        });
    });

    describe('shared checks', () => {
        const calls = {
            getShieldedPublicKeys: (a: StandardWalletAdapter, p: unknown) =>
                a.getShieldedPublicKeys?.({ protocol: p } as GetShieldedPublicKeysInput),
            decryptShielded: (a: StandardWalletAdapter, p: unknown) =>
                a.decryptShielded?.({ protocol: p, requests: [decryptRequest()] } as DecryptShieldedInput),
            deriveShielded: (a: StandardWalletAdapter, p: unknown) =>
                a.deriveShielded?.({ protocol: p, requests: deriveRequests } as DeriveShieldedInput),
        };
        const walletMethod = {
            getShieldedPublicKeys: 'getPublicKeys',
            decryptShielded: 'decrypt',
            deriveShielded: 'derive',
        } as const;
        const cases = methods.map((method) => [method] as const);

        it.each(cases)('%s rejects an unknown protocol before contacting the wallet', async (method) => {
            await expect(calls[method](adapter, 'unknown')).rejects.toThrow(WalletConfigError);
            expectNoWalletCalls();
        });

        it.each(cases)('%s checks connection state again on a saved callback', async (method) => {
            const saved = adapter[method]?.bind(adapter);
            await adapter.disconnect();
            Object.assign(adapter, { [method]: saved });
            await expect(calls[method](adapter, protocol)).rejects.toThrow(WalletNotConnectedError);
            expectNoWalletCalls();
            expect(onError).toHaveBeenCalledTimes(1);
        });

        it.each(cases)('%s rechecks account capabilities on a saved callback', async (method) => {
            const saved = adapter[method]?.bind(adapter);
            Object.assign(account, { features: [] });
            change({ features: wallet.features });
            Object.assign(adapter, { [method]: saved });
            await expect(calls[method](adapter, protocol)).rejects.toThrow(WalletAccountError);
            expectNoWalletCalls();
        });

        it.each(cases)('%s rechecks the feature version on a saved callback', async (method) => {
            const saved = adapter[method]?.bind(adapter);
            Object.assign(feature, { version: '2.0.0' });
            change({ features: wallet.features });
            Object.assign(adapter, { [method]: saved });
            await expect(calls[method](adapter, protocol)).rejects.toThrow(WalletConfigError);
            expectNoWalletCalls();
        });

        it.each(cases)('%s discards the result if the account changes during approval', async (method) => {
            const mock = { getPublicKeys, decrypt, derive }[walletMethod[method]];
            const original = mock.getMockImplementation();
            mock.mockImplementation(async (input: unknown) => {
                Object.assign(wallet, { accounts: [{ ...account, address: PublicKey.default.toBase58() }] });
                change({ accounts: wallet.accounts });
                return original ? original(input) : publicKeys;
            });
            await expect(calls[method](adapter, protocol)).rejects.toThrow(WalletAccountError);
            expect(onError).toHaveBeenCalledTimes(1);
        });

        it.each(cases)('%s keeps the result if the wallet replaces the account object', async (method) => {
            const mock = { getPublicKeys, decrypt, derive }[walletMethod[method]];
            const original = mock.getMockImplementation();
            mock.mockImplementation(async (input: unknown) => {
                Object.assign(wallet, { accounts: [{ ...account }] });
                change({ accounts: wallet.accounts });
                return original ? original(input) : publicKeys;
            });
            await expect(calls[method](adapter, protocol)).resolves.toBeDefined();
            expect(onError).not.toHaveBeenCalled();
        });

        it.each(cases)('%s discards the result if the wallet disconnects while prompting', async (method) => {
            const mock = { getPublicKeys, decrypt, derive }[walletMethod[method]];
            mock.mockImplementation(async () => {
                await adapter.disconnect();
                return publicKeys;
            });
            await expect(calls[method](adapter, protocol)).rejects.toThrow(WalletNotConnectedError);
            expect(onError).toHaveBeenCalledTimes(1);
        });

        it.each(
            methods.flatMap((method) => [
                [method, new Error('secret material')] as const,
                [method, new WalletError('secret material', new Uint8Array(32))] as const,
            ])
        )('%s drops wallet error details (%p)', async (method, cause) => {
            const mock = { getPublicKeys, decrypt, derive }[walletMethod[method]];
            mock.mockRejectedValue(cause);
            const result = calls[method](adapter, protocol);
            await expect(result).rejects.toThrow('Wallet denied or failed the shielded keys request');
            expect(mock).toHaveBeenCalledTimes(1);
            expect(signMessage).not.toHaveBeenCalled();
            const error = onError.mock.calls.at(0)?.at(0);
            expect(error).toBeInstanceOf(WalletShieldedKeysError);
            expect(error.message).not.toContain('secret');
            expect(error.error).toBeUndefined();
            await expect(result).rejects.toBe(error);
        });
    });
});

describe('SolanaWalletAdapterWallet shielded keys feature', () => {
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
        getShieldedPublicKeys?: (input: GetShieldedPublicKeysInput) => Promise<GetShieldedPublicKeysOutput> = jest.fn(
            async () => publicKeys
        );
        decryptShielded?: (input: DecryptShieldedInput) => Promise<DecryptShieldedOutput> = jest.fn(
            async ({ requests }) => ({ plaintexts: requests.map((r) => new Uint8Array(r.ciphertext.length).fill(9)) })
        );
        deriveShielded?: (input: DeriveShieldedInput) => Promise<DeriveShieldedOutput> = jest.fn(
            async ({ requests }) => ({ values: requests.map(() => new Uint8Array(32).fill(9)) })
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

    function getAccount() {
        const account = wallet.accounts[0];
        if (!account) throw new Error('Missing test account');
        return account;
    }

    it('advertises the feature on both the wallet and account', () => {
        expect(wallet.features[TSPPShieldedKeys]?.version).toBe('1.0.0');
        expect(getAccount().features).toContain(TSPPShieldedKeys);
    });

    it('does not advertise the feature if the adapter lacks any method', () => {
        delete legacy.deriveShielded;
        const unsupported = new SolanaWalletAdapterWallet(legacy, 'solana:devnet');
        expect(unsupported.features[TSPPShieldedKeys]).toBeUndefined();
        expect(unsupported.accounts[0]?.features).not.toContain(TSPPShieldedKeys);
        unsupported.destroy();
    });

    it('calls the legacy methods with the adapter as this and without the account', async () => {
        const feature = wallet.features[TSPPShieldedKeys];
        const account = getAccount();
        const requests = [decryptRequest()];
        await feature?.getPublicKeys({ account, protocol });
        await feature?.decrypt({ account, protocol, requests });
        await feature?.derive({ account, protocol, requests: deriveRequests });
        expect(legacy.getShieldedPublicKeys).toHaveBeenCalledWith({ protocol });
        expect(legacy.decryptShielded).toHaveBeenCalledWith({ protocol, requests });
        expect(legacy.deriveShielded).toHaveBeenCalledWith({ protocol, requests: deriveRequests });
        expect((legacy.decryptShielded as jest.Mock).mock.contexts[0]).toBe(legacy);
    });

    it('rejects an account not issued by this wallet', async () => {
        const account = getAccount();
        await expect(
            wallet.features[TSPPShieldedKeys]?.getPublicKeys({
                account: {
                    address: account.address,
                    publicKey: account.publicKey,
                    chains: account.chains,
                    features: account.features,
                },
                protocol,
            })
        ).rejects.toThrow(WalletAccountError);
        expect(legacy.getShieldedPublicKeys).not.toHaveBeenCalled();
    });

    it('rejects an unsupported protocol before calling the legacy adapter', async () => {
        await expect(
            wallet.features[TSPPShieldedKeys]?.derive({
                account: getAccount(),
                protocol: 'unknown',
                requests: deriveRequests,
            } as unknown as Parameters<TSPPShieldedKeysFeature[typeof TSPPShieldedKeys]['derive']>[0])
        ).rejects.toThrow(WalletConfigError);
        expect(legacy.deriveShielded).not.toHaveBeenCalled();
    });

    it('rejects a saved feature callback after disconnecting', async () => {
        const feature = wallet.features[TSPPShieldedKeys];
        const account = getAccount();
        await legacy.disconnect();
        await expect(feature?.decrypt({ account, protocol, requests: [decryptRequest()] })).rejects.toThrow(
            WalletNotConnectedError
        );
        expect(legacy.decryptShielded).not.toHaveBeenCalled();
    });

    it('round-trips through StandardWalletAdapter without calling signMessage', async () => {
        // The published wallet-adapter-base types predate this workspace's feature types.
        const adapter = new StandardWalletAdapter({
            wallet: wallet as unknown as WalletAdapterCompatibleStandardWallet,
        });
        await adapter.connect();
        await expect(adapter.getShieldedPublicKeys?.({ protocol })).resolves.toEqual(publicKeys);
        await expect(adapter.decryptShielded?.({ protocol, requests: [decryptRequest()] })).resolves.toEqual({
            plaintexts: [new Uint8Array(13).fill(9)],
        });
        await expect(adapter.deriveShielded?.({ protocol, requests: deriveRequests })).resolves.toEqual({
            values: deriveRequests.map(() => new Uint8Array(32).fill(9)),
        });
        expect(legacy.signMessage).not.toHaveBeenCalled();
        adapter.destroy();
    });
});
