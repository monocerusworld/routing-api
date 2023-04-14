import { EnvironmentProvider } from '../environment/EnvironmentDetector';
import { MetricsContext } from './MetricsContext';
import { Unit } from './Unit';
/**
 * An async metrics logger.
 * Use this interface to publish logs to CloudWatch Logs
 * and extract metrics to CloudWatch Metrics asynchronously.
 */
export declare class MetricsLogger {
    private context;
    private resolveEnvironment;
    constructor(resolveEnvironment: EnvironmentProvider, context?: MetricsContext);
    /**
     * Flushes the current context state to the configured sink.
     */
    flush(): Promise<void>;
    /**
     * Set a property on the published metrics.
     * This is stored in the emitted log data and you are not
     * charged for this data by CloudWatch Metrics.
     * These values can be values that are useful for searching on,
     * but have too high cardinality to emit as dimensions to
     * CloudWatch Metrics.
     *
     * @param key Property name
     * @param value Property value
     */
    setProperty(key: string, value: unknown): MetricsLogger;
    /**
     * Adds a dimension.
     * This is generally a low cardinality key-value pair that is part of the metric identity.
     * CloudWatch treats each unique combination of dimensions as a separate metric, even if the metrics have the same metric name.
     *
     * @param dimension
     * @param value
     * @see [CloudWatch Dimensions](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/cloudwatch_concepts.html#Dimension)
     */
    putDimensions(dimensions: Record<string, string>): MetricsLogger;
    /**
     * Overwrite all dimensions on this MetricsLogger instance.
     *
     * @param dimensionSets
     * @see [CloudWatch Dimensions](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/cloudwatch_concepts.html#Dimension)
     */
    setDimensions(...dimensionSets: Array<Record<string, string>>): MetricsLogger;
    /**
     * Put a metric value.
     * This value will be emitted to CloudWatch Metrics asyncronously and does not contribute to your
     * account TPS limits. The value will also be available in your CloudWatch Logs
     * @param key
     * @param value
     * @param unit
     */
    putMetric(key: string, value: number, unit?: Unit | string): MetricsLogger;
    /**
     * Set the CloudWatch namespace that metrics should be published to.
     * @param value
     */
    setNamespace(value: string): MetricsLogger;
    /**
     * Set the timestamp of metrics emitted in this context.
     *
     * If not set, the timestamp will default to new Date() at the point
     * the context is constructed.
     *
     * If set, timestamp will preserved across calls to flush().
     *
     * @param timestamp
     */
    setTimestamp(timestamp: Date | number): MetricsLogger;
    /**
     * Creates a new logger using the same contextual data as
     * the previous logger. This allows you to flush the instances
     * independently.
     */
    new(): MetricsLogger;
    private configureContextForEnvironment;
}
