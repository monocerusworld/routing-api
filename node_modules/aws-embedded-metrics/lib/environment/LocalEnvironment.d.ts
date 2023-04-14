import { ISink } from '../sinks/Sink';
import { IEnvironment } from './IEnvironment';
export declare class LocalEnvironment implements IEnvironment {
    private sink;
    probe(): Promise<boolean>;
    getName(): string;
    getType(): string;
    getLogGroupName(): string;
    configureContext(): void;
    getSink(): ISink;
}
