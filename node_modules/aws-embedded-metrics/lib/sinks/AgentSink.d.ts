import { MetricsContext } from '../logger/MetricsContext';
import { ISerializer } from '../serializers/Serializer';
import { ISink } from './Sink';
/**
 * A sink that flushes to the CW Agent.
 * This sink instance should be re-used to avoid
 * leaking connections.
 */
export declare class AgentSink implements ISink {
    readonly name: string;
    private readonly serializer;
    private readonly endpoint;
    private readonly logGroupName;
    private readonly logStreamName;
    private readonly socketClient;
    constructor(logGroupName: string, logStreamName?: string, serializer?: ISerializer);
    accept(context: MetricsContext): Promise<void>;
    private getSocketClient;
}
