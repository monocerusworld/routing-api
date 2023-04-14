import { Protocol } from '@uniswap/router-sdk';
import { CurrencyAmount, Fraction } from '@uniswap/sdk-core';
import { MetricLoggerUnit, routeAmountsToString, SwapToRatioStatus, SwapType, } from '@tartz-one/smart-order-router';
import { Position } from '@uniswap/v3-sdk';
import JSBI from 'jsbi';
import { APIGLambdaHandler } from '../handler';
import { DEFAULT_ROUTING_CONFIG_BY_CHAIN, parseDeadline, parseSlippageTolerance, tokenStringToCurrency, } from '../shared';
import { QuoteToRatioQueryParamsJoi, QuotetoRatioResponseSchemaJoi, } from './schema/quote-to-ratio-schema';
export class QuoteToRatioHandler extends APIGLambdaHandler {
    async handleRequest(params) {
        const { requestQueryParams: { token0Address, token0ChainId, token1Address, token1ChainId, token0Balance: token0BalanceRaw, token1Balance: token1BalanceRaw, tickLower, tickUpper, feeAmount, recipient, slippageTolerance, deadline, minSplits, ratioErrorTolerance, maxIterations, addLiquidityRecipient, addLiquidityTokenId, }, requestInjected: { router, log, id: quoteId, chainId, tokenProvider, tokenListProvider, v3PoolProvider, v2PoolProvider, metric, }, } = params;
        // Parse user provided token address/symbol to Currency object.
        const before = Date.now();
        const type = 'exactIn';
        const token0 = await tokenStringToCurrency(tokenListProvider, tokenProvider, token0Address, token0ChainId, log);
        const token1 = await tokenStringToCurrency(tokenListProvider, tokenProvider, token1Address, token1ChainId, log);
        metric.putMetric('Token01StrToToken', Date.now() - before, MetricLoggerUnit.Milliseconds);
        if (!token0) {
            return {
                statusCode: 400,
                errorCode: 'TOKEN_0_INVALID',
                detail: `Could not find token with address "${token0Address}"`,
            };
        }
        if (!token1) {
            return {
                statusCode: 400,
                errorCode: 'TOKEN_1_INVALID',
                detail: `Could not find token with address "${token1Address}"`,
            };
        }
        if (token0ChainId != token1ChainId) {
            return {
                statusCode: 400,
                errorCode: 'TOKEN_CHAINS_DIFFERENT',
                detail: `Cannot request quotes for tokens on different chains`,
            };
        }
        if (token0.equals(token1)) {
            return {
                statusCode: 400,
                errorCode: 'TOKEN_0_1_SAME',
                detail: `token0 and token1 must be different`,
            };
        }
        if (token0.wrapped.address > token1.wrapped.address) {
            return {
                statusCode: 400,
                errorCode: 'TOKENS_MISORDERED',
                detail: `token0 address must be less than token1 address`,
            };
        }
        if (!!addLiquidityTokenId && !!addLiquidityRecipient) {
            return {
                statusCode: 400,
                errorCode: 'TOO_MANY_POSITION_OPTIONS',
                detail: `addLiquidityTokenId and addLiquidityRecipient are mutually exclusive. Must only provide one.`,
            };
        }
        if (!this.validTick(tickLower, feeAmount) || !this.validTick(tickUpper, feeAmount)) {
            return {
                statusCode: 400,
                errorCode: 'INVALID_TICK_SPACING',
                detail: `tickLower and tickUpper must comply with the tick spacing of the target pool`,
            };
        }
        const routingConfig = {
            ...DEFAULT_ROUTING_CONFIG_BY_CHAIN(chainId),
            ...(minSplits ? { minSplits } : {}),
        };
        let addLiquidityOptions;
        if (addLiquidityTokenId) {
            addLiquidityOptions = { tokenId: addLiquidityTokenId };
        }
        else if (addLiquidityRecipient) {
            addLiquidityOptions = { recipient: addLiquidityRecipient };
        }
        else {
            return {
                statusCode: 400,
                errorCode: 'UNSPECIFIED_POSITION_OPTIONS',
                detail: `Either addLiquidityTokenId must be provided for existing positions or addLiquidityRecipient for new positions`,
            };
        }
        let swapAndAddOptions = undefined;
        if (slippageTolerance && deadline && recipient) {
            swapAndAddOptions = {
                swapOptions: {
                    type: SwapType.SWAP_ROUTER_02,
                    deadline: parseDeadline(deadline),
                    recipient: recipient,
                    slippageTolerance: parseSlippageTolerance(slippageTolerance),
                },
                addLiquidityOptions,
            };
        }
        const ratioErrorToleranceFraction = new Fraction(Math.round(parseFloat(ratioErrorTolerance.toString()) * 100), 10000);
        const token0Balance = CurrencyAmount.fromRawAmount(token0, JSBI.BigInt(token0BalanceRaw));
        const token1Balance = CurrencyAmount.fromRawAmount(token1, JSBI.BigInt(token1BalanceRaw));
        log.info({
            token0: token0.symbol,
            token1: token1.symbol,
            chainId,
            token0Balance: token0Balance.quotient.toString(),
            token1Balance: token1Balance.quotient.toString(),
            tickLower,
            tickUpper,
            feeAmount,
            maxIterations,
            ratioErrorTolerance: ratioErrorToleranceFraction.toFixed(4),
            routingConfig: routingConfig,
        }, `Swap To Ratio Parameters`);
        const poolAccessor = await v3PoolProvider.getPools([[token0.wrapped, token1.wrapped, feeAmount]]);
        const pool = poolAccessor.getPool(token0.wrapped, token1.wrapped, feeAmount);
        if (!pool) {
            log.error(`Could not find pool.`, {
                token0,
                token1,
                feeAmount,
            });
            return { statusCode: 400, errorCode: 'POOL_NOT_FOUND' };
        }
        const position = new Position({
            pool,
            tickLower,
            tickUpper,
            liquidity: 1,
        });
        if (this.noSwapNeededForRangeOrder(position, token0Balance, token1Balance)) {
            return { statusCode: 400, errorCode: 'NO_SWAP_NEEDED', detail: 'No swap needed for range order' };
        }
        const swapRoute = await router.routeToRatio(token0Balance, token1Balance, position, {
            ratioErrorTolerance: ratioErrorToleranceFraction,
            maxIterations,
        }, swapAndAddOptions, routingConfig);
        if (swapRoute.status == SwapToRatioStatus.NO_ROUTE_FOUND) {
            log.info({
                token0: token0.symbol,
                token1: token1.symbol,
                token0Balance: token0Balance.quotient.toString(),
                token1Balance: token1Balance.quotient.toString(),
            }, `No route found. 404`);
            return {
                statusCode: 404,
                errorCode: 'NO_ROUTE',
                detail: 'No route found',
            };
        }
        if (swapRoute.status == SwapToRatioStatus.NO_SWAP_NEEDED) {
            log.info({
                token0: token0.symbol,
                token1: token1.symbol,
                token0Balance: token0Balance.quotient.toString(),
                token1Balance: token1Balance.quotient.toString(),
            }, `No swap needed found. 404`);
            return {
                statusCode: 400,
                errorCode: 'NO_SWAP_NEEDED',
                detail: 'No swap needed',
            };
        }
        const { quote, quoteGasAdjusted, route, optimalRatio, postSwapTargetPool, trade, estimatedGasUsed, estimatedGasUsedQuoteToken, estimatedGasUsedUSD, gasPriceWei, methodParameters, blockNumber, } = swapRoute.result;
        const routeResponse = [];
        for (const subRoute of route) {
            const { amount, quote, tokenPath } = subRoute;
            if (subRoute.protocol == Protocol.V3) {
                const pools = subRoute.route.pools;
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
                routeResponse.push(curRoute);
            }
            else if (subRoute.protocol == Protocol.V2) {
                const pools = subRoute.route.pairs;
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
                routeResponse.push(curRoute);
            }
        }
        const tokenIn = trade.inputAmount.currency.wrapped;
        const tokenOut = trade.outputAmount.currency.wrapped;
        const zeroForOne = tokenIn.wrapped.address === token0.wrapped.address;
        let token0BalanceUpdated;
        let token1BalanceUpdated;
        let optimalRatioAdjusted;
        let optimalRatioDecimal;
        let newRatioDecimal;
        if (zeroForOne) {
            token0BalanceUpdated = token0Balance.subtract(trade.inputAmount);
            token1BalanceUpdated = token1Balance.add(trade.outputAmount);
            optimalRatioAdjusted = optimalRatio;
            optimalRatioDecimal = optimalRatioAdjusted.toFixed(token0.wrapped.decimals);
            newRatioDecimal = new Fraction(token0BalanceUpdated.quotient.toString(), token1BalanceUpdated.quotient.toString()).toFixed(token0.wrapped.decimals);
        }
        else {
            token0BalanceUpdated = token0Balance.add(trade.outputAmount);
            token1BalanceUpdated = token1Balance.subtract(trade.inputAmount);
            optimalRatioAdjusted = optimalRatio.invert();
            optimalRatioDecimal =
                optimalRatioAdjusted.denominator.toString() == '0'
                    ? `0.${'0'.repeat(token1.wrapped.decimals)}`
                    : optimalRatioAdjusted.toFixed(token0.wrapped.decimals);
            newRatioDecimal =
                token1BalanceUpdated.numerator.toString() == '0'
                    ? `0.${'0'.repeat(token1.wrapped.decimals)}`
                    : new Fraction(token0BalanceUpdated.quotient.toString(), token1BalanceUpdated.quotient.toString()).toFixed(token0.wrapped.decimals);
        }
        const postSwapTargetPoolObject = {
            address: v3PoolProvider.getPoolAddress(postSwapTargetPool.token0, postSwapTargetPool.token1, postSwapTargetPool.fee).poolAddress,
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
            fee: postSwapTargetPool.fee.toString(),
            liquidity: postSwapTargetPool.liquidity.toString(),
            sqrtRatioX96: postSwapTargetPool.sqrtRatioX96.toString(),
            tickCurrent: postSwapTargetPool.tickCurrent.toString(),
        };
        const result = {
            methodParameters,
            blockNumber: blockNumber.toString(),
            amount: trade.inputAmount.quotient.toString(),
            amountDecimals: trade.inputAmount.toFixed(trade.inputAmount.currency.decimals),
            quote: quote.quotient.toString(),
            tokenInAddress: trade.inputAmount.currency.wrapped.address,
            tokenOutAddress: trade.outputAmount.currency.wrapped.address,
            token0BalanceUpdated: token0BalanceUpdated.quotient.toString(),
            token1BalanceUpdated: token1BalanceUpdated.quotient.toString(),
            optimalRatio: optimalRatioDecimal.toString(),
            optimalRatioFraction: {
                numerator: optimalRatioAdjusted.numerator.toString(),
                denominator: optimalRatioAdjusted.denominator.toString(),
            },
            newRatio: newRatioDecimal.toString(),
            newRatioFraction: {
                numerator: token0BalanceUpdated.quotient.toString(),
                denominator: token1BalanceUpdated.quotient.toString(),
            },
            postSwapTargetPool: postSwapTargetPoolObject,
            quoteDecimals: quote.toExact(),
            quoteGasAdjusted: quoteGasAdjusted.quotient.toString(),
            quoteGasAdjustedDecimals: quoteGasAdjusted.toExact(),
            gasUseEstimateQuote: estimatedGasUsedQuoteToken.quotient.toString(),
            gasUseEstimateQuoteDecimals: estimatedGasUsedQuoteToken.toExact(),
            gasUseEstimate: estimatedGasUsed.toString(),
            gasUseEstimateUSD: estimatedGasUsedUSD.toExact(),
            gasPriceWei: gasPriceWei.toString(),
            route: routeResponse,
            routeString: routeAmountsToString(route),
            quoteId,
            simulationStatus: 'UNATTEMPTED',
        };
        return {
            statusCode: 200,
            body: result,
        };
    }
    requestBodySchema() {
        return null;
    }
    requestQueryParamsSchema() {
        return QuoteToRatioQueryParamsJoi;
    }
    responseBodySchema() {
        return QuotetoRatioResponseSchemaJoi;
    }
    noSwapNeededForRangeOrder(position, token0Balance, token1Balance) {
        if (position.pool.tickCurrent < position.tickLower) {
            return token1Balance.equalTo(0) && token0Balance.greaterThan(0);
        }
        else if (position.pool.tickCurrent > position.tickUpper) {
            return token0Balance.equalTo(0) && token1Balance.greaterThan(1);
        }
        else {
            return false;
        }
    }
    validTick(tick, feeAmount) {
        const TICK_SPACINGS = {
            500: 10,
            3000: 60,
            10000: 100,
        };
        let validTickSpacing = true;
        if (TICK_SPACINGS[feeAmount] != undefined) {
            validTickSpacing = tick % TICK_SPACINGS[feeAmount] === 0;
        }
        return validTickSpacing;
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicXVvdGUtdG8tcmF0aW8uanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9saWIvaGFuZGxlcnMvcXVvdGUtdG8tcmF0aW8vcXVvdGUtdG8tcmF0aW8udHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQ0EsT0FBTyxFQUFnQyxRQUFRLEVBQUUsTUFBTSxxQkFBcUIsQ0FBQTtBQUM1RSxPQUFPLEVBQVksY0FBYyxFQUFFLFFBQVEsRUFBRSxNQUFNLG1CQUFtQixDQUFBO0FBQ3RFLE9BQU8sRUFHTCxnQkFBZ0IsRUFDaEIsb0JBQW9CLEVBR3BCLGlCQUFpQixFQUNqQixRQUFRLEdBQ1QsTUFBTSwrQkFBK0IsQ0FBQTtBQUN0QyxPQUFPLEVBQUUsUUFBUSxFQUFFLE1BQU0saUJBQWlCLENBQUE7QUFDMUMsT0FBTyxJQUFJLE1BQU0sTUFBTSxDQUFBO0FBQ3ZCLE9BQU8sRUFBRSxpQkFBaUIsRUFBZ0QsTUFBTSxZQUFZLENBQUE7QUFHNUYsT0FBTyxFQUNMLCtCQUErQixFQUMvQixhQUFhLEVBQ2Isc0JBQXNCLEVBQ3RCLHFCQUFxQixHQUN0QixNQUFNLFdBQVcsQ0FBQTtBQUNsQixPQUFPLEVBRUwsMEJBQTBCLEVBRTFCLDZCQUE2QixHQUM5QixNQUFNLGdDQUFnQyxDQUFBO0FBRXZDLE1BQU0sT0FBTyxtQkFBb0IsU0FBUSxpQkFNeEM7SUFDUSxLQUFLLENBQUMsYUFBYSxDQUN4QixNQUtDO1FBRUQsTUFBTSxFQUNKLGtCQUFrQixFQUFFLEVBQ2xCLGFBQWEsRUFDYixhQUFhLEVBQ2IsYUFBYSxFQUNiLGFBQWEsRUFDYixhQUFhLEVBQUUsZ0JBQWdCLEVBQy9CLGFBQWEsRUFBRSxnQkFBZ0IsRUFDL0IsU0FBUyxFQUNULFNBQVMsRUFDVCxTQUFTLEVBQ1QsU0FBUyxFQUNULGlCQUFpQixFQUNqQixRQUFRLEVBQ1IsU0FBUyxFQUNULG1CQUFtQixFQUNuQixhQUFhLEVBQ2IscUJBQXFCLEVBQ3JCLG1CQUFtQixHQUNwQixFQUNELGVB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QUNGIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IEpvaSBmcm9tICdAaGFwaS9qb2knXG5pbXBvcnQgeyBDb25kZW5zZWRBZGRMaXF1aWRpdHlPcHRpb25zLCBQcm90b2NvbCB9IGZyb20gJ0B1bmlzd2FwL3JvdXRlci1zZGsnXG5pbXBvcnQgeyBDdXJyZW5jeSwgQ3VycmVuY3lBbW91bnQsIEZyYWN0aW9uIH0gZnJvbSAnQHVuaXN3YXAvc2RrLWNvcmUnXG5pbXBvcnQge1xuICBBbHBoYVJvdXRlckNvbmZpZyxcbiAgSVN3YXBUb1JhdGlvLFxuICBNZXRyaWNMb2dnZXJVbml0LFxuICByb3V0ZUFtb3VudHNUb1N0cmluZyxcbiAgU3dhcEFuZEFkZENvbmZpZyxcbiAgU3dhcEFuZEFkZE9wdGlvbnMsXG4gIFN3YXBUb1JhdGlvU3RhdHVzLFxuICBTd2FwVHlwZSxcbn0gZnJvbSAnQHRhcnR6LW9uZS9zbWFydC1vcmRlci1yb3V0ZXInXG5pbXBvcnQgeyBQb3NpdGlvbiB9IGZyb20gJ0B1bmlzd2FwL3YzLXNkaydcbmltcG9ydCBKU0JJIGZyb20gJ2pzYmknXG5pbXBvcnQgeyBBUElHTGFtYmRhSGFuZGxlciwgRXJyb3JSZXNwb25zZSwgSGFuZGxlUmVxdWVzdFBhcmFtcywgUmVzcG9uc2UgfSBmcm9tICcuLi9oYW5kbGVyJ1xuaW1wb3J0IHsgQ29udGFpbmVySW5qZWN0ZWQsIFJlcXVlc3RJbmplY3RlZCB9IGZyb20gJy4uL2luamVjdG9yLXNvcidcbmltcG9ydCB7IFYyUG9vbEluUm91dGUsIFYzUG9vbEluUm91dGUgfSBmcm9tICcuLi9zY2hlbWEnXG5pbXBvcnQge1xuICBERUZBVUxUX1JPVVRJTkdfQ09ORklHX0JZX0NIQUlOLFxuICBwYXJzZURlYWRsaW5lLFxuICBwYXJzZVNsaXBwYWdlVG9sZXJhbmNlLFxuICB0b2tlblN0cmluZ1RvQ3VycmVuY3ksXG59IGZyb20gJy4uL3NoYXJlZCdcbmltcG9ydCB7XG4gIFF1b3RlVG9SYXRpb1F1ZXJ5UGFyYW1zLFxuICBRdW90ZVRvUmF0aW9RdWVyeVBhcmFtc0pvaSxcbiAgUXVvdGVUb1JhdGlvUmVzcG9uc2UsXG4gIFF1b3RldG9SYXRpb1Jlc3BvbnNlU2NoZW1hSm9pLFxufSBmcm9tICcuL3NjaGVtYS9xdW90ZS10by1yYXRpby1zY2hlbWEnXG5cbmV4cG9ydCBjbGFzcyBRdW90ZVRvUmF0aW9IYW5kbGVyIGV4dGVuZHMgQVBJR0xhbWJkYUhhbmRsZXI8XG4gIENvbnRhaW5lckluamVjdGVkLFxuICBSZXF1ZXN0SW5qZWN0ZWQ8SVN3YXBUb1JhdGlvPEFscGhhUm91dGVyQ29uZmlnLCBTd2FwQW5kQWRkQ29uZmlnPj4sXG4gIHZvaWQsXG4gIFF1b3RlVG9SYXRpb1F1ZXJ5UGFyYW1zLFxuICBRdW90ZVRvUmF0aW9SZXNwb25zZVxuPiB7XG4gIHB1YmxpYyBhc3luYyBoYW5kbGVSZXF1ZXN0KFxuICAgIHBhcmFtczogSGFuZGxlUmVxdWVzdFBhcmFtczxcbiAgICAgIENvbnRhaW5lckluamVjdGVkLFxuICAgICAgUmVxdWVzdEluamVjdGVkPElTd2FwVG9SYXRpbzxBbHBoYVJvdXRlckNvbmZpZywgU3dhcEFuZEFkZENvbmZpZz4+LFxuICAgICAgdm9pZCxcbiAgICAgIFF1b3RlVG9SYXRpb1F1ZXJ5UGFyYW1zXG4gICAgPlxuICApOiBQcm9taXNlPFJlc3BvbnNlPFF1b3RlVG9SYXRpb1Jlc3BvbnNlPiB8IEVycm9yUmVzcG9uc2U+IHtcbiAgICBjb25zdCB7XG4gICAgICByZXF1ZXN0UXVlcnlQYXJhbXM6IHtcbiAgICAgICAgdG9rZW4wQWRkcmVzcyxcbiAgICAgICAgdG9rZW4wQ2hhaW5JZCxcbiAgICAgICAgdG9rZW4xQWRkcmVzcyxcbiAgICAgICAgdG9rZW4xQ2hhaW5JZCxcbiAgICAgICAgdG9rZW4wQmFsYW5jZTogdG9rZW4wQmFsYW5jZVJhdyxcbiAgICAgICAgdG9rZW4xQmFsYW5jZTogdG9rZW4xQmFsYW5jZVJhdyxcbiAgICAgICAgdGlja0xvd2VyLFxuICAgICAgICB0aWNrVXBwZXIsXG4gICAgICAgIGZlZUFtb3VudCxcbiAgICAgICAgcmVjaXBpZW50LFxuICAgICAgICBzbGlwcGFnZVRvbGVyYW5jZSxcbiAgICAgICAgZGVhZGxpbmUsXG4gICAgICAgIG1pblNwbGl0cyxcbiAgICAgICAgcmF0aW9FcnJvclRvbGVyYW5jZSxcbiAgICAgICAgbWF4SXRlcmF0aW9ucyxcbiAgICAgICAgYWRkTGlxdWlkaXR5UmVjaXBpZW50LFxuICAgICAgICBhZGRMaXF1aWRpdHlUb2tlbklkLFxuICAgICAgfSxcbiAgICAgIHJlcXVlc3RJbmplY3RlZDoge1xuICAgICAgICByb3V0ZXIsXG4gICAgICAgIGxvZyxcbiAgICAgICAgaWQ6IHF1b3RlSWQsXG4gICAgICAgIGNoYWluSWQsXG4gICAgICAgIHRva2VuUHJvdmlkZXIsXG4gICAgICAgIHRva2VuTGlzdFByb3ZpZGVyLFxuICAgICAgICB2M1Bvb2xQcm92aWRlcixcbiAgICAgICAgdjJQb29sUHJvdmlkZXIsXG4gICAgICAgIG1ldHJpYyxcbiAgICAgIH0sXG4gICAgfSA9IHBhcmFtc1xuXG4gICAgLy8gUGFyc2UgdXNlciBwcm92aWRlZCB0b2tlbiBhZGRyZXNzL3N5bWJvbCB0byBDdXJyZW5jeSBvYmplY3QuXG4gICAgY29uc3QgYmVmb3JlID0gRGF0ZS5ub3coKVxuICAgIGNvbnN0IHR5cGUgPSAnZXhhY3RJbidcbiAgICBjb25zdCB0b2tlbjAgPSBhd2FpdCB0b2tlblN0cmluZ1RvQ3VycmVuY3kodG9rZW5MaXN0UHJvdmlkZXIsIHRva2VuUHJvdmlkZXIsIHRva2VuMEFkZHJlc3MsIHRva2VuMENoYWluSWQsIGxvZylcbiAgICBjb25zdCB0b2tlbjEgPSBhd2FpdCB0b2tlblN0cmluZ1RvQ3VycmVuY3kodG9rZW5MaXN0UHJvdmlkZXIsIHRva2VuUHJvdmlkZXIsIHRva2VuMUFkZHJlc3MsIHRva2VuMUNoYWluSWQsIGxvZylcblxuICAgIG1ldHJpYy5wdXRNZXRyaWMoJ1Rva2VuMDFTdHJUb1Rva2VuJywgRGF0ZS5ub3coKSAtIGJlZm9yZSwgTWV0cmljTG9nZ2VyVW5pdC5NaWxsaXNlY29uZHMpXG5cbiAgICBpZiAoIXRva2VuMCkge1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgc3RhdHVzQ29kZTogNDAwLFxuICAgICAgICBlcnJvckNvZGU6ICdUT0tFTl8wX0lOVkFMSUQnLFxuICAgICAgICBkZXRhaWw6IGBDb3VsZCBub3QgZmluZCB0b2tlbiB3aXRoIGFkZHJlc3MgXCIke3Rva2VuMEFkZHJlc3N9XCJgLFxuICAgICAgfVxuICAgIH1cblxuICAgIGlmICghdG9rZW4xKSB7XG4gICAgICByZXR1cm4ge1xuICAgICAgICBzdGF0dXNDb2RlOiA0MDAsXG4gICAgICAgIGVycm9yQ29kZTogJ1RPS0VOXzFfSU5WQUxJRCcsXG4gICAgICAgIGRldGFpbDogYENvdWxkIG5vdCBmaW5kIHRva2VuIHdpdGggYWRkcmVzcyBcIiR7dG9rZW4xQWRkcmVzc31cImAsXG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKHRva2VuMENoYWluSWQgIT0gdG9rZW4xQ2hhaW5JZCkge1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgc3RhdHVzQ29kZTogNDAwLFxuICAgICAgICBlcnJvckNvZGU6ICdUT0tFTl9DSEFJTlNfRElGRkVSRU5UJyxcbiAgICAgICAgZGV0YWlsOiBgQ2Fubm90IHJlcXVlc3QgcXVvdGVzIGZvciB0b2tlbnMgb24gZGlmZmVyZW50IGNoYWluc2AsXG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKHRva2VuMC5lcXVhbHModG9rZW4xKSkge1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgc3RhdHVzQ29kZTogNDAwLFxuICAgICAgICBlcnJvckNvZGU6ICdUT0tFTl8wXzFfU0FNRScsXG4gICAgICAgIGRldGFpbDogYHRva2VuMCBhbmQgdG9rZW4xIG11c3QgYmUgZGlmZmVyZW50YCxcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAodG9rZW4wLndyYXBwZWQuYWRkcmVzcyA+IHRva2VuMS53cmFwcGVkLmFkZHJlc3MpIHtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIHN0YXR1c0NvZGU6IDQwMCxcbiAgICAgICAgZXJyb3JDb2RlOiAnVE9LRU5TX01JU09SREVSRUQnLFxuICAgICAgICBkZXRhaWw6IGB0b2tlbjAgYWRkcmVzcyBtdXN0IGJlIGxlc3MgdGhhbiB0b2tlbjEgYWRkcmVzc2AsXG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKCEhYWRkTGlxdWlkaXR5VG9rZW5JZCAmJiAhIWFkZExpcXVpZGl0eVJlY2lwaWVudCkge1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgc3RhdHVzQ29kZTogNDAwLFxuICAgICAgICBlcnJvckNvZGU6ICdUT09fTUFOWV9QT1NJVElPTl9PUFRJT05TJyxcbiAgICAgICAgZGV0YWlsOiBgYWRkTGlxdWlkaXR5VG9rZW5JZCBhbmQgYWRkTGlxdWlkaXR5UmVjaXBpZW50IGFyZSBtdXR1YWxseSBleGNsdXNpdmUuIE11c3Qgb25seSBwcm92aWRlIG9uZS5gLFxuICAgICAgfVxuICAgIH1cblxuICAgIGlmICghdGhpcy52YWxpZFRpY2sodGlja0xvd2VyLCBmZWVBbW91bnQpIHx8ICF0aGlzLnZhbGlkVGljayh0aWNrVXBwZXIsIGZlZUFtb3VudCkpIHtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIHN0YXR1c0NvZGU6IDQwMCxcbiAgICAgICAgZXJyb3JDb2RlOiAnSU5WQUxJRF9USUNLX1NQQUNJTkcnLFxuICAgICAgICBkZXRhaWw6IGB0aWNrTG93ZXIgYW5kIHRpY2tVcHBlciBtdXN0IGNvbXBseSB3aXRoIHRoZSB0aWNrIHNwYWNpbmcgb2YgdGhlIHRhcmdldCBwb29sYCxcbiAgICAgIH1cbiAgICB9XG5cbiAgICBjb25zdCByb3V0aW5nQ29uZmlnOiBBbHBoYVJvdXRlckNvbmZpZyA9IHtcbiAgICAgIC4uLkRFRkFVTFRfUk9VVElOR19DT05GSUdfQllfQ0hBSU4oY2hhaW5JZCksXG4gICAgICAuLi4obWluU3BsaXRzID8geyBtaW5TcGxpdHMgfSA6IHt9KSxcbiAgICB9XG5cbiAgICBsZXQgYWRkTGlxdWlkaXR5T3B0aW9uczogQ29uZGVuc2VkQWRkTGlxdWlkaXR5T3B0aW9uc1xuICAgIGlmIChhZGRMaXF1aWRpdHlUb2tlbklkKSB7XG4gICAgICBhZGRMaXF1aWRpdHlPcHRpb25zID0geyB0b2tlbklkOiBhZGRMaXF1aWRpdHlUb2tlbklkIH1cbiAgICB9IGVsc2UgaWYgKGFkZExpcXVpZGl0eVJlY2lwaWVudCkge1xuICAgICAgYWRkTGlxdWlkaXR5T3B0aW9ucyA9IHsgcmVjaXBpZW50OiBhZGRMaXF1aWRpdHlSZWNpcGllbnQgfVxuICAgIH0gZWxzZSB7XG4gICAgICByZXR1cm4ge1xuICAgICAgICBzdGF0dXNDb2RlOiA0MDAsXG4gICAgICAgIGVycm9yQ29kZTogJ1VOU1BFQ0lGSUVEX1BPU0lUSU9OX09QVElPTlMnLFxuICAgICAgICBkZXRhaWw6IGBFaXRoZXIgYWRkTGlxdWlkaXR5VG9rZW5JZCBtdXN0IGJlIHByb3ZpZGVkIGZvciBleGlzdGluZyBwb3NpdGlvbnMgb3IgYWRkTGlxdWlkaXR5UmVjaXBpZW50IGZvciBuZXcgcG9zaXRpb25zYCxcbiAgICAgIH1cbiAgICB9XG5cbiAgICBsZXQgc3dhcEFuZEFkZE9wdGlvbnM6IFN3YXBBbmRBZGRPcHRpb25zIHwgdW5kZWZpbmVkID0gdW5kZWZpbmVkXG4gICAgaWYgKHNsaXBwYWdlVG9sZXJhbmNlICYmIGRlYWRsaW5lICYmIHJlY2lwaWVudCkge1xuICAgICAgc3dhcEFuZEFkZE9wdGlvbnMgPSB7XG4gICAgICAgIHN3YXBPcHRpb25zOiB7XG4gICAgICAgICAgdHlwZTogU3dhcFR5cGUuU1dBUF9ST1VURVJfMDIsXG4gICAgICAgICAgZGVhZGxpbmU6IHBhcnNlRGVhZGxpbmUoZGVhZGxpbmUpLFxuICAgICAgICAgIHJlY2lwaWVudDogcmVjaXBpZW50LFxuICAgICAgICAgIHNsaXBwYWdlVG9sZXJhbmNlOiBwYXJzZVNsaXBwYWdlVG9sZXJhbmNlKHNsaXBwYWdlVG9sZXJhbmNlKSxcbiAgICAgICAgfSxcbiAgICAgICAgYWRkTGlxdWlkaXR5T3B0aW9ucyxcbiAgICAgIH1cbiAgICB9XG5cbiAgICBjb25zdCByYXRpb0Vycm9yVG9sZXJhbmNlRnJhY3Rpb24gPSBuZXcgRnJhY3Rpb24oXG4gICAgICBNYXRoLnJvdW5kKHBhcnNlRmxvYXQocmF0aW9FcnJvclRvbGVyYW5jZS50b1N0cmluZygpKSAqIDEwMCksXG4gICAgICAxMF8wMDBcbiAgICApXG5cbiAgICBjb25zdCB0b2tlbjBCYWxhbmNlID0gQ3VycmVuY3lBbW91bnQuZnJvbVJhd0Ftb3VudCh0b2tlbjAsIEpTQkkuQmlnSW50KHRva2VuMEJhbGFuY2VSYXcpKVxuICAgIGNvbnN0IHRva2VuMUJhbGFuY2UgPSBDdXJyZW5jeUFtb3VudC5mcm9tUmF3QW1vdW50KHRva2VuMSwgSlNCSS5CaWdJbnQodG9rZW4xQmFsYW5jZVJhdykpXG5cbiAgICBsb2cuaW5mbyhcbiAgICAgIHtcbiAgICAgICAgdG9rZW4wOiB0b2tlbjAuc3ltYm9sLFxuICAgICAgICB0b2tlbjE6IHRva2VuMS5zeW1ib2wsXG4gICAgICAgIGNoYWluSWQsXG4gICAgICAgIHRva2VuMEJhbGFuY2U6IHRva2VuMEJhbGFuY2UucXVvdGllbnQudG9TdHJpbmcoKSxcbiAgICAgICAgdG9rZW4xQmFsYW5jZTogdG9rZW4xQmFsYW5jZS5xdW90aWVudC50b1N0cmluZygpLFxuICAgICAgICB0aWNrTG93ZXIsXG4gICAgICAgIHRpY2tVcHBlcixcbiAgICAgICAgZmVlQW1vdW50LFxuICAgICAgICBtYXhJdGVyYXRpb25zLFxuICAgICAgICByYXRpb0Vycm9yVG9sZXJhbmNlOiByYXRpb0Vycm9yVG9sZXJhbmNlRnJhY3Rpb24udG9GaXhlZCg0KSxcbiAgICAgICAgcm91dGluZ0NvbmZpZzogcm91dGluZ0NvbmZpZyxcbiAgICAgIH0sXG4gICAgICBgU3dhcCBUbyBSYXRpbyBQYXJhbWV0ZXJzYFxuICAgIClcblxuICAgIGNvbnN0IHBvb2xBY2Nlc3NvciA9IGF3YWl0IHYzUG9vbFByb3ZpZGVyLmdldFBvb2xzKFtbdG9rZW4wLndyYXBwZWQsIHRva2VuMS53cmFwcGVkLCBmZWVBbW91bnRdXSlcbiAgICBjb25zdCBwb29sID0gcG9vbEFjY2Vzc29yLmdldFBvb2wodG9rZW4wLndyYXBwZWQsIHRva2VuMS53cmFwcGVkLCBmZWVBbW91bnQpXG4gICAgaWYgKCFwb29sKSB7XG4gICAgICBsb2cuZXJyb3IoYENvdWxkIG5vdCBmaW5kIHBvb2wuYCwge1xuICAgICAgICB0b2tlbjAsXG4gICAgICAgIHRva2VuMSxcbiAgICAgICAgZmVlQW1vdW50LFxuICAgICAgfSlcbiAgICAgIHJldHVybiB7IHN0YXR1c0NvZGU6IDQwMCwgZXJyb3JDb2RlOiAnUE9PTF9OT1RfRk9VTkQnIH1cbiAgICB9XG4gICAgY29uc3QgcG9zaXRpb24gPSBuZXcgUG9zaXRpb24oe1xuICAgICAgcG9vbCxcbiAgICAgIHRpY2tMb3dlcixcbiAgICAgIHRpY2tVcHBlcixcbiAgICAgIGxpcXVpZGl0eTogMSxcbiAgICB9KVxuXG4gICAgaWYgKHRoaXMubm9Td2FwTmVlZGVkRm9yUmFuZ2VPcmRlcihwb3NpdGlvbiwgdG9rZW4wQmFsYW5jZSwgdG9rZW4xQmFsYW5jZSkpIHtcbiAgICAgIHJldHVybiB7IHN0YXR1c0NvZGU6IDQwMCwgZXJyb3JDb2RlOiAnTk9fU1dBUF9ORUVERUQnLCBkZXRhaWw6ICdObyBzd2FwIG5lZWRlZCBmb3IgcmFuZ2Ugb3JkZXInIH1cbiAgICB9XG5cbiAgICBjb25zdCBzd2FwUm91dGUgPSBhd2FpdCByb3V0ZXIucm91dGVUb1JhdGlvKFxuICAgICAgdG9rZW4wQmFsYW5jZSxcbiAgICAgIHRva2VuMUJhbGFuY2UsXG4gICAgICBwb3NpdGlvbixcbiAgICAgIHtcbiAgICAgICAgcmF0aW9FcnJvclRvbGVyYW5jZTogcmF0aW9FcnJvclRvbGVyYW5jZUZyYWN0aW9uLFxuICAgICAgICBtYXhJdGVyYXRpb25zLFxuICAgICAgfSxcbiAgICAgIHN3YXBBbmRBZGRPcHRpb25zLFxuICAgICAgcm91dGluZ0NvbmZpZ1xuICAgIClcblxuICAgIGlmIChzd2FwUm91dGUuc3RhdHVzID09IFN3YXBUb1JhdGlvU3RhdHVzLk5PX1JPVVRFX0ZPVU5EKSB7XG4gICAgICBsb2cuaW5mbyhcbiAgICAgICAge1xuICAgICAgICAgIHRva2VuMDogdG9rZW4wLnN5bWJvbCxcbiAgICAgICAgICB0b2tlbjE6IHRva2VuMS5zeW1ib2wsXG4gICAgICAgICAgdG9rZW4wQmFsYW5jZTogdG9rZW4wQmFsYW5jZS5xdW90aWVudC50b1N0cmluZygpLFxuICAgICAgICAgIHRva2VuMUJhbGFuY2U6IHRva2VuMUJhbGFuY2UucXVvdGllbnQudG9TdHJpbmcoKSxcbiAgICAgICAgfSxcbiAgICAgICAgYE5vIHJvdXRlIGZvdW5kLiA0MDRgXG4gICAgICApXG5cbiAgICAgIHJldHVybiB7XG4gICAgICAgIHN0YXR1c0NvZGU6IDQwNCxcbiAgICAgICAgZXJyb3JDb2RlOiAnTk9fUk9VVEUnLFxuICAgICAgICBkZXRhaWw6ICdObyByb3V0ZSBmb3VuZCcsXG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKHN3YXBSb3V0ZS5zdGF0dXMgPT0gU3dhcFRvUmF0aW9TdGF0dXMuTk9fU1dBUF9ORUVERUQpIHtcbiAgICAgIGxvZy5pbmZvKFxuICAgICAgICB7XG4gICAgICAgICAgdG9rZW4wOiB0b2tlbjAuc3ltYm9sLFxuICAgICAgICAgIHRva2VuMTogdG9rZW4xLnN5bWJvbCxcbiAgICAgICAgICB0b2tlbjBCYWxhbmNlOiB0b2tlbjBCYWxhbmNlLnF1b3RpZW50LnRvU3RyaW5nKCksXG4gICAgICAgICAgdG9rZW4xQmFsYW5jZTogdG9rZW4xQmFsYW5jZS5xdW90aWVudC50b1N0cmluZygpLFxuICAgICAgICB9LFxuICAgICAgICBgTm8gc3dhcCBuZWVkZWQgZm91bmQuIDQwNGBcbiAgICAgIClcblxuICAgICAgcmV0dXJuIHtcbiAgICAgICAgc3RhdHVzQ29kZTogNDAwLFxuICAgICAgICBlcnJvckNvZGU6ICdOT19TV0FQX05FRURFRCcsXG4gICAgICAgIGRldGFpbDogJ05vIHN3YXAgbmVlZGVkJyxcbiAgICAgIH1cbiAgICB9XG5cbiAgICBjb25zdCB7XG4gICAgICBxdW90ZSxcbiAgICAgIHF1b3RlR2FzQWRqdXN0ZWQsXG4gICAgICByb3V0ZSxcbiAgICAgIG9wdGltYWxSYXRpbyxcbiAgICAgIHBvc3RTd2FwVGFyZ2V0UG9vbCxcbiAgICAgIHRyYWRlLFxuICAgICAgZXN0aW1hdGVkR2FzVXNlZCxcbiAgICAgIGVzdGltYXRlZEdhc1VzZWRRdW90ZVRva2VuLFxuICAgICAgZXN0aW1hdGVkR2FzVXNlZFVTRCxcbiAgICAgIGdhc1ByaWNlV2VpLFxuICAgICAgbWV0aG9kUGFyYW1ldGVycyxcbiAgICAgIGJsb2NrTnVtYmVyLFxuICAgIH0gPSBzd2FwUm91dGUucmVzdWx0XG5cbiAgICBjb25zdCByb3V0ZVJlc3BvbnNlOiBBcnJheTxWM1Bvb2xJblJvdXRlW10gfCBWMlBvb2xJblJvdXRlW10+ID0gW11cblxuICAgIGZvciAoY29uc3Qgc3ViUm91dGUgb2Ygcm91dGUpIHtcbiAgICAgIGNvbnN0IHsgYW1vdW50LCBxdW90ZSwgdG9rZW5QYXRoIH0gPSBzdWJSb3V0ZVxuXG4gICAgICBpZiAoc3ViUm91dGUucHJvdG9jb2wgPT0gUHJvdG9jb2wuVjMpIHtcbiAgICAgICAgY29uc3QgcG9vbHMgPSBzdWJSb3V0ZS5yb3V0ZS5wb29sc1xuICAgICAgICBjb25zdCBjdXJSb3V0ZTogVjNQb29sSW5Sb3V0ZVtdID0gW11cbiAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBwb29scy5sZW5ndGg7IGkrKykge1xuICAgICAgICAgIGNvbnN0IG5leHRQb29sID0gcG9vbHNbaV1cbiAgICAgICAgICBjb25zdCB0b2tlbkluID0gdG9rZW5QYXRoW2ldXG4gICAgICAgICAgY29uc3QgdG9rZW5PdXQgPSB0b2tlblBhdGhbaSArIDFdXG5cbiAgICAgICAgICBsZXQgZWRnZUFtb3VudEluID0gdW5kZWZpbmVkXG4gICAgICAgICAgaWYgKGkgPT0gMCkge1xuICAgICAgICAgICAgZWRnZUFtb3VudEluID0gdHlwZSA9PSAnZXhhY3RJbicgPyBhbW91bnQucXVvdGllbnQudG9TdHJpbmcoKSA6IHF1b3RlLnF1b3RpZW50LnRvU3RyaW5nKClcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBsZXQgZWRnZUFtb3VudE91dCA9IHVuZGVmaW5lZFxuICAgICAgICAgIGlmIChpID09IHBvb2xzLmxlbmd0aCAtIDEpIHtcbiAgICAgICAgICAgIGVkZ2VBbW91bnRPdXQgPSB0eXBlID09ICdleGFjdEluJyA/IHF1b3RlLnF1b3RpZW50LnRvU3RyaW5nKCkgOiBhbW91bnQucXVvdGllbnQudG9TdHJpbmcoKVxuICAgICAgICAgIH1cblxuICAgICAgICAgIGN1clJvdXRlLnB1c2goe1xuICAgICAgICAgICAgdHlwZTogJ3YzLXBvb2wnLFxuICAgICAgICAgICAgYWRkcmVzczogdjNQb29sUHJvdmlkZXIuZ2V0UG9vbEFkZHJlc3MobmV4dFBvb2wudG9rZW4wLCBuZXh0UG9vbC50b2tlbjEsIG5leHRQb29sLmZlZSkucG9vbEFkZHJlc3MsXG4gICAgICAgICAgICB0b2tlbkluOiB7XG4gICAgICAgICAgICAgIGNoYWluSWQ6IHRva2VuSW4uY2hhaW5JZCxcbiAgICAgICAgICAgICAgZGVjaW1hbHM6IHRva2VuSW4uZGVjaW1hbHMudG9TdHJpbmcoKSxcbiAgICAgICAgICAgICAgYWRkcmVzczogdG9rZW5Jbi5hZGRyZXNzLFxuICAgICAgICAgICAgICBzeW1ib2w6IHRva2VuSW4uc3ltYm9sISxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB0b2tlbk91dDoge1xuICAgICAgICAgICAgICBjaGFpbklkOiB0b2tlbk91dC5jaGFpbklkLFxuICAgICAgICAgICAgICBkZWNpbWFsczogdG9rZW5PdXQuZGVjaW1hbHMudG9TdHJpbmcoKSxcbiAgICAgICAgICAgICAgYWRkcmVzczogdG9rZW5PdXQuYWRkcmVzcyxcbiAgICAgICAgICAgICAgc3ltYm9sOiB0b2tlbk91dC5zeW1ib2whLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIGZlZTogbmV4dFBvb2wuZmVlLnRvU3RyaW5nKCksXG4gICAgICAgICAgICBsaXF1aWRpdHk6IG5leHRQb29sLmxpcXVpZGl0eS50b1N0cmluZygpLFxuICAgICAgICAgICAgc3FydFJhdGlvWDk2OiBuZXh0UG9vbC5zcXJ0UmF0aW9YOTYudG9TdHJpbmcoKSxcbiAgICAgICAgICAgIHRpY2tDdXJyZW50OiBuZXh0UG9vbC50aWNrQ3VycmVudC50b1N0cmluZygpLFxuICAgICAgICAgICAgYW1vdW50SW46IGVkZ2VBbW91bnRJbixcbiAgICAgICAgICAgIGFtb3VudE91dDogZWRnZUFtb3VudE91dCxcbiAgICAgICAgICB9KVxuICAgICAgICB9XG5cbiAgICAgICAgcm91dGVSZXNwb25zZS5wdXNoKGN1clJvdXRlKVxuICAgICAgfSBlbHNlIGlmIChzdWJSb3V0ZS5wcm90b2NvbCA9PSBQcm90b2NvbC5WMikge1xuICAgICAgICBjb25zdCBwb29scyA9IHN1YlJvdXRlLnJvdXRlLnBhaXJzXG4gICAgICAgIGNvbnN0IGN1clJvdXRlOiBWMlBvb2xJblJvdXRlW10gPSBbXVxuICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IHBvb2xzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgY29uc3QgbmV4dFBvb2wgPSBwb29sc1tpXVxuICAgICAgICAgIGNvbnN0IHRva2VuSW4gPSB0b2tlblBhdGhbaV1cbiAgICAgICAgICBjb25zdCB0b2tlbk91dCA9IHRva2VuUGF0aFtpICsgMV1cblxuICAgICAgICAgIGxldCBlZGdlQW1vdW50SW4gPSB1bmRlZmluZWRcbiAgICAgICAgICBpZiAoaSA9PSAwKSB7XG4gICAgICAgICAgICBlZGdlQW1vdW50SW4gPSB0eXBlID09ICdleGFjdEluJyA/IGFtb3VudC5xdW90aWVudC50b1N0cmluZygpIDogcXVvdGUucXVvdGllbnQudG9TdHJpbmcoKVxuICAgICAgICAgIH1cblxuICAgICAgICAgIGxldCBlZGdlQW1vdW50T3V0ID0gdW5kZWZpbmVkXG4gICAgICAgICAgaWYgKGkgPT0gcG9vbHMubGVuZ3RoIC0gMSkge1xuICAgICAgICAgICAgZWRnZUFtb3VudE91dCA9IHR5cGUgPT0gJ2V4YWN0SW4nID8gcXVvdGUucXVvdGllbnQudG9TdHJpbmcoKSA6IGFtb3VudC5xdW90aWVudC50b1N0cmluZygpXG4gICAgICAgICAgfVxuXG4gICAgICAgICAgY29uc3QgcmVzZXJ2ZTAgPSBuZXh0UG9vbC5yZXNlcnZlMFxuICAgICAgICAgIGNvbnN0IHJlc2VydmUxID0gbmV4dFBvb2wucmVzZXJ2ZTFcblxuICAgICAgICAgIGN1clJvdXRlLnB1c2goe1xuICAgICAgICAgICAgdHlwZTogJ3YyLXBvb2wnLFxuICAgICAgICAgICAgYWRkcmVzczogdjJQb29sUHJvdmlkZXIuZ2V0UG9vbEFkZHJlc3MobmV4dFBvb2wudG9rZW4wLCBuZXh0UG9vbC50b2tlbjEpLnBvb2xBZGRyZXNzLFxuICAgICAgICAgICAgdG9rZW5Jbjoge1xuICAgICAgICAgICAgICBjaGFpbklkOiB0b2tlbkluLmNoYWluSWQsXG4gICAgICAgICAgICAgIGRlY2ltYWxzOiB0b2tlbkluLmRlY2ltYWxzLnRvU3RyaW5nKCksXG4gICAgICAgICAgICAgIGFkZHJlc3M6IHRva2VuSW4uYWRkcmVzcyxcbiAgICAgICAgICAgICAgc3ltYm9sOiB0b2tlbkluLnN5bWJvbCEsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgdG9rZW5PdXQ6IHtcbiAgICAgICAgICAgICAgY2hhaW5JZDogdG9rZW5PdXQuY2hhaW5JZCxcbiAgICAgICAgICAgICAgZGVjaW1hbHM6IHRva2VuT3V0LmRlY2ltYWxzLnRvU3RyaW5nKCksXG4gICAgICAgICAgICAgIGFkZHJlc3M6IHRva2VuT3V0LmFkZHJlc3MsXG4gICAgICAgICAgICAgIHN5bWJvbDogdG9rZW5PdXQuc3ltYm9sISxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICByZXNlcnZlMDoge1xuICAgICAgICAgICAgICB0b2tlbjoge1xuICAgICAgICAgICAgICAgIGNoYWluSWQ6IHJlc2VydmUwLmN1cnJlbmN5LndyYXBwZWQuY2hhaW5JZCxcbiAgICAgICAgICAgICAgICBkZWNpbWFsczogcmVzZXJ2ZTAuY3VycmVuY3kud3JhcHBlZC5kZWNpbWFscy50b1N0cmluZygpLFxuICAgICAgICAgICAgICAgIGFkZHJlc3M6IHJlc2VydmUwLmN1cnJlbmN5LndyYXBwZWQuYWRkcmVzcyxcbiAgICAgICAgICAgICAgICBzeW1ib2w6IHJlc2VydmUwLmN1cnJlbmN5LndyYXBwZWQuc3ltYm9sISxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgcXVvdGllbnQ6IHJlc2VydmUwLnF1b3RpZW50LnRvU3RyaW5nKCksXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgcmVzZXJ2ZTE6IHtcbiAgICAgICAgICAgICAgdG9rZW46IHtcbiAgICAgICAgICAgICAgICBjaGFpbklkOiByZXNlcnZlMS5jdXJyZW5jeS53cmFwcGVkLmNoYWluSWQsXG4gICAgICAgICAgICAgICAgZGVjaW1hbHM6IHJlc2VydmUxLmN1cnJlbmN5LndyYXBwZWQuZGVjaW1hbHMudG9TdHJpbmcoKSxcbiAgICAgICAgICAgICAgICBhZGRyZXNzOiByZXNlcnZlMS5jdXJyZW5jeS53cmFwcGVkLmFkZHJlc3MsXG4gICAgICAgICAgICAgICAgc3ltYm9sOiByZXNlcnZlMS5jdXJyZW5jeS53cmFwcGVkLnN5bWJvbCEsXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIHF1b3RpZW50OiByZXNlcnZlMS5xdW90aWVudC50b1N0cmluZygpLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIGFtb3VudEluOiBlZGdlQW1vdW50SW4sXG4gICAgICAgICAgICBhbW91bnRPdXQ6IGVkZ2VBbW91bnRPdXQsXG4gICAgICAgICAgfSlcbiAgICAgICAgfVxuXG4gICAgICAgIHJvdXRlUmVzcG9uc2UucHVzaChjdXJSb3V0ZSlcbiAgICAgIH1cbiAgICB9XG5cbiAgICBjb25zdCB0b2tlbkluID0gdHJhZGUuaW5wdXRBbW91bnQuY3VycmVuY3kud3JhcHBlZFxuICAgIGNvbnN0IHRva2VuT3V0ID0gdHJhZGUub3V0cHV0QW1vdW50LmN1cnJlbmN5LndyYXBwZWRcblxuICAgIGNvbnN0IHplcm9Gb3JPbmUgPSB0b2tlbkluLndyYXBwZWQuYWRkcmVzcyA9PT0gdG9rZW4wLndyYXBwZWQuYWRkcmVzc1xuICAgIGxldCB0b2tlbjBCYWxhbmNlVXBkYXRlZDogQ3VycmVuY3lBbW91bnQ8Q3VycmVuY3k+XG4gICAgbGV0IHRva2VuMUJhbGFuY2VVcGRhdGVkOiBDdXJyZW5jeUFtb3VudDxDdXJyZW5jeT5cbiAgICBsZXQgb3B0aW1hbFJhdGlvQWRqdXN0ZWQ6IEZyYWN0aW9uXG4gICAgbGV0IG9wdGltYWxSYXRpb0RlY2ltYWw6IHN0cmluZ1xuICAgIGxldCBuZXdSYXRpb0RlY2ltYWw6IHN0cmluZ1xuICAgIGlmICh6ZXJvRm9yT25lKSB7XG4gICAgICB0b2tlbjBCYWxhbmNlVXBkYXRlZCA9IHRva2VuMEJhbGFuY2Uuc3VidHJhY3QodHJhZGUuaW5wdXRBbW91bnQpXG4gICAgICB0b2tlbjFCYWxhbmNlVXBkYXRlZCA9IHRva2VuMUJhbGFuY2UuYWRkKHRyYWRlLm91dHB1dEFtb3VudClcbiAgICAgIG9wdGltYWxSYXRpb0FkanVzdGVkID0gb3B0aW1hbFJhdGlvXG4gICAgICBvcHRpbWFsUmF0aW9EZWNpbWFsID0gb3B0aW1hbFJhdGlvQWRqdXN0ZWQudG9GaXhlZCh0b2tlbjAud3JhcHBlZC5kZWNpbWFscylcbiAgICAgIG5ld1JhdGlvRGVjaW1hbCA9IG5ldyBGcmFjdGlvbihcbiAgICAgICAgdG9rZW4wQmFsYW5jZVVwZGF0ZWQucXVvdGllbnQudG9TdHJpbmcoKSxcbiAgICAgICAgdG9rZW4xQmFsYW5jZVVwZGF0ZWQucXVvdGllbnQudG9TdHJpbmcoKVxuICAgICAgKS50b0ZpeGVkKHRva2VuMC53cmFwcGVkLmRlY2ltYWxzKVxuICAgIH0gZWxzZSB7XG4gICAgICB0b2tlbjBCYWxhbmNlVXBkYXRlZCA9IHRva2VuMEJhbGFuY2UuYWRkKHRyYWRlLm91dHB1dEFtb3VudClcbiAgICAgIHRva2VuMUJhbGFuY2VVcGRhdGVkID0gdG9rZW4xQmFsYW5jZS5zdWJ0cmFjdCh0cmFkZS5pbnB1dEFtb3VudClcbiAgICAgIG9wdGltYWxSYXRpb0FkanVzdGVkID0gb3B0aW1hbFJhdGlvLmludmVydCgpXG4gICAgICBvcHRpbWFsUmF0aW9EZWNpbWFsID1cbiAgICAgICAgb3B0aW1hbFJhdGlvQWRqdXN0ZWQuZGVub21pbmF0b3IudG9TdHJpbmcoKSA9PSAnMCdcbiAgICAgICAgICA/IGAwLiR7JzAnLnJlcGVhdCh0b2tlbjEud3JhcHBlZC5kZWNpbWFscyl9YFxuICAgICAgICAgIDogb3B0aW1hbFJhdGlvQWRqdXN0ZWQudG9GaXhlZCh0b2tlbjAud3JhcHBlZC5kZWNpbWFscylcbiAgICAgIG5ld1JhdGlvRGVjaW1hbCA9XG4gICAgICAgIHRva2VuMUJhbGFuY2VVcGRhdGVkLm51bWVyYXRvci50b1N0cmluZygpID09ICcwJ1xuICAgICAgICAgID8gYDAuJHsnMCcucmVwZWF0KHRva2VuMS53cmFwcGVkLmRlY2ltYWxzKX1gXG4gICAgICAgICAgOiBuZXcgRnJhY3Rpb24odG9rZW4wQmFsYW5jZVVwZGF0ZWQucXVvdGllbnQudG9TdHJpbmcoKSwgdG9rZW4xQmFsYW5jZVVwZGF0ZWQucXVvdGllbnQudG9TdHJpbmcoKSkudG9GaXhlZChcbiAgICAgICAgICAgICAgdG9rZW4wLndyYXBwZWQuZGVjaW1hbHNcbiAgICAgICAgICAgIClcbiAgICB9XG5cbiAgICBjb25zdCBwb3N0U3dhcFRhcmdldFBvb2xPYmplY3QgPSB7XG4gICAgICBhZGRyZXNzOiB2M1Bvb2xQcm92aWRlci5nZXRQb29sQWRkcmVzcyhcbiAgICAgICAgcG9zdFN3YXBUYXJnZXRQb29sLnRva2VuMCxcbiAgICAgICAgcG9zdFN3YXBUYXJnZXRQb29sLnRva2VuMSxcbiAgICAgICAgcG9zdFN3YXBUYXJnZXRQb29sLmZlZVxuICAgICAgKS5wb29sQWRkcmVzcyxcbiAgICAgIHRva2VuSW46IHtcbiAgICAgICAgY2hhaW5JZDogdG9rZW5Jbi5jaGFpbklkLFxuICAgICAgICBkZWNpbWFsczogdG9rZW5Jbi5kZWNpbWFscy50b1N0cmluZygpLFxuICAgICAgICBhZGRyZXNzOiB0b2tlbkluLmFkZHJlc3MsXG4gICAgICAgIHN5bWJvbDogdG9rZW5Jbi5zeW1ib2whLFxuICAgICAgfSxcbiAgICAgIHRva2VuT3V0OiB7XG4gICAgICAgIGNoYWluSWQ6IHRva2VuT3V0LmNoYWluSWQsXG4gICAgICAgIGRlY2ltYWxzOiB0b2tlbk91dC5kZWNpbWFscy50b1N0cmluZygpLFxuICAgICAgICBhZGRyZXNzOiB0b2tlbk91dC5hZGRyZXNzLFxuICAgICAgICBzeW1ib2w6IHRva2VuT3V0LnN5bWJvbCEsXG4gICAgICB9LFxuICAgICAgZmVlOiBwb3N0U3dhcFRhcmdldFBvb2wuZmVlLnRvU3RyaW5nKCksXG4gICAgICBsaXF1aWRpdHk6IHBvc3RTd2FwVGFyZ2V0UG9vbC5saXF1aWRpdHkudG9TdHJpbmcoKSxcbiAgICAgIHNxcnRSYXRpb1g5NjogcG9zdFN3YXBUYXJnZXRQb29sLnNxcnRSYXRpb1g5Ni50b1N0cmluZygpLFxuICAgICAgdGlja0N1cnJlbnQ6IHBvc3RTd2FwVGFyZ2V0UG9vbC50aWNrQ3VycmVudC50b1N0cmluZygpLFxuICAgIH1cblxuICAgIGNvbnN0IHJlc3VsdDogUXVvdGVUb1JhdGlvUmVzcG9uc2UgPSB7XG4gICAgICBtZXRob2RQYXJhbWV0ZXJzLFxuICAgICAgYmxvY2tOdW1iZXI6IGJsb2NrTnVtYmVyLnRvU3RyaW5nKCksXG4gICAgICBhbW91bnQ6IHRyYWRlLmlucHV0QW1vdW50LnF1b3RpZW50LnRvU3RyaW5nKCksXG4gICAgICBhbW91bnREZWNpbWFsczogdHJhZGUuaW5wdXRBbW91bnQudG9GaXhlZCh0cmFkZS5pbnB1dEFtb3VudC5jdXJyZW5jeS5kZWNpbWFscyksXG4gICAgICBxdW90ZTogcXVvdGUucXVvdGllbnQudG9TdHJpbmcoKSxcbiAgICAgIHRva2VuSW5BZGRyZXNzOiB0cmFkZS5pbnB1dEFtb3VudC5jdXJyZW5jeS53cmFwcGVkLmFkZHJlc3MsXG4gICAgICB0b2tlbk91dEFkZHJlc3M6IHRyYWRlLm91dHB1dEFtb3VudC5jdXJyZW5jeS53cmFwcGVkLmFkZHJlc3MsXG4gICAgICB0b2tlbjBCYWxhbmNlVXBkYXRlZDogdG9rZW4wQmFsYW5jZVVwZGF0ZWQucXVvdGllbnQudG9TdHJpbmcoKSxcbiAgICAgIHRva2VuMUJhbGFuY2VVcGRhdGVkOiB0b2tlbjFCYWxhbmNlVXBkYXRlZC5xdW90aWVudC50b1N0cmluZygpLFxuICAgICAgb3B0aW1hbFJhdGlvOiBvcHRpbWFsUmF0aW9EZWNpbWFsLnRvU3RyaW5nKCksXG4gICAgICBvcHRpbWFsUmF0aW9GcmFjdGlvbjoge1xuICAgICAgICBudW1lcmF0b3I6IG9wdGltYWxSYXRpb0FkanVzdGVkLm51bWVyYXRvci50b1N0cmluZygpLFxuICAgICAgICBkZW5vbWluYXRvcjogb3B0aW1hbFJhdGlvQWRqdXN0ZWQuZGVub21pbmF0b3IudG9TdHJpbmcoKSxcbiAgICAgIH0sXG4gICAgICBuZXdSYXRpbzogbmV3UmF0aW9EZWNpbWFsLnRvU3RyaW5nKCksXG4gICAgICBuZXdSYXRpb0ZyYWN0aW9uOiB7XG4gICAgICAgIG51bWVyYXRvcjogdG9rZW4wQmFsYW5jZVVwZGF0ZWQucXVvdGllbnQudG9TdHJpbmcoKSxcbiAgICAgICAgZGVub21pbmF0b3I6IHRva2VuMUJhbGFuY2VVcGRhdGVkLnF1b3RpZW50LnRvU3RyaW5nKCksXG4gICAgICB9LFxuICAgICAgcG9zdFN3YXBUYXJnZXRQb29sOiBwb3N0U3dhcFRhcmdldFBvb2xPYmplY3QsXG4gICAgICBxdW90ZURlY2ltYWxzOiBxdW90ZS50b0V4YWN0KCksXG4gICAgICBxdW90ZUdhc0FkanVzdGVkOiBxdW90ZUdhc0FkanVzdGVkLnF1b3RpZW50LnRvU3RyaW5nKCksXG4gICAgICBxdW90ZUdhc0FkanVzdGVkRGVjaW1hbHM6IHF1b3RlR2FzQWRqdXN0ZWQudG9FeGFjdCgpLFxuICAgICAgZ2FzVXNlRXN0aW1hdGVRdW90ZTogZXN0aW1hdGVkR2FzVXNlZFF1b3RlVG9rZW4ucXVvdGllbnQudG9TdHJpbmcoKSxcbiAgICAgIGdhc1VzZUVzdGltYXRlUXVvdGVEZWNpbWFsczogZXN0aW1hdGVkR2FzVXNlZFF1b3RlVG9rZW4udG9FeGFjdCgpLFxuICAgICAgZ2FzVXNlRXN0aW1hdGU6IGVzdGltYXRlZEdhc1VzZWQudG9TdHJpbmcoKSxcbiAgICAgIGdhc1VzZUVzdGltYXRlVVNEOiBlc3RpbWF0ZWRHYXNVc2VkVVNELnRvRXhhY3QoKSxcbiAgICAgIGdhc1ByaWNlV2VpOiBnYXNQcmljZVdlaS50b1N0cmluZygpLFxuICAgICAgcm91dGU6IHJvdXRlUmVzcG9uc2UsXG4gICAgICByb3V0ZVN0cmluZzogcm91dGVBbW91bnRzVG9TdHJpbmcocm91dGUpLFxuICAgICAgcXVvdGVJZCxcbiAgICAgIHNpbXVsYXRpb25TdGF0dXM6ICdVTkFUVEVNUFRFRCcsXG4gICAgfVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIHN0YXR1c0NvZGU6IDIwMCxcbiAgICAgIGJvZHk6IHJlc3VsdCxcbiAgICB9XG4gIH1cblxuICBwcm90ZWN0ZWQgcmVxdWVzdEJvZHlTY2hlbWEoKTogSm9pLk9iamVjdFNjaGVtYSB8IG51bGwge1xuICAgIHJldHVybiBudWxsXG4gIH1cblxuICBwcm90ZWN0ZWQgcmVxdWVzdFF1ZXJ5UGFyYW1zU2NoZW1hKCk6IEpvaS5PYmplY3RTY2hlbWEgfCBudWxsIHtcbiAgICByZXR1cm4gUXVvdGVUb1JhdGlvUXVlcnlQYXJhbXNKb2lcbiAgfVxuXG4gIHByb3RlY3RlZCByZXNwb25zZUJvZHlTY2hlbWEoKTogSm9pLk9iamVjdFNjaGVtYSB8IG51bGwge1xuICAgIHJldHVybiBRdW90ZXRvUmF0aW9SZXNwb25zZVNjaGVtYUpvaVxuICB9XG5cbiAgcHJvdGVjdGVkIG5vU3dhcE5lZWRlZEZvclJhbmdlT3JkZXIoXG4gICAgcG9zaXRpb246IFBvc2l0aW9uLFxuICAgIHRva2VuMEJhbGFuY2U6IEN1cnJlbmN5QW1vdW50PEN1cnJlbmN5PixcbiAgICB0b2tlbjFCYWxhbmNlOiBDdXJyZW5jeUFtb3VudDxDdXJyZW5jeT5cbiAgKTogYm9vbGVhbiB7XG4gICAgaWYgKHBvc2l0aW9uLnBvb2wudGlja0N1cnJlbnQgPCBwb3NpdGlvbi50aWNrTG93ZXIpIHtcbiAgICAgIHJldHVybiB0b2tlbjFCYWxhbmNlLmVxdWFsVG8oMCkgJiYgdG9rZW4wQmFsYW5jZS5ncmVhdGVyVGhhbigwKVxuICAgIH0gZWxzZSBpZiAocG9zaXRpb24ucG9vbC50aWNrQ3VycmVudCA+IHBvc2l0aW9uLnRpY2tVcHBlcikge1xuICAgICAgcmV0dXJuIHRva2VuMEJhbGFuY2UuZXF1YWxUbygwKSAmJiB0b2tlbjFCYWxhbmNlLmdyZWF0ZXJUaGFuKDEpXG4gICAgfSBlbHNlIHtcbiAgICAgIHJldHVybiBmYWxzZVxuICAgIH1cbiAgfVxuXG4gIHByb3RlY3RlZCB2YWxpZFRpY2sodGljazogbnVtYmVyLCBmZWVBbW91bnQ6IG51bWJlcik6IGJvb2xlYW4ge1xuICAgIGNvbnN0IFRJQ0tfU1BBQ0lOR1MgPSB7XG4gICAgICA1MDA6IDEwLFxuICAgICAgMzAwMDogNjAsXG4gICAgICAxMDAwMDogMTAwLFxuICAgIH0gYXMgeyBbZmVlQW1vdW50OiBzdHJpbmddOiBudW1iZXIgfVxuXG4gICAgbGV0IHZhbGlkVGlja1NwYWNpbmcgPSB0cnVlXG5cbiAgICBpZiAoVElDS19TUEFDSU5HU1tmZWVBbW91bnRdICE9IHVuZGVmaW5lZCkge1xuICAgICAgdmFsaWRUaWNrU3BhY2luZyA9IHRpY2sgJSBUSUNLX1NQQUNJTkdTW2ZlZUFtb3VudF0gPT09IDBcbiAgICB9XG5cbiAgICByZXR1cm4gdmFsaWRUaWNrU3BhY2luZ1xuICB9XG59XG4iXX0=