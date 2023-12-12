"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CachedRoutes = void 0;
const lodash_1 = __importDefault(require("lodash"));
const cached_route_1 = require("./cached-route");
/**
 * Class defining the route to cache
 *
 * @export
 * @class CachedRoute
 */
class CachedRoutes {
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
        const cachedRoutes = lodash_1.default.map(routes, (route) => new cached_route_1.CachedRoute({ route: route.route, percent: route.percent }));
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
exports.CachedRoutes = CachedRoutes;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY2FjaGVkLXJvdXRlcy5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uLy4uLy4uL3NyYy9wcm92aWRlcnMvY2FjaGluZy9yb3V0ZS9tb2RlbC9jYWNoZWQtcm91dGVzLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7OztBQUVBLG9EQUF1QjtBQVV2QixpREFBNkM7QUFhN0M7Ozs7O0dBS0c7QUFDSCxNQUFhLFlBQVk7SUFXdkI7Ozs7Ozs7OztPQVNHO0lBQ0gsWUFBWSxFQUNWLE1BQU0sRUFDTixPQUFPLEVBQ1AsT0FBTyxFQUNQLFFBQVEsRUFDUixnQkFBZ0IsRUFDaEIsV0FBVyxFQUNYLFNBQVMsRUFDVCxZQUFZLEdBQUcsQ0FBQyxHQUNHO1FBQ25CLElBQUksQ0FBQyxNQUFNLEdBQUcsTUFBTSxDQUFDO1FBQ3JCLElBQUksQ0FBQyxPQUFPLEdBQUcsT0FBTyxDQUFDO1FBQ3ZCLElBQUksQ0FBQyxPQUFPLEdBQUcsT0FBTyxDQUFDO1FBQ3ZCLElBQUksQ0FBQyxRQUFRLEdBQUcsUUFBUSxDQUFDO1FBQ3pCLElBQUksQ0FBQyxnQkFBZ0IsR0FBRyxnQkFBZ0IsQ0FBQztRQUN6QyxJQUFJLENBQUMsV0FBVyxHQUFHLFdBQVcsQ0FBQztRQUMvQixJQUFJLENBQUMsU0FBUyxHQUFHLFNBQVMsQ0FBQztRQUMzQixJQUFJLENBQUMsWUFBWSxHQUFHLFlBQVksQ0FBQztJQUNuQyxDQUFDO0lBRUQ7Ozs7Ozs7Ozs7OztPQVlHO0lBQ0ksTUFBTSxDQUFDLHlCQUF5QixDQUNyQyxNQUE2QixFQUM3QixPQUFnQixFQUNoQixPQUFjLEVBQ2QsUUFBZSxFQUNmLGdCQUE0QixFQUM1QixXQUFtQixFQUNuQixTQUFvQjtRQUVwQixJQUFJLE1BQU0sQ0FBQyxNQUFNLElBQUksQ0FBQztZQUFFLE9BQU8sU0FBUyxDQUFDO1FBRXpDLE1BQU0sWUFBWSxHQUFHLGdCQUFDLENBQUMsR0FBRyxDQUN4QixNQUFNLEVBQ04sQ0FBQyxLQUEwQixFQUFFLEVBQUUsQ0FDN0IsSUFBSSwwQkFBVyxDQUFDLEVBQUUsS0FBSyxFQUFFLEtBQUssQ0FBQyxLQUFLLEVBQUUsT0FBTyxFQUFFLEtBQUssQ0FBQyxPQUFPLEVBQUUsQ0FBQyxDQUNsRSxDQUFDO1FBRUYsT0FBTyxJQUFJLFlBQVksQ0FBQztZQUN0QixNQUFNLEVBQUUsWUFBWTtZQUNwQixPQUFPLEVBQUUsT0FBTztZQUNoQixPQUFPLEVBQUUsT0FBTztZQUNoQixRQUFRLEVBQUUsUUFBUTtZQUNsQixnQkFBZ0IsRUFBRSxnQkFBZ0I7WUFDbEMsV0FBVyxFQUFFLFdBQVc7WUFDeEIsU0FBUyxFQUFFLFNBQVM7U0FDckIsQ0FBQyxDQUFDO0lBQ0wsQ0FBQztJQUVEOzs7O09BSUc7SUFDSSxVQUFVLENBQUMsa0JBQTBCO1FBQzFDLE9BQU8sa0JBQWtCLEdBQUcsSUFBSSxDQUFDLFdBQVcsSUFBSSxJQUFJLENBQUMsWUFBWSxDQUFDO0lBQ3BFLENBQUM7Q0FDRjtBQTFGRCxvQ0EwRkMifQ==