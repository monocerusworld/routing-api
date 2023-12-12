import { BigNumber } from '@ethersproject/bignumber';
import { JsonRpcProvider } from '@ethersproject/providers';
import DEFAULT_TOKEN_LIST from '@uniswap/default-token-list';
import { Protocol, SwapRouter } from '@uniswap/router-sdk';
import { Fraction, TradeType } from '@uniswap/sdk-core';
import { Pool, Position, SqrtPriceMath, TickMath } from '@uniswap/v3-sdk';
import retry from 'async-retry';
import JSBI from 'jsbi';
import _ from 'lodash';
import NodeCache from 'node-cache';
import { CachedRoutes, CacheMode, CachingGasStationProvider, CachingTokenProviderWithFallback, CachingV2PoolProvider, CachingV2SubgraphProvider, CachingV3PoolProvider, CachingV3SubgraphProvider, EIP1559GasPriceProvider, ETHGasStationInfoProvider, LegacyGasPriceProvider, NodeJSCache, OnChainGasPriceProvider, OnChainQuoteProvider, StaticV2SubgraphProvider, StaticV3SubgraphProvider, SwapRouterProvider, UniswapMulticallProvider, URISubgraphProvider, V2QuoteProvider, V2SubgraphProviderWithFallBacks, V3SubgraphProviderWithFallBacks, } from '../../providers';
import { CachingTokenListProvider, } from '../../providers/caching-token-list-provider';
import { TokenProvider } from '../../providers/token-provider';
import { TokenValidatorProvider, } from '../../providers/token-validator-provider';
import { V2PoolProvider, } from '../../providers/v2/pool-provider';
import { MantaGasDataProvider, } from '../../providers/v3/gas-data-provider';
import { V3PoolProvider, } from '../../providers/v3/pool-provider';
import { Erc20__factory } from '../../types/other/factories/Erc20__factory';
import { SWAP_ROUTER_02_ADDRESSES } from '../../util';
import { CurrencyAmount } from '../../util/amounts';
import { ChainId, ID_TO_CHAIN_ID, ID_TO_NETWORK_NAME, V2_SUPPORTED, } from '../../util/chains';
import { log } from '../../util/log';
import { buildSwapMethodParameters, buildTrade, } from '../../util/methodParameters';
import { metric, MetricLoggerUnit } from '../../util/metric';
import { UNSUPPORTED_TOKENS } from '../../util/unsupported-tokens';
import { SwapToRatioStatus, } from '../router';
import { DEFAULT_ROUTING_CONFIG_BY_CHAIN, ETH_GAS_STATION_API_URL, } from './config';
import { getBestSwapRoute } from './functions/best-swap-route';
import { calculateRatioAmountIn } from './functions/calculate-ratio-amount-in';
import { MixedRouteHeuristicGasModelFactory } from './gas-models/mixedRoute/mixed-route-heuristic-gas-model';
import { V2HeuristicGasModelFactory } from './gas-models/v2/v2-heuristic-gas-model';
import { V3HeuristicGasModelFactory } from './gas-models/v3/v3-heuristic-gas-model';
import { MixedQuoter, V2Quoter, V3Quoter } from './quoters';
export class MapWithLowerCaseKey extends Map {
    set(key, value) {
        return super.set(key.toLowerCase(), value);
    }
}
export class AlphaRouter {
    constructor({ chainId, provider, multicall2Provider, v3PoolProvider, onChainQuoteProvider, v2PoolProvider, v2QuoteProvider, v2SubgraphProvider, tokenProvider, blockedTokenListProvider, v3SubgraphProvider, gasPriceProvider, v3GasModelFactory, v2GasModelFactory, mixedRouteGasModelFactory, swapRouterProvider, mantaGasDataProvider, tokenValidatorProvider, simulator, routeCachingProvider, }) {
        this.chainId = chainId;
        this.provider = provider;
        this.multicall2Provider =
            multicall2Provider !== null && multicall2Provider !== void 0 ? multicall2Provider : new UniswapMulticallProvider(chainId, provider, 375000);
        this.v3PoolProvider =
            v3PoolProvider !== null && v3PoolProvider !== void 0 ? v3PoolProvider : new CachingV3PoolProvider(this.chainId, new V3PoolProvider(ID_TO_CHAIN_ID(chainId), this.multicall2Provider), new NodeJSCache(new NodeCache({ stdTTL: 360, useClones: false })));
        this.simulator = simulator;
        this.routeCachingProvider = routeCachingProvider;
        if (onChainQuoteProvider) {
            this.onChainQuoteProvider = onChainQuoteProvider;
        }
        else {
            switch (chainId) {
                case ChainId.MANTA:
                case ChainId.MANTA_TESTNET:
                    this.onChainQuoteProvider = new OnChainQuoteProvider(chainId, provider, this.multicall2Provider, {
                        retries: 2,
                        minTimeout: 100,
                        maxTimeout: 1000,
                    }, {
                        multicallChunk: 110,
                        gasLimitPerCall: 1200000,
                        quoteMinSuccessRate: 0.1,
                    }, {
                        gasLimitOverride: 3000000,
                        multicallChunk: 45,
                    }, {
                        gasLimitOverride: 3000000,
                        multicallChunk: 45,
                    }, {
                        baseBlockOffset: -10,
                        rollback: {
                            enabled: true,
                            attemptsBeforeRollback: 1,
                            rollbackBlockOffset: -10,
                        },
                    });
                    break;
                default:
                    this.onChainQuoteProvider = new OnChainQuoteProvider(chainId, provider, this.multicall2Provider, {
                        retries: 2,
                        minTimeout: 100,
                        maxTimeout: 1000,
                    }, {
                        multicallChunk: 210,
                        gasLimitPerCall: 705000,
                        quoteMinSuccessRate: 0.15,
                    }, {
                        gasLimitOverride: 2000000,
                        multicallChunk: 70,
                    });
                    break;
            }
        }
        this.v2PoolProvider =
            v2PoolProvider !== null && v2PoolProvider !== void 0 ? v2PoolProvider : new CachingV2PoolProvider(chainId, new V2PoolProvider(chainId, this.multicall2Provider), new NodeJSCache(new NodeCache({ stdTTL: 60, useClones: false })));
        this.v2QuoteProvider = v2QuoteProvider !== null && v2QuoteProvider !== void 0 ? v2QuoteProvider : new V2QuoteProvider();
        this.blockedTokenListProvider =
            blockedTokenListProvider !== null && blockedTokenListProvider !== void 0 ? blockedTokenListProvider : new CachingTokenListProvider(chainId, UNSUPPORTED_TOKENS, new NodeJSCache(new NodeCache({ stdTTL: 3600, useClones: false })));
        this.tokenProvider =
            tokenProvider !== null && tokenProvider !== void 0 ? tokenProvider : new CachingTokenProviderWithFallback(chainId, new NodeJSCache(new NodeCache({ stdTTL: 3600, useClones: false })), new CachingTokenListProvider(chainId, DEFAULT_TOKEN_LIST, new NodeJSCache(new NodeCache({ stdTTL: 3600, useClones: false }))), new TokenProvider(chainId, this.multicall2Provider));
        const chainName = ID_TO_NETWORK_NAME(chainId);
        // ipfs urls in the following format: `https://cloudflare-ipfs.com/ipns/api.uniswap.org/v1/pools/${protocol}/${chainName}.json`;
        if (v2SubgraphProvider) {
            this.v2SubgraphProvider = v2SubgraphProvider;
        }
        else {
            this.v2SubgraphProvider = new V2SubgraphProviderWithFallBacks([
                new CachingV2SubgraphProvider(chainId, new URISubgraphProvider(chainId, `https://cloudflare-ipfs.com/ipns/api.uniswap.org/v1/pools/v2/${chainName}.json`, undefined, 0), new NodeJSCache(new NodeCache({ stdTTL: 300, useClones: false }))),
                new StaticV2SubgraphProvider(chainId),
            ]);
        }
        if (v3SubgraphProvider) {
            this.v3SubgraphProvider = v3SubgraphProvider;
        }
        else {
            this.v3SubgraphProvider = new V3SubgraphProviderWithFallBacks([
                new CachingV3SubgraphProvider(chainId, new URISubgraphProvider(chainId, `https://cloudflare-ipfs.com/ipns/api.uniswap.org/v1/pools/v3/${chainName}.json`, undefined, 0), new NodeJSCache(new NodeCache({ stdTTL: 300, useClones: false }))),
                new StaticV3SubgraphProvider(chainId, this.v3PoolProvider),
            ]);
        }
        let gasPriceProviderInstance;
        if (JsonRpcProvider.isProvider(this.provider)) {
            gasPriceProviderInstance = new OnChainGasPriceProvider(chainId, new EIP1559GasPriceProvider(this.provider), new LegacyGasPriceProvider(this.provider));
        }
        else {
            gasPriceProviderInstance = new ETHGasStationInfoProvider(ETH_GAS_STATION_API_URL);
        }
        this.gasPriceProvider =
            gasPriceProvider !== null && gasPriceProvider !== void 0 ? gasPriceProvider : new CachingGasStationProvider(chainId, gasPriceProviderInstance, new NodeJSCache(new NodeCache({ stdTTL: 15, useClones: false })));
        this.v3GasModelFactory =
            v3GasModelFactory !== null && v3GasModelFactory !== void 0 ? v3GasModelFactory : new V3HeuristicGasModelFactory();
        this.v2GasModelFactory =
            v2GasModelFactory !== null && v2GasModelFactory !== void 0 ? v2GasModelFactory : new V2HeuristicGasModelFactory();
        this.mixedRouteGasModelFactory =
            mixedRouteGasModelFactory !== null && mixedRouteGasModelFactory !== void 0 ? mixedRouteGasModelFactory : new MixedRouteHeuristicGasModelFactory();
        this.swapRouterProvider =
            swapRouterProvider !== null && swapRouterProvider !== void 0 ? swapRouterProvider : new SwapRouterProvider(this.multicall2Provider, this.chainId);
        if (chainId === ChainId.MANTA || chainId === ChainId.MANTA_TESTNET) {
            this.l2GasDataProvider =
                mantaGasDataProvider !== null && mantaGasDataProvider !== void 0 ? mantaGasDataProvider : new MantaGasDataProvider(chainId, this.multicall2Provider);
        }
        if (tokenValidatorProvider) {
            this.tokenValidatorProvider = tokenValidatorProvider;
        }
        else if (this.chainId === ChainId.MAINNET) {
            this.tokenValidatorProvider = new TokenValidatorProvider(this.chainId, this.multicall2Provider, new NodeJSCache(new NodeCache({ stdTTL: 30000, useClones: false })));
        }
        // Initialize the Quoters.
        // Quoters are an abstraction encapsulating the business logic of fetching routes and quotes.
        this.v2Quoter = new V2Quoter(this.v2SubgraphProvider, this.v2PoolProvider, this.v2QuoteProvider, this.v2GasModelFactory, this.tokenProvider, this.chainId, this.blockedTokenListProvider, this.tokenValidatorProvider);
        this.v3Quoter = new V3Quoter(this.v3SubgraphProvider, this.v3PoolProvider, this.onChainQuoteProvider, this.tokenProvider, this.chainId, this.blockedTokenListProvider, this.tokenValidatorProvider);
        this.mixedQuoter = new MixedQuoter(this.v3SubgraphProvider, this.v3PoolProvider, this.v2SubgraphProvider, this.v2PoolProvider, this.onChainQuoteProvider, this.tokenProvider, this.chainId, this.blockedTokenListProvider, this.tokenValidatorProvider);
    }
    async routeToRatio(token0Balance, token1Balance, position, swapAndAddConfig, swapAndAddOptions, routingConfig = DEFAULT_ROUTING_CONFIG_BY_CHAIN(this.chainId)) {
        if (token1Balance.currency.wrapped.sortsBefore(token0Balance.currency.wrapped)) {
            [token0Balance, token1Balance] = [token1Balance, token0Balance];
        }
        let preSwapOptimalRatio = this.calculateOptimalRatio(position, position.pool.sqrtRatioX96, true);
        // set up parameters according to which token will be swapped
        let zeroForOne;
        if (position.pool.tickCurrent > position.tickUpper) {
            zeroForOne = true;
        }
        else if (position.pool.tickCurrent < position.tickLower) {
            zeroForOne = false;
        }
        else {
            zeroForOne = new Fraction(token0Balance.quotient, token1Balance.quotient).greaterThan(preSwapOptimalRatio);
            if (!zeroForOne)
                preSwapOptimalRatio = preSwapOptimalRatio.invert();
        }
        const [inputBalance, outputBalance] = zeroForOne
            ? [token0Balance, token1Balance]
            : [token1Balance, token0Balance];
        let optimalRatio = preSwapOptimalRatio;
        let postSwapTargetPool = position.pool;
        let exchangeRate = zeroForOne
            ? position.pool.token0Price
            : position.pool.token1Price;
        let swap = null;
        let ratioAchieved = false;
        let n = 0;
        // iterate until we find a swap with a sufficient ratio or return null
        while (!ratioAchieved) {
            n++;
            if (n > swapAndAddConfig.maxIterations) {
                log.info('max iterations exceeded');
                return {
                    status: SwapToRatioStatus.NO_ROUTE_FOUND,
                    error: 'max iterations exceeded',
                };
            }
            const amountToSwap = calculateRatioAmountIn(optimalRatio, exchangeRate, inputBalance, outputBalance);
            if (amountToSwap.equalTo(0)) {
                log.info(`no swap needed: amountToSwap = 0`);
                return {
                    status: SwapToRatioStatus.NO_SWAP_NEEDED,
                };
            }
            swap = await this.route(amountToSwap, outputBalance.currency, TradeType.EXACT_INPUT, undefined, {
                ...DEFAULT_ROUTING_CONFIG_BY_CHAIN(this.chainId),
                ...routingConfig,
                /// @dev We do not want to query for mixedRoutes for routeToRatio as they are not supported
                /// [Protocol.V3, Protocol.V2] will make sure we only query for V3 and V2
                protocols: [Protocol.V3, Protocol.V2],
            });
            if (!swap) {
                log.info('no route found from this.route()');
                return {
                    status: SwapToRatioStatus.NO_ROUTE_FOUND,
                    error: 'no route found',
                };
            }
            const inputBalanceUpdated = inputBalance.subtract(swap.trade.inputAmount);
            const outputBalanceUpdated = outputBalance.add(swap.trade.outputAmount);
            const newRatio = inputBalanceUpdated.divide(outputBalanceUpdated);
            let targetPoolPriceUpdate;
            swap.route.forEach((route) => {
                if (route.protocol === Protocol.V3) {
                    const v3Route = route;
                    v3Route.route.pools.forEach((pool, i) => {
                        if (pool.token0.equals(position.pool.token0) &&
                            pool.token1.equals(position.pool.token1) &&
                            pool.fee === position.pool.fee) {
                            targetPoolPriceUpdate = JSBI.BigInt(v3Route.sqrtPriceX96AfterList[i].toString());
                            optimalRatio = this.calculateOptimalRatio(position, JSBI.BigInt(targetPoolPriceUpdate.toString()), zeroForOne);
                        }
                    });
                }
            });
            if (!targetPoolPriceUpdate) {
                optimalRatio = preSwapOptimalRatio;
            }
            ratioAchieved =
                newRatio.equalTo(optimalRatio) ||
                    this.absoluteValue(newRatio.asFraction.divide(optimalRatio).subtract(1)).lessThan(swapAndAddConfig.ratioErrorTolerance);
            if (ratioAchieved && targetPoolPriceUpdate) {
                postSwapTargetPool = new Pool(position.pool.token0, position.pool.token1, position.pool.fee, targetPoolPriceUpdate, position.pool.liquidity, TickMath.getTickAtSqrtRatio(targetPoolPriceUpdate), position.pool.tickDataProvider);
            }
            exchangeRate = swap.trade.outputAmount.divide(swap.trade.inputAmount);
            log.info({
                exchangeRate: exchangeRate.asFraction.toFixed(18),
                optimalRatio: optimalRatio.asFraction.toFixed(18),
                newRatio: newRatio.asFraction.toFixed(18),
                inputBalanceUpdated: inputBalanceUpdated.asFraction.toFixed(18),
                outputBalanceUpdated: outputBalanceUpdated.asFraction.toFixed(18),
                ratioErrorTolerance: swapAndAddConfig.ratioErrorTolerance.toFixed(18),
                iterationN: n.toString(),
            }, 'QuoteToRatio Iteration Parameters');
            if (exchangeRate.equalTo(0)) {
                log.info('exchangeRate to 0');
                return {
                    status: SwapToRatioStatus.NO_ROUTE_FOUND,
                    error: 'insufficient liquidity to swap to optimal ratio',
                };
            }
        }
        if (!swap) {
            return {
                status: SwapToRatioStatus.NO_ROUTE_FOUND,
                error: 'no route found',
            };
        }
        let methodParameters;
        if (swapAndAddOptions) {
            methodParameters = await this.buildSwapAndAddMethodParameters(swap.trade, swapAndAddOptions, {
                initialBalanceTokenIn: inputBalance,
                initialBalanceTokenOut: outputBalance,
                preLiquidityPosition: position,
            });
        }
        return {
            status: SwapToRatioStatus.SUCCESS,
            result: { ...swap, methodParameters, optimalRatio, postSwapTargetPool },
        };
    }
    /**
     * @inheritdoc IRouter
     */
    async route(amount, quoteCurrency, tradeType, swapConfig, partialRoutingConfig = {}) {
        var _a, _c, _d;
        const { currencyIn, currencyOut } = this.determineCurrencyInOutFromTradeType(tradeType, amount, quoteCurrency);
        const tokenIn = currencyIn.wrapped;
        const tokenOut = currencyOut.wrapped;
        metric.setProperty('chainId', this.chainId);
        metric.setProperty('pair', `${tokenIn.symbol}/${tokenOut.symbol}`);
        metric.setProperty('tokenIn', tokenIn.address);
        metric.setProperty('tokenOut', tokenOut.address);
        metric.setProperty('tradeType', tradeType === TradeType.EXACT_INPUT ? 'ExactIn' : 'ExactOut');
        metric.putMetric(`QuoteRequestedForChain${this.chainId}`, 1, MetricLoggerUnit.Count);
        // Get a block number to specify in all our calls. Ensures data we fetch from chain is
        // from the same block.
        const blockNumber = (_a = partialRoutingConfig.blockNumber) !== null && _a !== void 0 ? _a : this.getBlockNumberPromise();
        const routingConfig = _.merge({}, DEFAULT_ROUTING_CONFIG_BY_CHAIN(this.chainId), partialRoutingConfig, { blockNumber });
        const gasPriceWei = await this.getGasPriceWei();
        const quoteToken = quoteCurrency.wrapped;
        const [v3GasModel, mixedRouteGasModel] = await this.getGasModels(gasPriceWei, amount.currency.wrapped, quoteToken);
        // Create a Set to sanitize the protocols input, a Set of undefined becomes an empty set,
        // Then create an Array from the values of that Set.
        const protocols = Array.from(new Set(routingConfig.protocols).values());
        const cacheMode = await ((_c = this.routeCachingProvider) === null || _c === void 0 ? void 0 : _c.getCacheMode(this.chainId, amount, quoteToken, tradeType, protocols));
        // Fetch CachedRoutes
        let cachedRoutes;
        if (cacheMode !== CacheMode.Darkmode) {
            cachedRoutes = await ((_d = this.routeCachingProvider) === null || _d === void 0 ? void 0 : _d.getCachedRoute(this.chainId, amount, quoteToken, tradeType, protocols, await blockNumber));
        }
        if (cacheMode && cacheMode !== CacheMode.Darkmode && !cachedRoutes) {
            metric.putMetric(`GetCachedRoute_miss_${cacheMode}`, 1, MetricLoggerUnit.Count);
            log.info({
                tokenIn: tokenIn.symbol,
                tokenInAddress: tokenIn.address,
                tokenOut: tokenOut.symbol,
                tokenOutAddress: tokenOut.address,
                cacheMode,
                amount: amount.toExact(),
                chainId: this.chainId,
                tradeType: this.tradeTypeStr(tradeType),
            }, `GetCachedRoute miss ${cacheMode} for ${this.tokenPairSymbolTradeTypeChainId(tokenIn, tokenOut, tradeType)}`);
        }
        else if (cachedRoutes) {
            metric.putMetric(`GetCachedRoute_hit_${cacheMode}`, 1, MetricLoggerUnit.Count);
            log.info({
                tokenIn: tokenIn.symbol,
                tokenInAddress: tokenIn.address,
                tokenOut: tokenOut.symbol,
                tokenOutAddress: tokenOut.address,
                cacheMode,
                amount: amount.toExact(),
                chainId: this.chainId,
                tradeType: this.tradeTypeStr(tradeType),
            }, `GetCachedRoute hit ${cacheMode} for ${this.tokenPairSymbolTradeTypeChainId(tokenIn, tokenOut, tradeType)}`);
        }
        let swapRouteFromCachePromise = Promise.resolve(null);
        if (cachedRoutes) {
            swapRouteFromCachePromise = this.getSwapRouteFromCache(cachedRoutes, await blockNumber, amount, quoteToken, tradeType, routingConfig, v3GasModel, mixedRouteGasModel, gasPriceWei);
        }
        let swapRouteFromChainPromise = Promise.resolve(null);
        if (!cachedRoutes || cacheMode !== CacheMode.Livemode) {
            swapRouteFromChainPromise = this.getSwapRouteFromChain(amount, tokenIn, tokenOut, protocols, quoteToken, tradeType, routingConfig, v3GasModel, mixedRouteGasModel, gasPriceWei);
        }
        const [swapRouteFromCache, swapRouteFromChain] = await Promise.all([
            swapRouteFromCachePromise,
            swapRouteFromChainPromise,
        ]);
        let swapRouteRaw;
        if (cacheMode === CacheMode.Livemode && swapRouteFromCache) {
            log.info(`CacheMode is ${cacheMode}, and we are using swapRoute from cache`);
            swapRouteRaw = swapRouteFromCache;
        }
        else {
            log.info(`CacheMode is ${cacheMode}, and we are using materialized swapRoute`);
            swapRouteRaw = swapRouteFromChain;
        }
        if (cacheMode === CacheMode.Tapcompare &&
            swapRouteFromCache &&
            swapRouteFromChain) {
            const quoteDiff = swapRouteFromChain.quote.subtract(swapRouteFromCache.quote);
            const quoteGasAdjustedDiff = swapRouteFromChain.quoteGasAdjusted.subtract(swapRouteFromCache.quoteGasAdjusted);
            const gasUsedDiff = swapRouteFromChain.estimatedGasUsed.sub(swapRouteFromCache.estimatedGasUsed);
            log.info({
                quoteFromChain: swapRouteFromChain.quote.toExact(),
                quoteFromCache: swapRouteFromCache.quote.toExact(),
                quoteDiff: quoteDiff.toExact(),
                quoteGasAdjustedFromChain: swapRouteFromChain.quoteGasAdjusted.toExact(),
                quoteGasAdjustedFromCache: swapRouteFromCache.quoteGasAdjusted.toExact(),
                quoteGasAdjustedDiff: quoteGasAdjustedDiff.toExact(),
                gasUsedFromChain: swapRouteFromChain.estimatedGasUsed.toString(),
                gasUsedFromCache: swapRouteFromCache.estimatedGasUsed.toString(),
                gasUsedDiff: gasUsedDiff.toString(),
                routesFromChain: swapRouteFromChain.routes.toString(),
                routesFromCache: swapRouteFromCache.routes.toString(),
                amount: amount.toExact(),
                pair: this.tokenPairSymbolTradeTypeChainId(tokenIn, tokenOut, tradeType),
            }, `Comparing quotes between Chain and Cache for ${this.tokenPairSymbolTradeTypeChainId(tokenIn, tokenOut, tradeType)}`);
        }
        if (!swapRouteRaw) {
            return null;
        }
        const { quote, quoteGasAdjusted, estimatedGasUsed, routes: routeAmounts, estimatedGasUsedQuoteToken, estimatedGasUsedUSD, } = swapRouteRaw;
        if (this.routeCachingProvider &&
            cacheMode !== CacheMode.Darkmode &&
            swapRouteFromChain) {
            // Generate the object to be cached
            const routesToCache = CachedRoutes.fromRoutesWithValidQuotes(swapRouteFromChain.routes, this.chainId, tokenIn, tokenOut, protocols.sort(), // sort it for consistency in the order of the protocols.
            await blockNumber, tradeType);
            if (routesToCache) {
                const tokenPairSymbolTradeTypeChainId = this.tokenPairSymbolTradeTypeChainId(tokenIn, tokenOut, tradeType);
                // Attempt to insert the entry in cache. This is fire and forget promise.
                // The catch method will prevent any exception from blocking the normal code execution.
                this.routeCachingProvider
                    .setCachedRoute(routesToCache, amount)
                    .then((success) => {
                    const status = success ? 'success' : 'rejected';
                    metric.putMetric(`SetCachedRoute_${tokenPairSymbolTradeTypeChainId}_${status}`, 1, MetricLoggerUnit.Count);
                })
                    .catch((reason) => {
                    log.info({
                        reason: reason,
                        tokenPair: tokenPairSymbolTradeTypeChainId,
                    }, `SetCachedRoute failure`);
                    metric.putMetric(`SetCachedRoute_${tokenPairSymbolTradeTypeChainId}_failure`, 1, MetricLoggerUnit.Count);
                });
            }
        }
        metric.putMetric(`QuoteFoundForChain${this.chainId}`, 1, MetricLoggerUnit.Count);
        // Build Trade object that represents the optimal swap.
        const trade = buildTrade(currencyIn, currencyOut, tradeType, routeAmounts);
        let methodParameters;
        // If user provided recipient, deadline etc. we also generate the calldata required to execute
        // the swap and return it too.
        if (swapConfig) {
            methodParameters = buildSwapMethodParameters(trade, swapConfig, this.chainId);
        }
        const swapRoute = {
            quote,
            quoteGasAdjusted,
            estimatedGasUsed,
            estimatedGasUsedQuoteToken,
            estimatedGasUsedUSD,
            gasPriceWei,
            route: routeAmounts,
            trade,
            methodParameters,
            blockNumber: BigNumber.from(await blockNumber),
        };
        if (swapConfig &&
            swapConfig.simulate &&
            methodParameters &&
            methodParameters.calldata) {
            if (!this.simulator) {
                throw new Error('Simulator not initialized!');
            }
            log.info({ swapConfig, methodParameters }, 'Starting simulation');
            const fromAddress = swapConfig.simulate.fromAddress;
            const beforeSimulate = Date.now();
            const swapRouteWithSimulation = await this.simulator.simulate(fromAddress, swapConfig, swapRoute, amount, 
            // Quote will be in WETH even if quoteCurrency is ETH
            // So we init a new CurrencyAmount object here
            CurrencyAmount.fromRawAmount(quoteCurrency, quote.quotient.toString()), this.l2GasDataProvider
                ? await this.l2GasDataProvider.getGasData()
                : undefined, { blockNumber });
            metric.putMetric('SimulateTransaction', Date.now() - beforeSimulate, MetricLoggerUnit.Milliseconds);
            return swapRouteWithSimulation;
        }
        return swapRoute;
    }
    async getSwapRouteFromCache(cachedRoutes, blockNumber, amount, quoteToken, tradeType, routingConfig, v3GasModel, mixedRouteGasModel, gasPriceWei) {
        log.info({
            protocols: cachedRoutes.protocolsCovered,
            tradeType: cachedRoutes.tradeType,
            cachedBlockNumber: cachedRoutes.blockNumber,
            quoteBlockNumber: blockNumber,
        }, 'Routing across CachedRoute');
        const quotePromises = [];
        const v3Routes = cachedRoutes.routes.filter((route) => route.protocol === Protocol.V3);
        const v2Routes = cachedRoutes.routes.filter((route) => route.protocol === Protocol.V2);
        const mixedRoutes = cachedRoutes.routes.filter((route) => route.protocol === Protocol.MIXED);
        const percents = [];
        if (v3Routes) {
            const v3RoutesFromCache = v3Routes.map((cachedRoute) => cachedRoute.route);
            const v3PercentsFromCache = v3Routes.map((cachedRoute) => cachedRoute.percent);
            percents.push(...v3PercentsFromCache);
            const v3Amounts = v3PercentsFromCache.map((percent) => amount.multiply(new Fraction(percent, 100)));
            quotePromises.push(this.v3Quoter.getQuotes(v3RoutesFromCache, v3Amounts, v3PercentsFromCache, quoteToken, tradeType, routingConfig, undefined, v3GasModel));
        }
        if (v2Routes) {
            const v2RoutesFromCache = v2Routes.map((cachedRoute) => cachedRoute.route);
            const v2PercentsFromCache = v2Routes.map((cachedRoute) => cachedRoute.percent);
            percents.push(...v2PercentsFromCache);
            const v2Amounts = v2PercentsFromCache.map((percent) => amount.multiply(new Fraction(percent, 100)));
            quotePromises.push(this.v2Quoter.getQuotes(v2RoutesFromCache, v2Amounts, v2PercentsFromCache, quoteToken, tradeType, routingConfig, undefined, undefined, gasPriceWei));
        }
        if (mixedRoutes) {
            const mixedRoutesFromCache = mixedRoutes.map((cachedRoute) => cachedRoute.route);
            const mixedPercentsFromCache = mixedRoutes.map((cachedRoute) => cachedRoute.percent);
            percents.push(...mixedPercentsFromCache);
            const mixedAmounts = mixedPercentsFromCache.map((percent) => amount.multiply(new Fraction(percent, 100)));
            quotePromises.push(this.mixedQuoter.getQuotes(mixedRoutesFromCache, mixedAmounts, mixedPercentsFromCache, quoteToken, tradeType, routingConfig, undefined, mixedRouteGasModel));
        }
        const getQuotesResults = await Promise.all(quotePromises);
        const allRoutesWithValidQuotes = _.flatMap(getQuotesResults, (quoteResult) => quoteResult.routesWithValidQuotes);
        return getBestSwapRoute(amount, percents, allRoutesWithValidQuotes, tradeType, this.chainId, routingConfig, v3GasModel);
    }
    async getSwapRouteFromChain(amount, tokenIn, tokenOut, protocols, quoteToken, tradeType, routingConfig, v3GasModel, mixedRouteGasModel, gasPriceWei) {
        // Generate our distribution of amounts, i.e. fractions of the input amount.
        // We will get quotes for fractions of the input amount for different routes, then
        // combine to generate split routes.
        const [percents, amounts] = this.getAmountDistribution(amount, routingConfig);
        const noProtocolsSpecified = protocols.length === 0;
        const v3ProtocolSpecified = protocols.includes(Protocol.V3);
        const v2ProtocolSpecified = protocols.includes(Protocol.V2);
        const v2SupportedInChain = V2_SUPPORTED.includes(this.chainId);
        const shouldQueryMixedProtocol = protocols.includes(Protocol.MIXED) ||
            (noProtocolsSpecified && v2SupportedInChain);
        const mixedProtocolAllowed = [ChainId.MAINNET, ChainId.MANTA, ChainId.MANTA_TESTNET].includes(this.chainId) &&
            tradeType === TradeType.EXACT_INPUT;
        const quotePromises = [];
        // Maybe Quote V3 - if V3 is specified, or no protocol is specified
        if (v3ProtocolSpecified || noProtocolsSpecified) {
            log.info({ protocols, tradeType }, 'Routing across V3');
            quotePromises.push(this.v3Quoter.getRoutesThenQuotes(tokenIn, tokenOut, amounts, percents, quoteToken, tradeType, routingConfig, v3GasModel));
        }
        // Maybe Quote V2 - if V2 is specified, or no protocol is specified AND v2 is supported in this chain
        if (v2SupportedInChain && (v2ProtocolSpecified || noProtocolsSpecified)) {
            log.info({ protocols, tradeType }, 'Routing across V2');
            quotePromises.push(this.v2Quoter.getRoutesThenQuotes(tokenIn, tokenOut, amounts, percents, quoteToken, tradeType, routingConfig, undefined, gasPriceWei));
        }
        // Maybe Quote mixed routes
        // if MixedProtocol is specified or no protocol is specified and v2 is supported AND tradeType is ExactIn
        // AND is Mainnet or Gorli
        if (shouldQueryMixedProtocol && mixedProtocolAllowed) {
            log.info({ protocols, tradeType }, 'Routing across MixedRoutes');
            quotePromises.push(this.mixedQuoter.getRoutesThenQuotes(tokenIn, tokenOut, amounts, percents, quoteToken, tradeType, routingConfig, mixedRouteGasModel));
        }
        const getQuotesResults = await Promise.all(quotePromises);
        const allRoutesWithValidQuotes = [];
        const allCandidatePools = [];
        getQuotesResults.forEach((getQuoteResult) => {
            allRoutesWithValidQuotes.push(...getQuoteResult.routesWithValidQuotes);
            if (getQuoteResult.candidatePools) {
                allCandidatePools.push(getQuoteResult.candidatePools);
            }
        });
        if (allRoutesWithValidQuotes.length === 0) {
            log.info({ allRoutesWithValidQuotes }, 'Received no valid quotes');
            return null;
        }
        // Given all the quotes for all the amounts for all the routes, find the best combination.
        const bestSwapRoute = await getBestSwapRoute(amount, percents, allRoutesWithValidQuotes, tradeType, this.chainId, routingConfig, v3GasModel);
        if (bestSwapRoute) {
            this.emitPoolSelectionMetrics(bestSwapRoute, allCandidatePools);
        }
        return bestSwapRoute;
    }
    tradeTypeStr(tradeType) {
        return tradeType === TradeType.EXACT_INPUT ? 'ExactIn' : 'ExactOut';
    }
    tokenPairSymbolTradeTypeChainId(tokenIn, tokenOut, tradeType) {
        return `${tokenIn.symbol}/${tokenOut.symbol}/${this.tradeTypeStr(tradeType)}/${this.chainId}`;
    }
    determineCurrencyInOutFromTradeType(tradeType, amount, quoteCurrency) {
        if (tradeType === TradeType.EXACT_INPUT) {
            return {
                currencyIn: amount.currency,
                currencyOut: quoteCurrency,
            };
        }
        else {
            return {
                currencyIn: quoteCurrency,
                currencyOut: amount.currency,
            };
        }
    }
    async getGasPriceWei() {
        // Track how long it takes to resolve this async call.
        const beforeGasTimestamp = Date.now();
        // Get an estimate of the gas price to use when estimating gas cost of different routes.
        const { gasPriceWei } = await this.gasPriceProvider.getGasPrice();
        metric.putMetric('GasPriceLoad', Date.now() - beforeGasTimestamp, MetricLoggerUnit.Milliseconds);
        return gasPriceWei;
    }
    async getGasModels(gasPriceWei, amountToken, quoteToken) {
        const beforeGasModel = Date.now();
        const v3GasModelPromise = this.v3GasModelFactory.buildGasModel({
            chainId: this.chainId,
            gasPriceWei,
            v3poolProvider: this.v3PoolProvider,
            amountToken,
            quoteToken,
            v2poolProvider: this.v2PoolProvider,
            l2GasDataProvider: this.l2GasDataProvider,
        });
        const mixedRouteGasModelPromise = this.mixedRouteGasModelFactory.buildGasModel({
            chainId: this.chainId,
            gasPriceWei,
            v3poolProvider: this.v3PoolProvider,
            amountToken,
            quoteToken,
            v2poolProvider: this.v2PoolProvider,
        });
        const [v3GasModel, mixedRouteGasModel] = await Promise.all([
            v3GasModelPromise,
            mixedRouteGasModelPromise,
        ]);
        metric.putMetric('GasModelCreation', Date.now() - beforeGasModel, MetricLoggerUnit.Milliseconds);
        return [v3GasModel, mixedRouteGasModel];
    }
    // Note multiplications here can result in a loss of precision in the amounts (e.g. taking 50% of 101)
    // This is reconcilled at the end of the algorithm by adding any lost precision to one of
    // the splits in the route.
    getAmountDistribution(amount, routingConfig) {
        const { distributionPercent } = routingConfig;
        const percents = [];
        const amounts = [];
        for (let i = 1; i <= 100 / distributionPercent; i++) {
            percents.push(i * distributionPercent);
            amounts.push(amount.multiply(new Fraction(i * distributionPercent, 100)));
        }
        return [percents, amounts];
    }
    async buildSwapAndAddMethodParameters(trade, swapAndAddOptions, swapAndAddParameters) {
        const { swapOptions: { recipient, slippageTolerance, deadline, inputTokenPermit }, addLiquidityOptions: addLiquidityConfig, } = swapAndAddOptions;
        const preLiquidityPosition = swapAndAddParameters.preLiquidityPosition;
        const finalBalanceTokenIn = swapAndAddParameters.initialBalanceTokenIn.subtract(trade.inputAmount);
        const finalBalanceTokenOut = swapAndAddParameters.initialBalanceTokenOut.add(trade.outputAmount);
        const approvalTypes = await this.swapRouterProvider.getApprovalType(finalBalanceTokenIn, finalBalanceTokenOut);
        const zeroForOne = finalBalanceTokenIn.currency.wrapped.sortsBefore(finalBalanceTokenOut.currency.wrapped);
        return {
            ...SwapRouter.swapAndAddCallParameters(trade, {
                recipient,
                slippageTolerance,
                deadlineOrPreviousBlockhash: deadline,
                inputTokenPermit,
            }, Position.fromAmounts({
                pool: preLiquidityPosition.pool,
                tickLower: preLiquidityPosition.tickLower,
                tickUpper: preLiquidityPosition.tickUpper,
                amount0: zeroForOne
                    ? finalBalanceTokenIn.quotient.toString()
                    : finalBalanceTokenOut.quotient.toString(),
                amount1: zeroForOne
                    ? finalBalanceTokenOut.quotient.toString()
                    : finalBalanceTokenIn.quotient.toString(),
                useFullPrecision: false,
            }), addLiquidityConfig, approvalTypes.approvalTokenIn, approvalTypes.approvalTokenOut),
            to: SWAP_ROUTER_02_ADDRESSES(this.chainId),
        };
    }
    emitPoolSelectionMetrics(swapRouteRaw, allPoolsBySelection) {
        const poolAddressesUsed = new Set();
        const { routes: routeAmounts } = swapRouteRaw;
        _(routeAmounts)
            .flatMap((routeAmount) => {
            const { poolAddresses } = routeAmount;
            return poolAddresses;
        })
            .forEach((address) => {
            poolAddressesUsed.add(address.toLowerCase());
        });
        for (const poolsBySelection of allPoolsBySelection) {
            const { protocol } = poolsBySelection;
            _.forIn(poolsBySelection.selections, (pools, topNSelection) => {
                const topNUsed = _.findLastIndex(pools, (pool) => poolAddressesUsed.has(pool.id.toLowerCase())) + 1;
                metric.putMetric(_.capitalize(`${protocol}${topNSelection}`), topNUsed, MetricLoggerUnit.Count);
            });
        }
        let hasV3Route = false;
        let hasV2Route = false;
        let hasMixedRoute = false;
        for (const routeAmount of routeAmounts) {
            if (routeAmount.protocol === Protocol.V3) {
                hasV3Route = true;
            }
            if (routeAmount.protocol === Protocol.V2) {
                hasV2Route = true;
            }
            if (routeAmount.protocol === Protocol.MIXED) {
                hasMixedRoute = true;
            }
        }
        if (hasMixedRoute && (hasV3Route || hasV2Route)) {
            if (hasV3Route && hasV2Route) {
                metric.putMetric(`MixedAndV3AndV2SplitRoute`, 1, MetricLoggerUnit.Count);
                metric.putMetric(`MixedAndV3AndV2SplitRouteForChain${this.chainId}`, 1, MetricLoggerUnit.Count);
            }
            else if (hasV3Route) {
                metric.putMetric(`MixedAndV3SplitRoute`, 1, MetricLoggerUnit.Count);
                metric.putMetric(`MixedAndV3SplitRouteForChain${this.chainId}`, 1, MetricLoggerUnit.Count);
            }
            else if (hasV2Route) {
                metric.putMetric(`MixedAndV2SplitRoute`, 1, MetricLoggerUnit.Count);
                metric.putMetric(`MixedAndV2SplitRouteForChain${this.chainId}`, 1, MetricLoggerUnit.Count);
            }
        }
        else if (hasV3Route && hasV2Route) {
            metric.putMetric(`V3AndV2SplitRoute`, 1, MetricLoggerUnit.Count);
            metric.putMetric(`V3AndV2SplitRouteForChain${this.chainId}`, 1, MetricLoggerUnit.Count);
        }
        else if (hasMixedRoute) {
            if (routeAmounts.length > 1) {
                metric.putMetric(`MixedSplitRoute`, 1, MetricLoggerUnit.Count);
                metric.putMetric(`MixedSplitRouteForChain${this.chainId}`, 1, MetricLoggerUnit.Count);
            }
            else {
                metric.putMetric(`MixedRoute`, 1, MetricLoggerUnit.Count);
                metric.putMetric(`MixedRouteForChain${this.chainId}`, 1, MetricLoggerUnit.Count);
            }
        }
        else if (hasV3Route) {
            if (routeAmounts.length > 1) {
                metric.putMetric(`V3SplitRoute`, 1, MetricLoggerUnit.Count);
                metric.putMetric(`V3SplitRouteForChain${this.chainId}`, 1, MetricLoggerUnit.Count);
            }
            else {
                metric.putMetric(`V3Route`, 1, MetricLoggerUnit.Count);
                metric.putMetric(`V3RouteForChain${this.chainId}`, 1, MetricLoggerUnit.Count);
            }
        }
        else if (hasV2Route) {
            if (routeAmounts.length > 1) {
                metric.putMetric(`V2SplitRoute`, 1, MetricLoggerUnit.Count);
                metric.putMetric(`V2SplitRouteForChain${this.chainId}`, 1, MetricLoggerUnit.Count);
            }
            else {
                metric.putMetric(`V2Route`, 1, MetricLoggerUnit.Count);
                metric.putMetric(`V2RouteForChain${this.chainId}`, 1, MetricLoggerUnit.Count);
            }
        }
    }
    calculateOptimalRatio(position, sqrtRatioX96, zeroForOne) {
        const upperSqrtRatioX96 = TickMath.getSqrtRatioAtTick(position.tickUpper);
        const lowerSqrtRatioX96 = TickMath.getSqrtRatioAtTick(position.tickLower);
        // returns Fraction(0, 1) for any out of range position regardless of zeroForOne. Implication: function
        // cannot be used to determine the trading direction of out of range positions.
        if (JSBI.greaterThan(sqrtRatioX96, upperSqrtRatioX96) ||
            JSBI.lessThan(sqrtRatioX96, lowerSqrtRatioX96)) {
            return new Fraction(0, 1);
        }
        const precision = JSBI.BigInt('1' + '0'.repeat(18));
        let optimalRatio = new Fraction(SqrtPriceMath.getAmount0Delta(sqrtRatioX96, upperSqrtRatioX96, precision, true), SqrtPriceMath.getAmount1Delta(sqrtRatioX96, lowerSqrtRatioX96, precision, true));
        if (!zeroForOne)
            optimalRatio = optimalRatio.invert();
        return optimalRatio;
    }
    async userHasSufficientBalance(fromAddress, tradeType, amount, quote) {
        try {
            const neededBalance = tradeType === TradeType.EXACT_INPUT ? amount : quote;
            let balance;
            if (neededBalance.currency.isNative) {
                balance = await this.provider.getBalance(fromAddress);
            }
            else {
                const tokenContract = Erc20__factory.connect(neededBalance.currency.address, this.provider);
                balance = await tokenContract.balanceOf(fromAddress);
            }
            return balance.gte(BigNumber.from(neededBalance.quotient.toString()));
        }
        catch (e) {
            log.error(e, 'Error while checking user balance');
            return false;
        }
    }
    absoluteValue(fraction) {
        const numeratorAbs = JSBI.lessThan(fraction.numerator, JSBI.BigInt(0))
            ? JSBI.unaryMinus(fraction.numerator)
            : fraction.numerator;
        const denominatorAbs = JSBI.lessThan(fraction.denominator, JSBI.BigInt(0))
            ? JSBI.unaryMinus(fraction.denominator)
            : fraction.denominator;
        return new Fraction(numeratorAbs, denominatorAbs);
    }
    getBlockNumberPromise() {
        return retry(async (_b, attempt) => {
            if (attempt > 1) {
                log.info(`Get block number attempt ${attempt}`);
            }
            return this.provider.getBlockNumber();
        }, {
            retries: 2,
            minTimeout: 100,
            maxTimeout: 1000,
        });
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYWxwaGEtcm91dGVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL3JvdXRlcnMvYWxwaGEtcm91dGVyL2FscGhhLXJvdXRlci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxPQUFPLEVBQUUsU0FBUyxFQUFFLE1BQU0sMEJBQTBCLENBQUM7QUFDckQsT0FBTyxFQUFnQixlQUFlLEVBQUUsTUFBTSwwQkFBMEIsQ0FBQztBQUN6RSxPQUFPLGtCQUFrQixNQUFNLDZCQUE2QixDQUFDO0FBQzdELE9BQU8sRUFBRSxRQUFRLEVBQUUsVUFBVSxFQUFTLE1BQU0scUJBQXFCLENBQUM7QUFDbEUsT0FBTyxFQUFZLFFBQVEsRUFBUyxTQUFTLEVBQUUsTUFBTSxtQkFBbUIsQ0FBQztBQUV6RSxPQUFPLEVBQUUsSUFBSSxFQUFFLFFBQVEsRUFBRSxhQUFhLEVBQUUsUUFBUSxFQUFFLE1BQU0saUJBQWlCLENBQUM7QUFDMUUsT0FBTyxLQUFLLE1BQU0sYUFBYSxDQUFDO0FBQ2hDLE9BQU8sSUFBSSxNQUFNLE1BQU0sQ0FBQztBQUN4QixPQUFPLENBQUMsTUFBTSxRQUFRLENBQUM7QUFDdkIsT0FBTyxTQUFTLE1BQU0sWUFBWSxDQUFDO0FBRW5DLE9BQU8sRUFDTCxZQUFZLEVBQ1osU0FBUyxFQUNULHlCQUF5QixFQUN6QixnQ0FBZ0MsRUFDaEMscUJBQXFCLEVBQ3JCLHlCQUF5QixFQUN6QixxQkFBcUIsRUFDckIseUJBQXlCLEVBQ3pCLHVCQUF1QixFQUN2Qix5QkFBeUIsRUFNekIsc0JBQXNCLEVBQ3RCLFdBQVcsRUFDWCx1QkFBdUIsRUFDdkIsb0JBQW9CLEVBRXBCLHdCQUF3QixFQUN4Qix3QkFBd0IsRUFDeEIsa0JBQWtCLEVBQ2xCLHdCQUF3QixFQUN4QixtQkFBbUIsRUFDbkIsZUFBZSxFQUNmLCtCQUErQixFQUMvQiwrQkFBK0IsR0FDaEMsTUFBTSxpQkFBaUIsQ0FBQztBQUN6QixPQUFPLEVBQ0wsd0JBQXdCLEdB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