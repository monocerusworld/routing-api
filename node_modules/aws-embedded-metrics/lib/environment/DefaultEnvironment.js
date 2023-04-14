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
const AgentSink_1 = require("../sinks/AgentSink");
const Logger_1 = require("../utils/Logger");
class DefaultEnvironment {
    probe() {
        return Promise.resolve(true);
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
        // if the caller explicitly overrides logGroupName to
        // be empty, we should honor that rather than providing
        // the default behavior.
        if (Configuration_1.default.logGroupName === '') {
            return '';
        }
        return Configuration_1.default.logGroupName ? Configuration_1.default.logGroupName : `${this.getName()}-metrics`;
    }
    configureContext() {
        // no-op
    }
    getSink() {
        if (!this.sink) {
            this.sink = new AgentSink_1.AgentSink(this.getLogGroupName(), Configuration_1.default.logStreamName);
        }
        return this.sink;
    }
}
exports.DefaultEnvironment = DefaultEnvironment;
