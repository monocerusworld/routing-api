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
var MetricsLogger_1 = require("./logger/MetricsLogger");
exports.MetricsLogger = MetricsLogger_1.MetricsLogger;
var ConsoleSink_1 = require("./sinks/ConsoleSink");
exports.LocalSink = ConsoleSink_1.ConsoleSink;
var AgentSink_1 = require("./sinks/AgentSink");
exports.AgentSink = AgentSink_1.AgentSink;
var MetricScope_1 = require("./logger/MetricScope");
exports.metricScope = MetricScope_1.metricScope;
var MetricsLoggerFactory_1 = require("./logger/MetricsLoggerFactory");
exports.createMetricsLogger = MetricsLoggerFactory_1.createMetricsLogger;
var Unit_1 = require("./logger/Unit");
exports.Unit = Unit_1.Unit;
const Configuration_1 = require("./config/Configuration");
exports.Configuration = Configuration_1.default;
