"use strict";
/*
 * Copyright 2019 Amazon.com, Inc. or its affiliates.
 * Licensed under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const url = require("url");
const Configuration_1 = require("../config/Configuration");
const LogSerializer_1 = require("../serializers/LogSerializer");
const Logger_1 = require("../utils/Logger");
const TcpClient_1 = require("./connections/TcpClient");
const UdpClient_1 = require("./connections/UdpClient");
const TCP = 'tcp:';
const UDP = 'udp:';
const defaultTcpEndpoint = {
    host: '0.0.0.0',
    port: 25888,
    protocol: TCP,
};
const parseEndpoint = (endpoint) => {
    try {
        if (!endpoint) {
            return defaultTcpEndpoint;
        }
        const parsedUrl = url.parse(endpoint);
        if (!parsedUrl.hostname || !parsedUrl.port || !parsedUrl.protocol) {
            Logger_1.LOG(`Failed to parse the provided agent endpoint. Falling back to the default TCP endpoint.`, parsedUrl);
            return defaultTcpEndpoint;
        }
        if (parsedUrl.protocol !== TCP && parsedUrl.protocol !== UDP) {
            Logger_1.LOG(`The provided agent endpoint protocol '${parsedUrl.protocol}' is not supported. Please use TCP or UDP. Falling back to the default TCP endpoint.`, parsedUrl);
            return defaultTcpEndpoint;
        }
        return {
            host: parsedUrl.hostname,
            port: Number(parsedUrl.port),
            protocol: parsedUrl.protocol,
        };
    }
    catch (e) {
        Logger_1.LOG('Failed to parse the provided agent endpoint', e);
        return defaultTcpEndpoint;
    }
};
/**
 * A sink that flushes to the CW Agent.
 * This sink instance should be re-used to avoid
 * leaking connections.
 */
class AgentSink {
    constructor(logGroupName, logStreamName, serializer) {
        this.name = 'AgentSink';
        this.logGroupName = logGroupName;
        this.logStreamName = logStreamName;
        this.serializer = serializer || new LogSerializer_1.LogSerializer();
        this.endpoint = parseEndpoint(Configuration_1.default.agentEndpoint);
        this.socketClient = this.getSocketClient(this.endpoint);
        Logger_1.LOG('Using socket client', this.socketClient.constructor.name);
    }
    accept(context) {
        return __awaiter(this, void 0, void 0, function* () {
            if (this.logGroupName) {
                context.meta.LogGroupName = this.logGroupName;
            }
            if (this.logStreamName) {
                context.meta.LogStreamName = this.logStreamName;
            }
            const events = this.serializer.serialize(context);
            Logger_1.LOG(`Sending {} events to socket.`, events.length);
            for (let index = 0; index < events.length; index++) {
                const event = events[index];
                const message = event + '\n';
                const bytes = Buffer.from(message);
                yield this.socketClient.sendMessage(bytes);
            }
        });
    }
    getSocketClient(endpoint) {
        Logger_1.LOG('Getting socket client for connection.', endpoint);
        const client = endpoint.protocol === TCP ? new TcpClient_1.TcpClient(endpoint) : new UdpClient_1.UdpClient(endpoint);
        client.warmup();
        return client;
    }
}
exports.AgentSink = AgentSink;
