import { MetricValues } from './MetricValues';
import { Unit } from './Unit';
interface IProperties {
    [s: string]: unknown;
}
declare type Metrics = Map<string, MetricValues>;
export declare class MetricsContext {
    /**
     * Use this to create a new, empty context.
     */
    static empty(): MetricsContext;
    namespace: string;
    properties: IProperties;
    metrics: Metrics;
    meta: Record<string, string | number>;
    private dimensions;
    private defaultDimensions;
    private shouldUseDefaultDimensions;
    private timestamp;
    /**
     * Constructor used to create child instances.
     * You should not use this constructor directly.
     * Instead, use createCopyWithContext() or empty().
     *
     * The reason for this is to avoid unexpected behavior when creating
     * MetricsContexts with defaultDimensions and existing dimensions.
     *
     * @param properties
     * @param dimensions
     */
    private constructor();
    private static resolveMetaTimestamp;
    setNamespace(value: string): void;
    setProperty(key: string, value: unknown): void;
    setTimestamp(timestamp: Date | number): void;
    /**
     * Sets default dimensions for the Context.
     * A dimension set will be created with just the default dimensions
     * and all calls to putDimensions will be prepended with the defaults.
     */
    setDefaultDimensions(dimensions: Record<string, string>): void;
    /**
     * Adds a new set of dimensions. Any time a new dimensions set
     * is added, the set is first prepended by the default dimensions.
     *
     * @param dimensions
     */
    putDimensions(incomingDimensionSet: Record<string, string>): void;
    /**
     * Overwrite all dimensions.
     *
     * @param dimensionSets
     */
    setDimensions(dimensionSets: Array<Record<string, string>>): void;
    /**
     * Get the current dimensions.
     */
    getDimensions(): Array<Record<string, string>>;
    putMetric(key: string, value: number, unit?: Unit | string): void;
    /**
     * Creates an independently flushable context.
     */
    createCopyWithContext(): MetricsContext;
}
export {};
