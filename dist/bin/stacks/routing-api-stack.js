import { ChainId, SUPPORTED_CHAINS } from '@tartz-one/smart-order-router';
import * as cdk from 'aws-cdk-lib';
import { CfnOutput, Duration } from 'aws-cdk-lib';
import * as aws_apigateway from 'aws-cdk-lib/aws-apigateway';
import { MethodLoggingLevel } from 'aws-cdk-lib/aws-apigateway';
import * as aws_cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import { MathExpression } from 'aws-cdk-lib/aws-cloudwatch';
import * as aws_cloudwatch_actions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as aws_logs from 'aws-cdk-lib/aws-logs';
import * as aws_sns from 'aws-cdk-lib/aws-sns';
import * as aws_waf from 'aws-cdk-lib/aws-wafv2';
import { STAGE } from '../../lib/util/stage';
import { RoutingCachingStack } from './routing-caching-stack';
import { RoutingDashboardStack } from './routing-dashboard-stack';
import { RoutingLambdaStack } from './routing-lambda-stack';
import { RoutingDatabaseStack } from './routing-database-stack';
export const CHAINS_NOT_MONITORED = [
    ChainId.RINKEBY,
    ChainId.ARBITRUM_RINKEBY,
    ChainId.ROPSTEN,
    ChainId.KOVAN,
    ChainId.OPTIMISTIC_KOVAN,
    ChainId.GÖRLI,
    ChainId.POLYGON_MUMBAI,
];
export class RoutingAPIStack extends cdk.Stack {
    constructor(parent, name, props) {
        super(parent, name, props);
        const { jsonRpcProviders, provisionedConcurrency, throttlingOverride, ethGasStationInfoUrl, chatbotSNSArn, stage, route53Arn, pinata_key, pinata_secret, hosted_zone, tenderlyUser, tenderlyProject, tenderlyAccessKey, } = props;
        const { poolCacheBucket, poolCacheBucket2, poolCacheKey, poolCacheLambdaNameArray, tokenListCacheBucket, ipfsPoolCachingLambda, } = new RoutingCachingStack(this, 'RoutingCachingStack', {
            chatbotSNSArn,
            stage,
            route53Arn,
            pinata_key,
            pinata_secret,
            hosted_zone,
        });
        const { cachedRoutesDynamoDb } = new RoutingDatabaseStack(this, 'RoutingDatabaseStack', {});
        const { routingLambda, routingLambdaAlias, routeToRatioLambda } = new RoutingLambdaStack(this, 'RoutingLambdaStack', {
            poolCacheBucket,
            poolCacheBucket2,
            poolCacheKey,
            jsonRpcProviders,
            tokenListCacheBucket,
            provisionedConcurrency,
            ethGasStationInfoUrl,
            chatbotSNSArn,
            tenderlyUser,
            tenderlyProject,
            tenderlyAccessKey,
            cachedRoutesDynamoDb,
        });
        const accessLogGroup = new aws_logs.LogGroup(this, 'RoutingAPIGAccessLogs');
        const api = new aws_apigateway.RestApi(this, 'routing-api', {
            restApiName: 'Routing API',
            deployOptions: {
                tracingEnabled: true,
                loggingLevel: MethodLoggingLevel.ERROR,
                accessLogDestination: new aws_apigateway.LogGroupLogDestination(accessLogGroup),
                accessLogFormat: aws_apigateway.AccessLogFormat.jsonWithStandardFields({
                    ip: false,
                    caller: false,
                    user: false,
                    requestTime: true,
                    httpMethod: true,
                    resourcePath: true,
                    status: true,
                    protocol: true,
                    responseLength: true,
                }),
            },
            defaultCorsPreflightOptions: {
                allowOrigins: aws_apigateway.Cors.ALL_ORIGINS,
                allowMethods: aws_apigateway.Cors.ALL_METHODS,
            },
        });
        const ipThrottlingACL = new aws_waf.CfnWebACL(this, 'RoutingAPIIPThrottlingACL', {
            defaultAction: { allow: {} },
            scope: 'REGIONAL',
            visibilityConfig: {
                sampledRequestsEnabled: true,
                cloudWatchMetricsEnabled: true,
                metricName: 'RoutingAPIIPBasedThrottling',
            },
            customResponseBodies: {
                RoutingAPIThrottledResponseBody: {
                    contentType: 'APPLICATION_JSON',
                    content: '{"errorCode": "TOO_MANY_REQUESTS"}',
                },
            },
            name: 'RoutingAPIIPThrottling',
            rules: [
                {
                    name: 'ip',
                    priority: 0,
                    statement: {
                        rateBasedStatement: {
                            // Limit is per 5 mins, i.e. 120 requests every 5 mins
                            limit: throttlingOverride ? parseInt(throttlingOverride) : 120,
                            // API is of type EDGE so is fronted by Cloudfront as a proxy.
                            // Use the ip set in X-Forwarded-For by Cloudfront, not the regular IP
                            // which would just resolve to Cloudfronts IP.
                            aggregateKeyType: 'FORWARDED_IP',
                            forwardedIpConfig: {
                                headerName: 'X-Forwarded-For',
                                fallbackBehavior: 'MATCH',
                            },
                        },
                    },
                    action: {
                        block: {
                            customResponse: {
                                responseCode: 429,
                                customResponseBodyKey: 'RoutingAPIThrottledResponseBody',
                            },
                        },
                    },
                    visibilityConfig: {
                        sampledRequestsEnabled: true,
                        cloudWatchMetricsEnabled: true,
                        metricName: 'RoutingAPIIPBasedThrottlingRule',
                    },
                },
            ],
        });
        const region = cdk.Stack.of(this).region;
        const apiArn = `arn:aws:apigateway:${region}::/restapis/${api.restApiId}/stages/${api.deploymentStage.stageName}`;
        new aws_waf.CfnWebACLAssociation(this, 'RoutingAPIIPThrottlingAssociation', {
            resourceArn: apiArn,
            webAclArn: ipThrottlingACL.getAtt('Arn').toString(),
        });
        new RoutingDashboardStack(this, 'RoutingDashboardStack', {
            apiName: api.restApiName,
            routingLambdaName: routingLambda.functionName,
            poolCacheLambdaNameArray,
            ipfsPoolCacheLambdaName: ipfsPoolCachingLambda ? ipfsPoolCachingLambda.functionName : undefined,
        });
        const lambdaIntegration = new aws_apigateway.LambdaIntegration(routingLambdaAlias);
        const quote = api.root.addResource('quote', {
            defaultCorsPreflightOptions: {
                allowOrigins: aws_apigateway.Cors.ALL_ORIGINS,
                allowMethods: aws_apigateway.Cors.ALL_METHODS,
            },
        });
        quote.addMethod('GET', lambdaIntegration);
        const routeToRatioLambdaIntegration = new aws_apigateway.LambdaIntegration(routeToRatioLambda);
        const quoteToRatio = api.root.addResource('quoteToRatio', {
            defaultCorsPreflightOptions: {
                allowOrigins: aws_apigateway.Cors.ALL_ORIGINS,
                allowMethods: aws_apigateway.Cors.ALL_METHODS,
            },
        });
        quoteToRatio.addMethod('GET', routeToRatioLambdaIntegration);
        // All alarms default to GreaterThanOrEqualToThreshold for when to be triggered.
        const apiAlarm5xxSev2 = new aws_cloudwatch.Alarm(this, 'RoutingAPI-SEV2-5XXAlarm', {
            alarmName: 'RoutingAPI-SEV2-5XX',
            metric: api.metricServerError({
                period: Duration.minutes(5),
                // For this metric 'avg' represents error rate.
                statistic: 'avg',
            }),
            threshold: 0.05,
            // Beta has much less traffic so is more susceptible to transient errors.
            evaluationPeriods: stage == STAGE.BETA ? 5 : 3,
        });
        const apiAlarm4xxSev2 = new aws_cloudwatch.Alarm(this, 'RoutingAPI-SEV2-4XXAlarm', {
            alarmName: 'RoutingAPI-SEV2-4XX',
            metric: api.metricClientError({
                period: Duration.minutes(5),
                statistic: 'avg',
            }),
            threshold: 0.95,
            evaluationPeriods: 3,
        });
        const apiAlarmLatencySev2 = new aws_cloudwatch.Alarm(this, 'RoutingAPI-SEV2-Latency', {
            alarmName: 'RoutingAPI-SEV2-Latency',
            metric: api.metricLatency({
                period: Duration.minutes(5),
                statistic: 'p90',
            }),
            threshold: 8500,
            evaluationPeriods: 3,
        });
        const apiAlarm5xxSev3 = new aws_cloudwatch.Alarm(this, 'RoutingAPI-SEV3-5XXAlarm', {
            alarmName: 'RoutingAPI-SEV3-5XX',
            metric: api.metricServerError({
                period: Duration.minutes(5),
                // For this metric 'avg' represents error rate.
                statistic: 'avg',
            }),
            threshold: 0.03,
            // Beta has much less traffic so is more susceptible to transient errors.
            evaluationPeriods: stage == STAGE.BETA ? 5 : 3,
        });
        const apiAlarm4xxSev3 = new aws_cloudwatch.Alarm(this, 'RoutingAPI-SEV3-4XXAlarm', {
            alarmName: 'RoutingAPI-SEV3-4XX',
            metric: api.metricClientError({
                period: Duration.minutes(5),
                statistic: 'avg',
            }),
            threshold: 0.8,
            evaluationPeriods: 3,
        });
        const apiAlarmLatencySev3 = new aws_cloudwatch.Alarm(this, 'RoutingAPI-SEV3-Latency', {
            alarmName: 'RoutingAPI-SEV3-Latency',
            metric: api.metricLatency({
                period: Duration.minutes(5),
                statistic: 'p90',
            }),
            threshold: 5500,
            evaluationPeriods: 3,
        });
        // Simulations can fail for valid reasons. For example, if the simulation reverts due
        // to slippage checks (can happen with FOT tokens sometimes since our quoter does not
        // account for the fees taken during transfer when we show the user the quote).
        //
        // For this reason we only alert on SEV3 to avoid unnecessary pages.
        const simulationAlarmSev3 = new aws_cloudwatch.Alarm(this, 'RoutingAPI-SEV3-Simulation', {
            alarmName: 'RoutingAPI-SEV3-Simulation',
            metric: new MathExpression({
                expression: '100*(simulationFailed/simulationRequested)',
                period: Duration.minutes(30),
                usingMetrics: {
                    simulationRequested: new aws_cloudwatch.Metric({
                        namespace: 'Uniswap',
                        metricName: `Simulation Requested`,
                        dimensionsMap: { Service: 'RoutingAPI' },
                        unit: aws_cloudwatch.Unit.COUNT,
                        statistic: 'sum',
                    }),
                    simulationFailed: new aws_cloudwatch.Metric({
                        namespace: 'Uniswap',
                        metricName: `SimulationFailed`,
                        dimensionsMap: { Service: 'RoutingAPI' },
                        unit: aws_cloudwatch.Unit.COUNT,
                        statistic: 'sum',
                    }),
                },
            }),
            threshold: 75,
            evaluationPeriods: 3,
            treatMissingData: aws_cloudwatch.TreatMissingData.NOT_BREACHING, // Missing data points are treated as "good" and within the threshold
        });
        // Alarms for 200 rate being too low for each chain
        const percent2XXByChainAlarm = [];
        SUPPORTED_CHAINS.forEach((chainId) => {
            if (CHAINS_NOT_MONITORED.includes(chainId)) {
                return;
            }
            const alarmName = `RoutingAPI-SEV3-2XXAlarm-ChainId: ${chainId.toString()}`;
            const metric = new MathExpression({
                expression: '100*(response200/invocations)',
                period: Duration.minutes(30),
                usingMetrics: {
                    invocations: new aws_cloudwatch.Metric({
                        namespace: 'Uniswap',
                        metricName: `GET_QUOTE_REQUESTED_CHAINID: ${chainId.toString()}`,
                        dimensionsMap: { Service: 'RoutingAPI' },
                        unit: aws_cloudwatch.Unit.COUNT,
                        statistic: 'sum',
                    }),
                    response200: new aws_cloudwatch.Metric({
                        namespace: 'Uniswap',
                        metricName: `GET_QUOTE_200_CHAINID: ${chainId.toString()}`,
                        dimensionsMap: { Service: 'RoutingAPI' },
                        unit: aws_cloudwatch.Unit.COUNT,
                        statistic: 'sum',
                    }),
                },
            });
            const alarm = new aws_cloudwatch.Alarm(this, alarmName, {
                alarmName,
                metric,
                threshold: 20,
                evaluationPeriods: 2,
                comparisonOperator: aws_cloudwatch.ComparisonOperator.LESS_THAN_OR_EQUAL_TO_THRESHOLD,
            });
            percent2XXByChainAlarm.push(alarm);
        });
        // Alarms for high 400 error rate for each chain
        const percent4XXByChainAlarm = [];
        SUPPORTED_CHAINS.forEach((chainId) => {
            if (CHAINS_NOT_MONITORED.includes(chainId)) {
                return;
            }
            const alarmName = `RoutingAPI-SEV3-4XXAlarm-ChainId: ${chainId.toString()}`;
            const metric = new MathExpression({
                expression: '100*(response400/invocations)',
                usingMetrics: {
                    invocations: api.metric(`GET_QUOTE_REQUESTED_CHAINID: ${chainId.toString()}`, {
                        period: Duration.minutes(5),
                        statistic: 'sum',
                    }),
                    response400: api.metric(`GET_QUOTE_400_CHAINID: ${chainId.toString()}`, {
                        period: Duration.minutes(5),
                        statistic: 'sum',
                    }),
                },
            });
            const alarm = new aws_cloudwatch.Alarm(this, alarmName, {
                alarmName,
                metric,
                threshold: 80,
                evaluationPeriods: 2,
            });
            percent4XXByChainAlarm.push(alarm);
        });
        if (chatbotSNSArn) {
            const chatBotTopic = aws_sns.Topic.fromTopicArn(this, 'ChatbotTopic', chatbotSNSArn);
            apiAlarm5xxSev2.addAlarmAction(new aws_cloudwatch_actions.SnsAction(chatBotTopic));
            apiAlarm4xxSev2.addAlarmAction(new aws_cloudwatch_actions.SnsAction(chatBotTopic));
            apiAlarmLatencySev2.addAlarmAction(new aws_cloudwatch_actions.SnsAction(chatBotTopic));
            apiAlarm5xxSev3.addAlarmAction(new aws_cloudwatch_actions.SnsAction(chatBotTopic));
            apiAlarm4xxSev3.addAlarmAction(new aws_cloudwatch_actions.SnsAction(chatBotTopic));
            apiAlarmLatencySev3.addAlarmAction(new aws_cloudwatch_actions.SnsAction(chatBotTopic));
            simulationAlarmSev3.addAlarmAction(new aws_cloudwatch_actions.SnsAction(chatBotTopic));
            percent2XXByChainAlarm.forEach((alarm) => {
                alarm.addAlarmAction(new aws_cloudwatch_actions.SnsAction(chatBotTopic));
            });
            percent4XXByChainAlarm.forEach((alarm) => {
                alarm.addAlarmAction(new aws_cloudwatch_actions.SnsAction(chatBotTopic));
            });
        }
        this.url = new CfnOutput(this, 'Url', {
            value: api.url,
        });
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicm91dGluZy1hcGktc3RhY2suanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9iaW4vc3RhY2tzL3JvdXRpbmctYXBpLXN0YWNrLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLE9BQU8sRUFBRSxPQUFPLEVBQUUsZ0JBQWdCLEVBQUUsTUFBTSwrQkFBK0IsQ0FBQTtBQUN6RSxPQUFPLEtBQUssR0FBRyxNQUFNLGFBQWEsQ0FBQTtBQUNsQyxPQUFPLEVBQUUsU0FBUyxFQUFFLFFBQVEsRUFBRSxNQUFNLGFBQWEsQ0FBQTtBQUNqRCxPQUFPLEtBQUssY0FBYyxNQUFNLDRCQUE0QixDQUFBO0FBQzVELE9BQU8sRUFBRSxrQkFBa0IsRUFBRSxNQUFNLDRCQUE0QixDQUFBO0FBQy9ELE9BQU8sS0FBSyxjQUFjLE1BQU0sNEJBQTRCLENBQUE7QUFDNUQsT0FBTyxFQUFFLGNBQWMsRUFBRSxNQUFNLDRCQUE0QixDQUFBO0FBQzNELE9BQU8sS0FBSyxzQkFBc0IsTUFBTSxvQ0FBb0MsQ0FBQTtBQUM1RSxPQUFPLEtBQUssUUFBUSxNQUFNLHNCQUFzQixDQUFBO0FBQ2hELE9BQU8sS0FBSyxPQUFPLE1BQU0scUJBQXFCLENBQUE7QUFDOUMsT0FBTyxLQUFLLE9BQU8sTUFBTSx1QkFBdUIsQ0FBQTtBQUVoRCxPQUFPLEVBQUUsS0FBSyxFQUFFLE1BQU0sc0JBQXNCLENBQUE7QUFDNUMsT0FBTyxFQUFFLG1CQUFtQixFQUFFLE1BQU0seUJBQXlCLENBQUE7QUFDN0QsT0FBTyxFQUFFLHFCQUFxQixFQUFFLE1BQU0sMkJBQTJCLENBQUE7QUFDakUsT0FBTyxFQUFFLGtCQUFrQixFQUFFLE1BQU0sd0JBQXdCLENBQUE7QUFDM0QsT0FBTyxFQUFFLG9CQUFvQixFQUFFLE1BQU0sMEJBQTBCLENBQUE7QUFFL0QsTUFBTSxDQUFDLE1BQU0sb0JBQW9CLEdBQWM7SUFDN0MsT0FBTyxDQUFDLE9BQU87SUFDZixPQUFPLENBQUMsZ0JBQWdCO0lBQ3hC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Q0FBQyxLQUFLLEVBQUUsRUFBRTtnQkFDdkMsS0FBSyxDQUFDLGNBQWMsQ0FBQyxJQUFJLHNCQUFzQixDQUFDLFNBQVMsQ0FBQyxZQUFZLENBQUMsQ0FBQyxDQUFBO1lBQzFFLENBQUMsQ0FBQyxDQUFBO1NBQ0g7UUFFRCxJQUFJLENBQUMsR0FBRyxHQUFHLElBQUksU0FBUyxDQUFDLElBQUksRUFBRSxLQUFLLEVBQUU7WUFDcEMsS0FBSyxFQUFFLEdBQUcsQ0FBQyxHQUFHO1NBQ2YsQ0FBQyxDQUFBO0lBQ0osQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgQ2hhaW5JZCwgU1VQUE9SVEVEX0NIQUlOUyB9IGZyb20gJ0B0YXJ0ei1vbmUvc21hcnQtb3JkZXItcm91dGVyJ1xuaW1wb3J0ICogYXMgY2RrIGZyb20gJ2F3cy1jZGstbGliJ1xuaW1wb3J0IHsgQ2ZuT3V0cHV0LCBEdXJhdGlvbiB9IGZyb20gJ2F3cy1jZGstbGliJ1xuaW1wb3J0ICogYXMgYXdzX2FwaWdhdGV3YXkgZnJvbSAnYXdzLWNkay1saWIvYXdzLWFwaWdhdGV3YXknXG5pbXBvcnQgeyBNZXRob2RMb2dnaW5nTGV2ZWwgfSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtYXBpZ2F0ZXdheSdcbmltcG9ydCAqIGFzIGF3c19jbG91ZHdhdGNoIGZyb20gJ2F3cy1jZGstbGliL2F3cy1jbG91ZHdhdGNoJ1xuaW1wb3J0IHsgTWF0aEV4cHJlc3Npb24gfSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtY2xvdWR3YXRjaCdcbmltcG9ydCAqIGFzIGF3c19jbG91ZHdhdGNoX2FjdGlvbnMgZnJvbSAnYXdzLWNkay1saWIvYXdzLWNsb3Vkd2F0Y2gtYWN0aW9ucydcbmltcG9ydCAqIGFzIGF3c19sb2dzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1sb2dzJ1xuaW1wb3J0ICogYXMgYXdzX3NucyBmcm9tICdhd3MtY2RrLWxpYi9hd3Mtc25zJ1xuaW1wb3J0ICogYXMgYXdzX3dhZiBmcm9tICdhd3MtY2RrLWxpYi9hd3Mtd2FmdjInXG5pbXBvcnQgeyBDb25zdHJ1Y3QgfSBmcm9tICdjb25zdHJ1Y3RzJ1xuaW1wb3J0IHsgU1RBR0UgfSBmcm9tICcuLi8uLi9saWIvdXRpbC9zdGFnZSdcbmltcG9ydCB7IFJvdXRpbmdDYWNoaW5nU3RhY2sgfSBmcm9tICcuL3JvdXRpbmctY2FjaGluZy1zdGFjaydcbmltcG9ydCB7IFJvdXRpbmdEYXNoYm9hcmRTdGFjayB9IGZyb20gJy4vcm91dGluZy1kYXNoYm9hcmQtc3RhY2snXG5pbXBvcnQgeyBSb3V0aW5nTGFtYmRhU3RhY2sgfSBmcm9tICcuL3JvdXRpbmctbGFtYmRhLXN0YWNrJ1xuaW1wb3J0IHsgUm91dGluZ0RhdGFiYXNlU3RhY2sgfSBmcm9tICcuL3JvdXRpbmctZGF0YWJhc2Utc3RhY2snXG5cbmV4cG9ydCBjb25zdCBDSEFJTlNfTk9UX01PTklUT1JFRDogQ2hhaW5JZFtdID0gW1xuICBDaGFpbklkLlJJTktFQlksXG4gIENoYWluSWQuQVJCSVRSVU1fUklOS0VCWSxcbiAgQ2hhaW5JZC5ST1BTVEVOLFxuICBDaGFpbklkLktPVkFOLFxuICBDaGFpbklkLk9QVElNSVNUSUNfS09WQU4sXG4gIENoYWluSWQuR8OWUkxJLFxuICBDaGFpbklkLlBPTFlHT05fTVVNQkFJLFxuXVxuXG5leHBvcnQgY2xhc3MgUm91dGluZ0FQSVN0YWNrIGV4dGVuZHMgY2RrLlN0YWNrIHtcbiAgcHVibGljIHJlYWRvbmx5IHVybDogQ2ZuT3V0cHV0XG5cbiAgY29uc3RydWN0b3IoXG4gICAgcGFyZW50OiBDb25zdHJ1Y3QsXG4gICAgbmFtZTogc3RyaW5nLFxuICAgIHByb3BzOiBjZGsuU3RhY2tQcm9wcyAmIHtcbiAgICAgIGpzb25ScGNQcm92aWRlcnM6IHsgW2NoYWluTmFtZTogc3RyaW5nXTogc3RyaW5nIH1cbiAgICAgIHByb3Zpc2lvbmVkQ29uY3VycmVuY3k6IG51bWJlclxuICAgICAgdGhyb3R0bGluZ092ZXJyaWRlPzogc3RyaW5nXG4gICAgICBldGhHYXNTdGF0aW9uSW5mb1VybDogc3RyaW5nXG4gICAgICBjaGF0Ym90U05TQXJuPzogc3RyaW5nXG4gICAgICBzdGFnZTogc3RyaW5nXG4gICAgICByb3V0ZTUzQXJuPzogc3RyaW5nXG4gICAgICBwaW5hdGFfa2V5Pzogc3RyaW5nXG4gICAgICBwaW5hdGFfc2VjcmV0Pzogc3RyaW5nXG4gICAgICBob3N0ZWRfem9uZT86IHN0cmluZ1xuICAgICAgdGVuZGVybHlVc2VyOiBzdHJpbmdcbiAgICAgIHRlbmRlcmx5UHJvamVjdDogc3RyaW5nXG4gICAgICB0ZW5kZXJseUFjY2Vzc0tleTogc3RyaW5nXG4gICAgfVxuICApIHtcbiAgICBzdXBlcihwYXJlbnQsIG5hbWUsIHByb3BzKVxuXG4gICAgY29uc3Qge1xuICAgICAganNvblJwY1Byb3ZpZGVycyxcbiAgICAgIHByb3Zpc2lvbmVkQ29uY3VycmVuY3ksXG4gICAgICB0aHJvdHRsaW5nT3ZlcnJpZGUsXG4gICAgICBldGhHYXNTdGF0aW9uSW5mb1VybCxcbiAgICAgIGNoYXRib3RTTlNBcm4sXG4gICAgICBzdGFnZSxcbiAgICAgIHJvdXRlNTNBcm4sXG4gICAgICBwaW5hdGFfa2V5LFxuICAgICAgcGluYXRhX3NlY3JldCxcbiAgICAgIGhvc3RlZF96b25lLFxuICAgICAgdGVuZGVybHlVc2VyLFxuICAgICAgdGVuZGVybHlQcm9qZWN0LFxuICAgICAgdGVuZGVybHlBY2Nlc3NLZXksXG4gICAgfSA9IHByb3BzXG5cbiAgICBjb25zdCB7XG4gICAgICBwb29sQ2FjaGVCdWNrZXQsXG4gICAgICBwb29sQ2FjaGVCdWNrZXQyLFxuICAgICAgcG9vbENhY2hlS2V5LFxuICAgICAgcG9vbENhY2hlTGFtYmRhTmFtZUFycmF5LFxuICAgICAgdG9rZW5MaXN0Q2FjaGVCdWNrZXQsXG4gICAgICBpcGZzUG9vbENhY2hpbmdMYW1iZGEsXG4gICAgfSA9IG5ldyBSb3V0aW5nQ2FjaGluZ1N0YWNrKHRoaXMsICdSb3V0aW5nQ2FjaGluZ1N0YWNrJywge1xuICAgICAgY2hhdGJvdFNOU0FybixcbiAgICAgIHN0YWdlLFxuICAgICAgcm91dGU1M0FybixcbiAgICAgIHBpbmF0YV9rZXksXG4gICAgICBwaW5hdGFfc2VjcmV0LFxuICAgICAgaG9zdGVkX3pvbmUsXG4gICAgfSlcblxuICAgIGNvbnN0IHsgY2FjaGVkUm91dGVzRHluYW1vRGIgfSA9IG5ldyBSb3V0aW5nRGF0YWJhc2VTdGFjayh0aGlzLCAnUm91dGluZ0RhdGFiYXNlU3RhY2snLCB7fSlcblxuICAgIGNvbnN0IHsgcm91dGluZ0xhbWJkYSwgcm91dGluZ0xhbWJkYUFsaWFzLCByb3V0ZVRvUmF0aW9MYW1iZGEgfSA9IG5ldyBSb3V0aW5nTGFtYmRhU3RhY2soXG4gICAgICB0aGlzLFxuICAgICAgJ1JvdXRpbmdMYW1iZGFTdGFjaycsXG4gICAgICB7XG4gICAgICAgIHBvb2xDYWNoZUJ1Y2tldCxcbiAgICAgICAgcG9vbENhY2hlQnVja2V0MixcbiAgICAgICAgcG9vbENhY2hlS2V5LFxuICAgICAgICBqc29uUnBjUHJvdmlkZXJzLFxuICAgICAgICB0b2tlbkxpc3RDYWNoZUJ1Y2tldCxcbiAgICAgICAgcHJvdmlzaW9uZWRDb25jdXJyZW5jeSxcbiAgICAgICAgZXRoR2FzU3RhdGlvbkluZm9VcmwsXG4gICAgICAgIGNoYXRib3RTTlNBcm4sXG4gICAgICAgIHRlbmRlcmx5VXNlcixcbiAgICAgICAgdGVuZGVybHlQcm9qZWN0LFxuICAgICAgICB0ZW5kZXJseUFjY2Vzc0tleSxcbiAgICAgICAgY2FjaGVkUm91dGVzRHluYW1vRGIsXG4gICAgICB9XG4gICAgKVxuXG4gICAgY29uc3QgYWNjZXNzTG9nR3JvdXAgPSBuZXcgYXdzX2xvZ3MuTG9nR3JvdXAodGhpcywgJ1JvdXRpbmdBUElHQWNjZXNzTG9ncycpXG5cbiAgICBjb25zdCBhcGkgPSBuZXcgYXdzX2FwaWdhdGV3YXkuUmVzdEFwaSh0aGlzLCAncm91dGluZy1hcGknLCB7XG4gICAgICByZXN0QXBpTmFtZTogJ1JvdXRpbmcgQVBJJyxcbiAgICAgIGRlcGxveU9wdGlvbnM6IHtcbiAgICAgICAgdHJhY2luZ0VuYWJsZWQ6IHRydWUsXG4gICAgICAgIGxvZ2dpbmdMZXZlbDogTWV0aG9kTG9nZ2luZ0xldmVsLkVSUk9SLFxuICAgICAgICBhY2Nlc3NMb2dEZXN0aW5hdGlvbjogbmV3IGF3c19hcGlnYXRld2F5LkxvZ0dyb3VwTG9nRGVzdGluYXRpb24oYWNjZXNzTG9nR3JvdXApLFxuICAgICAgICBhY2Nlc3NMb2dGb3JtYXQ6IGF3c19hcGlnYXRld2F5LkFjY2Vzc0xvZ0Zvcm1hdC5qc29uV2l0aFN0YW5kYXJkRmllbGRzKHtcbiAgICAgICAgICBpcDogZmFsc2UsXG4gICAgICAgICAgY2FsbGVyOiBmYWxzZSxcbiAgICAgICAgICB1c2VyOiBmYWxzZSxcbiAgICAgICAgICByZXF1ZXN0VGltZTogdHJ1ZSxcbiAgICAgICAgICBodHRwTWV0aG9kOiB0cnVlLFxuICAgICAgICAgIHJlc291cmNlUGF0aDogdHJ1ZSxcbiAgICAgICAgICBzdGF0dXM6IHRydWUsXG4gICAgICAgICAgcHJvdG9jb2w6IHRydWUsXG4gICAgICAgICAgcmVzcG9uc2VMZW5ndGg6IHRydWUsXG4gICAgICAgIH0pLFxuICAgICAgfSxcbiAgICAgIGRlZmF1bHRDb3JzUHJlZmxpZ2h0T3B0aW9uczoge1xuICAgICAgICBhbGxvd09yaWdpbnM6IGF3c19hcGlnYXRld2F5LkNvcnMuQUxMX09SSUdJTlMsXG4gICAgICAgIGFsbG93TWV0aG9kczogYXdzX2FwaWdhdGV3YXkuQ29ycy5BTExfTUVUSE9EUyxcbiAgICAgIH0sXG4gICAgfSlcblxuICAgIGNvbnN0IGlwVGhyb3R0bGluZ0FDTCA9IG5ldyBhd3Nfd2FmLkNmbldlYkFDTCh0aGlzLCAnUm91dGluZ0FQSUlQVGhyb3R0bGluZ0FDTCcsIHtcbiAgICAgIGRlZmF1bHRBY3Rpb246IHsgYWxsb3c6IHt9IH0sXG4gICAgICBzY29wZTogJ1JFR0lPTkFMJyxcbiAgICAgIHZpc2liaWxpdHlDb25maWc6IHtcbiAgICAgICAgc2FtcGxlZFJlcXVlc3RzRW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgY2xvdWRXYXRjaE1ldHJpY3NFbmFibGVkOiB0cnVlLFxuICAgICAgICBtZXRyaWNOYW1lOiAnUm91dGluZ0FQSUlQQmFzZWRUaHJvdHRsaW5nJyxcbiAgICAgIH0sXG4gICAgICBjdXN0b21SZXNwb25zZUJvZGllczoge1xuICAgICAgICBSb3V0aW5nQVBJVGhyb3R0bGVkUmVzcG9uc2VCb2R5OiB7XG4gICAgICAgICAgY29udGVudFR5cGU6ICdBUFBMSUNBVElPTl9KU09OJyxcbiAgICAgICAgICBjb250ZW50OiAne1wiZXJyb3JDb2RlXCI6IFwiVE9PX01BTllfUkVRVUVTVFNcIn0nLFxuICAgICAgICB9LFxuICAgICAgfSxcbiAgICAgIG5hbWU6ICdSb3V0aW5nQVBJSVBUaHJvdHRsaW5nJyxcbiAgICAgIHJ1bGVzOiBbXG4gICAgICAgIHtcbiAgICAgICAgICBuYW1lOiAnaXAnLFxuICAgICAgICAgIHByaW9yaXR5OiAwLFxuICAgICAgICAgIHN0YXRlbWVudDoge1xuICAgICAgICAgICAgcmF0ZUJhc2VkU3RhdGVtZW50OiB7XG4gICAgICAgICAgICAgIC8vIExpbWl0IGlzIHBlciA1IG1pbnMsIGkuZS4gMTIwIHJlcXVlc3RzIGV2ZXJ5IDUgbWluc1xuICAgICAgICAgICAgICBsaW1pdDogdGhyb3R0bGluZ092ZXJyaWRlID8gcGFyc2VJbnQodGhyb3R0bGluZ092ZXJyaWRlKSA6IDEyMCxcbiAgICAgICAgICAgICAgLy8gQVBJIGlzIG9mIHR5cGUgRURHRSBzbyBpcyBmcm9udGVkIGJ5IENsb3VkZnJvbnQgYXMgYSBwcm94eS5cbiAgICAgICAgICAgICAgLy8gVXNlIHRoZSBpcCBzZXQgaW4gWC1Gb3J3YXJkZWQtRm9yIGJ5IENsb3VkZnJvbnQsIG5vdCB0aGUgcmVndWxhciBJUFxuICAgICAgICAgICAgICAvLyB3aGljaCB3b3VsZCBqdXN0IHJlc29sdmUgdG8gQ2xvdWRmcm9udHMgSVAuXG4gICAgICAgICAgICAgIGFnZ3JlZ2F0ZUtleVR5cGU6ICdGT1JXQVJERURfSVAnLFxuICAgICAgICAgICAgICBmb3J3YXJkZWRJcENvbmZpZzoge1xuICAgICAgICAgICAgICAgIGhlYWRlck5hbWU6ICdYLUZvcndhcmRlZC1Gb3InLFxuICAgICAgICAgICAgICAgIGZhbGxiYWNrQmVoYXZpb3I6ICdNQVRDSCcsXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIH0sXG4gICAgICAgICAgYWN0aW9uOiB7XG4gICAgICAgICAgICBibG9jazoge1xuICAgICAgICAgICAgICBjdXN0b21SZXNwb25zZToge1xuICAgICAgICAgICAgICAgIHJlc3BvbnNlQ29kZTogNDI5LFxuICAgICAgICAgICAgICAgIGN1c3RvbVJlc3BvbnNlQm9keUtleTogJ1JvdXRpbmdBUElUaHJvdHRsZWRSZXNwb25zZUJvZHknLFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICB9LFxuICAgICAgICAgIHZpc2liaWxpdHlDb25maWc6IHtcbiAgICAgICAgICAgIHNhbXBsZWRSZXF1ZXN0c0VuYWJsZWQ6IHRydWUsXG4gICAgICAgICAgICBjbG91ZFdhdGNoTWV0cmljc0VuYWJsZWQ6IHRydWUsXG4gICAgICAgICAgICBtZXRyaWNOYW1lOiAnUm91dGluZ0FQSUlQQmFzZWRUaHJvdHRsaW5nUnVsZScsXG4gICAgICAgICAgfSxcbiAgICAgICAgfSxcbiAgICAgIF0sXG4gICAgfSlcblxuICAgIGNvbnN0IHJlZ2lvbiA9IGNkay5TdGFjay5vZih0aGlzKS5yZWdpb25cbiAgICBjb25zdCBhcGlBcm4gPSBgYXJuOmF3czphcGlnYXRld2F5OiR7cmVnaW9ufTo6L3Jlc3RhcGlzLyR7YXBpLnJlc3RBcGlJZH0vc3RhZ2VzLyR7YXBpLmRlcGxveW1lbnRTdGFnZS5zdGFnZU5hbWV9YFxuXG4gICAgbmV3IGF3c193YWYuQ2ZuV2ViQUNMQXNzb2NpYXRpb24odGhpcywgJ1JvdXRpbmdBUElJUFRocm90dGxpbmdBc3NvY2lhdGlvbicsIHtcbiAgICAgIHJlc291cmNlQXJuOiBhcGlBcm4sXG4gICAgICB3ZWJBY2xBcm46IGlwVGhyb3R0bGluZ0FDTC5nZXRBdHQoJ0FybicpLnRvU3RyaW5nKCksXG4gICAgfSlcblxuICAgIG5ldyBSb3V0aW5nRGFzaGJvYXJkU3RhY2sodGhpcywgJ1JvdXRpbmdEYXNoYm9hcmRTdGFjaycsIHtcbiAgICAgIGFwaU5hbWU6IGFwaS5yZXN0QXBpTmFtZSxcbiAgICAgIHJvdXRpbmdMYW1iZGFOYW1lOiByb3V0aW5nTGFtYmRhLmZ1bmN0aW9uTmFtZSxcbiAgICAgIHBvb2xDYWNoZUxhbWJkYU5hbWVBcnJheSxcbiAgICAgIGlwZnNQb29sQ2FjaGVMYW1iZGFOYW1lOiBpcGZzUG9vbENhY2hpbmdMYW1iZGEgPyBpcGZzUG9vbENhY2hpbmdMYW1iZGEuZnVuY3Rpb25OYW1lIDogdW5kZWZpbmVkLFxuICAgIH0pXG5cbiAgICBjb25zdCBsYW1iZGFJbnRlZ3JhdGlvbiA9IG5ldyBhd3NfYXBpZ2F0ZXdheS5MYW1iZGFJbnRlZ3JhdGlvbihyb3V0aW5nTGFtYmRhQWxpYXMpXG5cbiAgICBjb25zdCBxdW90ZSA9IGFwaS5yb290LmFkZFJlc291cmNlKCdxdW90ZScsIHtcbiAgICAgIGRlZmF1bHRDb3JzUHJlZmxpZ2h0T3B0aW9uczoge1xuICAgICAgICBhbGxvd09yaWdpbnM6IGF3c19hcGlnYXRld2F5LkNvcnMuQUxMX09SSUdJTlMsXG4gICAgICAgIGFsbG93TWV0aG9kczogYXdzX2FwaWdhdGV3YXkuQ29ycy5BTExfTUVUSE9EUyxcbiAgICAgIH0sXG4gICAgfSlcbiAgICBxdW90ZS5hZGRNZXRob2QoJ0dFVCcsIGxhbWJkYUludGVncmF0aW9uKVxuXG4gICAgY29uc3Qgcm91dGVUb1JhdGlvTGFtYmRhSW50ZWdyYXRpb24gPSBuZXcgYXdzX2FwaWdhdGV3YXkuTGFtYmRhSW50ZWdyYXRpb24ocm91dGVUb1JhdGlvTGFtYmRhKVxuXG4gICAgY29uc3QgcXVvdGVUb1JhdGlvID0gYXBpLnJvb3QuYWRkUmVzb3VyY2UoJ3F1b3RlVG9SYXRpbycsIHtcbiAgICAgIGRlZmF1bHRDb3JzUHJlZmxpZ2h0T3B0aW9uczoge1xuICAgICAgICBhbGxvd09yaWdpbnM6IGF3c19hcGlnYXRld2F5LkNvcnMuQUxMX09SSUdJTlMsXG4gICAgICAgIGFsbG93TWV0aG9kczogYXdzX2FwaWdhdGV3YXkuQ29ycy5BTExfTUVUSE9EUyxcbiAgICAgIH0sXG4gICAgfSlcbiAgICBxdW90ZVRvUmF0aW8uYWRkTWV0aG9kKCdHRVQnLCByb3V0ZVRvUmF0aW9MYW1iZGFJbnRlZ3JhdGlvbilcblxuICAgIC8vIEFsbCBhbGFybXMgZGVmYXVsdCB0byBHcmVhdGVyVGhhbk9yRXF1YWxUb1RocmVzaG9sZCBmb3Igd2hlbiB0byBiZSB0cmlnZ2VyZWQuXG4gICAgY29uc3QgYXBpQWxhcm01eHhTZXYyID0gbmV3IGF3c19jbG91ZHdhdGNoLkFsYXJtKHRoaXMsICdSb3V0aW5nQVBJLVNFVjItNVhYQWxhcm0nLCB7XG4gICAgICBhbGFybU5hbWU6ICdSb3V0aW5nQVBJLVNFVjItNVhYJyxcbiAgICAgIG1ldHJpYzogYXBpLm1ldHJpY1NlcnZlckVycm9yKHtcbiAgICAgICAgcGVyaW9kOiBEdXJhdGlvbi5taW51dGVzKDUpLFxuICAgICAgICAvLyBGb3IgdGhpcyBtZXRyaWMgJ2F2ZycgcmVwcmVzZW50cyBlcnJvciByYXRlLlxuICAgICAgICBzdGF0aXN0aWM6ICdhdmcnLFxuICAgICAgfSksXG4gICAgICB0aHJlc2hvbGQ6IDAuMDUsXG4gICAgICAvLyBCZXRhIGhhcyBtdWNoIGxlc3MgdHJhZmZpYyBzbyBpcyBtb3JlIHN1c2NlcHRpYmxlIHRvIHRyYW5zaWVudCBlcnJvcnMuXG4gICAgICBldmFsdWF0aW9uUGVyaW9kczogc3RhZ2UgPT0gU1RBR0UuQkVUQSA/IDUgOiAzLFxuICAgIH0pXG5cbiAgICBjb25zdCBhcGlBbGFybTR4eFNldjIgPSBuZXcgYXdzX2Nsb3Vkd2F0Y2guQWxhcm0odGhpcywgJ1JvdXRpbmdBUEktU0VWMi00WFhBbGFybScsIHtcbiAgICAgIGFsYXJtTmFtZTogJ1JvdXRpbmdBUEktU0VWMi00WFgnLFxuICAgICAgbWV0cmljOiBhcGkubWV0cmljQ2xpZW50RXJyb3Ioe1xuICAgICAgICBwZXJpb2Q6IER1cmF0aW9uLm1pbnV0ZXMoNSksXG4gICAgICAgIHN0YXRpc3RpYzogJ2F2ZycsXG4gICAgICB9KSxcbiAgICAgIHRocmVzaG9sZDogMC45NSxcbiAgICAgIGV2YWx1YXRpb25QZXJpb2RzOiAzLFxuICAgIH0pXG5cbiAgICBjb25zdCBhcGlBbGFybUxhdGVuY3lTZXYyID0gbmV3IGF3c19jbG91ZHdhdGNoLkFsYXJtKHRoaXMsICdSb3V0aW5nQVBJLVNFVjItTGF0ZW5jeScsIHtcbiAgICAgIGFsYXJtTmFtZTogJ1JvdXRpbmdBUEktU0VWMi1MYXRlbmN5JyxcbiAgICAgIG1ldHJpYzogYXBpLm1ldHJpY0xhdGVuY3koe1xuICAgICAgICBwZXJpb2Q6IER1cmF0aW9uLm1pbnV0ZXMoNSksXG4gICAgICAgIHN0YXRpc3RpYzogJ3A5MCcsXG4gICAgICB9KSxcbiAgICAgIHRocmVzaG9sZDogODUwMCxcbiAgICAgIGV2YWx1YXRpb25QZXJpb2RzOiAzLFxuICAgIH0pXG5cbiAgICBjb25zdCBhcGlBbGFybTV4eFNldjMgPSBuZXcgYXdzX2Nsb3Vkd2F0Y2guQWxhcm0odGhpcywgJ1JvdXRpbmdBUEktU0VWMy01WFhBbGFybScsIHtcbiAgICAgIGFsYXJtTmFtZTogJ1JvdXRpbmdBUEktU0VWMy01WFgnLFxuICAgICAgbWV0cmljOiBhcGkubWV0cmljU2VydmVyRXJyb3Ioe1xuICAgICAgICBwZXJpb2Q6IER1cmF0aW9uLm1pbnV0ZXMoNSksXG4gICAgICAgIC8vIEZvciB0aGlzIG1ldHJpYyAnYXZnJyByZXByZXNlbnRzIGVycm9yIHJhdGUuXG4gICAgICAgIHN0YXRpc3RpYzogJ2F2ZycsXG4gICAgICB9KSxcbiAgICAgIHRocmVzaG9sZDogMC4wMyxcbiAgICAgIC8vIEJldGEgaGFzIG11Y2ggbGVzcyB0cmFmZmljIHNvIGlzIG1vcmUgc3VzY2VwdGlibGUgdG8gdHJhbnNpZW50IGVycm9ycy5cbiAgICAgIGV2YWx1YXRpb25QZXJpb2RzOiBzdGFnZSA9PSBTVEFHRS5CRVRBID8gNSA6IDMsXG4gICAgfSlcblxuICAgIGNvbnN0IGFwaUFsYXJtNHh4U2V2MyA9IG5ldyBhd3NfY2xvdWR3YXRjaC5BbGFybSh0aGlzLCAnUm91dGluZ0FQSS1TRVYzLTRYWEFsYXJtJywge1xuICAgICAgYWxhcm1OYW1lOiAnUm91dGluZ0FQSS1TRVYzLTRYWCcsXG4gICAgICBtZXRyaWM6IGFwaS5tZXRyaWNDbGllbnRFcnJvcih7XG4gICAgICAgIHBlcmlvZDogRHVyYXRpb24ubWludXRlcyg1KSxcbiAgICAgICAgc3RhdGlzdGljOiAnYXZnJyxcbiAgICAgIH0pLFxuICAgICAgdGhyZXNob2xkOiAwLjgsXG4gICAgICBldmFsdWF0aW9uUGVyaW9kczogMyxcbiAgICB9KVxuXG4gICAgY29uc3QgYXBpQWxhcm1MYXRlbmN5U2V2MyA9IG5ldyBhd3NfY2xvdWR3YXRjaC5BbGFybSh0aGlzLCAnUm91dGluZ0FQSS1TRVYzLUxhdGVuY3knLCB7XG4gICAgICBhbGFybU5hbWU6ICdSb3V0aW5nQVBJLVNFVjMtTGF0ZW5jeScsXG4gICAgICBtZXRyaWM6IGFwaS5tZXRyaWNMYXRlbmN5KHtcbiAgICAgICAgcGVyaW9kOiBEdXJhdGlvbi5taW51dGVzKDUpLFxuICAgICAgICBzdGF0aXN0aWM6ICdwOTAnLFxuICAgICAgfSksXG4gICAgICB0aHJlc2hvbGQ6IDU1MDAsXG4gICAgICBldmFsdWF0aW9uUGVyaW9kczogMyxcbiAgICB9KVxuXG4gICAgLy8gU2ltdWxhdGlvbnMgY2FuIGZhaWwgZm9yIHZhbGlkIHJlYXNvbnMuIEZvciBleGFtcGxlLCBpZiB0aGUgc2ltdWxhdGlvbiByZXZlcnRzIGR1ZVxuICAgIC8vIHRvIHNsaXBwYWdlIGNoZWNrcyAoY2FuIGhhcHBlbiB3aXRoIEZPVCB0b2tlbnMgc29tZXRpbWVzIHNpbmNlIG91ciBxdW90ZXIgZG9lcyBub3RcbiAgICAvLyBhY2NvdW50IGZvciB0aGUgZmVlcyB0YWtlbiBkdXJpbmcgdHJhbnNmZXIgd2hlbiB3ZSBzaG93IHRoZSB1c2VyIHRoZSBxdW90ZSkuXG4gICAgLy9cbiAgICAvLyBGb3IgdGhpcyByZWFzb24gd2Ugb25seSBhbGVydCBvbiBTRVYzIHRvIGF2b2lkIHVubmVjZXNzYXJ5IHBhZ2VzLlxuICAgIGNvbnN0IHNpbXVsYXRpb25BbGFybVNldjMgPSBuZXcgYXdzX2Nsb3Vkd2F0Y2guQWxhcm0odGhpcywgJ1JvdXRpbmdBUEktU0VWMy1TaW11bGF0aW9uJywge1xuICAgICAgYWxhcm1OYW1lOiAnUm91dGluZ0FQSS1TRVYzLVNpbXVsYXRpb24nLFxuICAgICAgbWV0cmljOiBuZXcgTWF0aEV4cHJlc3Npb24oe1xuICAgICAgICBleHByZXNzaW9uOiAnMTAwKihzaW11bGF0aW9uRmFpbGVkL3NpbXVsYXRpb25SZXF1ZXN0ZWQpJyxcbiAgICAgICAgcGVyaW9kOiBEdXJhdGlvbi5taW51dGVzKDMwKSxcbiAgICAgICAgdXNpbmdNZXRyaWNzOiB7XG4gICAgICAgICAgc2ltdWxhdGlvblJlcXVlc3RlZDogbmV3IGF3c19jbG91ZHdhdGNoLk1ldHJpYyh7XG4gICAgICAgICAgICBuYW1lc3BhY2U6ICdVbmlzd2FwJyxcbiAgICAgICAgICAgIG1ldHJpY05hbWU6IGBTaW11bGF0aW9uIFJlcXVlc3RlZGAsXG4gICAgICAgICAgICBkaW1lbnNpb25zTWFwOiB7IFNlcnZpY2U6ICdSb3V0aW5nQVBJJyB9LFxuICAgICAgICAgICAgdW5pdDogYXdzX2Nsb3Vkd2F0Y2guVW5pdC5DT1VOVCxcbiAgICAgICAgICAgIHN0YXRpc3RpYzogJ3N1bScsXG4gICAgICAgICAgfSksXG4gICAgICAgICAgc2ltdWxhdGlvbkZhaWxlZDogbmV3IGF3c19jbG91ZHdhdGNoLk1ldHJpYyh7XG4gICAgICAgICAgICBuYW1lc3BhY2U6ICdVbmlzd2FwJyxcbiAgICAgICAgICAgIG1ldHJpY05hbWU6IGBTaW11bGF0aW9uRmFpbGVkYCxcbiAgICAgICAgICAgIGRpbWVuc2lvbnNNYXA6IHsgU2VydmljZTogJ1JvdXRpbmdBUEknIH0sXG4gICAgICAgICAgICB1bml0OiBhd3NfY2xvdWR3YXRjaC5Vbml0LkNPVU5ULFxuICAgICAgICAgICAgc3RhdGlzdGljOiAnc3VtJyxcbiAgICAgICAgICB9KSxcbiAgICAgICAgfSxcbiAgICAgIH0pLFxuICAgICAgdGhyZXNob2xkOiA3NSxcbiAgICAgIGV2YWx1YXRpb25QZXJpb2RzOiAzLFxuICAgICAgdHJlYXRNaXNzaW5nRGF0YTogYXdzX2Nsb3Vkd2F0Y2guVHJlYXRNaXNzaW5nRGF0YS5OT1RfQlJFQUNISU5HLCAvLyBNaXNzaW5nIGRhdGEgcG9pbnRzIGFyZSB0cmVhdGVkIGFzIFwiZ29vZFwiIGFuZCB3aXRoaW4gdGhlIHRocmVzaG9sZFxuICAgIH0pXG5cbiAgICAvLyBBbGFybXMgZm9yIDIwMCByYXRlIGJlaW5nIHRvbyBsb3cgZm9yIGVhY2ggY2hhaW5cbiAgICBjb25zdCBwZXJjZW50MlhYQnlDaGFpbkFsYXJtOiBjZGsuYXdzX2Nsb3Vkd2F0Y2guQWxhcm1bXSA9IFtdXG4gICAgU1VQUE9SVEVEX0NIQUlOUy5mb3JFYWNoKChjaGFpbklkKSA9PiB7XG4gICAgICBpZiAoQ0hBSU5TX05PVF9NT05JVE9SRUQuaW5jbHVkZXMoY2hhaW5JZCkpIHtcbiAgICAgICAgcmV0dXJuXG4gICAgICB9XG4gICAgICBjb25zdCBhbGFybU5hbWUgPSBgUm91dGluZ0FQSS1TRVYzLTJYWEFsYXJtLUNoYWluSWQ6ICR7Y2hhaW5JZC50b1N0cmluZygpfWBcbiAgICAgIGNvbnN0IG1ldHJpYyA9IG5ldyBNYXRoRXhwcmVzc2lvbih7XG4gICAgICAgIGV4cHJlc3Npb246ICcxMDAqKHJlc3BvbnNlMjAwL2ludm9jYXRpb25zKScsXG4gICAgICAgIHBlcmlvZDogRHVyYXRpb24ubWludXRlcygzMCksXG4gICAgICAgIHVzaW5nTWV0cmljczoge1xuICAgICAgICAgIGludm9jYXRpb25zOiBuZXcgYXdzX2Nsb3Vkd2F0Y2guTWV0cmljKHtcbiAgICAgICAgICAgIG5hbWVzcGFjZTogJ1VuaXN3YXAnLFxuICAgICAgICAgICAgbWV0cmljTmFtZTogYEdFVF9RVU9URV9SRVFVRVNURURfQ0hBSU5JRDogJHtjaGFpbklkLnRvU3RyaW5nKCl9YCxcbiAgICAgICAgICAgIGRpbWVuc2lvbnNNYXA6IHsgU2VydmljZTogJ1JvdXRpbmdBUEknIH0sXG4gICAgICAgICAgICB1bml0OiBhd3NfY2xvdWR3YXRjaC5Vbml0LkNPVU5ULFxuICAgICAgICAgICAgc3RhdGlzdGljOiAnc3VtJyxcbiAgICAgICAgICB9KSxcbiAgICAgICAgICByZXNwb25zZTIwMDogbmV3IGF3c19jbG91ZHdhdGNoLk1ldHJpYyh7XG4gICAgICAgICAgICBuYW1lc3BhY2U6ICdVbmlzd2FwJyxcbiAgICAgICAgICAgIG1ldHJpY05hbWU6IGBHRVRfUVVPVEVfMjAwX0NIQUlOSUQ6ICR7Y2hhaW5JZC50b1N0cmluZygpfWAsXG4gICAgICAgICAgICBkaW1lbnNpb25zTWFwOiB7IFNlcnZpY2U6ICdSb3V0aW5nQVBJJyB9LFxuICAgICAgICAgICAgdW5pdDogYXdzX2Nsb3Vkd2F0Y2guVW5pdC5DT1VOVCxcbiAgICAgICAgICAgIHN0YXRpc3RpYzogJ3N1bScsXG4gICAgICAgICAgfSksXG4gICAgICAgIH0sXG4gICAgICB9KVxuICAgICAgY29uc3QgYWxhcm0gPSBuZXcgYXdzX2Nsb3Vkd2F0Y2guQWxhcm0odGhpcywgYWxhcm1OYW1lLCB7XG4gICAgICAgIGFsYXJtTmFtZSxcbiAgICAgICAgbWV0cmljLFxuICAgICAgICB0aHJlc2hvbGQ6IDIwLFxuICAgICAgICBldmFsdWF0aW9uUGVyaW9kczogMixcbiAgICAgICAgY29tcGFyaXNvbk9wZXJhdG9yOiBhd3NfY2xvdWR3YXRjaC5Db21wYXJpc29uT3BlcmF0b3IuTEVTU19USEFOX09SX0VRVUFMX1RPX1RIUkVTSE9MRCxcbiAgICAgIH0pXG4gICAgICBwZXJjZW50MlhYQnlDaGFpbkFsYXJtLnB1c2goYWxhcm0pXG4gICAgfSlcblxuICAgIC8vIEFsYXJtcyBmb3IgaGlnaCA0MDAgZXJyb3IgcmF0ZSBmb3IgZWFjaCBjaGFpblxuICAgIGNvbnN0IHBlcmNlbnQ0WFhCeUNoYWluQWxhcm06IGNkay5hd3NfY2xvdWR3YXRjaC5BbGFybVtdID0gW11cbiAgICBTVVBQT1JURURfQ0hBSU5TLmZvckVhY2goKGNoYWluSWQpID0+IHtcbiAgICAgIGlmIChDSEFJTlNfTk9UX01PTklUT1JFRC5pbmNsdWRlcyhjaGFpbklkKSkge1xuICAgICAgICByZXR1cm5cbiAgICAgIH1cbiAgICAgIGNvbnN0IGFsYXJtTmFtZSA9IGBSb3V0aW5nQVBJLVNFVjMtNFhYQWxhcm0tQ2hhaW5JZDogJHtjaGFpbklkLnRvU3RyaW5nKCl9YFxuICAgICAgY29uc3QgbWV0cmljID0gbmV3IE1hdGhFeHByZXNzaW9uKHtcbiAgICAgICAgZXhwcmVzc2lvbjogJzEwMCoocmVzcG9uc2U0MDAvaW52b2NhdGlvbnMpJyxcbiAgICAgICAgdXNpbmdNZXRyaWNzOiB7XG4gICAgICAgICAgaW52b2NhdGlvbnM6IGFwaS5tZXRyaWMoYEdFVF9RVU9URV9SRVFVRVNURURfQ0hBSU5JRDogJHtjaGFpbklkLnRvU3RyaW5nKCl9YCwge1xuICAgICAgICAgICAgcGVyaW9kOiBEdXJhdGlvbi5taW51dGVzKDUpLFxuICAgICAgICAgICAgc3RhdGlzdGljOiAnc3VtJyxcbiAgICAgICAgICB9KSxcbiAgICAgICAgICByZXNwb25zZTQwMDogYXBpLm1ldHJpYyhgR0VUX1FVT1RFXzQwMF9DSEFJTklEOiAke2NoYWluSWQudG9TdHJpbmcoKX1gLCB7XG4gICAgICAgICAgICBwZXJpb2Q6IER1cmF0aW9uLm1pbnV0ZXMoNSksXG4gICAgICAgICAgICBzdGF0aXN0aWM6ICdzdW0nLFxuICAgICAgICAgIH0pLFxuICAgICAgICB9LFxuICAgICAgfSlcbiAgICAgIGNvbnN0IGFsYXJtID0gbmV3IGF3c19jbG91ZHdhdGNoLkFsYXJtKHRoaXMsIGFsYXJtTmFtZSwge1xuICAgICAgICBhbGFybU5hbWUsXG4gICAgICAgIG1ldHJpYyxcbiAgICAgICAgdGhyZXNob2xkOiA4MCxcbiAgICAgICAgZXZhbHVhdGlvblBlcmlvZHM6IDIsXG4gICAgICB9KVxuICAgICAgcGVyY2VudDRYWEJ5Q2hhaW5BbGFybS5wdXNoKGFsYXJtKVxuICAgIH0pXG5cbiAgICBpZiAoY2hhdGJvdFNOU0Fybikge1xuICAgICAgY29uc3QgY2hhdEJvdFRvcGljID0gYXdzX3Nucy5Ub3BpYy5mcm9tVG9waWNBcm4odGhpcywgJ0NoYXRib3RUb3BpYycsIGNoYXRib3RTTlNBcm4pXG4gICAgICBhcGlBbGFybTV4eFNldjIuYWRkQWxhcm1BY3Rpb24obmV3IGF3c19jbG91ZHdhdGNoX2FjdGlvbnMuU25zQWN0aW9uKGNoYXRCb3RUb3BpYykpXG4gICAgICBhcGlBbGFybTR4eFNldjIuYWRkQWxhcm1BY3Rpb24obmV3IGF3c19jbG91ZHdhdGNoX2FjdGlvbnMuU25zQWN0aW9uKGNoYXRCb3RUb3BpYykpXG4gICAgICBhcGlBbGFybUxhdGVuY3lTZXYyLmFkZEFsYXJtQWN0aW9uKG5ldyBhd3NfY2xvdWR3YXRjaF9hY3Rpb25zLlNuc0FjdGlvbihjaGF0Qm90VG9waWMpKVxuICAgICAgYXBpQWxhcm01eHhTZXYzLmFkZEFsYXJtQWN0aW9uKG5ldyBhd3NfY2xvdWR3YXRjaF9hY3Rpb25zLlNuc0FjdGlvbihjaGF0Qm90VG9waWMpKVxuICAgICAgYXBpQWxhcm00eHhTZXYzLmFkZEFsYXJtQWN0aW9uKG5ldyBhd3NfY2xvdWR3YXRjaF9hY3Rpb25zLlNuc0FjdGlvbihjaGF0Qm90VG9waWMpKVxuICAgICAgYXBpQWxhcm1MYXRlbmN5U2V2My5hZGRBbGFybUFjdGlvbihuZXcgYXdzX2Nsb3Vkd2F0Y2hfYWN0aW9ucy5TbnNBY3Rpb24oY2hhdEJvdFRvcGljKSlcbiAgICAgIHNpbXVsYXRpb25BbGFybVNldjMuYWRkQWxhcm1BY3Rpb24obmV3IGF3c19jbG91ZHdhdGNoX2FjdGlvbnMuU25zQWN0aW9uKGNoYXRCb3RUb3BpYykpXG5cbiAgICAgIHBlcmNlbnQyWFhCeUNoYWluQWxhcm0uZm9yRWFjaCgoYWxhcm0pID0+IHtcbiAgICAgICAgYWxhcm0uYWRkQWxhcm1BY3Rpb24obmV3IGF3c19jbG91ZHdhdGNoX2FjdGlvbnMuU25zQWN0aW9uKGNoYXRCb3RUb3BpYykpXG4gICAgICB9KVxuICAgICAgcGVyY2VudDRYWEJ5Q2hhaW5BbGFybS5mb3JFYWNoKChhbGFybSkgPT4ge1xuICAgICAgICBhbGFybS5hZGRBbGFybUFjdGlvbihuZXcgYXdzX2Nsb3Vkd2F0Y2hfYWN0aW9ucy5TbnNBY3Rpb24oY2hhdEJvdFRvcGljKSlcbiAgICAgIH0pXG4gICAgfVxuXG4gICAgdGhpcy51cmwgPSBuZXcgQ2ZuT3V0cHV0KHRoaXMsICdVcmwnLCB7XG4gICAgICB2YWx1ZTogYXBpLnVybCxcbiAgICB9KVxuICB9XG59XG4iXX0=