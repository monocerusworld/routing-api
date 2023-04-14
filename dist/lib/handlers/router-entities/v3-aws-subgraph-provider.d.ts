import { ChainId, IV3SubgraphProvider, V3SubgraphPool, V3SubgraphProvider } from '@tartz-one/smart-order-router';
export declare class V3AWSSubgraphProviderWithFallback extends V3SubgraphProvider implements IV3SubgraphProvider {
    private chain;
    private bucket;
    private key;
    constructor(chain: ChainId, bucket: string, key: string);
    getPools(): Promise<V3SubgraphPool[]>;
}
