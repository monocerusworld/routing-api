import * as cdk from 'aws-cdk-lib';
import * as aws_cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import _ from 'lodash';
import { QuoteAmountsWidgetsFactory } from '../../lib/dashboards/quote-amounts-widgets-factory';
import { SUPPORTED_CHAINS } from '../../lib/handlers/injector-sor';
import { CachedRoutesWidgetsFactory } from '../../lib/dashboards/cached-routes-widgets-factory';
export const NAMESPACE = 'Uniswap';
export class RoutingDashboardStack extends cdk.NestedStack {
    constructor(scope, name, props) {
        super(scope, name, props);
        const { apiName, routingLambdaName, poolCacheLambdaNameArray, ipfsPoolCacheLambdaName } = props;
        const region = cdk.Stack.of(this).region;
        // No CDK resource exists for contributor insights at the moment so use raw CloudFormation.
        const REQUESTED_QUOTES_RULE_NAME = 'RequestedQuotes';
        const REQUESTED_QUOTES_BY_CHAIN_RULE_NAME = 'RequestedQuotesByChain';
        new cdk.CfnResource(this, 'QuoteContributorInsights', {
            type: 'AWS::CloudWatch::InsightRule',
            properties: {
                RuleBody: JSON.stringify({
                    Schema: {
                        Name: 'CloudWatchLogRule',
                        Version: 1,
                    },
                    AggregateOn: 'Count',
                    Contribution: {
                        Filters: [
                            {
                                Match: '$.tokenPairSymbol',
                                IsPresent: true,
                            },
                        ],
                        Keys: ['$.tokenPairSymbol'],
                    },
                    LogFormat: 'JSON',
                    LogGroupNames: [`/aws/lambda/${routingLambdaName}`],
                }),
                RuleName: REQUESTED_QUOTES_RULE_NAME,
                RuleState: 'ENABLED',
            },
        });
        new cdk.CfnResource(this, 'QuoteByChainContributorInsights', {
            type: 'AWS::CloudWatch::InsightRule',
            properties: {
                RuleBody: JSON.stringify({
                    Schema: {
                        Name: 'CloudWatchLogRule',
                        Version: 1,
                    },
                    AggregateOn: 'Count',
                    Contribution: {
                        Filters: [
                            {
                                Match: '$.tokenPairSymbolChain',
                                IsPresent: true,
                            },
                        ],
                        Keys: ['$.tokenPairSymbolChain'],
                    },
                    LogFormat: 'JSON',
                    LogGroupNames: [`/aws/lambda/${routingLambdaName}`],
                }),
                RuleName: REQUESTED_QUOTES_BY_CHAIN_RULE_NAME,
                RuleState: 'ENABLED',
            },
        });
        const poolCacheLambdaMetrics = [];
        poolCacheLambdaNameArray.forEach((poolCacheLambdaName) => {
            poolCacheLambdaMetrics.push(['AWS/Lambda', `${poolCacheLambdaName}Errors`, 'FunctionName', poolCacheLambdaName]);
            poolCacheLambdaMetrics.push(['.', `${poolCacheLambdaName}Invocations`, '.', '.']);
        });
        new aws_cloudwatch.CfnDashboard(this, 'RoutingAPIDashboard', {
            dashboardName: `RoutingDashboard`,
            dashboardBody: JSON.stringify({
                periodOverride: 'inherit',
                widgets: [
                    {
                        type: 'metric',
                        x: 0,
                        y: 66,
                        width: 24,
                        height: 9,
                        properties: {
                            view: 'timeSeries',
                            stacked: false,
                            metrics: [
                                ...poolCacheLambdaMetrics,
                                ...(ipfsPoolCacheLambdaName
                                    ? [
                                        ['AWS/Lambda', 'Errors', 'FunctionName', ipfsPoolCacheLambdaName],
                                        ['.', 'Invocations', '.', '.'],
                                    ]
                                    : []),
                            ],
                            region: region,
                            title: 'Pool Cache Lambda Error/Invocations | 5min',
                            stat: 'Sum',
                        },
                    },
                    {
                        height: 6,
                        width: 24,
                        y: 0,
                        x: 0,
                        type: 'metric',
                        properties: {
                            metrics: [
                                ['AWS/ApiGateway', 'Count', 'ApiName', apiName, { label: 'Requests' }],
                                ['.', '5XXError', '.', '.', { label: '5XXError Responses', color: '#ff7f0e' }],
                                ['.', '4XXError', '.', '.', { label: '4XXError Responses', color: '#2ca02c' }],
                            ],
                            view: 'timeSeries',
                            stacked: false,
                            region,
                            stat: 'Sum',
                            period: 300,
                            title: 'Total Requests/Responses | 5min',
                        },
                    },
                    {
                        height: 6,
                        width: 24,
                        y: 6,
                        x: 0,
                        type: 'metric',
                        properties: {
                            metrics: [
                                [
                                    {
                                        expression: 'm1 * 100',
                                        label: '5XX Error Rate',
                                        id: 'e1',
                                        color: '#ff7f0e',
                                    },
                                ],
                                [
                                    {
                                        expression: 'm2 * 100',
                                        label: '4XX Error Rate',
                                        id: 'e2',
                                        color: '#2ca02c',
                                    },
                                ],
                                [
                                    'AWS/ApiGateway',
                                    '5XXError',
                                    'ApiName',
                                    'Routing API',
                                    { id: 'm1', label: '5XXError', visible: false },
                                ],
                                ['.', '4XXError', '.', '.', { id: 'm2', visible: false }],
                            ],
                            view: 'timeSeries',
                            stacked: false,
                            region,
                            stat: 'Average',
                            period: 300,
                            title: '5XX/4XX Error Rates | 5min',
                            setPeriodToTimeRange: true,
                            yAxis: {
                                left: {
                                    showUnits: false,
                                    label: '%',
                                },
                            },
                        },
                    },
                    {
                        height: 6,
                        width: 24,
                        y: 12,
                        x: 0,
                        type: 'metric',
                        properties: {
                            metrics: [['AWS/ApiGateway', 'Latency', 'ApiName', apiName]],
                            view: 'timeSeries',
                            stacked: false,
                            region,
                            period: 300,
                            stat: 'p90',
                            title: 'Latency p90 | 5min',
                        },
                    },
                    {
                        type: 'metric',
                        x: 0,
                        y: 18,
                        width: 24,
                        height: 6,
                        properties: {
                            view: 'timeSeries',
                            stacked: false,
                            metrics: [
                                [NAMESPACE, 'QuotesFetched', 'Service', 'RoutingAPI'],
                                [NAMESPACE, 'V3QuotesFetched', 'Service', 'RoutingAPI'],
                                [NAMESPACE, 'V2QuotesFetched', 'Service', 'RoutingAPI'],
                                [NAMESPACE, 'MixedQuotesFetched', 'Service', 'RoutingAPI'],
                            ],
                            region,
                            title: 'p90 Quotes Fetched Per Swap',
                            period: 300,
                            stat: 'p90',
                        },
                    },
                    {
                        type: 'metric',
                        x: 0,
                        y: 25,
                        width: 24,
                        height: 6,
                        properties: {
                            view: 'timeSeries',
                            stacked: false,
                            insightRule: {
                                maxContributorCount: 25,
                                orderBy: 'Sum',
                                ruleName: REQUESTED_QUOTES_RULE_NAME,
                            },
                            legend: {
                                position: 'bottom',
                            },
                            region,
                            title: 'Requested Quotes',
                            period: 300,
                            stat: 'Sum',
                        },
                    },
                    {
                        type: 'metric',
                        x: 0,
                        y: 26,
                        width: 24,
                        height: 6,
                        properties: {
                            view: 'timeSeries',
                            stacked: false,
                            insightRule: {
                                maxContributorCount: 25,
                                orderBy: 'Sum',
                                ruleName: REQUESTED_QUOTES_BY_CHAIN_RULE_NAME,
                            },
                            legend: {
                                position: 'bottom',
                            },
                            region,
                            title: 'Requested Quotes By Chain',
                            period: 300,
                            stat: 'Sum',
                        },
                    },
                    {
                        type: 'metric',
                        x: 0,
                        y: 24,
                        width: 24,
                        height: 6,
                        properties: {
                            view: 'timeSeries',
                            stacked: false,
                            metrics: [
                                [NAMESPACE, 'MixedAndV3AndV2SplitRoute', 'Service', 'RoutingAPI'],
                                [NAMESPACE, 'MixedAndV3SplitRoute', 'Service', 'RoutingAPI'],
                                [NAMESPACE, 'MixedAndV2SplitRoute', 'Service', 'RoutingAPI'],
                                [NAMESPACE, 'MixedSplitRoute', 'Service', 'RoutingAPI'],
                                [NAMESPACE, 'MixedRoute', 'Service', 'RoutingAPI'],
                                [NAMESPACE, 'V3AndV2SplitRoute', 'Service', 'RoutingAPI'],
                                [NAMESPACE, 'V3SplitRoute', 'Service', 'RoutingAPI'],
                                [NAMESPACE, 'V3Route', 'Service', 'RoutingAPI'],
                                [NAMESPACE, 'V2SplitRoute', 'Service', 'RoutingAPI'],
                                [NAMESPACE, 'V2Route', 'Service', 'RoutingAPI'],
                            ],
                            region,
                            title: 'Types of routes returned across all chains',
                            period: 300,
                            stat: 'Sum',
                        },
                    },
                    {
                        type: 'metric',
                        x: 0,
                        y: 30,
                        width: 24,
                        height: 6,
                        properties: {
                            view: 'timeSeries',
                            stacked: false,
                            metrics: _.flatMap(SUPPORTED_CHAINS, (chainId) => [
                                [NAMESPACE, `MixedAndV3AndV2SplitRouteForChain${chainId}`, 'Service', 'RoutingAPI'],
                                [NAMESPACE, `MixedAndV3SplitRouteForChain${chainId}`, 'Service', 'RoutingAPI'],
                                [NAMESPACE, `MixedAndV2SplitRouteForChain${chainId}`, 'Service', 'RoutingAPI'],
                                [NAMESPACE, `MixedSplitRouteForChain${chainId}`, 'Service', 'RoutingAPI'],
                                [NAMESPACE, `MixedRouteForChain${chainId}`, 'Service', 'RoutingAPI'],
                                [NAMESPACE, `V3AndV2SplitRouteForChain${chainId}`, 'Service', 'RoutingAPI'],
                                [NAMESPACE, `V3SplitRouteForChain${chainId}`, 'Service', 'RoutingAPI'],
                                [NAMESPACE, `V3RouteForChain${chainId}`, 'Service', 'RoutingAPI'],
                                [NAMESPACE, `V2SplitRouteForChain${chainId}`, 'Service', 'RoutingAPI'],
                                [NAMESPACE, `V2RouteForChain${chainId}`, 'Service', 'RoutingAPI'],
                            ]),
                            region,
                            title: 'Types of V3 routes returned by chain',
                            period: 300,
                            stat: 'Sum',
                        },
                    },
                    {
                        type: 'metric',
                        x: 0,
                        y: 36,
                        width: 24,
                        height: 6,
                        properties: {
                            metrics: _.flatMap(SUPPORTED_CHAINS, (chainId) => [
                                ['Uniswap', `QuoteFoundForChain${chainId}`, 'Service', 'RoutingAPI'],
                                ['Uniswap', `QuoteRequestedForChain${chainId}`, 'Service', 'RoutingAPI'],
                            ]),
                            view: 'timeSeries',
                            stacked: false,
                            stat: 'Sum',
                            period: 300,
                            region,
                            title: 'Quote Requested/Found by Chain',
                        },
                    },
                    {
                        height: 12,
                        width: 24,
                        y: 42,
                        x: 0,
                        type: 'metric',
                        properties: {
                            metrics: [
                                [NAMESPACE, 'TokenListLoad', 'Service', 'RoutingAPI', { color: '#c5b0d5' }],
                                ['.', 'GasPriceLoad', '.', '.', { color: '#17becf' }],
                                ['.', 'V3PoolsLoad', '.', '.', { color: '#e377c2' }],
                                ['.', 'V2PoolsLoad', '.', '.', { color: '#e377c2' }],
                                ['.', 'V3SubgraphPoolsLoad', '.', '.', { color: '#1f77b4' }],
                                ['.', 'V2SubgraphPoolsLoad', '.', '.', { color: '#bf77b4' }],
                                ['.', 'V3QuotesLoad', '.', '.', { color: '#2ca02c' }],
                                ['.', 'MixedQuotesLoad', '.', '.', { color: '#fefa63' }],
                                ['.', 'V2QuotesLoad', '.', '.', { color: '#7f7f7f' }],
                                ['.', 'FindBestSwapRoute', '.', '.', { color: '#d62728' }],
                            ],
                            view: 'timeSeries',
                            stacked: true,
                            region,
                            stat: 'p90',
                            period: 300,
                            title: 'Latency Breakdown | 5min',
                        },
                    },
                    {
                        type: 'metric',
                        x: 0,
                        y: 48,
                        width: 24,
                        height: 9,
                        properties: {
                            view: 'timeSeries',
                            stacked: false,
                            metrics: [
                                [NAMESPACE, 'V3top2directswappool', 'Service', 'RoutingAPI'],
                                ['.', 'V3top2ethquotetokenpool', '.', '.'],
                                ['.', 'V3topbytvl', '.', '.'],
                                ['.', 'V3topbytvlusingtokenin', '.', '.'],
                                ['.', 'V3topbytvlusingtokeninsecondhops', '.', '.'],
                                ['.', 'V2topbytvlusingtokenout', '.', '.'],
                                ['.', 'V3topbytvlusingtokenoutsecondhops', '.', '.'],
                                ['.', 'V3topbybasewithtokenin', '.', '.'],
                                ['.', 'V3topbybasewithtokenout', '.', '.'],
                            ],
                            region: region,
                            title: 'p95 V3 Top N Pools Used From Sources in Best Route | 5min',
                            stat: 'p95',
                        },
                    },
                    {
                        type: 'metric',
                        x: 0,
                        y: 54,
                        width: 24,
                        height: 9,
                        properties: {
                            view: 'timeSeries',
                            stacked: false,
                            metrics: [
                                [NAMESPACE, 'V2top2directswappool', 'Service', 'RoutingAPI'],
                                ['.', 'V2top2ethquotetokenpool', '.', '.'],
                                ['.', 'V2topbytvl', '.', '.'],
                                ['.', 'V2topbytvlusingtokenin', '.', '.'],
                                ['.', 'V2topbytvlusingtokeninsecondhops', '.', '.'],
                                ['.', 'V2topbytvlusingtokenout', '.', '.'],
                                ['.', 'V2topbytvlusingtokenoutsecondhops', '.', '.'],
                                ['.', 'V2topbybasewithtokenin', '.', '.'],
                                ['.', 'V2topbybasewithtokenout', '.', '.'],
                            ],
                            region: region,
                            title: 'p95 V2 Top N Pools Used From Sources in Best Route | 5min',
                            stat: 'p95',
                        },
                    },
                    {
                        type: 'metric',
                        x: 0,
                        y: 60,
                        width: 24,
                        height: 9,
                        properties: {
                            view: 'timeSeries',
                            stacked: false,
                            metrics: [
                                ['AWS/Lambda', 'ProvisionedConcurrentExecutions', 'FunctionName', routingLambdaName],
                                ['.', 'ConcurrentExecutions', '.', '.'],
                                ['.', 'ProvisionedConcurrencySpilloverInvocations', '.', '.'],
                            ],
                            region: region,
                            title: 'Routing Lambda Provisioned Concurrency | 5min',
                            stat: 'Average',
                        },
                    },
                ],
            }),
        });
        const quoteAmountsWidgets = new QuoteAmountsWidgetsFactory(NAMESPACE, region);
        new aws_cloudwatch.CfnDashboard(this, 'RoutingAPITrackedPairsDashboard', {
            dashboardName: 'RoutingAPITrackedPairsDashboard',
            dashboardBody: JSON.stringify({
                periodOverride: 'inherit',
                widgets: quoteAmountsWidgets.generateWidgets(),
            }),
        });
        const cachedRoutesWidgets = new CachedRoutesWidgetsFactory(NAMESPACE, region, routingLambdaName);
        new aws_cloudwatch.CfnDashboard(this, 'CachedRoutesPerformanceDashboard', {
            dashboardName: 'CachedRoutesPerformanceDashboard',
            dashboardBody: JSON.stringify({
                periodOverride: 'inherit',
                widgets: cachedRoutesWidgets.generateWidgets(),
            }),
        });
        new aws_cloudwatch.CfnDashboard(this, 'RoutingAPIQuoteProviderDashboard', {
            dashboardName: `RoutingQuoteProviderDashboard`,
            dashboardBody: JSON.stringify({
                periodOverride: 'inherit',
                widgets: [
                    {
                        height: 6,
                        width: 24,
                        y: 0,
                        x: 0,
                        type: 'metric',
                        properties: {
                            metrics: [[NAMESPACE, 'QuoteApproxGasUsedPerSuccessfulCall', 'Service', 'RoutingAPI']],
                            view: 'timeSeries',
                            stacked: false,
                            region,
                            stat: 'Average',
                            period: 300,
                            title: 'Approx gas used by each call',
                        },
                    },
                    {
                        height: 6,
                        width: 24,
                        y: 6,
                        x: 0,
                        type: 'metric',
                        properties: {
                            metrics: [
                                [NAMESPACE, 'QuoteTotalCallsToProvider', 'Service', 'RoutingAPI'],
                                ['.', 'QuoteExpectedCallsToProvider', '.', '.'],
                                ['.', 'QuoteNumRetriedCalls', '.', '.'],
                                ['.', 'QuoteNumRetryLoops', '.', '.'],
                            ],
                            view: 'timeSeries',
                            stacked: false,
                            region,
                            stat: 'Average',
                            period: 300,
                            title: 'Number of retries to provider needed to get quote',
                        },
                    },
                    {
                        height: 6,
                        width: 24,
                        y: 12,
                        x: 0,
                        type: 'metric',
                        properties: {
                            metrics: [
                                [NAMESPACE, 'QuoteOutOfGasExceptionRetry', 'Service', 'RoutingAPI'],
                                ['.', 'QuoteSuccessRateRetry', '.', '.'],
                                ['.', 'QuoteBlockHeaderNotFoundRetry', '.', '.'],
                                ['.', 'QuoteTimeoutRetry', '.', '.'],
                                ['.', 'QuoteUnknownReasonRetry', '.', '.'],
                                ['.', 'QuoteBlockConflictErrorRetry', '.', '.'],
                            ],
                            view: 'timeSeries',
                            stacked: false,
                            region,
                            period: 300,
                            stat: 'Sum',
                            title: 'Number of requests that retried in the quote provider',
                        },
                    },
                ],
            }),
        });
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicm91dGluZy1kYXNoYm9hcmQtc3RhY2suanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9iaW4vc3RhY2tzL3JvdXRpbmctZGFzaGJvYXJkLXN0YWNrLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUNBLE9BQU8sS0FBSyxHQUFHLE1BQU0sYUFBYSxDQUFBO0FBQ2xDLE9BQU8sS0FBSyxjQUFjLE1BQU0sNEJBQTRCLENBQUE7QUFFNUQsT0FBTyxDQUFDLE1BQU0sUUFBUSxDQUFBO0FBQ3RCLE9BQU8sRUFBRSwwQkFBMEIsRUFBRSxNQUFNLG9EQUFvRCxDQUFBO0FBQy9GLE9BQU8sRUFBRSxnQkFBZ0IsRUFBRSxNQUFNLGlDQUFpQyxDQUFBO0FBQ2xFLE9BQU8sRUFBRSwwQkFBMEIsRUFBRSxNQUFNLG9EQUFvRCxDQUFBO0FBRS9GLE1BQU0sQ0FBQyxNQUFNLFNBQVMsR0FBRyxTQUFTLENBQUE7QUFrQmxDLE1BQU0sT0FBTyxxQkFBc0IsU0FBUSxHQUFHLENBQUMsV0FBVztJQUN4RCxZQUFZLEtBQWdCLEVBQUUsSUFBWSxFQUFFLEtBQTRCO1FBQ3RFLEtBQUssQ0FBQyxLQUFLLEVBQUUsSUFBSSxFQUFFLEtBQUssQ0FBQyxDQUFBO1FBRXpCLE1BQU0sRUFBRSxPQUFPLEVBQUUsaUJBQWlCLEVBQUUsd0JBQXdCLEVBQUUsdUJBQXVCLEVBQUUsR0FBRyxLQUFLLENBQUE7UUFDL0YsTUFBTSxNQUFNLEdBQUcsR0FBRyxDQUFDLEtBQUssQ0FBQyxFQUFFLENBQUMsSUFBSSxDQUFDLENBQUMsTUFBTSxDQUFBO1FBRXhDLDJGQUEyRjtRQUMzRixNQUFNLDBCQUEwQixHQUFHLGlCQUFpQixDQUFBO1FBQ3BELE1BQU0sbUNBQW1DLEdBQUcsd0JBQXdCLENBQUE7UUFDcEUsSUFBSSxHQUFHLENBQUMsV0FBVyxDQUFDLElBQUksRUFBRSwwQkFBMEIsRUFBRTtZQUNwRCxJQUFJLEVBQUUsOEJBQThCO1lBQ3BDLFVBQVUsRUFBRTtnQkFDVixRQUFRLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQztvQkFDdkIsTUFBTSxFQUFFO3dCQUNOLElBQUksRUFBRSxtQkFBbUI7d0JBQ3pCLE9BQU8sRUFBRSxDQUFDO3FCQUNYO29CQUNELFdBQVcsRUFBRSxPQUFPO29CQUNwQixZQUFZLEVBQUU7d0JBQ1osT0FBTyxFQUFFOzRCQUNQO2dDQUNFLEtBQUssRUFBRSxtQkFBbUI7Z0NBQzFCLFNBQVMsRUFBRSxJQUFJOzZCQUNoQjt5QkFDRjt3QkFDRCxJQUFJLEVBQUUsQ0FBQyxtQkFBbUIsQ0FBQztxQkFDNUI7b0JBQ0QsU0FBUyxFQUFFLE1BQU07b0JBQ2pCLGFBQWEsRUFBRSxDQUFDLGVBQWUsaUJBQWlCLEVBQUUsQ0FBQztpQkFDcEQsQ0FBQztnQkFDRixRQUFRLEVBQUUsMEJBQTBCO2dCQUNwQyxTQUFTLEVBQUUsU0FBUzthQUNyQjtTQUNGLENBQUMsQ0FBQTtRQUVGLElBQUksR0FBRyxDQUFDLFdBQVcsQ0FBQyxJQUFJLEVBQUUsaUNBQWlDLEVBQUU7WUFDM0QsSUFBSSxFQUFFLDhCQUE4QjtZQUNwQyxVQUFVLEVBQUU7Z0JBQ1YsUUFBUSxFQUFFLElBQUksQ0FBQyxTQUFTLENBQUM7b0JBQ3ZCLE1BQU0sRUFBRTt3QkFDTixJQUFJLEVBQUUsbUJBQW1CO3dCQUN6QixPQUFPLEVBQUUsQ0FBQztxQkFDWDtvQkFDRCxXQUFXLEVBQUUsT0FBTztvQkFDcEIsWUFBWSxFQUFFO3dCQUNaLE9BQU8sRUFBRTs0QkFDUDtnQ0FDRSxLQUFLLEVBQUUsd0JBQXdCO2dDQUMvQixTQUFTLEVBQUUsSUFBSTs2QkFDaEI7eUJBQ0Y7d0JBQ0QsSUFBSSxFQUFFLENBQUMsd0JBQXdCLENBQUM7cUJBQ2pDO29CQUNELFNBQVMsRUFBRSxNQUFNO29CQUNqQixhQUFhLEVBQUUsQ0FBQyxlQUFlLGlCQUFpQixFQUFFLENBQUM7aUJBQ3BELENBQUM7Z0JBQ0YsUUFBUSxFQUFFLG1DQUFtQztnQkFDN0MsU0FBUyxFQUFFLFNBQVM7YUFDckI7U0FDRixDQUFDLENBQUE7UUFFRixNQUFNLHNCQUFzQixHQUFlLEVBQUUsQ0FBQTtRQUM3Qyx3QkFBd0IsQ0FBQyxPQUFPLENBQUMsQ0FBQyxtQkFBbUIsRUFBRSxFQUFFO1lBQ3ZELHNCQUFzQixDQUFDLElBQUksQ0FBQyxDQUFDLFlBQVksRUFBRSxHQUFHLG1CQUFtQixRQUFRLEVBQUUsY0FBYyxFQUFFLG1CQUFtQixDQUFDLENBQUMsQ0FBQTtZQUNoSCxzQkFBc0IsQ0FBQyxJQUFJLENBQUMsQ0FBQyxHQUFHLEVBQUUsR0FBRyxtQkFBbUIsYUFBYSxFQUFFLEdBQUcsRUFBRSxHQUFHLENBQUMsQ0FBQyxDQUFBO1FBQ25GLENBQUMsQ0FBQyxDQUFBO1FBQ0YsSUFBSSxjQUFjLENBQUMsWUFBWSxDQUFDLElBQUksRUFBRSxxQkFBcUIsRUFBRTtZQUMzRCxhQUFhLEVBQUUsa0JBQWtCO1lBQ2pDLGFBQWEsRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDO2dCQUM1QixjQUFjLEVBQUUsU0FBUztnQkFDekIsT0FBTyxFQUFFO29CQUNQO3dCQUNFLElBQUksRUFBRSxRQUFRO3dCQUNkLENBQUMsRUFBRSxDQUFDO3dCQUNKLENBQUMsRUFBRSxFQUFFO3dCQUNMLEtBQUssRUFBRSxFQUFFO3dCQUNULE1BQU0sRUFBRSxDQUFDO3dCQUNULFVBQVUsRUFBRTs0QkFDVixJQUFJLEVBQUUsWUFBWTs0QkFDbEIsT0FBTyxFQUFFLEtBQUs7NEJBQ2QsT0FBTyxFQUFFO2dDQUNQLEdBQUcsc0JBQXNCO2dDQUN6QixHQUFHLENBQUMsdUJBQXVCO29DQUN6QixDQUFDLENBQUM7d0NBQ0UsQ0FBQyxZQUFZLEVBQUUsUUFBUSxFQUFFLGNBQWMsRUFBRSx1QkFBdUIsQ0FBQzt3Q0FDakUsQ0FBQyxHQUFHLEVBQUUsYUFBYSxFQUFFLEdBQUcsRUFBRSxHQUFHLENBQUM7cUNBQy9CO29DQUNILENBQUMsQ0FBQyxFQUFFLENBQUM7NkJBQ1I7NEJBQ0QsTUFBTSxFQUFFLE1BQU07NEJBQ2QsS0FBSyxFQUFFLDRDQUE0Qzs0QkFDbkQsSUFBSSxFQUFFLEtBQUs7eUJBQ1o7cUJBQ0Y7b0JBQ0Q7d0JBQ0UsTUFBTSxFQUFFLENBQUM7d0JBQ1QsS0FBSyxFQUFFLEVBQUU7d0JBQ1QsQ0FBQyxFQUFFLENBQUM7d0JBQ0osQ0FBQyxFQUFFLENBQUM7d0JBQ0osSUFBSSxFQUFFLFFBQVE7d0JBQ2QsVUFBVSxFQUFFOzRCQUNWLE9BQU8sRUFBRTtnQ0FDUCxDQUFDLGdCQUFnQixFQUFFLE9BQU8sRUFBRSxTQUFTLEVBQUUsT0FBTyxFQUFFLEVBQUUsS0FBSyxFQUFFLFVBQVUsRUFBRSxDQUFDO2dDQUN0RSxDQUFDLEdBQUcsRUFBRSxVQUFVLEVBQUUsR0FBRyxFQUFFLEdBQUcsRUFBRSxFQUFFLEtBQUssRUFBRSxvQkFBb0IsRUFBRSxLQUFLLEVBQUUsU0FBUyxFQUFFLENBQUM7Z0NBQzlFLENBQUMsR0FBRyxFQUFFLFVBQVUsRUFBRSxHQUFHLEVBQUUsR0FBRyxFQUFFLEVBQUUsS0FBSyxFQUFFLG9CQUFvQixFQUFFLEtBQUssRUFBRSxTQUFTLEVBQUUsQ0FBQzs2QkFDL0U7NEJBQ0QsSUFBSSxFQUFFLFlBQVk7NEJBQ2xCLE9BQU8sRUFBRSxLQUFLOzRCQUNkLE1BQU07NEJBQ04sSUFBSSxFQUFFLEtBQUs7NEJBQ1gsTUFBTSxFQUFFLEdBQUc7NEJBQ1gsS0FBSyxFQUFFLGlDQUFpQzt5QkFDekM7cUJBQ0Y7b0JBQ0Q7d0JBQ0UsTUFBTSxFQUFFLENBQUM7d0JBQ1QsS0FBSyxFQUFFLEVBQUU7d0JBQ1QsQ0FBQyxFQUFFLENBQUM7d0JBQ0osQ0FBQyxFQUFFLENBQUM7d0JBQ0osSUFBSSxFQUFFLFFBQVE7d0JBQ2QsVUFBVSxFQUFFOzRCQUNWLE9BQU8sRUFBRTtnQ0FDUDtvQ0FDRTt3Q0FDRSxVQUFVLEVBQUUsVUFBVTt3Q0FDdEIsS0FBSyxFQUFFLGdCQUFnQjt3Q0FDdkIsRUFBRSxFQUFFLElBQUk7d0NBQ1IsS0FBSyxFQUFFLFNBQVM7cUNBQ2pCO2lDQUNGO2dDQUNEO29DQUNFO3dDQUNFLFVBQVUsRUFBRSxVQUFVO3dDQUN0QixLQUFLLEVBQUUsZ0JBQWdCO3dDQUN2QixFQUFFLEVBQUUsSUFBSTt3Q0FDUixLQUFLLEVBQUUsU0FBUztxQ0FDakI7aUNBQ0Y7Z0NBQ0Q7b0NBQ0UsZ0JBQWdCO29DQUNoQixVQUFVO29DQUNWLFNBQVM7b0NBQ1QsYUFBYTtvQ0FDYixFQUFFLEVBQUUsRUFBRSxJQUFJLEVBQUUsS0FBSyxFQUFFLFVBQVUsRUFBRSxPQUFPLEVBQUUsS0FBSyxFQUFFO2lDQUNoRDtnQ0FDRCxDQUFDLEdBQUcsRUFBRSxVQUFVLEVBQUUsR0FBRyxFQUFFLEdBQUcsRUFBRSxFQUFFLEVBQUUsRUFBRSxJQUFJLEVBQUUsT0FBTyxFQUFFLEtBQUssRUFBRSxDQUFDOzZCQUMxRDs0QkFDRCxJQUFJLEVBQUUsWUFBWTs0QkFDbEIsT0FBTyxFQUFFLEtBQUs7NEJBQ2QsTUFBTTs0QkFDTixJQUFJLEVBQUUsU0FBUzs0QkFDZixNQUFNLEVBQUUsR0FBRzs0QkFDWCxLQUFLLEVBQUUsNEJBQTRCOzRCQUNuQyxvQkFBb0IsRUFBRSxJQUFJOzRCQUMxQixLQUFLLEVBQUU7Z0NBQ0wsSUFBSSxFQUFFO29DQUNKLFNBQVMsRUFBRSxLQUFLO29DQUNoQixLQUFLLEVBQUUsR0FBRztpQ0FDWDs2QkFDRjt5QkFDRjtxQkFDRjtvQkFDRDt3QkFDRSxNQUFNLEVBQUUsQ0FBQzt3QkFDVCxLQUFLLEVBQUUsRUFBRTt3QkFDVCxDQUFDLEVBQUUsRUFBRTt3QkFDTCxDQUFDLEVBQUUsQ0FBQzt3QkFDSixJQUFJLEVBQUUsUUFBUTt3QkFDZCxVQUFVLEVBQUU7NEJBQ1YsT0FBTyxFQUFFLENBQUMsQ0FBQyxnQkFBZ0IsRUFBRSxTQUFTLEVBQUUsU0FBUyxFQUFFLE9BQU8sQ0FBQyxDQUFDOzRCQUM1RCxJQUFJLEVBQUUsWUFBWTs0QkFDbEIsT0FBTyxFQUFFLEtBQUs7NEJBQ2QsTUFBTTs0QkFDTixNQUFNLEVBQUUsR0FBRzs0QkFDWCxJQUFJLEVBQUUsS0FBSzs0QkFDWCxLQUFLLEVBQUUsb0JBQW9CO3lCQUM1QjtxQkFDRjtvQkFDRDt3QkFDRSxJQUFJLEVBQUUsUUFBUTt3QkFDZCxDQUFDLEVBQUUsQ0FBQzt3QkFDSixDQUFDLEVBQUUsRUFBRTt3QkFDTCxLQUFLLEVBQUUsRUFBRTt3QkFDVCxNQUFNLEVBQUUsQ0FBQzt3QkFDVCxVQUFVLEVBQUU7NEJBQ1YsSUFBSSxFQUFFLFlBQVk7NEJBQ2xCLE9BQU8sRUFBRSxLQUFLOzRCQUNkLE9BQU8sRUFBRTtnQ0FDUCxDQUFDLFNBQVMsRUFBRSxlQUFlLEVBQUUsU0FBUyxFQUFFLFlBQVksQ0FBQztnQ0FDckQsQ0FBQyxTQUFTLEVBQUUsaUJBQWlCLEVBQUUsU0FBUyxFQUFFLFlBQVksQ0FBQztnQ0FDdkQsQ0FBQyxTQUFTLEVBQUUsaUJBQWlCLEVBQUUsU0FBUyxFQUFFLFlBQVksQ0FBQztnQ0FDdkQsQ0FBQyxTQUFTLEVBQUUsb0JBQW9CLEVBQUUsU0FBUyxFQUFFLFlBQVksQ0FBQzs2QkFDM0Q7NEJBQ0QsTUFBTTs0QkFDTixLQUFLLEVBQUUsNkJBQTZCOzRCQUNwQyxNQUFNLEVBQUUsR0FBRzs0QkFDWCxJQUFJLEVBQUUsS0FBSzt5QkFDWjtxQkFDRjtvQkFDRDt3QkFDRSxJQUFJLEVBQUUsUUFBUTt3QkFDZCxDQUFDLEVBQUUsQ0FBQzt3QkFDSixDQUFDLEVBQUUsRUFBRTt3QkFDTCxLQUFLLEVBQUUsRUFBRTt3QkFDVCxNQUFNLEVBQUUsQ0FBQzt3QkFDVCxVQUFVLEVBQUU7NEJBQ1YsSUFBSSxFQUFFLFlBQVk7NEJBQ2xCLE9BQU8sRUFBRSxLQUFLOzRCQUNkLFdBQVcsRUFBRTtnQ0FDWCxtQkFBbUIsRUFBRSxFQUFFO2dDQUN2QixPQUFPLEVBQUUsS0FBSztnQ0FDZCxRQUFRLEVBQUUsMEJBQTBCOzZCQUNyQzs0QkFDRCxNQUFNLEVBQUU7Z0NBQ04sUUFBUSxFQUFFLFFBQVE7NkJBQ25COzRCQUNELE1BQU07NEJBQ04sS0FBSyxFQUFFLGtCQUFrQjs0QkFDekIsTUFBTSxFQUFFLEdBQUc7NEJBQ1gsSUFBSSxFQUFFLEtBQUs7eUJBQ1o7cUJBQ0Y7b0JBQ0Q7d0JBQ0UsSUFBSSxFQUFFLFFBQVE7d0JBQ2QsQ0FBQyxFQUFFLENBQUM7d0JBQ0osQ0FBQyxFQUFFLEVBQUU7d0JBQ0wsS0FBSyxFQUFFLEVBQUU7d0JBQ1QsTUFBTSxFQUFFLENBQUM7d0JBQ1QsVUFBVSxFQUFFOzRCQUNWLElBQUksRUFBRSxZQUFZOzRCQUNsQixPQUFPLEVBQUUsS0FBSzs0QkFDZCxXQUFXLEVBQUU7Z0NBQ1gsbUJBQW1CLEVBQUUsRUFBRTtnQ0FDdkIsT0FBTyxFQUFFLEtBQUs7Z0NBQ2QsUUFBUSxFQUFFLG1DQUFtQzs2QkFDOUM7NEJBQ0QsTUFBTSxFQUFFO2dDQUNOLFFBQVEsRUFBRSxRQUFROzZCQUNuQjs0QkFDRCxNQUFNOzRCQUNOLEtBQUssRUFBRSwyQkFBMkI7NEJBQ2xDLE1BQU0sRUFBRSxHQUFHOzRCQUNYLElBQUksRUFBRSxLQUFLO3lCQUNaO3FCQUNGO29CQUNEO3dCQUNFLElBQUksRUFBRSxRQUFRO3dCQUNkLENBQUMsRUFBRSxDQUFDO3dCQUNKLENBQUMsRUFBRSxFQUFFO3dCQUNMLEtBQUssRUFBRSxFQUFFO3dCQUNULE1BQU0sRUFBRSxDQUFDO3dCQUNULFVBQVUsRUFBRTs0QkFDVixJQUFJLEVBQUUsWUFBWTs0QkFDbEIsT0FBTyxFQUFFLEtBQUs7NEJBQ2QsT0FBTyxFQUFFO2dDQUNQLENBQUMsU0FBUyxFQUFFLDJCQUEyQixFQUFFLFNBQVMsRUFBRSxZQUFZLENBQUM7Z0NBQ2pFLENBQUMsU0FBUyxFQUFFLHNCQUFzQixFQUFFLFNBQVMsRUFBRSxZQUFZLENBQUM7Z0NBQzVELENBQUMsU0FBUyxFQUFFLHNCQUFzQixFQUFFLFNBQVMsRUFBRSxZQUFZLENBQUM7Z0NBQzVELENBQUMsU0FBUyxFQUFFLGlCQUFpQixFQUFFLFNBQVMsRUFBRSxZQUFZLENBQUM7Z0NBQ3ZELENBQUMsU0FBUyxFQUFFLFlBQVksRUFBRSxTQUFTLEVBQUUsWUFBWSxDQUFDO2dDQUNsRCxDQUFDLFNBQVMsRUFBRSxtQkFBbUIsRUFBRSxTQUFTLEVBQUUsWUFBWSxDQUFDO2dDQUN6RCxDQUFDLFNBQVMsRUFBRSxjQUFjLEVBQUUsU0FBUyxFQUFFLFlBQVksQ0FBQztnQ0FDcEQsQ0FBQyxTQUFTLEVBQUUsU0FBUyxFQUFFLFNBQVMsRUFBRSxZQUFZLENBQUM7Z0NBQy9DLENBQUMsU0FBUyxFQUFFLGNBQWMsRUFBRSxTQUFTLEVBQUUsWUFBWSxDQUFDO2dDQUNwRCxDQUFDLFNBQVMsRUFBRSxTQUFTLEVBQUUsU0FBUyxFQUFFLFlBQVksQ0FBQzs2QkFDaEQ7NEJBQ0QsTUFBTTs0QkFDTixLQUFLLEVBQUUsNENBQTRDOzRCQUNuRCxNQUFNLEVBQUUsR0FBRzs0QkFDWCxJQUFJLEVBQUUsS0FBSzt5QkFDWjtxQkFDRjtvQkFDRDt3QkFDRSxJQUFJLEVBQUUsUUFBUTt3QkFDZCxDQUFDLEVBQUUsQ0FBQzt3QkFDSixDQUFDLEVBQUUsRUFBRTt3QkFDTCxLQUFLLEVBQUUsRUFBRTt3QkFDVCxNQUFNLEVBQUUsQ0FBQzt3QkFDVCxVQUFVLEVBQUU7NEJBQ1YsSUFBSSxFQUFFLFlBQVk7NEJBQ2xCLE9BQU8sRUFBRSxLQUFLOzRCQUNkLE9BQU8sRUFBRSxDQUFDLENBQUMsT0FBTyxDQUFDLGdCQUFnQixFQUFFLENBQUMsT0FBZ0IsRUFBRSxFQUFFLENBQUM7Z0NBQ3pELENBQUMsU0FBUyxFQUFFLG9DQUFvQyxPQUFPLEVBQUUsRUFBRSxTQUFTLEVBQUUsWUFBWSxDQUFDO2dDQUNuRixDQUFDLFNBQVMsRUFBRSwrQkFBK0IsT0FBTyxFQUFFLEVBQUUsU0FBUyxFQUFFLFlBQVksQ0FBQztnQ0FDOUUsQ0FBQyxTQUFTLEVBQUUsK0JBQStCLE9BQU8sRUFBRSxFQUFFLFNBQVMsRUFBRSxZQUFZLENBQUM7Z0NBQzlFLENBQUMsU0FBUyxFQUFFLDBCQUEwQixPQUFPLEVBQUUsRUFBRSxTQUFTLEVBQUUsWUFBWSxDQUFDO2dDQUN6RSxDQUFDLFNBQVMsRUFBRSxxQkFBcUIsT0FBTyxFQUFFLEVBQUUsU0FBUyxFQUFFLFlBQVksQ0FBQztnQ0FDcEUsQ0FBQyxTQUFTLEVBQUUsNEJBQTRCLE9BQU8sRUFBRSxFQUFFLFNBQVMsRUFBRSxZQUFZLENBQUM7Z0NBQzNFLENBQUMsU0FBUyxFQUFFLHVCQUF1QixPQUFPLEVBQUUsRUFBRSxTQUFTLEVBQUUsWUFBWSxDQUFDO2dDQUN0RSxDQUFDLFNBQVMsRUFBRSxrQkFBa0IsT0FBTyxFQUFFLEVBQUUsU0FBUyxFQUFFLFlBQVksQ0FBQztnQ0FDakUsQ0FBQyxTQUFTLEVBQUUsdUJBQXVCLE9BQU8sRUFBRSxFQUFFLFNBQVMsRUFBRSxZQUFZLENBQUM7Z0NBQ3RFLENBQUMsU0FBUyxFQUFFLGtCQUFrQixPQUFPLEVBQUUsRUFBRSxTQUFTLEVBQUUsWUFBWSxDQUFDOzZCQUNsRSxDQUFDOzRCQUNGLE1BQU07NEJBQ04sS0FBSyxFQUFFLHNDQUFzQzs0QkFDN0MsTUFBTSxFQUFFLEdBQUc7NEJBQ1gsSUFBSSxFQUFFLEtBQUs7eUJBQ1o7cUJBQ0Y7b0JBQ0Q7d0JBQ0UsSUFBSSxFQUFFLFFBQVE7d0JBQ2QsQ0FBQyxFQUFFLENBQUM7d0JBQ0osQ0FBQyxFQUFFLEVBQUU7d0JBQ0wsS0FBSyxFQUFFLEVBQUU7d0JBQ1QsTUFBTSxFQUFFLENBQUM7d0JBQ1QsVUFBVSxFQUFFOzRCQUNWLE9BQU8sRUFBRSxDQUFDLENBQUMsT0FBTyxDQUFDLGdCQUFnQixFQUFFLENBQUMsT0FBZ0IsRUFBRSxFQUFFLENBQUM7Z0NBQ3pELENBQUMsU0FBUyxFQUFFLHFCQUFxQixPQUFPLEVBQUUsRUFBRSxTQUFTLEVBQUUsWUFBWSxDQUFDO2dDQUNwRSxDQUFDLFNBQVMsRUFBRSx5QkFBeUIsT0FBTyxFQUFFLEVBQUUsU0FBUyxFQUFFLFlBQVksQ0FBQzs2QkFDekUsQ0FBQzs0QkFDRixJQUFJLEVBQUUsWUFBWTs0QkFDbEIsT0FBTyxFQUFFLEtBQUs7NEJBQ2QsSUFBSSxFQUFFLEtBQUs7NEJBQ1gsTUFBTSxFQUFFLEdBQUc7NEJBQ1gsTUFBTTs0QkFDTixLQUFLLEVBQUUsZ0NBQWdDO3lCQUN4QztxQkFDRjtvQkFDRDt3QkFDRSxNQUFNLEVBQUUsRUFBRTt3QkFDVixLQUFLLEVBQUUsRUFBRTt3QkFDVCxDQUFDLEVBQUUsRUFBRTt3QkFDTCxDQUFDLEVBQUUsQ0FBQzt3QkFDSixJQUFJLEVBQUUsUUFBUTt3QkFDZCxVQUFVLEVBQUU7NEJBQ1YsT0FBTyxFQUFFO2dDQUNQLENBQUMsU0FBUyxFQUFFLGVBQWUsRUFBRSxTQUFTLEVBQUUsWUFBWSxFQUFFLEVBQUUsS0FBSyxFQUFFLFNBQVMsRUFBRSxDQUFDO2dDQUMzRSxDQUFDLEdBQUcsRUFBRSxjQUFjLEVBQUUsR0FBRyxFQUFFLEdBQUcsRUFBRSxFQUFFLEtBQUssRUFBRSxTQUFTLEVBQUUsQ0FBQztnQ0FDckQsQ0FBQyxHQUFHLEVBQUUsYUFBYSxFQUFFLEdBQUcsRUFBRSxHQUFHLEVBQUUsRUFBRSxLQUFLLEVBQUUsU0FBUyxFQUFFLENBQUM7Z0NBQ3BELENBQUMsR0FBRyxFQUFFLGFBQWEsRUFBRSxHQUFHLEVBQUUsR0FBRyxFQUFFLEVBQUUsS0FBSyxFQUFFLFNBQVMsRUFBRSxDQUFDO2dDQUNwRCxDQUFDLEdBQUcsRUFBRSxxQkFBcUIsRUFBRSxHQUFHLEVBQUUsR0FBRyxFQUFFLEVBQUUsS0FBSyxFQUFFLFNBQVMsRUFBRSxDQUFDO2dDQUM1RCxDQUFDLEdBQUcsRUFBRSxxQkFBcUIsRUFBRSxHQUFHLEVBQUUsR0FBRyxFQUFFLEVBQUUsS0FBSyxFQUFFLFNBQVMsRUFBRSxDQUFDO2dDQUM1RCxDQUFDLEdBQUcsRUFBRSxjQUFjLEVBQUUsR0FBRyxFQUFFLEdBQUcsRUFBRSxFQUFFLEtBQUssRUFBRSxTQUFTLEVBQUUsQ0FBQztnQ0FDckQsQ0FBQyxHQUFHLEVBQUUsaUJBQWlCLEVBQUUsR0FBRyxFQUFFLEdBQUcsRUFBRSxFQUFFLEtBQUssRUFBRSxTQUFTLEVBQUUsQ0FBQztnQ0FDeEQsQ0FBQyxHQUFHLEVBQUUsY0FBYyxFQUFFLEdBQUcsRUFBRSxHQUFHLEVBQUUsRUFBRSxLQUFLLEVBQUUsU0FBUyxFQUFFLENBQUM7Z0NBQ3JELENBQUMsR0FBRyxFQUFFLG1CQUFtQixFQUFFLEdBQUcsRUFBRSxHQUFHLEVBQUUsRUFBRSxLQUFLLEVBQUUsU0FBUyxFQUFFLENBQUM7NkJBQzNEOzRCQUNELElBQUksRUFBRSxZQUFZOzRCQUNsQixPQUFPLEVBQUUsSUFBSTs0QkFDYixNQUFNOzRCQUNOLElBQUksRUFBRSxLQUFLOzRCQUNYLE1BQU0sRUFBRSxHQUFHOzRCQUNYLEtBQUssRUFBRSwwQkFBMEI7eUJBQ2xDO3FCQUNGO29CQUNEO3dCQUNFLElBQUksRUFBRSxRQUFRO3dCQUNkLENBQUMsRUFBRSxDQUFDO3dCQUNKLENBQUMsRUFBRSxFQUFFO3dCQUNMLEtBQUssRUFBRSxFQUFFO3dCQUNULE1BQU0sRUFBRSxDQUFDO3dCQUNULFVBQVUsRUFBRTs0QkFDVixJQUFJLEVBQUUsWUFBWTs0QkFDbEIsT0FBTyxFQUFFLEtBQUs7NEJBQ2QsT0FBTyxFQUFFO2dDQUNQLENBQUMsU0FBUyxFQUFFLHNCQUFzQixFQUFFLFNBQVMsRUFBRSxZQUFZLENBQUM7Z0NBQzVELENBQUMsR0FBRyxFQUFFLHlCQUF5QixFQUFFLEdBQUcsRUFBRSxHQUFHLENBQUM7Z0NBQzFDLENBQUMsR0FBRyxFQUFFLFlBQVksRUFBRSxHQUFHLEVBQUUsR0FBRyxDQUFDO2dDQUM3QixDQUFDLEdBQUcsRUFBRSx3QkFBd0IsRUFBRSxHQUFHLEVBQUUsR0FBRyxDQUFDO2dDQUN6QyxDQUFDLEdBQUcsRUFBRSxrQ0FBa0MsRUFBRSxHQUFHLEVBQUUsR0FBRyxDQUFDO2dDQUNuRCxDQUFDLEdBQUcsRUFBRSx5QkFBeUIsRUFBRSxHQUFHLEVBQUUsR0FBRyxDQUFDO2dDQUMxQyxDQUFDLEdBQUcsRUFBRSxtQ0FBbUMsRUFBRSxHQUFHLEVBQUUsR0FBRyxDQUFDO2dDQUNwRCxDQUFDLEdBQUcsRUFBRSx3QkFBd0IsRUFBRSxHQUFHLEVBQUUsR0FBRyxDQUFDO2dDQUN6QyxDQUFDLEdBQUcsRUFBRSx5QkFBeUIsRUFBRSxHQUFHLEVBQUUsR0FBRyxDQUFDOzZCQUMzQzs0QkFDRCxNQUFNLEVBQUUsTUFBTTs0QkFDZCxLQUFLLEVBQUUsMkRBQTJEOzRCQUNsRSxJQUFJLEVBQUUsS0FBSzt5QkFDWjtxQkFDRjtvQkFDRDt3QkFDRSxJQUFJLEVBQUUsUUFBUTt3QkFDZCxDQUFDLEVBQUUsQ0FBQzt3QkFDSixDQUFDLEVBQUUsRUFBRTt3QkFDTCxLQUFLLEVBQUUsRUFBRTt3QkFDVCxNQUFNLEVBQUUsQ0FBQzt3QkFDVCxVQUFVLEVBQUU7NEJBQ1YsSUFBSSxFQUFFLFlBQVk7NEJBQ2xCLE9BQU8sRUFBRSxLQUFLOzRCQUNkLE9BQU8sRUFBRTtnQ0FDUCxDQUFDLFNBQVMsRUFBRSxzQkFBc0IsRUFBRSxTQUFTLEVBQUUsWUFBWSxDQUFDO2dDQUM1RCxDQUFDLEdBQUcsRUFBRSx5QkFBeUIsRUFBRSxHQUFHLEVBQUUsR0FBRyxDQUFDO2dDQUMxQyxDQUFDLEdBQUcsRUFBRSxZQUFZLEVBQUUsR0FBRyxFQUFFLEdBQUcsQ0FBQztnQ0FDN0IsQ0FBQyxHQUFHLEVBQUUsd0JBQXdCLEVBQUUsR0FBRyxFQUFFLEdBQUcsQ0FBQztnQ0FDekMsQ0FBQyxHQUFHLEVBQUUsa0NBQWtDLEVBQUUsR0FBRyxFQUFFLEdBQUcsQ0FBQztnQ0FDbkQsQ0FBQyxHQUFHLEVBQUUseUJBQXlCLEVBQUUsR0FBRyxFQUFFLEdBQUcsQ0FBQztnQ0FDMUMsQ0FBQyxHQUFHLEVBQUUsbUNBQW1DLEVBQUUsR0FBRyxFQUFFLEdBQUcsQ0FBQztnQ0FDcEQsQ0FBQyxHQUFHLEVBQUUsd0JBQXdCLEVBQUUsR0FBRyxFQUFFLEdBQUcsQ0FBQztnQ0FDekMsQ0FBQyxHQUFHLEVBQUUseUJBQXlCLEVBQUUsR0FBRyxFQUFFLEdBQUcsQ0FBQzs2QkFDM0M7NEJBQ0QsTUFBTSxFQUFFLE1BQU07NEJBQ2QsS0FBSyxFQUFFLDJEQUEyRDs0QkFDbEUsSUFBSSxFQUFFLEtBQUs7eUJBQ1o7cUJBQ0Y7b0JBQ0Q7d0JBQ0UsSUFBSSxFQUFFLFFBQVE7d0JBQ2QsQ0FBQyxFQUFFLENBQUM7d0JBQ0osQ0FBQyxFQUFFLEVBQUU7d0JBQ0wsS0FBSyxFQUFFLEVBQUU7d0JBQ1QsTUFBTSxFQUFFLENBQUM7d0JBQ1QsVUFBVSxFQUFFOzRCQUNWLElBQUksRUFBRSxZQUFZOzRCQUNsQixPQUFPLEVBQUUsS0FBSzs0QkFDZCxPQUFPLEVBQUU7Z0NBQ1AsQ0FBQyxZQUFZLEVBQUUsaUNBQWlDLEVBQUUsY0FBYyxFQUFFLGlCQUFpQixDQUFDO2dDQUNwRixDQUFDLEdBQUcsRUFBRSxzQkFBc0IsRUFBRSxHQUFHLEVBQUUsR0FBRyxDQUFDO2dDQUN2QyxDQUFDLEdBQUcsRUFBRSw0Q0FBNEMsRUFBRSxHQUFHLEVBQUUsR0FBRyxDQUFDOzZCQUM5RDs0QkFDRCxNQUFNLEVBQUUsTUFBTTs0QkFDZCxLQUFLLEVBQUUsK0NBQStDOzRCQUN0RCxJQUFJLEVBQUUsU0FBUzt5QkFDaEI7cUJBQ0Y7aUJBQ0Y7YUFDRixDQUFDO1NBQ0gsQ0FBQyxDQUFBO1FBRUYsTUFBTSxtQkFBbUIsR0FBRyxJQUFJLDBCQUEwQixDQUFDLFNBQVMsRUFBRSxNQUFNLENBQUMsQ0FBQTtRQUM3RSxJQUFJLGNBQWMsQ0FBQyxZQUFZLENBQUMsSUFBSSxFQUFFLGlDQUFpQyxFQUFFO1lBQ3ZFLGFBQWEsRUFBRSxpQ0FBaUM7WUFDaEQsYUFBYSxFQUFFLElBQUksQ0FBQyxTQUFTLENBQUM7Z0JBQzVCLGNBQWMsRUFBRSxTQUFTO2dCQUN6QixPQUFPLEVBQUUsbUJBQW1CLENBQUMsZUFBZSxFQUFFO2FBQy9DLENBQUM7U0FDSCxDQUFDLENBQUE7UUFFRixNQUFNLG1CQUFtQixHQUFHLElBQUksMEJBQTBCLENBQUMsU0FBUyxFQUFFLE1BQU0sRUFBRSxpQkFBaUIsQ0FBQyxDQUFBO1FBQ2hHLElBQUksY0FBYyxDQUFDLFlBQVksQ0FBQyxJQUFJLEVBQUUsa0NBQWtDLEVBQUU7WUFDeEUsYUFBYSxFQUFFLGtDQUFrQztZQUNqRCxhQUFhLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQztnQkFDNUIsY0FBYyxFQUFFLFNBQVM7Z0JBQ3pCLE9BQU8sRUFBRSxtQkFBbUIsQ0FBQyxlQUFlLEVBQUU7YUFDL0MsQ0FBQztTQUNILENBQUMsQ0FBQTtRQUVGLElBQUksY0FBYyxDQUFDLFlBQVksQ0FBQyxJQUFJLEVBQUUsa0NBQWtDLEVBQUU7WUFDeEUsYUFBYSxFQUFFLCtCQUErQjtZQUM5QyxhQUFhLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQztnQkFDNUIsY0FBYyxFQUFFLFNBQVM7Z0JBQ3pCLE9BQU8sRUFBRTtvQkFDUDt3QkFDRSxNQUFNLEVBQUUsQ0FBQzt3QkFDVCxLQUFLLEVBQUUsRUFBRTt3QkFDVCxDQUFDLEVBQUUsQ0FBQzt3QkFDSixDQUFDLEVBQUUsQ0FBQzt3QkFDSixJQUFJLEVBQUUsUUFBUTt3QkFDZCxVQUFVLEVBQUU7NEJBQ1YsT0FBTyxFQUFFLENBQUMsQ0FBQyxTQUFTLEVBQUUscUNBQXFDLEVBQUUsU0FBUyxFQUFFLFlBQVksQ0FBQyxDQUFDOzRCQUN0RixJQUFJLEVBQUUsWUFBWTs0QkFDbEIsT0FBTyxFQUFFLEtBQUs7NEJBQ2QsTUFBTTs0QkFDTixJQUFJLEVBQUUsU0FBUzs0QkFDZixNQUFNLEVBQUUsR0FBRzs0QkFDWCxLQUFLLEVBQUUsOEJBQThCO3lCQUN0QztxQkFDRjtvQkFDRDt3QkFDRSxNQUFNLEVBQUUsQ0FBQzt3QkFDVCxLQUFLLEVBQUUsRUFBRTt3QkFDVCxDQUFDLEVBQUUsQ0FBQzt3QkFDSixDQUFDLEVBQUUsQ0FBQzt3QkFDSixJQUFJLEVBQUUsUUFBUTt3QkFDZCxVQUFVLEVBQUU7NEJBQ1YsT0FBTyxFQUFFO2dDQUNQLENBQUMsU0FBUyxFQUFFLDJCQUEyQixFQUFFLFNBQVMsRUFBRSxZQUFZLENBQUM7Z0NBQ2pFLENBQUMsR0FBRyxFQUFFLDhCQUE4QixFQUFFLEdBQUcsRUFBRSxHQUFHLENBQUM7Z0NBQy9DLENBQUMsR0FBRyxFQUFFLHNCQUFzQixFQUFFLEdBQUcsRUFBRSxHQUFHLENBQUM7Z0NBQ3ZDLENBQUMsR0FBRyxFQUFFLG9CQUFvQixFQUFFLEdBQUcsRUFBRSxHQUFHLENBQUM7NkJBQ3RDOzRCQUNELElBQUksRUFBRSxZQUFZOzRCQUNsQixPQUFPLEVBQUUsS0FBSzs0QkFDZCxNQUFNOzRCQUNOLElBQUksRUFBRSxTQUFTOzRCQUNmLE1BQU0sRUFBRSxHQUFHOzRCQUNYLEtBQUssRUFBRSxtREFBbUQ7eUJBQzNEO3FCQUNGO29CQUNEO3dCQUNFLE1BQU0sRUFBRSxDQUFDO3dCQUNULEtBQUssRUFBRSxFQUFFO3dCQUNULENBQUMsRUFBRSxFQUFFO3dCQUNMLENBQUMsRUFBRSxDQUFDO3dCQUNKLElBQUksRUFBRSxRQUFRO3dCQUNkLFVBQVUsRUFBRTs0QkFDVixPQUFPLEVBQUU7Z0NBQ1AsQ0FBQyxTQUFTLEVBQUUsNkJBQTZCLEVBQUUsU0FBUyxFQUFFLFlBQVksQ0FBQztnQ0FDbkUsQ0FBQyxHQUFHLEVBQUUsdUJBQXVCLEVBQUUsR0FBRyxFQUFFLEdBQUcsQ0FBQztnQ0FDeEMsQ0FBQyxHQUFHLEVBQUUsK0JBQStCLEVBQUUsR0FBRyxFQUFFLEdBQUcsQ0FBQztnQ0FDaEQsQ0FBQyxHQUFHLEVBQUUsbUJBQW1CLEVBQUUsR0FBRyxFQUFFLEdBQUcsQ0FBQztnQ0FDcEMsQ0FBQyxHQUFHLEVBQUUseUJBQXlCLEVBQUUsR0FBRyxFQUFFLEdBQUcsQ0FBQztnQ0FDMUMsQ0FBQyxHQUFHLEVBQUUsOEJBQThCLEVBQUUsR0FBRyxFQUFFLEdBQUcsQ0FBQzs2QkFDaEQ7NEJBQ0QsSUFBSSxFQUFFLFlBQVk7NEJBQ2xCLE9BQU8sRUFBRSxLQUFLOzRCQUNkLE1BQU07NEJBQ04sTUFBTSxFQUFFLEdBQUc7NEJBQ1gsSUFBSSxFQUFFLEtBQUs7NEJBQ1gsS0FBSyxFQUFFLHVEQUF1RDt5QkFDL0Q7cUJBQ0Y7aUJBQ0Y7YUFDRixDQUFDO1NBQ0gsQ0FBQyxDQUFBO0lBQ0osQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgQ2hhaW5JZCB9IGZyb20gJ0B0YXJ0ei1vbmUvc21hcnQtb3JkZXItcm91dGVyJ1xuaW1wb3J0ICogYXMgY2RrIGZyb20gJ2F3cy1jZGstbGliJ1xuaW1wb3J0ICogYXMgYXdzX2Nsb3Vkd2F0Y2ggZnJvbSAnYXdzLWNkay1saWIvYXdzLWNsb3Vkd2F0Y2gnXG5pbXBvcnQgeyBDb25zdHJ1Y3QgfSBmcm9tICdjb25zdHJ1Y3RzJ1xuaW1wb3J0IF8gZnJvbSAnbG9kYXNoJ1xuaW1wb3J0IHsgUXVvdGVBbW91bnRzV2lkZ2V0c0ZhY3RvcnkgfSBmcm9tICcuLi8uLi9saWIvZGFzaGJvYXJkcy9xdW90ZS1hbW91bnRzLXdpZGdldHMtZmFjdG9yeSdcbmltcG9ydCB7IFNVUFBPUlRFRF9DSEFJTlMgfSBmcm9tICcuLi8uLi9saWIvaGFuZGxlcnMvaW5qZWN0b3Itc29yJ1xuaW1wb3J0IHsgQ2FjaGVkUm91dGVzV2lkZ2V0c0ZhY3RvcnkgfSBmcm9tICcuLi8uLi9saWIvZGFzaGJvYXJkcy9jYWNoZWQtcm91dGVzLXdpZGdldHMtZmFjdG9yeSdcblxuZXhwb3J0IGNvbnN0IE5BTUVTUEFDRSA9ICdVbmlzd2FwJ1xuXG5leHBvcnQgdHlwZSBMYW1iZGFXaWRnZXQgPSB7XG4gIHR5cGU6IHN0cmluZ1xuICB4OiBudW1iZXJcbiAgeTogbnVtYmVyXG4gIHdpZHRoOiBudW1iZXJcbiAgaGVpZ2h0OiBudW1iZXJcbiAgcHJvcGVydGllczogeyB2aWV3OiBzdHJpbmc7IHN0YWNrZWQ6IGJvb2xlYW47IG1ldHJpY3M6IHN0cmluZ1tdW107IHJlZ2lvbjogc3RyaW5nOyB0aXRsZTogc3RyaW5nOyBzdGF0OiBzdHJpbmcgfVxufVxuXG5leHBvcnQgaW50ZXJmYWNlIFJvdXRpbmdEYXNoYm9hcmRQcm9wcyBleHRlbmRzIGNkay5OZXN0ZWRTdGFja1Byb3BzIHtcbiAgYXBpTmFtZTogc3RyaW5nXG4gIHJvdXRpbmdMYW1iZGFOYW1lOiBzdHJpbmdcbiAgcG9vbENhY2hlTGFtYmRhTmFtZUFycmF5OiBzdHJpbmdbXVxuICBpcGZzUG9vbENhY2hlTGFtYmRhTmFtZT86IHN0cmluZ1xufVxuXG5leHBvcnQgY2xhc3MgUm91dGluZ0Rhc2hib2FyZFN0YWNrIGV4dGVuZHMgY2RrLk5lc3RlZFN0YWNrIHtcbiAgY29uc3RydWN0b3Ioc2NvcGU6IENvbnN0cnVjdCwgbmFtZTogc3RyaW5nLCBwcm9wczogUm91dGluZ0Rhc2hib2FyZFByb3BzKSB7XG4gICAgc3VwZXIoc2NvcGUsIG5hbWUsIHByb3BzKVxuXG4gICAgY29uc3QgeyBhcGlOYW1lLCByb3V0aW5nTGFtYmRhTmFtZSwgcG9vbENhY2hlTGFtYmRhTmFtZUFycmF5LCBpcGZzUG9vbENhY2hlTGFtYmRhTmFtZSB9ID0gcHJvcHNcbiAgICBjb25zdCByZWdpb24gPSBjZGsuU3RhY2sub2YodGhpcykucmVnaW9uXG5cbiAgICAvLyBObyBDREsgcmVzb3VyY2UgZXhpc3RzIGZvciBjb250cmlidXRvciBpbnNpZ2h0cyBhdCB0aGUgbW9tZW50IHNvIHVzZSByYXcgQ2xvdWRGb3JtYXRpb24uXG4gICAgY29uc3QgUkVRVUVTVEVEX1FVT1RFU19SVUxFX05BTUUgPSAnUmVxdWVzdGVkUXVvdGVzJ1xuICAgIGNvbnN0IFJFUVVFU1RFRF9RVU9URVNfQllfQ0hBSU5fUlVMRV9OQU1FID0gJ1JlcXVlc3RlZFF1b3Rlc0J5Q2hhaW4nXG4gICAgbmV3IGNkay5DZm5SZXNvdXJjZSh0aGlzLCAnUXVvdGVDb250cmlidXRvckluc2lnaHRzJywge1xuICAgICAgdHlwZTogJ0FXUzo6Q2xvdWRXYXRjaDo6SW5zaWdodFJ1bGUnLFxuICAgICAgcHJvcGVydGllczoge1xuICAgICAgICBSdWxlQm9keTogSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICAgIFNjaGVtYToge1xuICAgICAgICAgICAgTmFtZTogJ0Nsb3VkV2F0Y2hMb2dSdWxlJyxcbiAgICAgICAgICAgIFZlcnNpb246IDEsXG4gICAgICAgICAgfSxcbiAgICAgICAgICBBZ2dyZWdhdGVPbjogJ0NvdW50JyxcbiAgICAgICAgICBDb250cmlidXRpb246IHtcbiAgICAgICAgICAgIEZpbHRlcnM6IFtcbiAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgIE1hdGNoOiAnJC50b2tlblBhaXJTeW1ib2wnLFxuICAgICAgICAgICAgICAgIElzUHJlc2VudDogdHJ1ZSxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIF0sXG4gICAgICAgICAgICBLZXlzOiBbJyQudG9rZW5QYWlyU3ltYm9sJ10sXG4gICAgICAgICAgfSxcbiAgICAgICAgICBMb2dGb3JtYXQ6ICdKU09OJyxcbiAgICAgICAgICBMb2dHcm91cE5hbWVzOiBbYC9hd3MvbGFtYmRhLyR7cm91dGluZ0xhbWJkYU5hbWV9YF0sXG4gICAgICAgIH0pLFxuICAgICAgICBSdWxlTmFtZTogUkVRVUVTVEVEX1FVT1RFU19SVUxFX05BTUUsXG4gICAgICAgIFJ1bGVTdGF0ZTogJ0VOQUJMRUQnLFxuICAgICAgfSxcbiAgICB9KVxuXG4gICAgbmV3IGNkay5DZm5SZXNvdXJjZSh0aGlzLCAnUXVvdGVCeUNoYWluQ29udHJpYnV0b3JJbnNpZ2h0cycsIHtcbiAgICAgIHR5cGU6ICdBV1M6OkNsb3VkV2F0Y2g6Okluc2lnaHRSdWxlJyxcbiAgICAgIHByb3BlcnRpZXM6IHtcbiAgICAgICAgUnVsZUJvZHk6IEpTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgICBTY2hlbWE6IHtcbiAgICAgICAgICAgIE5hbWU6ICdDbG91ZFdhdGNoTG9nUnVsZScsXG4gICAgICAgICAgICBWZXJzaW9uOiAxLFxuICAgICAgICAgIH0sXG4gICAgICAgICAgQWdncmVnYXRlT246ICdDb3VudCcsXG4gICAgICAgICAgQ29udHJpYnV0aW9uOiB7XG4gICAgICAgICAgICBGaWx0ZXJzOiBbXG4gICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICBNYXRjaDogJyQudG9rZW5QYWlyU3ltYm9sQ2hhaW4nLFxuICAgICAgICAgICAgICAgIElzUHJlc2VudDogdHJ1ZSxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIF0sXG4gICAgICAgICAgICBLZXlzOiBbJyQudG9rZW5QYWlyU3ltYm9sQ2hhaW4nXSxcbiAgICAgICAgICB9LFxuICAgICAgICAgIExvZ0Zvcm1hdDogJ0pTT04nLFxuICAgICAgICAgIExvZ0dyb3VwTmFtZXM6IFtgL2F3cy9sYW1iZGEvJHtyb3V0aW5nTGFtYmRhTmFtZX1gXSxcbiAgICAgICAgfSksXG4gICAgICAgIFJ1bGVOYW1lOiBSRVFVRVNURURfUVVPVEVTX0JZX0NIQUlOX1JVTEVfTkFNRSxcbiAgICAgICAgUnVsZVN0YXRlOiAnRU5BQkxFRCcsXG4gICAgICB9LFxuICAgIH0pXG5cbiAgICBjb25zdCBwb29sQ2FjaGVMYW1iZGFNZXRyaWNzOiBzdHJpbmdbXVtdID0gW11cbiAgICBwb29sQ2FjaGVMYW1iZGFOYW1lQXJyYXkuZm9yRWFjaCgocG9vbENhY2hlTGFtYmRhTmFtZSkgPT4ge1xuICAgICAgcG9vbENhY2hlTGFtYmRhTWV0cmljcy5wdXNoKFsnQVdTL0xhbWJkYScsIGAke3Bvb2xDYWNoZUxhbWJkYU5hbWV9RXJyb3JzYCwgJ0Z1bmN0aW9uTmFtZScsIHBvb2xDYWNoZUxhbWJkYU5hbWVdKVxuICAgICAgcG9vbENhY2hlTGFtYmRhTWV0cmljcy5wdXNoKFsnLicsIGAke3Bvb2xDYWNoZUxhbWJkYU5hbWV9SW52b2NhdGlvbnNgLCAnLicsICcuJ10pXG4gICAgfSlcbiAgICBuZXcgYXdzX2Nsb3Vkd2F0Y2guQ2ZuRGFzaGJvYXJkKHRoaXMsICdSb3V0aW5nQVBJRGFzaGJvYXJkJywge1xuICAgICAgZGFzaGJvYXJkTmFtZTogYFJvdXRpbmdEYXNoYm9hcmRgLFxuICAgICAgZGFzaGJvYXJkQm9keTogSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICBwZXJpb2RPdmVycmlkZTogJ2luaGVyaXQnLFxuICAgICAgICB3aWRnZXRzOiBbXG4gICAgICAgICAge1xuICAgICAgICAgICAgdHlwZTogJ21ldHJpYycsXG4gICAgICAgICAgICB4OiAwLFxuICAgICAgICAgICAgeTogNjYsXG4gICAgICAgICAgICB3aWR0aDogMjQsXG4gICAgICAgICAgICBoZWlnaHQ6IDksXG4gICAgICAgICAgICBwcm9wZXJ0aWVzOiB7XG4gICAgICAgICAgICAgIHZpZXc6ICd0aW1lU2VyaWVzJyxcbiAgICAgICAgICAgICAgc3RhY2tlZDogZmFsc2UsXG4gICAgICAgICAgICAgIG1ldHJpY3M6IFtcbiAgICAgICAgICAgICAgICAuLi5wb29sQ2FjaGVMYW1iZGFNZXRyaWNzLFxuICAgICAgICAgICAgICAgIC4uLihpcGZzUG9vbENhY2hlTGFtYmRhTmFtZVxuICAgICAgICAgICAgICAgICAgPyBbXG4gICAgICAgICAgICAgICAgICAgICAgWydBV1MvTGFtYmRhJywgJ0Vycm9ycycsICdGdW5jdGlvbk5hbWUnLCBpcGZzUG9vbENhY2hlTGFtYmRhTmFtZV0sXG4gICAgICAgICAgICAgICAgICAgICAgWycuJywgJ0ludm9jYXRpb25zJywgJy4nLCAnLiddLFxuICAgICAgICAgICAgICAgICAgICBdXG4gICAgICAgICAgICAgICAgICA6IFtdKSxcbiAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgcmVnaW9uOiByZWdpb24sXG4gICAgICAgICAgICAgIHRpdGxlOiAnUG9vbCBDYWNoZSBMYW1iZGEgRXJyb3IvSW52b2NhdGlvbnMgfCA1bWluJyxcbiAgICAgICAgICAgICAgc3RhdDogJ1N1bScsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIH0sXG4gICAgICAgICAge1xuICAgICAgICAgICAgaGVpZ2h0OiA2LFxuICAgICAgICAgICAgd2lkdGg6IDI0LFxuICAgICAgICAgICAgeTogMCxcbiAgICAgICAgICAgIHg6IDAsXG4gICAgICAgICAgICB0eXBlOiAnbWV0cmljJyxcbiAgICAgICAgICAgIHByb3BlcnRpZXM6IHtcbiAgICAgICAgICAgICAgbWV0cmljczogW1xuICAgICAgICAgICAgICAgIFsnQVdTL0FwaUdhdGV3YXknLCAnQ291bnQnLCAnQXBpTmFtZScsIGFwaU5hbWUsIHsgbGFiZWw6ICdSZXF1ZXN0cycgfV0sXG4gICAgICAgICAgICAgICAgWycuJywgJzVYWEVycm9yJywgJy4nLCAnLicsIHsgbGFiZWw6ICc1WFhFcnJvciBSZXNwb25zZXMnLCBjb2xvcjogJyNmZjdmMGUnIH1dLFxuICAgICAgICAgICAgICAgIFsnLicsICc0WFhFcnJvcicsICcuJywgJy4nLCB7IGxhYmVsOiAnNFhYRXJyb3IgUmVzcG9uc2VzJywgY29sb3I6ICcjMmNhMDJjJyB9XSxcbiAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgdmlldzogJ3RpbWVTZXJpZXMnLFxuICAgICAgICAgICAgICBzdGFja2VkOiBmYWxzZSxcbiAgICAgICAgICAgICAgcmVnaW9uLFxuICAgICAgICAgICAgICBzdGF0OiAnU3VtJyxcbiAgICAgICAgICAgICAgcGVyaW9kOiAzMDAsXG4gICAgICAgICAgICAgIHRpdGxlOiAnVG90YWwgUmVxdWVzdHMvUmVzcG9uc2VzIHwgNW1pbicsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIH0sXG4gICAgICAgICAge1xuICAgICAgICAgICAgaGVpZ2h0OiA2LFxuICAgICAgICAgICAgd2lkdGg6IDI0LFxuICAgICAgICAgICAgeTogNixcbiAgICAgICAgICAgIHg6IDAsXG4gICAgICAgICAgICB0eXBlOiAnbWV0cmljJyxcbiAgICAgICAgICAgIHByb3BlcnRpZXM6IHtcbiAgICAgICAgICAgICAgbWV0cmljczogW1xuICAgICAgICAgICAgICAgIFtcbiAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgZXhwcmVzc2lvbjogJ20xICogMTAwJyxcbiAgICAgICAgICAgICAgICAgICAgbGFiZWw6ICc1WFggRXJyb3IgUmF0ZScsXG4gICAgICAgICAgICAgICAgICAgIGlkOiAnZTEnLFxuICAgICAgICAgICAgICAgICAgICBjb2xvcjogJyNmZjdmMGUnLFxuICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICAgIFtcbiAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgZXhwcmVzc2lvbjogJ20yICogMTAwJyxcbiAgICAgICAgICAgICAgICAgICAgbGFiZWw6ICc0WFggRXJyb3IgUmF0ZScsXG4gICAgICAgICAgICAgICAgICAgIGlkOiAnZTInLFxuICAgICAgICAgICAgICAgICAgICBjb2xvcjogJyMyY2EwMmMnLFxuICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICAgIFtcbiAgICAgICAgICAgICAgICAgICdBV1MvQXBpR2F0ZXdheScsXG4gICAgICAgICAgICAgICAgICAnNVhYRXJyb3InLFxuICAgICAgICAgICAgICAgICAgJ0FwaU5hbWUnLFxuICAgICAgICAgICAgICAgICAgJ1JvdXRpbmcgQVBJJyxcbiAgICAgICAgICAgICAgICAgIHsgaWQ6ICdtMScsIGxhYmVsOiAnNVhYRXJyb3InLCB2aXNpYmxlOiBmYWxzZSB9LFxuICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgICAgWycuJywgJzRYWEVycm9yJywgJy4nLCAnLicsIHsgaWQ6ICdtMicsIHZpc2libGU6IGZhbHNlIH1dLFxuICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICB2aWV3OiAndGltZVNlcmllcycsXG4gICAgICAgICAgICAgIHN0YWNrZWQ6IGZhbHNlLFxuICAgICAgICAgICAgICByZWdpb24sXG4gICAgICAgICAgICAgIHN0YXQ6ICdBdmVyYWdlJyxcbiAgICAgICAgICAgICAgcGVyaW9kOiAzMDAsXG4gICAgICAgICAgICAgIHRpdGxlOiAnNVhYLzRYWCBFcnJvciBSYXRlcyB8IDVtaW4nLFxuICAgICAgICAgICAgICBzZXRQZXJpb2RUb1RpbWVSYW5nZTogdHJ1ZSxcbiAgICAgICAgICAgICAgeUF4aXM6IHtcbiAgICAgICAgICAgICAgICBsZWZ0OiB7XG4gICAgICAgICAgICAgICAgICBzaG93VW5pdHM6IGZhbHNlLFxuICAgICAgICAgICAgICAgICAgbGFiZWw6ICclJyxcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICB9LFxuICAgICAgICAgIHtcbiAgICAgICAgICAgIGhlaWdodDogNixcbiAgICAgICAgICAgIHdpZHRoOiAyNCxcbiAgICAgICAgICAgIHk6IDEyLFxuICAgICAgICAgICAgeDogMCxcbiAgICAgICAgICAgIHR5cGU6ICdtZXRyaWMnLFxuICAgICAgICAgICAgcHJvcGVydGllczoge1xuICAgICAgICAgICAgICBtZXRyaWNzOiBbWydBV1MvQXBpR2F0ZXdheScsICdMYXRlbmN5JywgJ0FwaU5hbWUnLCBhcGlOYW1lXV0sXG4gICAgICAgICAgICAgIHZpZXc6ICd0aW1lU2VyaWVzJyxcbiAgICAgICAgICAgICAgc3RhY2tlZDogZmFsc2UsXG4gICAgICAgICAgICAgIHJlZ2lvbixcbiAgICAgICAgICAgICAgcGVyaW9kOiAzMDAsXG4gICAgICAgICAgICAgIHN0YXQ6ICdwOTAnLFxuICAgICAgICAgICAgICB0aXRsZTogJ0xhdGVuY3kgcDkwIHwgNW1pbicsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIH0sXG4gICAgICAgICAge1xuICAgICAgICAgICAgdHlwZTogJ21ldHJpYycsXG4gICAgICAgICAgICB4OiAwLFxuICAgICAgICAgICAgeTogMTgsXG4gICAgICAgICAgICB3aWR0aDogMjQsXG4gICAgICAgICAgICBoZWlnaHQ6IDYsXG4gICAgICAgICAgICBwcm9wZXJ0aWVzOiB7XG4gICAgICAgICAgICAgIHZpZXc6ICd0aW1lU2VyaWVzJyxcbiAgICAgICAgICAgICAgc3RhY2tlZDogZmFsc2UsXG4gICAgICAgICAgICAgIG1ldHJpY3M6IFtcbiAgICAgICAgICAgICAgICBbTkFNRVNQQUNFLCAnUXVvdGVzRmV0Y2hlZCcsICdTZXJ2aWNlJywgJ1JvdXRpbmdBUEknXSxcbiAgICAgICAgICAgICAgICBbTkFNRVNQQUNFLCAnVjNRdW90ZXNGZXRjaGVkJywgJ1NlcnZpY2UnLCAnUm91dGluZ0FQSSddLFxuICAgICAgICAgICAgICAgIFtOQU1FU1BBQ0UsICdWMlF1b3Rlc0ZldGNoZWQnLCAnU2VydmljZScsICdSb3V0aW5nQVBJJ10sXG4gICAgICAgICAgICAgICAgW05BTUVTUEFDRSwgJ01peGVkUXVvdGVzRmV0Y2hlZCcsICdTZXJ2aWNlJywgJ1JvdXRpbmdBUEknXSxcbiAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgcmVnaW9uLFxuICAgICAgICAgICAgICB0aXRsZTogJ3A5MCBRdW90ZXMgRmV0Y2hlZCBQZXIgU3dhcCcsXG4gICAgICAgICAgICAgIHBlcmlvZDogMzAwLFxuICAgICAgICAgICAgICBzdGF0OiAncDkwJyxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSxcbiAgICAgICAgICB7XG4gICAgICAgICAgICB0eXBlOiAnbWV0cmljJyxcbiAgICAgICAgICAgIHg6IDAsXG4gICAgICAgICAgICB5OiAyNSxcbiAgICAgICAgICAgIHdpZHRoOiAyNCxcbiAgICAgICAgICAgIGhlaWdodDogNixcbiAgICAgICAgICAgIHByb3BlcnRpZXM6IHtcbiAgICAgICAgICAgICAgdmlldzogJ3RpbWVTZXJpZXMnLFxuICAgICAgICAgICAgICBzdGFja2VkOiBmYWxzZSxcbiAgICAgICAgICAgICAgaW5zaWdodFJ1bGU6IHtcbiAgICAgICAgICAgICAgICBtYXhDb250cmlidXRvckNvdW50OiAyNSxcbiAgICAgICAgICAgICAgICBvcmRlckJ5OiAnU3VtJyxcbiAgICAgICAgICAgICAgICBydWxlTmFtZTogUkVRVUVTVEVEX1FVT1RFU19SVUxFX05BTUUsXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIGxlZ2VuZDoge1xuICAgICAgICAgICAgICAgIHBvc2l0aW9uOiAnYm90dG9tJyxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgcmVnaW9uLFxuICAgICAgICAgICAgICB0aXRsZTogJ1JlcXVlc3RlZCBRdW90ZXMnLFxuICAgICAgICAgICAgICBwZXJpb2Q6IDMwMCxcbiAgICAgICAgICAgICAgc3RhdDogJ1N1bScsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIH0sXG4gICAgICAgICAge1xuICAgICAgICAgICAgdHlwZTogJ21ldHJpYycsXG4gICAgICAgICAgICB4OiAwLFxuICAgICAgICAgICAgeTogMjYsXG4gICAgICAgICAgICB3aWR0aDogMjQsXG4gICAgICAgICAgICBoZWlnaHQ6IDYsXG4gICAgICAgICAgICBwcm9wZXJ0aWVzOiB7XG4gICAgICAgICAgICAgIHZpZXc6ICd0aW1lU2VyaWVzJyxcbiAgICAgICAgICAgICAgc3RhY2tlZDogZmFsc2UsXG4gICAgICAgICAgICAgIGluc2lnaHRSdWxlOiB7XG4gICAgICAgICAgICAgICAgbWF4Q29udHJpYnV0b3JDb3VudDogMjUsXG4gICAgICAgICAgICAgICAgb3JkZXJCeTogJ1N1bScsXG4gICAgICAgICAgICAgICAgcnVsZU5hbWU6IFJFUVVFU1RFRF9RVU9URVNfQllfQ0hBSU5fUlVMRV9OQU1FLFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICBsZWdlbmQ6IHtcbiAgICAgICAgICAgICAgICBwb3NpdGlvbjogJ2JvdHRvbScsXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIHJlZ2lvbixcbiAgICAgICAgICAgICAgdGl0bGU6ICdSZXF1ZXN0ZWQgUXVvdGVzIEJ5IENoYWluJyxcbiAgICAgICAgICAgICAgcGVyaW9kOiAzMDAsXG4gICAgICAgICAgICAgIHN0YXQ6ICdTdW0nLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICB9LFxuICAgICAgICAgIHtcbiAgICAgICAgICAgIHR5cGU6ICdtZXRyaWMnLFxuICAgICAgICAgICAgeDogMCxcbiAgICAgICAgICAgIHk6IDI0LFxuICAgICAgICAgICAgd2lkdGg6IDI0LFxuICAgICAgICAgICAgaGVpZ2h0OiA2LFxuICAgICAgICAgICAgcHJvcGVydGllczoge1xuICAgICAgICAgICAgICB2aWV3OiAndGltZVNlcmllcycsXG4gICAgICAgICAgICAgIHN0YWNrZWQ6IGZhbHNlLFxuICAgICAgICAgICAgICBtZXRyaWNzOiBbXG4gICAgICAgICAgICAgICAgW05BTUVTUEFDRSwgJ01peGVkQW5kVjNBbmRWMlNwbGl0Um91dGUnLCAnU2VydmljZScsICdSb3V0aW5nQVBJJ10sXG4gICAgICAgICAgICAgICAgW05BTUVTUEFDRSwgJ01peGVkQW5kVjNTcGxpdFJvdXRlJywgJ1NlcnZpY2UnLCAnUm91dGluZ0FQSSddLFxuICAgICAgICAgICAgICAgIFtOQU1FU1BBQ0UsICdNaXhlZEFuZFYyU3BsaXRSb3V0ZScsICdTZXJ2aWNlJywgJ1JvdXRpbmdBUEknXSxcbiAgICAgICAgICAgICAgICBbTkFNRVNQQUNFLCAnTWl4ZWRTcGxpdFJvdXRlJywgJ1NlcnZpY2UnLCAnUm91dGluZ0FQSSddLFxuICAgICAgICAgICAgICAgIFtOQU1FU1BBQ0UsICdNaXhlZFJvdXRlJywgJ1NlcnZpY2UnLCAnUm91dGluZ0FQSSddLFxuICAgICAgICAgICAgICAgIFtOQU1FU1BBQ0UsICdWM0FuZFYyU3BsaXRSb3V0ZScsICdTZXJ2aWNlJywgJ1JvdXRpbmdBUEknXSxcbiAgICAgICAgICAgICAgICBbTkFNRVNQQUNFLCAnVjNTcGxpdFJvdXRlJywgJ1NlcnZpY2UnLCAnUm91dGluZ0FQSSddLFxuICAgICAgICAgICAgICAgIFtOQU1FU1BBQ0UsICdWM1JvdXRlJywgJ1NlcnZpY2UnLCAnUm91dGluZ0FQSSddLFxuICAgICAgICAgICAgICAgIFtOQU1FU1BBQ0UsICdWMlNwbGl0Um91dGUnLCAnU2VydmljZScsICdSb3V0aW5nQVBJJ10sXG4gICAgICAgICAgICAgICAgW05BTUVTUEFDRSwgJ1YyUm91dGUnLCAnU2VydmljZScsICdSb3V0aW5nQVBJJ10sXG4gICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgIHJlZ2lvbixcbiAgICAgICAgICAgICAgdGl0bGU6ICdUeXBlcyBvZiByb3V0ZXMgcmV0dXJuZWQgYWNyb3NzIGFsbCBjaGFpbnMnLFxuICAgICAgICAgICAgICBwZXJpb2Q6IDMwMCxcbiAgICAgICAgICAgICAgc3RhdDogJ1N1bScsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIH0sXG4gICAgICAgICAge1xuICAgICAgICAgICAgdHlwZTogJ21ldHJpYycsXG4gICAgICAgICAgICB4OiAwLFxuICAgICAgICAgICAgeTogMzAsXG4gICAgICAgICAgICB3aWR0aDogMjQsXG4gICAgICAgICAgICBoZWlnaHQ6IDYsXG4gICAgICAgICAgICBwcm9wZXJ0aWVzOiB7XG4gICAgICAgICAgICAgIHZpZXc6ICd0aW1lU2VyaWVzJyxcbiAgICAgICAgICAgICAgc3RhY2tlZDogZmFsc2UsXG4gICAgICAgICAgICAgIG1ldHJpY3M6IF8uZmxhdE1hcChTVVBQT1JURURfQ0hBSU5TLCAoY2hhaW5JZDogQ2hhaW5JZCkgPT4gW1xuICAgICAgICAgICAgICAgIFtOQU1FU1BBQ0UsIGBNaXhlZEFuZFYzQW5kVjJTcGxpdFJvdXRlRm9yQ2hhaW4ke2NoYWluSWR9YCwgJ1NlcnZpY2UnLCAnUm91dGluZ0FQSSddLFxuICAgICAgICAgICAgICAgIFtOQU1FU1BBQ0UsIGBNaXhlZEFuZFYzU3BsaXRSb3V0ZUZvckNoYWluJHtjaGFpbklkfWAsICdTZXJ2aWNlJywgJ1JvdXRpbmdBUEknXSxcbiAgICAgICAgICAgICAgICBbTkFNRVNQQUNFLCBgTWl4ZWRBbmRWMlNwbGl0Um91dGVGb3JDaGFpbiR7Y2hhaW5JZH1gLCAnU2VydmljZScsICdSb3V0aW5nQVBJJ10sXG4gICAgICAgICAgICAgICAgW05BTUVTUEFDRSwgYE1peGVkU3BsaXRSb3V0ZUZvckNoYWluJHtjaGFpbklkfWAsICdTZXJ2aWNlJywgJ1JvdXRpbmdBUEknXSxcbiAgICAgICAgICAgICAgICBbTkFNRVNQQUNFLCBgTWl4ZWRSb3V0ZUZvckNoYWluJHtjaGFpbklkfWAsICdTZXJ2aWNlJywgJ1JvdXRpbmdBUEknXSxcbiAgICAgICAgICAgICAgICBbTkFNRVNQQUNFLCBgVjNBbmRWMlNwbGl0Um91dGVGb3JDaGFpbiR7Y2hhaW5JZH1gLCAnU2VydmljZScsICdSb3V0aW5nQVBJJ10sXG4gICAgICAgICAgICAgICAgW05BTUVTUEFDRSwgYFYzU3BsaXRSb3V0ZUZvckNoYWluJHtjaGFpbklkfWAsICdTZXJ2aWNlJywgJ1JvdXRpbmdBUEknXSxcbiAgICAgICAgICAgICAgICBbTkFNRVNQQUNFLCBgVjNSb3V0ZUZvckNoYWluJHtjaGFpbklkfWAsICdTZXJ2aWNlJywgJ1JvdXRpbmdBUEknXSxcbiAgICAgICAgICAgICAgICBbTkFNRVNQQUNFLCBgVjJTcGxpdFJvdXRlRm9yQ2hhaW4ke2NoYWluSWR9YCwgJ1NlcnZpY2UnLCAnUm91dGluZ0FQSSddLFxuICAgICAgICAgICAgICAgIFtOQU1FU1BBQ0UsIGBWMlJvdXRlRm9yQ2hhaW4ke2NoYWluSWR9YCwgJ1NlcnZpY2UnLCAnUm91dGluZ0FQSSddLFxuICAgICAgICAgICAgICBdKSxcbiAgICAgICAgICAgICAgcmVnaW9uLFxuICAgICAgICAgICAgICB0aXRsZTogJ1R5cGVzIG9mIFYzIHJvdXRlcyByZXR1cm5lZCBieSBjaGFpbicsXG4gICAgICAgICAgICAgIHBlcmlvZDogMzAwLFxuICAgICAgICAgICAgICBzdGF0OiAnU3VtJyxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSxcbiAgICAgICAgICB7XG4gICAgICAgICAgICB0eXBlOiAnbWV0cmljJyxcbiAgICAgICAgICAgIHg6IDAsXG4gICAgICAgICAgICB5OiAzNixcbiAgICAgICAgICAgIHdpZHRoOiAyNCxcbiAgICAgICAgICAgIGhlaWdodDogNixcbiAgICAgICAgICAgIHByb3BlcnRpZXM6IHtcbiAgICAgICAgICAgICAgbWV0cmljczogXy5mbGF0TWFwKFNVUFBPUlRFRF9DSEFJTlMsIChjaGFpbklkOiBDaGFpbklkKSA9PiBbXG4gICAgICAgICAgICAgICAgWydVbmlzd2FwJywgYFF1b3RlRm91bmRGb3JDaGFpbiR7Y2hhaW5JZH1gLCAnU2VydmljZScsICdSb3V0aW5nQVBJJ10sXG4gICAgICAgICAgICAgICAgWydVbmlzd2FwJywgYFF1b3RlUmVxdWVzdGVkRm9yQ2hhaW4ke2NoYWluSWR9YCwgJ1NlcnZpY2UnLCAnUm91dGluZ0FQSSddLFxuICAgICAgICAgICAgICBdKSxcbiAgICAgICAgICAgICAgdmlldzogJ3RpbWVTZXJpZXMnLFxuICAgICAgICAgICAgICBzdGFja2VkOiBmYWxzZSxcbiAgICAgICAgICAgICAgc3RhdDogJ1N1bScsXG4gICAgICAgICAgICAgIHBlcmlvZDogMzAwLFxuICAgICAgICAgICAgICByZWdpb24sXG4gICAgICAgICAgICAgIHRpdGxlOiAnUXVvdGUgUmVxdWVzdGVkL0ZvdW5kIGJ5IENoYWluJyxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSxcbiAgICAgICAgICB7XG4gICAgICAgICAgICBoZWlnaHQ6IDEyLFxuICAgICAgICAgICAgd2lkdGg6IDI0LFxuICAgICAgICAgICAgeTogNDIsXG4gICAgICAgICAgICB4OiAwLFxuICAgICAgICAgICAgdHlwZTogJ21ldHJpYycsXG4gICAgICAgICAgICBwcm9wZXJ0aWVzOiB7XG4gICAgICAgICAgICAgIG1ldHJpY3M6IFtcbiAgICAgICAgICAgICAgICBbTkFNRVNQQUNFLCAnVG9rZW5MaXN0TG9hZCcsICdTZXJ2aWNlJywgJ1JvdXRpbmdBUEknLCB7IGNvbG9yOiAnI2M1YjBkNScgfV0sXG4gICAgICAgICAgICAgICAgWycuJywgJ0dhc1ByaWNlTG9hZCcsICcuJywgJy4nLCB7IGNvbG9yOiAnIzE3YmVjZicgfV0sXG4gICAgICAgICAgICAgICAgWycuJywgJ1YzUG9vbHNMb2FkJywgJy4nLCAnLicsIHsgY29sb3I6ICcjZTM3N2MyJyB9XSxcbiAgICAgICAgICAgICAgICBbJy4nLCAnVjJQb29sc0xvYWQnLCAnLicsICcuJywgeyBjb2xvcjogJyNlMzc3YzInIH1dLFxuICAgICAgICAgICAgICAgIFsnLicsICdWM1N1YmdyYXBoUG9vbHNMb2FkJywgJy4nLCAnLicsIHsgY29sb3I6ICcjMWY3N2I0JyB9XSxcbiAgICAgICAgICAgICAgICBbJy4nLCAnVjJTdWJncmFwaFBvb2xzTG9hZCcsICcuJywgJy4nLCB7IGNvbG9yOiAnI2JmNzdiNCcgfV0sXG4gICAgICAgICAgICAgICAgWycuJywgJ1YzUXVvdGVzTG9hZCcsICcuJywgJy4nLCB7IGNvbG9yOiAnIzJjYTAyYycgfV0sXG4gICAgICAgICAgICAgICAgWycuJywgJ01peGVkUXVvdGVzTG9hZCcsICcuJywgJy4nLCB7IGNvbG9yOiAnI2ZlZmE2MycgfV0sXG4gICAgICAgICAgICAgICAgWycuJywgJ1YyUXVvdGVzTG9hZCcsICcuJywgJy4nLCB7IGNvbG9yOiAnIzdmN2Y3ZicgfV0sXG4gICAgICAgICAgICAgICAgWycuJywgJ0ZpbmRCZXN0U3dhcFJvdXRlJywgJy4nLCAnLicsIHsgY29sb3I6ICcjZDYyNzI4JyB9XSxcbiAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgdmlldzogJ3RpbWVTZXJpZXMnLFxuICAgICAgICAgICAgICBzdGFja2VkOiB0cnVlLFxuICAgICAgICAgICAgICByZWdpb24sXG4gICAgICAgICAgICAgIHN0YXQ6ICdwOTAnLFxuICAgICAgICAgICAgICBwZXJpb2Q6IDMwMCxcbiAgICAgICAgICAgICAgdGl0bGU6ICdMYXRlbmN5IEJyZWFrZG93biB8IDVtaW4nLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICB9LFxuICAgICAgICAgIHtcbiAgICAgICAgICAgIHR5cGU6ICdtZXRyaWMnLFxuICAgICAgICAgICAgeDogMCxcbiAgICAgICAgICAgIHk6IDQ4LFxuICAgICAgICAgICAgd2lkdGg6IDI0LFxuICAgICAgICAgICAgaGVpZ2h0OiA5LFxuICAgICAgICAgICAgcHJvcGVydGllczoge1xuICAgICAgICAgICAgICB2aWV3OiAndGltZVNlcmllcycsXG4gICAgICAgICAgICAgIHN0YWNrZWQ6IGZhbHNlLFxuICAgICAgICAgICAgICBtZXRyaWNzOiBbXG4gICAgICAgICAgICAgICAgW05BTUVTUEFDRSwgJ1YzdG9wMmRpcmVjdHN3YXBwb29sJywgJ1NlcnZpY2UnLCAnUm91dGluZ0FQSSddLFxuICAgICAgICAgICAgICAgIFsnLicsICdWM3RvcDJldGhxdW90ZXRva2VucG9vbCcsICcuJywgJy4nXSxcbiAgICAgICAgICAgICAgICBbJy4nLCAnVjN0b3BieXR2bCcsICcuJywgJy4nXSxcbiAgICAgICAgICAgICAgICBbJy4nLCAnVjN0b3BieXR2bHVzaW5ndG9rZW5pbicsICcuJywgJy4nXSxcbiAgICAgICAgICAgICAgICBbJy4nLCAnVjN0b3BieXR2bHVzaW5ndG9rZW5pbnNlY29uZGhvcHMnLCAnLicsICcuJ10sXG4gICAgICAgICAgICAgICAgWycuJywgJ1YydG9wYnl0dmx1c2luZ3Rva2Vub3V0JywgJy4nLCAnLiddLFxuICAgICAgICAgICAgICAgIFsnLicsICdWM3RvcGJ5dHZsdXNpbmd0b2tlbm91dHNlY29uZGhvcHMnLCAnLicsICcuJ10sXG4gICAgICAgICAgICAgICAgWycuJywgJ1YzdG9wYnliYXNld2l0aHRva2VuaW4nLCAnLicsICcuJ10sXG4gICAgICAgICAgICAgICAgWycuJywgJ1YzdG9wYnliYXNld2l0aHRva2Vub3V0JywgJy4nLCAnLiddLFxuICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICByZWdpb246IHJlZ2lvbixcbiAgICAgICAgICAgICAgdGl0bGU6ICdwOTUgVjMgVG9wIE4gUG9vbHMgVXNlZCBGcm9tIFNvdXJjZXMgaW4gQmVzdCBSb3V0ZSB8IDVtaW4nLFxuICAgICAgICAgICAgICBzdGF0OiAncDk1JyxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSxcbiAgICAgICAgICB7XG4gICAgICAgICAgICB0eXBlOiAnbWV0cmljJyxcbiAgICAgICAgICAgIHg6IDAsXG4gICAgICAgICAgICB5OiA1NCxcbiAgICAgICAgICAgIHdpZHRoOiAyNCxcbiAgICAgICAgICAgIGhlaWdodDogOSxcbiAgICAgICAgICAgIHByb3BlcnRpZXM6IHtcbiAgICAgICAgICAgICAgdmlldzogJ3RpbWVTZXJpZXMnLFxuICAgICAgICAgICAgICBzdGFja2VkOiBmYWxzZSxcbiAgICAgICAgICAgICAgbWV0cmljczogW1xuICAgICAgICAgICAgICAgIFtOQU1FU1BBQ0UsICdWMnRvcDJkaXJlY3Rzd2FwcG9vbCcsICdTZXJ2aWNlJywgJ1JvdXRpbmdBUEknXSxcbiAgICAgICAgICAgICAgICBbJy4nLCAnVjJ0b3AyZXRocXVvdGV0b2tlbnBvb2wnLCAnLicsICcuJ10sXG4gICAgICAgICAgICAgICAgWycuJywgJ1YydG9wYnl0dmwnLCAnLicsICcuJ10sXG4gICAgICAgICAgICAgICAgWycuJywgJ1YydG9wYnl0dmx1c2luZ3Rva2VuaW4nLCAnLicsICcuJ10sXG4gICAgICAgICAgICAgICAgWycuJywgJ1YydG9wYnl0dmx1c2luZ3Rva2VuaW5zZWNvbmRob3BzJywgJy4nLCAnLiddLFxuICAgICAgICAgICAgICAgIFsnLicsICdWMnRvcGJ5dHZsdXNpbmd0b2tlbm91dCcsICcuJywgJy4nXSxcbiAgICAgICAgICAgICAgICBbJy4nLCAnVjJ0b3BieXR2bHVzaW5ndG9rZW5vdXRzZWNvbmRob3BzJywgJy4nLCAnLiddLFxuICAgICAgICAgICAgICAgIFsnLicsICdWMnRvcGJ5YmFzZXdpdGh0b2tlbmluJywgJy4nLCAnLiddLFxuICAgICAgICAgICAgICAgIFsnLicsICdWMnRvcGJ5YmFzZXdpdGh0b2tlbm91dCcsICcuJywgJy4nXSxcbiAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgcmVnaW9uOiByZWdpb24sXG4gICAgICAgICAgICAgIHRpdGxlOiAncDk1IFYyIFRvcCBOIFBvb2xzIFVzZWQgRnJvbSBTb3VyY2VzIGluIEJlc3QgUm91dGUgfCA1bWluJyxcbiAgICAgICAgICAgICAgc3RhdDogJ3A5NScsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIH0sXG4gICAgICAgICAge1xuICAgICAgICAgICAgdHlwZTogJ21ldHJpYycsXG4gICAgICAgICAgICB4OiAwLFxuICAgICAgICAgICAgeTogNjAsXG4gICAgICAgICAgICB3aWR0aDogMjQsXG4gICAgICAgICAgICBoZWlnaHQ6IDksXG4gICAgICAgICAgICBwcm9wZXJ0aWVzOiB7XG4gICAgICAgICAgICAgIHZpZXc6ICd0aW1lU2VyaWVzJyxcbiAgICAgICAgICAgICAgc3RhY2tlZDogZmFsc2UsXG4gICAgICAgICAgICAgIG1ldHJpY3M6IFtcbiAgICAgICAgICAgICAgICBbJ0FXUy9MYW1iZGEnLCAnUHJvdmlzaW9uZWRDb25jdXJyZW50RXhlY3V0aW9ucycsICdGdW5jdGlvbk5hbWUnLCByb3V0aW5nTGFtYmRhTmFtZV0sXG4gICAgICAgICAgICAgICAgWycuJywgJ0NvbmN1cnJlbnRFeGVjdXRpb25zJywgJy4nLCAnLiddLFxuICAgICAgICAgICAgICAgIFsnLicsICdQcm92aXNpb25lZENvbmN1cnJlbmN5U3BpbGxvdmVySW52b2NhdGlvbnMnLCAnLicsICcuJ10sXG4gICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgIHJlZ2lvbjogcmVnaW9uLFxuICAgICAgICAgICAgICB0aXRsZTogJ1JvdXRpbmcgTGFtYmRhIFByb3Zpc2lvbmVkIENvbmN1cnJlbmN5IHwgNW1pbicsXG4gICAgICAgICAgICAgIHN0YXQ6ICdBdmVyYWdlJyxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSxcbiAgICAgICAgXSxcbiAgICAgIH0pLFxuICAgIH0pXG5cbiAgICBjb25zdCBxdW90ZUFtb3VudHNXaWRnZXRzID0gbmV3IFF1b3RlQW1vdW50c1dpZGdldHNGYWN0b3J5KE5BTUVTUEFDRSwgcmVnaW9uKVxuICAgIG5ldyBhd3NfY2xvdWR3YXRjaC5DZm5EYXNoYm9hcmQodGhpcywgJ1JvdXRpbmdBUElUcmFja2VkUGFpcnNEYXNoYm9hcmQnLCB7XG4gICAgICBkYXNoYm9hcmROYW1lOiAnUm91dGluZ0FQSVRyYWNrZWRQYWlyc0Rhc2hib2FyZCcsXG4gICAgICBkYXNoYm9hcmRCb2R5OiBKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgIHBlcmlvZE92ZXJyaWRlOiAnaW5oZXJpdCcsXG4gICAgICAgIHdpZGdldHM6IHF1b3RlQW1vdW50c1dpZGdldHMuZ2VuZXJhdGVXaWRnZXRzKCksXG4gICAgICB9KSxcbiAgICB9KVxuXG4gICAgY29uc3QgY2FjaGVkUm91dGVzV2lkZ2V0cyA9IG5ldyBDYWNoZWRSb3V0ZXNXaWRnZXRzRmFjdG9yeShOQU1FU1BBQ0UsIHJlZ2lvbiwgcm91dGluZ0xhbWJkYU5hbWUpXG4gICAgbmV3IGF3c19jbG91ZHdhdGNoLkNmbkRhc2hib2FyZCh0aGlzLCAnQ2FjaGVkUm91dGVzUGVyZm9ybWFuY2VEYXNoYm9hcmQnLCB7XG4gICAgICBkYXNoYm9hcmROYW1lOiAnQ2FjaGVkUm91dGVzUGVyZm9ybWFuY2VEYXNoYm9hcmQnLFxuICAgICAgZGFzaGJvYXJkQm9keTogSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICBwZXJpb2RPdmVycmlkZTogJ2luaGVyaXQnLFxuICAgICAgICB3aWRnZXRzOiBjYWNoZWRSb3V0ZXNXaWRnZXRzLmdlbmVyYXRlV2lkZ2V0cygpLFxuICAgICAgfSksXG4gICAgfSlcblxuICAgIG5ldyBhd3NfY2xvdWR3YXRjaC5DZm5EYXNoYm9hcmQodGhpcywgJ1JvdXRpbmdBUElRdW90ZVByb3ZpZGVyRGFzaGJvYXJkJywge1xuICAgICAgZGFzaGJvYXJkTmFtZTogYFJvdXRpbmdRdW90ZVByb3ZpZGVyRGFzaGJvYXJkYCxcbiAgICAgIGRhc2hib2FyZEJvZHk6IEpTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgcGVyaW9kT3ZlcnJpZGU6ICdpbmhlcml0JyxcbiAgICAgICAgd2lkZ2V0czogW1xuICAgICAgICAgIHtcbiAgICAgICAgICAgIGhlaWdodDogNixcbiAgICAgICAgICAgIHdpZHRoOiAyNCxcbiAgICAgICAgICAgIHk6IDAsXG4gICAgICAgICAgICB4OiAwLFxuICAgICAgICAgICAgdHlwZTogJ21ldHJpYycsXG4gICAgICAgICAgICBwcm9wZXJ0aWVzOiB7XG4gICAgICAgICAgICAgIG1ldHJpY3M6IFtbTkFNRVNQQUNFLCAnUXVvdGVBcHByb3hHYXNVc2VkUGVyU3VjY2Vzc2Z1bENhbGwnLCAnU2VydmljZScsICdSb3V0aW5nQVBJJ11dLFxuICAgICAgICAgICAgICB2aWV3OiAndGltZVNlcmllcycsXG4gICAgICAgICAgICAgIHN0YWNrZWQ6IGZhbHNlLFxuICAgICAgICAgICAgICByZWdpb24sXG4gICAgICAgICAgICAgIHN0YXQ6ICdBdmVyYWdlJyxcbiAgICAgICAgICAgICAgcGVyaW9kOiAzMDAsXG4gICAgICAgICAgICAgIHRpdGxlOiAnQXBwcm94IGdhcyB1c2VkIGJ5IGVhY2ggY2FsbCcsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIH0sXG4gICAgICAgICAge1xuICAgICAgICAgICAgaGVpZ2h0OiA2LFxuICAgICAgICAgICAgd2lkdGg6IDI0LFxuICAgICAgICAgICAgeTogNixcbiAgICAgICAgICAgIHg6IDAsXG4gICAgICAgICAgICB0eXBlOiAnbWV0cmljJyxcbiAgICAgICAgICAgIHByb3BlcnRpZXM6IHtcbiAgICAgICAgICAgICAgbWV0cmljczogW1xuICAgICAgICAgICAgICAgIFtOQU1FU1BBQ0UsICdRdW90ZVRvdGFsQ2FsbHNUb1Byb3ZpZGVyJywgJ1NlcnZpY2UnLCAnUm91dGluZ0FQSSddLFxuICAgICAgICAgICAgICAgIFsnLicsICdRdW90ZUV4cGVjdGVkQ2FsbHNUb1Byb3ZpZGVyJywgJy4nLCAnLiddLFxuICAgICAgICAgICAgICAgIFsnLicsICdRdW90ZU51bVJldHJpZWRDYWxscycsICcuJywgJy4nXSxcbiAgICAgICAgICAgICAgICBbJy4nLCAnUXVvdGVOdW1SZXRyeUxvb3BzJywgJy4nLCAnLiddLFxuICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICB2aWV3OiAndGltZVNlcmllcycsXG4gICAgICAgICAgICAgIHN0YWNrZWQ6IGZhbHNlLFxuICAgICAgICAgICAgICByZWdpb24sXG4gICAgICAgICAgICAgIHN0YXQ6ICdBdmVyYWdlJyxcbiAgICAgICAgICAgICAgcGVyaW9kOiAzMDAsXG4gICAgICAgICAgICAgIHRpdGxlOiAnTnVtYmVyIG9mIHJldHJpZXMgdG8gcHJvdmlkZXIgbmVlZGVkIHRvIGdldCBxdW90ZScsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIH0sXG4gICAgICAgICAge1xuICAgICAgICAgICAgaGVpZ2h0OiA2LFxuICAgICAgICAgICAgd2lkdGg6IDI0LFxuICAgICAgICAgICAgeTogMTIsXG4gICAgICAgICAgICB4OiAwLFxuICAgICAgICAgICAgdHlwZTogJ21ldHJpYycsXG4gICAgICAgICAgICBwcm9wZXJ0aWVzOiB7XG4gICAgICAgICAgICAgIG1ldHJpY3M6IFtcbiAgICAgICAgICAgICAgICBbTkFNRVNQQUNFLCAnUXVvdGVPdXRPZkdhc0V4Y2VwdGlvblJldHJ5JywgJ1NlcnZpY2UnLCAnUm91dGluZ0FQSSddLFxuICAgICAgICAgICAgICAgIFsnLicsICdRdW90ZVN1Y2Nlc3NSYXRlUmV0cnknLCAnLicsICcuJ10sXG4gICAgICAgICAgICAgICAgWycuJywgJ1F1b3RlQmxvY2tIZWFkZXJOb3RGb3VuZFJldHJ5JywgJy4nLCAnLiddLFxuICAgICAgICAgICAgICAgIFsnLicsICdRdW90ZVRpbWVvdXRSZXRyeScsICcuJywgJy4nXSxcbiAgICAgICAgICAgICAgICBbJy4nLCAnUXVvdGVVbmtub3duUmVhc29uUmV0cnknLCAnLicsICcuJ10sXG4gICAgICAgICAgICAgICAgWycuJywgJ1F1b3RlQmxvY2tDb25mbGljdEVycm9yUmV0cnknLCAnLicsICcuJ10sXG4gICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgIHZpZXc6ICd0aW1lU2VyaWVzJyxcbiAgICAgICAgICAgICAgc3RhY2tlZDogZmFsc2UsXG4gICAgICAgICAgICAgIHJlZ2lvbixcbiAgICAgICAgICAgICAgcGVyaW9kOiAzMDAsXG4gICAgICAgICAgICAgIHN0YXQ6ICdTdW0nLFxuICAgICAgICAgICAgICB0aXRsZTogJ051bWJlciBvZiByZXF1ZXN0cyB0aGF0IHJldHJpZWQgaW4gdGhlIHF1b3RlIHByb3ZpZGVyJyxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSxcbiAgICAgICAgXSxcbiAgICAgIH0pLFxuICAgIH0pXG4gIH1cbn1cbiJdfQ==