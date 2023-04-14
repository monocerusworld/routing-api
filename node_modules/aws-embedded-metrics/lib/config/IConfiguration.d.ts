import Environments from '../environment/Environments';
export interface IConfiguration {
    /**
     * Whether or not internal logging should be enabled.
     */
    debuggingLoggingEnabled: boolean;
    /**
     * The name of the service to use in the default dimensions.
     */
    serviceName: string | undefined;
    /**
     * The type of the service to use in the default dimensions.
     */
    serviceType: string | undefined;
    /**
     * The LogGroup name to use. This will be ignored when using the
     * Lambda scope.
     */
    logGroupName: string | undefined;
    /**
     * The LogStream name to use. This will be ignored when using the
     * Lambda scope.
     */
    logStreamName: string | undefined;
    /**
     * The endpoint to use to connect to the CloudWatch Agent
     */
    agentEndpoint: string | undefined;
    /**
     * Environment override. This will short circuit auto-environment detection.
     * Valid values include:
     * - Local: no decoration and sends over stdout
     * - Lambda: decorates logs with Lambda metadata and sends over stdout
     * - Agent: no decoration and sends over TCP
     * - EC2: decorates logs with EC2 metadata and sends over TCP
     */
    environmentOverride: Environments | undefined;
    /**
     * Sets the CloudWatch namespace that extracted metrics should be published to.
     */
    namespace: string;
}
