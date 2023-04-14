/// <reference types="node" />
import { IEndpoint } from './IEndpoint';
import { ISocketClient } from './ISocketClient';
export declare class UdpClient implements ISocketClient {
    private endpoint;
    constructor(endpoint: IEndpoint);
    warmup(): Promise<void>;
    sendMessage(message: Buffer): Promise<void>;
}
