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
const Logger_1 = require("../utils/Logger");
const DefaultEnvironment_1 = require("./DefaultEnvironment");
const ECSEnvironment_1 = require("./ECSEnvironment");
const EC2Environment_1 = require("./EC2Environment");
const LambdaEnvironment_1 = require("./LambdaEnvironment");
const Configuration_1 = require("../config/Configuration");
const Environments_1 = require("./Environments");
const LocalEnvironment_1 = require("./LocalEnvironment");
const lambdaEnvironment = new LambdaEnvironment_1.LambdaEnvironment();
const ecsEnvironment = new ECSEnvironment_1.ECSEnvironment();
const ec2Environment = new EC2Environment_1.EC2Environment();
const defaultEnvironment = new DefaultEnvironment_1.DefaultEnvironment();
// ordering of this array matters
// both Lambda and ECS can be determined from environment variables
// making the entire detection process fast an cheap
// EC2 can only be determined by making a remote HTTP request
const environments = [lambdaEnvironment, ecsEnvironment, ec2Environment];
let environment = undefined;
const getEnvironmentFromOverride = () => {
    // short-circuit environment detection and use override
    switch (Configuration_1.default.environmentOverride) {
        case Environments_1.default.Agent:
            return defaultEnvironment;
        case Environments_1.default.EC2:
            return ec2Environment;
        case Environments_1.default.Lambda:
            return lambdaEnvironment;
        case Environments_1.default.ECS:
            return ecsEnvironment;
        case Environments_1.default.Local:
            return new LocalEnvironment_1.LocalEnvironment();
        case Environments_1.default.Unknown:
        default:
            return undefined;
    }
};
const discoverEnvironment = () => __awaiter(void 0, void 0, void 0, function* () {
    Logger_1.LOG(`Discovering environment`);
    for (const envUnderTest of environments) {
        Logger_1.LOG(`Testing: ${envUnderTest.constructor.name}`);
        try {
            if (yield envUnderTest.probe()) {
                return envUnderTest;
            }
        }
        catch (e) {
            Logger_1.LOG(`Failed probe: ${envUnderTest.constructor.name}`);
        }
    }
    return defaultEnvironment;
});
const _resolveEnvironment = () => __awaiter(void 0, void 0, void 0, function* () {
    Logger_1.LOG('Resolving environment');
    if (environment) {
        return environment;
    }
    if (Configuration_1.default.environmentOverride) {
        Logger_1.LOG('Environment override supplied', Configuration_1.default.environmentOverride);
        // this will be falsy if an invalid configuration value is provided
        environment = getEnvironmentFromOverride();
        if (environment) {
            return environment;
        }
        else {
            Logger_1.LOG('Invalid environment provided. Falling back to auto-discovery.', Configuration_1.default.environmentOverride);
        }
    }
    environment = yield discoverEnvironment(); // eslint-disable-line require-atomic-updates
    return environment;
});
// pro-actively begin resolving the environment
// this will allow us to kick off any async tasks
// at module load time to reduce any blocking that
// may occur on the initial flush()
const environmentPromise = _resolveEnvironment();
const resolveEnvironment = () => __awaiter(void 0, void 0, void 0, function* () {
    return environmentPromise;
});
exports.resolveEnvironment = resolveEnvironment;
// this method is used for testing to bypass the cached environmentPromise result
const cleanResolveEnvironment = () => __awaiter(void 0, void 0, void 0, function* () {
    yield environmentPromise;
    environment = undefined;
    return yield _resolveEnvironment();
});
exports.cleanResolveEnvironment = cleanResolveEnvironment;
