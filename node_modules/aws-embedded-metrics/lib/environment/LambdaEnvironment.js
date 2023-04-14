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
const ConsoleSink_1 = require("../sinks/ConsoleSink");
class LambdaEnvironment {
    probe() {
        return Promise.resolve(process.env.AWS_LAMBDA_FUNCTION_NAME ? true : false);
    }
    getName() {
        return process.env.AWS_LAMBDA_FUNCTION_NAME || 'Unknown';
    }
    getType() {
        return 'AWS::Lambda::Function';
    }
    getLogGroupName() {
        return this.getName();
    }
    configureContext(context) {
        this.addProperty(context, 'executionEnvironment', process.env.AWS_EXECUTION_ENV);
        this.addProperty(context, 'memorySize', process.env.AWS_LAMBDA_FUNCTION_MEMORY_SIZE);
        this.addProperty(context, 'functionVersion', process.env.AWS_LAMBDA_FUNCTION_VERSION);
        this.addProperty(context, 'logStreamId', process.env.AWS_LAMBDA_LOG_STREAM_NAME);
        const trace = this.getSampledTrace();
        if (trace) {
            this.addProperty(context, 'traceId', trace);
        }
    }
    getSink() {
        if (!this.sink) {
            this.sink = new ConsoleSink_1.ConsoleSink();
        }
        return this.sink;
    }
    addProperty(context, key, value) {
        if (value) {
            context.setProperty(key, value);
        }
    }
    getSampledTrace() {
        // only collect traces which have been sampled
        if (process.env._X_AMZN_TRACE_ID && process.env._X_AMZN_TRACE_ID.includes('Sampled=1')) {
            return process.env._X_AMZN_TRACE_ID;
        }
    }
}
exports.LambdaEnvironment = LambdaEnvironment;
