import { CachedRoutes, CacheMode, ChainId, IRouteCachingProvider } from '@tartz-one/smart-order-router';
import { Currency, CurrencyAmount, Token, TradeType } from '@uniswap/sdk-core';
import { Protocol } from '@uniswap/router-sdk';
interface ConstructorParams {
    /**
     * The TableName for the DynamoDB Table. This is wired in from the CDK definition.
     */
    cachedRoutesTableName: string;
    /**
     * The amount of minutes that a CachedRoute should live in the database.
     * This is used to limit the database growth, Dynamo will automatically delete expired entries.
     */
    ttlMinutes?: number;
}
export declare class DynamoRouteCachingProvider extends IRouteCachingProvider {
    private readonly ddbClient;
    private readonly tableName;
    private readonly ttlMinutes;
    constructor({ cachedRoutesTableName, ttlMinutes }: ConstructorParams);
    /**
     * Implementation of the abstract method defined in `IRouteCachingProvider`
     * Given a CachedRoutesStrategy (from CACHED_ROUTES_CONFIGURATION),
     * we will find the BlocksToLive associated to the bucket.
     *
     * @param cachedRoutes
     * @param amount
     * @protected
     */
    protected _getBlocksToLive(cachedRoutes: CachedRoutes, amount: CurrencyAmount<Currency>): Promise<number>;
    /**
     * Implementation of the abstract method defined in `IRouteCachingProvider`
     * Fetch the most recent entry from the DynamoDB table for that pair, tradeType, chainId, protocols and bucket
     *
     * @param chainId
     * @param amount
     * @param quoteToken
     * @param tradeType
     * @param protocols
     * @protected
     */
    protected _getCachedRoute(chainId: ChainId, amount: CurrencyAmount<Currency>, quoteToken: Token, tradeType: TradeType, protocols: Protocol[]): Promise<CachedRoutes | undefined>;
    /**
     * Implementation of the abstract method defined in `IRouteCachingProvider`
     * Attempts to insert the `CachedRoutes` object into cache, if the CachingStrategy returns the CachingParameters
     *
     * @param cachedRoutes
     * @param amount
     * @protected
     */
    protected _setCachedRoute(cachedRoutes: CachedRoutes, amount: CurrencyAmount<Currency>): Promise<boolean>;
    /**
     * Implementation of the abstract method defined in `IRouteCachingProvider`
     * Obtains the CacheMode from the CachingStrategy, if not found, then return Darkmode.
     *
     * @param chainId
     * @param amount
     * @param quoteToken
     * @param tradeType
     * @param _protocols
     */
    getCacheMode(chainId: ChainId, amount: CurrencyAmount<Currency>, quoteToken: Token, tradeType: TradeType, _protocols: Protocol[]): Promise<CacheMode>;
    /**
     * Helper function to fetch the CachingStrategy using CachedRoutes as input
     *
     * @param cachedRoutes
     * @private
     */
    private getCachedRoutesStrategyFromCachedRoutes;
    /**
     * Helper function to obtain the Caching strategy from the CACHED_ROUTES_CONFIGURATION
     *
     * @param tokenIn
     * @param tokenOut
     * @param tradeType
     * @param chainId
     * @private
     */
    private getCachedRoutesStrategy;
    /**
     * Helper function to determine the tokenIn and tokenOut given the tradeType, quoteToken and amount.currency
     *
     * @param amount
     * @param quoteToken
     * @param tradeType
     * @private
     */
    private determineTokenInOut;
}
export {};
