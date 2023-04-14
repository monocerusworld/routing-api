/// <reference types="hapi__joi" />
import Joi from '@hapi/joi';
import { QuoteResponse, TokenInRoute } from '../../schema';
export type PostSwapTargetPool = {
    address: string;
    tokenIn: TokenInRoute;
    tokenOut: TokenInRoute;
    sqrtRatioX96: string;
    liquidity: string;
    tickCurrent: string;
    fee: string;
};
export type ResponseFraction = {
    numerator: string;
    denominator: string;
};
export declare const QuoteToRatioQueryParamsJoi: Joi.ObjectSchema<any>;
export type QuoteToRatioQueryParams = {
    token0Address: string;
    token0ChainId: number;
    token1Address: string;
    token1ChainId: number;
    token0Balance: string;
    token1Balance: string;
    tickLower: number;
    tickUpper: number;
    feeAmount: number;
    recipient?: string;
    slippageTolerance?: string;
    deadline?: string;
    gasPriceWei?: string;
    minSplits?: number;
    ratioErrorTolerance: number;
    maxIterations: number;
    addLiquidityRecipient?: string;
    addLiquidityTokenId?: string;
};
export type QuoteToRatioResponse = QuoteResponse & {
    tokenInAddress: string;
    tokenOutAddress: string;
    token0BalanceUpdated: string;
    token1BalanceUpdated: string;
    optimalRatio: string;
    optimalRatioFraction: ResponseFraction;
    newRatio: string;
    newRatioFraction: ResponseFraction;
    postSwapTargetPool: PostSwapTargetPool;
};
export declare const QuotetoRatioResponseSchemaJoi: Joi.ObjectSchema<any>;
