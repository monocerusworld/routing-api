import { MetricsContext } from '../logger/MetricsContext';
import { ISerializer } from './Serializer';
/**
 * Serializes the provided context to the CWL Structured
 * Logs format with Embedded Metric Filters.
 */
export declare class LogSerializer implements ISerializer {
    /**
     * Retrieve the current context as a JSON string
     */
    serialize(context: MetricsContext): string[];
}
