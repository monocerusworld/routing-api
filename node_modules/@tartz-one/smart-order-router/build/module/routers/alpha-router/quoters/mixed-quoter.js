import { TradeType } from '@uniswap/sdk-core';
import _ from 'lodash';
import { TokenValidationResult, } from '../../../providers';
import { log, metric, MetricLoggerUnit, routeToString, } from '../../../util';
import { MixedRouteWithValidQuote } from '../entities';
import { computeAllMixedRoutes } from '../functions/compute-all-routes';
import { getMixedRouteCandidatePools, } from '../functions/get-candidate-pools';
import { BaseQuoter } from './base-quoter';
export class MixedQuoter extends BaseQuoter {
    constructor(v3SubgraphProvider, v3PoolProvider, v2SubgraphProvider, v2PoolProvider, onChainQuoteProvider, tokenProvider, chainId, blockedTokenListProvider, tokenValidatorProvider) {
        super(tokenProvider, chainId, blockedTokenListProvider, tokenValidatorProvider);
        this.v3SubgraphProvider = v3SubgraphProvider;
        this.v3PoolProvider = v3PoolProvider;
        this.v2SubgraphProvider = v2SubgraphProvider;
        this.v2PoolProvider = v2PoolProvider;
        this.onChainQuoteProvider = onChainQuoteProvider;
    }
    async getRoutes(tokenIn, tokenOut, tradeType, routingConfig) {
        if (tradeType != TradeType.EXACT_INPUT) {
            throw new Error('Mixed route quotes are not supported for EXACT_OUTPUT');
        }
        const { V2poolAccessor, V3poolAccessor, candidatePools: mixedRouteCandidatePools, } = await getMixedRouteCandidatePools({
            tokenIn,
            tokenOut,
            tokenProvider: this.tokenProvider,
            blockedTokenListProvider: this.blockedTokenListProvider,
            v3poolProvider: this.v3PoolProvider,
            v2poolProvider: this.v2PoolProvider,
            routeType: tradeType,
            v3subgraphProvider: this.v3SubgraphProvider,
            v2subgraphProvider: this.v2SubgraphProvider,
            routingConfig,
            chainId: this.chainId,
        });
        const V3poolsRaw = V3poolAccessor.getAllPools();
        const V2poolsRaw = V2poolAccessor.getAllPools();
        const poolsRaw = [...V3poolsRaw, ...V2poolsRaw];
        const candidatePools = mixedRouteCandidatePools;
        // Drop any pools that contain fee on transfer tokens (not supported by v3) or have issues with being transferred.
        const pools = await this.applyTokenValidatorToPools(poolsRaw, (token, tokenValidation) => {
            // If there is no available validation result we assume the token is fine.
            if (!tokenValidation) {
                return false;
            }
            // Only filters out *intermediate* pools that involve tokens that we detect
            // cant be transferred. This prevents us trying to route through tokens that may
            // not be transferrable, but allows users to still swap those tokens if they
            // specify.
            //
            if (tokenValidation == TokenValidationResult.STF &&
                (token.equals(tokenIn) || token.equals(tokenOut))) {
                return false;
            }
            return (tokenValidation == TokenValidationResult.FOT ||
                tokenValidation == TokenValidationResult.STF);
        });
        const { maxSwapsPerPath } = routingConfig;
        const routes = computeAllMixedRoutes(tokenIn, tokenOut, pools, maxSwapsPerPath);
        return {
            routes,
            candidatePools,
        };
    }
    async getQuotes(routes, amounts, percents, quoteToken, tradeType, routingConfig, candidatePools, gasModel) {
        log.info('Starting to get mixed quotes');
        if (gasModel === undefined) {
            throw new Error('GasModel for MixedRouteWithValidQuote is required to getQuotes');
        }
        if (routes.length == 0) {
            return { routesWithValidQuotes: [], candidatePools };
        }
        // For all our routes, and all the fractional amounts, fetch quotes on-chain.
        const quoteFn = this.onChainQuoteProvider.getQuotesManyExactIn.bind(this.onChainQuoteProvider);
        const beforeQuotes = Date.now();
        log.info(`Getting quotes for mixed for ${routes.length} routes with ${amounts.length} amounts per route.`);
        const { routesWithQuotes } = await quoteFn(amounts, routes, {
            blockNumber: routingConfig.blockNumber,
        });
        metric.putMetric('MixedQuotesLoad', Date.now() - beforeQuotes, MetricLoggerUnit.Milliseconds);
        metric.putMetric('MixedQuotesFetched', _(routesWithQuotes)
            .map(([, quotes]) => quotes.length)
            .sum(), MetricLoggerUnit.Count);
        const routesWithValidQuotes = [];
        for (const routeWithQuote of routesWithQuotes) {
            const [route, quotes] = routeWithQuote;
            for (let i = 0; i < quotes.length; i++) {
                const percent = percents[i];
                const amountQuote = quotes[i];
                const { quote, amount, sqrtPriceX96AfterList, initializedTicksCrossedList, gasEstimate, } = amountQuote;
                if (!quote ||
                    !sqrtPriceX96AfterList ||
                    !initializedTicksCrossedList ||
                    !gasEstimate) {
                    log.debug({
                        route: routeToString(route),
                        amountQuote,
                    }, 'Dropping a null mixed quote for route.');
                    continue;
                }
                const routeWithValidQuote = new MixedRouteWithValidQuote({
                    route,
                    rawQuote: quote,
                    amount,
                    percent,
                    sqrtPriceX96AfterList,
                    initializedTicksCrossedList,
                    quoterGasEstimate: gasEstimate,
                    mixedRouteGasModel: gasModel,
                    quoteToken,
                    tradeType,
                    v3PoolProvider: this.v3PoolProvider,
                    v2PoolProvider: this.v2PoolProvider,
                });
                routesWithValidQuotes.push(routeWithValidQuote);
            }
        }
        return {
            routesWithValidQuotes,
            candidatePools,
        };
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWl4ZWQtcXVvdGVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vLi4vc3JjL3JvdXRlcnMvYWxwaGEtcm91dGVyL3F1b3RlcnMvbWl4ZWQtcXVvdGVyLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLE9BQU8sRUFBbUIsU0FBUyxFQUFFLE1BQU0sbUJBQW1CLENBQUM7QUFDL0QsT0FBTyxDQUFDLE1BQU0sUUFBUSxDQUFDO0FBRXZCLE9BQU8sRUFTTCxxQkFBcUIsR0FDdEIsTUFBTSxvQkFBb0IsQ0FBQztBQUM1QixPQUFPLEVBR0wsR0FBRyxFQUNILE1BQU0sRUFDTixnQkFBZ0IsRUFDaEIsYUFBYSxHQUNkLE1BQU0sZUFBZSxDQUFDO0FBR3ZCLE9BQU8sRUFBRSx3QkFBd0IsRUFBRSxNQUFNLGFBQWEsQ0FBQztBQUN2RCxPQUFPLEVBQUUscUJBQXFCLEVBQUUsTUFBTSxpQ0FBaUMsQ0FBQztBQUN4RSxPQUFPLEVBRUwsMkJBQTJCLEdBQzVCLE1BQU0sa0NBQWtDLENBQUM7QUFHMUMsT0FBTyxFQUFFLFVBQVUsRUFBRSxNQUFNLGVBQWUsQ0FBQztBQUczQyxNQUFNLE9BQU8sV0FBWSxTQUFRLFVBQXNCO0lBT3JELFlBQ0Usa0JBQXVDLEVBQ3ZDLGNBQStCLEVBQy9CLGtCQUF1QyxFQUN2QyxjQUErQixFQUMvQixvQkFBMkMsRUFDM0MsYUFBNkIsRUFDN0IsT0FBZ0IsRUFDaEIsd0JBQTZDLEVBQzdDLHNCQUFnRDtRQUVoRCxLQUFLLENBQ0gsYUFBYSxFQUNiLE9BQU8sRUFDUCx3QkFBd0IsRUFDeEIsc0JBQXNCLENBQ3ZCLENBQUM7UUFDRixJQUFJLENBQUMsa0JBQWtCLEdBQUcsa0JBQWtCLENBQUM7UUFDN0MsSUFBSSxDQUFDLGNBQWMsR0FBRyxjQUFjLENBQUM7UUFDckMsSUFBSSxDQUFDLGtCQUFrQixHQUFHLGtCQUFrQixDQUFDO1FBQzdDLElBQUksQ0FBQyxjQUFjLEdBQUcsY0FBYyxDQUFDO1FBQ3JDLElB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