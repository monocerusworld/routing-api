"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LegacyRouter = void 0;
/* eslint-disable @typescript-eslint/no-non-null-assertion */
const bignumber_1 = require("@ethersproject/bignumber");
const logger_1 = require("@ethersproject/logger");
const router_sdk_1 = require("@uniswap/router-sdk");
const sdk_core_1 = require("@uniswap/sdk-core");
const v3_sdk_1 = require("@uniswap/v3-sdk");
const lodash_1 = __importDefault(require("lodash"));
const token_provider_1 = require("../../providers/token-provider");
const util_1 = require("../../util");
const amounts_1 = require("../../util/amounts");
const log_1 = require("../../util/log");
const routes_1 = require("../../util/routes");
const alpha_router_1 = require("../alpha-router");
const router_1 = require("../router");
const bases_1 = require("./bases");
// Interface defaults to 2.
const MAX_HOPS = 2;
/**
 * Replicates the router implemented in the V3 interface.
 * Code is mostly a copy from https://github.com/Uniswap/uniswap-interface/blob/0190b5a408c13016c87e1030ffc59326c085f389/src/hooks/useBestV3Trade.ts#L22-L23
 * with React/Redux hooks removed, and refactoring to allow re-use in other routers.
 */
class LegacyRouter {
    constructor({ chainId, multicall2Provider, poolProvider, quoteProvider, tokenProvider, }) {
        this.chainId = chainId;
        this.multicall2Provider = multicall2Provider;
        this.poolProvider = poolProvider;
        this.quoteProvider = quoteProvider;
        this.tokenProvider = tokenProvider;
    }
    async route(amount, quoteCurrency, swapType, swapConfig, partialRoutingConfig) {
        if (swapType == sdk_core_1.TradeType.EXACT_INPUT) {
            return this.routeExactIn(amount.currency, quoteCurrency, amount, swapConfig, partialRoutingConfig);
        }
        return this.routeExactOut(quoteCurrency, amount.currency, amount, swapConfig, partialRoutingConfig);
    }
    async routeExactIn(currencyIn, currencyOut, amountIn, swapConfig, routingConfig) {
        const tokenIn = currencyIn.wrapped;
        const tokenOut = currencyOut.wrapped;
        const routes = await this.getAllRoutes(tokenIn, tokenOut, routingConfig);
        const routeQuote = await this.findBestRouteExactIn(amountIn, tokenOut, routes, routingConfig);
        if (!routeQuote) {
            return null;
        }
        const trade = this.buildTrade(currencyIn, currencyOut, sdk_core_1.TradeType.EXACT_INPUT, routeQuote);
        return {
            quote: routeQuote.quote,
            quoteGasAdjusted: routeQuote.quote,
            route: [routeQuote],
            estimatedGasUsed: bignumber_1.BigNumber.from(0),
            estimatedGasUsedQuoteToken: amounts_1.CurrencyAmount.fromFractionalAmount(tokenOut, 0, 1),
            estimatedGasUsedUSD: amounts_1.CurrencyAmount.fromFractionalAmount(token_provider_1.USDC_MAINNET, 0, 1),
            gasPriceWei: bignumber_1.BigNumber.from(0),
            trade,
            methodParameters: swapConfig
                ? Object.assign(Object.assign({}, this.buildMethodParameters(trade, swapConfig)), { to: (0, util_1.SWAP_ROUTER_02_ADDRESSES)(this.chainId) }) : undefined,
            blockNumber: bignumber_1.BigNumber.from(0),
        };
    }
    async routeExactOut(currencyIn, currencyOut, amountOut, swapConfig, routingConfig) {
        const tokenIn = currencyIn.wrapped;
        const tokenOut = currencyOut.wrapped;
        const routes = await this.getAllRoutes(tokenIn, tokenOut, routingConfig);
        const routeQuote = await this.findBestRouteExactOut(amountOut, tokenIn, routes, routingConfig);
        if (!routeQuote) {
            return null;
        }
        const trade = this.buildTrade(currencyIn, currencyOut, sdk_core_1.TradeType.EXACT_OUTPUT, routeQuote);
        return {
            quote: routeQuote.quote,
            quoteGasAdjusted: routeQuote.quote,
            route: [routeQuote],
            estimatedGasUsed: bignumber_1.BigNumber.from(0),
            estimatedGasUsedQuoteToken: amounts_1.CurrencyAmount.fromFractionalAmount(tokenIn, 0, 1),
            estimatedGasUsedUSD: amounts_1.CurrencyAmount.fromFractionalAmount(token_provider_1.USDC_MAINNET, 0, 1),
            gasPriceWei: bignumber_1.BigNumber.from(0),
            trade,
            methodParameters: swapConfig
                ? Object.assign(Object.assign({}, this.buildMethodParameters(trade, swapConfig)), { to: (0, util_1.SWAP_ROUTER_02_ADDRESSES)(this.chainId) }) : undefined,
            blockNumber: bignumber_1.BigNumber.from(0),
        };
    }
    async findBestRouteExactIn(amountIn, tokenOut, routes, routingConfig) {
        const { routesWithQuotes: quotesRaw } = await this.quoteProvider.getQuotesManyExactIn([amountIn], routes, {
            blockNumber: routingConfig === null || routingConfig === void 0 ? void 0 : routingConfig.blockNumber,
        });
        const quotes100Percent = lodash_1.default.map(quotesRaw, ([route, quotes]) => { var _a, _b; return `${(0, routes_1.routeToString)(route)} : ${(_b = (_a = quotes[0]) === null || _a === void 0 ? void 0 : _a.quote) === null || _b === void 0 ? void 0 : _b.toString()}`; });
        log_1.log.info({ quotes100Percent }, '100% Quotes');
        const bestQuote = await this.getBestQuote(routes, quotesRaw, tokenOut, sdk_core_1.TradeType.EXACT_INPUT);
        return bestQuote;
    }
    async findBestRouteExactOut(amountOut, tokenIn, routes, routingConfig) {
        const { routesWithQuotes: quotesRaw } = await this.quoteProvider.getQuotesManyExactOut([amountOut], routes, {
            blockNumber: routingConfig === null || routingConfig === void 0 ? void 0 : routingConfig.blockNumber,
        });
        const bestQuote = await this.getBestQuote(routes, quotesRaw, tokenIn, sdk_core_1.TradeType.EXACT_OUTPUT);
        return bestQuote;
    }
    async getBestQuote(routes, quotesRaw, quoteToken, routeType) {
        log_1.log.debug(`Got ${lodash_1.default.filter(quotesRaw, ([_, quotes]) => !!quotes[0]).length} valid quotes from ${routes.length} possible routes.`);
        const routeQuotesRaw = [];
        for (let i = 0; i < quotesRaw.length; i++) {
            const [route, quotes] = quotesRaw[i];
            const { quote, amount } = quotes[0];
            if (!quote) {
                logger_1.Logger.globalLogger().debug(`No quote for ${(0, routes_1.routeToString)(route)}`);
                continue;
            }
            routeQuotesRaw.push({ route, quote, amount });
        }
        if (routeQuotesRaw.length == 0) {
            return null;
        }
        routeQuotesRaw.sort((routeQuoteA, routeQuoteB) => {
            if (routeType == sdk_core_1.TradeType.EXACT_INPUT) {
                return routeQuoteA.quote.gt(routeQuoteB.quote) ? -1 : 1;
            }
            else {
                return routeQuoteA.quote.lt(routeQuoteB.quote) ? -1 : 1;
            }
        });
        const routeQuotes = lodash_1.default.map(routeQuotesRaw, ({ route, quote, amount }) => {
            return new alpha_router_1.V3RouteWithValidQuote({
                route,
                rawQuote: quote,
                amount,
                percent: 100,
                gasModel: {
                    estimateGasCost: () => ({
                        gasCostInToken: amounts_1.CurrencyAmount.fromRawAmount(quoteToken, 0),
                        gasCostInUSD: amounts_1.CurrencyAmount.fromRawAmount(token_provider_1.USDC_MAINNET, 0),
                        gasEstimate: bignumber_1.BigNumber.from(0),
                    }),
                },
                sqrtPriceX96AfterList: [],
                initializedTicksCrossedList: [],
                quoterGasEstimate: bignumber_1.BigNumber.from(0),
                tradeType: routeType,
                quoteToken,
                v3PoolProvider: this.poolProvider,
            });
        });
        for (const rq of routeQuotes) {
            log_1.log.debug(`Quote: ${rq.amount.toFixed(Math.min(rq.amount.currency.decimals, 2))} Route: ${(0, routes_1.routeToString)(rq.route)}`);
        }
        return routeQuotes[0];
    }
    async getAllRoutes(tokenIn, tokenOut, routingConfig) {
        const tokenPairs = await this.getAllPossiblePairings(tokenIn, tokenOut);
        const poolAccessor = await this.poolProvider.getPools(tokenPairs, {
            blockNumber: routingConfig === null || routingConfig === void 0 ? void 0 : routingConfig.blockNumber,
        });
        const pools = poolAccessor.getAllPools();
        const routes = this.computeAllRoutes(tokenIn, tokenOut, pools, this.chainId, [], [], tokenIn, MAX_HOPS);
        log_1.log.info({ routes: lodash_1.default.map(routes, routes_1.routeToString) }, `Computed ${routes.length} possible routes.`);
        return routes;
    }
    async getAllPossiblePairings(tokenIn, tokenOut) {
        var _a, _b, _c, _d, _e;
        const common = (_a = (0, bases_1.BASES_TO_CHECK_TRADES_AGAINST)(this.tokenProvider)[this.chainId]) !== null && _a !== void 0 ? _a : [];
        const additionalA = (_c = (_b = (await (0, bases_1.ADDITIONAL_BASES)(this.tokenProvider))[this.chainId]) === null || _b === void 0 ? void 0 : _b[tokenIn.address]) !== null && _c !== void 0 ? _c : [];
        const additionalB = (_e = (_d = (await (0, bases_1.ADDITIONAL_BASES)(this.tokenProvider))[this.chainId]) === null || _d === void 0 ? void 0 : _d[tokenOut.address]) !== null && _e !== void 0 ? _e : [];
        const bases = [...common, ...additionalA, ...additionalB];
        const basePairs = lodash_1.default.flatMap(bases, (base) => bases.map((otherBase) => [base, otherBase]));
        const customBases = (await (0, bases_1.CUSTOM_BASES)(this.tokenProvider))[this.chainId];
        const allPairs = (0, lodash_1.default)([
            // the direct pair
            [tokenIn, tokenOut],
            // token A against all bases
            ...bases.map((base) => [tokenIn, base]),
            // token B against all bases
            ...bases.map((base) => [tokenOut, base]),
            // each base against all bases
            ...basePairs,
        ])
            .filter((tokens) => Boolean(tokens[0] && tokens[1]))
            .filter(([tokenA, tokenB]) => tokenA.address !== tokenB.address && !tokenA.equals(tokenB))
            .filter(([tokenA, tokenB]) => {
            const customBasesA = customBases === null || customBases === void 0 ? void 0 : customBases[tokenA.address];
            const customBasesB = customBases === null || customBases === void 0 ? void 0 : customBases[tokenB.address];
            if (!customBasesA && !customBasesB)
                return true;
            if (customBasesA && !customBasesA.find((base) => tokenB.equals(base)))
                return false;
            if (customBasesB && !customBasesB.find((base) => tokenA.equals(base)))
                return false;
            return true;
        })
            .flatMap(([tokenA, tokenB]) => {
            return [
                [tokenA, tokenB, v3_sdk_1.FeeAmount.LOW],
                [tokenA, tokenB, v3_sdk_1.FeeAmount.MEDIUM],
                [tokenA, tokenB, v3_sdk_1.FeeAmount.HIGH],
            ];
        })
            .value();
        return allPairs;
    }
    computeAllRoutes(tokenIn, tokenOut, pools, chainId, currentPath = [], allPaths = [], startTokenIn = tokenIn, maxHops = 2) {
        for (const pool of pools) {
            if (currentPath.indexOf(pool) !== -1 || !pool.involvesToken(tokenIn))
                continue;
            const outputToken = pool.token0.equals(tokenIn)
                ? pool.token1
                : pool.token0;
            if (outputToken.equals(tokenOut)) {
                allPaths.push(new router_1.V3Route([...currentPath, pool], startTokenIn, tokenOut));
            }
            else if (maxHops > 1) {
                this.computeAllRoutes(outputToken, tokenOut, pools, chainId, [...currentPath, pool], allPaths, startTokenIn, maxHops - 1);
            }
        }
        return allPaths;
    }
    buildTrade(tokenInCurrency, tokenOutCurrency, tradeType, routeAmount) {
        const { route, amount, quote } = routeAmount;
        // The route, amount and quote are all in terms of wrapped tokens.
        // When constructing the Trade object the inputAmount/outputAmount must
        // use native currencies if necessary. This is so that the Trade knows to wrap/unwrap.
        if (tradeType == sdk_core_1.TradeType.EXACT_INPUT) {
            const amountCurrency = amounts_1.CurrencyAmount.fromFractionalAmount(tokenInCurrency, amount.numerator, amount.denominator);
            const quoteCurrency = amounts_1.CurrencyAmount.fromFractionalAmount(tokenOutCurrency, quote.numerator, quote.denominator);
            const routeCurrency = new v3_sdk_1.Route(route.pools, amountCurrency.currency, quoteCurrency.currency);
            return new router_sdk_1.Trade({
                v3Routes: [
                    {
                        routev3: routeCurrency,
                        inputAmount: amountCurrency,
                        outputAmount: quoteCurrency,
                    },
                ],
                v2Routes: [],
                tradeType: tradeType,
            });
        }
        else {
            const quoteCurrency = amounts_1.CurrencyAmount.fromFractionalAmount(tokenInCurrency, quote.numerator, quote.denominator);
            const amountCurrency = amounts_1.CurrencyAmount.fromFractionalAmount(tokenOutCurrency, amount.numerator, amount.denominator);
            const routeCurrency = new v3_sdk_1.Route(route.pools, quoteCurrency.currency, amountCurrency.currency);
            return new router_sdk_1.Trade({
                v3Routes: [
                    {
                        routev3: routeCurrency,
                        inputAmount: quoteCurrency,
                        outputAmount: amountCurrency,
                    },
                ],
                v2Routes: [],
                tradeType: tradeType,
            });
        }
    }
    buildMethodParameters(trade, swapConfig) {
        const { recipient, slippageTolerance, deadline } = swapConfig;
        const methodParameters = router_sdk_1.SwapRouter.swapCallParameters(trade, {
            recipient,
            slippageTolerance,
            deadlineOrPreviousBlockhash: deadline,
            // ...(signatureData
            //   ? {
            //       inputTokenPermit:
            //         'allowed' in signatureData
            //           ? {
            //               expiry: signatureData.deadline,
            //               nonce: signatureData.nonce,
            //               s: signatureData.s,
            //               r: signatureData.r,
            //               v: signatureData.v as any,
            //             }
            //           : {
            //               deadline: signatureData.deadline,
            //               amount: signatureData.amount,
            //               s: signatureData.s,
            //               r: signatureData.r,
            //               v: signatureData.v as any,
            //             },
            //     }
            //   : {}),
        });
        return methodParameters;
    }
}
exports.LegacyRouter = LegacyRouter;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibGVnYWN5LXJvdXRlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9yb3V0ZXJzL2xlZ2FjeS1yb3V0ZXIvbGVnYWN5LXJvdXRlci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7QUFBQSw2REFBNkQ7QUFDN0Qsd0RBQXFEO0FBQ3JELGtEQUErQztBQUMvQyxvREFBd0Q7QUFDeEQsZ0RBQStEO0FBQy9ELDRDQUEyRTtBQUMzRSxvREFBdUI7QUFJdkIsbUVBR3dDO0FBRXhDLHFDQUFzRDtBQUN0RCxnREFBb0Q7QUFFcEQsd0NBQXFDO0FBQ3JDLDhDQUFrRDtBQUNsRCxrREFBd0Q7QUFDeEQsc0NBQXdFO0FBRXhFLG1DQUlpQjtBQVVqQiwyQkFBMkI7QUFDM0IsTUFBTSxRQUFRLEdBQUcsQ0FBQyxDQUFDO0FBTW5COzs7O0dBSUc7QUFDSCxNQUFhLFlBQVk7SUFPdkIsWUFBWSxFQUNWLE9BQU8sRUFDUCxrQkFBa0IsRUFDbEIsWUFBWSxFQUNaLGFBQWEsRUFDYixhQUFhLEdBQ007UUFDbkIsSUFBSSxDQUFDLE9BQU8sR0FBRyxPQUFPLENBQUM7UUFDdkIsSUFBSSxDQUFDLGtCQUFrQixHQUFHLGtCQUFrQixDQUFDO1FBQzdDLElBQUksQ0FBQyxZQUFZLEdBQUcsWUFBWSxDQUFDO1FBQ2pDLElBQUksQ0FBQyxhQUFhLEdBQUcsYUFBYSxDQUFDO1FBQ25DLElBQUksQ0FBQyxhQUFhLEdBQUcsYUFBYSxDQUFDO0lBQ3JDLENBQUM7SUFDTSxLQUFLLENBQUMsS0FBSyxDQUNoQixNQUFzQixFQUN0QixhQUF1QixFQUN2QixRQUFtQixFQUNuQixVQUFvQyxFQUNwQyxvQkFBbUQ7UUFFbkQsSUFBSSxRQUFRLElBQUksb0JBQVMsQ0FBQyxXQUFXLEVBQUU7WUFDckMsT0FBTyxJQUFJLENBQUMsWUFBWSxDQUN0QixNQUFNLENBQUMsUUFBUSxFQUNmLGFBQWEsRUFDYixNQUFNLEVBQ04sVUFBVSxFQUNWLG9CQUFvQixDQUNyQixDQUFDO1NBQ0g7UUFFRCxPQUFPLElBQUksQ0FBQyxhQUFhLENBQ3ZCLGFBQWEsRUFDYixNQUFNLENBQUMsUUFBUSxFQUNmLE1BQU0sRUFDTixVQUFVLEVBQ1Ysb0JBQW9CLENBQ3JCLENBQUM7SUFDSixDQUFDO0lBRU0sS0FBSyxDQUFDLFlBQVksQ0FDdkIsVUFBb0IsRUFDcEIsV0FBcUIsRUFDckIsUUFBd0IsRUFDeEIsVUFBb0MsRUFDcEMsYUFBbUM7UUFFbkMsTUFBTSxPQUFPLEdBQUcsVUFBVSxDQUFDLE9BQU8sQ0FBQztRQUNuQyxNQUFNLFFBQVEsR0FBRyxXQUFXLENBQUMsT0FBTyxDQUFDO1FBQ3JDLE1BQU0sTUFBTSxHQUFHLE1BQU0sSUFBSSxDQUFDLFlBQVksQ0FBQyxPQUFPLEVBQUUsUUFBUSxFQUFFLGFBQWEsQ0FBQyxDQUFDO1FBQ3pFLE1BQU0sVUFBVSxHQUFHLE1BQU0sSUFBSSxDQUFDLG9CQUFvQixDQUNoRCxRQUFRLEVBQ1IsUUFBUSxFQUNSLE1BQU0sRUFDTixhQUFhLENBQ2QsQ0FBQztRQUVGLElBQUksQ0FBQyxVQUFVLEVBQUU7WUFDZixPQUFPLElBQUksQ0FBQztTQUNiO1FBRUQsTUFBTSxLQUFLLEdBQUcsSUFBSSxDQUFDLFVBQVUsQ0FDM0IsVUFBVSxFQUNWLFdBQVcsRUFDWCxvQkFBUyxDQUFDLFdBQVcsRUFDckIsVUFBVSxDQUNYLENBQUM7UUFFRixPQUFPO1lBQ0wsS0FBSyxFQUFFLFVBQVUsQ0FBQyxLQUFLO1lBQ3ZCLGdCQUFnQixFQUFFLFVBQVUsQ0FBQyxLQUFLO1lBQ2xDLEtBQUssRUFBRSxDQUFDLFVBQVUsQ0FBQztZQUNuQixnQkFBZ0IsRUFBRSxxQkFBUyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUM7WUFDbkMsMEJBQTBCLEVBQUUsd0JBQWMsQ0FBQyxvQkFBb0IsQ0FDN0QsUUFBUSxFQUNSLENBQUMsRUFDRCxDQUFDLENBQ0Y7WUFDRCxtQkFBbUIsRUFBRSx3QkFBYyxDQUFDLG9CQUFvQixDQUN0RCw2QkFBYSxFQUNiLENBQUMsRUFDRCxDQUFDLENBQ0Y7WUFDRCxXQUFXLEVBQUUscUJBQVMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDO1lBQzlCLEtBQUs7WUFDTCxnQkFBZ0IsRUFBRSxVQUFVO2dCQUMxQixDQUFDLGlDQUNJLElBQUksQ0FBQyxxQkFBcUIsQ0FBQyxLQUFLLEVBQUUsVUFBVSxDQUFDLEtBQ2hELEVBQUUsRUFBRSxJQUFBLCtCQUF3QixFQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsSUFFNUMsQ0FBQyxDQUFDLFNBQVM7WUFDYixXQUFXLEVBQUUscUJBQVMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDO1NBQy9CLENBQUM7SUFDSixDQUFDO0lBRU0sS0FBSyxDQUFDLGFBQWEsQ0FDeEIsVUFBb0IsRUFDcEIsV0FBcUIsRUFDckIsU0FBeUIsRUFDekIsVUFBb0MsRUFDcEMsYUFBbUM7UUFFbkMsTUFBTSxPQUFPLEdBQUcsVUFBVSxDQUFDLE9BQU8sQ0FBQztRQUNuQyxNQUFNLFFBQVEsR0FBRyxXQUFXLENBQUMsT0FBTyxDQUFDO1FBQ3JDLE1BQU0sTUFBTSxHQUFHLE1BQU0sSUFBSSxDQUFDLFlBQVksQ0FBQyxPQUFPLEVBQUUsUUFBUSxFQUFFLGFBQWEsQ0FBQyxDQUFDO1FBQ3pFLE1BQU0sVUFBVSxHQUFHLE1BQU0sSUFBSSxDQUFDLHFCQUFxQixDQUNqRCxTQUFTLEVBQ1QsT0FBTyxFQUNQLE1BQU0sRUFDTixhQUFhLENBQ2QsQ0FBQztRQUVGLElBQUksQ0FBQyxVQUFVLEVBQUU7WUFDZixPQUFPLElBQUksQ0FBQztTQUNiO1FBRUQsTUFBTSxLQUFLLEdBQUcsSUFBSSxDQUFDLFVBQVUsQ0FDM0IsVUFBVSxFQUNWLFdBQVcsRUFDWCxvQkFBUyxDQUFDLFlBQVksRUFDdEIsVUFBVSxDQUNYLENBQUM7UUFFRixPQUFPO1lBQ0wsS0FBSyxFQUFFLFVBQVUsQ0FBQyxLQUFLO1lBQ3ZCLGdCQUFnQixFQUFFLFVBQVUsQ0FBQyxLQUFLO1lBQ2xDLEtBQUssRUFBRSxDQUFDLFVBQVUsQ0FBQztZQUNuQixnQkFBZ0IsRUFBRSxxQkFBUyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUM7WUFDbkMsMEJBQTBCLEVBQUUsd0JBQWMsQ0FBQyxvQkFBb0IsQ0FDN0QsT0FBTyxFQUNQLENBQUMsRUFDRCxDQUFDLENBQ0Y7WUFDRCxtQkFBbUIsRUFBRSx3QkFBYyxDQUFDLG9CQUFvQixDQUN0RCw2QkFBWSxFQUNaLENBQUMsRUFDRCxDQUFDLENBQ0Y7WUFDRCxXQUFXLEVBQUUscUJBQVMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDO1lBQzlCLEtBQUs7WUFDTCxnQkFBZ0IsRUFBRSxVQUFVO2dCQUMxQixDQUFDLGlDQUNJLElBQUksQ0FBQyxxQkFBcUIsQ0FBQyxLQUFLLEVBQUUsVUFBVSxDQUFDLEtBQ2hELEVBQUUsRUFBRSxJQUFBLCtCQUF3QixFQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsSUFFNUMsQ0FBQyxDQUFDLFNBQVM7WUFDYixXQUFXLEVBQUUscUJBQVMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDO1NBQy9CLENBQUM7SUFDSixDQUFDO0lBRU8sS0FBSyxDQUFDLG9CQUFvQixDQUNoQyxRQUF3QixFQUN4QixRQUFlLEVBQ2YsTUFBaUIsRUFDakIsYUFBbUM7UUFFbkMsTUFBTSxFQUFFLGdCQUFnQixFQUFFLFNBQVMsRUFBRSxHQUNuQyxNQUFNLElBQUksQ0FBQyxhQUFhLENBQUMsb0JBQW9CLENBQzNDLENBQUMsUUFBUSxDQUFDLEVBQ1YsTUFBTSxFQUNOO1lBQ0UsV0FBVyxFQUFFLGFBQWEsYUFBYixhQUFhLHVCQUFiLGFBQWEsQ0FBRSxXQUFXO1NBQ3hDLENBQ0YsQ0FBQztRQUVKLE1BQU0sZ0JBQWdCLEdBQUcsZ0JBQUMsQ0FBQyxHQUFHLENBQzVCLFNBQVMsRUFDVCxDQUFDLENBQUMsS0FBSyxFQUFFLE1BQU0sQ0FBMkIsRUFBRSxFQUFFLGVBQzVDLE9BQUEsR0FBRyxJQUFBLHNCQUFhLEVBQUMsS0FBSyxDQUFDLE1BQU0sTUFBQSxNQUFBLE1BQU0sQ0FBQyxDQUFDLENBQUMsMENBQUUsS0FBSywwQ0FBRSxRQUFRLEVBQUUsRUFBRSxDQUFBLEVBQUEsQ0FDOUQsQ0FBQztRQUNGLFNBQUcsQ0FBQyxJQUFJLENBQUMsRUFBRSxnQkFBZ0IsRUFBRSxFQUFFLGFBQWEsQ0FBQyxDQUFDO1FBRTlDLE1BQU0sU0FBUyxHQUFHLE1BQU0sSUFBSSxDQUFDLFlBQVksQ0FDdkMsTUFBTSxFQUNOLFNBQVMsRUFDVCxRQUFRLEVBQ1Isb0JBQVMsQ0FBQyxXQUFXLENBQ3RCLENBQUM7UUFFRixPQUFPLFNBQVMsQ0FBQztJQUNuQixDQUFDO0lBRU8sS0FBSyxDQUFDLHFCQUFxQixDQUNqQyxTQUF5QixFQUN6QixPQUFjLEVBQ2QsTUFBaUIsRUFDakIsYUFBbUM7UUFFbkMsTUFBTSxFQUFFLGdCQUFnQixFQUFFLFNBQVMsRUFBRSxHQUNuQyxNQUFNLElBQUksQ0FBQyxhQUFhLENBQUMscUJBQXFCLENBQzVDLENBQUMsU0FBUyxDQUFDLEVBQ1gsTUFBTSxFQUNOO1lBQ0UsV0FBVyxFQUFFLGFBQWEsYUFBYixhQUFhLHVCQUFiLGFBQWEsQ0FBRSxXQUFXO1NBQ3hDLENBQ0YsQ0FBQztRQUNKLE1BQU0sU0FBUyxHQUFHLE1BQU0sSUFBSSxDQUFDLFlBQVksQ0FDdkMsTUFBTSxFQUNOLFNBQVMsRUFDVCxPQUFPLEVBQ1Asb0JBQVMsQ0FBQyxZQUFZLENBQ3ZCLENBQUM7UUFFRixPQUFPLFNBQVMsQ0FBQztJQUNuQixDQUFDO0lBRU8sS0FBSyxDQUFDLFlBQVksQ0FDeEIsTUFBaUIsRUFDakIsU0FBcUMsRUFDckMsVUFBaUIsRUFDakIsU0FBb0I7UUFFcEIsU0FBRyxDQUFDLEtBQUssQ0FDUCxPQUFPLGdCQUFDLENBQUMsTUFBTSxDQUFDLFNBQVMsRUFBRSxDQUFDLENBQUMsQ0FBQyxFQUFFLE1BQU0sQ0FBQyxFQUFFLEVBQUUsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsTUFDekQsc0JBQXNCLE1BQU0sQ0FBQyxNQUFNLG1CQUFtQixDQUN2RCxDQUFDO1FBRUYsTUFBTSxjQUFjLEdBSWQsRUFBRSxDQUFDO1FBRVQsS0FBSyxJQUFJLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxHQUFHLFNBQVMsQ0FBQyxNQUFNLEVBQUUsQ0FBQyxFQUFFLEVBQUU7WUFDekMsTUFBTSxDQUFDLEtBQUssRUFBRSxNQUFNLENBQUMsR0FBRyxTQUFTLENBQUMsQ0FBQyxDQUFFLENBQUM7WUFDdEMsTUFBTSxFQUFFLEtBQUssRUFBRSxNQUFNLEVBQUUsR0FBRyxNQUFNLENBQUMsQ0FBQyxDQUFFLENBQUM7WUFFckMsSUFBSSxDQUFDLEtBQUssRUFBRTtnQkFDVixlQUFNLENBQUMsWUFBWSxFQUFFLENBQUMsS0FBSyxDQUFDLGdCQUFnQixJQUFBLHNCQUFhLEVBQUMsS0FBSyxDQUFDLEVBQUUsQ0FBQyxDQUFDO2dCQUNwRSxTQUFTO2FBQ1Y7WUFFRCxjQUFjLENBQUMsSUFBSSxDQUFDLEVBQUUsS0FBSyxFQUFFLEtBQUssRUFBRSxNQUFNLEVBQUUsQ0FBQyxDQUFDO1NBQy9DO1FBRUQsSUFBSSxjQUFjLENBQUMsTUFBTSxJQUFJLENBQUMsRUFBRTtZQUM5QixPQUFPLElBQUksQ0FBQztTQUNiO1FBRUQsY0FBYyxDQUFDLElBQUksQ0FBQyxDQUFDLFdBQVcsRUFBRSxXQUFXLEVBQUUsRUFBRTtZQUMvQyxJQUFJLFNBQVMsSUFBSSxvQkFBUyxDQUFDLFdBQVcsRUFBRTtnQkFDdEMsT0FBTyxXQUFXLENBQUMsS0FBSyxDQUFDLEVBQUUsQ0FBQyxXQUFXLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7YUFDekQ7aUJBQU07Z0JBQ0wsT0FBTyxXQUFXLENBQUMsS0FBSyxDQUFDLEVBQUUsQ0FBQyxXQUFXLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7YUFDekQ7UUFDSCxDQUFDLENBQUMsQ0FBQztRQUVILE1BQU0sV0FBVyxHQUFHLGdCQUFDLENBQUMsR0FBRyxDQUFDLGNBQWMsRUFBRSxDQUFDLEVBQUUsS0FBSyxFQUFFLEtBQUssRUFBRSxNQUFNLEVBQUUsRUFBRSxFQUFFO1lBQ3JFLE9BQU8sSUFBSSxvQ0FBcUIsQ0FBQztnQkFDL0IsS0FBSztnQkFDTCxRQUFRLEVBQUUsS0FBSztnQkFDZixNQUFNO2dCQUNOLE9BQU8sRUFBRSxHQUFHO2dCQUNaLFFBQVEsRUFBRTtvQkFDUixlQUFlLEVBQUUsR0FBRyxFQUFFLENBQUMsQ0FBQzt3QkFDdEIsY0FBYyxFQUFFLHdCQUFjLENBQUMsYUFBYSxDQUFDLFVBQVUsRUFBRSxDQUFDLENBQUM7d0JBQzNELFlBQVksRUFBRSx3QkFBYyxDQUFDLGFBQWEsQ0FBQyw2QkFBWSxFQUFFLENBQUMsQ0FBQzt3QkFDM0QsV0FBVyxFQUFFLHFCQUFTLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQztxQkFDL0IsQ0FBQztpQkFDSDtnQkFDRCxxQkFBcUIsRUFBRSxFQUFFO2dCQUN6QiwyQkFBMkIsRUFBRSxFQUFFO2dCQUMvQixpQkFBaUIsRUFBRSxxQkFBUyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUM7Z0JBQ3BDLFNBQVMsRUFBRSxTQUFTO2dCQUNwQixVQUFVO2dCQUNWLGNBQWMsRUFBRSxJQUFJLENBQUMsWUFBWTthQUNsQyxDQUFDLENBQUM7UUFDTCxDQUFDLENBQUMsQ0FBQztRQUVILEtBQUssTUFBTSxFQUFFLElBQUksV0FBVyxFQUFFO1lBQzVCLFNBQUcsQ0FBQyxLQUFLLENBQ1AsVUFBVSxFQUFFLENBQUMsTUFBTSxDQUFDLE9BQU8sQ0FDekIsSUFBSSxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsTUFBTSxDQUFDLFFBQVEsQ0FBQyxRQUFRLEVBQUUsQ0FBQyxDQUFDLENBQ3pDLFdBQVcsSUFBQSxzQkFBYSxFQUFDLEVBQUUsQ0FBQyxLQUFLLENBQUMsRUFBRSxDQUN0QyxDQUFDO1NBQ0g7UUFFRCxPQUFPLFdBQVcsQ0FBQyxDQUFDLENBQUUsQ0FBQztJQUN6QixDQUFDO0lBRU8sS0FBSyxDQUFDLFlBQVksQ0FDeEIsT0FBYyxFQUNkLFFBQWUsRUFDZixhQUFtQztRQUVuQyxNQUFNLFVBQVUsR0FDZCxNQUFNLElBQUksQ0FBQyxzQkFBc0IsQ0FBQyxPQUFPLEVBQUUsUUFBUSxDQUFDLENBQUM7UUFFdkQsTUFBTSxZQUFZLEdBQUcsTUFBTSxJQUFJLENBQUMsWUFBWSxDQUFDLFFBQVEsQ0FBQyxVQUFVLEVBQUU7WUFDaEUsV0FBVyxFQUFFLGFBQWEsYUFBYixhQUFhLHVCQUFiLGFBQWEsQ0FBRSxXQUFXO1NBQ3hDLENBQUMsQ0FBQztRQUNILE1BQU0sS0FBSyxHQUFHLFlBQVksQ0FBQyxXQUFXLEVBQUUsQ0FBQztRQUV6QyxNQUFNLE1BQU0sR0FBYyxJQUFJLENBQUMsZ0JBQWdCLENBQzdDLE9BQU8sRUFDUCxRQUFRLEVBQ1IsS0FBSyxFQUNMLElBQUksQ0FBQyxPQUFPLEVBQ1osRUFBRSxFQUNGLEVBQUUsRUFDRixPQUFPLEVBQ1AsUUFBUSxDQUNULENBQUM7UUFFRixTQUFHLENBQUMsSUFBSSxDQUNOLEVBQUUsTUFBTSxFQUFFLGdCQUFDLENBQUMsR0FBRyxDQUFDLE1BQU0sRUFBRSxzQkFBYSxDQUFDLEVBQUUsRUFDeEMsWUFBWSxNQUFNLENBQUMsTUFBTSxtQkFBbUIsQ0FDN0MsQ0FBQztRQUVGLE9BQU8sTUFBTSxDQUFDO0lBQ2hCLENBQUM7SUFFTyxLQUFLLENBQUMsc0JBQXNCLENBQ2xDLE9BQWMsRUFDZCxRQUFlOztRQUVmLE1BQU0sTUFBTSxHQUNWLE1BQUEsSUFBQSxxQ0FBNkIsRUFBQyxJQUFJLENBQUMsYUFBYSxDQUFDLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxtQ0FBSSxFQUFFLENBQUM7UUFDeEUsTUFBTSxXQUFXLEdBQ2YsTUFBQSxNQUFBLENBQUMsTUFBTSxJQUFBLHdCQUFnQixFQUFDLElBQUksQ0FBQyxhQUFhLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsMENBQzFELE9BQU8sQ0FBQyxPQUFPLENBQ2QsbUNBQUksRUFBRSxDQUFDO1FBQ1YsTUFBTSxXQUFXLEdBQ2YsTUFBQSxNQUFBLENBQUMsTUFBTSxJQUFBLHdCQUFnQixFQUFDLElBQUksQ0FBQyxhQUFhLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsMENBQzFELFFBQVEsQ0FBQyxPQUFPLENBQ2YsbUNBQUksRUFBRSxDQUFDO1FBQ1YsTUFBTSxLQUFLLEdBQUcsQ0FBQyxHQUFHLE1BQU0sRUFBRSxHQUFHLFdBQVcsRUFBRSxHQUFHLFdBQVcsQ0FBQyxDQUFDO1FBRTFELE1BQU0sU0FBUyxHQUFxQixnQkFBQyxDQUFDLE9BQU8sQ0FDM0MsS0FBSyxFQUNMLENBQUMsSUFBSSxFQUFvQixFQUFFLENBQUMsS0FBSyxDQUFDLEdBQUcsQ0FBQyxDQUFDLFNBQVMsRUFBRSxFQUFFLENBQUMsQ0FBQyxJQUFJLEVBQUUsU0FBUyxDQUFDLENBQUMsQ0FDeEUsQ0FBQztRQUVGLE1BQU0sV0FBVyxHQUFHLENBQUMsTUFBTSxJQUFBLG9CQUFZLEVBQUMsSUFBSSxDQUFDLGFBQWEsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxDQUFDO1FBRTNFLE1BQU0sUUFBUSxHQUFnQyxJQUFBLGdCQUFDLEVBQUM7WUFDOUMsa0JBQWtCO1lBQ2xCLENBQUMsT0FBTyxFQUFFLFFBQVEsQ0FBQztZQUNuQiw0QkFBNEI7WUFDNUIsR0FBRyxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUMsSUFBSSxFQUFrQixFQUFFLENBQUMsQ0FBQyxPQUFPLEVBQUUsSUFBSSxDQUFDLENBQUM7WUFDdkQsNEJBQTRCO1lBQzVCLEdBQUcsS0FBSyxDQUFDLEdBQUcsQ0FBQyxDQUFDLElBQUksRUFBa0IsRUFBRSxDQUFDLENBQUMsUUFBUSxFQUFFLElBQUksQ0FBQyxDQUFDO1lBQ3hELDhCQUE4QjtZQUM5QixHQUFHLFNBQVM7U0FDYixDQUFDO2FBQ0MsTUFBTSxDQUFDLENBQUMsTUFBTSxFQUE0QixFQUFFLENBQzNDLE9BQU8sQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLElBQUksTUFBTSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQ2hDO2FBQ0EsTUFBTSxDQUNMLENBQUMsQ0FBQyxNQUFNLEVBQUUsTUFBTSxDQUFDLEVBQUUsRUFBRSxDQUNuQixNQUFNLENBQUMsT0FBTyxLQUFLLE1BQU0sQ0FBQyxPQUFPLElBQUksQ0FBQyxNQUFNLENBQUMsTUFBTSxDQUFDLE1BQU0sQ0FBQyxDQUM5RDthQUNBLE1BQU0sQ0FBQyxDQUFDLENBQUMsTUFBTSxFQUFFLE1BQU0sQ0FBQyxFQUFFLEVBQUU7WUFDM0IsTUFBTSxZQUFZLEdBQXdCLFdBQVcsYUFBWCxXQUFXLHVCQUFYLFdBQVcsQ0FBRyxNQUFNLENBQUMsT0FBTyxDQUFDLENBQUM7WUFDeEUsTUFBTSxZQUFZLEdBQXdCLFdBQVcsYUFBWCxXQUFXLHVCQUFYLFdBQVcsQ0FBRyxNQUFNLENBQUMsT0FBTyxDQUFDLENBQUM7WUFFeEUsSUFBSSxDQUFDLFlBQVksSUFBSSxDQUFDLFlBQVk7Z0JBQUUsT0FBTyxJQUFJLENBQUM7WUFFaEQsSUFBSSxZQUFZLElBQUksQ0FBQyxZQUFZLENBQUMsSUFBSSxDQUFDLENBQUMsSUFBSSxFQUFFLEVBQUUsQ0FBQyxNQUFNLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxDQUFDO2dCQUNuRSxPQUFPLEtBQUssQ0FBQztZQUNmLElBQUksWUFBWSxJQUFJLENBQUMsWUFBWSxDQUFDLElBQUksQ0FBQyxDQUFDLElBQUksRUFBRSxFQUFFLENBQUMsTUFBTSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsQ0FBQztnQkFDbkUsT0FBTyxLQUFLLENBQUM7WUFFZixPQUFPLElBQUksQ0FBQztRQUNkLENBQUMsQ0FBQzthQUNELE9BQU8sQ0FBNEIsQ0FBQyxDQUFDLE1BQU0sRUFBRSxNQUFNLENBQUMsRUFBRSxFQUFFO1lBQ3ZELE9BQU87Z0JBQ0wsQ0FBQyxNQUFNLEVBQUUsTUFBTSxFQUFFLGtCQUFTLENBQUMsR0FBRyxDQUFDO2dCQUMvQixDQUFDLE1BQU0sRUFBRSxNQUFNLEVBQUUsa0JBQVMsQ0FBQyxNQUFNLENBQUM7Z0JBQ2xDLENBQUMsTUFBTSxFQUFFLE1BQU0sRUFBRSxrQkFBUyxDQUFDLElBQUksQ0FBQzthQUNqQyxDQUFDO1FBQ0osQ0FBQyxDQUFDO2FBQ0QsS0FBSyxFQUFFLENBQUM7UUFFWCxPQUFPLFFBQVEsQ0FBQztJQUNsQixDQUFDO0lBRU8sZ0JBQWdCLENBQ3RCLE9BQWMsRUFDZCxRQUFlLEVBQ2YsS0FBYSxFQUNiLE9BQWdCLEVBQ2hCLGNBQXNCLEVBQUUsRUFDeEIsV0FBc0IsRUFBRSxFQUN4QixlQUFzQixPQUFPLEVBQzdCLE9BQU8sR0FBRyxDQUFDO1FBRVgsS0FBSyxNQUFNLElBQUksSUFBSSxLQUFLLEVBQUU7WUFDeEIsSUFBSSxXQUFXLENBQUMsT0FBTyxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLGFBQWEsQ0FBQyxPQUFPLENBQUM7Z0JBQ2xFLFNBQVM7WUFFWCxNQUFNLFdBQVcsR0FBRyxJQUFJLENBQUMsTUFBTSxDQUFDLE1BQU0sQ0FBQyxPQUFPLENBQUM7Z0JBQzdDLENBQUMsQ0FBQyxJQUFJLENBQUMsTUFBTTtnQkFDYixDQUFDLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQztZQUNoQixJQUFJLFdBQVcsQ0FBQyxNQUFNLENBQUMsUUFBUSxDQUFDLEVBQUU7Z0JBQ2hDLFFBQVEsQ0FBQyxJQUFJLENBQ1gsSUFBSSxnQkFBTyxDQUFDLENBQUMsR0FBRyxXQUFXLEVBQUUsSUFBSSxDQUFDLEVBQUUsWUFBWSxFQUFFLFFBQVEsQ0FBQyxDQUM1RCxDQUFDO2FBQ0g7aUJBQU0sSUFBSSxPQUFPLEdBQUcsQ0FBQyxFQUFFO2dCQUN0QixJQUFJLENBQUMsZ0JBQWdCLENBQ25CLFdBQVcsRUFDWCxRQUFRLEVBQ1IsS0FBSyxFQUNMLE9BQU8sRUFDUCxDQUFDLEdBQUcsV0FBVyxFQUFFLElBQUksQ0FBQyxFQUN0QixRQUFRLEVBQ1IsWUFBWSxFQUNaLE9BQU8sR0FBRyxDQUFDLENBQ1osQ0FBQzthQUNIO1NBQ0Y7UUFFRCxPQUFPLFFBQVEsQ0FBQztJQUNsQixDQUFDO0lBRU8sVUFBVSxDQUNoQixlQUF5QixFQUN6QixnQkFBMEIsRUFDMUIsU0FBcUIsRUFDckIsV0FBa0M7UUFFbEMsTUFBTSxFQUFFLEtBQUssRUFBRSxNQUFNLEVBQUUsS0FBSyxFQUFFLEdBQUcsV0FBVyxDQUFDO1FBRTdDLGtFQUFrRTtRQUNsRSx1RUFBdUU7UUFDdkUsc0ZBQXNGO1FBQ3RGLElBQUksU0FBUyxJQUFJLG9CQUFTLENBQUMsV0FBVyxFQUFFO1lBQ3RDLE1BQU0sY0FBYyxHQUFHLHdCQUFjLENBQUMsb0JBQW9CLENBQ3hELGVBQWUsRUFDZixNQUFNLENBQUMsU0FBUyxFQUNoQixNQUFNLENBQUMsV0FBVyxDQUNuQixDQUFDO1lBQ0YsTUFBTSxhQUFhLEdBQUcsd0JBQWMsQ0FBQyxvQkFBb0IsQ0FDdkQsZ0JBQWdCLEVBQ2hCLEtBQUssQ0FBQyxTQUFTLEVBQ2YsS0FBSyxDQUFDLFdBQVcsQ0FDbEIsQ0FBQztZQUVGLE1BQU0sYUFBYSxHQUFHLElBQUksY0FBSyxDQUM3QixLQUFLLENBQUMsS0FBSyxFQUNYLGNBQWMsQ0FBQyxRQUFRLEVBQ3ZCLGFBQWEsQ0FBQyxRQUFRLENBQ3ZCLENBQUM7WUFFRixPQUFPLElBQUksa0JBQUssQ0FBQztnQkFDZixRQUFRLEVBQUU7b0JBQ1I7d0JBQ0UsT0FBTyxFQUFFLGFBQWE7d0JBQ3RCLFdBQVcsRUFBRSxjQUFjO3dCQUMzQixZQUFZLEVBQUUsYUFBYTtxQkFDNUI7aUJBQ0Y7Z0JBQ0QsUUFBUSxFQUFFLEVBQUU7Z0JBQ1osU0FBUyxFQUFFLFNBQVM7YUFDckIsQ0FBQyxDQUFDO1NBQ0o7YUFBTTtZQUNMLE1BQU0sYUFBYSxHQUFHLHdCQUFjLENBQUMsb0JBQW9CLENBQ3ZELGVBQWUsRUFDZixLQUFLLENBQUMsU0FBUyxFQUNmLEtBQUssQ0FBQyxXQUFXLENBQ2xCLENBQUM7WUFFRixNQUFNLGNBQWMsR0FBRyx3QkFBYyxDQUFDLG9CQUFvQixDQUN4RCxnQkFBZ0IsRUFDaEIsTUFBTSxDQUFDLFNBQVMsRUFDaEIsTUFBTSxDQUFDLFdBQVcsQ0FDbkIsQ0FBQztZQUVGLE1BQU0sYUFBYSxHQUFHLElBQUksY0FBSyxDQUM3QixLQUFLLENBQUMsS0FBSyxFQUNYLGFBQWEsQ0FBQyxRQUFRLEVBQ3RCLGNBQWMsQ0FBQyxRQUFRLENBQ3hCLENBQUM7WUFFRixPQUFPLElBQUksa0JBQUssQ0FBQztnQkFDZixRQUFRLEVBQUU7b0JBQ1I7d0JBQ0UsT0FBTyxFQUFFLGFBQWE7d0JBQ3RCLFdBQVcsRUFBRSxhQUFhO3dCQUMxQixZQUFZLEVBQUUsY0FBYztxQkFDN0I7aUJBQ0Y7Z0JBQ0QsUUFBUSxFQUFFLEVBQUU7Z0JBQ1osU0FBUyxFQUFFLFNBQVM7YUFDckIsQ0FBQyxDQUFDO1NBQ0o7SUFDSCxDQUFDO0lBRU8scUJBQXFCLENBQzNCLEtBQTRDLEVBQzVDLFVBQW1DO1FBRW5DLE1BQU0sRUFBRSxTQUFTLEVBQUUsaUJBQWlCLEVBQUUsUUFBUSxFQUFFLEdBQUcsVUFBVSxDQUFDO1FBRTlELE1BQU0sZ0JBQWdCLEdBQUcsdUJBQVUsQ0FBQyxrQkFBa0IsQ0FBQyxLQUFLLEVBQUU7WUFDNUQsU0FBUztZQUNULGlCQUFpQjtZQUNqQiwyQkFBMkIsRUFBRSxRQUFRO1lBQ3JDLG9CQUFvQjtZQUNwQixRQUFRO1lBQ1IsMEJBQTBCO1lBQzFCLHFDQUFxQztZQUNyQyxnQkFBZ0I7WUFDaEIsZ0RBQWdEO1lBQ2hELDRDQUE0QztZQUM1QyxvQ0FBb0M7WUFDcEMsb0NBQW9DO1lBQ3BDLDJDQUEyQztZQUMzQyxnQkFBZ0I7WUFDaEIsZ0JBQWdCO1lBQ2hCLGtEQUFrRDtZQUNsRCw4Q0FBOEM7WUFDOUMsb0NBQW9DO1lBQ3BDLG9DQUFvQztZQUNwQywyQ0FBMkM7WUFDM0MsaUJBQWlCO1lBQ2pCLFFBQVE7WUFDUixXQUFXO1NBQ1osQ0FBQyxDQUFDO1FBRUgsT0FBTyxnQkFBZ0IsQ0FBQztJQUMxQixDQUFDO0NBQ0Y7QUFoaEJELG9DQWdoQkMifQ==