import { MetricsContext } from '../logger/MetricsContext';
export interface ISerializer {
    /**
     * Serialize the provided metrics context to a JSON string.
     *
     * @param context The MetricsContext
     */
    serialize(context: MetricsContext): string[];
}
