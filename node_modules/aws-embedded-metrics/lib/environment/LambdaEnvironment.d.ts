import { MetricsContext } from '../logger/MetricsContext';
import { ISink } from '../sinks/Sink';
import { IEnvironment } from './IEnvironment';
export declare class LambdaEnvironment implements IEnvironment {
    private sink;
    probe(): Promise<boolean>;
    getName(): string;
    getType(): string;
    getLogGroupName(): string;
    configureContext(context: MetricsContext): void;
    getSink(): ISink;
    private addProperty;
    private getSampledTrace;
}
