/// <reference types="hapi__joi" />
import Joi from '@hapi/joi';
import { Currency, CurrencyAmount } from '@uniswap/sdk-core';
import { AlphaRouterConfig, ISwapToRatio, SwapAndAddConfig } from '@tartz-one/smart-order-router';
import { Position } from '@uniswap/v3-sdk';
import { APIGLambdaHandler, ErrorResponse, HandleRequestParams, Response } from '../handler';
import { ContainerInjected, RequestInjected } from '../injector-sor';
import { QuoteToRatioQueryParams, QuoteToRatioResponse } from './schema/quote-to-ratio-schema';
export declare class QuoteToRatioHandler extends APIGLambdaHandler<ContainerInjected, RequestInjected<ISwapToRatio<AlphaRouterConfig, SwapAndAddConfig>>, void, QuoteToRatioQueryParams, QuoteToRatioResponse> {
    handleRequest(params: HandleRequestParams<ContainerInjected, RequestInjected<ISwapToRatio<AlphaRouterConfig, SwapAndAddConfig>>, void, QuoteToRatioQueryParams>): Promise<Response<QuoteToRatioResponse> | ErrorResponse>;
    protected requestBodySchema(): Joi.ObjectSchema | null;
    protected requestQueryParamsSchema(): Joi.ObjectSchema | null;
    protected responseBodySchema(): Joi.ObjectSchema | null;
    protected noSwapNeededForRangeOrder(position: Position, token0Balance: CurrencyAmount<Currency>, token1Balance: CurrencyAmount<Currency>): boolean;
    protected validTick(tick: number, feeAmount: number): boolean;
}
