import { Protocol } from '@uniswap/router-sdk';
interface ProtocolsBucketBlockNumberArgs {
    protocols: Protocol[];
    bucket: number;
    blockNumber?: number;
}
/**
 * Class used to model the sort key of the CachedRoutes cache database.
 */
export declare class ProtocolsBucketBlockNumber {
    private protocols;
    private bucket;
    private blockNumber?;
    constructor({ protocols, bucket, blockNumber }: ProtocolsBucketBlockNumberArgs);
    fullKey(): string;
    protocolsBucketPartialKey(): string;
}
export {};
