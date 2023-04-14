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
const Constants_1 = require("../Constants");
const Environments_1 = require("../environment/Environments");
const ENV_VAR_PREFIX = 'AWS_EMF';
var ConfigKeys;
(function (ConfigKeys) {
    ConfigKeys["LOG_GROUP_NAME"] = "LOG_GROUP_NAME";
    ConfigKeys["LOG_STREAM_NAME"] = "LOG_STREAM_NAME";
    ConfigKeys["ENABLE_DEBUG_LOGGING"] = "ENABLE_DEBUG_LOGGING";
    ConfigKeys["SERVICE_NAME"] = "SERVICE_NAME";
    ConfigKeys["SERVICE_TYPE"] = "SERVICE_TYPE";
    ConfigKeys["AGENT_ENDPOINT"] = "AGENT_ENDPOINT";
    ConfigKeys["ENVIRONMENT_OVERRIDE"] = "ENVIRONMENT";
    ConfigKeys["NAMESPACE"] = "NAMESPACE";
})(ConfigKeys || (ConfigKeys = {}));
class EnvironmentConfigurationProvider {
    getConfiguration() {
        return {
            agentEndpoint: this.getEnvVariable(ConfigKeys.AGENT_ENDPOINT),
            debuggingLoggingEnabled: this.tryGetEnvVariableAsBoolean(ConfigKeys.ENABLE_DEBUG_LOGGING, false),
            logGroupName: this.getEnvVariable(ConfigKeys.LOG_GROUP_NAME),
            logStreamName: this.getEnvVariable(ConfigKeys.LOG_STREAM_NAME),
            serviceName: this.getEnvVariable(ConfigKeys.SERVICE_NAME) || this.getEnvVariableWithoutPrefix(ConfigKeys.SERVICE_NAME),
            serviceType: this.getEnvVariable(ConfigKeys.SERVICE_TYPE) || this.getEnvVariableWithoutPrefix(ConfigKeys.SERVICE_TYPE),
            environmentOverride: this.getEnvironmentOverride(),
            namespace: this.getEnvVariable(ConfigKeys.NAMESPACE) || Constants_1.Constants.DEFAULT_NAMESPACE,
        };
    }
    getEnvVariableWithoutPrefix(configKey) {
        return process.env[configKey];
    }
    getEnvVariable(configKey) {
        return process.env[`${ENV_VAR_PREFIX}_${configKey}`];
    }
    tryGetEnvVariableAsBoolean(configKey, fallback) {
        const configValue = this.getEnvVariable(configKey);
        return !configValue ? fallback : configValue.toLowerCase() === 'true';
    }
    getEnvironmentOverride() {
        const overrideValue = this.getEnvVariable(ConfigKeys.ENVIRONMENT_OVERRIDE);
        const environment = Environments_1.default[overrideValue];
        if (environment === undefined) {
            return Environments_1.default.Unknown;
        }
        return environment;
    }
}
exports.EnvironmentConfigurationProvider = EnvironmentConfigurationProvider;
