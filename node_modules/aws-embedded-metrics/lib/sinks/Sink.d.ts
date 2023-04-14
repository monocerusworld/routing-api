import { MetricsContext } from '../logger/MetricsContext';
/**
 * An interface used to emit metric logs.
 */
export interface ISink {
    /**
     * The name of the sink.
     */
    readonly name: string;
    /**
     * Flushes the metrics context to the sink.
     * @param context
     */
    accept(context: MetricsContext): Promise<void>;
}
