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
Object.defineProperty(exports, "__esModule", { value: true });
const Configuration_1 = require("../config/Configuration");
const Logger_1 = require("../utils/Logger");
const ConsoleSink_1 = require("../sinks/ConsoleSink");
class LocalEnvironment {
    probe() {
        // probe is not intended to be used in the LocalEnvironment
        // To use the local environment you should set the environment
        // override
        return Promise.resolve(false);
    }
    getName() {
        if (!Configuration_1.default.serviceName) {
            Logger_1.LOG('Unknown ServiceName.');
            return 'Unknown';
        }
        return Configuration_1.default.serviceName;
    }
    getType() {
        if (!Configuration_1.default.serviceType) {
            Logger_1.LOG('Unknown ServiceType.');
            return 'Unknown';
        }
        return Configuration_1.default.serviceType;
    }
    getLogGroupName() {
        return Configuration_1.default.logGroupName ? Configuration_1.default.logGroupName : `${this.getName()}-metrics`;
    }
    configureContext() {
        // no-op
    }
    getSink() {
        if (!this.sink) {
            this.sink = new ConsoleSink_1.ConsoleSink();
        }
        return this.sink;
    }
}
exports.LocalEnvironment = LocalEnvironment;
