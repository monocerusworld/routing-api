import { ChainId, IGasPriceProvider, IMetric, Simulator, ITokenListProvider, ITokenProvider, IV2PoolProvider, IV2SubgraphProvider, IV3PoolProvider, IV3SubgraphProvider, OnChainQuoteProvider, UniswapMulticallProvider, V2QuoteProvider, IRouteCachingProvider } from '@tartz-one/smart-order-router';
import { ethers } from 'ethers';
import { BaseRInj, Injector } from './handler';
export declare const SUPPORTED_CHAINS: ChainId[];
export interface RequestInjected<Router> extends BaseRInj {
    chainId: ChainId;
    metric: IMetric;
    v3PoolProvider: IV3PoolProvider;
    v2PoolProvider: IV2PoolProvider;
    tokenProvider: ITokenProvider;
    tokenListProvider: ITokenListProvider;
    router: Router;
}
export type ContainerDependencies = {
    provider: ethers.providers.JsonRpcProvider;
    v3SubgraphProvider: IV3SubgraphProvider;
    v2SubgraphProvider: IV2SubgraphProvider;
    tokenListProvider: ITokenListProvider;
    gasPriceProvider: IGasPriceProvider;
    tokenProviderFromTokenList: ITokenProvider;
    blockedTokenListProvider: ITokenListProvider;
    v3PoolProvider: IV3PoolProvider;
    v2PoolProvider: IV2PoolProvider;
    tokenProvider: ITokenProvider;
    multicallProvider: UniswapMulticallProvider;
    onChainQuoteProvider?: OnChainQuoteProvider;
    v2QuoteProvider: V2QuoteProvider;
    simulator: Simulator;
    routeCachingProvider?: IRouteCachingProvider;
};
export interface ContainerInjected {
    dependencies: {
        [chainId in ChainId]?: ContainerDependencies;
    };
}
export declare abstract class InjectorSOR<Router, QueryParams> extends Injector<ContainerInjected, RequestInjected<Router>, void, QueryParams> {
    buildContainerInjected(): Promise<ContainerInjected>;
}
