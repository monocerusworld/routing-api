import { Protocol } from '@uniswap/router-sdk';
import { UNIVERSAL_ROUTER_ADDRESS } from '@tartz-one/universal-router-sdk';
import { CurrencyAmount, TradeType } from '@uniswap/sdk-core';
import { MetricLoggerUnit, routeAmountsToString, SwapType, SimulationStatus, } from '@tartz-one/smart-order-router';
import { Pool } from '@uniswap/v3-sdk';
import JSBI from 'jsbi';
import _ from 'lodash';
import { APIGLambdaHandler } from '../handler';
import { QuoteResponseSchemaJoi } from '../schema';
import { DEFAULT_ROUTING_CONFIG_BY_CHAIN, parseDeadline, parseSlippageTolerance, tokenStringToCurrency, } from '../shared';
import { QuoteQueryParamsJoi } from './schema/quote-schema';
import { utils } from 'ethers';
import { simulationStatusToString } from './util/simulation';
import { PAIRS_TO_TRACK } from './util/pairs-to-track';
export class QuoteHandler extends APIGLambdaHandler {
    async handleRequest(params) {
        const { requestQueryParams: { tokenInAddress, tokenInChainId, tokenOutAddress, tokenOutChainId, amount: amountRaw, type, recipient, slippageTolerance, deadline, minSplits, forceCrossProtocol, forceMixedRoutes, protocols: protocolsStr, simulateFromAddress, permitSignature, permitNonce, permitExpiration, permitAmount, permitSigDeadline, enableUniversalRouter, }, requestInjected: { router, log, id: quoteId, chainId, tokenProvider, tokenListProvider, v3PoolProvider: v3PoolProvider, v2PoolProvider: v2PoolProvider, metric, }, } = params;
        metric.putMetric(`GET_QUOTE_REQUESTED_CHAINID: ${chainId}`, 1, MetricLoggerUnit.Count);
        // Parse user provided token address/symbol to Currency object.
        let before = Date.now();
        const currencyIn = await tokenStringToCurrency(tokenListProvider, tokenProvider, tokenInAddress, tokenInChainId, log);
        const currencyOut = await tokenStringToCurrency(tokenListProvider, tokenProvider, tokenOutAddress, tokenOutChainId, log);
        metric.putMetric('TokenInOutStrToToken', Date.now() - before, MetricLoggerUnit.Milliseconds);
        if (!currencyIn) {
            metric.putMetric(`GET_QUOTE_400_CHAINID: ${chainId}`, 1, MetricLoggerUnit.Count);
            return {
                statusCode: 400,
                errorCode: 'TOKEN_IN_INVALID',
                detail: `Could not find token with address "${tokenInAddress}"`,
            };
        }
        if (!currencyOut) {
            metric.putMetric(`GET_QUOTE_400_CHAINID: ${chainId}`, 1, MetricLoggerUnit.Count);
            return {
                statusCode: 400,
                errorCode: 'TOKEN_OUT_INVALID',
                detail: `Could not find token with address "${tokenOutAddress}"`,
            };
        }
        if (tokenInChainId != tokenOutChainId) {
            metric.putMetric(`GET_QUOTE_400_CHAINID: ${chainId}`, 1, MetricLoggerUnit.Count);
            return {
                statusCode: 400,
                errorCode: 'TOKEN_CHAINS_DIFFERENT',
                detail: `Cannot request quotes for tokens on different chains`,
            };
        }
        if (currencyIn.equals(currencyOut)) {
            metric.putMetric(`GET_QUOTE_400_CHAINID: ${chainId}`, 1, MetricLoggerUnit.Count);
            return {
                statusCode: 400,
                errorCode: 'TOKEN_IN_OUT_SAME',
                detail: `tokenIn and tokenOut must be different`,
            };
        }
        let protocols = [];
        if (protocolsStr) {
            for (const protocolStr of protocolsStr) {
                switch (protocolStr.toLowerCase()) {
                    case 'v2':
                        protocols.push(Protocol.V2);
                        break;
                    case 'v3':
                        protocols.push(Protocol.V3);
                        break;
                    case 'mixed':
                        protocols.push(Protocol.MIXED);
                        break;
                    default:
                        return {
                            statusCode: 400,
                            errorCode: 'INVALID_PROTOCOL',
                            detail: `Invalid protocol specified. Supported protocols: ${JSON.stringify(Object.values(Protocol))}`,
                        };
                }
            }
        }
        else if (!forceCrossProtocol) {
            protocols = [Protocol.V3];
        }
        const routingConfig = {
            ...DEFAULT_ROUTING_CONFIG_BY_CHAIN(chainId),
            ...(minSplits ? { minSplits } : {}),
            ...(forceCrossProtocol ? { forceCrossProtocol } : {}),
            ...(forceMixedRoutes ? { forceMixedRoutes } : {}),
            protocols,
        };
        let swapParams = undefined;
        // e.g. Inputs of form "1.25%" with 2dp max. Convert to fractional representation => 1.25 => 125 / 10000
        if (slippageTolerance && deadline && recipient) {
            const slippageTolerancePercent = parseSlippageTolerance(slippageTolerance);
            // TODO: Remove once universal router is no longer behind a feature flag.
            if (enableUniversalRouter) {
                swapParams = {
                    type: SwapType.UNIVERSAL_ROUTER,
                    deadlineOrPreviousBlockhash: parseDeadline(deadline),
                    recipient: recipient,
                    slippageTolerance: slippageTolerancePercent,
                };
            }
            else {
                swapParams = {
                    type: SwapType.SWAP_ROUTER_02,
                    deadline: parseDeadline(deadline),
                    recipient: recipient,
                    slippageTolerance: slippageTolerancePercent,
                };
            }
            if (enableUniversalRouter &&
                permitSignature &&
                permitNonce &&
                permitExpiration &&
                permitAmount &&
                permitSigDeadline) {
                const permit = {
                    details: {
                        token: currencyIn.wrapped.address,
                        amount: permitAmount,
                        expiration: permitExpiration,
                        nonce: permitNonce,
                    },
                    spender: UNIVERSAL_ROUTER_ADDRESS(chainId),
                    sigDeadline: permitSigDeadline,
                };
                swapParams.inputTokenPermit = {
                    ...permit,
                    signature: permitSignature,
                };
            }
            else if (!enableUniversalRouter &&
                permitSignature &&
                ((permitNonce && permitExpiration) || (permitAmount && permitSigDeadline))) {
                const { v, r, s } = utils.splitSignature(permitSignature);
                swapParams.inputTokenPermit = {
                    v: v,
                    r,
                    s,
                    ...(permitNonce && permitExpiration
                        ? { nonce: permitNonce, expiry: permitExpiration }
                        : { amount: permitAmount, deadline: permitSigDeadline }),
                };
            }
            if (simulateFromAddress) {
                metric.putMetric('Simulation Requested', 1, MetricLoggerUnit.Count);
                swapParams.simulate = { fromAddress: simulateFromAddress };
            }
        }
        before = Date.now();
        let swapRoute;
        let amount;
        let tokenPairSymbol = '';
        let tokenPairSymbolChain = '';
        if (currencyIn.symbol && currencyOut.symbol) {
            tokenPairSymbol = _([currencyIn.symbol, currencyOut.symbol]).join('/');
            tokenPairSymbolChain = `${tokenPairSymbol}/${chainId}`;
        }
        const [token0Symbol, token0Address, token1Symbol, token1Address] = currencyIn.wrapped.sortsBefore(currencyOut.wrapped)
            ? [currencyIn.symbol, currencyIn.wrapped.address, currencyOut.symbol, currencyOut.wrapped.address]
            : [currencyOut.symbol, currencyOut.wrapped.address, currencyIn.symbol, currencyIn.wrapped.address];
        switch (type) {
            case 'exactIn':
                amount = CurrencyAmount.fromRawAmount(currencyIn, JSBI.BigInt(amountRaw));
                log.info({
                    amountIn: amount.toExact(),
                    token0Address,
                    token1Address,
                    token0Symbol,
                    token1Symbol,
                    tokenInSymbol: currencyIn.symbol,
                    tokenOutSymbol: currencyOut.symbol,
                    tokenPairSymbol,
                    tokenPairSymbolChain,
                    type,
                    routingConfig: routingConfig,
                    swapParams,
                }, `Exact In Swap: Give ${amount.toExact()} ${amount.currency.symbol}, Want: ${currencyOut.symbol}. Chain: ${chainId}`);
                swapRoute = await router.route(amount, currencyOut, TradeType.EXACT_INPUT, swapParams, routingConfig);
                break;
            case 'exactOut':
                amount = CurrencyAmount.fromRawAmount(currencyOut, JSBI.BigInt(amountRaw));
                log.info({
                    amountOut: amount.toExact(),
                    token0Address,
                    token1Address,
                    token0Symbol,
                    token1Symbol,
                    tokenInSymbol: currencyIn.symbol,
                    tokenOutSymbol: currencyOut.symbol,
                    tokenPairSymbol,
                    tokenPairSymbolChain,
                    type,
                    routingConfig: routingConfig,
                    swapParams,
                }, `Exact Out Swap: Want ${amount.toExact()} ${amount.currency.symbol} Give: ${currencyIn.symbol}. Chain: ${chainId}`);
                swapRoute = await router.route(amount, currencyIn, TradeType.EXACT_OUTPUT, swapParams, routingConfig);
                break;
            default:
                throw new Error('Invalid swap type');
        }
        if (!swapRoute) {
            log.info({
                type,
                tokenIn: currencyIn,
                tokenOut: currencyOut,
                amount: amount.quotient.toString(),
            }, `No route found. 404`);
            return {
                statusCode: 404,
                errorCode: 'NO_ROUTE',
                detail: 'No route found',
            };
        }
        const { quote, quoteGasAdjusted, route, estimatedGasUsed, estimatedGasUsedQuoteToken, estimatedGasUsedUSD, gasPriceWei, methodParameters, blockNumber, simulationStatus, } = swapRoute;
        if (simulationStatus == SimulationStatus.Failed) {
            metric.putMetric('SimulationFailed', 1, MetricLoggerUnit.Count);
        }
        else if (simulationStatus == SimulationStatus.Succeeded) {
            metric.putMetric('SimulationSuccessful', 1, MetricLoggerUnit.Count);
        }
        else if (simulationStatus == SimulationStatus.InsufficientBalance) {
            metric.putMetric('SimulationInsufficientBalance', 1, MetricLoggerUnit.Count);
        }
        else if (simulationStatus == SimulationStatus.NotApproved) {
            metric.putMetric('SimulationNotApproved', 1, MetricLoggerUnit.Count);
        }
        else if (simulationStatus == SimulationStatus.NotSupported) {
            metric.putMetric('SimulationNotSupported', 1, MetricLoggerUnit.Count);
        }
        const routeResponse = [];
        for (const subRoute of route) {
            const { amount, quote, tokenPath } = subRoute;
            const pools = subRoute.protocol == Protocol.V2 ? subRoute.route.pairs : subRoute.route.pools;
            const curRoute = [];
            for (let i = 0; i < pools.length; i++) {
                const nextPool = pools[i];
                const tokenIn = tokenPath[i];
                const tokenOut = tokenPath[i + 1];
                let edgeAmountIn = undefined;
                if (i == 0) {
                    edgeAmountIn = type == 'exactIn' ? amount.quotient.toString() : quote.quotient.toString();
                }
                let edgeAmountOut = undefined;
                if (i == pools.length - 1) {
                    edgeAmountOut = type == 'exactIn' ? quote.quotient.toString() : amount.quotient.toString();
                }
                if (nextPool instanceof Pool) {
                    curRoute.push({
                        type: 'v3-pool',
                        address: v3PoolProvider.getPoolAddress(nextPool.token0, nextPool.token1, nextPool.fee).poolAddress,
                        tokenIn: {
                            chainId: tokenIn.chainId,
                            decimals: tokenIn.decimals.toString(),
                            address: tokenIn.address,
                            symbol: tokenIn.symbol,
                        },
                        tokenOut: {
                            chainId: tokenOut.chainId,
                            decimals: tokenOut.decimals.toString(),
                            address: tokenOut.address,
                            symbol: tokenOut.symbol,
                        },
                        fee: nextPool.fee.toString(),
                        liquidity: nextPool.liquidity.toString(),
                        sqrtRatioX96: nextPool.sqrtRatioX96.toString(),
                        tickCurrent: nextPool.tickCurrent.toString(),
                        amountIn: edgeAmountIn,
                        amountOut: edgeAmountOut,
                    });
                }
                else {
                    const reserve0 = nextPool.reserve0;
                    const reserve1 = nextPool.reserve1;
                    curRoute.push({
                        type: 'v2-pool',
                        address: v2PoolProvider.getPoolAddress(nextPool.token0, nextPool.token1).poolAddress,
                        tokenIn: {
                            chainId: tokenIn.chainId,
                            decimals: tokenIn.decimals.toString(),
                            address: tokenIn.address,
                            symbol: tokenIn.symbol,
                        },
                        tokenOut: {
                            chainId: tokenOut.chainId,
                            decimals: tokenOut.decimals.toString(),
                            address: tokenOut.address,
                            symbol: tokenOut.symbol,
                        },
                        reserve0: {
                            token: {
                                chainId: reserve0.currency.wrapped.chainId,
                                decimals: reserve0.currency.wrapped.decimals.toString(),
                                address: reserve0.currency.wrapped.address,
                                symbol: reserve0.currency.wrapped.symbol,
                            },
                            quotient: reserve0.quotient.toString(),
                        },
                        reserve1: {
                            token: {
                                chainId: reserve1.currency.wrapped.chainId,
                                decimals: reserve1.currency.wrapped.decimals.toString(),
                                address: reserve1.currency.wrapped.address,
                                symbol: reserve1.currency.wrapped.symbol,
                            },
                            quotient: reserve1.quotient.toString(),
                        },
                        amountIn: edgeAmountIn,
                        amountOut: edgeAmountOut,
                    });
                }
            }
            routeResponse.push(curRoute);
        }
        const routeString = routeAmountsToString(route);
        const result = {
            methodParameters,
            blockNumber: blockNumber.toString(),
            amount: amount.quotient.toString(),
            amountDecimals: amount.toExact(),
            quote: quote.quotient.toString(),
            quoteDecimals: quote.toExact(),
            quoteGasAdjusted: quoteGasAdjusted.quotient.toString(),
            quoteGasAdjustedDecimals: quoteGasAdjusted.toExact(),
            gasUseEstimateQuote: estimatedGasUsedQuoteToken.quotient.toString(),
            gasUseEstimateQuoteDecimals: estimatedGasUsedQuoteToken.toExact(),
            gasUseEstimate: estimatedGasUsed.toString(),
            gasUseEstimateUSD: estimatedGasUsedUSD.toExact(),
            simulationStatus: simulationStatusToString(simulationStatus, log),
            simulationError: simulationStatus == SimulationStatus.Failed,
            gasPriceWei: gasPriceWei.toString(),
            route: routeResponse,
            routeString,
            quoteId,
        };
        metric.putMetric(`GET_QUOTE_200_CHAINID: ${chainId}`, 1, MetricLoggerUnit.Count);
        this.logRouteMetrics(log, metric, currencyIn, currencyOut, tokenInAddress, tokenOutAddress, type, chainId, amount, routeString);
        return {
            statusCode: 200,
            body: result,
        };
    }
    logRouteMetrics(log, metric, currencyIn, currencyOut, tokenInAddress, tokenOutAddress, tradeType, chainId, amount, routeString) {
        var _a, _b;
        const tradingPair = `${currencyIn.symbol}/${currencyOut.symbol}`;
        const tradeTypeEnumValue = tradeType == 'exactIn' ? TradeType.EXACT_INPUT : TradeType.EXACT_OUTPUT;
        if ((_b = (_a = PAIRS_TO_TRACK.get(chainId)) === null || _a === void 0 ? void 0 : _a.get(tradeTypeEnumValue)) === null || _b === void 0 ? void 0 : _b.includes(tradingPair)) {
            metric.putMetric(`GET_QUOTE_AMOUNT_${tradingPair}_${tradeType.toUpperCase()}_CHAIN_${chainId}`, Number(amount.toExact()), MetricLoggerUnit.None);
            // Create a hashcode from the routeString, this will indicate that a different route is being used
            // hashcode function copied from: https://gist.github.com/hyamamoto/fd435505d29ebfa3d9716fd2be8d42f0?permalink_comment_id=4261728#gistcomment-4261728
            const routeStringHash = Math.abs(routeString.split('').reduce((s, c) => (Math.imul(31, s) + c.charCodeAt(0)) | 0, 0));
            // Log the chose route
            log.info({
                tradingPair,
                tokenInAddress,
                tokenOutAddress,
                tradeType,
                amount: amount.toExact(),
                routeString,
                routeStringHash,
                chainId,
            }, `Tracked Route for pair [${tradingPair}/${tradeType.toUpperCase()}] on chain [${chainId}] with route hash [${routeStringHash}] for amount [${amount.toExact()}]`);
        }
    }
    requestBodySchema() {
        return null;
    }
    requestQueryParamsSchema() {
        return QuoteQueryParamsJoi;
    }
    responseBodySchema() {
        return QuoteResponseSchemaJoi;
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicXVvdGUuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9saWIvaGFuZGxlcnMvcXVvdGUvcXVvdGUudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQ0EsT0FBTyxFQUFFLFFBQVEsRUFBRSxNQUFNLHFCQUFxQixDQUFBO0FBQzlDLE9BQU8sRUFBRSx3QkFBd0IsRUFBRSxNQUFNLGlDQUFpQyxDQUFBO0FBRTFFLE9BQU8sRUFBWSxjQUFjLEVBQUUsU0FBUyxFQUFFLE1BQU0sbUJBQW1CLENBQUE7QUFDdkUsT0FBTyxFQUdMLGdCQUFnQixFQUNoQixvQkFBb0IsRUFHcEIsUUFBUSxFQUNSLGdCQUFnQixHQUdqQixNQUFNLCtCQUErQixDQUFBO0FBQ3RDLE9BQU8sRUFBRSxJQUFJLEVBQUUsTUFBTSxpQkFBaUIsQ0FBQTtBQUN0QyxPQUFPLElBQUksTUFBTSxNQUFNLENBQUE7QUFDdkIsT0FBTyxDQUFDLE1BQU0sUUFBUSxDQUFBO0FBQ3RCLE9BQU8sRUFBRSxpQkFBaUIsRUFBZ0QsTUFBTSxZQUFZLENBQUE7QUFFNUYsT0FBTyxFQUFpQixzQkFBc0IsRUFBZ0MsTUFBTSxXQUFXLENBQUE7QUFDL0YsT0FBTyxFQUNMLCtCQUErQixFQUMvQixhQUFhLEVBQ2Isc0JBQXNCLEVBQ3RCLHFCQUFxQixHQUN0QixNQUFNLFdBQVcsQ0FBQTtBQUNsQixPQUFPLEVBQW9CLG1CQUFtQixFQUFFLE1BQU0sdUJBQXVCLENBQUE7QUFDN0UsT0FBTyxFQUFFLEtBQUssRUFBRSxNQUFNLFFBQVEsQ0FBQTtBQUM5QixPQUFPLEVBQUUsd0JBQXdCLEVBQUUsTUFBTSxtQkFBbUIsQ0FBQTtBQUU1RCxPQUFPLEVBQUUsY0FBYyxFQUFFLE1BQU0sdUJBQXVCLENBQUE7QUFFdEQsTUFBTSxPQUFPLFlBQWEsU0FBUSxpQkFNakM7SUFDUSxLQUFLLENBQUMsYUFBYSxDQUN4QixNQUFxRztRQUVyRyxNQUFNLEVBQ0osa0JBQWtCLEVBQUUsRUFDbEIsY0FBYyxF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QUFJLENBQ3RCLENBQUE7WUFDRCxrR0FBa0c7WUFDbEcscUpBQXFKO1lBQ3JKLE1BQU0sZUFBZSxHQUFHLElBQUksQ0FBQyxHQUFHLENBQzlCLFdBQVcsQ0FBQyxLQUFLLENBQUMsRUFBRSxDQUFDLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsRUFBRSxFQUFFLENBQUMsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLEVBQUUsRUFBRSxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsVUFBVSxDQUFDLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUNwRixDQUFBO1lBQ0Qsc0JBQXNCO1lBQ3RCLEdBQUcsQ0FBQyxJQUFJLENBQ047Z0JBQ0UsV0FBVztnQkFDWCxjQUFjO2dCQUNkLGVBQWU7Z0JBQ2YsU0FBUztnQkFDVCxNQUFNLEVBQUUsTUFBTSxDQUFDLE9BQU8sRUFBRTtnQkFDeEIsV0FBVztnQkFDWCxlQUFlO2dCQUNmLE9BQU87YUFDUixFQUNELDJCQUEyQixXQUFXLElBQUksU0FBUyxDQUFDLFdBQVcsRUFBRSxlQUFlLE9BQU8sc0JBQXNCLGVBQWUsaUJBQWlCLE1BQU0sQ0FBQyxPQUFPLEVBQUUsR0FBRyxDQUNqSyxDQUFBO1NBQ0Y7SUFDSCxDQUFDO0lBRVMsaUJBQWlCO1FBQ3pCLE9BQU8sSUFBSSxDQUFBO0lBQ2IsQ0FBQztJQUVTLHdCQUF3QjtRQUNoQyxPQUFPLG1CQUFtQixDQUFBO0lBQzVCLENBQUM7SUFFUyxrQkFBa0I7UUFDMUIsT0FBTyxzQkFBc0IsQ0FBQTtJQUMvQixDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgSm9pIGZyb20gJ0BoYXBpL2pvaSdcbmltcG9ydCB7IFByb3RvY29sIH0gZnJvbSAnQHVuaXN3YXAvcm91dGVyLXNkaydcbmltcG9ydCB7IFVOSVZFUlNBTF9ST1VURVJfQUREUkVTUyB9IGZyb20gJ0B0YXJ0ei1vbmUvdW5pdmVyc2FsLXJvdXRlci1zZGsnXG5pbXBvcnQgeyBQZXJtaXRTaW5nbGUgfSBmcm9tICdAdW5pc3dhcC9wZXJtaXQyLXNkaydcbmltcG9ydCB7IEN1cnJlbmN5LCBDdXJyZW5jeUFtb3VudCwgVHJhZGVUeXBlIH0gZnJvbSAnQHVuaXN3YXAvc2RrLWNvcmUnXG5pbXBvcnQge1xuICBBbHBoYVJvdXRlckNvbmZpZyxcbiAgSVJvdXRlcixcbiAgTWV0cmljTG9nZ2VyVW5pdCxcbiAgcm91dGVBbW91bnRzVG9TdHJpbmcsXG4gIFN3YXBSb3V0ZSxcbiAgU3dhcE9wdGlvbnMsXG4gIFN3YXBUeXBlLFxuICBTaW11bGF0aW9uU3RhdHVzLFxuICBJTWV0cmljLFxuICBDaGFpbklkLFxufSBmcm9tICdAdGFydHotb25lL3NtYXJ0LW9yZGVyLXJvdXRlcidcbmltcG9ydCB7IFBvb2wgfSBmcm9tICdAdW5pc3dhcC92My1zZGsnXG5pbXBvcnQgSlNCSSBmcm9tICdqc2JpJ1xuaW1wb3J0IF8gZnJvbSAnbG9kYXNoJ1xuaW1wb3J0IHsgQVBJR0xhbWJkYUhhbmRsZXIsIEVycm9yUmVzcG9uc2UsIEhhbmRsZVJlcXVlc3RQYXJhbXMsIFJlc3BvbnNlIH0gZnJvbSAnLi4vaGFuZGxlcidcbmltcG9ydCB7IENvbnRhaW5lckluamVjdGVkLCBSZXF1ZXN0SW5qZWN0ZWQgfSBmcm9tICcuLi9pbmplY3Rvci1zb3InXG5pbXBvcnQgeyBRdW90ZVJlc3BvbnNlLCBRdW90ZVJlc3BvbnNlU2NoZW1hSm9pLCBWMlBvb2xJblJvdXRlLCBWM1Bvb2xJblJvdXRlIH0gZnJvbSAnLi4vc2NoZW1hJ1xuaW1wb3J0IHtcbiAgREVGQVVMVF9ST1VUSU5HX0NPTkZJR19CWV9DSEFJTixcbiAgcGFyc2VEZWFkbGluZSxcbiAgcGFyc2VTbGlwcGFnZVRvbGVyYW5jZSxcbiAgdG9rZW5TdHJpbmdUb0N1cnJlbmN5LFxufSBmcm9tICcuLi9zaGFyZWQnXG5pbXBvcnQgeyBRdW90ZVF1ZXJ5UGFyYW1zLCBRdW90ZVF1ZXJ5UGFyYW1zSm9pIH0gZnJvbSAnLi9zY2hlbWEvcXVvdGUtc2NoZW1hJ1xuaW1wb3J0IHsgdXRpbHMgfSBmcm9tICdldGhlcnMnXG5pbXBvcnQgeyBzaW11bGF0aW9uU3RhdHVzVG9TdHJpbmcgfSBmcm9tICcuL3V0aWwvc2ltdWxhdGlvbidcbmltcG9ydCBMb2dnZXIgZnJvbSAnYnVueWFuJ1xuaW1wb3J0IHsgUEFJUlNfVE9fVFJBQ0sgfSBmcm9tICcuL3V0aWwvcGFpcnMtdG8tdHJhY2snXG5cbmV4cG9ydCBjbGFzcyBRdW90ZUhhbmRsZXIgZXh0ZW5kcyBBUElHTGFtYmRhSGFuZGxlcjxcbiAgQ29udGFpbmVySW5qZWN0ZWQsXG4gIFJlcXVlc3RJbmplY3RlZDxJUm91dGVyPEFscGhhUm91dGVyQ29uZmlnPj4sXG4gIHZvaWQsXG4gIFF1b3RlUXVlcnlQYXJhbXMsXG4gIFF1b3RlUmVzcG9uc2Vcbj4ge1xuICBwdWJsaWMgYXN5bmMgaGFuZGxlUmVxdWVzdChcbiAgICBwYXJhbXM6IEhhbmRsZVJlcXVlc3RQYXJhbXM8Q29udGFpbmVySW5qZWN0ZWQsIFJlcXVlc3RJbmplY3RlZDxJUm91dGVyPGFueT4+LCB2b2lkLCBRdW90ZVF1ZXJ5UGFyYW1zPlxuICApOiBQcm9taXNlPFJlc3BvbnNlPFF1b3RlUmVzcG9uc2U+IHwgRXJyb3JSZXNwb25zZT4ge1xuICAgIGNvbnN0IHtcbiAgICAgIHJlcXVlc3RRdWVyeVBhcmFtczoge1xuICAgICAgICB0b2tlbkluQWRkcmVzcyxcbiAgICAgICAgdG9rZW5JbkNoYWluSWQsXG4gICAgICAgIHRva2VuT3V0QWRkcmVzcyxcbiAgICAgICAgdG9rZW5PdXRDaGFpbklkLFxuICAgICAgICBhbW91bnQ6IGFtb3VudFJhdyxcbiAgICAgICAgdHlwZSxcbiAgICAgICAgcmVjaXBpZW50LFxuICAgICAgICBzbGlwcGFnZVRvbGVyYW5jZSxcbiAgICAgICAgZGVhZGxpbmUsXG4gICAgICAgIG1pblNwbGl0cyxcbiAgICAgICAgZm9yY2VDcm9zc1Byb3RvY29sLFxuICAgICAgICBmb3JjZU1peGVkUm91dGVzLFxuICAgICAgICBwcm90b2NvbHM6IHByb3RvY29sc1N0cixcbiAgICAgICAgc2ltdWxhdGVGcm9tQWRkcmVzcyxcbiAgICAgICAgcGVybWl0U2lnbmF0dXJlLFxuICAgICAgICBwZXJtaXROb25jZSxcbiAgICAgICAgcGVybWl0RXhwaXJhdGlvbixcbiAgICAgICAgcGVybWl0QW1vdW50LFxuICAgICAgICBwZXJtaXRTaWdEZWFkbGluZSxcbiAgICAgICAgZW5hYmxlVW5pdmVyc2FsUm91dGVyLFxuICAgICAgfSxcbiAgICAgIHJlcXVlc3RJbmplY3RlZDoge1xuICAgICAgICByb3V0ZXIsXG4gICAgICAgIGxvZyxcbiAgICAgICAgaWQ6IHF1b3RlSWQsXG4gICAgICAgIGNoYWluSWQsXG4gICAgICAgIHRva2VuUHJvdmlkZXIsXG4gICAgICAgIHRva2VuTGlzdFByb3ZpZGVyLFxuICAgICAgICB2M1Bvb2xQcm92aWRlcjogdjNQb29sUHJvdmlkZXIsXG4gICAgICAgIHYyUG9vbFByb3ZpZGVyOiB2MlBvb2xQcm92aWRlcixcbiAgICAgICAgbWV0cmljLFxuICAgICAgfSxcbiAgICB9ID0gcGFyYW1zXG4gICAgbWV0cmljLnB1dE1ldHJpYyhgR0VUX1FVT1RFX1JFUVVFU1RFRF9DSEFJTklEOiAke2NoYWluSWR9YCwgMSwgTWV0cmljTG9nZ2VyVW5pdC5Db3VudClcblxuICAgIC8vIFBhcnNlIHVzZXIgcHJvdmlkZWQgdG9rZW4gYWRkcmVzcy9zeW1ib2wgdG8gQ3VycmVuY3kgb2JqZWN0LlxuICAgIGxldCBiZWZvcmUgPSBEYXRlLm5vdygpXG5cbiAgICBjb25zdCBjdXJyZW5jeUluID0gYXdhaXQgdG9rZW5TdHJpbmdUb0N1cnJlbmN5KFxuICAgICAgdG9rZW5MaXN0UHJvdmlkZXIsXG4gICAgICB0b2tlblByb3ZpZGVyLFxuICAgICAgdG9rZW5JbkFkZHJlc3MsXG4gICAgICB0b2tlbkluQ2hhaW5JZCxcbiAgICAgIGxvZ1xuICAgIClcblxuICAgIGNvbnN0IGN1cnJlbmN5T3V0ID0gYXdhaXQgdG9rZW5TdHJpbmdUb0N1cnJlbmN5KFxuICAgICAgdG9rZW5MaXN0UHJvdmlkZXIsXG4gICAgICB0b2tlblByb3ZpZGVyLFxuICAgICAgdG9rZW5PdXRBZGRyZXNzLFxuICAgICAgdG9rZW5PdXRDaGFpbklkLFxuICAgICAgbG9nXG4gICAgKVxuXG4gICAgbWV0cmljLnB1dE1ldHJpYygnVG9rZW5Jbk91dFN0clRvVG9rZW4nLCBEYXRlLm5vdygpIC0gYmVmb3JlLCBNZXRyaWNMb2dnZXJVbml0Lk1pbGxpc2Vjb25kcylcblxuICAgIGlmICghY3VycmVuY3lJbikge1xuICAgICAgbWV0cmljLnB1dE1ldHJpYyhgR0VUX1FVT1RFXzQwMF9DSEFJTklEOiAke2NoYWluSWR9YCwgMSwgTWV0cmljTG9nZ2VyVW5pdC5Db3VudClcbiAgICAgIHJldHVybiB7XG4gICAgICAgIHN0YXR1c0NvZGU6IDQwMCxcbiAgICAgICAgZXJyb3JDb2RlOiAnVE9LRU5fSU5fSU5WQUxJRCcsXG4gICAgICAgIGRldGFpbDogYENvdWxkIG5vdCBmaW5kIHRva2VuIHdpdGggYWRkcmVzcyBcIiR7dG9rZW5JbkFkZHJlc3N9XCJgLFxuICAgICAgfVxuICAgIH1cblxuICAgIGlmICghY3VycmVuY3lPdXQpIHtcbiAgICAgIG1ldHJpYy5wdXRNZXRyaWMoYEdFVF9RVU9URV80MDBfQ0hBSU5JRDogJHtjaGFpbklkfWAsIDEsIE1ldHJpY0xvZ2dlclVuaXQuQ291bnQpXG4gICAgICByZXR1cm4ge1xuICAgICAgICBzdGF0dXNDb2RlOiA0MDAsXG4gICAgICAgIGVycm9yQ29kZTogJ1RPS0VOX09VVF9JTlZBTElEJyxcbiAgICAgICAgZGV0YWlsOiBgQ291bGQgbm90IGZpbmQgdG9rZW4gd2l0aCBhZGRyZXNzIFwiJHt0b2tlbk91dEFkZHJlc3N9XCJgLFxuICAgICAgfVxuICAgIH1cblxuICAgIGlmICh0b2tlbkluQ2hhaW5JZCAhPSB0b2tlbk91dENoYWluSWQpIHtcbiAgICAgIG1ldHJpYy5wdXRNZXRyaWMoYEdFVF9RVU9URV80MDBfQ0hBSU5JRDogJHtjaGFpbklkfWAsIDEsIE1ldHJpY0xvZ2dlclVuaXQuQ291bnQpXG4gICAgICByZXR1cm4ge1xuICAgICAgICBzdGF0dXNDb2RlOiA0MDAsXG4gICAgICAgIGVycm9yQ29kZTogJ1RPS0VOX0NIQUlOU19ESUZGRVJFTlQnLFxuICAgICAgICBkZXRhaWw6IGBDYW5ub3QgcmVxdWVzdCBxdW90ZXMgZm9yIHRva2VucyBvbiBkaWZmZXJlbnQgY2hhaW5zYCxcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoY3VycmVuY3lJbi5lcXVhbHMoY3VycmVuY3lPdXQpKSB7XG4gICAgICBtZXRyaWMucHV0TWV0cmljKGBHRVRfUVVPVEVfNDAwX0NIQUlOSUQ6ICR7Y2hhaW5JZH1gLCAxLCBNZXRyaWNMb2dnZXJVbml0LkNvdW50KVxuICAgICAgcmV0dXJuIHtcbiAgICAgICAgc3RhdHVzQ29kZTogNDAwLFxuICAgICAgICBlcnJvckNvZGU6ICdUT0tFTl9JTl9PVVRfU0FNRScsXG4gICAgICAgIGRldGFpbDogYHRva2VuSW4gYW5kIHRva2VuT3V0IG11c3QgYmUgZGlmZmVyZW50YCxcbiAgICAgIH1cbiAgICB9XG5cbiAgICBsZXQgcHJvdG9jb2xzOiBQcm90b2NvbFtdID0gW11cbiAgICBpZiAocHJvdG9jb2xzU3RyKSB7XG4gICAgICBmb3IgKGNvbnN0IHByb3RvY29sU3RyIG9mIHByb3RvY29sc1N0cikge1xuICAgICAgICBzd2l0Y2ggKHByb3RvY29sU3RyLnRvTG93ZXJDYXNlKCkpIHtcbiAgICAgICAgICBjYXNlICd2Mic6XG4gICAgICAgICAgICBwcm90b2NvbHMucHVzaChQcm90b2NvbC5WMilcbiAgICAgICAgICAgIGJyZWFrXG4gICAgICAgICAgY2FzZSAndjMnOlxuICAgICAgICAgICAgcHJvdG9jb2xzLnB1c2goUHJvdG9jb2wuVjMpXG4gICAgICAgICAgICBicmVha1xuICAgICAgICAgIGNhc2UgJ21peGVkJzpcbiAgICAgICAgICAgIHByb3RvY29scy5wdXNoKFByb3RvY29sLk1JWEVEKVxuICAgICAgICAgICAgYnJlYWtcbiAgICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgICAgc3RhdHVzQ29kZTogNDAwLFxuICAgICAgICAgICAgICBlcnJvckNvZGU6ICdJTlZBTElEX1BST1RPQ09MJyxcbiAgICAgICAgICAgICAgZGV0YWlsOiBgSW52YWxpZCBwcm90b2NvbCBzcGVjaWZpZWQuIFN1cHBvcnRlZCBwcm90b2NvbHM6ICR7SlNPTi5zdHJpbmdpZnkoT2JqZWN0LnZhbHVlcyhQcm90b2NvbCkpfWAsXG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9IGVsc2UgaWYgKCFmb3JjZUNyb3NzUHJvdG9jb2wpIHtcbiAgICAgIHByb3RvY29scyA9IFtQcm90b2NvbC5WM11cbiAgICB9XG5cbiAgICBjb25zdCByb3V0aW5nQ29uZmlnOiBBbHBoYVJvdXRlckNvbmZpZyA9IHtcbiAgICAgIC4uLkRFRkFVTFRfUk9VVElOR19DT05GSUdfQllfQ0hBSU4oY2hhaW5JZCksXG4gICAgICAuLi4obWluU3BsaXRzID8geyBtaW5TcGxpdHMgfSA6IHt9KSxcbiAgICAgIC4uLihmb3JjZUNyb3NzUHJvdG9jb2wgPyB7IGZvcmNlQ3Jvc3NQcm90b2NvbCB9IDoge30pLFxuICAgICAgLi4uKGZvcmNlTWl4ZWRSb3V0ZXMgPyB7IGZvcmNlTWl4ZWRSb3V0ZXMgfSA6IHt9KSxcbiAgICAgIHByb3RvY29scyxcbiAgICB9XG5cbiAgICBsZXQgc3dhcFBhcmFtczogU3dhcE9wdGlvbnMgfCB1bmRlZmluZWQgPSB1bmRlZmluZWRcblxuICAgIC8vIGUuZy4gSW5wdXRzIG9mIGZvcm0gXCIxLjI1JVwiIHdpdGggMmRwIG1heC4gQ29udmVydCB0byBmcmFjdGlvbmFsIHJlcHJlc2VudGF0aW9uID0+IDEuMjUgPT4gMTI1IC8gMTAwMDBcbiAgICBpZiAoc2xpcHBhZ2VUb2xlcmFuY2UgJiYgZGVhZGxpbmUgJiYgcmVjaXBpZW50KSB7XG4gICAgICBjb25zdCBzbGlwcGFnZVRvbGVyYW5jZVBlcmNlbnQgPSBwYXJzZVNsaXBwYWdlVG9sZXJhbmNlKHNsaXBwYWdlVG9sZXJhbmNlKVxuXG4gICAgICAvLyBUT0RPOiBSZW1vdmUgb25jZSB1bml2ZXJzYWwgcm91dGVyIGlzIG5vIGxvbmdlciBiZWhpbmQgYSBmZWF0dXJlIGZsYWcuXG4gICAgICBpZiAoZW5hYmxlVW5pdmVyc2FsUm91dGVyKSB7XG4gICAgICAgIHN3YXBQYXJhbXMgPSB7XG4gICAgICAgICAgdHlwZTogU3dhcFR5cGUuVU5JVkVSU0FMX1JPVVRFUixcbiAgICAgICAgICBkZWFkbGluZU9yUHJldmlvdXNCbG9ja2hhc2g6IHBhcnNlRGVhZGxpbmUoZGVhZGxpbmUpLFxuICAgICAgICAgIHJlY2lwaWVudDogcmVjaXBpZW50LFxuICAgICAgICAgIHNsaXBwYWdlVG9sZXJhbmNlOiBzbGlwcGFnZVRvbGVyYW5jZVBlcmNlbnQsXG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHN3YXBQYXJhbXMgPSB7XG4gICAgICAgICAgdHlwZTogU3dhcFR5cGUuU1dBUF9ST1VURVJfMDIsXG4gICAgICAgICAgZGVhZGxpbmU6IHBhcnNlRGVhZGxpbmUoZGVhZGxpbmUpLFxuICAgICAgICAgIHJlY2lwaWVudDogcmVjaXBpZW50LFxuICAgICAgICAgIHNsaXBwYWdlVG9sZXJhbmNlOiBzbGlwcGFnZVRvbGVyYW5jZVBlcmNlbnQsXG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgaWYgKFxuICAgICAgICBlbmFibGVVbml2ZXJzYWxSb3V0ZXIgJiZcbiAgICAgICAgcGVybWl0U2lnbmF0dXJlICYmXG4gICAgICAgIHBlcm1pdE5vbmNlICYmXG4gICAgICAgIHBlcm1pdEV4cGlyYXRpb24gJiZcbiAgICAgICAgcGVybWl0QW1vdW50ICYmXG4gICAgICAgIHBlcm1pdFNpZ0RlYWRsaW5lXG4gICAgICApIHtcbiAgICAgICAgY29uc3QgcGVybWl0OiBQZXJtaXRTaW5nbGUgPSB7XG4gICAgICAgICAgZGV0YWlsczoge1xuICAgICAgICAgICAgdG9rZW46IGN1cnJlbmN5SW4ud3JhcHBlZC5hZGRyZXNzLFxuICAgICAgICAgICAgYW1vdW50OiBwZXJtaXRBbW91bnQsXG4gICAgICAgICAgICBleHBpcmF0aW9uOiBwZXJtaXRFeHBpcmF0aW9uLFxuICAgICAgICAgICAgbm9uY2U6IHBlcm1pdE5vbmNlLFxuICAgICAgICAgIH0sXG4gICAgICAgICAgc3BlbmRlcjogVU5JVkVSU0FMX1JPVVRFUl9BRERSRVNTKGNoYWluSWQpLFxuICAgICAgICAgIHNpZ0RlYWRsaW5lOiBwZXJtaXRTaWdEZWFkbGluZSxcbiAgICAgICAgfVxuXG4gICAgICAgIHN3YXBQYXJhbXMuaW5wdXRUb2tlblBlcm1pdCA9IHtcbiAgICAgICAgICAuLi5wZXJtaXQsXG4gICAgICAgICAgc2lnbmF0dXJlOiBwZXJtaXRTaWduYXR1cmUsXG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSBpZiAoXG4gICAgICAgICFlbmFibGVVbml2ZXJzYWxSb3V0ZXIgJiZcbiAgICAgICAgcGVybWl0U2lnbmF0dXJlICYmXG4gICAgICAgICgocGVybWl0Tm9uY2UgJiYgcGVybWl0RXhwaXJhdGlvbikgfHwgKHBlcm1pdEFtb3VudCAmJiBwZXJtaXRTaWdEZWFkbGluZSkpXG4gICAgICApIHtcbiAgICAgICAgY29uc3QgeyB2LCByLCBzIH0gPSB1dGlscy5zcGxpdFNpZ25hdHVyZShwZXJtaXRTaWduYXR1cmUpXG5cbiAgICAgICAgc3dhcFBhcmFtcy5pbnB1dFRva2VuUGVybWl0ID0ge1xuICAgICAgICAgIHY6IHYgYXMgMCB8IDEgfCAyNyB8IDI4LFxuICAgICAgICAgIHIsXG4gICAgICAgICAgcyxcbiAgICAgICAgICAuLi4ocGVybWl0Tm9uY2UgJiYgcGVybWl0RXhwaXJhdGlvblxuICAgICAgICAgICAgPyB7IG5vbmNlOiBwZXJtaXROb25jZSEsIGV4cGlyeTogcGVybWl0RXhwaXJhdGlvbiEgfVxuICAgICAgICAgICAgOiB7IGFtb3VudDogcGVybWl0QW1vdW50ISwgZGVhZGxpbmU6IHBlcm1pdFNpZ0RlYWRsaW5lISB9KSxcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBpZiAoc2ltdWxhdGVGcm9tQWRkcmVzcykge1xuICAgICAgICBtZXRyaWMucHV0TWV0cmljKCdTaW11bGF0aW9uIFJlcXVlc3RlZCcsIDEsIE1ldHJpY0xvZ2dlclVuaXQuQ291bnQpXG4gICAgICAgIHN3YXBQYXJhbXMuc2ltdWxhdGUgPSB7IGZyb21BZGRyZXNzOiBzaW11bGF0ZUZyb21BZGRyZXNzIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICBiZWZvcmUgPSBEYXRlLm5vdygpXG5cbiAgICBsZXQgc3dhcFJvdXRlOiBTd2FwUm91dGUgfCBudWxsXG4gICAgbGV0IGFtb3VudDogQ3VycmVuY3lBbW91bnQ8Q3VycmVuY3k+XG5cbiAgICBsZXQgdG9rZW5QYWlyU3ltYm9sID0gJydcbiAgICBsZXQgdG9rZW5QYWlyU3ltYm9sQ2hhaW4gPSAnJ1xuICAgIGlmIChjdXJyZW5jeUluLnN5bWJvbCAmJiBjdXJyZW5jeU91dC5zeW1ib2wpIHtcbiAgICAgIHRva2VuUGFpclN5bWJvbCA9IF8oW2N1cnJlbmN5SW4uc3ltYm9sLCBjdXJyZW5jeU91dC5zeW1ib2xdKS5qb2luKCcvJylcbiAgICAgIHRva2VuUGFpclN5bWJvbENoYWluID0gYCR7dG9rZW5QYWlyU3ltYm9sfS8ke2NoYWluSWR9YFxuICAgIH1cblxuICAgIGNvbnN0IFt0b2tlbjBTeW1ib2wsIHRva2VuMEFkZHJlc3MsIHRva2VuMVN5bWJvbCwgdG9rZW4xQWRkcmVzc10gPSBjdXJyZW5jeUluLndyYXBwZWQuc29ydHNCZWZvcmUoXG4gICAgICBjdXJyZW5jeU91dC53cmFwcGVkXG4gICAgKVxuICAgICAgPyBbY3VycmVuY3lJbi5zeW1ib2wsIGN1cnJlbmN5SW4ud3JhcHBlZC5hZGRyZXNzLCBjdXJyZW5jeU91dC5zeW1ib2wsIGN1cnJlbmN5T3V0LndyYXBwZWQuYWRkcmVzc11cbiAgICAgIDogW2N1cnJlbmN5T3V0LnN5bWJvbCwgY3VycmVuY3lPdXQud3JhcHBlZC5hZGRyZXNzLCBjdXJyZW5jeUluLnN5bWJvbCwgY3VycmVuY3lJbi53cmFwcGVkLmFkZHJlc3NdXG5cbiAgICBzd2l0Y2ggKHR5cGUpIHtcbiAgICAgIGNhc2UgJ2V4YWN0SW4nOlxuICAgICAgICBhbW91bnQgPSBDdXJyZW5jeUFtb3VudC5mcm9tUmF3QW1vdW50KGN1cnJlbmN5SW4sIEpTQkkuQmlnSW50KGFtb3VudFJhdykpXG5cbiAgICAgICAgbG9nLmluZm8oXG4gICAgICAgICAge1xuICAgICAgICAgICAgYW1vdW50SW46IGFtb3VudC50b0V4YWN0KCksXG4gICAgICAgICAgICB0b2tlbjBBZGRyZXNzLFxuICAgICAgICAgICAgdG9rZW4xQWRkcmVzcyxcbiAgICAgICAgICAgIHRva2VuMFN5bWJvbCxcbiAgICAgICAgICAgIHRva2VuMVN5bWJvbCxcbiAgICAgICAgICAgIHRva2VuSW5TeW1ib2w6IGN1cnJlbmN5SW4uc3ltYm9sLFxuICAgICAgICAgICAgdG9rZW5PdXRTeW1ib2w6IGN1cnJlbmN5T3V0LnN5bWJvbCxcbiAgICAgICAgICAgIHRva2VuUGFpclN5bWJvbCxcbiAgICAgICAgICAgIHRva2VuUGFpclN5bWJvbENoYWluLFxuICAgICAgICAgICAgdHlwZSxcbiAgICAgICAgICAgIHJvdXRpbmdDb25maWc6IHJvdXRpbmdDb25maWcsXG4gICAgICAgICAgICBzd2FwUGFyYW1zLFxuICAgICAgICAgIH0sXG4gICAgICAgICAgYEV4YWN0IEluIFN3YXA6IEdpdmUgJHthbW91bnQudG9FeGFjdCgpfSAke2Ftb3VudC5jdXJyZW5jeS5zeW1ib2x9LCBXYW50OiAke1xuICAgICAgICAgICAgY3VycmVuY3lPdXQuc3ltYm9sXG4gICAgICAgICAgfS4gQ2hhaW46ICR7Y2hhaW5JZH1gXG4gICAgICAgIClcblxuICAgICAgICBzd2FwUm91dGUgPSBhd2FpdCByb3V0ZXIucm91dGUoYW1vdW50LCBjdXJyZW5jeU91dCwgVHJhZGVUeXBlLkVYQUNUX0lOUFVULCBzd2FwUGFyYW1zLCByb3V0aW5nQ29uZmlnKVxuICAgICAgICBicmVha1xuICAgICAgY2FzZSAnZXhhY3RPdXQnOlxuICAgICAgICBhbW91bnQgPSBDdXJyZW5jeUFtb3VudC5mcm9tUmF3QW1vdW50KGN1cnJlbmN5T3V0LCBKU0JJLkJpZ0ludChhbW91bnRSYXcpKVxuXG4gICAgICAgIGxvZy5pbmZvKFxuICAgICAgICAgIHtcbiAgICAgICAgICAgIGFtb3VudE91dDogYW1vdW50LnRvRXhhY3QoKSxcbiAgICAgICAgICAgIHRva2VuMEFkZHJlc3MsXG4gICAgICAgICAgICB0b2tlbjFBZGRyZXNzLFxuICAgICAgICAgICAgdG9rZW4wU3ltYm9sLFxuICAgICAgICAgICAgdG9rZW4xU3ltYm9sLFxuICAgICAgICAgICAgdG9rZW5JblN5bWJvbDogY3VycmVuY3lJbi5zeW1ib2wsXG4gICAgICAgICAgICB0b2tlbk91dFN5bWJvbDogY3VycmVuY3lPdXQuc3ltYm9sLFxuICAgICAgICAgICAgdG9rZW5QYWlyU3ltYm9sLFxuICAgICAgICAgICAgdG9rZW5QYWlyU3ltYm9sQ2hhaW4sXG4gICAgICAgICAgICB0eXBlLFxuICAgICAgICAgICAgcm91dGluZ0NvbmZpZzogcm91dGluZ0NvbmZpZyxcbiAgICAgICAgICAgIHN3YXBQYXJhbXMsXG4gICAgICAgICAgfSxcbiAgICAgICAgICBgRXhhY3QgT3V0IFN3YXA6IFdhbnQgJHthbW91bnQudG9FeGFjdCgpfSAke2Ftb3VudC5jdXJyZW5jeS5zeW1ib2x9IEdpdmU6ICR7XG4gICAgICAgICAgICBjdXJyZW5jeUluLnN5bWJvbFxuICAgICAgICAgIH0uIENoYWluOiAke2NoYWluSWR9YFxuICAgICAgICApXG5cbiAgICAgICAgc3dhcFJvdXRlID0gYXdhaXQgcm91dGVyLnJvdXRlKGFtb3VudCwgY3VycmVuY3lJbiwgVHJhZGVUeXBlLkVYQUNUX09VVFBVVCwgc3dhcFBhcmFtcywgcm91dGluZ0NvbmZpZylcbiAgICAgICAgYnJlYWtcbiAgICAgIGRlZmF1bHQ6XG4gICAgICAgIHRocm93IG5ldyBFcnJvcignSW52YWxpZCBzd2FwIHR5cGUnKVxuICAgIH1cblxuICAgIGlmICghc3dhcFJvdXRlKSB7XG4gICAgICBsb2cuaW5mbyhcbiAgICAgICAge1xuICAgICAgICAgIHR5cGUsXG4gICAgICAgICAgdG9rZW5JbjogY3VycmVuY3lJbixcbiAgICAgICAgICB0b2tlbk91dDogY3VycmVuY3lPdXQsXG4gICAgICAgICAgYW1vdW50OiBhbW91bnQucXVvdGllbnQudG9TdHJpbmcoKSxcbiAgICAgICAgfSxcbiAgICAgICAgYE5vIHJvdXRlIGZvdW5kLiA0MDRgXG4gICAgICApXG5cbiAgICAgIHJldHVybiB7XG4gICAgICAgIHN0YXR1c0NvZGU6IDQwNCxcbiAgICAgICAgZXJyb3JDb2RlOiAnTk9fUk9VVEUnLFxuICAgICAgICBkZXRhaWw6ICdObyByb3V0ZSBmb3VuZCcsXG4gICAgICB9XG4gICAgfVxuXG4gICAgY29uc3Qge1xuICAgICAgcXVvdGUsXG4gICAgICBxdW90ZUdhc0FkanVzdGVkLFxuICAgICAgcm91dGUsXG4gICAgICBlc3RpbWF0ZWRHYXNVc2VkLFxuICAgICAgZXN0aW1hdGVkR2FzVXNlZFF1b3RlVG9rZW4sXG4gICAgICBlc3RpbWF0ZWRHYXNVc2VkVVNELFxuICAgICAgZ2FzUHJpY2VXZWksXG4gICAgICBtZXRob2RQYXJhbWV0ZXJzLFxuICAgICAgYmxvY2tOdW1iZXIsXG4gICAgICBzaW11bGF0aW9uU3RhdHVzLFxuICAgIH0gPSBzd2FwUm91dGVcblxuICAgIGlmIChzaW11bGF0aW9uU3RhdHVzID09IFNpbXVsYXRpb25TdGF0dXMuRmFpbGVkKSB7XG4gICAgICBtZXRyaWMucHV0TWV0cmljKCdTaW11bGF0aW9uRmFpbGVkJywgMSwgTWV0cmljTG9nZ2VyVW5pdC5Db3VudClcbiAgICB9IGVsc2UgaWYgKHNpbXVsYXRpb25TdGF0dXMgPT0gU2ltdWxhdGlvblN0YXR1cy5TdWNjZWVkZWQpIHtcbiAgICAgIG1ldHJpYy5wdXRNZXRyaWMoJ1NpbXVsYXRpb25TdWNjZXNzZnVsJywgMSwgTWV0cmljTG9nZ2VyVW5pdC5Db3VudClcbiAgICB9IGVsc2UgaWYgKHNpbXVsYXRpb25TdGF0dXMgPT0gU2ltdWxhdGlvblN0YXR1cy5JbnN1ZmZpY2llbnRCYWxhbmNlKSB7XG4gICAgICBtZXRyaWMucHV0TWV0cmljKCdTaW11bGF0aW9uSW5zdWZmaWNpZW50QmFsYW5jZScsIDEsIE1ldHJpY0xvZ2dlclVuaXQuQ291bnQpXG4gICAgfSBlbHNlIGlmIChzaW11bGF0aW9uU3RhdHVzID09IFNpbXVsYXRpb25TdGF0dXMuTm90QXBwcm92ZWQpIHtcbiAgICAgIG1ldHJpYy5wdXRNZXRyaWMoJ1NpbXVsYXRpb25Ob3RBcHByb3ZlZCcsIDEsIE1ldHJpY0xvZ2dlclVuaXQuQ291bnQpXG4gICAgfSBlbHNlIGlmIChzaW11bGF0aW9uU3RhdHVzID09IFNpbXVsYXRpb25TdGF0dXMuTm90U3VwcG9ydGVkKSB7XG4gICAgICBtZXRyaWMucHV0TWV0cmljKCdTaW11bGF0aW9uTm90U3VwcG9ydGVkJywgMSwgTWV0cmljTG9nZ2VyVW5pdC5Db3VudClcbiAgICB9XG5cbiAgICBjb25zdCByb3V0ZVJlc3BvbnNlOiBBcnJheTwoVjNQb29sSW5Sb3V0ZSB8IFYyUG9vbEluUm91dGUpW10+ID0gW11cblxuICAgIGZvciAoY29uc3Qgc3ViUm91dGUgb2Ygcm91dGUpIHtcbiAgICAgIGNvbnN0IHsgYW1vdW50LCBxdW90ZSwgdG9rZW5QYXRoIH0gPSBzdWJSb3V0ZVxuXG4gICAgICBjb25zdCBwb29scyA9IHN1YlJvdXRlLnByb3RvY29sID09IFByb3RvY29sLlYyID8gc3ViUm91dGUucm91dGUucGFpcnMgOiBzdWJSb3V0ZS5yb3V0ZS5wb29sc1xuICAgICAgY29uc3QgY3VyUm91dGU6IChWM1Bvb2xJblJvdXRlIHwgVjJQb29sSW5Sb3V0ZSlbXSA9IFtdXG4gICAgICBmb3IgKGxldCBpID0gMDsgaSA8IHBvb2xzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgIGNvbnN0IG5leHRQb29sID0gcG9vbHNbaV1cbiAgICAgICAgY29uc3QgdG9rZW5JbiA9IHRva2VuUGF0aFtpXVxuICAgICAgICBjb25zdCB0b2tlbk91dCA9IHRva2VuUGF0aFtpICsgMV1cblxuICAgICAgICBsZXQgZWRnZUFtb3VudEluID0gdW5kZWZpbmVkXG4gICAgICAgIGlmIChpID09IDApIHtcbiAgICAgICAgICBlZGdlQW1vdW50SW4gPSB0eXBlID09ICdleGFjdEluJyA/IGFtb3VudC5xdW90aWVudC50b1N0cmluZygpIDogcXVvdGUucXVvdGllbnQudG9TdHJpbmcoKVxuICAgICAgICB9XG5cbiAgICAgICAgbGV0IGVkZ2VBbW91bnRPdXQgPSB1bmRlZmluZWRcbiAgICAgICAgaWYgKGkgPT0gcG9vbHMubGVuZ3RoIC0gMSkge1xuICAgICAgICAgIGVkZ2VBbW91bnRPdXQgPSB0eXBlID09ICdleGFjdEluJyA/IHF1b3RlLnF1b3RpZW50LnRvU3RyaW5nKCkgOiBhbW91bnQucXVvdGllbnQudG9TdHJpbmcoKVxuICAgICAgICB9XG5cbiAgICAgICAgaWYgKG5leHRQb29sIGluc3RhbmNlb2YgUG9vbCkge1xuICAgICAgICAgIGN1clJvdXRlLnB1c2goe1xuICAgICAgICAgICAgdHlwZTogJ3YzLXBvb2wnLFxuICAgICAgICAgICAgYWRkcmVzczogdjNQb29sUHJvdmlkZXIuZ2V0UG9vbEFkZHJlc3MobmV4dFBvb2wudG9rZW4wLCBuZXh0UG9vbC50b2tlbjEsIG5leHRQb29sLmZlZSkucG9vbEFkZHJlc3MsXG4gICAgICAgICAgICB0b2tlbkluOiB7XG4gICAgICAgICAgICAgIGNoYWluSWQ6IHRva2VuSW4uY2hhaW5JZCxcbiAgICAgICAgICAgICAgZGVjaW1hbHM6IHRva2VuSW4uZGVjaW1hbHMudG9TdHJpbmcoKSxcbiAgICAgICAgICAgICAgYWRkcmVzczogdG9rZW5Jbi5hZGRyZXNzLFxuICAgICAgICAgICAgICBzeW1ib2w6IHRva2VuSW4uc3ltYm9sISxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB0b2tlbk91dDoge1xuICAgICAgICAgICAgICBjaGFpbklkOiB0b2tlbk91dC5jaGFpbklkLFxuICAgICAgICAgICAgICBkZWNpbWFsczogdG9rZW5PdXQuZGVjaW1hbHMudG9TdHJpbmcoKSxcbiAgICAgICAgICAgICAgYWRkcmVzczogdG9rZW5PdXQuYWRkcmVzcyxcbiAgICAgICAgICAgICAgc3ltYm9sOiB0b2tlbk91dC5zeW1ib2whLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIGZlZTogbmV4dFBvb2wuZmVlLnRvU3RyaW5nKCksXG4gICAgICAgICAgICBsaXF1aWRpdHk6IG5leHRQb29sLmxpcXVpZGl0eS50b1N0cmluZygpLFxuICAgICAgICAgICAgc3FydFJhdGlvWDk2OiBuZXh0UG9vbC5zcXJ0UmF0aW9YOTYudG9TdHJpbmcoKSxcbiAgICAgICAgICAgIHRpY2tDdXJyZW50OiBuZXh0UG9vbC50aWNrQ3VycmVudC50b1N0cmluZygpLFxuICAgICAgICAgICAgYW1vdW50SW46IGVkZ2VBbW91bnRJbixcbiAgICAgICAgICAgIGFtb3VudE91dDogZWRnZUFtb3VudE91dCxcbiAgICAgICAgICB9KVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGNvbnN0IHJlc2VydmUwID0gbmV4dFBvb2wucmVzZXJ2ZTBcbiAgICAgICAgICBjb25zdCByZXNlcnZlMSA9IG5leHRQb29sLnJlc2VydmUxXG5cbiAgICAgICAgICBjdXJSb3V0ZS5wdXNoKHtcbiAgICAgICAgICAgIHR5cGU6ICd2Mi1wb29sJyxcbiAgICAgICAgICAgIGFkZHJlc3M6IHYyUG9vbFByb3ZpZGVyLmdldFBvb2xBZGRyZXNzKG5leHRQb29sLnRva2VuMCwgbmV4dFBvb2wudG9rZW4xKS5wb29sQWRkcmVzcyxcbiAgICAgICAgICAgIHRva2VuSW46IHtcbiAgICAgICAgICAgICAgY2hhaW5JZDogdG9rZW5Jbi5jaGFpbklkLFxuICAgICAgICAgICAgICBkZWNpbWFsczogdG9rZW5Jbi5kZWNpbWFscy50b1N0cmluZygpLFxuICAgICAgICAgICAgICBhZGRyZXNzOiB0b2tlbkluLmFkZHJlc3MsXG4gICAgICAgICAgICAgIHN5bWJvbDogdG9rZW5Jbi5zeW1ib2whLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHRva2VuT3V0OiB7XG4gICAgICAgICAgICAgIGNoYWluSWQ6IHRva2VuT3V0LmNoYWluSWQsXG4gICAgICAgICAgICAgIGRlY2ltYWxzOiB0b2tlbk91dC5kZWNpbWFscy50b1N0cmluZygpLFxuICAgICAgICAgICAgICBhZGRyZXNzOiB0b2tlbk91dC5hZGRyZXNzLFxuICAgICAgICAgICAgICBzeW1ib2w6IHRva2VuT3V0LnN5bWJvbCEsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgcmVzZXJ2ZTA6IHtcbiAgICAgICAgICAgICAgdG9rZW46IHtcbiAgICAgICAgICAgICAgICBjaGFpbklkOiByZXNlcnZlMC5jdXJyZW5jeS53cmFwcGVkLmNoYWluSWQsXG4gICAgICAgICAgICAgICAgZGVjaW1hbHM6IHJlc2VydmUwLmN1cnJlbmN5LndyYXBwZWQuZGVjaW1hbHMudG9TdHJpbmcoKSxcbiAgICAgICAgICAgICAgICBhZGRyZXNzOiByZXNlcnZlMC5jdXJyZW5jeS53cmFwcGVkLmFkZHJlc3MsXG4gICAgICAgICAgICAgICAgc3ltYm9sOiByZXNlcnZlMC5jdXJyZW5jeS53cmFwcGVkLnN5bWJvbCEsXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIHF1b3RpZW50OiByZXNlcnZlMC5xdW90aWVudC50b1N0cmluZygpLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHJlc2VydmUxOiB7XG4gICAgICAgICAgICAgIHRva2VuOiB7XG4gICAgICAgICAgICAgICAgY2hhaW5JZDogcmVzZXJ2ZTEuY3VycmVuY3kud3JhcHBlZC5jaGFpbklkLFxuICAgICAgICAgICAgICAgIGRlY2ltYWxzOiByZXNlcnZlMS5jdXJyZW5jeS53cmFwcGVkLmRlY2ltYWxzLnRvU3RyaW5nKCksXG4gICAgICAgICAgICAgICAgYWRkcmVzczogcmVzZXJ2ZTEuY3VycmVuY3kud3JhcHBlZC5hZGRyZXNzLFxuICAgICAgICAgICAgICAgIHN5bWJvbDogcmVzZXJ2ZTEuY3VycmVuY3kud3JhcHBlZC5zeW1ib2whLFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICBxdW90aWVudDogcmVzZXJ2ZTEucXVvdGllbnQudG9TdHJpbmcoKSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBhbW91bnRJbjogZWRnZUFtb3VudEluLFxuICAgICAgICAgICAgYW1vdW50T3V0OiBlZGdlQW1vdW50T3V0LFxuICAgICAgICAgIH0pXG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgcm91dGVSZXNwb25zZS5wdXNoKGN1clJvdXRlKVxuICAgIH1cblxuICAgIGNvbnN0IHJvdXRlU3RyaW5nID0gcm91dGVBbW91bnRzVG9TdHJpbmcocm91dGUpXG5cbiAgICBjb25zdCByZXN1bHQ6IFF1b3RlUmVzcG9uc2UgPSB7XG4gICAgICBtZXRob2RQYXJhbWV0ZXJzLFxuICAgICAgYmxvY2tOdW1iZXI6IGJsb2NrTnVtYmVyLnRvU3RyaW5nKCksXG4gICAgICBhbW91bnQ6IGFtb3VudC5xdW90aWVudC50b1N0cmluZygpLFxuICAgICAgYW1vdW50RGVjaW1hbHM6IGFtb3VudC50b0V4YWN0KCksXG4gICAgICBxdW90ZTogcXVvdGUucXVvdGllbnQudG9TdHJpbmcoKSxcbiAgICAgIHF1b3RlRGVjaW1hbHM6IHF1b3RlLnRvRXhhY3QoKSxcbiAgICAgIHF1b3RlR2FzQWRqdXN0ZWQ6IHF1b3RlR2FzQWRqdXN0ZWQucXVvdGllbnQudG9TdHJpbmcoKSxcbiAgICAgIHF1b3RlR2FzQWRqdXN0ZWREZWNpbWFsczogcXVvdGVHYXNBZGp1c3RlZC50b0V4YWN0KCksXG4gICAgICBnYXNVc2VFc3RpbWF0ZVF1b3RlOiBlc3RpbWF0ZWRHYXNVc2VkUXVvdGVUb2tlbi5xdW90aWVudC50b1N0cmluZygpLFxuICAgICAgZ2FzVXNlRXN0aW1hdGVRdW90ZURlY2ltYWxzOiBlc3RpbWF0ZWRHYXNVc2VkUXVvdGVUb2tlbi50b0V4YWN0KCksXG4gICAgICBnYXNVc2VFc3RpbWF0ZTogZXN0aW1hdGVkR2FzVXNlZC50b1N0cmluZygpLFxuICAgICAgZ2FzVXNlRXN0aW1hdGVVU0Q6IGVzdGltYXRlZEdhc1VzZWRVU0QudG9FeGFjdCgpLFxuICAgICAgc2ltdWxhdGlvblN0YXR1czogc2ltdWxhdGlvblN0YXR1c1RvU3RyaW5nKHNpbXVsYXRpb25TdGF0dXMsIGxvZyksXG4gICAgICBzaW11bGF0aW9uRXJyb3I6IHNpbXVsYXRpb25TdGF0dXMgPT0gU2ltdWxhdGlvblN0YXR1cy5GYWlsZWQsXG4gICAgICBnYXNQcmljZVdlaTogZ2FzUHJpY2VXZWkudG9TdHJpbmcoKSxcbiAgICAgIHJvdXRlOiByb3V0ZVJlc3BvbnNlLFxuICAgICAgcm91dGVTdHJpbmcsXG4gICAgICBxdW90ZUlkLFxuICAgIH1cblxuICAgIG1ldHJpYy5wdXRNZXRyaWMoYEdFVF9RVU9URV8yMDBfQ0hBSU5JRDogJHtjaGFpbklkfWAsIDEsIE1ldHJpY0xvZ2dlclVuaXQuQ291bnQpXG5cbiAgICB0aGlzLmxvZ1JvdXRlTWV0cmljcyhcbiAgICAgIGxvZyxcbiAgICAgIG1ldHJpYyxcbiAgICAgIGN1cnJlbmN5SW4sXG4gICAgICBjdXJyZW5jeU91dCxcbiAgICAgIHRva2VuSW5BZGRyZXNzLFxuICAgICAgdG9rZW5PdXRBZGRyZXNzLFxuICAgICAgdHlwZSxcbiAgICAgIGNoYWluSWQsXG4gICAgICBhbW91bnQsXG4gICAgICByb3V0ZVN0cmluZ1xuICAgIClcblxuICAgIHJldHVybiB7XG4gICAgICBzdGF0dXNDb2RlOiAyMDAsXG4gICAgICBib2R5OiByZXN1bHQsXG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBsb2dSb3V0ZU1ldHJpY3MoXG4gICAgbG9nOiBMb2dnZXIsXG4gICAgbWV0cmljOiBJTWV0cmljLFxuICAgIGN1cnJlbmN5SW46IEN1cnJlbmN5LFxuICAgIGN1cnJlbmN5T3V0OiBDdXJyZW5jeSxcbiAgICB0b2tlbkluQWRkcmVzczogc3RyaW5nLFxuICAgIHRva2VuT3V0QWRkcmVzczogc3RyaW5nLFxuICAgIHRyYWRlVHlwZTogJ2V4YWN0SW4nIHwgJ2V4YWN0T3V0JyxcbiAgICBjaGFpbklkOiBDaGFpbklkLFxuICAgIGFtb3VudDogQ3VycmVuY3lBbW91bnQ8Q3VycmVuY3k+LFxuICAgIHJvdXRlU3RyaW5nOiBzdHJpbmdcbiAgKTogdm9pZCB7XG4gICAgY29uc3QgdHJhZGluZ1BhaXIgPSBgJHtjdXJyZW5jeUluLnN5bWJvbH0vJHtjdXJyZW5jeU91dC5zeW1ib2x9YFxuICAgIGNvbnN0IHRyYWRlVHlwZUVudW1WYWx1ZSA9IHRyYWRlVHlwZSA9PSAnZXhhY3RJbicgPyBUcmFkZVR5cGUuRVhBQ1RfSU5QVVQgOiBUcmFkZVR5cGUuRVhBQ1RfT1VUUFVUXG5cbiAgICBpZiAoUEFJUlNfVE9fVFJBQ0suZ2V0KGNoYWluSWQpPy5nZXQodHJhZGVUeXBlRW51bVZhbHVlKT8uaW5jbHVkZXModHJhZGluZ1BhaXIpKSB7XG4gICAgICBtZXRyaWMucHV0TWV0cmljKFxuICAgICAgICBgR0VUX1FVT1RFX0FNT1VOVF8ke3RyYWRpbmdQYWlyfV8ke3RyYWRlVHlwZS50b1VwcGVyQ2FzZSgpfV9DSEFJTl8ke2NoYWluSWR9YCxcbiAgICAgICAgTnVtYmVyKGFtb3VudC50b0V4YWN0KCkpLFxuICAgICAgICBNZXRyaWNMb2dnZXJVbml0Lk5vbmVcbiAgICAgIClcbiAgICAgIC8vIENyZWF0ZSBhIGhhc2hjb2RlIGZyb20gdGhlIHJvdXRlU3RyaW5nLCB0aGlzIHdpbGwgaW5kaWNhdGUgdGhhdCBhIGRpZmZlcmVudCByb3V0ZSBpcyBiZWluZyB1c2VkXG4gICAgICAvLyBoYXNoY29kZSBmdW5jdGlvbiBjb3BpZWQgZnJvbTogaHR0cHM6Ly9naXN0LmdpdGh1Yi5jb20vaHlhbWFtb3RvL2ZkNDM1NTA1ZDI5ZWJmYTNkOTcxNmZkMmJlOGQ0MmYwP3Blcm1hbGlua19jb21tZW50X2lkPTQyNjE3MjgjZ2lzdGNvbW1lbnQtNDI2MTcyOFxuICAgICAgY29uc3Qgcm91dGVTdHJpbmdIYXNoID0gTWF0aC5hYnMoXG4gICAgICAgIHJvdXRlU3RyaW5nLnNwbGl0KCcnKS5yZWR1Y2UoKHMsIGMpID0+IChNYXRoLmltdWwoMzEsIHMpICsgYy5jaGFyQ29kZUF0KDApKSB8IDAsIDApXG4gICAgICApXG4gICAgICAvLyBMb2cgdGhlIGNob3NlIHJvdXRlXG4gICAgICBsb2cuaW5mbyhcbiAgICAgICAge1xuICAgICAgICAgIHRyYWRpbmdQYWlyLFxuICAgICAgICAgIHRva2VuSW5BZGRyZXNzLFxuICAgICAgICAgIHRva2VuT3V0QWRkcmVzcyxcbiAgICAgICAgICB0cmFkZVR5cGUsXG4gICAgICAgICAgYW1vdW50OiBhbW91bnQudG9FeGFjdCgpLFxuICAgICAgICAgIHJvdXRlU3RyaW5nLFxuICAgICAgICAgIHJvdXRlU3RyaW5nSGFzaCxcbiAgICAgICAgICBjaGFpbklkLFxuICAgICAgICB9LFxuICAgICAgICBgVHJhY2tlZCBSb3V0ZSBmb3IgcGFpciBbJHt0cmFkaW5nUGFpcn0vJHt0cmFkZVR5cGUudG9VcHBlckNhc2UoKX1dIG9uIGNoYWluIFske2NoYWluSWR9XSB3aXRoIHJvdXRlIGhhc2ggWyR7cm91dGVTdHJpbmdIYXNofV0gZm9yIGFtb3VudCBbJHthbW91bnQudG9FeGFjdCgpfV1gXG4gICAgICApXG4gICAgfVxuICB9XG5cbiAgcHJvdGVjdGVkIHJlcXVlc3RCb2R5U2NoZW1hKCk6IEpvaS5PYmplY3RTY2hlbWEgfCBudWxsIHtcbiAgICByZXR1cm4gbnVsbFxuICB9XG5cbiAgcHJvdGVjdGVkIHJlcXVlc3RRdWVyeVBhcmFtc1NjaGVtYSgpOiBKb2kuT2JqZWN0U2NoZW1hIHwgbnVsbCB7XG4gICAgcmV0dXJuIFF1b3RlUXVlcnlQYXJhbXNKb2lcbiAgfVxuXG4gIHByb3RlY3RlZCByZXNwb25zZUJvZHlTY2hlbWEoKTogSm9pLk9iamVjdFNjaGVtYSB8IG51bGwge1xuICAgIHJldHVybiBRdW90ZVJlc3BvbnNlU2NoZW1hSm9pXG4gIH1cbn1cbiJdfQ==