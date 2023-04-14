import { Protocol } from '@uniswap/router-sdk';
import * as cdk from 'aws-cdk-lib';
import { Duration } from 'aws-cdk-lib';
import * as aws_cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import { MathExpression } from 'aws-cdk-lib/aws-cloudwatch';
import * as aws_cloudwatch_actions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as aws_events from 'aws-cdk-lib/aws-events';
import * as aws_events_targets from 'aws-cdk-lib/aws-events-targets';
import * as aws_iam from 'aws-cdk-lib/aws-iam';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import * as aws_lambda from 'aws-cdk-lib/aws-lambda';
import * as aws_lambda_nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as aws_s3 from 'aws-cdk-lib/aws-s3';
import * as aws_sns from 'aws-cdk-lib/aws-sns';
import * as path from 'path';
import { chainProtocols } from '../../lib/cron/cache-config';
import { STAGE } from '../../lib/util/stage';
export class RoutingCachingStack extends cdk.NestedStack {
    constructor(scope, name, props) {
        super(scope, name, props);
        this.poolCacheLambdaNameArray = [];
        const { chatbotSNSArn } = props;
        const chatBotTopic = chatbotSNSArn ? aws_sns.Topic.fromTopicArn(this, 'ChatbotTopic', chatbotSNSArn) : undefined;
        // TODO: Remove and swap to the new bucket below. Kept around for the rollout, but all requests will go to bucket 2.
        this.poolCacheBucket = new aws_s3.Bucket(this, 'PoolCacheBucket');
        this.poolCacheBucket2 = new aws_s3.Bucket(this, 'PoolCacheBucket2');
        // Set bucket such that objects are deleted after 60 minutes. Ensure that if the cache stops
        // updating (e.g. Subgraph down) that we stop using the cache files and will fallback to a static pool list.
        this.poolCacheBucket2.addLifecycleRule({
            enabled: true,
            expiration: cdk.Duration.days(1),
        });
        this.poolCacheKey = 'poolCache.json';
        const { stage, route53Arn, pinata_key, pinata_secret, hosted_zone } = props;
        const lambdaRole = new aws_iam.Role(this, 'RoutingLambdaRole', {
            assumedBy: new aws_iam.ServicePrincipal('lambda.amazonaws.com'),
            managedPolicies: [
                aws_iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
                aws_iam.ManagedPolicy.fromAwsManagedPolicyName('CloudWatchFullAccess'),
            ],
        });
        if (stage == STAGE.BETA || stage == STAGE.PROD) {
            lambdaRole.addToPolicy(new PolicyStatement({
                resources: [route53Arn],
                actions: ['sts:AssumeRole'],
                sid: '1',
            }));
        }
        const region = cdk.Stack.of(this).region;
        const lambdaLayerVersion = aws_lambda.LayerVersion.fromLayerVersionArn(this, 'InsightsLayerPools', `arn:aws:lambda:${region}:580247275435:layer:LambdaInsightsExtension:14`);
        // Spin up a new pool cache lambda for each config in chain X protocol
        for (let i = 0; i < chainProtocols.length; i++) {
            const { protocol, chainId, timeout } = chainProtocols[i];
            const lambda = new aws_lambda_nodejs.NodejsFunction(this, `PoolCacheLambda-ChainId${chainId}-Protocol${protocol}`, {
                role: lambdaRole,
                runtime: aws_lambda.Runtime.NODEJS_14_X,
                entry: path.join(__dirname, '../../lib/cron/cache-pools.ts'),
                handler: 'handler',
                timeout: Duration.seconds(900),
                memorySize: 1024,
                bundling: {
                    minify: true,
                    sourceMap: true,
                },
                description: `Pool Cache Lambda for Chain with ChainId ${chainId} and Protocol ${protocol}`,
                layers: [lambdaLayerVersion],
                tracing: aws_lambda.Tracing.ACTIVE,
                environment: {
                    POOL_CACHE_BUCKET: this.poolCacheBucket.bucketName,
                    POOL_CACHE_BUCKET_2: this.poolCacheBucket2.bucketName,
                    POOL_CACHE_KEY: this.poolCacheKey,
                    chainId: chainId.toString(),
                    protocol,
                    timeout: timeout.toString(),
                },
            });
            new aws_events.Rule(this, `SchedulePoolCache-ChainId${chainId}-Protocol${protocol}`, {
                schedule: aws_events.Schedule.rate(Duration.minutes(15)),
                targets: [new aws_events_targets.LambdaFunction(lambda)],
            });
            this.poolCacheBucket2.grantReadWrite(lambda);
            const lambdaAlarmErrorRate = new aws_cloudwatch.Alarm(this, `RoutingAPI-SEV4-PoolCacheToS3LambdaErrorRate-ChainId${chainId}-Protocol${protocol}`, {
                metric: new MathExpression({
                    expression: '(invocations - errors) < 1',
                    usingMetrics: {
                        invocations: lambda.metricInvocations({
                            period: Duration.minutes(60),
                            statistic: 'sum',
                        }),
                        errors: lambda.metricErrors({
                            period: Duration.minutes(60),
                            statistic: 'sum',
                        }),
                    },
                }),
                threshold: protocol === Protocol.V3 ? 50 : 85,
                evaluationPeriods: protocol === Protocol.V3 ? 12 : 144,
            });
            const lambdaThrottlesErrorRate = new aws_cloudwatch.Alarm(this, `RoutingAPI-PoolCacheToS3LambdaThrottles-ChainId${chainId}-Protocol${protocol}`, {
                metric: lambda.metricThrottles({
                    period: Duration.minutes(5),
                    statistic: 'sum',
                }),
                threshold: 5,
                evaluationPeriods: 1,
            });
            if (chatBotTopic) {
                lambdaAlarmErrorRate.addAlarmAction(new aws_cloudwatch_actions.SnsAction(chatBotTopic));
                lambdaThrottlesErrorRate.addAlarmAction(new aws_cloudwatch_actions.SnsAction(chatBotTopic));
            }
            this.poolCacheLambdaNameArray.push(lambda.functionName);
        }
        if (stage == STAGE.BETA || stage == STAGE.PROD) {
            this.ipfsPoolCachingLambda = new aws_lambda_nodejs.NodejsFunction(this, 'IpfsPoolCacheLambda', {
                role: lambdaRole,
                runtime: aws_lambda.Runtime.NODEJS_14_X,
                entry: path.join(__dirname, '../../lib/cron/cache-pools-ipfs.ts'),
                handler: 'handler',
                timeout: Duration.seconds(900),
                memorySize: 1024,
                bundling: {
                    minify: true,
                    sourceMap: true,
                },
                description: 'IPFS Pool Cache Lambda',
                layers: [
                    aws_lambda.LayerVersion.fromLayerVersionArn(this, 'InsightsLayerPoolsIPFS', `arn:aws:lambda:${region}:580247275435:layer:LambdaInsightsExtension:14`),
                ],
                tracing: aws_lambda.Tracing.ACTIVE,
                environment: {
                    PINATA_API_KEY: pinata_key,
                    PINATA_API_SECRET: pinata_secret,
                    ROLE_ARN: route53Arn,
                    HOSTED_ZONE: hosted_zone,
                    STAGE: stage,
                    REDEPLOY: '1',
                },
            });
            new aws_events.Rule(this, 'ScheduleIpfsPoolCache', {
                schedule: aws_events.Schedule.rate(Duration.minutes(15)),
                targets: [new aws_events_targets.LambdaFunction(this.ipfsPoolCachingLambda)],
            });
            this.ipfsCleanPoolCachingLambda = new aws_lambda_nodejs.NodejsFunction(this, 'CleanIpfsPoolCacheLambda', {
                role: lambdaRole,
                runtime: aws_lambda.Runtime.NODEJS_14_X,
                entry: path.join(__dirname, '../../lib/cron/clean-pools-ipfs.ts'),
                handler: 'handler',
                timeout: Duration.seconds(900),
                memorySize: 512,
                bundling: {
                    minify: true,
                    sourceMap: true,
                },
                description: 'Clean IPFS Pool Cache Lambda',
                layers: [
                    aws_lambda.LayerVersion.fromLayerVersionArn(this, 'InsightsLayerPoolsCleanIPFS', `arn:aws:lambda:${region}:580247275435:layer:LambdaInsightsExtension:14`),
                ],
                tracing: aws_lambda.Tracing.ACTIVE,
                environment: {
                    PINATA_API_KEY: pinata_key,
                    PINATA_API_SECRET: pinata_secret,
                    STAGE: stage,
                    REDEPLOY: '1',
                },
            });
            new aws_events.Rule(this, 'ScheduleCleanIpfsPoolCache', {
                schedule: aws_events.Schedule.rate(Duration.minutes(30)),
                targets: [new aws_events_targets.LambdaFunction(this.ipfsCleanPoolCachingLambda)],
            });
        }
        if (chatBotTopic) {
            if (stage == 'beta' || stage == 'prod') {
                const lambdaIpfsAlarmErrorRate = new aws_cloudwatch.Alarm(this, 'RoutingAPI-PoolCacheToIPFSLambdaError', {
                    metric: this.ipfsPoolCachingLambda.metricErrors({
                        period: Duration.minutes(60),
                        statistic: 'sum',
                    }),
                    threshold: 13,
                    evaluationPeriods: 1,
                });
                lambdaIpfsAlarmErrorRate.addAlarmAction(new aws_cloudwatch_actions.SnsAction(chatBotTopic));
            }
        }
        this.tokenListCacheBucket = new aws_s3.Bucket(this, 'TokenListCacheBucket');
        const tokenListCachingLambda = new aws_lambda_nodejs.NodejsFunction(this, 'TokenListCacheLambda', {
            role: lambdaRole,
            runtime: aws_lambda.Runtime.NODEJS_14_X,
            entry: path.join(__dirname, '../../lib/cron/cache-token-lists.ts'),
            handler: 'handler',
            timeout: Duration.seconds(180),
            memorySize: 256,
            bundling: {
                minify: true,
                sourceMap: true,
            },
            layers: [
                aws_lambda.LayerVersion.fromLayerVersionArn(this, 'InsightsLayerTokenList', `arn:aws:lambda:${region}:580247275435:layer:LambdaInsightsExtension:14`),
            ],
            description: 'Token List Cache Lambda',
            tracing: aws_lambda.Tracing.ACTIVE,
            environment: {
                TOKEN_LIST_CACHE_BUCKET: this.tokenListCacheBucket.bucketName,
            },
        });
        this.tokenListCacheBucket.grantReadWrite(tokenListCachingLambda);
        new aws_events.Rule(this, 'ScheduleTokenListCache', {
            schedule: aws_events.Schedule.rate(Duration.minutes(15)),
            targets: [new aws_events_targets.LambdaFunction(tokenListCachingLambda)],
        });
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicm91dGluZy1jYWNoaW5nLXN0YWNrLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vYmluL3N0YWNrcy9yb3V0aW5nLWNhY2hpbmctc3RhY2sudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsT0FBTyxFQUFFLFFBQVEsRUFBRSxNQUFNLHFCQUFxQixDQUFBO0FBQzlDLE9BQU8sS0FBSyxHQUFHLE1BQU0sYUFBYSxDQUFBO0FBQ2xDLE9BQU8sRUFBRSxRQUFRLEVBQUUsTUFBTSxhQUFhLENBQUE7QUFDdEMsT0FBTyxLQUFLLGNBQWMsTUFBTSw0QkFBNEIsQ0FBQTtBQUM1RCxPQUFPLEVBQUUsY0FBYyxFQUFFLE1BQU0sNEJBQTRCLENBQUE7QUFDM0QsT0FBTyxLQUFLLHNCQUFzQixNQUFNLG9DQUFvQyxDQUFBO0FBQzVFLE9BQU8sS0FBSyxVQUFVLE1BQU0sd0JBQXdCLENBQUE7QUFDcEQsT0FBTyxLQUFLLGtCQUFrQixNQUFNLGdDQUFnQyxDQUFBO0FBQ3BFLE9BQU8sS0FBSyxPQUFPLE1BQU0scUJBQXFCLENBQUE7QUFDOUMsT0FBTyxFQUFFLGVBQWUsRUFBRSxNQUFNLHFCQUFxQixDQUFBO0FBQ3JELE9BQU8sS0FBSyxVQUFVLE1BQU0sd0JBQXdCLENBQUE7QUFDcEQsT0FBTyxLQUFLLGlCQUFpQixNQUFNLCtCQUErQixDQUFBO0FBQ2xFLE9BQU8sS0FBSyxNQUFNLE1BQU0sb0JBQW9CLENBQUE7QUFDNUMsT0FBTyxLQUFLLE9BQU8sTUFBTSxxQkFBcUIsQ0FBQTtBQUU5QyxPQUFPLEtBQUssSUFBSSxNQUFNLE1BQU0sQ0FBQTtBQUM1QixPQUFPLEVBQUUsY0FBYyxFQUFFLE1BQU0sNkJBQTZCLENBQUE7QUFDNUQsT0FBTyxFQUFFLEtBQUssRUFBRSxNQUFNLHNCQUFzQixDQUFBO0FBVzVDLE1BQU0sT0FBTyxtQkFBb0IsU0FBUSxHQUFHLENBQUMsV0FBVztJQVN0RCxZQUFZLEtBQWdCLEVBQUUsSUFBWSxFQUFFLEtBQStC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RyxDQUFDO1lBQzlCLFVBQVUsRUFBRSxHQUFHO1lBQ2YsUUFBUSxFQUFFO2dCQUNSLE1BQU0sRUFBRSxJQUFJO2dCQUNaLFNBQVMsRUFBRSxJQUFJO2FBQ2hCO1lBQ0QsTUFBTSxFQUFFO2dCQUNOLFVBQVUsQ0FBQyxZQUFZLENBQUMsbUJBQW1CLENBQ3pDLElBQUksRUFDSix3QkFBd0IsRUFDeEIsa0JBQWtCLE1BQU0sZ0RBQWdELENBQ3pFO2FBQ0Y7WUFDRCxXQUFXLEVBQUUseUJBQXlCO1lBQ3RDLE9BQU8sRUFBRSxVQUFVLENBQUMsT0FBTyxDQUFDLE1BQU07WUFDbEMsV0FBVyxFQUFFO2dCQUNYLHVCQUF1QixFQUFFLElBQUksQ0FBQyxvQkFBb0IsQ0FBQyxVQUFVO2FBQzlEO1NBQ0YsQ0FBQyxDQUFBO1FBRUYsSUFBSSxDQUFDLG9CQUFvQixDQUFDLGNBQWMsQ0FBQyxzQkFBc0IsQ0FBQyxDQUFBO1FBRWhFLElBQUksVUFBVSxDQUFDLElBQUksQ0FBQyxJQUFJLEVBQUUsd0JBQXdCLEVBQUU7WUFDbEQsUUFBUSxFQUFFLFVBQVUsQ0FBQyxRQUFRLENBQUMsSUFBSSxDQUFDLFFBQVEsQ0FBQyxPQUFPLENBQUMsRUFBRSxDQUFDLENBQUM7WUFDeEQsT0FBTyxFQUFFLENBQUMsSUFBSSxrQkFBa0IsQ0FBQyxjQUFjLENBQUMsc0JBQXNCLENBQUMsQ0FBQztTQUN6RSxDQUFDLENBQUE7SUFDSixDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBQcm90b2NvbCB9IGZyb20gJ0B1bmlzd2FwL3JvdXRlci1zZGsnXG5pbXBvcnQgKiBhcyBjZGsgZnJvbSAnYXdzLWNkay1saWInXG5pbXBvcnQgeyBEdXJhdGlvbiB9IGZyb20gJ2F3cy1jZGstbGliJ1xuaW1wb3J0ICogYXMgYXdzX2Nsb3Vkd2F0Y2ggZnJvbSAnYXdzLWNkay1saWIvYXdzLWNsb3Vkd2F0Y2gnXG5pbXBvcnQgeyBNYXRoRXhwcmVzc2lvbiB9IGZyb20gJ2F3cy1jZGstbGliL2F3cy1jbG91ZHdhdGNoJ1xuaW1wb3J0ICogYXMgYXdzX2Nsb3Vkd2F0Y2hfYWN0aW9ucyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtY2xvdWR3YXRjaC1hY3Rpb25zJ1xuaW1wb3J0ICogYXMgYXdzX2V2ZW50cyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZXZlbnRzJ1xuaW1wb3J0ICogYXMgYXdzX2V2ZW50c190YXJnZXRzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1ldmVudHMtdGFyZ2V0cydcbmltcG9ydCAqIGFzIGF3c19pYW0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWlhbSdcbmltcG9ydCB7IFBvbGljeVN0YXRlbWVudCB9IGZyb20gJ2F3cy1jZGstbGliL2F3cy1pYW0nXG5pbXBvcnQgKiBhcyBhd3NfbGFtYmRhIGZyb20gJ2F3cy1jZGstbGliL2F3cy1sYW1iZGEnXG5pbXBvcnQgKiBhcyBhd3NfbGFtYmRhX25vZGVqcyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbGFtYmRhLW5vZGVqcydcbmltcG9ydCAqIGFzIGF3c19zMyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtczMnXG5pbXBvcnQgKiBhcyBhd3Nfc25zIGZyb20gJ2F3cy1jZGstbGliL2F3cy1zbnMnXG5pbXBvcnQgeyBDb25zdHJ1Y3QgfSBmcm9tICdjb25zdHJ1Y3RzJ1xuaW1wb3J0ICogYXMgcGF0aCBmcm9tICdwYXRoJ1xuaW1wb3J0IHsgY2hhaW5Qcm90b2NvbHMgfSBmcm9tICcuLi8uLi9saWIvY3Jvbi9jYWNoZS1jb25maWcnXG5pbXBvcnQgeyBTVEFHRSB9IGZyb20gJy4uLy4uL2xpYi91dGlsL3N0YWdlJ1xuXG5leHBvcnQgaW50ZXJmYWNlIFJvdXRpbmdDYWNoaW5nU3RhY2tQcm9wcyBleHRlbmRzIGNkay5OZXN0ZWRTdGFja1Byb3BzIHtcbiAgc3RhZ2U6IHN0cmluZ1xuICByb3V0ZTUzQXJuPzogc3RyaW5nXG4gIHBpbmF0YV9rZXk/OiBzdHJpbmdcbiAgcGluYXRhX3NlY3JldD86IHN0cmluZ1xuICBob3N0ZWRfem9uZT86IHN0cmluZ1xuICBjaGF0Ym90U05TQXJuPzogc3RyaW5nXG59XG5cbmV4cG9ydCBjbGFzcyBSb3V0aW5nQ2FjaGluZ1N0YWNrIGV4dGVuZHMgY2RrLk5lc3RlZFN0YWNrIHtcbiAgcHVibGljIHJlYWRvbmx5IHBvb2xDYWNoZUJ1Y2tldDogYXdzX3MzLkJ1Y2tldFxuICBwdWJsaWMgcmVhZG9ubHkgcG9vbENhY2hlQnVja2V0MjogYXdzX3MzLkJ1Y2tldFxuICBwdWJsaWMgcmVhZG9ubHkgcG9vbENhY2hlS2V5OiBzdHJpbmdcbiAgcHVibGljIHJlYWRvbmx5IHRva2VuTGlzdENhY2hlQnVja2V0OiBhd3NfczMuQnVja2V0XG4gIHB1YmxpYyByZWFkb25seSBpcGZzUG9vbENhY2hpbmdMYW1iZGE6IGF3c19sYW1iZGFfbm9kZWpzLk5vZGVqc0Z1bmN0aW9uXG4gIHB1YmxpYyByZWFkb25seSBpcGZzQ2xlYW5Qb29sQ2FjaGluZ0xhbWJkYTogYXdzX2xhbWJkYV9ub2RlanMuTm9kZWpzRnVuY3Rpb25cbiAgcHVibGljIHJlYWRvbmx5IHBvb2xDYWNoZUxhbWJkYU5hbWVBcnJheTogc3RyaW5nW10gPSBbXVxuXG4gIGNvbnN0cnVjdG9yKHNjb3BlOiBDb25zdHJ1Y3QsIG5hbWU6IHN0cmluZywgcHJvcHM6IFJvdXRpbmdDYWNoaW5nU3RhY2tQcm9wcykge1xuICAgIHN1cGVyKHNjb3BlLCBuYW1lLCBwcm9wcylcblxuICAgIGNvbnN0IHsgY2hhdGJvdFNOU0FybiB9ID0gcHJvcHNcblxuICAgIGNvbnN0IGNoYXRCb3RUb3BpYyA9IGNoYXRib3RTTlNBcm4gPyBhd3Nfc25zLlRvcGljLmZyb21Ub3BpY0Fybih0aGlzLCAnQ2hhdGJvdFRvcGljJywgY2hhdGJvdFNOU0FybikgOiB1bmRlZmluZWRcblxuICAgIC8vIFRPRE86IFJlbW92ZSBhbmQgc3dhcCB0byB0aGUgbmV3IGJ1Y2tldCBiZWxvdy4gS2VwdCBhcm91bmQgZm9yIHRoZSByb2xsb3V0LCBidXQgYWxsIHJlcXVlc3RzIHdpbGwgZ28gdG8gYnVja2V0IDIuXG4gICAgdGhpcy5wb29sQ2FjaGVCdWNrZXQgPSBuZXcgYXdzX3MzLkJ1Y2tldCh0aGlzLCAnUG9vbENhY2hlQnVja2V0JylcbiAgICB0aGlzLnBvb2xDYWNoZUJ1Y2tldDIgPSBuZXcgYXdzX3MzLkJ1Y2tldCh0aGlzLCAnUG9vbENhY2hlQnVja2V0MicpXG5cbiAgICAvLyBTZXQgYnVja2V0IHN1Y2ggdGhhdCBvYmplY3RzIGFyZSBkZWxldGVkIGFmdGVyIDYwIG1pbnV0ZXMuIEVuc3VyZSB0aGF0IGlmIHRoZSBjYWNoZSBzdG9wc1xuICAgIC8vIHVwZGF0aW5nIChlLmcuIFN1YmdyYXBoIGRvd24pIHRoYXQgd2Ugc3RvcCB1c2luZyB0aGUgY2FjaGUgZmlsZXMgYW5kIHdpbGwgZmFsbGJhY2sgdG8gYSBzdGF0aWMgcG9vbCBsaXN0LlxuICAgIHRoaXMucG9vbENhY2hlQnVja2V0Mi5hZGRMaWZlY3ljbGVSdWxlKHtcbiAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgICBleHBpcmF0aW9uOiBjZGsuRHVyYXRpb24uZGF5cygxKSxcbiAgICB9KVxuXG4gICAgdGhpcy5wb29sQ2FjaGVLZXkgPSAncG9vbENhY2hlLmpzb24nXG5cbiAgICBjb25zdCB7IHN0YWdlLCByb3V0ZTUzQXJuLCBwaW5hdGFfa2V5LCBwaW5hdGFfc2VjcmV0LCBob3N0ZWRfem9uZSB9ID0gcHJvcHNcblxuICAgIGNvbnN0IGxhbWJkYVJvbGUgPSBuZXcgYXdzX2lhbS5Sb2xlKHRoaXMsICdSb3V0aW5nTGFtYmRhUm9sZScsIHtcbiAgICAgIGFzc3VtZWRCeTogbmV3IGF3c19pYW0uU2VydmljZVByaW5jaXBhbCgnbGFtYmRhLmFtYXpvbmF3cy5jb20nKSxcbiAgICAgIG1hbmFnZWRQb2xpY2llczogW1xuICAgICAgICBhd3NfaWFtLk1hbmFnZWRQb2xpY3kuZnJvbUF3c01hbmFnZWRQb2xpY3lOYW1lKCdzZXJ2aWNlLXJvbGUvQVdTTGFtYmRhQmFzaWNFeGVjdXRpb25Sb2xlJyksXG4gICAgICAgIGF3c19pYW0uTWFuYWdlZFBvbGljeS5mcm9tQXdzTWFuYWdlZFBvbGljeU5hbWUoJ0Nsb3VkV2F0Y2hGdWxsQWNjZXNzJyksXG4gICAgICBdLFxuICAgIH0pXG5cbiAgICBpZiAoc3RhZ2UgPT0gU1RBR0UuQkVUQSB8fCBzdGFnZSA9PSBTVEFHRS5QUk9EKSB7XG4gICAgICBsYW1iZGFSb2xlLmFkZFRvUG9saWN5KFxuICAgICAgICBuZXcgUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgICByZXNvdXJjZXM6IFtyb3V0ZTUzQXJuIV0sXG4gICAgICAgICAgYWN0aW9uczogWydzdHM6QXNzdW1lUm9sZSddLFxuICAgICAgICAgIHNpZDogJzEnLFxuICAgICAgICB9KVxuICAgICAgKVxuICAgIH1cblxuICAgIGNvbnN0IHJlZ2lvbiA9IGNkay5TdGFjay5vZih0aGlzKS5yZWdpb25cblxuICAgIGNvbnN0IGxhbWJkYUxheWVyVmVyc2lvbiA9IGF3c19sYW1iZGEuTGF5ZXJWZXJzaW9uLmZyb21MYXllclZlcnNpb25Bcm4oXG4gICAgICB0aGlzLFxuICAgICAgJ0luc2lnaHRzTGF5ZXJQb29scycsXG4gICAgICBgYXJuOmF3czpsYW1iZGE6JHtyZWdpb259OjU4MDI0NzI3NTQzNTpsYXllcjpMYW1iZGFJbnNpZ2h0c0V4dGVuc2lvbjoxNGBcbiAgICApXG5cbiAgICAvLyBTcGluIHVwIGEgbmV3IHBvb2wgY2FjaGUgbGFtYmRhIGZvciBlYWNoIGNvbmZpZyBpbiBjaGFpbiBYIHByb3RvY29sXG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCBjaGFpblByb3RvY29scy5sZW5ndGg7IGkrKykge1xuICAgICAgY29uc3QgeyBwcm90b2NvbCwgY2hhaW5JZCwgdGltZW91dCB9ID0gY2hhaW5Qcm90b2NvbHNbaV1cbiAgICAgIGNvbnN0IGxhbWJkYSA9IG5ldyBhd3NfbGFtYmRhX25vZGVqcy5Ob2RlanNGdW5jdGlvbihcbiAgICAgICAgdGhpcyxcbiAgICAgICAgYFBvb2xDYWNoZUxhbWJkYS1DaGFpbklkJHtjaGFpbklkfS1Qcm90b2NvbCR7cHJvdG9jb2x9YCxcbiAgICAgICAge1xuICAgICAgICAgIHJvbGU6IGxhbWJkYVJvbGUsXG4gICAgICAgICAgcnVudGltZTogYXdzX2xhbWJkYS5SdW50aW1lLk5PREVKU18xNF9YLFxuICAgICAgICAgIGVudHJ5OiBwYXRoLmpvaW4oX19kaXJuYW1lLCAnLi4vLi4vbGliL2Nyb24vY2FjaGUtcG9vbHMudHMnKSxcbiAgICAgICAgICBoYW5kbGVyOiAnaGFuZGxlcicsXG4gICAgICAgICAgdGltZW91dDogRHVyYXRpb24uc2Vjb25kcyg5MDApLFxuICAgICAgICAgIG1lbW9yeVNpemU6IDEwMjQsXG4gICAgICAgICAgYnVuZGxpbmc6IHtcbiAgICAgICAgICAgIG1pbmlmeTogdHJ1ZSxcbiAgICAgICAgICAgIHNvdXJjZU1hcDogdHJ1ZSxcbiAgICAgICAgICB9LFxuICAgICAgICAgIGRlc2NyaXB0aW9uOiBgUG9vbCBDYWNoZSBMYW1iZGEgZm9yIENoYWluIHdpdGggQ2hhaW5JZCAke2NoYWluSWR9IGFuZCBQcm90b2NvbCAke3Byb3RvY29sfWAsXG4gICAgICAgICAgbGF5ZXJzOiBbbGFtYmRhTGF5ZXJWZXJzaW9uXSxcbiAgICAgICAgICB0cmFjaW5nOiBhd3NfbGFtYmRhLlRyYWNpbmcuQUNUSVZFLFxuICAgICAgICAgIGVudmlyb25tZW50OiB7XG4gICAgICAgICAgICBQT09MX0NBQ0hFX0JVQ0tFVDogdGhpcy5wb29sQ2FjaGVCdWNrZXQuYnVja2V0TmFtZSxcbiAgICAgICAgICAgIFBPT0xfQ0FDSEVfQlVDS0VUXzI6IHRoaXMucG9vbENhY2hlQnVja2V0Mi5idWNrZXROYW1lLFxuICAgICAgICAgICAgUE9PTF9DQUNIRV9LRVk6IHRoaXMucG9vbENhY2hlS2V5LFxuICAgICAgICAgICAgY2hhaW5JZDogY2hhaW5JZC50b1N0cmluZygpLFxuICAgICAgICAgICAgcHJvdG9jb2wsXG4gICAgICAgICAgICB0aW1lb3V0OiB0aW1lb3V0LnRvU3RyaW5nKCksXG4gICAgICAgICAgfSxcbiAgICAgICAgfVxuICAgICAgKVxuICAgICAgbmV3IGF3c19ldmVudHMuUnVsZSh0aGlzLCBgU2NoZWR1bGVQb29sQ2FjaGUtQ2hhaW5JZCR7Y2hhaW5JZH0tUHJvdG9jb2wke3Byb3RvY29sfWAsIHtcbiAgICAgICAgc2NoZWR1bGU6IGF3c19ldmVudHMuU2NoZWR1bGUucmF0ZShEdXJhdGlvbi5taW51dGVzKDE1KSksXG4gICAgICAgIHRhcmdldHM6IFtuZXcgYXdzX2V2ZW50c190YXJnZXRzLkxhbWJkYUZ1bmN0aW9uKGxhbWJkYSldLFxuICAgICAgfSlcbiAgICAgIHRoaXMucG9vbENhY2hlQnVja2V0Mi5ncmFudFJlYWRXcml0ZShsYW1iZGEpXG4gICAgICBjb25zdCBsYW1iZGFBbGFybUVycm9yUmF0ZSA9IG5ldyBhd3NfY2xvdWR3YXRjaC5BbGFybShcbiAgICAgICAgdGhpcyxcbiAgICAgICAgYFJvdXRpbmdBUEktU0VWNC1Qb29sQ2FjaGVUb1MzTGFtYmRhRXJyb3JSYXRlLUNoYWluSWQke2NoYWluSWR9LVByb3RvY29sJHtwcm90b2NvbH1gLFxuICAgICAgICB7XG4gICAgICAgICAgbWV0cmljOiBuZXcgTWF0aEV4cHJlc3Npb24oe1xuICAgICAgICAgICAgZXhwcmVzc2lvbjogJyhpbnZvY2F0aW9ucyAtIGVycm9ycykgPCAxJyxcbiAgICAgICAgICAgIHVzaW5nTWV0cmljczoge1xuICAgICAgICAgICAgICBpbnZvY2F0aW9uczogbGFtYmRhLm1ldHJpY0ludm9jYXRpb25zKHtcbiAgICAgICAgICAgICAgICBwZXJpb2Q6IER1cmF0aW9uLm1pbnV0ZXMoNjApLFxuICAgICAgICAgICAgICAgIHN0YXRpc3RpYzogJ3N1bScsXG4gICAgICAgICAgICAgIH0pLFxuICAgICAgICAgICAgICBlcnJvcnM6IGxhbWJkYS5tZXRyaWNFcnJvcnMoe1xuICAgICAgICAgICAgICAgIHBlcmlvZDogRHVyYXRpb24ubWludXRlcyg2MCksXG4gICAgICAgICAgICAgICAgc3RhdGlzdGljOiAnc3VtJyxcbiAgICAgICAgICAgICAgfSksXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIH0pLFxuICAgICAgICAgIHRocmVzaG9sZDogcHJvdG9jb2wgPT09IFByb3RvY29sLlYzID8gNTAgOiA4NSxcbiAgICAgICAgICBldmFsdWF0aW9uUGVyaW9kczogcHJvdG9jb2wgPT09IFByb3RvY29sLlYzID8gMTIgOiAxNDQsXG4gICAgICAgIH1cbiAgICAgIClcbiAgICAgIGNvbnN0IGxhbWJkYVRocm90dGxlc0Vycm9yUmF0ZSA9IG5ldyBhd3NfY2xvdWR3YXRjaC5BbGFybShcbiAgICAgICAgdGhpcyxcbiAgICAgICAgYFJvdXRpbmdBUEktUG9vbENhY2hlVG9TM0xhbWJkYVRocm90dGxlcy1DaGFpbklkJHtjaGFpbklkfS1Qcm90b2NvbCR7cHJvdG9jb2x9YCxcbiAgICAgICAge1xuICAgICAgICAgIG1ldHJpYzogbGFtYmRhLm1ldHJpY1Rocm90dGxlcyh7XG4gICAgICAgICAgICBwZXJpb2Q6IER1cmF0aW9uLm1pbnV0ZXMoNSksXG4gICAgICAgICAgICBzdGF0aXN0aWM6ICdzdW0nLFxuICAgICAgICAgIH0pLFxuICAgICAgICAgIHRocmVzaG9sZDogNSxcbiAgICAgICAgICBldmFsdWF0aW9uUGVyaW9kczogMSxcbiAgICAgICAgfVxuICAgICAgKVxuICAgICAgaWYgKGNoYXRCb3RUb3BpYykge1xuICAgICAgICBsYW1iZGFBbGFybUVycm9yUmF0ZS5hZGRBbGFybUFjdGlvbihuZXcgYXdzX2Nsb3Vkd2F0Y2hfYWN0aW9ucy5TbnNBY3Rpb24oY2hhdEJvdFRvcGljKSlcbiAgICAgICAgbGFtYmRhVGhyb3R0bGVzRXJyb3JSYXRlLmFkZEFsYXJtQWN0aW9uKG5ldyBhd3NfY2xvdWR3YXRjaF9hY3Rpb25zLlNuc0FjdGlvbihjaGF0Qm90VG9waWMpKVxuICAgICAgfVxuICAgICAgdGhpcy5wb29sQ2FjaGVMYW1iZGFOYW1lQXJyYXkucHVzaChsYW1iZGEuZnVuY3Rpb25OYW1lKVxuICAgIH1cblxuICAgIGlmIChzdGFnZSA9PSBTVEFHRS5CRVRBIHx8IHN0YWdlID09IFNUQUdFLlBST0QpIHtcbiAgICAgIHRoaXMuaXBmc1Bvb2xDYWNoaW5nTGFtYmRhID0gbmV3IGF3c19sYW1iZGFfbm9kZWpzLk5vZGVqc0Z1bmN0aW9uKHRoaXMsICdJcGZzUG9vbENhY2hlTGFtYmRhJywge1xuICAgICAgICByb2xlOiBsYW1iZGFSb2xlLFxuICAgICAgICBydW50aW1lOiBhd3NfbGFtYmRhLlJ1bnRpbWUuTk9ERUpTXzE0X1gsXG4gICAgICAgIGVudHJ5OiBwYXRoLmpvaW4oX19kaXJuYW1lLCAnLi4vLi4vbGliL2Nyb24vY2FjaGUtcG9vbHMtaXBmcy50cycpLFxuICAgICAgICBoYW5kbGVyOiAnaGFuZGxlcicsXG4gICAgICAgIHRpbWVvdXQ6IER1cmF0aW9uLnNlY29uZHMoOTAwKSxcbiAgICAgICAgbWVtb3J5U2l6ZTogMTAyNCxcbiAgICAgICAgYnVuZGxpbmc6IHtcbiAgICAgICAgICBtaW5pZnk6IHRydWUsXG4gICAgICAgICAgc291cmNlTWFwOiB0cnVlLFxuICAgICAgICB9LFxuICAgICAgICBkZXNjcmlwdGlvbjogJ0lQRlMgUG9vbCBDYWNoZSBMYW1iZGEnLFxuICAgICAgICBsYXllcnM6IFtcbiAgICAgICAgICBhd3NfbGFtYmRhLkxheWVyVmVyc2lvbi5mcm9tTGF5ZXJWZXJzaW9uQXJuKFxuICAgICAgICAgICAgdGhpcyxcbiAgICAgICAgICAgICdJbnNpZ2h0c0xheWVyUG9vbHNJUEZTJyxcbiAgICAgICAgICAgIGBhcm46YXdzOmxhbWJkYToke3JlZ2lvbn06NTgwMjQ3Mjc1NDM1OmxheWVyOkxhbWJkYUluc2lnaHRzRXh0ZW5zaW9uOjE0YFxuICAgICAgICAgICksXG4gICAgICAgIF0sXG4gICAgICAgIHRyYWNpbmc6IGF3c19sYW1iZGEuVHJhY2luZy5BQ1RJVkUsXG4gICAgICAgIGVudmlyb25tZW50OiB7XG4gICAgICAgICAgUElOQVRBX0FQSV9LRVk6IHBpbmF0YV9rZXkhLFxuICAgICAgICAgIFBJTkFUQV9BUElfU0VDUkVUOiBwaW5hdGFfc2VjcmV0ISxcbiAgICAgICAgICBST0xFX0FSTjogcm91dGU1M0FybiEsXG4gICAgICAgICAgSE9TVEVEX1pPTkU6IGhvc3RlZF96b25lISxcbiAgICAgICAgICBTVEFHRTogc3RhZ2UsXG4gICAgICAgICAgUkVERVBMT1k6ICcxJyxcbiAgICAgICAgfSxcbiAgICAgIH0pXG5cbiAgICAgIG5ldyBhd3NfZXZlbnRzLlJ1bGUodGhpcywgJ1NjaGVkdWxlSXBmc1Bvb2xDYWNoZScsIHtcbiAgICAgICAgc2NoZWR1bGU6IGF3c19ldmVudHMuU2NoZWR1bGUucmF0ZShEdXJhdGlvbi5taW51dGVzKDE1KSksXG4gICAgICAgIHRhcmdldHM6IFtuZXcgYXdzX2V2ZW50c190YXJnZXRzLkxhbWJkYUZ1bmN0aW9uKHRoaXMuaXBmc1Bvb2xDYWNoaW5nTGFtYmRhKV0sXG4gICAgICB9KVxuXG4gICAgICB0aGlzLmlwZnNDbGVhblBvb2xDYWNoaW5nTGFtYmRhID0gbmV3IGF3c19sYW1iZGFfbm9kZWpzLk5vZGVqc0Z1bmN0aW9uKHRoaXMsICdDbGVhbklwZnNQb29sQ2FjaGVMYW1iZGEnLCB7XG4gICAgICAgIHJvbGU6IGxhbWJkYVJvbGUsXG4gICAgICAgIHJ1bnRpbWU6IGF3c19sYW1iZGEuUnVudGltZS5OT0RFSlNfMTRfWCxcbiAgICAgICAgZW50cnk6IHBhdGguam9pbihfX2Rpcm5hbWUsICcuLi8uLi9saWIvY3Jvbi9jbGVhbi1wb29scy1pcGZzLnRzJyksXG4gICAgICAgIGhhbmRsZXI6ICdoYW5kbGVyJyxcbiAgICAgICAgdGltZW91dDogRHVyYXRpb24uc2Vjb25kcyg5MDApLFxuICAgICAgICBtZW1vcnlTaXplOiA1MTIsXG4gICAgICAgIGJ1bmRsaW5nOiB7XG4gICAgICAgICAgbWluaWZ5OiB0cnVlLFxuICAgICAgICAgIHNvdXJjZU1hcDogdHJ1ZSxcbiAgICAgICAgfSxcbiAgICAgICAgZGVzY3JpcHRpb246ICdDbGVhbiBJUEZTIFBvb2wgQ2FjaGUgTGFtYmRhJyxcbiAgICAgICAgbGF5ZXJzOiBbXG4gICAgICAgICAgYXdzX2xhbWJkYS5MYXllclZlcnNpb24uZnJvbUxheWVyVmVyc2lvbkFybihcbiAgICAgICAgICAgIHRoaXMsXG4gICAgICAgICAgICAnSW5zaWdodHNMYXllclBvb2xzQ2xlYW5JUEZTJyxcbiAgICAgICAgICAgIGBhcm46YXdzOmxhbWJkYToke3JlZ2lvbn06NTgwMjQ3Mjc1NDM1OmxheWVyOkxhbWJkYUluc2lnaHRzRXh0ZW5zaW9uOjE0YFxuICAgICAgICAgICksXG4gICAgICAgIF0sXG4gICAgICAgIHRyYWNpbmc6IGF3c19sYW1iZGEuVHJhY2luZy5BQ1RJVkUsXG4gICAgICAgIGVudmlyb25tZW50OiB7XG4gICAgICAgICAgUElOQVRBX0FQSV9LRVk6IHBpbmF0YV9rZXkhLFxuICAgICAgICAgIFBJTkFUQV9BUElfU0VDUkVUOiBwaW5hdGFfc2VjcmV0ISxcbiAgICAgICAgICBTVEFHRTogc3RhZ2UsXG4gICAgICAgICAgUkVERVBMT1k6ICcxJyxcbiAgICAgICAgfSxcbiAgICAgIH0pXG5cbiAgICAgIG5ldyBhd3NfZXZlbnRzLlJ1bGUodGhpcywgJ1NjaGVkdWxlQ2xlYW5JcGZzUG9vbENhY2hlJywge1xuICAgICAgICBzY2hlZHVsZTogYXdzX2V2ZW50cy5TY2hlZHVsZS5yYXRlKER1cmF0aW9uLm1pbnV0ZXMoMzApKSxcbiAgICAgICAgdGFyZ2V0czogW25ldyBhd3NfZXZlbnRzX3RhcmdldHMuTGFtYmRhRnVuY3Rpb24odGhpcy5pcGZzQ2xlYW5Qb29sQ2FjaGluZ0xhbWJkYSldLFxuICAgICAgfSlcbiAgICB9XG5cbiAgICBpZiAoY2hhdEJvdFRvcGljKSB7XG4gICAgICBpZiAoc3RhZ2UgPT0gJ2JldGEnIHx8IHN0YWdlID09ICdwcm9kJykge1xuICAgICAgICBjb25zdCBsYW1iZGFJcGZzQWxhcm1FcnJvclJhdGUgPSBuZXcgYXdzX2Nsb3Vkd2F0Y2guQWxhcm0odGhpcywgJ1JvdXRpbmdBUEktUG9vbENhY2hlVG9JUEZTTGFtYmRhRXJyb3InLCB7XG4gICAgICAgICAgbWV0cmljOiB0aGlzLmlwZnNQb29sQ2FjaGluZ0xhbWJkYS5tZXRyaWNFcnJvcnMoe1xuICAgICAgICAgICAgcGVyaW9kOiBEdXJhdGlvbi5taW51dGVzKDYwKSxcbiAgICAgICAgICAgIHN0YXRpc3RpYzogJ3N1bScsXG4gICAgICAgICAgfSksXG4gICAgICAgICAgdGhyZXNob2xkOiAxMyxcbiAgICAgICAgICBldmFsdWF0aW9uUGVyaW9kczogMSxcbiAgICAgICAgfSlcblxuICAgICAgICBsYW1iZGFJcGZzQWxhcm1FcnJvclJhdGUuYWRkQWxhcm1BY3Rpb24obmV3IGF3c19jbG91ZHdhdGNoX2FjdGlvbnMuU25zQWN0aW9uKGNoYXRCb3RUb3BpYykpXG4gICAgICB9XG4gICAgfVxuXG4gICAgdGhpcy50b2tlbkxpc3RDYWNoZUJ1Y2tldCA9IG5ldyBhd3NfczMuQnVja2V0KHRoaXMsICdUb2tlbkxpc3RDYWNoZUJ1Y2tldCcpXG5cbiAgICBjb25zdCB0b2tlbkxpc3RDYWNoaW5nTGFtYmRhID0gbmV3IGF3c19sYW1iZGFfbm9kZWpzLk5vZGVqc0Z1bmN0aW9uKHRoaXMsICdUb2tlbkxpc3RDYWNoZUxhbWJkYScsIHtcbiAgICAgIHJvbGU6IGxhbWJkYVJvbGUsXG4gICAgICBydW50aW1lOiBhd3NfbGFtYmRhLlJ1bnRpbWUuTk9ERUpTXzE0X1gsXG4gICAgICBlbnRyeTogcGF0aC5qb2luKF9fZGlybmFtZSwgJy4uLy4uL2xpYi9jcm9uL2NhY2hlLXRva2VuLWxpc3RzLnRzJyksXG4gICAgICBoYW5kbGVyOiAnaGFuZGxlcicsXG4gICAgICB0aW1lb3V0OiBEdXJhdGlvbi5zZWNvbmRzKDE4MCksXG4gICAgICBtZW1vcnlTaXplOiAyNTYsXG4gICAgICBidW5kbGluZzoge1xuICAgICAgICBtaW5pZnk6IHRydWUsXG4gICAgICAgIHNvdXJjZU1hcDogdHJ1ZSxcbiAgICAgIH0sXG4gICAgICBsYXllcnM6IFtcbiAgICAgICAgYXdzX2xhbWJkYS5MYXllclZlcnNpb24uZnJvbUxheWVyVmVyc2lvbkFybihcbiAgICAgICAgICB0aGlzLFxuICAgICAgICAgICdJbnNpZ2h0c0xheWVyVG9rZW5MaXN0JyxcbiAgICAgICAgICBgYXJuOmF3czpsYW1iZGE6JHtyZWdpb259OjU4MDI0NzI3NTQzNTpsYXllcjpMYW1iZGFJbnNpZ2h0c0V4dGVuc2lvbjoxNGBcbiAgICAgICAgKSxcbiAgICAgIF0sXG4gICAgICBkZXNjcmlwdGlvbjogJ1Rva2VuIExpc3QgQ2FjaGUgTGFtYmRhJyxcbiAgICAgIHRyYWNpbmc6IGF3c19sYW1iZGEuVHJhY2luZy5BQ1RJVkUsXG4gICAgICBlbnZpcm9ubWVudDoge1xuICAgICAgICBUT0tFTl9MSVNUX0NBQ0hFX0JVQ0tFVDogdGhpcy50b2tlbkxpc3RDYWNoZUJ1Y2tldC5idWNrZXROYW1lLFxuICAgICAgfSxcbiAgICB9KVxuXG4gICAgdGhpcy50b2tlbkxpc3RDYWNoZUJ1Y2tldC5ncmFudFJlYWRXcml0ZSh0b2tlbkxpc3RDYWNoaW5nTGFtYmRhKVxuXG4gICAgbmV3IGF3c19ldmVudHMuUnVsZSh0aGlzLCAnU2NoZWR1bGVUb2tlbkxpc3RDYWNoZScsIHtcbiAgICAgIHNjaGVkdWxlOiBhd3NfZXZlbnRzLlNjaGVkdWxlLnJhdGUoRHVyYXRpb24ubWludXRlcygxNSkpLFxuICAgICAgdGFyZ2V0czogW25ldyBhd3NfZXZlbnRzX3RhcmdldHMuTGFtYmRhRnVuY3Rpb24odG9rZW5MaXN0Q2FjaGluZ0xhbWJkYSldLFxuICAgIH0pXG4gIH1cbn1cbiJdfQ==