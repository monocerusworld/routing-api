import { TradeType } from '@uniswap/sdk-core';
import { CacheMode, ChainId } from '@tartz-one/smart-order-router';
import { CachedRoutesStrategy } from './model/cached-routes-strategy';
import { PairTradeTypeChainId } from './model/pair-trade-type-chain-id';
import { CachedRoutesBucket } from './model/cached-routes-bucket';
/**
 * This is the main configuration for the caching strategies of routes.
 *
 * The keys are generated by calling the `toString` method in the `PairTradeTypeChainId` class,
 * this way we can guarantee the correct format of the key.
 *
 * The values are an object of type `CachedRoutesStrategy`.
 * which receive an array of `CachedRoutesParameters` with the configuration of the buckets.
 */
export const CACHED_ROUTES_CONFIGURATION = new Map([
    [
        new PairTradeTypeChainId({
            tokenIn: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
            tokenOut: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
            tradeType: TradeType.EXACT_INPUT,
            chainId: ChainId.MAINNET,
        }).toString(),
        new CachedRoutesStrategy({
            pair: 'WETH/USDC',
            tradeType: TradeType.EXACT_INPUT,
            chainId: ChainId.MAINNET,
            buckets: [
                new CachedRoutesBucket({ bucket: 1, blocksToLive: 1, cacheMode: CacheMode.Tapcompare }),
                new CachedRoutesBucket({ bucket: 2, blocksToLive: 1, cacheMode: CacheMode.Tapcompare }),
                new CachedRoutesBucket({ bucket: 3, blocksToLive: 1, cacheMode: CacheMode.Tapcompare }),
                new CachedRoutesBucket({ bucket: 5, blocksToLive: 1, cacheMode: CacheMode.Tapcompare }),
                new CachedRoutesBucket({ bucket: 8, blocksToLive: 1, cacheMode: CacheMode.Tapcompare }),
                new CachedRoutesBucket({ bucket: 13, blocksToLive: 1, cacheMode: CacheMode.Tapcompare }),
                new CachedRoutesBucket({ bucket: 21, blocksToLive: 1, cacheMode: CacheMode.Tapcompare }),
                new CachedRoutesBucket({ bucket: 34, blocksToLive: 1, cacheMode: CacheMode.Tapcompare }),
                new CachedRoutesBucket({ bucket: 55, blocksToLive: 1, cacheMode: CacheMode.Tapcompare }),
            ],
        }),
    ],
    [
        new PairTradeTypeChainId({
            tokenIn: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
            tokenOut: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
            tradeType: TradeType.EXACT_INPUT,
            chainId: ChainId.MAINNET,
        }).toString(),
        new CachedRoutesStrategy({
            pair: 'USDC/WETH',
            tradeType: TradeType.EXACT_INPUT,
            chainId: ChainId.MAINNET,
            buckets: [
                new CachedRoutesBucket({ bucket: 1000, blocksToLive: 1, cacheMode: CacheMode.Tapcompare }),
                new CachedRoutesBucket({ bucket: 2000, blocksToLive: 1, cacheMode: CacheMode.Tapcompare }),
                new CachedRoutesBucket({ bucket: 3000, blocksToLive: 1, cacheMode: CacheMode.Tapcompare }),
                new CachedRoutesBucket({ bucket: 8000, blocksToLive: 1, cacheMode: CacheMode.Tapcompare }),
                new CachedRoutesBucket({ bucket: 13000, blocksToLive: 1, cacheMode: CacheMode.Tapcompare }),
                new CachedRoutesBucket({ bucket: 21000, blocksToLive: 1, cacheMode: CacheMode.Tapcompare }),
                new CachedRoutesBucket({ bucket: 34000, blocksToLive: 1, cacheMode: CacheMode.Tapcompare }),
                new CachedRoutesBucket({ bucket: 55000, blocksToLive: 1, cacheMode: CacheMode.Tapcompare }),
                new CachedRoutesBucket({ bucket: 89000, blocksToLive: 1, cacheMode: CacheMode.Tapcompare }),
                new CachedRoutesBucket({ bucket: 144000, blocksToLive: 1, cacheMode: CacheMode.Tapcompare }),
                new CachedRoutesBucket({ bucket: 233000, blocksToLive: 1, cacheMode: CacheMode.Tapcompare }),
                new CachedRoutesBucket({ bucket: 377000, blocksToLive: 1, cacheMode: CacheMode.Tapcompare }),
                new CachedRoutesBucket({ bucket: 610000, blocksToLive: 1, cacheMode: CacheMode.Tapcompare }),
            ],
        }),
    ],
    [
        new PairTradeTypeChainId({
            tokenIn: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
            tokenOut: '*',
            tradeType: TradeType.EXACT_INPUT,
            chainId: ChainId.MAINNET,
        }).toString(),
        new CachedRoutesStrategy({
            pair: 'WETH/*',
            tradeType: TradeType.EXACT_INPUT,
            chainId: ChainId.MAINNET,
            buckets: [
                new CachedRoutesBucket({ bucket: 1, blocksToLive: 1, cacheMode: CacheMode.Tapcompare }),
                new CachedRoutesBucket({ bucket: 2, blocksToLive: 1, cacheMode: CacheMode.Tapcompare }),
                new CachedRoutesBucket({ bucket: 3, blocksToLive: 1, cacheMode: CacheMode.Tapcompare }),
                new CachedRoutesBucket({ bucket: 5, blocksToLive: 1, cacheMode: CacheMode.Tapcompare }),
            ],
        }),
    ],
]);
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY2FjaGVkLXJvdXRlcy1jb25maWd1cmF0aW9uLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vLi4vbGliL2hhbmRsZXJzL3JvdXRlci1lbnRpdGllcy9yb3V0ZS1jYWNoaW5nL2NhY2hlZC1yb3V0ZXMtY29uZmlndXJhdGlvbi50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxPQUFPLEVBQUUsU0FBUyxFQUFFLE1BQU0sbUJBQW1CLENBQUE7QUFDN0MsT0FBTyxFQUFFLFNBQVMsRUFBRSxPQUFPLEVBQUUsTUFBTSwrQkFBK0IsQ0FBQTtBQUNsRSxPQUFPLEVBQUUsb0JBQW9CLEVBQUUsTUFBTSxnQ0FBZ0MsQ0FBQTtBQUNyRSxPQUFPLEVBQUUsb0JBQW9CLEVBQUUsTUFBTSxrQ0FBa0MsQ0FBQTtBQUN2RSxPQUFPLEVBQUUsa0JBQWtCLEVBQUUsTUFBTSw4QkFBOEIsQ0FBQTtBQUVqRTs7Ozs7Ozs7R0FRRztBQUNILE1BQU0sQ0FBQyxNQUFNLDJCQUEyQixHQUFzQyxJQUFJLEdBQUcsQ0FBQztJQUNwRjtRQUNFLElBQUksb0JBQW9CLENBQUM7WUFDdkIsT0FBTyxFQUFFLDRDQUE0QztZQUNyRCxRQUFRLEVBQUUsNENBQTRDO1lBQ3RELFNBQVMsRUFBRSxTQUFTLENBQUMsV0FBVztZQUNoQyxPQUFPLEVBQUUsT0FBTyxDQUFDLE9BQU87U0FDekIsQ0FBQyxDQUFDLFFBQVEsRUFBRTtRQUNiLElBQUksb0JBQW9CLENBQUM7WUFDdkIsSUFBSSxFQUFFLFdBQVc7WUFDakIsU0FBUyxFQUFFLFNBQVMsQ0FBQyxXQUFXO1lBQ2hDLE9BQU8sRUFBRSxPQUFPLENBQUMsT0FBTztZQUN4QixPQUFPLEVBQUU7Z0JBQ1AsSUFBSSxrQkFBa0IsQ0FBQyxFQUFFLE1BQU0sRUFBRSxDQUFDLEVBQUUsWUFBWSxFQUFFLENBQUMsRUFBRSxTQUFTLEVBQUUsU0FBUyxDQUFDLFVBQVUsRUFBRSxDQUFDO2dCQUN2RixJQUFJLGtCQUFrQixDQUFDLEVBQUUsTUFBTSxFQUFFLENBQUMsRUFBRSxZQUFZLEVBQUUsQ0FBQyxFQUFFLFNBQVMsRUFBRSxTQUFTLENBQUMsVUFBVSxFQUFFLENBQUM7Z0JBQ3ZGLElBQUksa0JBQWtCLENBQUMsRUFBRSxNQUFNLEVBQUUsQ0FBQyxFQUFFLFlBQVksRUFBRSxDQUFDLEVBQUUsU0FBUyxFQUFFLFNBQVMsQ0FBQyxVQUFVLEVBQUUsQ0FBQztnQkFDdkYsSUFBSSxrQkFBa0IsQ0FBQyxFQUFFLE1BQU0sRUFBRSxDQUFDLEVBQUUsWUFBWSxFQUFFLENBQUMsRUFBRSxTQUFTLEVBQUUsU0FBUyxDQUFDLFVBQVUsRUFBRSxDQUFDO2dCQUN2RixJQUFJLGtCQUFrQixDQUFDLEVBQUUsTUFBTSxFQUFFLENBQUMsRUFBRSxZQUFZLEVBQUUsQ0FBQyxFQUFFLFNBQVMsRUFBRSxTQUFTLENBQUMsVUFBVSxFQUFFLENBQUM7Z0JBQ3ZGLElBQUksa0JBQWtCLENBQUMsRUFBRSxNQUFNLEVBQUUsRUFBRSxFQUFFLFlBQVksRUFBRSxDQUFDLEVBQUUsU0FBUyxFQUFFLFNBQVMsQ0FBQyxVQUFVLEVBQUUsQ0FBQztnQkFDeEYsSUFBSSxrQkFBa0IsQ0FBQyxFQUFFLE1BQU0sRUFBRSxFQUFFLEVBQUUsWUFBWSxFQUFFLENBQUMsRUFBRSxTQUFTLEVBQUUsU0FBUyxDQUFDLFVBQVUsRUFBRSxDQUFDO2dCQUN4RixJQUFJLGtCQUFrQixDQUFDLEVBQUUsTUFBTSxFQUFFLEVBQUUsRUFBRSxZQUFZLEVBQUUsQ0FBQyxFQUFFLFNBQVMsRUFBRSxTQUFTLENBQUMsVUFBVSxFQUFFLENBQUM7Z0JBQ3hGLElBQUksa0JBQWtCLENBQUMsRUFBRSxNQUFNLEVBQUUsRUFBRSxFQUFFLFlBQVksRUFBRSxDQUFDLEVBQUUsU0FBUyxFQUFFLFNBQVMsQ0FBQyxVQUFVLEVBQUUsQ0FBQzthQUN6RjtTQUNGLENBQUM7S0FDSDtJQUNEO1FBQ0UsSUFBSSxvQkFBb0IsQ0FBQztZQUN2QixPQUFPLEVBQUUsNENBQTRDO1lBQ3JELFFBQVEsRUFBRSw0Q0FBNEM7WUFDdEQsU0FBUyxFQUFFLFNBQVMsQ0FBQyxXQUFXO1lBQ2hDLE9BQU8sRUFBRSxPQUFPLENBQUMsT0FBTztTQUN6QixDQUFDLENBQUMsUUFBUSxFQUFFO1FBQ2IsSUFBSSxvQkFBb0IsQ0FBQztZQUN2QixJQUFJLEVBQUUsV0FBVztZQUNqQixTQUFTLEVBQUUsU0FBUyxDQUFDLFdBQVc7WUFDaEMsT0FBTyxFQUFFLE9BQU8sQ0FBQyxPQUFPO1lBQ3hCLE9BQU8sRUFBRTtnQkFDUCxJQUFJLGtCQUFrQixDQUFDLEVBQUUsTUFBTSxFQUFFLElBQUssRUFBRSxZQUFZLEVBQUUsQ0FBQyxFQUFFLFNBQVMsRUFBRSxTQUFTLENBQUMsVUFBVSxFQUFFLENBQUM7Z0JBQzNGLElBQUksa0JBQWtCLENBQUMsRUFBRSxNQUFNLEVBQUUsSUFBSyxFQUFFLFlBQVksRUFBRSxDQUFDLEVBQUUsU0FBUyxFQUFFLFNBQVMsQ0FBQyxVQUFVLEVBQUUsQ0FBQztnQkFDM0YsSUFBSSxrQkFBa0IsQ0FBQyxFQUFFLE1BQU0sRUFBRSxJQUFLLEVBQUUsWUFBWSxFQUFFLENBQUMsRUFBRSxTQUFTLEVBQUUsU0FBUyxDQUFDLFVBQVUsRUFBRSxDQUFDO2dCQUMzRixJQUFJLGtCQUFrQixDQUFDLEVBQUUsTUFBTSxFQUFFLElBQUssRUFBRSxZQUFZLEVBQUUsQ0FBQyxFQUFFLFNBQVMsRUFBRSxTQUFTLENBQUMsVUFBVSxFQUFFLENBQUM7Z0JBQzNGLElBQUksa0JBQWtCLENBQUMsRUFBRSxNQUFNLEVBQUUsS0FBTSxFQUFFLFlBQVksRUFBRSxDQUFDLEVBQUUsU0FBUyxFQUFFLFNBQVMsQ0FBQyxVQUFVLEVBQUUsQ0FBQztnQkFDNUYsSUFBSSxrQkFBa0IsQ0FBQyxFQUFFLE1BQU0sRUFBRSxLQUFNLEVBQUUsWUFBWSxFQUFFLENBQUMsRUFBRSxTQUFTLEVBQUUsU0FBUyxDQUFDLFVBQVUsRUFBRSxDQUFDO2dCQUM1RixJQUFJLGtCQUFrQixDQUFDLEVBQUUsTUFBTSxFQUFFLEtBQU0sRUFBRSxZQUFZLEVBQUUsQ0FBQyxFQUFFLFNBQVMsRUFBRSxTQUFTLENBQUMsVUFBVSxFQUFFLENBQUM7Z0JBQzVGLElBQUksa0JBQWtCLENBQUMsRUFBRSxNQUFNLEVBQUUsS0FBTSxFQUFFLFlBQVksRUFBRSxDQUFDLEVBQUUsU0FBUyxFQUFFLFNBQVMsQ0FBQyxVQUFVLEVBQUUsQ0FBQztnQkFDNUYsSUFBSSxrQkFBa0IsQ0FBQyxFQUFFLE1BQU0sRUFBRSxLQUFNLEVBQUUsWUFBWSxFQUFFLENBQUMsRUFBRSxTQUFTLEVBQUUsU0FBUyxDQUFDLFVBQVUsRUFBRSxDQUFDO2dCQUM1RixJQUFJLGtCQUFrQixDQUFDLEVBQUUsTUFBTSxFQUFFLE1BQU8sRUFBRSxZQUFZLEVBQUUsQ0FBQyxFQUFFLFNBQVMsRUFBRSxTQUFTLENBQUMsVUFBVSxFQUFFLENBQUM7Z0JBQzdGLElBQUksa0JBQWtCLENBQUMsRUFBRSxNQUFNLEVBQUUsTUFBTyxFQUFFLFlBQVksRUFBRSxDQUFDLEVBQUUsU0FBUyxFQUFFLFNBQVMsQ0FBQyxVQUFVLEVBQUUsQ0FBQztnQkFDN0YsSUFBSSxrQkFBa0IsQ0FBQyxFQUFFLE1BQU0sRUFBRSxNQUFPLEVBQUUsWUFBWSxFQUFFLENBQUMsRUFBRSxTQUFTLEVBQUUsU0FBUyxDQUFDLFVBQVUsRUFBRSxDQUFDO2dCQUM3RixJQUFJLGtCQUFrQixDQUFDLEVBQUUsTUFBTSxFQUFFLE1BQU8sRUFBRSxZQUFZLEVBQUUsQ0FBQyxFQUFFLFNBQVMsRUFBRSxTQUFTLENBQUMsVUFBVSxFQUFFLENBQUM7YUFDOUY7U0FDRixDQUFDO0tBQ0g7SUFDRDtRQUNFLElBQUksb0JBQW9CLENBQUM7WUFDdkIsT0FBTyxFQUFFLDRDQUE0QztZQUNyRCxRQUFRLEVBQUUsR0FBRztZQUNiLFNBQVMsRUFBRSxTQUFTLENBQUMsV0FBVztZQUNoQyxPQUFPLEVBQUUsT0FBTyxDQUFDLE9BQU87U0FDekIsQ0FBQyxDQUFDLFFBQVEsRUFBRTtRQUNiLElBQUksb0JBQW9CLENBQUM7WUFDdkIsSUFBSSxFQUFFLFFBQVE7WUFDZCxTQUFTLEVBQUUsU0FBUyxDQUFDLFdBQVc7WUFDaEMsT0FBTyxFQUFFLE9BQU8sQ0FBQyxPQUFPO1lBQ3hCLE9BQU8sRUFBRTtnQkFDUCxJQUFJLGtCQUFrQixDQUFDLEVBQUUsTUFBTSxFQUFFLENBQUMsRUFBRSxZQUFZLEVBQUUsQ0FBQyxFQUFFLFNBQVMsRUFBRSxTQUFTLENBQUMsVUFBVSxFQUFFLENBQUM7Z0JBQ3ZGLElBQUksa0JBQWtCLENBQUMsRUFBRSxNQUFNLEVBQUUsQ0FBQyxFQUFFLFlBQVksRUFBRSxDQUFDLEVBQUUsU0FBUyxFQUFFLFNBQVMsQ0FBQyxVQUFVLEVBQUUsQ0FBQztnQkFDdkYsSUFBSSxrQkFBa0IsQ0FBQyxFQUFFLE1BQU0sRUFBRSxDQUFDLEVBQUUsWUFBWSxFQUFFLENBQUMsRUFBRSxTQUFTLEVBQUUsU0FBUyxDQUFDLFVBQVUsRUFBRSxDQUFDO2dCQUN2RixJQUFJLGtCQUFrQixDQUFDLEVBQUUsTUFBTSxFQUFFLENBQUMsRUFBRSxZQUFZLEVBQUUsQ0FBQyxFQUFFLFNBQVMsRUFBRSxTQUFTLENBQUMsVUFBVSxFQUFFLENBQUM7YUFDeEY7U0FDRixDQUFDO0tBQ0g7Q0FDRixDQUFDLENBQUEiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBUcmFkZVR5cGUgfSBmcm9tICdAdW5pc3dhcC9zZGstY29yZSdcbmltcG9ydCB7IENhY2hlTW9kZSwgQ2hhaW5JZCB9IGZyb20gJ0B0YXJ0ei1vbmUvc21hcnQtb3JkZXItcm91dGVyJ1xuaW1wb3J0IHsgQ2FjaGVkUm91dGVzU3RyYXRlZ3kgfSBmcm9tICcuL21vZGVsL2NhY2hlZC1yb3V0ZXMtc3RyYXRlZ3knXG5pbXBvcnQgeyBQYWlyVHJhZGVUeXBlQ2hhaW5JZCB9IGZyb20gJy4vbW9kZWwvcGFpci10cmFkZS10eXBlLWNoYWluLWlkJ1xuaW1wb3J0IHsgQ2FjaGVkUm91dGVzQnVja2V0IH0gZnJvbSAnLi9tb2RlbC9jYWNoZWQtcm91dGVzLWJ1Y2tldCdcblxuLyoqXG4gKiBUaGlzIGlzIHRoZSBtYWluIGNvbmZpZ3VyYXRpb24gZm9yIHRoZSBjYWNoaW5nIHN0cmF0ZWdpZXMgb2Ygcm91dGVzLlxuICpcbiAqIFRoZSBrZXlzIGFyZSBnZW5lcmF0ZWQgYnkgY2FsbGluZyB0aGUgYHRvU3RyaW5nYCBtZXRob2QgaW4gdGhlIGBQYWlyVHJhZGVUeXBlQ2hhaW5JZGAgY2xhc3MsXG4gKiB0aGlzIHdheSB3ZSBjYW4gZ3VhcmFudGVlIHRoZSBjb3JyZWN0IGZvcm1hdCBvZiB0aGUga2V5LlxuICpcbiAqIFRoZSB2YWx1ZXMgYXJlIGFuIG9iamVjdCBvZiB0eXBlIGBDYWNoZWRSb3V0ZXNTdHJhdGVneWAuXG4gKiB3aGljaCByZWNlaXZlIGFuIGFycmF5IG9mIGBDYWNoZWRSb3V0ZXNQYXJhbWV0ZXJzYCB3aXRoIHRoZSBjb25maWd1cmF0aW9uIG9mIHRoZSBidWNrZXRzLlxuICovXG5leHBvcnQgY29uc3QgQ0FDSEVEX1JPVVRFU19DT05GSUdVUkFUSU9OOiBNYXA8c3RyaW5nLCBDYWNoZWRSb3V0ZXNTdHJhdGVneT4gPSBuZXcgTWFwKFtcbiAgW1xuICAgIG5ldyBQYWlyVHJhZGVUeXBlQ2hhaW5JZCh7XG4gICAgICB0b2tlbkluOiAnMHhjMDJhYWEzOWIyMjNmZThkMGEwZTVjNGYyN2VhZDkwODNjNzU2Y2MyJywgLy8gV0VUSFxuICAgICAgdG9rZW5PdXQ6ICcweGEwYjg2OTkxYzYyMThiMzZjMWQxOWQ0YTJlOWViMGNlMzYwNmViNDgnLCAvLyBVU0RDXG4gICAgICB0cmFkZVR5cGU6IFRyYWRlVHlwZS5FWEFDVF9JTlBVVCxcbiAgICAgIGNoYWluSWQ6IENoYWluSWQuTUFJTk5FVCxcbiAgICB9KS50b1N0cmluZygpLFxuICAgIG5ldyBDYWNoZWRSb3V0ZXNTdHJhdGVneSh7XG4gICAgICBwYWlyOiAnV0VUSC9VU0RDJyxcbiAgICAgIHRyYWRlVHlwZTogVHJhZGVUeXBlLkVYQUNUX0lOUFVULFxuICAgICAgY2hhaW5JZDogQ2hhaW5JZC5NQUlOTkVULFxuICAgICAgYnVja2V0czogW1xuICAgICAgICBuZXcgQ2FjaGVkUm91dGVzQnVja2V0KHsgYnVja2V0OiAxLCBibG9ja3NUb0xpdmU6IDEsIGNhY2hlTW9kZTogQ2FjaGVNb2RlLlRhcGNvbXBhcmUgfSksXG4gICAgICAgIG5ldyBDYWNoZWRSb3V0ZXNCdWNrZXQoeyBidWNrZXQ6IDIsIGJsb2Nrc1RvTGl2ZTogMSwgY2FjaGVNb2RlOiBDYWNoZU1vZGUuVGFwY29tcGFyZSB9KSxcbiAgICAgICAgbmV3IENhY2hlZFJvdXRlc0J1Y2tldCh7IGJ1Y2tldDogMywgYmxvY2tzVG9MaXZlOiAxLCBjYWNoZU1vZGU6IENhY2hlTW9kZS5UYXBjb21wYXJlIH0pLFxuICAgICAgICBuZXcgQ2FjaGVkUm91dGVzQnVja2V0KHsgYnVja2V0OiA1LCBibG9ja3NUb0xpdmU6IDEsIGNhY2hlTW9kZTogQ2FjaGVNb2RlLlRhcGNvbXBhcmUgfSksXG4gICAgICAgIG5ldyBDYWNoZWRSb3V0ZXNCdWNrZXQoeyBidWNrZXQ6IDgsIGJsb2Nrc1RvTGl2ZTogMSwgY2FjaGVNb2RlOiBDYWNoZU1vZGUuVGFwY29tcGFyZSB9KSxcbiAgICAgICAgbmV3IENhY2hlZFJvdXRlc0J1Y2tldCh7IGJ1Y2tldDogMTMsIGJsb2Nrc1RvTGl2ZTogMSwgY2FjaGVNb2RlOiBDYWNoZU1vZGUuVGFwY29tcGFyZSB9KSxcbiAgICAgICAgbmV3IENhY2hlZFJvdXRlc0J1Y2tldCh7IGJ1Y2tldDogMjEsIGJsb2Nrc1RvTGl2ZTogMSwgY2FjaGVNb2RlOiBDYWNoZU1vZGUuVGFwY29tcGFyZSB9KSxcbiAgICAgICAgbmV3IENhY2hlZFJvdXRlc0J1Y2tldCh7IGJ1Y2tldDogMzQsIGJsb2Nrc1RvTGl2ZTogMSwgY2FjaGVNb2RlOiBDYWNoZU1vZGUuVGFwY29tcGFyZSB9KSxcbiAgICAgICAgbmV3IENhY2hlZFJvdXRlc0J1Y2tldCh7IGJ1Y2tldDogNTUsIGJsb2Nrc1RvTGl2ZTogMSwgY2FjaGVNb2RlOiBDYWNoZU1vZGUuVGFwY29tcGFyZSB9KSxcbiAgICAgIF0sXG4gICAgfSksXG4gIF0sXG4gIFtcbiAgICBuZXcgUGFpclRyYWRlVHlwZUNoYWluSWQoe1xuICAgICAgdG9rZW5JbjogJzB4YTBiODY5OTFjNjIxOGIzNmMxZDE5ZDRhMmU5ZWIwY2UzNjA2ZWI0OCcsIC8vIFVTRENcbiAgICAgIHRva2VuT3V0OiAnMHhjMDJhYWEzOWIyMjNmZThkMGEwZTVjNGYyN2VhZDkwODNjNzU2Y2MyJywgLy8gV0VUSFxuICAgICAgdHJhZGVUeXBlOiBUcmFkZVR5cGUuRVhBQ1RfSU5QVVQsXG4gICAgICBjaGFpbklkOiBDaGFpbklkLk1BSU5ORVQsXG4gICAgfSkudG9TdHJpbmcoKSxcbiAgICBuZXcgQ2FjaGVkUm91dGVzU3RyYXRlZ3koe1xuICAgICAgcGFpcjogJ1VTREMvV0VUSCcsXG4gICAgICB0cmFkZVR5cGU6IFRyYWRlVHlwZS5FWEFDVF9JTlBVVCxcbiAgICAgIGNoYWluSWQ6IENoYWluSWQuTUFJTk5FVCxcbiAgICAgIGJ1Y2tldHM6IFtcbiAgICAgICAgbmV3IENhY2hlZFJvdXRlc0J1Y2tldCh7IGJ1Y2tldDogMV8wMDAsIGJsb2Nrc1RvTGl2ZTogMSwgY2FjaGVNb2RlOiBDYWNoZU1vZGUuVGFwY29tcGFyZSB9KSxcbiAgICAgICAgbmV3IENhY2hlZFJvdXRlc0J1Y2tldCh7IGJ1Y2tldDogMl8wMDAsIGJsb2Nrc1RvTGl2ZTogMSwgY2FjaGVNb2RlOiBDYWNoZU1vZGUuVGFwY29tcGFyZSB9KSxcbiAgICAgICAgbmV3IENhY2hlZFJvdXRlc0J1Y2tldCh7IGJ1Y2tldDogM18wMDAsIGJsb2Nrc1RvTGl2ZTogMSwgY2FjaGVNb2RlOiBDYWNoZU1vZGUuVGFwY29tcGFyZSB9KSxcbiAgICAgICAgbmV3IENhY2hlZFJvdXRlc0J1Y2tldCh7IGJ1Y2tldDogOF8wMDAsIGJsb2Nrc1RvTGl2ZTogMSwgY2FjaGVNb2RlOiBDYWNoZU1vZGUuVGFwY29tcGFyZSB9KSxcbiAgICAgICAgbmV3IENhY2hlZFJvdXRlc0J1Y2tldCh7IGJ1Y2tldDogMTNfMDAwLCBibG9ja3NUb0xpdmU6IDEsIGNhY2hlTW9kZTogQ2FjaGVNb2RlLlRhcGNvbXBhcmUgfSksXG4gICAgICAgIG5ldyBDYWNoZWRSb3V0ZXNCdWNrZXQoeyBidWNrZXQ6IDIxXzAwMCwgYmxvY2tzVG9MaXZlOiAxLCBjYWNoZU1vZGU6IENhY2hlTW9kZS5UYXBjb21wYXJlIH0pLFxuICAgICAgICBuZXcgQ2FjaGVkUm91dGVzQnVja2V0KHsgYnVja2V0OiAzNF8wMDAsIGJsb2Nrc1RvTGl2ZTogMSwgY2FjaGVNb2RlOiBDYWNoZU1vZGUuVGFwY29tcGFyZSB9KSxcbiAgICAgICAgbmV3IENhY2hlZFJvdXRlc0J1Y2tldCh7IGJ1Y2tldDogNTVfMDAwLCBibG9ja3NUb0xpdmU6IDEsIGNhY2hlTW9kZTogQ2FjaGVNb2RlLlRhcGNvbXBhcmUgfSksXG4gICAgICAgIG5ldyBDYWNoZWRSb3V0ZXNCdWNrZXQoeyBidWNrZXQ6IDg5XzAwMCwgYmxvY2tzVG9MaXZlOiAxLCBjYWNoZU1vZGU6IENhY2hlTW9kZS5UYXBjb21wYXJlIH0pLFxuICAgICAgICBuZXcgQ2FjaGVkUm91dGVzQnVja2V0KHsgYnVja2V0OiAxNDRfMDAwLCBibG9ja3NUb0xpdmU6IDEsIGNhY2hlTW9kZTogQ2FjaGVNb2RlLlRhcGNvbXBhcmUgfSksXG4gICAgICAgIG5ldyBDYWNoZWRSb3V0ZXNCdWNrZXQoeyBidWNrZXQ6IDIzM18wMDAsIGJsb2Nrc1RvTGl2ZTogMSwgY2FjaGVNb2RlOiBDYWNoZU1vZGUuVGFwY29tcGFyZSB9KSxcbiAgICAgICAgbmV3IENhY2hlZFJvdXRlc0J1Y2tldCh7IGJ1Y2tldDogMzc3XzAwMCwgYmxvY2tzVG9MaXZlOiAxLCBjYWNoZU1vZGU6IENhY2hlTW9kZS5UYXBjb21wYXJlIH0pLFxuICAgICAgICBuZXcgQ2FjaGVkUm91dGVzQnVja2V0KHsgYnVja2V0OiA2MTBfMDAwLCBibG9ja3NUb0xpdmU6IDEsIGNhY2hlTW9kZTogQ2FjaGVNb2RlLlRhcGNvbXBhcmUgfSksXG4gICAgICBdLFxuICAgIH0pLFxuICBdLFxuICBbXG4gICAgbmV3IFBhaXJUcmFkZVR5cGVDaGFpbklkKHtcbiAgICAgIHRva2VuSW46ICcweGMwMmFhYTM5YjIyM2ZlOGQwYTBlNWM0ZjI3ZWFkOTA4M2M3NTZjYzInLCAvLyBXRVRIXG4gICAgICB0b2tlbk91dDogJyonLCAvLyBBTlkgVE9LRU5cbiAgICAgIHRyYWRlVHlwZTogVHJhZGVUeXBlLkVYQUNUX0lOUFVULFxuICAgICAgY2hhaW5JZDogQ2hhaW5JZC5NQUlOTkVULFxuICAgIH0pLnRvU3RyaW5nKCksXG4gICAgbmV3IENhY2hlZFJvdXRlc1N0cmF0ZWd5KHtcbiAgICAgIHBhaXI6ICdXRVRILyonLFxuICAgICAgdHJhZGVUeXBlOiBUcmFkZVR5cGUuRVhBQ1RfSU5QVVQsXG4gICAgICBjaGFpbklkOiBDaGFpbklkLk1BSU5ORVQsXG4gICAgICBidWNrZXRzOiBbXG4gICAgICAgIG5ldyBDYWNoZWRSb3V0ZXNCdWNrZXQoeyBidWNrZXQ6IDEsIGJsb2Nrc1RvTGl2ZTogMSwgY2FjaGVNb2RlOiBDYWNoZU1vZGUuVGFwY29tcGFyZSB9KSxcbiAgICAgICAgbmV3IENhY2hlZFJvdXRlc0J1Y2tldCh7IGJ1Y2tldDogMiwgYmxvY2tzVG9MaXZlOiAxLCBjYWNoZU1vZGU6IENhY2hlTW9kZS5UYXBjb21wYXJlIH0pLFxuICAgICAgICBuZXcgQ2FjaGVkUm91dGVzQnVja2V0KHsgYnVja2V0OiAzLCBibG9ja3NUb0xpdmU6IDEsIGNhY2hlTW9kZTogQ2FjaGVNb2RlLlRhcGNvbXBhcmUgfSksXG4gICAgICAgIG5ldyBDYWNoZWRSb3V0ZXNCdWNrZXQoeyBidWNrZXQ6IDUsIGJsb2Nrc1RvTGl2ZTogMSwgY2FjaGVNb2RlOiBDYWNoZU1vZGUuVGFwY29tcGFyZSB9KSxcbiAgICAgIF0sXG4gICAgfSksXG4gIF0sXG5dKVxuIl19