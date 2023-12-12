import { Ether, NativeCurrency, Token } from '@uniswap/sdk-core';
export declare enum ChainId {
    MAINNET = 1,
    MANTA = 169,
    MANTA_TESTNET = 3441005
}
export declare const SUPPORTED_CHAINS: ChainId[];
export declare const V2_SUPPORTED: ChainId[];
export declare const HAS_L1_FEE: ChainId[];
export declare const NETWORKS_WITH_SAME_UNISWAP_ADDRESSES: ChainId[];
export declare const ID_TO_CHAIN_ID: (id: number) => ChainId;
export declare enum ChainName {
    MAINNET = "mainnet",
    MANTA = "manta",
    MANTA_TESTNET = "manta-testnet"
}
export declare enum NativeCurrencyName {
    ETHER = "ETH",
    MANTA = "ETH",
    MANTA_TESTNET = "MANTA"
}
export declare const NATIVE_NAMES_BY_ID: {
    [chainId: number]: string[];
};
export declare const NATIVE_CURRENCY: {
    [chainId: number]: NativeCurrencyName;
};
export declare const ID_TO_NETWORK_NAME: (id: number) => ChainName;
export declare const CHAIN_IDS_LIST: string[];
export declare const ID_TO_PROVIDER: (id: ChainId) => string;
export declare const WRAPPED_NATIVE_CURRENCY: {
    [chainId in ChainId]: Token;
};
export declare class ExtendedEther extends Ether {
    get wrapped(): Token;
    private static _cachedExtendedEther;
    static onChain(chainId: number): ExtendedEther;
}
export declare function nativeOnChain(chainId: number): NativeCurrency;
