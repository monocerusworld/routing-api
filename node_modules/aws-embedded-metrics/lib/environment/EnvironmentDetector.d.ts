import { IEnvironment } from './IEnvironment';
declare type EnvironmentProvider = () => Promise<IEnvironment>;
declare const resolveEnvironment: EnvironmentProvider;
declare const cleanResolveEnvironment: () => Promise<IEnvironment>;
export { EnvironmentProvider, resolveEnvironment, cleanResolveEnvironment };
