import { CachingTokenListProvider, ChainId, ITokenListProvider, ITokenProvider } from '@tartz-one/smart-order-router';
export declare class AWSTokenListProvider extends CachingTokenListProvider {
    static fromTokenListS3Bucket(chainId: ChainId, bucket: string, tokenListURI: string): Promise<ITokenListProvider & ITokenProvider>;
}
