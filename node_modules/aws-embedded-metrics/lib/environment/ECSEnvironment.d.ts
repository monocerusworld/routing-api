import { MetricsContext } from '../logger/MetricsContext';
import { ISink } from '../sinks/Sink';
import { IEnvironment } from './IEnvironment';
export declare class ECSEnvironment implements IEnvironment {
    private sink;
    private metadata;
    private fluentBitEndpoint;
    probe(): Promise<boolean>;
    getName(): string;
    getType(): string;
    getLogGroupName(): string;
    configureContext(context: MetricsContext): void;
    getSink(): ISink;
    private addProperty;
}
