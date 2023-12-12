"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TenderlySimulator = exports.FallbackTenderlySimulator = void 0;
const constants_1 = require("@ethersproject/constants");
const universal_router_sdk_1 = require("@monocerus/universal-router-sdk");
const axios_1 = __importDefault(require("axios"));
const ethers_1 = require("ethers/lib/ethers");
const routers_1 = require("../routers");
const Erc20__factory_1 = require("../types/other/factories/Erc20__factory");
const Permit2__factory_1 = require("../types/other/factories/Permit2__factory");
const util_1 = require("../util");
const callData_1 = require("../util/callData");
const gas_factory_helpers_1 = require("../util/gas-factory-helpers");
const simulation_provider_1 = require("./simulation-provider");
const TENDERLY_BATCH_SIMULATE_API = (tenderlyBaseUrl, tenderlyUser, tenderlyProject) => `${tenderlyBaseUrl}/api/v1/account/${tenderlyUser}/project/${tenderlyProject}/simulate-batch`;
// We multiply tenderly gas limit by this to overestimate gas limit
const DEFAULT_ESTIMATE_MULTIPLIER = 1.25;
class FallbackTenderlySimulator extends simulation_provider_1.Simulator {
    constructor(chainId, provider, tenderlySimulator, ethEstimateGasSimulator) {
        super(provider, chainId);
        this.tenderlySimulator = tenderlySimulator;
        this.ethEstimateGasSimulator = ethEstimateGasSimulator;
    }
    async simulateTransaction(fromAddress, swapOptions, swapRoute, l2GasData) {
        // Make call to eth estimate gas if possible
        // For erc20s, we must check if the token allowance is sufficient
        const inputAmount = swapRoute.trade.inputAmount;
        if (inputAmount.currency.isNative ||
            (await this.checkTokenApproved(fromAddress, inputAmount, swapOptions, this.provider))) {
            util_1.log.info('Simulating with eth_estimateGas since token is native or approved.');
            try {
                const swapRouteWithGasEstimate = await this.ethEstimateGasSimulator.ethEstimateGas(fromAddress, swapOptions, swapRoute, l2GasData);
                return swapRouteWithGasEstimate;
            }
            catch (err) {
                util_1.log.info({ err: err }, 'Error simulating using eth_estimateGas');
                return Object.assign(Object.assign({}, swapRoute), { simulationStatus: simulation_provider_1.SimulationStatus.Failed });
            }
        }
        try {
            return await this.tenderlySimulator.simulateTransaction(fromAddress, swapOptions, swapRoute, l2GasData);
        }
        catch (err) {
            util_1.log.info({ err: err }, 'Failed to simulate via Tenderly');
            return Object.assign(Object.assign({}, swapRoute), { simulationStatus: simulation_provider_1.SimulationStatus.Failed });
        }
    }
}
exports.FallbackTenderlySimulator = FallbackTenderlySimulator;
class TenderlySimulator extends simulation_provider_1.Simulator {
    constructor(chainId, tenderlyBaseUrl, tenderlyUser, tenderlyProject, tenderlyAccessKey, v2PoolProvider, v3PoolProvider, provider, overrideEstimateMultiplier) {
        super(provider, chainId);
        this.tenderlyBaseUrl = tenderlyBaseUrl;
        this.tenderlyUser = tenderlyUser;
        this.tenderlyProject = tenderlyProject;
        this.tenderlyAccessKey = tenderlyAccessKey;
        this.v2PoolProvider = v2PoolProvider;
        this.v3PoolProvider = v3PoolProvider;
        this.overrideEstimateMultiplier = overrideEstimateMultiplier !== null && overrideEstimateMultiplier !== void 0 ? overrideEstimateMultiplier : {};
    }
    async simulateTransaction(fromAddress, swapOptions, swapRoute, l2GasData) {
        var _a;
        const currencyIn = swapRoute.trade.inputAmount.currency;
        const tokenIn = currencyIn.wrapped;
        const chainId = this.chainId;
        if (!swapRoute.methodParameters) {
            const msg = 'No calldata provided to simulate transaction';
            util_1.log.info(msg);
            throw new Error(msg);
        }
        const { calldata } = swapRoute.methodParameters;
        util_1.log.info({
            calldata: swapRoute.methodParameters.calldata,
            fromAddress: fromAddress,
            chainId: chainId,
            tokenInAddress: tokenIn.address,
            router: swapOptions.type,
        }, 'Simulating transaction on Tenderly');
        //const blockNumber = await providerConfig?.blockNumber;
        let estimatedGasUsed;
        const estimateMultiplier = (_a = this.overrideEstimateMultiplier[chainId]) !== null && _a !== void 0 ? _a : DEFAULT_ESTIMATE_MULTIPLIER;
        if (swapOptions.type == routers_1.SwapType.UNIVERSAL_ROUTER) {
            // Do initial onboarding approval of Permit2.
            const erc20Interface = Erc20__factory_1.Erc20__factory.createInterface();
            const approvePermit2Calldata = erc20Interface.encodeFunctionData('approve', [universal_router_sdk_1.PERMIT2_ADDRESS, constants_1.MaxUint256]);
            // We are unsure if the users calldata contains a permit or not. We just
            // max approve the Univeral Router from Permit2 instead, which will cover both cases.
            const permit2Interface = Permit2__factory_1.Permit2__factory.createInterface();
            const approveUniversalRouterCallData = permit2Interface.encodeFunctionData('approve', [
                tokenIn.address,
                (0, universal_router_sdk_1.UNIVERSAL_ROUTER_ADDRESS)(this.chainId),
                util_1.MAX_UINT160,
                Math.floor(new Date().getTime() / 1000) + 10000000,
            ]);
            const approvePermit2 = {
                network_id: chainId,
                gas_estimate: true,
                input: approvePermit2Calldata,
                to: tokenIn.address,
                value: '0',
                from: fromAddress,
            };
            const approveUniversalRouter = {
                network_id: chainId,
                gas_estimate: true,
                input: approveUniversalRouterCallData,
                to: universal_router_sdk_1.PERMIT2_ADDRESS,
                value: '0',
                from: fromAddress,
            };
            const swap = {
                network_id: chainId,
                input: calldata,
                gas_estimate: true,
                to: (0, universal_router_sdk_1.UNIVERSAL_ROUTER_ADDRESS)(this.chainId),
                value: currencyIn.isNative ? swapRoute.methodParameters.value : '0',
                from: fromAddress,
                // TODO: This is a Temporary fix given by Tenderly team, remove once resolved on their end.
                block_number: chainId == undefined,
            };
            const body = {
                simulations: [approvePermit2, approveUniversalRouter, swap],
                gas_estimate: true,
            };
            const opts = {
                headers: {
                    'X-Access-Key': this.tenderlyAccessKey,
                },
            };
            const url = TENDERLY_BATCH_SIMULATE_API(this.tenderlyBaseUrl, this.tenderlyUser, this.tenderlyProject);
            const resp = (await axios_1.default.post(url, body, opts)).data;
            // Validate tenderly response body
            if (!resp ||
                resp.simulation_results.length < 3 ||
                !resp.simulation_results[2].transaction ||
                resp.simulation_results[2].transaction.error_message) {
                this.logTenderlyErrorResponse(resp);
                return Object.assign(Object.assign({}, swapRoute), { simulationStatus: simulation_provider_1.SimulationStatus.Failed });
            }
            // Parse the gas used in the simulation response object, and then pad it so that we overestimate.
            estimatedGasUsed = ethers_1.BigNumber.from((resp.simulation_results[2].transaction.gas_used * estimateMultiplier).toFixed(0));
            util_1.log.info({
                body,
                approvePermit2GasUsed: resp.simulation_results[0].transaction.gas_used,
                approveUniversalRouterGasUsed: resp.simulation_results[1].transaction.gas_used,
                swapGasUsed: resp.simulation_results[2].transaction.gas_used,
                swapWithMultiplier: estimatedGasUsed.toString(),
            }, 'Successfully Simulated Approvals + Swap via Tenderly for Universal Router. Gas used.');
            util_1.log.info({ swapTransaction: resp.simulation_results[2].transaction }, 'Successful Tenderly Swap Transaction for Universal Router');
            util_1.log.info({ swapSimulation: resp.simulation_results[2].simulation }, 'Successful Tenderly Swap Simulation for Universal Router');
        }
        else if (swapOptions.type == routers_1.SwapType.SWAP_ROUTER_02) {
            const approve = {
                network_id: chainId,
                input: callData_1.APPROVE_TOKEN_FOR_TRANSFER,
                gas_estimate: true,
                to: tokenIn.address,
                value: '0',
                from: fromAddress,
            };
            const swap = {
                network_id: chainId,
                input: calldata,
                to: (0, util_1.SWAP_ROUTER_02_ADDRESSES)(chainId),
                gas_estimate: true,
                value: currencyIn.isNative ? swapRoute.methodParameters.value : '0',
                from: fromAddress,
                // TODO: This is a Temporary fix given by Tenderly team, remove once resolved on their end.
                block_number: chainId == undefined,
            };
            const body = { simulations: [approve, swap] };
            const opts = {
                headers: {
                    'X-Access-Key': this.tenderlyAccessKey,
                },
            };
            const url = TENDERLY_BATCH_SIMULATE_API(this.tenderlyBaseUrl, this.tenderlyUser, this.tenderlyProject);
            const resp = (await axios_1.default.post(url, body, opts)).data;
            // Validate tenderly response body
            if (!resp ||
                resp.simulation_results.length < 2 ||
                !resp.simulation_results[1].transaction ||
                resp.simulation_results[1].transaction.error_message) {
                const msg = `Failed to Simulate Via Tenderly!: ${resp.simulation_results[1].transaction.error_message}`;
                util_1.log.info({ err: resp.simulation_results[1].transaction.error_message }, msg);
                return Object.assign(Object.assign({}, swapRoute), { simulationStatus: simulation_provider_1.SimulationStatus.Failed });
            }
            // Parse the gas used in the simulation response object, and then pad it so that we overestimate.
            estimatedGasUsed = ethers_1.BigNumber.from((resp.simulation_results[1].transaction.gas_used * estimateMultiplier).toFixed(0));
            util_1.log.info({
                body,
                approveGasUsed: resp.simulation_results[0].transaction.gas_used,
                swapGasUsed: resp.simulation_results[1].transaction.gas_used,
                swapWithMultiplier: estimatedGasUsed.toString(),
            }, 'Successfully Simulated Approval + Swap via Tenderly for SwapRouter02. Gas used.');
            util_1.log.info({ swapTransaction: resp.simulation_results[1].transaction }, 'Successful Tenderly Swap Transaction for SwapRouter02');
            util_1.log.info({ swapSimulation: resp.simulation_results[1].simulation }, 'Successful Tenderly Swap Simulation for SwapRouter02');
        }
        else {
            throw new Error(`Unsupported swap type: ${swapOptions}`);
        }
        const { estimatedGasUsedUSD, estimatedGasUsedQuoteToken, quoteGasAdjusted, } = await (0, gas_factory_helpers_1.calculateGasUsed)(chainId, swapRoute, estimatedGasUsed, this.v2PoolProvider, this.v3PoolProvider, l2GasData);
        return Object.assign(Object.assign({}, (0, gas_factory_helpers_1.initSwapRouteFromExisting)(swapRoute, this.v2PoolProvider, this.v3PoolProvider, quoteGasAdjusted, estimatedGasUsed, estimatedGasUsedQuoteToken, estimatedGasUsedUSD)), { simulationStatus: simulation_provider_1.SimulationStatus.Succeeded });
    }
    logTenderlyErrorResponse(resp) {
        util_1.log.info({
            resp,
        }, 'Failed to Simulate on Tenderly');
        util_1.log.info({
            err: resp.simulation_results.length >= 1
                ? resp.simulation_results[0].transaction
                : {},
        }, 'Failed to Simulate on Tenderly #1 Transaction');
        util_1.log.info({
            err: resp.simulation_results.length >= 1
                ? resp.simulation_results[0].simulation
                : {},
        }, 'Failed to Simulate on Tenderly #1 Simulation');
        util_1.log.info({
            err: resp.simulation_results.length >= 2
                ? resp.simulation_results[1].transaction
                : {},
        }, 'Failed to Simulate on Tenderly #2 Transaction');
        util_1.log.info({
            err: resp.simulation_results.length >= 2
                ? resp.simulation_results[1].simulation
                : {},
        }, 'Failed to Simulate on Tenderly #2 Simulation');
        util_1.log.info({
            err: resp.simulation_results.length >= 3
                ? resp.simulation_results[2].transaction
                : {},
        }, 'Failed to Simulate on Tenderly #3 Transaction');
        util_1.log.info({
            err: resp.simulation_results.length >= 3
                ? resp.simulation_results[2].simulation
                : {},
        }, 'Failed to Simulate on Tenderly #3 Simulation');
    }
}
exports.TenderlySimulator = TenderlySimulator;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidGVuZGVybHktc2ltdWxhdGlvbi1wcm92aWRlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9wcm92aWRlcnMvdGVuZGVybHktc2ltdWxhdGlvbi1wcm92aWRlci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7QUFBQSx3REFBc0Q7QUFFdEQsMEVBR3lDO0FBQ3pDLGtEQUEwQjtBQUMxQiw4Q0FBOEM7QUFFOUMsd0NBQThEO0FBQzlELDRFQUF5RTtBQUN6RSxnRkFBNkU7QUFDN0Usa0NBQThFO0FBQzlFLCtDQUE4RDtBQUM5RCxxRUFHcUM7QUFHckMsK0RBSStCO0FBdUIvQixNQUFNLDJCQUEyQixHQUFHLENBQ2xDLGVBQXVCLEVBQ3ZCLFlBQW9CLEVBQ3BCLGVBQXVCLEVBQ3ZCLEVBQUUsQ0FDRixHQUFHLGVBQWUsbUJBQW1CLFlBQVksWUFBWSxlQUFlLGlCQUFpQixDQUFDO0FBRWhHLG1FQUFtRTtBQUNuRSxNQUFNLDJCQUEyQixHQUFHLElBQUksQ0FBQztBQUV6QyxNQUFhLHlCQUEwQixTQUFRLCtCQUFTO0lBR3RELFlBQ0UsT0FBZ0IsRUFDaEIsUUFBeUIsRUFDekIsaUJBQW9DLEVBQ3BDLHVCQUFnRDtRQUVoRCxLQUFLLENBQUMsUUFBUSxFQUFFLE9BQU8sQ0FBQyxDQUFDO1FBQ3pCLElBQUksQ0FBQyxpQkFBaUIsR0FBRyxpQkFBaUIsQ0FBQztRQUMzQyxJQUFJLENBQUMsdUJBQXVCLEdBQUcsdUJBQXVCLENBQUM7SUFDekQsQ0FBQztJQUVTLEtBQUssQ0FBQyxtQkFBbUIsQ0FDakMsV0FBbUIsRUFDbkIsV0FBd0IsRUFDeEIsU0FBb0IsRUFDcEIsU0FBd0I7UUFFeEIsNENBQTRDO1FBQzVDLGlFQUFpRTtRQUNqRSxNQUFNLFdBQVcsR0FBRyxTQUFTLENBQUMsS0FBSyxDQUFDLFdBQVcsQ0FBQztRQUVoRCxJQUNFLFdBQVcsQ0FBQyxRQUFRLENBQUMsUUFBUTtZQUM3QixDQUFDLE1BQU0sSUFBSSxDQUFD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