import * as cdk from 'aws-cdk-lib';
import * as aws_dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';
export interface RoutingDatabaseStackProps extends cdk.NestedStackProps {
}
export declare class RoutingDatabaseStack extends cdk.NestedStack {
    readonly cachedRoutesDynamoDb: aws_dynamodb.Table;
    constructor(scope: Construct, name: string, props: RoutingDatabaseStackProps);
}
