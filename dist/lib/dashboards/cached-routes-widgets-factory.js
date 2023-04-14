import _ from 'lodash';
import { CACHED_ROUTES_CONFIGURATION } from '../handlers/router-entities/route-caching';
import { TradeType } from '@uniswap/sdk-core';
export class CachedRoutesWidgetsFactory {
    constructor(namespace, region, lambdaName) {
        this.region = region;
        this.namespace = namespace;
        this.lambdaName = lambdaName;
    }
    generateWidgets() {
        const cacheHitMissWidgets = this.generateCacheHitMissMetricsWidgets();
        const [wildcardStrategies, strategies] = _.partition(Array.from(CACHED_ROUTES_CONFIGURATION.values()), (strategy) => strategy.pair.includes('*'));
        let wildcardStrategiesWidgets = [];
        if (wildcardStrategies.length > 0) {
            wildcardStrategiesWidgets = _.flatMap(wildcardStrategies, (cacheStrategy) => {
                const tokenIn = cacheStrategy.pair.split('/')[0].replace('*', 'TokenIn');
                const tokenOut = cacheStrategy.pair.split('/')[1].replace('*', 'TokenOut');
                return this.generateTapcompareWidgets(tokenIn, tokenOut, cacheStrategy.readablePairTradeTypeChainId());
            });
            wildcardStrategiesWidgets.unshift({
                type: 'text',
                width: 24,
                height: 1,
                properties: {
                    markdown: `# Wildcard pairs`,
                },
            });
        }
        const strategiesWidgets = _.flatMap(strategies, (cacheStrategy) => this.generateWidgetsForStrategies(cacheStrategy));
        return cacheHitMissWidgets.concat(wildcardStrategiesWidgets).concat(strategiesWidgets);
    }
    generateCacheHitMissMetricsWidgets() {
        return [
            {
                type: 'text',
                width: 24,
                height: 1,
                properties: {
                    markdown: `# Overall Cache Hit/Miss`,
                },
            },
            {
                type: 'metric',
                width: 24,
                height: 6,
                properties: {
                    view: 'timeSeries',
                    stacked: false,
                    metrics: [
                        [this.namespace, 'GetCachedRoute_hit_livemode', 'Service', 'RoutingAPI', { label: 'Cache Hit' }],
                        ['.', 'GetCachedRoute_miss_livemode', '.', '.', { label: 'Cache Miss' }],
                    ],
                    region: this.region,
                    title: 'Cache Hit and Miss of Cachemode.Livemode',
                    period: 300,
                    stat: 'Sum',
                },
            },
            {
                type: 'metric',
                width: 24,
                height: 6,
                properties: {
                    view: 'timeSeries',
                    stacked: false,
                    metrics: [
                        [this.namespace, 'GetCachedRoute_hit_tapcompare', 'Service', 'RoutingAPI', { label: 'Cache Hit' }],
                        ['.', 'GetCachedRoute_miss_tapcompare', '.', '.', { label: 'Cache Miss' }],
                    ],
                    region: this.region,
                    title: 'Cache Hit and Miss of cachemode.Tapcompare',
                    period: 300,
                    stat: 'Sum',
                },
            },
        ];
    }
    generateWidgetsForStrategies(cacheStrategy) {
        const pairTradeTypeChainId = cacheStrategy.readablePairTradeTypeChainId();
        const getQuoteMetricName = `GET_QUOTE_AMOUNT_${cacheStrategy.pair}_${cacheStrategy.tradeType.toUpperCase()}_CHAIN_${cacheStrategy.chainId}`;
        const tokenIn = cacheStrategy.pair.split('/')[0];
        const tokenOut = cacheStrategy.pair.split('/')[1];
        const quoteAmountsMetrics = [
            {
                type: 'text',
                width: 24,
                height: 1,
                properties: {
                    markdown: `# Cached Routes Performance for ${pairTradeTypeChainId}`,
                },
            },
            {
                type: 'metric',
                width: 24,
                height: 6,
                properties: {
                    view: 'timeSeries',
                    stacked: false,
                    metrics: [
                        [
                            this.namespace,
                            getQuoteMetricName,
                            'Service',
                            'RoutingAPI',
                            { label: `${cacheStrategy.pair}/${cacheStrategy.tradeType.toUpperCase()} Quotes` },
                        ],
                    ],
                    region: this.region,
                    title: `Number of requested quotes`,
                    period: 300,
                    stat: 'SampleCount',
                },
            },
            {
                type: 'metric',
                width: 24,
                height: 9,
                properties: {
                    view: 'timeSeries',
                    stacked: true,
                    metrics: cacheStrategy
                        .bucketPairs()
                        .map((bucket) => [
                        this.namespace,
                        getQuoteMetricName,
                        'Service',
                        'RoutingAPI',
                        this.generateStatWithLabel(bucket, cacheStrategy.pair, cacheStrategy._tradeType),
                    ]),
                    region: this.region,
                    title: `Distribution of quotes ${pairTradeTypeChainId}`,
                    period: 300,
                },
            },
        ];
        let tapcompareMetrics = [];
        if (cacheStrategy.willTapcompare) {
            tapcompareMetrics = this.generateTapcompareWidgets(tokenIn, tokenOut, pairTradeTypeChainId);
        }
        return quoteAmountsMetrics.concat(tapcompareMetrics);
    }
    generateStatWithLabel([min, max], pair, tradeType) {
        const tokens = pair.split('/');
        const maxNormalized = max > 0 ? max.toString() : '';
        switch (tradeType) {
            case TradeType.EXACT_INPUT:
                return {
                    stat: `PR(${min}:${maxNormalized})`,
                    label: `${min} to ${max} ${tokens[0]}`,
                };
            case TradeType.EXACT_OUTPUT:
                return {
                    stat: `PR(${min}:${maxNormalized})`,
                    label: `${min} to ${max} ${tokens[1]}`,
                };
        }
    }
    generateTapcompareWidgets(tokenIn, tokenOut, pairTradeTypeChainId) {
        // Escape the pairTradeTypeChainId in order to be used for matching against wildcards too
        const escapedPairTradeTypeChainId = pairTradeTypeChainId
            .replace(/\//g, '\\/') // Escape forward slashes
            .replace(/\*/g, '.*'); // Replace * with .* to match against any character in the pair
        const widget = [
            {
                type: 'log',
                width: 24,
                height: 8,
                properties: {
                    view: 'table',
                    query: `SOURCE '/aws/lambda/${this.lambdaName}'
            | fields @timestamp, pair, quoteGasAdjustedDiff as diffOf${tokenOut}, amount as amountOf${tokenIn}
            | filter msg like 'Comparing quotes between Chain and Cache' and pair like /${escapedPairTradeTypeChainId}/ and quoteGasAdjustedDiff != 0 
            | sort quoteGasAdjustedDiff desc`,
                    region: this.region,
                    title: `Quote Differences and Amounts for ${pairTradeTypeChainId}`,
                },
            },
        ];
        return widget;
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY2FjaGVkLXJvdXRlcy13aWRnZXRzLWZhY3RvcnkuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9saWIvZGFzaGJvYXJkcy9jYWNoZWQtcm91dGVzLXdpZGdldHMtZmFjdG9yeS50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxPQUFPLENBQUMsTUFBTSxRQUFRLENBQUE7QUFHdEIsT0FBTyxFQUFFLDJCQUEyQixFQUF3QixNQUFNLDJDQUEyQyxDQUFBO0FBQzdHLE9BQU8sRUFBRSxTQUFTLEVBQUUsTUFBTSxtQkFBbUIsQ0FBQTtBQUU3QyxNQUFNLE9BQU8sMEJBQTBCO0lBS3JDLFlBQVksU0FBaUIsRUFBRSxNQUFjLEVBQUUsVUFBa0I7UUFDL0QsSUFBSSxDQUFDLE1BQU0sR0FBRyxNQUFNLENBQUE7UUFDcEIsSUFBSSxDQUFDLFNBQVMsR0FBRyxTQUFTLENBQUE7UUFDMUIsSUFBSSxDQUFDLFVBQVUsR0FBRyxVQUFVLENBQUE7SUFDOUIsQ0FBQztJQUVELGVBQWU7UUFDYixNQUFNLG1CQUFtQixHQUFHLElBQUksQ0FBQyxrQ0FBa0MsRUFBRSxDQUFBO1FBRXJFLE1BQU0sQ0FBQyxrQkFBa0IsRUFBRSxVQUFVLENBQUMsR0FBRyxDQUFDLENBQUMsU0FBUyxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsMkJBQTJCLENBQUMsTUFBTSxFQUFFLENBQUMsRUFBRSxDQUFDLFFBQVEsRUFBRSxFQUFFLENBQ2xILFFBQVEsQ0FBQyxJQUFJLENBQUMsUUFBUSxDQUFDLEdBQUcsQ0FBQyxDQUM1QixDQUFBO1FBRUQsSUFBSSx5QkFBeUIsR0FBYSxFQUFFLENBQUE7UUFDNUMsSUFBSSxrQkFBa0IsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxFQUFFO1lBQ2pDLHlCQUF5QixHQUFHLENBQUMsQ0FBQyxPQUFPLENBQUMsa0JBQWtCLEVBQUUsQ0FBQyxhQUFhLEVBQUUsRUFBRTtnQkFDMUUsTUFBTSxPQUFPLEdBQUcsYUFBYSxDQUFDLElBQUksQ0FB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RztvQkFDbkMsS0FBSyxFQUFFLEdBQUcsR0FBRyxPQUFPLEdBQUcsSUFBSSxNQUFNLENBQUMsQ0FBQyxDQUFDLEVBQUU7aUJBQ3ZDLENBQUE7WUFDSCxLQUFLLFNBQVMsQ0FBQyxZQUFZO2dCQUN6QixPQUFPO29CQUNMLElBQUksRUFBRSxNQUFNLEdBQUcsSUFBSSxhQUFhLEdBQUc7b0JBQ25DLEtBQUssRUFBRSxHQUFHLEdBQUcsT0FBTyxHQUFHLElBQUksTUFBTSxDQUFDLENBQUMsQ0FBQyxFQUFFO2lCQUN2QyxDQUFBO1NBQ0o7SUFDSCxDQUFDO0lBRU8seUJBQXlCLENBQUMsT0FBZSxFQUFFLFFBQWdCLEVBQUUsb0JBQTRCO1FBQy9GLHlGQUF5RjtRQUN6RixNQUFNLDJCQUEyQixHQUFHLG9CQUFvQjthQUNyRCxPQUFPLENBQUMsS0FBSyxFQUFFLEtBQUssQ0FBQyxDQUFDLHlCQUF5QjthQUMvQyxPQUFPLENBQUMsS0FBSyxFQUFFLElBQUksQ0FBQyxDQUFBLENBQUMsK0RBQStEO1FBRXZGLE1BQU0sTUFBTSxHQUFhO1lBQ3ZCO2dCQUNFLElBQUksRUFBRSxLQUFLO2dCQUNYLEtBQUssRUFBRSxFQUFFO2dCQUNULE1BQU0sRUFBRSxDQUFDO2dCQUNULFVBQVUsRUFBRTtvQkFDVixJQUFJLEVBQUUsT0FBTztvQkFDYixLQUFLLEVBQUUsdUJBQXVCLElBQUksQ0FBQyxVQUFVO3VFQUNnQixRQUFRLHVCQUF1QixPQUFPOzBGQUNuQiwyQkFBMkI7NkNBQ3hFO29CQUNuQyxNQUFNLEVBQUUsSUFBSSxDQUFDLE1BQU07b0JBQ25CLEtBQUssRUFBRSxxQ0FBcUMsb0JBQW9CLEVBQUU7aUJBQ25FO2FBQ0Y7U0FDRixDQUFBO1FBRUQsT0FBTyxNQUFNLENBQUE7SUFDZixDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgXyBmcm9tICdsb2Rhc2gnXG5pbXBvcnQgeyBXaWRnZXQgfSBmcm9tICcuL2NvcmUvbW9kZWwvd2lkZ2V0J1xuaW1wb3J0IHsgV2lkZ2V0c0ZhY3RvcnkgfSBmcm9tICcuL2NvcmUvd2lkZ2V0cy1mYWN0b3J5J1xuaW1wb3J0IHsgQ0FDSEVEX1JPVVRFU19DT05GSUdVUkFUSU9OLCBDYWNoZWRSb3V0ZXNTdHJhdGVneSB9IGZyb20gJy4uL2hhbmRsZXJzL3JvdXRlci1lbnRpdGllcy9yb3V0ZS1jYWNoaW5nJ1xuaW1wb3J0IHsgVHJhZGVUeXBlIH0gZnJvbSAnQHVuaXN3YXAvc2RrLWNvcmUnXG5cbmV4cG9ydCBjbGFzcyBDYWNoZWRSb3V0ZXNXaWRnZXRzRmFjdG9yeSBpbXBsZW1lbnRzIFdpZGdldHNGYWN0b3J5IHtcbiAgcmVnaW9uOiBzdHJpbmdcbiAgbmFtZXNwYWNlOiBzdHJpbmdcbiAgbGFtYmRhTmFtZTogc3RyaW5nXG5cbiAgY29uc3RydWN0b3IobmFtZXNwYWNlOiBzdHJpbmcsIHJlZ2lvbjogc3RyaW5nLCBsYW1iZGFOYW1lOiBzdHJpbmcpIHtcbiAgICB0aGlzLnJlZ2lvbiA9IHJlZ2lvblxuICAgIHRoaXMubmFtZXNwYWNlID0gbmFtZXNwYWNlXG4gICAgdGhpcy5sYW1iZGFOYW1lID0gbGFtYmRhTmFtZVxuICB9XG5cbiAgZ2VuZXJhdGVXaWRnZXRzKCk6IFdpZGdldFtdIHtcbiAgICBjb25zdCBjYWNoZUhpdE1pc3NXaWRnZXRzID0gdGhpcy5nZW5lcmF0ZUNhY2hlSGl0TWlzc01ldHJpY3NXaWRnZXRzKClcblxuICAgIGNvbnN0IFt3aWxkY2FyZFN0cmF0ZWdpZXMsIHN0cmF0ZWdpZXNdID0gXy5wYXJ0aXRpb24oQXJyYXkuZnJvbShDQUNIRURfUk9VVEVTX0NPTkZJR1VSQVRJT04udmFsdWVzKCkpLCAoc3RyYXRlZ3kpID0+XG4gICAgICBzdHJhdGVneS5wYWlyLmluY2x1ZGVzKCcqJylcbiAgICApXG5cbiAgICBsZXQgd2lsZGNhcmRTdHJhdGVnaWVzV2lkZ2V0czogV2lkZ2V0W10gPSBbXVxuICAgIGlmICh3aWxkY2FyZFN0cmF0ZWdpZXMubGVuZ3RoID4gMCkge1xuICAgICAgd2lsZGNhcmRTdHJhdGVnaWVzV2lkZ2V0cyA9IF8uZmxhdE1hcCh3aWxkY2FyZFN0cmF0ZWdpZXMsIChjYWNoZVN0cmF0ZWd5KSA9PiB7XG4gICAgICAgIGNvbnN0IHRva2VuSW4gPSBjYWNoZVN0cmF0ZWd5LnBhaXIuc3BsaXQoJy8nKVswXS5yZXBsYWNlKCcqJywgJ1Rva2VuSW4nKVxuICAgICAgICBjb25zdCB0b2tlbk91dCA9IGNhY2hlU3RyYXRlZ3kucGFpci5zcGxpdCgnLycpWzFdLnJlcGxhY2UoJyonLCAnVG9rZW5PdXQnKVxuXG4gICAgICAgIHJldHVybiB0aGlzLmdlbmVyYXRlVGFwY29tcGFyZVdpZGdldHModG9rZW5JbiwgdG9rZW5PdXQsIGNhY2hlU3RyYXRlZ3kucmVhZGFibGVQYWlyVHJhZGVUeXBlQ2hhaW5JZCgpKVxuICAgICAgfSlcblxuICAgICAgd2lsZGNhcmRTdHJhdGVnaWVzV2lkZ2V0cy51bnNoaWZ0KHtcbiAgICAgICAgdHlwZTogJ3RleHQnLFxuICAgICAgICB3aWR0aDogMjQsXG4gICAgICAgIGhlaWdodDogMSxcbiAgICAgICAgcHJvcGVydGllczoge1xuICAgICAgICAgIG1hcmtkb3duOiBgIyBXaWxkY2FyZCBwYWlyc2AsXG4gICAgICAgIH0sXG4gICAgICB9KVxuICAgIH1cblxuICAgIGNvbnN0IHN0cmF0ZWdpZXNXaWRnZXRzID0gXy5mbGF0TWFwKHN0cmF0ZWdpZXMsIChjYWNoZVN0cmF0ZWd5KSA9PiB0aGlzLmdlbmVyYXRlV2lkZ2V0c0ZvclN0cmF0ZWdpZXMoY2FjaGVTdHJhdGVneSkpXG5cbiAgICByZXR1cm4gY2FjaGVIaXRNaXNzV2lkZ2V0cy5jb25jYXQod2lsZGNhcmRTdHJhdGVnaWVzV2lkZ2V0cykuY29uY2F0KHN0cmF0ZWdpZXNXaWRnZXRzKVxuICB9XG5cbiAgcHJpdmF0ZSBnZW5lcmF0ZUNhY2hlSGl0TWlzc01ldHJpY3NXaWRnZXRzKCk6IFdpZGdldFtdIHtcbiAgICByZXR1cm4gW1xuICAgICAge1xuICAgICAgICB0eXBlOiAndGV4dCcsXG4gICAgICAgIHdpZHRoOiAyNCxcbiAgICAgICAgaGVpZ2h0OiAxLFxuICAgICAgICBwcm9wZXJ0aWVzOiB7XG4gICAgICAgICAgbWFya2Rvd246IGAjIE92ZXJhbGwgQ2FjaGUgSGl0L01pc3NgLFxuICAgICAgICB9LFxuICAgICAgfSxcbiAgICAgIHtcbiAgICAgICAgdHlwZTogJ21ldHJpYycsXG4gICAgICAgIHdpZHRoOiAyNCxcbiAgICAgICAgaGVpZ2h0OiA2LFxuICAgICAgICBwcm9wZXJ0aWVzOiB7XG4gICAgICAgICAgdmlldzogJ3RpbWVTZXJpZXMnLFxuICAgICAgICAgIHN0YWNrZWQ6IGZhbHNlLFxuICAgICAgICAgIG1ldHJpY3M6IFtcbiAgICAgICAgICAgIFt0aGlzLm5hbWVzcGFjZSwgJ0dldENhY2hlZFJvdXRlX2hpdF9saXZlbW9kZScsICdTZXJ2aWNlJywgJ1JvdXRpbmdBUEknLCB7IGxhYmVsOiAnQ2FjaGUgSGl0JyB9XSxcbiAgICAgICAgICAgIFsnLicsICdHZXRDYWNoZWRSb3V0ZV9taXNzX2xpdmVtb2RlJywgJy4nLCAnLicsIHsgbGFiZWw6ICdDYWNoZSBNaXNzJyB9XSxcbiAgICAgICAgICBdLFxuICAgICAgICAgIHJlZ2lvbjogdGhpcy5yZWdpb24sXG4gICAgICAgICAgdGl0bGU6ICdDYWNoZSBIaXQgYW5kIE1pc3Mgb2YgQ2FjaGVtb2RlLkxpdmVtb2RlJyxcbiAgICAgICAgICBwZXJpb2Q6IDMwMCxcbiAgICAgICAgICBzdGF0OiAnU3VtJyxcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgICB7XG4gICAgICAgIHR5cGU6ICdtZXRyaWMnLFxuICAgICAgICB3aWR0aDogMjQsXG4gICAgICAgIGhlaWdodDogNixcbiAgICAgICAgcHJvcGVydGllczoge1xuICAgICAgICAgIHZpZXc6ICd0aW1lU2VyaWVzJyxcbiAgICAgICAgICBzdGFja2VkOiBmYWxzZSxcbiAgICAgICAgICBtZXRyaWNzOiBbXG4gICAgICAgICAgICBbdGhpcy5uYW1lc3BhY2UsICdHZXRDYWNoZWRSb3V0ZV9oaXRfdGFwY29tcGFyZScsICdTZXJ2aWNlJywgJ1JvdXRpbmdBUEknLCB7IGxhYmVsOiAnQ2FjaGUgSGl0JyB9XSxcbiAgICAgICAgICAgIFsnLicsICdHZXRDYWNoZWRSb3V0ZV9taXNzX3RhcGNvbXBhcmUnLCAnLicsICcuJywgeyBsYWJlbDogJ0NhY2hlIE1pc3MnIH1dLFxuICAgICAgICAgIF0sXG4gICAgICAgICAgcmVnaW9uOiB0aGlzLnJlZ2lvbixcbiAgICAgICAgICB0aXRsZTogJ0NhY2hlIEhpdCBhbmQgTWlzcyBvZiBjYWNoZW1vZGUuVGFwY29tcGFyZScsXG4gICAgICAgICAgcGVyaW9kOiAzMDAsXG4gICAgICAgICAgc3RhdDogJ1N1bScsXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgIF1cbiAgfVxuXG4gIHByaXZhdGUgZ2VuZXJhdGVXaWRnZXRzRm9yU3RyYXRlZ2llcyhjYWNoZVN0cmF0ZWd5OiBDYWNoZWRSb3V0ZXNTdHJhdGVneSk6IFdpZGdldFtdIHtcbiAgICBjb25zdCBwYWlyVHJhZGVUeXBlQ2hhaW5JZCA9IGNhY2hlU3RyYXRlZ3kucmVhZGFibGVQYWlyVHJhZGVUeXBlQ2hhaW5JZCgpXG4gICAgY29uc3QgZ2V0UXVvdGVNZXRyaWNOYW1lID0gYEdFVF9RVU9URV9BTU9VTlRfJHtjYWNoZVN0cmF0ZWd5LnBhaXJ9XyR7Y2FjaGVTdHJhdGVneS50cmFkZVR5cGUudG9VcHBlckNhc2UoKX1fQ0hBSU5fJHtcbiAgICAgIGNhY2hlU3RyYXRlZ3kuY2hhaW5JZFxuICAgIH1gXG4gICAgY29uc3QgdG9rZW5JbiA9IGNhY2hlU3RyYXRlZ3kucGFpci5zcGxpdCgnLycpWzBdXG4gICAgY29uc3QgdG9rZW5PdXQgPSBjYWNoZVN0cmF0ZWd5LnBhaXIuc3BsaXQoJy8nKVsxXVxuXG4gICAgY29uc3QgcXVvdGVBbW91bnRzTWV0cmljczogV2lkZ2V0W10gPSBbXG4gICAgICB7XG4gICAgICAgIHR5cGU6ICd0ZXh0JyxcbiAgICAgICAgd2lkdGg6IDI0LFxuICAgICAgICBoZWlnaHQ6IDEsXG4gICAgICAgIHByb3BlcnRpZXM6IHtcbiAgICAgICAgICBtYXJrZG93bjogYCMgQ2FjaGVkIFJvdXRlcyBQZXJmb3JtYW5jZSBmb3IgJHtwYWlyVHJhZGVUeXBlQ2hhaW5JZH1gLFxuICAgICAgICB9LFxuICAgICAgfSxcbiAgICAgIHtcbiAgICAgICAgdHlwZTogJ21ldHJpYycsXG4gICAgICAgIHdpZHRoOiAyNCxcbiAgICAgICAgaGVpZ2h0OiA2LFxuICAgICAgICBwcm9wZXJ0aWVzOiB7XG4gICAgICAgICAgdmlldzogJ3RpbWVTZXJpZXMnLFxuICAgICAgICAgIHN0YWNrZWQ6IGZhbHNlLFxuICAgICAgICAgIG1ldHJpY3M6IFtcbiAgICAgICAgICAgIFtcbiAgICAgICAgICAgICAgdGhpcy5uYW1lc3BhY2UsXG4gICAgICAgICAgICAgIGdldFF1b3RlTWV0cmljTmFtZSxcbiAgICAgICAgICAgICAgJ1NlcnZpY2UnLFxuICAgICAgICAgICAgICAnUm91dGluZ0FQSScsXG4gICAgICAgICAgICAgIHsgbGFiZWw6IGAke2NhY2hlU3RyYXRlZ3kucGFpcn0vJHtjYWNoZVN0cmF0ZWd5LnRyYWRlVHlwZS50b1VwcGVyQ2FzZSgpfSBRdW90ZXNgIH0sXG4gICAgICAgICAgICBdLFxuICAgICAgICAgIF0sXG4gICAgICAgICAgcmVnaW9uOiB0aGlzLnJlZ2lvbixcbiAgICAgICAgICB0aXRsZTogYE51bWJlciBvZiByZXF1ZXN0ZWQgcXVvdGVzYCxcbiAgICAgICAgICBwZXJpb2Q6IDMwMCxcbiAgICAgICAgICBzdGF0OiAnU2FtcGxlQ291bnQnLFxuICAgICAgICB9LFxuICAgICAgfSxcbiAgICAgIHtcbiAgICAgICAgdHlwZTogJ21ldHJpYycsXG4gICAgICAgIHdpZHRoOiAyNCxcbiAgICAgICAgaGVpZ2h0OiA5LFxuICAgICAgICBwcm9wZXJ0aWVzOiB7XG4gICAgICAgICAgdmlldzogJ3RpbWVTZXJpZXMnLFxuICAgICAgICAgIHN0YWNrZWQ6IHRydWUsXG4gICAgICAgICAgbWV0cmljczogY2FjaGVTdHJhdGVneVxuICAgICAgICAgICAgLmJ1Y2tldFBhaXJzKClcbiAgICAgICAgICAgIC5tYXAoKGJ1Y2tldCkgPT4gW1xuICAgICAgICAgICAgICB0aGlzLm5hbWVzcGFjZSxcbiAgICAgICAgICAgICAgZ2V0UXVvdGVNZXRyaWNOYW1lLFxuICAgICAgICAgICAgICAnU2VydmljZScsXG4gICAgICAgICAgICAgICdSb3V0aW5nQVBJJyxcbiAgICAgICAgICAgICAgdGhpcy5nZW5lcmF0ZVN0YXRXaXRoTGFiZWwoYnVja2V0LCBjYWNoZVN0cmF0ZWd5LnBhaXIsIGNhY2hlU3RyYXRlZ3kuX3RyYWRlVHlwZSksXG4gICAgICAgICAgICBdKSxcbiAgICAgICAgICByZWdpb246IHRoaXMucmVnaW9uLFxuICAgICAgICAgIHRpdGxlOiBgRGlzdHJpYnV0aW9uIG9mIHF1b3RlcyAke3BhaXJUcmFkZVR5cGVDaGFpbklkfWAsXG4gICAgICAgICAgcGVyaW9kOiAzMDAsXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgIF1cblxuICAgIGxldCB0YXBjb21wYXJlTWV0cmljczogV2lkZ2V0W10gPSBbXVxuXG4gICAgaWYgKGNhY2hlU3RyYXRlZ3kud2lsbFRhcGNvbXBhcmUpIHtcbiAgICAgIHRhcGNvbXBhcmVNZXRyaWNzID0gdGhpcy5nZW5lcmF0ZVRhcGNvbXBhcmVXaWRnZXRzKHRva2VuSW4sIHRva2VuT3V0LCBwYWlyVHJhZGVUeXBlQ2hhaW5JZClcbiAgICB9XG5cbiAgICByZXR1cm4gcXVvdGVBbW91bnRzTWV0cmljcy5jb25jYXQodGFwY29tcGFyZU1ldHJpY3MpXG4gIH1cblxuICBwcml2YXRlIGdlbmVyYXRlU3RhdFdpdGhMYWJlbChcbiAgICBbbWluLCBtYXhdOiBbbnVtYmVyLCBudW1iZXJdLFxuICAgIHBhaXI6IHN0cmluZyxcbiAgICB0cmFkZVR5cGU6IFRyYWRlVHlwZVxuICApOiB7IHN0YXQ6IHN0cmluZzsgbGFiZWw6IHN0cmluZyB9IHtcbiAgICBjb25zdCB0b2tlbnMgPSBwYWlyLnNwbGl0KCcvJylcbiAgICBjb25zdCBtYXhOb3JtYWxpemVkID0gbWF4ID4gMCA/IG1heC50b1N0cmluZygpIDogJydcblxuICAgIHN3aXRjaCAodHJhZGVUeXBlKSB7XG4gICAgICBjYXNlIFRyYWRlVHlwZS5FWEFDVF9JTlBVVDpcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBzdGF0OiBgUFIoJHttaW59OiR7bWF4Tm9ybWFsaXplZH0pYCxcbiAgICAgICAgICBsYWJlbDogYCR7bWlufSB0byAke21heH0gJHt0b2tlbnNbMF19YCxcbiAgICAgICAgfVxuICAgICAgY2FzZSBUcmFkZVR5cGUuRVhBQ1RfT1VUUFVUOlxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIHN0YXQ6IGBQUigke21pbn06JHttYXhOb3JtYWxpemVkfSlgLFxuICAgICAgICAgIGxhYmVsOiBgJHttaW59IHRvICR7bWF4fSAke3Rva2Vuc1sxXX1gLFxuICAgICAgICB9XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBnZW5lcmF0ZVRhcGNvbXBhcmVXaWRnZXRzKHRva2VuSW46IHN0cmluZywgdG9rZW5PdXQ6IHN0cmluZywgcGFpclRyYWRlVHlwZUNoYWluSWQ6IHN0cmluZyk6IFdpZGdldFtdIHtcbiAgICAvLyBFc2NhcGUgdGhlIHBhaXJUcmFkZVR5cGVDaGFpbklkIGluIG9yZGVyIHRvIGJlIHVzZWQgZm9yIG1hdGNoaW5nIGFnYWluc3Qgd2lsZGNhcmRzIHRvb1xuICAgIGNvbnN0IGVzY2FwZWRQYWlyVHJhZGVUeXBlQ2hhaW5JZCA9IHBhaXJUcmFkZVR5cGVDaGFpbklkXG4gICAgICAucmVwbGFjZSgvXFwvL2csICdcXFxcLycpIC8vIEVzY2FwZSBmb3J3YXJkIHNsYXNoZXNcbiAgICAgIC5yZXBsYWNlKC9cXCovZywgJy4qJykgLy8gUmVwbGFjZSAqIHdpdGggLiogdG8gbWF0Y2ggYWdhaW5zdCBhbnkgY2hhcmFjdGVyIGluIHRoZSBwYWlyXG5cbiAgICBjb25zdCB3aWRnZXQ6IFdpZGdldFtdID0gW1xuICAgICAge1xuICAgICAgICB0eXBlOiAnbG9nJyxcbiAgICAgICAgd2lkdGg6IDI0LFxuICAgICAgICBoZWlnaHQ6IDgsXG4gICAgICAgIHByb3BlcnRpZXM6IHtcbiAgICAgICAgICB2aWV3OiAndGFibGUnLFxuICAgICAgICAgIHF1ZXJ5OiBgU09VUkNFICcvYXdzL2xhbWJkYS8ke3RoaXMubGFtYmRhTmFtZX0nXG4gICAgICAgICAgICB8IGZpZWxkcyBAdGltZXN0YW1wLCBwYWlyLCBxdW90ZUdhc0FkanVzdGVkRGlmZiBhcyBkaWZmT2Yke3Rva2VuT3V0fSwgYW1vdW50IGFzIGFtb3VudE9mJHt0b2tlbklufVxuICAgICAgICAgICAgfCBmaWx0ZXIgbXNnIGxpa2UgJ0NvbXBhcmluZyBxdW90ZXMgYmV0d2VlbiBDaGFpbiBhbmQgQ2FjaGUnIGFuZCBwYWlyIGxpa2UgLyR7ZXNjYXBlZFBhaXJUcmFkZVR5cGVDaGFpbklkfS8gYW5kIHF1b3RlR2FzQWRqdXN0ZWREaWZmICE9IDAgXG4gICAgICAgICAgICB8IHNvcnQgcXVvdGVHYXNBZGp1c3RlZERpZmYgZGVzY2AsXG4gICAgICAgICAgcmVnaW9uOiB0aGlzLnJlZ2lvbixcbiAgICAgICAgICB0aXRsZTogYFF1b3RlIERpZmZlcmVuY2VzIGFuZCBBbW91bnRzIGZvciAke3BhaXJUcmFkZVR5cGVDaGFpbklkfWAsXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgIF1cblxuICAgIHJldHVybiB3aWRnZXRcbiAgfVxufVxuIl19