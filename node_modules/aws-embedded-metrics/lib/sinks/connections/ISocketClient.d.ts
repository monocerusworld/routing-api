/// <reference types="node" />
export interface ISocketClient {
    warmup(): Promise<void>;
    sendMessage(message: Buffer): Promise<void>;
}
