import _ from 'lodash';
import { CachedRoute } from './cached-route';
/**
 * Class defining the route to cache
 *
 * @export
 * @class CachedRoute
 */
export class CachedRoutes {
    /**
     * @param routes
     * @param chainId
     * @param tokenIn
     * @param tokenOut
     * @param protocolsCovered
     * @param blockNumber
     * @param tradeType
     * @param blocksToLive
     */
    constructor({ routes, chainId, tokenIn, tokenOut, protocolsCovered, blockNumber, tradeType, blocksToLive = 0, }) {
        this.routes = routes;
        this.chainId = chainId;
        this.tokenIn = tokenIn;
        this.tokenOut = tokenOut;
        this.protocolsCovered = protocolsCovered;
        this.blockNumber = blockNumber;
        this.tradeType = tradeType;
        this.blocksToLive = blocksToLive;
    }
    /**
     * Factory method that creates a `CachedRoutes` object from an array of RouteWithValidQuote.
     *
     * @public
     * @static
     * @param routes
     * @param chainId
     * @param tokenIn
     * @param tokenOut
     * @param protocolsCovered
     * @param blockNumber
     * @param tradeType
     */
    static fromRoutesWithValidQuotes(routes, chainId, tokenIn, tokenOut, protocolsCovered, blockNumber, tradeType) {
        if (routes.length == 0)
            return undefined;
        const cachedRoutes = _.map(routes, (route) => new CachedRoute({ route: route.route, percent: route.percent }));
        return new CachedRoutes({
            routes: cachedRoutes,
            chainId: chainId,
            tokenIn: tokenIn,
            tokenOut: tokenOut,
            protocolsCovered: protocolsCovered,
            blockNumber: blockNumber,
            tradeType: tradeType,
        });
    }
    /**
     * Function to determine if, given a block number, the CachedRoute is expired or not.
     *
     * @param currentBlockNumber
     */
    notExpired(currentBlockNumber) {
        return currentBlockNumber - this.blockNumber <= this.blocksToLive;
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY2FjaGVkLXJvdXRlcy5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uLy4uLy4uL3NyYy9wcm92aWRlcnMvY2FjaGluZy9yb3V0ZS9tb2RlbC9jYWNoZWQtcm91dGVzLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUVBLE9BQU8sQ0FBQyxNQUFNLFFBQVEsQ0FBQztBQVV2QixPQUFPLEVBQUUsV0FBVyxFQUFFLE1BQU0sZ0JBQWdCLENBQUM7QUFhN0M7Ozs7O0dBS0c7QUFDSCxNQUFNLE9BQU8sWUFBWTtJQVd2Qjs7Ozs7Ozs7O09BU0c7SUFDSCxZQUFZLEVBQ1YsTUFBTSxFQUNOLE9BQU8sRUFDUCxPQUFPLEVBQ1AsUUFBUSxFQUNSLGdCQUFnQixFQUNoQixXQUFXLEVBQ1gsU0FBUyxFQUNULFlBQVksR0FBRyxDQUFDLEdBQ0c7UUFDbkIsSUFBSSxDQUFDLE1BQU0sR0FBRyxNQUFNLENBQUM7UUFDckIsSUFBSSxDQUFDLE9BQU8sR0FBRyxPQUFPLENBQUM7UUFDdkIsSUFBSSxDQUFDLE9BQU8sR0FBRyxPQUFPLENBQUM7UUFDdkIsSUFBSSxDQUFDLFFBQVEsR0FBRyxRQUFRLENBQUM7UUFDekIsSUFBSSxDQUFDLGdCQUFnQixHQUFHLGdCQUFnQixDQUFDO1FBQ3pDLElBQUksQ0FBQyxXQUFXLEdBQUcsV0FBVyxDQUFDO1FBQy9CLElBQUksQ0FBQyxTQUFTLEdBQUcsU0FBUyxDQUFDO1FBQzNCLElBQUksQ0FBQyxZQUFZLEdBQUcsWUFBWSxDQUFDO0lBQ25DLENBQUM7SUFFRDs7Ozs7Ozs7Ozs7O09BWUc7SUFDSSxNQUFNLENBQUMseUJBQXlCLENBQ3JDLE1BQTZCLEVBQzdCLE9BQWdCLEVBQ2hCLE9BQWMsRUFDZCxRQUFlLEVBQ2YsZ0JBQTRCLEVBQzVCLFdBQW1CLEVBQ25CLFNBQW9CO1FBRXBCLElBQUksTUFBTSxDQUFDLE1BQU0sSUFBSSxDQUFDO1lBQUUsT0FBTyxTQUFTLENBQUM7UUFFekMsTUFBTSxZQUFZLEdBQUcsQ0FBQyxDQUFDLEdBQUcsQ0FDeEIsTUFBTSxFQUNOLENBQUMsS0FBMEIsRUFBRSxFQUFFLENBQzdCLElBQUksV0FBVyxDQUFDLEVBQUUsS0FBSyxFQUFFLEtBQUssQ0FBQyxLQUFLLEVBQUUsT0FBTyxFQUFFLEtBQUssQ0FBQyxPQUFPLEVBQUUsQ0FBQyxDQUNsRSxDQUFDO1FBRUYsT0FBTyxJQUFJLFlBQVksQ0FBQztZQUN0QixNQUFNLEVBQUUsWUFBWTtZQUNwQixPQUFPLEVBQUUsT0FBTztZQUNoQixPQUFPLEVBQUUsT0FBTztZQUNoQixRQUFRLEVBQUUsUUFBUTtZQUNsQixnQkFBZ0IsRUFBRSxnQkFBZ0I7WUFDbEMsV0FBVyxFQUFFLFdBQVc7WUFDeEIsU0FBUyxFQUFFLFNBQVM7U0FDckIsQ0FBQyxDQUFDO0lBQ0wsQ0FBQztJQUVEOzs7O09BSUc7SUFDSSxVQUFVLENBQUMsa0JBQTBCO1FBQzFDLE9BQU8sa0JBQWtCLEdBQUcsSUFBSSxDQUFDLFdBQVcsSUFBSSxJQUFJLENBQUMsWUFBWSxDQUFDO0lBQ3BFLENBQUM7Q0FDRiJ9