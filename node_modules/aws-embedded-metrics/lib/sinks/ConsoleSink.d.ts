import { MetricsContext } from '../logger/MetricsContext';
import { ISerializer } from '../serializers/Serializer';
import { ISink } from './Sink';
/**
 * A sink that flushes log data to stdout.
 * This is the preferred sink for Lambda functions.
 */
export declare class ConsoleSink implements ISink {
    readonly name: string;
    private serializer;
    constructor(serializer?: ISerializer);
    accept(context: MetricsContext): Promise<void>;
}
