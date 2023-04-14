import { AlphaRouter, ID_TO_CHAIN_ID, setGlobalLogger, setGlobalMetric, V3HeuristicGasModelFactory, } from '@tartz-one/smart-order-router';
import { default as bunyan } from 'bunyan';
import { BigNumber } from 'ethers';
import { InjectorSOR } from '../injector-sor';
import { AWSMetricsLogger } from '../router-entities/aws-metrics-logger';
import { StaticGasPriceProvider } from '../router-entities/static-gas-price-provider';
export class QuoteHandlerInjector extends InjectorSOR {
    async getRequestInjected(containerInjected, _requestBody, requestQueryParams, _event, context, log, metricsLogger) {
        const requestId = context.awsRequestId;
        const quoteId = requestId.substring(0, 5);
        const logLevel = bunyan.INFO;
        const { tokenInAddress, tokenInChainId, tokenOutAddress, amount, type, algorithm, gasPriceWei } = requestQueryParams;
        log = log.child({
            serializers: bunyan.stdSerializers,
            level: logLevel,
            requestId,
            quoteId,
            tokenInAddress,
            chainId: tokenInChainId,
            tokenOutAddress,
            amount,
            type,
            algorithm,
        });
        setGlobalLogger(log);
        metricsLogger.setNamespace('Uniswap');
        metricsLogger.setDimensions({ Service: 'RoutingAPI' });
        const metric = new AWSMetricsLogger(metricsLogger);
        setGlobalMetric(metric);
        // Today API is restricted such that both tokens must be on the same chain.
        const chainId = tokenInChainId;
        const chainIdEnum = ID_TO_CHAIN_ID(chainId);
        const { dependencies } = containerInjected;
        if (!dependencies[chainIdEnum]) {
            // Request validation should prevent reject unsupported chains with 4xx already, so this should not be possible.
            throw new Error(`No container injected dependencies for chain: ${chainIdEnum}`);
        }
        const { provider, v3PoolProvider, multicallProvider, tokenProvider, tokenListProvider, v3SubgraphProvider, blockedTokenListProvider, v2PoolProvider, v2QuoteProvider, v2SubgraphProvider, gasPriceProvider: gasPriceProviderOnChain, simulator, routeCachingProvider, } = dependencies[chainIdEnum];
        let onChainQuoteProvider = dependencies[chainIdEnum].onChainQuoteProvider;
        let gasPriceProvider = gasPriceProviderOnChain;
        if (gasPriceWei) {
            const gasPriceWeiBN = BigNumber.from(gasPriceWei);
            gasPriceProvider = new StaticGasPriceProvider(gasPriceWeiBN);
        }
        let router;
        switch (algorithm) {
            case 'alpha':
            default:
                router = new AlphaRouter({
                    chainId,
                    provider,
                    v3SubgraphProvider,
                    multicall2Provider: multicallProvider,
                    v3PoolProvider,
                    onChainQuoteProvider,
                    gasPriceProvider,
                    v3GasModelFactory: new V3HeuristicGasModelFactory(),
                    blockedTokenListProvider,
                    tokenProvider,
                    v2PoolProvider,
                    v2QuoteProvider,
                    v2SubgraphProvider,
                    simulator,
                    routeCachingProvider,
                });
                break;
        }
        return {
            chainId: chainIdEnum,
            id: quoteId,
            log,
            metric,
            router,
            v3PoolProvider,
            v2PoolProvider,
            tokenProvider,
            tokenListProvider,
        };
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5qZWN0b3IuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9saWIvaGFuZGxlcnMvcXVvdGUvaW5qZWN0b3IudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsT0FBTyxFQUNMLFdBQVcsRUFFWCxjQUFjLEVBR2QsZUFBZSxFQUNmLGVBQWUsRUFDZiwwQkFBMEIsR0FDM0IsTUFBTSwrQkFBK0IsQ0FBQTtBQUd0QyxPQUFPLEVBQUUsT0FBTyxJQUFJLE1BQU0sRUFBcUIsTUFBTSxRQUFRLENBQUE7QUFDN0QsT0FBTyxFQUFFLFNBQVMsRUFBRSxNQUFNLFFBQVEsQ0FBQTtBQUNsQyxPQUFPLEVBQXFCLFdBQVcsRUFBbUIsTUFBTSxpQkFBaUIsQ0FBQTtBQUNqRixPQUFPLEVBQUUsZ0JBQWdCLEVBQUUsTUFBTSx1Q0FBdUMsQ0FBQTtBQUN4RSxPQUFPLEVBQUUsc0JBQXNCLEVBQUUsTUFBTSw4Q0FBOEMsQ0FBQTtBQUVyRixNQUFNLE9BQU8sb0JBQXFCLFNBQVEsV0FHekM7SUFDUSxLQUFLLENBQUMsa0JBQWtCLENBQzdCLGlCQUFvQyxFQUNwQyxZQUFrQixFQUNsQixrQkFBb0MsRUFDcEMsTUFBNEIsRUFDNUIsT0FBZ0IsRUFDaEIsR0FBVyxFQUNYLGFBQTRCO1FBRTVCLE1BQU0sU0FBUyxHQUFHLE9BQU8sQ0FBQyxZQUFZLENBQUE7UUFDdEMsTUFBTSxPQUFPLEdBQUcsU0FBUyxDQUFDLFNBQVMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUE7UUFDekMsTUFBTSxRQUFRLEdBQUcsTUFBTSxDQUFDLElBQUksQ0FBQTtRQUU1QixNQUFNLEVBQUUsY0FBYyxFQUFFLGNBQWMsRUFBRSxlQUFlLEVBQUUsTUFBTSxFQUFFLElBQUksRUFBRSxTQUFTLEVBQUUsV0FBVyxFQUFFLEdBQUcsa0JBQWtCLENBQUE7UUFFcEgsR0FBRyxHQUFHLEdBQUcsQ0FBQyxLQUFLLENBQUM7WUFDZCxXQUFXLEVBQUUsTUFBTSxDQUFDLGNBQWM7WUFDbEMsS0FBSyxFQUFFLFFBQVE7WUFDZixTQUFTO1lBQ1QsT0FBTztZQUNQLGNBQWM7WUFDZCxPQUFPLEVBQUUsY0FBYztZQUN2QixlQUFlO1lBQ2YsTUFBTTtZQUNOLElBQUk7WUFDSixTQUFTO1NBQ1YsQ0FBQyxDQUFBO1FBQ0YsZUFBZSxDQUFDLEdBQUcsQ0FBQyxDQUFBO1FBRXBCLGFBQWEsQ0FBQyxZQUFZLENBQUMsU0FBUyxDQUFDLENBQUE7UUFDckMsYUFBYSxDQUFDLGFBQWEsQ0FBQyxFQUFFLE9BQU8sRUFBRSxZQUFZLEVBQUUsQ0FBQyxDQUFBO1FBQ3RELE1BQU0sTUFBTSxHQUFHLElBQUksZ0JBQWdCLENBQUMsYUFBYSxDQUFDLENBQUE7UUFDbEQsZUFBZSxDQUFDLE1BQU0sQ0FBQyxDQUFBO1FBRXZCLDJFQUEyRTtRQUMzRSxNQUFNLE9BQU8sR0FBRyxjQUFjLENBQUE7UUFDOUIsTUFBTSxXQUFXLEdBQUcsY0FBYyxDQUFDLE9BQU8sQ0FBQyxDQUFBO1FBRTNDLE1BQU0sRUFBRSxZQUFZLEVBQUUsR0FBRyxpQkFBaUIsQ0FBQTtRQUUxQyxJQUFJLENBQUMsWUFBWSxDQUFDLFdBQVcsQ0FBQyxFQUFFO1lBQzlCLGdIQUFnSDtZQUNoSCxNQUFNLElBQUksS0FBSyxDQUFDLGlEQUFpRCxXQUFXLEVBQUUsQ0FBQyxDQUFBO1NBQ2hGO1FBRUQsTUFBTSxFQUNKLFFBQVEsRUFDUixjQUFjLEVBQ2QsaUJBQWlCLEVBQ2pCLGFBQWEsRUFDYixpQkFBaUIsRUFDakIsa0JBQWtCLEVBQ2xCLHdCQUF3QixFQUN4QixjQUFjLEVBQ2QsZUFBZSxFQUNmLGtCQUFrQixFQUNsQixnQkFBZ0IsRUFBRSx1QkFBdUIsRUFDekMsU0FBUyxFQUNULG9CQUFvQixHQUNyQixHQUFHLFlBQVksQ0FBQyxXQUFXLENBQUUsQ0FBQTtRQUU5QixJQUFJLG9CQUFvQixHQUFHLFlBQVksQ0FBQyxXQUFXLENBQUUsQ0FBQyxvQkFBb0IsQ0FBQTtRQUMxRSxJQUFJLGdCQUFnQixHQUFHLHVCQUF1QixDQUFBO1FBQzlDLElBQUksV0FBVyxFQUFFO1lBQ2YsTUFBTSxhQUFhLEdBQUcsU0FBUyxDQUFDLElBQUksQ0FBQyxXQUFXLENBQUMsQ0FBQTtZQUNqRCxnQkFBZ0IsR0FBRyxJQUFJLHNCQUFzQixDQUFDLGFBQWEsQ0FBQyxDQUFBO1NBQzdEO1FBRUQsSUFBSSxNQUFNLENBQUE7UUFDVixRQUFRLFNBQVMsRUFBRTtZQUNqQixLQUFLLE9BQU8sQ0FBQztZQUNiO2dCQUNFLE1BQU0sR0FBRyxJQUFJLFdBQVcsQ0FBQztvQkFDdkIsT0FBTztvQkFDUCxRQUFRO29CQUNSLGtCQUFrQjtvQkFDbEIsa0JBQWtCLEVBQUUsaUJBQWlCO29CQUNyQyxjQUFjO29CQUNkLG9CQUFvQjtvQkFDcEIsZ0JBQWdCO29CQUNoQixpQkFBaUIsRUFBRSxJQUFJLDBCQUEwQixFQUFFO29CQUNuRCx3QkFBd0I7b0JBQ3hCLGFBQWE7b0JBQ2IsY0FBYztvQkFDZCxlQUFlO29CQUNmLGtCQUFrQjtvQkFDbEIsU0FBUztvQkFDVCxvQkFBb0I7aUJBQ3JCLENBQUMsQ0FBQTtnQkFDRixNQUFLO1NBQ1I7UUFFRCxPQUFPO1lBQ0wsT0FBTyxFQUFFLFdBQVc7WUFDcEIsRUFBRSxFQUFFLE9BQU87WUFDWCxHQUFHO1lBQ0gsTUFBTTtZQUNOLE1BQU07WUFDTixjQUFjO1lBQ2QsY0FBYztZQUNkLGFBQWE7WUFDYixpQkFBaUI7U0FDbEIsQ0FBQTtJQUNILENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7XG4gIEFscGhhUm91dGVyLFxuICBBbHBoYVJvdXRlckNvbmZpZyxcbiAgSURfVE9fQ0hBSU5fSUQsXG4gIElSb3V0ZXIsXG4gIExlZ2FjeVJvdXRpbmdDb25maWcsXG4gIHNldEdsb2JhbExvZ2dlcixcbiAgc2V0R2xvYmFsTWV0cmljLFxuICBWM0hldXJpc3RpY0dhc01vZGVsRmFjdG9yeSxcbn0gZnJvbSAnQHRhcnR6LW9uZS9zbWFydC1vcmRlci1yb3V0ZXInXG5pbXBvcnQgeyBNZXRyaWNzTG9nZ2VyIH0gZnJvbSAnYXdzLWVtYmVkZGVkLW1ldHJpY3MnXG5pbXBvcnQgeyBBUElHYXRld2F5UHJveHlFdmVudCwgQ29udGV4dCB9IGZyb20gJ2F3cy1sYW1iZGEnXG5pbXBvcnQgeyBkZWZhdWx0IGFzIGJ1bnlhbiwgZGVmYXVsdCBhcyBMb2dnZXIgfSBmcm9tICdidW55YW4nXG5pbXBvcnQgeyBCaWdOdW1iZXIgfSBmcm9tICdldGhlcnMnXG5pbXBvcnQgeyBDb250YWluZXJJbmplY3RlZCwgSW5qZWN0b3JTT1IsIFJlcXVlc3RJbmplY3RlZCB9IGZyb20gJy4uL2luamVjdG9yLXNvcidcbmltcG9ydCB7IEFXU01ldHJpY3NMb2dnZXIgfSBmcm9tICcuLi9yb3V0ZXItZW50aXRpZXMvYXdzLW1ldHJpY3MtbG9nZ2VyJ1xuaW1wb3J0IHsgU3RhdGljR2FzUHJpY2VQcm92aWRlciB9IGZyb20gJy4uL3JvdXRlci1lbnRpdGllcy9zdGF0aWMtZ2FzLXByaWNlLXByb3ZpZGVyJ1xuaW1wb3J0IHsgUXVvdGVRdWVyeVBhcmFtcyB9IGZyb20gJy4vc2NoZW1hL3F1b3RlLXNjaGVtYSdcbmV4cG9ydCBjbGFzcyBRdW90ZUhhbmRsZXJJbmplY3RvciBleHRlbmRzIEluamVjdG9yU09SPFxuICBJUm91dGVyPEFscGhhUm91dGVyQ29uZmlnIHwgTGVnYWN5Um91dGluZ0NvbmZpZz4sXG4gIFF1b3RlUXVlcnlQYXJhbXNcbj4ge1xuICBwdWJsaWMgYXN5bmMgZ2V0UmVxdWVzdEluamVjdGVkKFxuICAgIGNvbnRhaW5lckluamVjdGVkOiBDb250YWluZXJJbmplY3RlZCxcbiAgICBfcmVxdWVzdEJvZHk6IHZvaWQsXG4gICAgcmVxdWVzdFF1ZXJ5UGFyYW1zOiBRdW90ZVF1ZXJ5UGFyYW1zLFxuICAgIF9ldmVudDogQVBJR2F0ZXdheVByb3h5RXZlbnQsXG4gICAgY29udGV4dDogQ29udGV4dCxcbiAgICBsb2c6IExvZ2dlcixcbiAgICBtZXRyaWNzTG9nZ2VyOiBNZXRyaWNzTG9nZ2VyXG4gICk6IFByb21pc2U8UmVxdWVzdEluamVjdGVkPElSb3V0ZXI8QWxwaGFSb3V0ZXJDb25maWcgfCBMZWdhY3lSb3V0aW5nQ29uZmlnPj4+IHtcbiAgICBjb25zdCByZXF1ZXN0SWQgPSBjb250ZXh0LmF3c1JlcXVlc3RJZFxuICAgIGNvbnN0IHF1b3RlSWQgPSByZXF1ZXN0SWQuc3Vic3RyaW5nKDAsIDUpXG4gICAgY29uc3QgbG9nTGV2ZWwgPSBidW55YW4uSU5GT1xuXG4gICAgY29uc3QgeyB0b2tlbkluQWRkcmVzcywgdG9rZW5JbkNoYWluSWQsIHRva2VuT3V0QWRkcmVzcywgYW1vdW50LCB0eXBlLCBhbGdvcml0aG0sIGdhc1ByaWNlV2VpIH0gPSByZXF1ZXN0UXVlcnlQYXJhbXNcblxuICAgIGxvZyA9IGxvZy5jaGlsZCh7XG4gICAgICBzZXJpYWxpemVyczogYnVueWFuLnN0ZFNlcmlhbGl6ZXJzLFxuICAgICAgbGV2ZWw6IGxvZ0xldmVsLFxuICAgICAgcmVxdWVzdElkLFxuICAgICAgcXVvdGVJZCxcbiAgICAgIHRva2VuSW5BZGRyZXNzLFxuICAgICAgY2hhaW5JZDogdG9rZW5JbkNoYWluSWQsXG4gICAgICB0b2tlbk91dEFkZHJlc3MsXG4gICAgICBhbW91bnQsXG4gICAgICB0eXBlLFxuICAgICAgYWxnb3JpdGhtLFxuICAgIH0pXG4gICAgc2V0R2xvYmFsTG9nZ2VyKGxvZylcblxuICAgIG1ldHJpY3NMb2dnZXIuc2V0TmFtZXNwYWNlKCdVbmlzd2FwJylcbiAgICBtZXRyaWNzTG9nZ2VyLnNldERpbWVuc2lvbnMoeyBTZXJ2aWNlOiAnUm91dGluZ0FQSScgfSlcbiAgICBjb25zdCBtZXRyaWMgPSBuZXcgQVdTTWV0cmljc0xvZ2dlcihtZXRyaWNzTG9nZ2VyKVxuICAgIHNldEdsb2JhbE1ldHJpYyhtZXRyaWMpXG5cbiAgICAvLyBUb2RheSBBUEkgaXMgcmVzdHJpY3RlZCBzdWNoIHRoYXQgYm90aCB0b2tlbnMgbXVzdCBiZSBvbiB0aGUgc2FtZSBjaGFpbi5cbiAgICBjb25zdCBjaGFpbklkID0gdG9rZW5JbkNoYWluSWRcbiAgICBjb25zdCBjaGFpbklkRW51bSA9IElEX1RPX0NIQUlOX0lEKGNoYWluSWQpXG5cbiAgICBjb25zdCB7IGRlcGVuZGVuY2llcyB9ID0gY29udGFpbmVySW5qZWN0ZWRcblxuICAgIGlmICghZGVwZW5kZW5jaWVzW2NoYWluSWRFbnVtXSkge1xuICAgICAgLy8gUmVxdWVzdCB2YWxpZGF0aW9uIHNob3VsZCBwcmV2ZW50IHJlamVjdCB1bnN1cHBvcnRlZCBjaGFpbnMgd2l0aCA0eHggYWxyZWFkeSwgc28gdGhpcyBzaG91bGQgbm90IGJlIHBvc3NpYmxlLlxuICAgICAgdGhyb3cgbmV3IEVycm9yKGBObyBjb250YWluZXIgaW5qZWN0ZWQgZGVwZW5kZW5jaWVzIGZvciBjaGFpbjogJHtjaGFpbklkRW51bX1gKVxuICAgIH1cblxuICAgIGNvbnN0IHtcbiAgICAgIHByb3ZpZGVyLFxuICAgICAgdjNQb29sUHJvdmlkZXIsXG4gICAgICBtdWx0aWNhbGxQcm92aWRlcixcbiAgICAgIHRva2VuUHJvdmlkZXIsXG4gICAgICB0b2tlbkxpc3RQcm92aWRlcixcbiAgICAgIHYzU3ViZ3JhcGhQcm92aWRlcixcbiAgICAgIGJsb2NrZWRUb2tlbkxpc3RQcm92aWRlcixcbiAgICAgIHYyUG9vbFByb3ZpZGVyLFxuICAgICAgdjJRdW90ZVByb3ZpZGVyLFxuICAgICAgdjJTdWJncmFwaFByb3ZpZGVyLFxuICAgICAgZ2FzUHJpY2VQcm92aWRlcjogZ2FzUHJpY2VQcm92aWRlck9uQ2hhaW4sXG4gICAgICBzaW11bGF0b3IsXG4gICAgICByb3V0ZUNhY2hpbmdQcm92aWRlcixcbiAgICB9ID0gZGVwZW5kZW5jaWVzW2NoYWluSWRFbnVtXSFcblxuICAgIGxldCBvbkNoYWluUXVvdGVQcm92aWRlciA9IGRlcGVuZGVuY2llc1tjaGFpbklkRW51bV0hLm9uQ2hhaW5RdW90ZVByb3ZpZGVyXG4gICAgbGV0IGdhc1ByaWNlUHJvdmlkZXIgPSBnYXNQcmljZVByb3ZpZGVyT25DaGFpblxuICAgIGlmIChnYXNQcmljZVdlaSkge1xuICAgICAgY29uc3QgZ2FzUHJpY2VXZWlCTiA9IEJpZ051bWJlci5mcm9tKGdhc1ByaWNlV2VpKVxuICAgICAgZ2FzUHJpY2VQcm92aWRlciA9IG5ldyBTdGF0aWNHYXNQcmljZVByb3ZpZGVyKGdhc1ByaWNlV2VpQk4pXG4gICAgfVxuXG4gICAgbGV0IHJvdXRlclxuICAgIHN3aXRjaCAoYWxnb3JpdGhtKSB7XG4gICAgICBjYXNlICdhbHBoYSc6XG4gICAgICBkZWZhdWx0OlxuICAgICAgICByb3V0ZXIgPSBuZXcgQWxwaGFSb3V0ZXIoe1xuICAgICAgICAgIGNoYWluSWQsXG4gICAgICAgICAgcHJvdmlkZXIsXG4gICAgICAgICAgdjNTdWJncmFwaFByb3ZpZGVyLFxuICAgICAgICAgIG11bHRpY2FsbDJQcm92aWRlcjogbXVsdGljYWxsUHJvdmlkZXIsXG4gICAgICAgICAgdjNQb29sUHJvdmlkZXIsXG4gICAgICAgICAgb25DaGFpblF1b3RlUHJvdmlkZXIsXG4gICAgICAgICAgZ2FzUHJpY2VQcm92aWRlcixcbiAgICAgICAgICB2M0dhc01vZGVsRmFjdG9yeTogbmV3IFYzSGV1cmlzdGljR2FzTW9kZWxGYWN0b3J5KCksXG4gICAgICAgICAgYmxvY2tlZFRva2VuTGlzdFByb3ZpZGVyLFxuICAgICAgICAgIHRva2VuUHJvdmlkZXIsXG4gICAgICAgICAgdjJQb29sUHJvdmlkZXIsXG4gICAgICAgICAgdjJRdW90ZVByb3ZpZGVyLFxuICAgICAgICAgIHYyU3ViZ3JhcGhQcm92aWRlcixcbiAgICAgICAgICBzaW11bGF0b3IsXG4gICAgICAgICAgcm91dGVDYWNoaW5nUHJvdmlkZXIsXG4gICAgICAgIH0pXG4gICAgICAgIGJyZWFrXG4gICAgfVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIGNoYWluSWQ6IGNoYWluSWRFbnVtLFxuICAgICAgaWQ6IHF1b3RlSWQsXG4gICAgICBsb2csXG4gICAgICBtZXRyaWMsXG4gICAgICByb3V0ZXIsXG4gICAgICB2M1Bvb2xQcm92aWRlcixcbiAgICAgIHYyUG9vbFByb3ZpZGVyLFxuICAgICAgdG9rZW5Qcm92aWRlcixcbiAgICAgIHRva2VuTGlzdFByb3ZpZGVyLFxuICAgIH1cbiAgfVxufVxuIl19