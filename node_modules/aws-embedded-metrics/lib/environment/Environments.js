"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var Environments;
(function (Environments) {
    Environments["Local"] = "Local";
    Environments["Lambda"] = "Lambda";
    Environments["Agent"] = "Agent";
    Environments["EC2"] = "EC2";
    Environments["ECS"] = "ECS";
    Environments["Unknown"] = "";
})(Environments || (Environments = {}));
exports.default = Environments;
