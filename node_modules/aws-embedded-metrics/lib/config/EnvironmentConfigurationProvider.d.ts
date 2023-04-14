import { IConfiguration } from './IConfiguration';
import Environments from '../environment/Environments';
export declare class EnvironmentConfigurationProvider {
    getConfiguration(): IConfiguration;
    private getEnvVariableWithoutPrefix;
    private getEnvVariable;
    private tryGetEnvVariableAsBoolean;
    getEnvironmentOverride(): Environments;
}
