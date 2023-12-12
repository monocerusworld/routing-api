import { TradeType } from '@uniswap/sdk-core';
import { CacheMode } from './model';
/**
 * Abstract class for a RouteCachingProvider.
 * Defines the base methods of how to interact with this interface, but not the implementation of how to cache.
 */
export class IRouteCachingProvider {
    constructor() {
        /**
         * Final implementation of the public `getCachedRoute` method, this is how code will interact with the implementation
         *
         * @public
         * @readonly
         * @param chainId
         * @param amount
         * @param quoteToken
         * @param tradeType
         * @param protocols
         * @param blockNumber
         */
        this.getCachedRoute = async (
        // Defined as a readonly member instead of a regular function to make it final.
        chainId, amount, quoteToken, tradeType, protocols, blockNumber) => {
            if ((await this.getCacheMode(chainId, amount, quoteToken, tradeType, protocols)) == CacheMode.Darkmode) {
                return undefined;
            }
            const cachedRoute = await this._getCachedRoute(chainId, amount, quoteToken, tradeType, protocols);
            return this.filterExpiredCachedRoutes(cachedRoute, blockNumber);
        };
        /**
         * Final implementation of the public `setCachedRoute` method.
         * This method will set the blockToLive in the CachedRoutes object before calling the internal method to insert in cache.
         *
         * @public
         * @readonly
         * @param cachedRoutes The route to cache.
         * @returns Promise<boolean> Indicates if the route was inserted into cache.
         */
        this.setCachedRoute = async (
        // Defined as a readonly member instead of a regular function to make it final.
        cachedRoutes, amount) => {
            if ((await this.getCacheModeFromCachedRoutes(cachedRoutes, amount)) ==
                CacheMode.Darkmode) {
                return false;
            }
            cachedRoutes.blocksToLive = await this._getBlocksToLive(cachedRoutes, amount);
            return this._setCachedRoute(cachedRoutes, amount);
        };
    }
    /**
     * Returns the CacheMode for the given cachedRoutes and amount
     *
     * @param cachedRoutes
     * @param amount
     */
    getCacheModeFromCachedRoutes(cachedRoutes, amount) {
        const quoteToken = cachedRoutes.tradeType == TradeType.EXACT_INPUT
            ? cachedRoutes.tokenOut
            : cachedRoutes.tokenIn;
        return this.getCacheMode(cachedRoutes.chainId, amount, quoteToken, cachedRoutes.tradeType, cachedRoutes.protocolsCovered);
    }
    filterExpiredCachedRoutes(cachedRoutes, blockNumber) {
        return (cachedRoutes === null || cachedRoutes === void 0 ? void 0 : cachedRoutes.notExpired(blockNumber)) ? cachedRoutes : undefined;
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicm91dGUtY2FjaGluZy1wcm92aWRlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uLy4uL3NyYy9wcm92aWRlcnMvY2FjaGluZy9yb3V0ZS9yb3V0ZS1jYWNoaW5nLXByb3ZpZGVyLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQU9BLE9BQU8sRUFBbUMsU0FBUyxFQUFFLE1BQU0sbUJBQW1CLENBQUM7QUFJL0UsT0FBTyxFQUFFLFNBQVMsRUFBRSxNQUFNLFNBQVMsQ0FBQztBQUdwQzs7O0dBR0c7QUFDSCxNQUFNLE9BQWdCLHFCQUFxQjtJQUEzQztRQUNFOzs7Ozs7Ozs7OztXQVdHO1FBQ2EsbUJBQWMsR0FBRyxLQUFLO1FBQ3BDLCtFQUErRTtRQUMvRSxPQUFlLEVBQ2YsTUFBZ0MsRUFDaEMsVUFBaUIsRUFDakIsU0FBb0IsRUFDcEIsU0FBcUIsRUFDckIsV0FBbUIsRUFDZ0IsRUFBRTtZQUNyQyxJQUNFLENBQUMsTUFBTSxJQUFJLENBQUMsWUFBWSxDQUN0QixPQUFPLEVBQ1AsTUFBTSxFQUNOLFVBQVUsRUFDVixTQUFTLEVBQ1QsU0FBUyxDQUNWLENBQUMsSUFBSSxTQUFTLENBQUMsUUFBUSxFQUN4QjtnQkFDQSxPQUFPLFNBQVMsQ0FBQzthQUNsQjtZQUVELE1BQU0sV0FBVyxHQUFHLE1BQU0sSUFBSSxDQUFDLGVBQWUsQ0FDNUMsT0FBTyxFQUNQLE1BQU0sRUFDTixVQUFVLEVBQ1YsU0FBUyxFQUNULFNBQVMsQ0FDVixDQUFDO1lBRUYsT0FBTyxJQUFJLENBQUMseUJBQXlCLENBQUMsV0FBVyxFQUFFLFdBQVcsQ0FBQyxDQUFDO1FBQ2xFLENBQUMsQ0FBQztRQUVGOzs7Ozs7OztXQVFHO1FBQ2EsbUJBQWMsR0FBRyxLQUFLO1FBQ3BDLCtFQUErRTtRQUMvRSxZQUEwQixFQUMxQixNQUFnQyxFQUNkLEVBQUU7WUFDcEIsSUFDRSxDQUFDLE1BQU0sSUFBSSxDQUFDLDRCQUE0QixDQUFDLFlBQVksRUFBRSxNQUFNLENBQUMsQ0FBQztnQkFDL0QsU0FBUyxDQUFDLFFBQVEsRUFDbEI7Z0JBQ0EsT0FBTyxLQUFLLENBQUM7YUFDZDtZQUVELFlBQVksQ0FBQyxZQUFZLEdBQUcsTUFBTSxJQUFJLENBQUMsZ0JBQWdCLENBQ3JELFlBQVksRUFDWixNQUFNLENBQ1AsQ0FBQztZQUVGLE9BQU8sSUFBSSxDQUFDLGVBQWUsQ0FBQyxZQUFZLEVBQUUsTUFBTSxDQUFDLENBQUM7UUFDcEQsQ0FBQyxDQUFDO0lBaUdKLENBQUM7SUEvRkM7Ozs7O09BS0c7SUFDSSw0QkFBNEIsQ0FDakMsWUFBMEIsRUFDMUIsTUFBZ0M7UUFFaEMsTUFBTSxVQUFVLEdBQ2QsWUFBWSxDQUFDLFNBQVMsSUFBSSxTQUFTLENBQUMsV0FBVztZQUM3QyxDQUFDLENBQUMsWUFBWSxDQUFDLFFBQVE7WUFDdkIsQ0FBQyxDQUFDLFlBQVksQ0FBQyxPQUFPLENBQUM7UUFFM0IsT0FBTyxJQUFJLENBQUMsWUFBWSxDQUN0QixZQUFZLENBQUMsT0FBTyxFQUNwQixNQUFNLEVBQ04sVUFBVSxFQUNWLFlBQVksQ0FBQyxTQUFTLEVBQ3RCLFlBQVksQ0FBQyxnQkFBZ0IsQ0FDOUIsQ0FBQztJQUNKLENBQUM7SUFxQk8seUJBQXlCLENBQy9CLFlBQXNDLEVBQ3RDLFdBQW1CO1FBRW5CLE9BQU8sQ0FBQSxZQUFZLGFBQVosWUFBWSx1QkFBWixZQUFZLENBQUUsVUFBVSxDQUFDLFdBQVcsQ0FBQyxFQUFDLENBQUMsQ0FBQyxZQUFZLENBQUMsQ0FBQyxDQUFDLFNBQVMsQ0FBQztJQUMxRSxDQUFDO0NBK0NGIn0=