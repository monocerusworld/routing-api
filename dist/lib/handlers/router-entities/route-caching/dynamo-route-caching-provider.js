import { CacheMode, IRouteCachingProvider, log } from '@tartz-one/smart-order-router';
import { DynamoDB } from 'aws-sdk';
import { TradeType } from '@uniswap/sdk-core';
import { CACHED_ROUTES_CONFIGURATION } from './cached-routes-configuration';
import { PairTradeTypeChainId } from './model/pair-trade-type-chain-id';
import { CachedRoutesMarshaller } from './marshalling/cached-routes-marshaller';
import { ProtocolsBucketBlockNumber } from './model/protocols-bucket-block-number';
export class DynamoRouteCachingProvider extends IRouteCachingProvider {
    constructor({ cachedRoutesTableName, ttlMinutes = 2 }) {
        super();
        // Since this DDB Table is used for Cache, we will fail fast and limit the timeout.
        this.ddbClient = new DynamoDB.DocumentClient({
            maxRetries: 1,
            retryDelayOptions: {
                base: 20,
            },
            httpOptions: {
                timeout: 100,
            },
        });
        this.tableName = cachedRoutesTableName;
        this.ttlMinutes = ttlMinutes;
    }
    /**
     * Implementation of the abstract method defined in `IRouteCachingProvider`
     * Given a CachedRoutesStrategy (from CACHED_ROUTES_CONFIGURATION),
     * we will find the BlocksToLive associated to the bucket.
     *
     * @param cachedRoutes
     * @param amount
     * @protected
     */
    async _getBlocksToLive(cachedRoutes, amount) {
        const cachedRoutesStrategy = this.getCachedRoutesStrategyFromCachedRoutes(cachedRoutes);
        const cachingParameters = cachedRoutesStrategy === null || cachedRoutesStrategy === void 0 ? void 0 : cachedRoutesStrategy.getCachingBucket(amount);
        if (cachingParameters) {
            return cachingParameters.blocksToLive;
        }
        else {
            return 0;
        }
    }
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
    async _getCachedRoute(chainId, amount, quoteToken, tradeType, protocols) {
        var _a;
        const { tokenIn, tokenOut } = this.determineTokenInOut(amount, quoteToken, tradeType);
        const cachedRoutesStrategy = this.getCachedRoutesStrategy(tokenIn, tokenOut, tradeType, chainId);
        const cachingParameters = cachedRoutesStrategy === null || cachedRoutesStrategy === void 0 ? void 0 : cachedRoutesStrategy.getCachingBucket(amount);
        if (cachingParameters) {
            const partitionKey = new PairTradeTypeChainId({
                tokenIn: tokenIn.address,
                tokenOut: tokenOut.address,
                tradeType,
                chainId,
            });
            const partialSortKey = new ProtocolsBucketBlockNumber({
                protocols,
                bucket: cachingParameters.bucket,
            });
            const queryParams = {
                TableName: this.tableName,
                // Since we don't know what's the latest block that we have in cache, we make a query with a partial sort key
                KeyConditionExpression: '#pk = :pk and begins_with(#sk, :sk)',
                ExpressionAttributeNames: {
                    '#pk': 'pairTradeTypeChainId',
                    '#sk': 'protocolsBucketBlockNumber',
                },
                ExpressionAttributeValues: {
                    ':pk': partitionKey.toString(),
                    ':sk': partialSortKey.protocolsBucketPartialKey(),
                },
                ScanIndexForward: false,
                Limit: 1, // Only retrieve the most recent item
            };
            try {
                log.info({ queryParams }, `[DynamoRouteCachingProvider] Attempting to get route from cache.`);
                const result = await this.ddbClient.query(queryParams).promise();
                log.info({ result }, `[DynamoRouteCachingProvider] Got the following response from querying cache`);
                if (result.Items && result.Items.length > 0) {
                    // If we got a response with more than 1 item, we extract the binary field from the response
                    const itemBinary = (_a = result.Items[0]) === null || _a === void 0 ? void 0 : _a.item;
                    // Then we convert it into a Buffer
                    const cachedRoutesBuffer = Buffer.from(itemBinary);
                    // We convert that buffer into string and parse as JSON (it was encoded as JSON when it was inserted into cache)
                    const cachedRoutesJson = JSON.parse(cachedRoutesBuffer.toString());
                    // Finally we unmarshal that JSON into a `CachedRoutes` object
                    const cachedRoutes = CachedRoutesMarshaller.unmarshal(cachedRoutesJson);
                    log.info({ cachedRoutes }, `[DynamoRouteCachingProvider] Returning the cached and unmarshalled route.`);
                    return cachedRoutes;
                }
                else {
                    log.info(`[DynamoRouteCachingProvider] No items found in the query response.`);
                }
            }
            catch (error) {
                log.error({ queryParams, error }, `[DynamoRouteCachingProvider] Error while fetching route from cache`);
            }
        }
        // We only get here if we didn't find a cachedRoutes
        return undefined;
    }
    /**
     * Implementation of the abstract method defined in `IRouteCachingProvider`
     * Attempts to insert the `CachedRoutes` object into cache, if the CachingStrategy returns the CachingParameters
     *
     * @param cachedRoutes
     * @param amount
     * @protected
     */
    async _setCachedRoute(cachedRoutes, amount) {
        const cachedRoutesStrategy = this.getCachedRoutesStrategyFromCachedRoutes(cachedRoutes);
        const cachingParameters = cachedRoutesStrategy === null || cachedRoutesStrategy === void 0 ? void 0 : cachedRoutesStrategy.getCachingBucket(amount);
        if (cachingParameters) {
            // TTL is minutes from now. multiply ttlMinutes times 60 to convert to seconds, since ttl is in seconds.
            const ttl = Math.floor(Date.now() / 1000) + 60 * this.ttlMinutes;
            // Marshal the CachedRoutes object in preparation for storing in DynamoDB
            const marshalledCachedRoutes = CachedRoutesMarshaller.marshal(cachedRoutes);
            // Convert the marshalledCachedRoutes to JSON string
            const jsonCachedRoutes = JSON.stringify(marshalledCachedRoutes);
            // Encode the jsonCachedRoutes into Binary
            const binaryCachedRoutes = Buffer.from(jsonCachedRoutes);
            // Primary Key object
            const partitionKey = PairTradeTypeChainId.fromCachedRoutes(cachedRoutes);
            const sortKey = new ProtocolsBucketBlockNumber({
                protocols: cachedRoutes.protocolsCovered,
                bucket: cachingParameters.bucket,
                blockNumber: cachedRoutes.blockNumber,
            });
            const putParams = {
                TableName: this.tableName,
                Item: {
                    pairTradeTypeChainId: partitionKey.toString(),
                    protocolsBucketBlockNumber: sortKey.fullKey(),
                    item: binaryCachedRoutes,
                    ttl: ttl,
                },
            };
            log.info({ putParams, cachedRoutes, jsonCachedRoutes }, `[DynamoRouteCachingProvider] Attempting to insert route to cache`);
            try {
                await this.ddbClient.put(putParams).promise();
                log.info(`[DynamoRouteCachingProvider] Cached route inserted to cache`);
                return true;
            }
            catch (error) {
                log.error({ error, putParams }, `[DynamoRouteCachingProvider] Cached route failed to insert`);
                return false;
            }
        }
        else {
            // No CachingParameters found, return false to indicate the route was not cached.
            return false;
        }
    }
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
    async getCacheMode(chainId, amount, quoteToken, tradeType, _protocols) {
        const { tokenIn, tokenOut } = this.determineTokenInOut(amount, quoteToken, tradeType);
        const cachedRoutesStrategy = this.getCachedRoutesStrategy(tokenIn, tokenOut, tradeType, chainId);
        const cachingParameters = cachedRoutesStrategy === null || cachedRoutesStrategy === void 0 ? void 0 : cachedRoutesStrategy.getCachingBucket(amount);
        if (cachingParameters) {
            log.info({
                cachingParameters: cachingParameters,
                tokenIn: tokenIn.address,
                tokenOut: tokenOut.address,
                pair: `${tokenIn.symbol}/${tokenOut.symbol}`,
                chainId,
                tradeType,
                amount: amount.toExact(),
            }, `[DynamoRouteCachingProvider] Got CachingParameters for ${amount.toExact()} in ${tokenIn.symbol}/${tokenOut.symbol}/${tradeType}/${chainId}`);
            return cachingParameters.cacheMode;
        }
        else {
            log.info({
                tokenIn: tokenIn.address,
                tokenOut: tokenOut.address,
                pair: `${tokenIn.symbol}/${tokenOut.symbol}`,
                chainId,
                tradeType,
                amount: amount.toExact(),
            }, `[DynamoRouteCachingProvider] Didn't find CachingParameters for ${amount.toExact()} in ${tokenIn.symbol}/${tokenOut.symbol}/${tradeType}/${chainId}`);
            return CacheMode.Darkmode;
        }
    }
    /**
     * Helper function to fetch the CachingStrategy using CachedRoutes as input
     *
     * @param cachedRoutes
     * @private
     */
    getCachedRoutesStrategyFromCachedRoutes(cachedRoutes) {
        return this.getCachedRoutesStrategy(cachedRoutes.tokenIn, cachedRoutes.tokenOut, cachedRoutes.tradeType, cachedRoutes.chainId);
    }
    /**
     * Helper function to obtain the Caching strategy from the CACHED_ROUTES_CONFIGURATION
     *
     * @param tokenIn
     * @param tokenOut
     * @param tradeType
     * @param chainId
     * @private
     */
    getCachedRoutesStrategy(tokenIn, tokenOut, tradeType, chainId) {
        var _a;
        const pairTradeTypeChainId = new PairTradeTypeChainId({
            tokenIn: tokenIn.address,
            tokenOut: tokenOut.address,
            tradeType: tradeType,
            chainId: chainId,
        });
        // We support looking for any token paired with tokenIn when tradeType is ExactIn
        // We could also support the inverse for tokenOut and ExactOut, but those quotes don't have enough requests
        const withWildcard = new PairTradeTypeChainId({
            tokenIn: tokenIn.address,
            tokenOut: '*',
            tradeType: TradeType.EXACT_INPUT,
            chainId: chainId,
        });
        log.info({ pairTradeTypeChainId }, `[DynamoRouteCachingProvider] Looking for cache configuration of ${pairTradeTypeChainId.toString()} or ${withWildcard.toString()}`);
        return ((_a = CACHED_ROUTES_CONFIGURATION.get(pairTradeTypeChainId.toString())) !== null && _a !== void 0 ? _a : CACHED_ROUTES_CONFIGURATION.get(withWildcard.toString()));
    }
    /**
     * Helper function to determine the tokenIn and tokenOut given the tradeType, quoteToken and amount.currency
     *
     * @param amount
     * @param quoteToken
     * @param tradeType
     * @private
     */
    determineTokenInOut(amount, quoteToken, tradeType) {
        if (tradeType == TradeType.EXACT_INPUT) {
            return { tokenIn: amount.currency.wrapped, tokenOut: quoteToken };
        }
        else {
            return { tokenIn: quoteToken, tokenOut: amount.currency.wrapped };
        }
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZHluYW1vLXJvdXRlLWNhY2hpbmctcHJvdmlkZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi9saWIvaGFuZGxlcnMvcm91dGVyLWVudGl0aWVzL3JvdXRlLWNhY2hpbmcvZHluYW1vLXJvdXRlLWNhY2hpbmctcHJvdmlkZXIudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsT0FBTyxFQUFnQixTQUFTLEVBQVcscUJBQXFCLEVBQUUsR0FBRyxFQUFFLE1BQU0sK0JBQStCLENBQUE7QUFDNUcsT0FBTyxFQUFFLFFBQVEsRUFBRSxNQUFNLFNBQVMsQ0FBQTtBQUNsQyxPQUFPLEVBQW1DLFNBQVMsRUFBRSxNQUFNLG1CQUFtQixDQUFBO0FBRTlFLE9BQU8sRUFBRSwyQkFBMkIsRUFBRSxNQUFNLCtCQUErQixDQUFBO0FBQzNFLE9BQU8sRUFBRSxvQkFBb0IsRUFBRSxNQUFNLGtDQUFrQyxDQUFBO0FBQ3ZFLE9BQU8sRUFBRSxzQkFBc0IsRUFBRSxNQUFNLHdDQUF3QyxDQUFBO0FBRS9FLE9BQU8sRUFBRSwwQkFBMEIsRUFBRSxNQUFNLHVDQUF1QyxDQUFBO0FBY2xGLE1BQU0sT0FBTywwQkFBMkIsU0FBUSxxQkFBcUI7SUFLbkUsWUFBWSxFQUFFLHFCQUFxQixFQUFFLFVBQVUsR0FBRyxDQUFDLEVBQXFCO1FBQ3RFLEtBQUssRUFBRSxDQUFBO1FBQ1AsbUZBQW1GO1FBQ25GLElBQUksQ0FBQyxTQUFTLEdBQUcsSUFBSSxRQUFRLENBQUMsY0FBYyxDQUFDO1lBQzNDLFVBQVUsRUFBRSxDQUFDO1lBQ2IsaUJBQWlCLEVBQUU7Z0JBQ2pCLElBQUksRUFBRSxFQUFFO2FBQ1Q7WUFDRCxXQUFXLEVBQUU7Z0JBQ1gsT0FBTyxFQUFFLEdBQUc7YUFDYjtTQUNGLENBQUMsQ0FBQTtRQUNGLElBQUksQ0FBQyxTQUFTLEdBQUcscUJBQXFCLENBQUE7UUFDdEMsSUFBSSxDQUFDLFVBQVUsR0FBRyxVQUFVLENBQUE7SUFDOUIsQ0FBQztJQUVEOzs7Ozs7OztPQVFHO0lBQ08sS0FBSyxDQUFDLGdCQUFnQixDQUFDLFlBQTBCLEVBQUUsTUFBZ0M7UUFDM0YsTUFBTSxvQkFBb0IsR0FBRyxJQUFJLENBQUMsdUNBQXVDLENBQUMsWUFBWSxDQUFDLENBQUE7UUFDdkYsTUFBTSxpQkFBaUIsR0FBRyxvQkFBb0IsYUFBcEIsb0JBQW9CLHVCQUFwQixvQkFBb0IsQ0FBRSxnQkFBZ0IsQ0FBQyxNQUFNLENBQUMsQ0FBQTtRQUV4RSxJQUFJLGlCQUFpQixFQUFFO1lBQ3JCLE9BQU8saUJBQWlCLENBQUMsWUFBWSxDQUFBO1NBQ3RDO2FBQU07WUFDTCxPQUFPLENBQUMsQ0FBQTtTQUNUO0lBQ0gsQ0FBQztJQUVEOzs7Ozs7Ozs7O09BVUc7SUFDTyxLQUFLLENBQUMsZUFBZSxDQUM3QixPQUFnQixFQUNoQixNQUFnQyxFQUNoQyxVQUFpQixFQUNqQixTQUFvQixFQUNwQixTQUFxQjs7UUFFckIsTUFBTSxFQUFFLE9BQU8sRUFBRSxRQUFRLEVBQUUsR0FBRyxJQUFJLENBQUMsbUJBQW1CLENBQUMsTUFBTSxFQUFFLFVBQVUsRUFBRSxTQUFTLENBQUMsQ0FBQTtRQUNyRixNQUFNLG9CQUFvQixHQUFHLElBQUksQ0FBQyx1QkFBdUIsQ0FBQyxPQUFPLEVBQUUsUUFBUSxFQUFFLFNBQVMsRUFBRSxPQUFPLENBQUMsQ0FBQTtRQUNoRyxNQUFNLGlCQUFpQixHQUFHLG9CQUFvQixhQUFwQixvQkFBb0IsdUJBQXBCLG9CQUFvQixDQUFFLGdCQUFnQixDQUFDLE1BQU0sQ0FBQyxDQUFBO1FBRXhFLElBQUksaUJBQWlCLEVBQUU7WUFDckIsTUFBTSxZQUFZLEdBQUcsSUFBSSxvQkFBb0IsQ0FBQztnQkFDNUMsT0FBTyxFQUFFLE9BQU8sQ0FBQyxPQUFPO2dCQUN4QixRQUFRLEVBQUUsUUFBUSxDQUFDLE9BQU87Z0JBQzFCLFNBQVM7Z0JBQ1QsT0FBTzthQUNSLENBQUMsQ0FBQTtZQUNGLE1BQU0sY0FBYyxHQUFHLElBQUksMEJBQTBCLENBQUM7Z0JBQ3BELFNBQVM7Z0JBQ1QsTUFBTSxFQUFFLGlCQUFpQixDQUFDLE1BQU07YUFDakMsQ0FBQyxDQUFBO1lBRUYsTUFBTSxXQUFXLEdBQUc7Z0JBQ2xCLFNBQVMsRUFBRSxJQUFJLENBQUMsU0FBUztnQkFDekIsNkdBQTZHO2dCQUM3RyxzQkFBc0IsRUFBRSxxQ0FBcUM7Z0JBQzdELHdCQUF3QixFQUFFO29CQUN4QixLQUFLLEVBQUUsc0JBQXNCO29CQUM3QixLQUFLLEVBQUUsNEJBQTRCO2lCQUNwQztnQkFDRCx5QkFBeUIsRUFBRTtvQkFDekIsS0FBSyxFQUFFLFlBQVksQ0FBQyxRQUFRLEVBQUU7b0JBQzlCLEtBQUssRUFBRSxjQUFjLENBQUMseUJBQXlCLEVBQUU7aUJBQ2xEO2dCQUNELGdCQUFnQixFQUFFLEtBQUs7Z0JBQ3ZCLEtBQUssRUFBRSxDQUFDLEVBQUUscUNBQXFDO2FBQ2hELENBQUE7WUFFRCxJQUFJO2dCQUNGLEdBQUcsQ0FBQyxJQUFJLENBQUMsRUFBRSxXQUFXLEVBQUUsRUFBRSxrRUFBa0UsQ0FBQyxDQUFBO2dCQUU3RixNQUFNLE1BQU0sR0FBRyxNQUFNLElBQUksQ0FBQyxTQUFTLENBQUMsS0FBSyxDQUFDLFdBQVcsQ0FBQyxDQUFDLE9BQU8sRUFBRSxDQUFBO2dCQUVoRSxHQUFHLENBQUMsSUFBSSxDQUFDLEVBQUUsTUFBTSxFQUFFLEVBQUUsNkVBQTZFLENBQUMsQ0FBQTtnQkFFbkcsSUFBSSxNQUFNLENBQUMsS0FBSyxJQUFJLE1BQU0sQ0FBQyxLQUFLLENBQUMsTUFBTSxHQUFHLENBQUMsRUFBRTtvQkFDM0MsNEZBQTRGO29CQUM1RixNQUFNLFVBQVUsR0FBRyxNQUFBLE1BQU0sQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLDBDQUFFLElBQUksQ0FBQTtvQkFDeEMsbUNBQW1DO29CQUNuQyxNQUFNLGtCQUFrQixHQUFHLE1BQU0sQ0FBQyxJQUFJLENBQUMsVUFBVSxDQUFDLENBQUE7b0JBQ2xELGdIQUFnSDtvQkFDaEgsTUFBTSxnQkFBZ0IsR0FBRyxJQUFJLENBQUMsS0FBSyxDQUFDLGtCQUFrQixDQUFDLFFBQVEsRUFBRSxDQUFDLENBQUE7b0JBQ2xFLDhEQUE4RDtvQkFDOUQsTUFBTSxZQUFZLEdBQWlCLHNCQUFzQixDQUFDLFNBQVMsQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFBO29CQUVyRixHQUFHLENBQUMsSUFBSSxDQUFDLEVBQUUsWUFBWSxFQUFFLEVBQUUsMkVBQTJFLENBQUMsQ0FBQTtvQkFFdkcsT0FBTyxZQUFZLENBQUE7aUJBQ3BCO3FCQUFNO29CQUNMLEdBQUcsQ0FBQyxJQUFJLENBQUMsb0VBQW9FLENBQUMsQ0FBQTtpQkFDL0U7YUFDRjtZQUFDLE9BQU8sS0FBSyxFQUFFO2dCQUNkLEdBQUcsQ0FBQyxLQUFLLENBQUMsRUFBRSxXQUFXLEVBQUUsS0FBSyxFQUFFLEVBQUUsb0VBQW9FLENBQUMsQ0FBQTthQUN4RztTQUNGO1FBRUQsb0RBQW9EO1FBQ3BELE9BQU8sU0FBUyxDQUFBO0lBQ2xCLENBQUM7SUFFRDs7Ozs7OztPQU9HO0lBQ08sS0FBSyxDQUFDLGVBQWUsQ0FBQyxZQUEwQixFQUFFLE1BQWdDO1FBQzFGLE1BQU0sb0JBQW9CLEdBQUcsSUFBSSxDQUFDLHVDQUF1QyxDQUFDLFlBQVksQ0FBQyxDQUFBO1FBQ3ZGLE1BQU0saUJBQWlCLEdBQUcsb0JBQW9CLGFBQXBCLG9CQUFvQix1QkFBcEIsb0JBQW9CLENBQUUsZ0JBQWdCLENBQUMsTUFBTSxDQUFDLENBQUE7UUFFeEUsSUFBSSxpQkFBaUIsRUFBRTtZQUNyQix3R0FBd0c7WUFDeEcsTUFBTSxHQUFHLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsR0FBRyxFQUFFLEdBQUcsSUFBSSxDQUFDLEdBQUcsRUFBRSxHQUFHLElBQUksQ0FBQyxVQUFVLENBQUE7WUFDaEUseUVBQXlFO1lBQ3pFLE1BQU0sc0JBQXNCLEdBQUcsc0JBQXNCLENBQUMsT0FBTyxDQUFDLFlBQVksQ0FBQyxDQUFBO1lBQzNFLG9EQUFvRDtZQUNwRCxNQUFNLGdCQUFnQixHQUFHLElBQUksQ0FBQyxTQUFTLENBQUMsc0JBQXNCLENBQUMsQ0FBQTtZQUMvRCwwQ0FBMEM7WUFDMUMsTUFBTSxrQkFBa0IsR0FBRyxNQUFNLENBQUMsSUFBSSxDQUFDLGdCQUFnQixDQUFDLENBQUE7WUFFeEQscUJBQXFCO1lBQ3JCLE1BQU0sWUFBWSxHQUFHLG9CQUFvQixDQUFDLGdCQUFnQixDQUFDLFlBQVksQ0FBQyxDQUFBO1lBQ3hFLE1BQU0sT0FBTyxHQUFHLElBQUksMEJBQTBCLENBQUM7Z0JBQzdDLFNBQVMsRUFBRSxZQUFZLENBQUMsZ0JBQWdCO2dCQUN4QyxNQUFNLEVBQUUsaUJBQWlCLENBQUMsTUFBTTtnQkFDaEMsV0FBVyxFQUFFLFlBQVksQ0FBQyxXQUFXO2FBQ3RDLENBQUMsQ0FBQTtZQUVGLE1BQU0sU0FBUyxHQUFHO2dCQUNoQixTQUFTLEVBQUUsSUFBSSxDQUFDLFNBQVM7Z0JBQ3pCLElBQUksRUFBRTtvQkFDSixvQkFBb0IsRUFBRSxZQUFZLENBQUMsUUFBUSxFQUFFO29CQUM3QywwQkFBMEIsRUFBRSxPQUFPLENBQUMsT0FBTyxFQUFFO29CQUM3QyxJQUFJLEVBQUUsa0JBQWtCO29CQUN4QixHQUFHLEVBQUUsR0FBRztpQkFDVDthQUNGLENBQUE7WUFFRCxHQUFHLENBQUMsSUFBSSxDQUNOLEVBQUUsU0FBUyxFQUFFLFlBQVksRUFBRSxnQkFBZ0IsRUFBRSxFQUM3QyxrRUFBa0UsQ0FDbkUsQ0FBQTtZQUVELElBQUk7Z0JBQ0YsTUFBTSxJQUFJLENBQUMsU0FBUyxDQUFDLEdBQUcsQ0FBQyxTQUFTLENBQUMsQ0FBQyxPQUFPLEVBQUUsQ0FBQTtnQkFDN0MsR0FBRyxDQUFDLElBQUksQ0FBQyw2REFBNkQsQ0FBQyxDQUFBO2dCQUV2RSxPQUFPLElBQUksQ0FBQTthQUNaO1lBQUMsT0FBTyxLQUFLLEVBQUU7Z0JBQ2QsR0FBRyxDQUFDLEtBQUssQ0FBQyxFQUFFLEtBQUssRUFBRSxTQUFTLEVBQUUsRUFBRSw0REFBNEQsQ0FBQyxDQUFBO2dCQUU3RixPQUFPLEtBQUssQ0FBQTthQUNiO1NBQ0Y7YUFBTTtZQUNMLGlGQUFpRjtZQUVqRixPQUFPLEtBQUssQ0FBQTtTQUNiO0lBQ0gsQ0FBQztJQUVEOzs7Ozs7Ozs7T0FTRztJQUNJLEtBQUssQ0FBQyxZQUFZLENBQ3ZCLE9BQWdCLEVBQ2hCLE1BQWdDLEVBQ2hDLFVBQWlCLEVBQ2pCLFNBQW9CLEVBQ3BCLFVBQXNCO1FBRXRCLE1BQU0sRUFBRSxPQUFPLEVBQUUsUUFBUSxFQUFFLEdBQUcsSUFBSSxDQUFDLG1CQUFtQixDQUFDLE1BQU0sRUFBRSxVQUFVLEVBQUUsU0FBUyxDQUFDLENBQUE7UUFDckYsTUFBTSxvQkFBb0IsR0FBRyxJQUFJLENBQUMsdUJBQXVCLENBQUMsT0FBTyxFQUFFLFFBQVEsRUFBRSxTQUFTLEVBQUUsT0FBTyxDQUFDLENBQUE7UUFDaEcsTUFBTSxpQkFBaUIsR0FBRyxvQkFBb0IsYUFBcEIsb0JBQW9CLHVCQUFwQixvQkFBb0IsQ0FBRSxnQkFBZ0IsQ0FBQyxNQUFNLENBQUMsQ0FBQTtRQUV4RSxJQUFJLGlCQUFpQixFQUFFO1lBQ3JCLEdBQUcsQ0FBQyxJQUFJLENBQ047Z0JBQ0UsaUJBQWlCLEVBQUUsaUJBQWlCO2dCQUNwQyxPQUFPLEVBQUUsT0FBTyxDQUFDLE9BQU87Z0JBQ3hCLFFBQVEsRUFBRSxRQUFRLENBQUMsT0FBTztnQkFDMUIsSUFBSSxFQUFFLEdBQUcsT0FBTyxDQUFDLE1BQU0sSUFBSSxRQUFRLENBQUMsTUFBTSxFQUFFO2dCQUM1QyxPQUFPO2dCQUNQLFNBQVM7Z0JBQ1QsTUFBTSxFQUFFLE1BQU0sQ0FBQyxPQUFPLEVBQUU7YUFDekIsRUFDRCwwREFBMEQsTUFBTSxDQUFDLE9BQU8sRUFBRSxPQUFPLE9BQU8sQ0FBQyxNQUFNLElBQzdGLFFBQVEsQ0FBQyxNQUNYLElBQUksU0FBUyxJQUFJLE9BQU8sRUFBRSxDQUMzQixDQUFBO1lBRUQsT0FBTyxpQkFBaUIsQ0FBQyxTQUFTLENBQUE7U0FDbkM7YUFBTTtZQUNMLEdBQUcsQ0FBQyxJQUFJLENBQ047Z0JBQ0UsT0FBTyxFQUFFLE9BQU8sQ0FBQyxPQUFPO2dCQUN4QixRQUFRLEVBQUUsUUFBUSxDQUFDLE9BQU87Z0JBQzFCLElBQUksRUFBRSxHQUFHLE9BQU8sQ0FBQyxNQUFNLElBQUksUUFBUSxDQUFDLE1BQU0sRUFBRTtnQkFDNUMsT0FBTztnQkFDUCxTQUFTO2dCQUNULE1BQU0sRUFBRSxNQUFNLENBQUMsT0FBTyxFQUFFO2FBQ3pCLEVBQ0Qsa0VBQWtFLE1BQU0sQ0FBQyxPQUFPLEVBQUUsT0FBTyxPQUFPLENBQUMsTUFBTSxJQUNyRyxRQUFRLENBQUMsTUFDWCxJQUFJLFNBQVMsSUFBSSxPQUFPLEVBQUUsQ0FDM0IsQ0FBQTtZQUVELE9BQU8sU0FBUyxDQUFDLFFBQVEsQ0FBQTtTQUMxQjtJQUNILENBQUM7SUFFRDs7Ozs7T0FLRztJQUNLLHVDQUF1QyxDQUFDLFlBQTBCO1FBQ3hFLE9BQU8sSUFBSSxDQUFDLHVCQUF1QixDQUNqQyxZQUFZLENBQUMsT0FBTyxFQUNwQixZQUFZLENBQUMsUUFBUSxFQUNyQixZQUFZLENBQUMsU0FBUyxFQUN0QixZQUFZLENBQUMsT0FBTyxDQUNyQixDQUFBO0lBQ0gsQ0FBQztJQUVEOzs7Ozs7OztPQVFHO0lBQ0ssdUJBQXVCLENBQzdCLE9BQWMsRUFDZCxRQUFlLEVBQ2YsU0FBb0IsRUFDcEIsT0FBZ0I7O1FBRWhCLE1BQU0sb0JBQW9CLEdBQUcsSUFBSSxvQkFBb0IsQ0FBQztZQUNwRCxPQUFPLEVBQUUsT0FBTyxDQUFDLE9BQU87WUFDeEIsUUFBUSxFQUFFLFFBQVEsQ0FBQyxPQUFPO1lBQzFCLFNBQVMsRUFBRSxTQUFTO1lBQ3BCLE9BQU8sRUFBRSxPQUFPO1NBQ2pCLENBQUMsQ0FBQTtRQUVGLGlGQUFpRjtRQUNqRiwyR0FBMkc7UUFDM0csTUFBTSxZQUFZLEdBQUcsSUFBSSxvQkFBb0IsQ0FBQztZQUM1QyxPQUFPLEVBQUUsT0FBTyxDQUFDLE9BQU87WUFDeEIsUUFBUSxFQUFFLEdBQUc7WUFDYixTQUFTLEVBQUUsU0FBUyxDQUFDLFdBQVc7WUFDaEMsT0FBTyxFQUFFLE9BQU87U0FDakIsQ0FBQyxDQUFBO1FBRUYsR0FBRyxDQUFDLElBQUksQ0FDTixFQUFFLG9CQUFvQixFQUFFLEVBQ3hCLG1FQUFtRSxvQkFBb0IsQ0FBQyxRQUFRLEVBQUUsT0FBTyxZQUFZLENBQUMsUUFBUSxFQUFFLEVBQUUsQ0FDbkksQ0FBQTtRQUVELE9BQU8sQ0FDTCxNQUFBLDJCQUEyQixDQUFDLEdBQUcsQ0FBQyxvQkFBb0IsQ0FBQyxRQUFRLEVBQUUsQ0FBQyxtQ0FDaEUsMkJBQTJCLENBQUMsR0FBRyxDQUFDLFlBQVksQ0FBQyxRQUFRLEVBQUUsQ0FBQyxDQUN6RCxDQUFBO0lBQ0gsQ0FBQztJQUVEOzs7Ozs7O09BT0c7SUFDSyxtQkFBbUIsQ0FDekIsTUFBZ0MsRUFDaEMsVUFBaUIsRUFDakIsU0FBb0I7UUFFcEIsSUFBSSxTQUFTLElBQUksU0FBUyxDQUFDLFdBQVcsRUFBRTtZQUN0QyxPQUFPLEVBQUUsT0FBTyxFQUFFLE1BQU0sQ0FBQyxRQUFRLENBQUMsT0FBTyxFQUFFLFFBQVEsRUFBRSxVQUFVLEVBQUUsQ0FBQTtTQUNsRTthQUFNO1lBQ0wsT0FBTyxFQUFFLE9BQU8sRUFBRSxVQUFVLEVBQUUsUUFBUSxFQUFFLE1BQU0sQ0FBQyxRQUFRLENBQUMsT0FBTyxFQUFFLENBQUE7U0FDbEU7SUFDSCxDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBDYWNoZWRSb3V0ZXMsIENhY2hlTW9kZSwgQ2hhaW5JZCwgSVJvdXRlQ2FjaGluZ1Byb3ZpZGVyLCBsb2cgfSBmcm9tICdAdGFydHotb25lL3NtYXJ0LW9yZGVyLXJvdXRlcidcbmltcG9ydCB7IER5bmFtb0RCIH0gZnJvbSAnYXdzLXNkaydcbmltcG9ydCB7IEN1cnJlbmN5LCBDdXJyZW5jeUFtb3VudCwgVG9rZW4sIFRyYWRlVHlwZSB9IGZyb20gJ0B1bmlzd2FwL3Nkay1jb3JlJ1xuaW1wb3J0IHsgUHJvdG9jb2wgfSBmcm9tICdAdW5pc3dhcC9yb3V0ZXItc2RrJ1xuaW1wb3J0IHsgQ0FDSEVEX1JPVVRFU19DT05GSUdVUkFUSU9OIH0gZnJvbSAnLi9jYWNoZWQtcm91dGVzLWNvbmZpZ3VyYXRpb24nXG5pbXBvcnQgeyBQYWlyVHJhZGVUeXBlQ2hhaW5JZCB9IGZyb20gJy4vbW9kZWwvcGFpci10cmFkZS10eXBlLWNoYWluLWlkJ1xuaW1wb3J0IHsgQ2FjaGVkUm91dGVzTWFyc2hhbGxlciB9IGZyb20gJy4vbWFyc2hhbGxpbmcvY2FjaGVkLXJvdXRlcy1tYXJzaGFsbGVyJ1xuaW1wb3J0IHsgQ2FjaGVkUm91dGVzU3RyYXRlZ3kgfSBmcm9tICcuL21vZGVsL2NhY2hlZC1yb3V0ZXMtc3RyYXRlZ3knXG5pbXBvcnQgeyBQcm90b2NvbHNCdWNrZXRCbG9ja051bWJlciB9IGZyb20gJy4vbW9kZWwvcHJvdG9jb2xzLWJ1Y2tldC1ibG9jay1udW1iZXInXG5cbmludGVyZmFjZSBDb25zdHJ1Y3RvclBhcmFtcyB7XG4gIC8qKlxuICAgKiBUaGUgVGFibGVOYW1lIGZvciB0aGUgRHluYW1vREIgVGFibGUuIFRoaXMgaXMgd2lyZWQgaW4gZnJvbSB0aGUgQ0RLIGRlZmluaXRpb24uXG4gICAqL1xuICBjYWNoZWRSb3V0ZXNUYWJsZU5hbWU6IHN0cmluZ1xuICAvKipcbiAgICogVGhlIGFtb3VudCBvZiBtaW51dGVzIHRoYXQgYSBDYWNoZWRSb3V0ZSBzaG91bGQgbGl2ZSBpbiB0aGUgZGF0YWJhc2UuXG4gICAqIFRoaXMgaXMgdXNlZCB0byBsaW1pdCB0aGUgZGF0YWJhc2UgZ3Jvd3RoLCBEeW5hbW8gd2lsbCBhdXRvbWF0aWNhbGx5IGRlbGV0ZSBleHBpcmVkIGVudHJpZXMuXG4gICAqL1xuICB0dGxNaW51dGVzPzogbnVtYmVyXG59XG5cbmV4cG9ydCBjbGFzcyBEeW5hbW9Sb3V0ZUNhY2hpbmdQcm92aWRlciBleHRlbmRzIElSb3V0ZUNhY2hpbmdQcm92aWRlciB7XG4gIHByaXZhdGUgcmVhZG9ubHkgZGRiQ2xpZW50OiBEeW5hbW9EQi5Eb2N1bWVudENsaWVudFxuICBwcml2YXRlIHJlYWRvbmx5IHRhYmxlTmFtZTogc3RyaW5nXG4gIHByaXZhdGUgcmVhZG9ubHkgdHRsTWludXRlczogbnVtYmVyXG5cbiAgY29uc3RydWN0b3IoeyBjYWNoZWRSb3V0ZXNUYWJsZU5hbWUsIHR0bE1pbnV0ZXMgPSAyIH06IENvbnN0cnVjdG9yUGFyYW1zKSB7XG4gICAgc3VwZXIoKVxuICAgIC8vIFNpbmNlIHRoaXMgRERCIFRhYmxlIGlzIHVzZWQgZm9yIENhY2hlLCB3ZSB3aWxsIGZhaWwgZmFzdCBhbmQgbGltaXQgdGhlIHRpbWVvdXQuXG4gICAgdGhpcy5kZGJDbGllbnQgPSBuZXcgRHluYW1vREIuRG9jdW1lbnRDbGllbnQoe1xuICAgICAgbWF4UmV0cmllczogMSxcbiAgICAgIHJldHJ5RGVsYXlPcHRpb25zOiB7XG4gICAgICAgIGJhc2U6IDIwLFxuICAgICAgfSxcbiAgICAgIGh0dHBPcHRpb25zOiB7XG4gICAgICAgIHRpbWVvdXQ6IDEwMCxcbiAgICAgIH0sXG4gICAgfSlcbiAgICB0aGlzLnRhYmxlTmFtZSA9IGNhY2hlZFJvdXRlc1RhYmxlTmFtZVxuICAgIHRoaXMudHRsTWludXRlcyA9IHR0bE1pbnV0ZXNcbiAgfVxuXG4gIC8qKlxuICAgKiBJbXBsZW1lbnRhdGlvbiBvZiB0aGUgYWJzdHJhY3QgbWV0aG9kIGRlZmluZWQgaW4gYElSb3V0ZUNhY2hpbmdQcm92aWRlcmBcbiAgICogR2l2ZW4gYSBDYWNoZWRSb3V0ZXNTdHJhdGVneSAoZnJvbSBDQUNIRURfUk9VVEVTX0NPTkZJR1VSQVRJT04pLFxuICAgKiB3ZSB3aWxsIGZpbmQgdGhlIEJsb2Nrc1RvTGl2ZSBhc3NvY2lhdGVkIHRvIHRoZSBidWNrZXQuXG4gICAqXG4gICAqIEBwYXJhbSBjYWNoZWRSb3V0ZXNcbiAgICogQHBhcmFtIGFtb3VudFxuICAgKiBAcHJvdGVjdGVkXG4gICAqL1xuICBwcm90ZWN0ZWQgYXN5bmMgX2dldEJsb2Nrc1RvTGl2ZShjYWNoZWRSb3V0ZXM6IENhY2hlZFJvdXRlcywgYW1vdW50OiBDdXJyZW5jeUFtb3VudDxDdXJyZW5jeT4pOiBQcm9taXNlPG51bWJlcj4ge1xuICAgIGNvbnN0IGNhY2hlZFJvdXRlc1N0cmF0ZWd5ID0gdGhpcy5nZXRDYWNoZWRSb3V0ZXNTdHJhdGVneUZyb21DYWNoZWRSb3V0ZXMoY2FjaGVkUm91dGVzKVxuICAgIGNvbnN0IGNhY2hpbmdQYXJhbWV0ZXJzID0gY2FjaGVkUm91dGVzU3RyYXRlZ3k/LmdldENhY2hpbmdCdWNrZXQoYW1vdW50KVxuXG4gICAgaWYgKGNhY2hpbmdQYXJhbWV0ZXJzKSB7XG4gICAgICByZXR1cm4gY2FjaGluZ1BhcmFtZXRlcnMuYmxvY2tzVG9MaXZlXG4gICAgfSBlbHNlIHtcbiAgICAgIHJldHVybiAwXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEltcGxlbWVudGF0aW9uIG9mIHRoZSBhYnN0cmFjdCBtZXRob2QgZGVmaW5lZCBpbiBgSVJvdXRlQ2FjaGluZ1Byb3ZpZGVyYFxuICAgKiBGZXRjaCB0aGUgbW9zdCByZWNlbnQgZW50cnkgZnJvbSB0aGUgRHluYW1vREIgdGFibGUgZm9yIHRoYXQgcGFpciwgdHJhZGVUeXBlLCBjaGFpbklkLCBwcm90b2NvbHMgYW5kIGJ1Y2tldFxuICAgKlxuICAgKiBAcGFyYW0gY2hhaW5JZFxuICAgKiBAcGFyYW0gYW1vdW50XG4gICAqIEBwYXJhbSBxdW90ZVRva2VuXG4gICAqIEBwYXJhbSB0cmFkZVR5cGVcbiAgICogQHBhcmFtIHByb3RvY29sc1xuICAgKiBAcHJvdGVjdGVkXG4gICAqL1xuICBwcm90ZWN0ZWQgYXN5bmMgX2dldENhY2hlZFJvdXRlKFxuICAgIGNoYWluSWQ6IENoYWluSWQsXG4gICAgYW1vdW50OiBDdXJyZW5jeUFtb3VudDxDdXJyZW5jeT4sXG4gICAgcXVvdGVUb2tlbjogVG9rZW4sXG4gICAgdHJhZGVUeXBlOiBUcmFkZVR5cGUsXG4gICAgcHJvdG9jb2xzOiBQcm90b2NvbFtdXG4gICk6IFByb21pc2U8Q2FjaGVkUm91dGVzIHwgdW5kZWZpbmVkPiB7XG4gICAgY29uc3QgeyB0b2tlbkluLCB0b2tlbk91dCB9ID0gdGhpcy5kZXRlcm1pbmVUb2tlbkluT3V0KGFtb3VudCwgcXVvdGVUb2tlbiwgdHJhZGVUeXBlKVxuICAgIGNvbnN0IGNhY2hlZFJvdXRlc1N0cmF0ZWd5ID0gdGhpcy5nZXRDYWNoZWRSb3V0ZXNTdHJhdGVneSh0b2tlbkluLCB0b2tlbk91dCwgdHJhZGVUeXBlLCBjaGFpbklkKVxuICAgIGNvbnN0IGNhY2hpbmdQYXJhbWV0ZXJzID0gY2FjaGVkUm91dGVzU3RyYXRlZ3k/LmdldENhY2hpbmdCdWNrZXQoYW1vdW50KVxuXG4gICAgaWYgKGNhY2hpbmdQYXJhbWV0ZXJzKSB7XG4gICAgICBjb25zdCBwYXJ0aXRpb25LZXkgPSBuZXcgUGFpclRyYWRlVHlwZUNoYWluSWQoe1xuICAgICAgICB0b2tlbkluOiB0b2tlbkluLmFkZHJlc3MsXG4gICAgICAgIHRva2VuT3V0OiB0b2tlbk91dC5hZGRyZXNzLFxuICAgICAgICB0cmFkZVR5cGUsXG4gICAgICAgIGNoYWluSWQsXG4gICAgICB9KVxuICAgICAgY29uc3QgcGFydGlhbFNvcnRLZXkgPSBuZXcgUHJvdG9jb2xzQnVja2V0QmxvY2tOdW1iZXIoe1xuICAgICAgICBwcm90b2NvbHMsXG4gICAgICAgIGJ1Y2tldDogY2FjaGluZ1BhcmFtZXRlcnMuYnVja2V0LFxuICAgICAgfSlcblxuICAgICAgY29uc3QgcXVlcnlQYXJhbXMgPSB7XG4gICAgICAgIFRhYmxlTmFtZTogdGhpcy50YWJsZU5hbWUsXG4gICAgICAgIC8vIFNpbmNlIHdlIGRvbid0IGtub3cgd2hhdCdzIHRoZSBsYXRlc3QgYmxvY2sgdGhhdCB3ZSBoYXZlIGluIGNhY2hlLCB3ZSBtYWtlIGEgcXVlcnkgd2l0aCBhIHBhcnRpYWwgc29ydCBrZXlcbiAgICAgICAgS2V5Q29uZGl0aW9uRXhwcmVzc2lvbjogJyNwayA9IDpwayBhbmQgYmVnaW5zX3dpdGgoI3NrLCA6c2spJyxcbiAgICAgICAgRXhwcmVzc2lvbkF0dHJpYnV0ZU5hbWVzOiB7XG4gICAgICAgICAgJyNwayc6ICdwYWlyVHJhZGVUeXBlQ2hhaW5JZCcsXG4gICAgICAgICAgJyNzayc6ICdwcm90b2NvbHNCdWNrZXRCbG9ja051bWJlcicsXG4gICAgICAgIH0sXG4gICAgICAgIEV4cHJlc3Npb25BdHRyaWJ1dGVWYWx1ZXM6IHtcbiAgICAgICAgICAnOnBrJzogcGFydGl0aW9uS2V5LnRvU3RyaW5nKCksXG4gICAgICAgICAgJzpzayc6IHBhcnRpYWxTb3J0S2V5LnByb3RvY29sc0J1Y2tldFBhcnRpYWxLZXkoKSxcbiAgICAgICAgfSxcbiAgICAgICAgU2NhbkluZGV4Rm9yd2FyZDogZmFsc2UsIC8vIFJldmVyc2Ugb3JkZXIgdG8gcmV0cmlldmUgbW9zdCByZWNlbnQgaXRlbSBmaXJzdFxuICAgICAgICBMaW1pdDogMSwgLy8gT25seSByZXRyaWV2ZSB0aGUgbW9zdCByZWNlbnQgaXRlbVxuICAgICAgfVxuXG4gICAgICB0cnkge1xuICAgICAgICBsb2cuaW5mbyh7IHF1ZXJ5UGFyYW1zIH0sIGBbRHluYW1vUm91dGVDYWNoaW5nUHJvdmlkZXJdIEF0dGVtcHRpbmcgdG8gZ2V0IHJvdXRlIGZyb20gY2FjaGUuYClcblxuICAgICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLmRkYkNsaWVudC5xdWVyeShxdWVyeVBhcmFtcykucHJvbWlzZSgpXG5cbiAgICAgICAgbG9nLmluZm8oeyByZXN1bHQgfSwgYFtEeW5hbW9Sb3V0ZUNhY2hpbmdQcm92aWRlcl0gR290IHRoZSBmb2xsb3dpbmcgcmVzcG9uc2UgZnJvbSBxdWVyeWluZyBjYWNoZWApXG5cbiAgICAgICAgaWYgKHJlc3VsdC5JdGVtcyAmJiByZXN1bHQuSXRlbXMubGVuZ3RoID4gMCkge1xuICAgICAgICAgIC8vIElmIHdlIGdvdCBhIHJlc3BvbnNlIHdpdGggbW9yZSB0aGFuIDEgaXRlbSwgd2UgZXh0cmFjdCB0aGUgYmluYXJ5IGZpZWxkIGZyb20gdGhlIHJlc3BvbnNlXG4gICAgICAgICAgY29uc3QgaXRlbUJpbmFyeSA9IHJlc3VsdC5JdGVtc1swXT8uaXRlbVxuICAgICAgICAgIC8vIFRoZW4gd2UgY29udmVydCBpdCBpbnRvIGEgQnVmZmVyXG4gICAgICAgICAgY29uc3QgY2FjaGVkUm91dGVzQnVmZmVyID0gQnVmZmVyLmZyb20oaXRlbUJpbmFyeSlcbiAgICAgICAgICAvLyBXZSBjb252ZXJ0IHRoYXQgYnVmZmVyIGludG8gc3RyaW5nIGFuZCBwYXJzZSBhcyBKU09OIChpdCB3YXMgZW5jb2RlZCBhcyBKU09OIHdoZW4gaXQgd2FzIGluc2VydGVkIGludG8gY2FjaGUpXG4gICAgICAgICAgY29uc3QgY2FjaGVkUm91dGVzSnNvbiA9IEpTT04ucGFyc2UoY2FjaGVkUm91dGVzQnVmZmVyLnRvU3RyaW5nKCkpXG4gICAgICAgICAgLy8gRmluYWxseSB3ZSB1bm1hcnNoYWwgdGhhdCBKU09OIGludG8gYSBgQ2FjaGVkUm91dGVzYCBvYmplY3RcbiAgICAgICAgICBjb25zdCBjYWNoZWRSb3V0ZXM6IENhY2hlZFJvdXRlcyA9IENhY2hlZFJvdXRlc01hcnNoYWxsZXIudW5tYXJzaGFsKGNhY2hlZFJvdXRlc0pzb24pXG5cbiAgICAgICAgICBsb2cuaW5mbyh7IGNhY2hlZFJvdXRlcyB9LCBgW0R5bmFtb1JvdXRlQ2FjaGluZ1Byb3ZpZGVyXSBSZXR1cm5pbmcgdGhlIGNhY2hlZCBhbmQgdW5tYXJzaGFsbGVkIHJvdXRlLmApXG5cbiAgICAgICAgICByZXR1cm4gY2FjaGVkUm91dGVzXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgbG9nLmluZm8oYFtEeW5hbW9Sb3V0ZUNhY2hpbmdQcm92aWRlcl0gTm8gaXRlbXMgZm91bmQgaW4gdGhlIHF1ZXJ5IHJlc3BvbnNlLmApXG4gICAgICAgIH1cbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGxvZy5lcnJvcih7IHF1ZXJ5UGFyYW1zLCBlcnJvciB9LCBgW0R5bmFtb1JvdXRlQ2FjaGluZ1Byb3ZpZGVyXSBFcnJvciB3aGlsZSBmZXRjaGluZyByb3V0ZSBmcm9tIGNhY2hlYClcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBXZSBvbmx5IGdldCBoZXJlIGlmIHdlIGRpZG4ndCBmaW5kIGEgY2FjaGVkUm91dGVzXG4gICAgcmV0dXJuIHVuZGVmaW5lZFxuICB9XG5cbiAgLyoqXG4gICAqIEltcGxlbWVudGF0aW9uIG9mIHRoZSBhYnN0cmFjdCBtZXRob2QgZGVmaW5lZCBpbiBgSVJvdXRlQ2FjaGluZ1Byb3ZpZGVyYFxuICAgKiBBdHRlbXB0cyB0byBpbnNlcnQgdGhlIGBDYWNoZWRSb3V0ZXNgIG9iamVjdCBpbnRvIGNhY2hlLCBpZiB0aGUgQ2FjaGluZ1N0cmF0ZWd5IHJldHVybnMgdGhlIENhY2hpbmdQYXJhbWV0ZXJzXG4gICAqXG4gICAqIEBwYXJhbSBjYWNoZWRSb3V0ZXNcbiAgICogQHBhcmFtIGFtb3VudFxuICAgKiBAcHJvdGVjdGVkXG4gICAqL1xuICBwcm90ZWN0ZWQgYXN5bmMgX3NldENhY2hlZFJvdXRlKGNhY2hlZFJvdXRlczogQ2FjaGVkUm91dGVzLCBhbW91bnQ6IEN1cnJlbmN5QW1vdW50PEN1cnJlbmN5Pik6IFByb21pc2U8Ym9vbGVhbj4ge1xuICAgIGNvbnN0IGNhY2hlZFJvdXRlc1N0cmF0ZWd5ID0gdGhpcy5nZXRDYWNoZWRSb3V0ZXNTdHJhdGVneUZyb21DYWNoZWRSb3V0ZXMoY2FjaGVkUm91dGVzKVxuICAgIGNvbnN0IGNhY2hpbmdQYXJhbWV0ZXJzID0gY2FjaGVkUm91dGVzU3RyYXRlZ3k/LmdldENhY2hpbmdCdWNrZXQoYW1vdW50KVxuXG4gICAgaWYgKGNhY2hpbmdQYXJhbWV0ZXJzKSB7XG4gICAgICAvLyBUVEwgaXMgbWludXRlcyBmcm9tIG5vdy4gbXVsdGlwbHkgdHRsTWludXRlcyB0aW1lcyA2MCB0byBjb252ZXJ0IHRvIHNlY29uZHMsIHNpbmNlIHR0bCBpcyBpbiBzZWNvbmRzLlxuICAgICAgY29uc3QgdHRsID0gTWF0aC5mbG9vcihEYXRlLm5vdygpIC8gMTAwMCkgKyA2MCAqIHRoaXMudHRsTWludXRlc1xuICAgICAgLy8gTWFyc2hhbCB0aGUgQ2FjaGVkUm91dGVzIG9iamVjdCBpbiBwcmVwYXJhdGlvbiBmb3Igc3RvcmluZyBpbiBEeW5hbW9EQlxuICAgICAgY29uc3QgbWFyc2hhbGxlZENhY2hlZFJvdXRlcyA9IENhY2hlZFJvdXRlc01hcnNoYWxsZXIubWFyc2hhbChjYWNoZWRSb3V0ZXMpXG4gICAgICAvLyBDb252ZXJ0IHRoZSBtYXJzaGFsbGVkQ2FjaGVkUm91dGVzIHRvIEpTT04gc3RyaW5nXG4gICAgICBjb25zdCBqc29uQ2FjaGVkUm91dGVzID0gSlNPTi5zdHJpbmdpZnkobWFyc2hhbGxlZENhY2hlZFJvdXRlcylcbiAgICAgIC8vIEVuY29kZSB0aGUganNvbkNhY2hlZFJvdXRlcyBpbnRvIEJpbmFyeVxuICAgICAgY29uc3QgYmluYXJ5Q2FjaGVkUm91dGVzID0gQnVmZmVyLmZyb20oanNvbkNhY2hlZFJvdXRlcylcblxuICAgICAgLy8gUHJpbWFyeSBLZXkgb2JqZWN0XG4gICAgICBjb25zdCBwYXJ0aXRpb25LZXkgPSBQYWlyVHJhZGVUeXBlQ2hhaW5JZC5mcm9tQ2FjaGVkUm91dGVzKGNhY2hlZFJvdXRlcylcbiAgICAgIGNvbnN0IHNvcnRLZXkgPSBuZXcgUHJvdG9jb2xzQnVja2V0QmxvY2tOdW1iZXIoe1xuICAgICAgICBwcm90b2NvbHM6IGNhY2hlZFJvdXRlcy5wcm90b2NvbHNDb3ZlcmVkLFxuICAgICAgICBidWNrZXQ6IGNhY2hpbmdQYXJhbWV0ZXJzLmJ1Y2tldCxcbiAgICAgICAgYmxvY2tOdW1iZXI6IGNhY2hlZFJvdXRlcy5ibG9ja051bWJlcixcbiAgICAgIH0pXG5cbiAgICAgIGNvbnN0IHB1dFBhcmFtcyA9IHtcbiAgICAgICAgVGFibGVOYW1lOiB0aGlzLnRhYmxlTmFtZSxcbiAgICAgICAgSXRlbToge1xuICAgICAgICAgIHBhaXJUcmFkZVR5cGVDaGFpbklkOiBwYXJ0aXRpb25LZXkudG9TdHJpbmcoKSxcbiAgICAgICAgICBwcm90b2NvbHNCdWNrZXRCbG9ja051bWJlcjogc29ydEtleS5mdWxsS2V5KCksXG4gICAgICAgICAgaXRlbTogYmluYXJ5Q2FjaGVkUm91dGVzLFxuICAgICAgICAgIHR0bDogdHRsLFxuICAgICAgICB9LFxuICAgICAgfVxuXG4gICAgICBsb2cuaW5mbyhcbiAgICAgICAgeyBwdXRQYXJhbXMsIGNhY2hlZFJvdXRlcywganNvbkNhY2hlZFJvdXRlcyB9LFxuICAgICAgICBgW0R5bmFtb1JvdXRlQ2FjaGluZ1Byb3ZpZGVyXSBBdHRlbXB0aW5nIHRvIGluc2VydCByb3V0ZSB0byBjYWNoZWBcbiAgICAgIClcblxuICAgICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgdGhpcy5kZGJDbGllbnQucHV0KHB1dFBhcmFtcykucHJvbWlzZSgpXG4gICAgICAgIGxvZy5pbmZvKGBbRHluYW1vUm91dGVDYWNoaW5nUHJvdmlkZXJdIENhY2hlZCByb3V0ZSBpbnNlcnRlZCB0byBjYWNoZWApXG5cbiAgICAgICAgcmV0dXJuIHRydWVcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGxvZy5lcnJvcih7IGVycm9yLCBwdXRQYXJhbXMgfSwgYFtEeW5hbW9Sb3V0ZUNhY2hpbmdQcm92aWRlcl0gQ2FjaGVkIHJvdXRlIGZhaWxlZCB0byBpbnNlcnRgKVxuXG4gICAgICAgIHJldHVybiBmYWxzZVxuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICAvLyBObyBDYWNoaW5nUGFyYW1ldGVycyBmb3VuZCwgcmV0dXJuIGZhbHNlIHRvIGluZGljYXRlIHRoZSByb3V0ZSB3YXMgbm90IGNhY2hlZC5cblxuICAgICAgcmV0dXJuIGZhbHNlXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEltcGxlbWVudGF0aW9uIG9mIHRoZSBhYnN0cmFjdCBtZXRob2QgZGVmaW5lZCBpbiBgSVJvdXRlQ2FjaGluZ1Byb3ZpZGVyYFxuICAgKiBPYnRhaW5zIHRoZSBDYWNoZU1vZGUgZnJvbSB0aGUgQ2FjaGluZ1N0cmF0ZWd5LCBpZiBub3QgZm91bmQsIHRoZW4gcmV0dXJuIERhcmttb2RlLlxuICAgKlxuICAgKiBAcGFyYW0gY2hhaW5JZFxuICAgKiBAcGFyYW0gYW1vdW50XG4gICAqIEBwYXJhbSBxdW90ZVRva2VuXG4gICAqIEBwYXJhbSB0cmFkZVR5cGVcbiAgICogQHBhcmFtIF9wcm90b2NvbHNcbiAgICovXG4gIHB1YmxpYyBhc3luYyBnZXRDYWNoZU1vZGUoXG4gICAgY2hhaW5JZDogQ2hhaW5JZCxcbiAgICBhbW91bnQ6IEN1cnJlbmN5QW1vdW50PEN1cnJlbmN5PixcbiAgICBxdW90ZVRva2VuOiBUb2tlbixcbiAgICB0cmFkZVR5cGU6IFRyYWRlVHlwZSxcbiAgICBfcHJvdG9jb2xzOiBQcm90b2NvbFtdXG4gICk6IFByb21pc2U8Q2FjaGVNb2RlPiB7XG4gICAgY29uc3QgeyB0b2tlbkluLCB0b2tlbk91dCB9ID0gdGhpcy5kZXRlcm1pbmVUb2tlbkluT3V0KGFtb3VudCwgcXVvdGVUb2tlbiwgdHJhZGVUeXBlKVxuICAgIGNvbnN0IGNhY2hlZFJvdXRlc1N0cmF0ZWd5ID0gdGhpcy5nZXRDYWNoZWRSb3V0ZXNTdHJhdGVneSh0b2tlbkluLCB0b2tlbk91dCwgdHJhZGVUeXBlLCBjaGFpbklkKVxuICAgIGNvbnN0IGNhY2hpbmdQYXJhbWV0ZXJzID0gY2FjaGVkUm91dGVzU3RyYXRlZ3k/LmdldENhY2hpbmdCdWNrZXQoYW1vdW50KVxuXG4gICAgaWYgKGNhY2hpbmdQYXJhbWV0ZXJzKSB7XG4gICAgICBsb2cuaW5mbyhcbiAgICAgICAge1xuICAgICAgICAgIGNhY2hpbmdQYXJhbWV0ZXJzOiBjYWNoaW5nUGFyYW1ldGVycyxcbiAgICAgICAgICB0b2tlbkluOiB0b2tlbkluLmFkZHJlc3MsXG4gICAgICAgICAgdG9rZW5PdXQ6IHRva2VuT3V0LmFkZHJlc3MsXG4gICAgICAgICAgcGFpcjogYCR7dG9rZW5Jbi5zeW1ib2x9LyR7dG9rZW5PdXQuc3ltYm9sfWAsXG4gICAgICAgICAgY2hhaW5JZCxcbiAgICAgICAgICB0cmFkZVR5cGUsXG4gICAgICAgICAgYW1vdW50OiBhbW91bnQudG9FeGFjdCgpLFxuICAgICAgICB9LFxuICAgICAgICBgW0R5bmFtb1JvdXRlQ2FjaGluZ1Byb3ZpZGVyXSBHb3QgQ2FjaGluZ1BhcmFtZXRlcnMgZm9yICR7YW1vdW50LnRvRXhhY3QoKX0gaW4gJHt0b2tlbkluLnN5bWJvbH0vJHtcbiAgICAgICAgICB0b2tlbk91dC5zeW1ib2xcbiAgICAgICAgfS8ke3RyYWRlVHlwZX0vJHtjaGFpbklkfWBcbiAgICAgIClcblxuICAgICAgcmV0dXJuIGNhY2hpbmdQYXJhbWV0ZXJzLmNhY2hlTW9kZVxuICAgIH0gZWxzZSB7XG4gICAgICBsb2cuaW5mbyhcbiAgICAgICAge1xuICAgICAgICAgIHRva2VuSW46IHRva2VuSW4uYWRkcmVzcyxcbiAgICAgICAgICB0b2tlbk91dDogdG9rZW5PdXQuYWRkcmVzcyxcbiAgICAgICAgICBwYWlyOiBgJHt0b2tlbkluLnN5bWJvbH0vJHt0b2tlbk91dC5zeW1ib2x9YCxcbiAgICAgICAgICBjaGFpbklkLFxuICAgICAgICAgIHRyYWRlVHlwZSxcbiAgICAgICAgICBhbW91bnQ6IGFtb3VudC50b0V4YWN0KCksXG4gICAgICAgIH0sXG4gICAgICAgIGBbRHluYW1vUm91dGVDYWNoaW5nUHJvdmlkZXJdIERpZG4ndCBmaW5kIENhY2hpbmdQYXJhbWV0ZXJzIGZvciAke2Ftb3VudC50b0V4YWN0KCl9IGluICR7dG9rZW5Jbi5zeW1ib2x9LyR7XG4gICAgICAgICAgdG9rZW5PdXQuc3ltYm9sXG4gICAgICAgIH0vJHt0cmFkZVR5cGV9LyR7Y2hhaW5JZH1gXG4gICAgICApXG5cbiAgICAgIHJldHVybiBDYWNoZU1vZGUuRGFya21vZGVcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogSGVscGVyIGZ1bmN0aW9uIHRvIGZldGNoIHRoZSBDYWNoaW5nU3RyYXRlZ3kgdXNpbmcgQ2FjaGVkUm91dGVzIGFzIGlucHV0XG4gICAqXG4gICAqIEBwYXJhbSBjYWNoZWRSb3V0ZXNcbiAgICogQHByaXZhdGVcbiAgICovXG4gIHByaXZhdGUgZ2V0Q2FjaGVkUm91dGVzU3RyYXRlZ3lGcm9tQ2FjaGVkUm91dGVzKGNhY2hlZFJvdXRlczogQ2FjaGVkUm91dGVzKTogQ2FjaGVkUm91dGVzU3RyYXRlZ3kgfCB1bmRlZmluZWQge1xuICAgIHJldHVybiB0aGlzLmdldENhY2hlZFJvdXRlc1N0cmF0ZWd5KFxuICAgICAgY2FjaGVkUm91dGVzLnRva2VuSW4sXG4gICAgICBjYWNoZWRSb3V0ZXMudG9rZW5PdXQsXG4gICAgICBjYWNoZWRSb3V0ZXMudHJhZGVUeXBlLFxuICAgICAgY2FjaGVkUm91dGVzLmNoYWluSWRcbiAgICApXG4gIH1cblxuICAvKipcbiAgICogSGVscGVyIGZ1bmN0aW9uIHRvIG9idGFpbiB0aGUgQ2FjaGluZyBzdHJhdGVneSBmcm9tIHRoZSBDQUNIRURfUk9VVEVTX0NPTkZJR1VSQVRJT05cbiAgICpcbiAgICogQHBhcmFtIHRva2VuSW5cbiAgICogQHBhcmFtIHRva2VuT3V0XG4gICAqIEBwYXJhbSB0cmFkZVR5cGVcbiAgICogQHBhcmFtIGNoYWluSWRcbiAgICogQHByaXZhdGVcbiAgICovXG4gIHByaXZhdGUgZ2V0Q2FjaGVkUm91dGVzU3RyYXRlZ3koXG4gICAgdG9rZW5JbjogVG9rZW4sXG4gICAgdG9rZW5PdXQ6IFRva2VuLFxuICAgIHRyYWRlVHlwZTogVHJhZGVUeXBlLFxuICAgIGNoYWluSWQ6IENoYWluSWRcbiAgKTogQ2FjaGVkUm91dGVzU3RyYXRlZ3kgfCB1bmRlZmluZWQge1xuICAgIGNvbnN0IHBhaXJUcmFkZVR5cGVDaGFpbklkID0gbmV3IFBhaXJUcmFkZVR5cGVDaGFpbklkKHtcbiAgICAgIHRva2VuSW46IHRva2VuSW4uYWRkcmVzcyxcbiAgICAgIHRva2VuT3V0OiB0b2tlbk91dC5hZGRyZXNzLFxuICAgICAgdHJhZGVUeXBlOiB0cmFkZVR5cGUsXG4gICAgICBjaGFpbklkOiBjaGFpbklkLFxuICAgIH0pXG5cbiAgICAvLyBXZSBzdXBwb3J0IGxvb2tpbmcgZm9yIGFueSB0b2tlbiBwYWlyZWQgd2l0aCB0b2tlbkluIHdoZW4gdHJhZGVUeXBlIGlzIEV4YWN0SW5cbiAgICAvLyBXZSBjb3VsZCBhbHNvIHN1cHBvcnQgdGhlIGludmVyc2UgZm9yIHRva2VuT3V0IGFuZCBFeGFjdE91dCwgYnV0IHRob3NlIHF1b3RlcyBkb24ndCBoYXZlIGVub3VnaCByZXF1ZXN0c1xuICAgIGNvbnN0IHdpdGhXaWxkY2FyZCA9IG5ldyBQYWlyVHJhZGVUeXBlQ2hhaW5JZCh7XG4gICAgICB0b2tlbkluOiB0b2tlbkluLmFkZHJlc3MsXG4gICAgICB0b2tlbk91dDogJyonLFxuICAgICAgdHJhZGVUeXBlOiBUcmFkZVR5cGUuRVhBQ1RfSU5QVVQsXG4gICAgICBjaGFpbklkOiBjaGFpbklkLFxuICAgIH0pXG5cbiAgICBsb2cuaW5mbyhcbiAgICAgIHsgcGFpclRyYWRlVHlwZUNoYWluSWQgfSxcbiAgICAgIGBbRHluYW1vUm91dGVDYWNoaW5nUHJvdmlkZXJdIExvb2tpbmcgZm9yIGNhY2hlIGNvbmZpZ3VyYXRpb24gb2YgJHtwYWlyVHJhZGVUeXBlQ2hhaW5JZC50b1N0cmluZygpfSBvciAke3dpdGhXaWxkY2FyZC50b1N0cmluZygpfWBcbiAgICApXG5cbiAgICByZXR1cm4gKFxuICAgICAgQ0FDSEVEX1JPVVRFU19DT05GSUdVUkFUSU9OLmdldChwYWlyVHJhZGVUeXBlQ2hhaW5JZC50b1N0cmluZygpKSA/P1xuICAgICAgQ0FDSEVEX1JPVVRFU19DT05GSUdVUkFUSU9OLmdldCh3aXRoV2lsZGNhcmQudG9TdHJpbmcoKSlcbiAgICApXG4gIH1cblxuICAvKipcbiAgICogSGVscGVyIGZ1bmN0aW9uIHRvIGRldGVybWluZSB0aGUgdG9rZW5JbiBhbmQgdG9rZW5PdXQgZ2l2ZW4gdGhlIHRyYWRlVHlwZSwgcXVvdGVUb2tlbiBhbmQgYW1vdW50LmN1cnJlbmN5XG4gICAqXG4gICAqIEBwYXJhbSBhbW91bnRcbiAgICogQHBhcmFtIHF1b3RlVG9rZW5cbiAgICogQHBhcmFtIHRyYWRlVHlwZVxuICAgKiBAcHJpdmF0ZVxuICAgKi9cbiAgcHJpdmF0ZSBkZXRlcm1pbmVUb2tlbkluT3V0KFxuICAgIGFtb3VudDogQ3VycmVuY3lBbW91bnQ8Q3VycmVuY3k+LFxuICAgIHF1b3RlVG9rZW46IFRva2VuLFxuICAgIHRyYWRlVHlwZTogVHJhZGVUeXBlXG4gICk6IHsgdG9rZW5JbjogVG9rZW47IHRva2VuT3V0OiBUb2tlbiB9IHtcbiAgICBpZiAodHJhZGVUeXBlID09IFRyYWRlVHlwZS5FWEFDVF9JTlBVVCkge1xuICAgICAgcmV0dXJuIHsgdG9rZW5JbjogYW1vdW50LmN1cnJlbmN5LndyYXBwZWQsIHRva2VuT3V0OiBxdW90ZVRva2VuIH1cbiAgICB9IGVsc2Uge1xuICAgICAgcmV0dXJuIHsgdG9rZW5JbjogcXVvdGVUb2tlbiwgdG9rZW5PdXQ6IGFtb3VudC5jdXJyZW5jeS53cmFwcGVkIH1cbiAgICB9XG4gIH1cbn1cbiJdfQ==