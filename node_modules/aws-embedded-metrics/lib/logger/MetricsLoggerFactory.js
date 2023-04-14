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
const __1 = require("..");
const EnvironmentDetector_1 = require("../environment/EnvironmentDetector");
const MetricsContext_1 = require("./MetricsContext");
const createMetricsLogger = () => {
    const context = MetricsContext_1.MetricsContext.empty();
    const logger = new __1.MetricsLogger(EnvironmentDetector_1.resolveEnvironment, context);
    return logger;
};
exports.createMetricsLogger = createMetricsLogger;
