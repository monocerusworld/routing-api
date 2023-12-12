"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MixedRouteWithValidQuote = exports.V3RouteWithValidQuote = exports.V2RouteWithValidQuote = void 0;
const router_sdk_1 = require("@uniswap/router-sdk");
const sdk_core_1 = require("@uniswap/sdk-core");
const v3_sdk_1 = require("@uniswap/v3-sdk");
const lodash_1 = __importDefault(require("lodash"));
const amounts_1 = require("../../../util/amounts");
const routes_1 = require("../../../util/routes");
/**
 * Represents a quote for swapping on a V2 only route. Contains all information
 * such as the route used, the amount specified by the user, the type of quote
 * (exact in or exact out), the quote itself, and gas estimates.
 *
 * @export
 * @class V2RouteWithValidQuote
 */
class V2RouteWithValidQuote {
    toString() {
        return `${this.percent.toFixed(2)}% QuoteGasAdj[${this.quoteAdjustedForGas.toExact()}] Quote[${this.quote.toExact()}] Gas[${this.gasEstimate.toString()}] = ${(0, routes_1.routeToString)(this.route)}`;
    }
    constructor({ amount, rawQuote, percent, route, gasModel, quoteToken, tradeType, v2PoolProvider, }) {
        this.protocol = router_sdk_1.Protocol.V2;
        this.amount = amount;
        this.rawQuote = rawQuote;
        this.quote = amounts_1.CurrencyAmount.fromRawAmount(quoteToken, rawQuote.toString());
        this.percent = percent;
        this.route = route;
        this.gasModel = gasModel;
        this.quoteToken = quoteToken;
        this.tradeType = tradeType;
        const { gasEstimate, gasCostInToken, gasCostInUSD } = this.gasModel.estimateGasCost(this);
        this.gasCostInToken = gasCostInToken;
        this.gasCostInUSD = gasCostInUSD;
        this.gasEstimate = gasEstimate;
        // If its exact out, we need to request *more* of the input token to account for the gas.
        if (this.tradeType == sdk_core_1.TradeType.EXACT_INPUT) {
            const quoteGasAdjusted = this.quote.subtract(gasCostInToken);
            this.quoteAdjustedForGas = quoteGasAdjusted;
        }
        else {
            const quoteGasAdjusted = this.quote.add(gasCostInToken);
            this.quoteAdjustedForGas = quoteGasAdjusted;
        }
        this.poolAddresses = lodash_1.default.map(route.pairs, (p) => v2PoolProvider.getPoolAddress(p.token0, p.token1).poolAddress);
        this.tokenPath = this.route.path;
    }
}
exports.V2RouteWithValidQuote = V2RouteWithValidQuote;
/**
 * Represents a quote for swapping on a V3 only route. Contains all information
 * such as the route used, the amount specified by the user, the type of quote
 * (exact in or exact out), the quote itself, and gas estimates.
 *
 * @export
 * @class V3RouteWithValidQuote
 */
class V3RouteWithValidQuote {
    toString() {
        return `${this.percent.toFixed(2)}% QuoteGasAdj[${this.quoteAdjustedForGas.toExact()}] Quote[${this.quote.toExact()}] Gas[${this.gasEstimate.toString()}] = ${(0, routes_1.routeToString)(this.route)}`;
    }
    constructor({ amount, rawQuote, sqrtPriceX96AfterList, initializedTicksCrossedList, quoterGasEstimate, percent, route, gasModel, quoteToken, tradeType, v3PoolProvider, }) {
        this.protocol = router_sdk_1.Protocol.V3;
        this.amount = amount;
        this.rawQuote = rawQuote;
        this.sqrtPriceX96AfterList = sqrtPriceX96AfterList;
        this.initializedTicksCrossedList = initializedTicksCrossedList;
        this.quoterGasEstimate = quoterGasEstimate;
        this.quote = amounts_1.CurrencyAmount.fromRawAmount(quoteToken, rawQuote.toString());
        this.percent = percent;
        this.route = route;
        this.gasModel = gasModel;
        this.quoteToken = quoteToken;
        this.tradeType = tradeType;
        const { gasEstimate, gasCostInToken, gasCostInUSD } = this.gasModel.estimateGasCost(this);
        this.gasCostInToken = gasCostInToken;
        this.gasCostInUSD = gasCostInUSD;
        this.gasEstimate = gasEstimate;
        // If its exact out, we need to request *more* of the input token to account for the gas.
        if (this.tradeType == sdk_core_1.TradeType.EXACT_INPUT) {
            const quoteGasAdjusted = this.quote.subtract(gasCostInToken);
            this.quoteAdjustedForGas = quoteGasAdjusted;
        }
        else {
            const quoteGasAdjusted = this.quote.add(gasCostInToken);
            this.quoteAdjustedForGas = quoteGasAdjusted;
        }
        this.poolAddresses = lodash_1.default.map(route.pools, (p) => v3PoolProvider.getPoolAddress(p.token0, p.token1, p.fee).poolAddress);
        this.tokenPath = this.route.tokenPath;
    }
}
exports.V3RouteWithValidQuote = V3RouteWithValidQuote;
/**
 * Represents a quote for swapping on a Mixed Route. Contains all information
 * such as the route used, the amount specified by the user, the type of quote
 * (exact in or exact out), the quote itself, and gas estimates.
 *
 * @export
 * @class MixedRouteWithValidQuote
 */
class MixedRouteWithValidQuote {
    toString() {
        return `${this.percent.toFixed(2)}% QuoteGasAdj[${this.quoteAdjustedForGas.toExact()}] Quote[${this.quote.toExact()}] Gas[${this.gasEstimate.toString()}] = ${(0, routes_1.routeToString)(this.route)}`;
    }
    constructor({ amount, rawQuote, sqrtPriceX96AfterList, initializedTicksCrossedList, quoterGasEstimate, percent, route, mixedRouteGasModel, quoteToken, tradeType, v3PoolProvider, v2PoolProvider, }) {
        this.protocol = router_sdk_1.Protocol.MIXED;
        this.amount = amount;
        this.rawQuote = rawQuote;
        this.sqrtPriceX96AfterList = sqrtPriceX96AfterList;
        this.initializedTicksCrossedList = initializedTicksCrossedList;
        this.quoterGasEstimate = quoterGasEstimate;
        this.quote = amounts_1.CurrencyAmount.fromRawAmount(quoteToken, rawQuote.toString());
        this.percent = percent;
        this.route = route;
        this.gasModel = mixedRouteGasModel;
        this.quoteToken = quoteToken;
        this.tradeType = tradeType;
        const { gasEstimate, gasCostInToken, gasCostInUSD } = this.gasModel.estimateGasCost(this);
        this.gasCostInToken = gasCostInToken;
        this.gasCostInUSD = gasCostInUSD;
        this.gasEstimate = gasEstimate;
        // If its exact out, we need to request *more* of the input token to account for the gas.
        if (this.tradeType == sdk_core_1.TradeType.EXACT_INPUT) {
            const quoteGasAdjusted = this.quote.subtract(gasCostInToken);
            this.quoteAdjustedForGas = quoteGasAdjusted;
        }
        else {
            const quoteGasAdjusted = this.quote.add(gasCostInToken);
            this.quoteAdjustedForGas = quoteGasAdjusted;
        }
        this.poolAddresses = lodash_1.default.map(route.pools, (p) => {
            return p instanceof v3_sdk_1.Pool
                ? v3PoolProvider.getPoolAddress(p.token0, p.token1, p.fee).poolAddress
                : v2PoolProvider.getPoolAddress(p.token0, p.token1).poolAddress;
        });
        this.tokenPath = this.route.path;
    }
}
exports.MixedRouteWithValidQuote = MixedRouteWithValidQuote;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicm91dGUtd2l0aC12YWxpZC1xdW90ZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uLy4uL3NyYy9yb3V0ZXJzL2FscGhhLXJvdXRlci9lbnRpdGllcy9yb3V0ZS13aXRoLXZhbGlkLXF1b3RlLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7OztBQUNBLG9EQUErQztBQUMvQyxnREFBcUQ7QUFDckQsNENBQXVDO0FBQ3ZDLG9EQUF1QjtBQUl2QixtREFBdUQ7QUFDdkQsaURBQXFEO0FBMERyRDs7Ozs7OztHQU9HO0FBQ0gsTUFBYSxxQkFBcUI7SUFrQnpCLFFBQVE7UUFDYixPQUFPLEdBQUcsSUFBSSxDQUFDLE9BQU8sQ0FBQyxPQUFPLENBQzVCLENBQUMsQ0FDRixpQkFBaUIsSUFBSSxDQUFDLG1CQUFtQixDQUFDLE9BQU8sRUFBRSxXQUFXLElBQUksQ0FBQyxLQUFLLENBQUMsT0FBTyxFQUFFLFNBQVMsSUFBSSxDQUFDLFdBQVcsQ0FBQyxRQUFRLEVBQUUsT0FBTyxJQUFBLHNCQUFhLEVBQ3pJLElBQUksQ0FBQyxLQUFLLENBQ1gsRUFBRSxDQUFDO0lBQ04sQ0FBQztJQUVELFlBQVksRUFDVixNQUFNLEVBQ04sUUFBUSxFQUNSLE9BQU8sRUFDUCxLQUFLLEVBQ0wsUUFBUSxFQUNSLFVBQVUsRUFDVixTQUFTLEVBQ1QsY0FBYyxHQUNjO1FBbENkLGFBQVEsR0FBRyxxQkFBUSxDQUFDLEVBQUUsQ0FBQztRQW1DckMsSUFBSSxDQUFDLE1BQU0sR0FBRyxNQUFNLENBQUM7UUFDckIsSUFBSSxDQUFDLFFBQVEsR0FBRyxRQUFRLENBQUM7UUFDekIsSUFBSSxDQUFDLEtBQUssR0FBRyx3QkFBYyxDQUFDLGFBQWEsQ0FBQyxVQUFVLEVBQUUsUUFBUSxDQUFDLFFBQVEsRUFBRSxDQUFDLENBQUM7UUFDM0UsSUFBSSxDQUFDLE9BQU8sR0FBRyxPQUFPLENBQUM7UUFDdkIsSUFBSSxDQUFDLEtBQUssR0FBRyxLQUFLLENBQUM7UUFD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