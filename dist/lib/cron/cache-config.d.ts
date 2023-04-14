import { Protocol } from '@uniswap/router-sdk';
import { ChainId, V2SubgraphProvider, V3SubgraphProvider } from '@tartz-one/smart-order-router';
export declare const chainProtocols: ({
    protocol: Protocol;
    chainId: ChainId;
    timeout: number;
    provider: V3SubgraphProvider;
} | {
    protocol: Protocol;
    chainId: ChainId;
    timeout: number;
    provider: V2SubgraphProvider;
})[];
