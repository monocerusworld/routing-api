"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.V3HeuristicGasModelFactory = void 0;
const bignumber_1 = require("@ethersproject/bignumber");
const sdk_core_1 = require("@uniswap/sdk-core");
const lodash_1 = __importDefault(require("lodash"));
const __1 = require("../../../..");
const util_1 = require("../../../../util");
const amounts_1 = require("../../../../util/amounts");
const gas_factory_helpers_1 = require("../../../../util/gas-factory-helpers");
const log_1 = require("../../../../util/log");
const methodParameters_1 = require("../../../../util/methodParameters");
const gas_model_1 = require("../gas-model");
const gas_costs_1 = require("./gas-costs");
/**
 * Computes a gas estimate for a V3 swap using heuristics.
 * Considers number of hops in the route, number of ticks crossed
 * and the typical base cost for a swap.
 *
 * We get the number of ticks crossed in a swap from the QuoterV2
 * contract.
 *
 * We compute gas estimates off-chain because
 *  1/ Calling eth_estimateGas for a swaps requires the caller to have
 *     the full balance token being swapped, and approvals.
 *  2/ Tracking gas used using a wrapper contract is not accurate with Multicall
 *     due to EIP-2929. We would have to make a request for every swap we wanted to estimate.
 *  3/ For V2 we simulate all our swaps off-chain so have no way to track gas used.
 *
 * @export
 * @class V3HeuristicGasModelFactory
 */
class V3HeuristicGasModelFactory extends gas_model_1.IOnChainGasModelFactory {
    constructor() {
        super();
    }
    async buildGasModel({ chainId, gasPriceWei, v3poolProvider: poolProvider, amountToken, quoteToken, l2GasDataProvider, }) {
        const l2GasData = l2GasDataProvider
            ? await l2GasDataProvider.getGasData()
            : undefined;
        const usdPool = await (0, gas_factory_helpers_1.getHighestLiquidityV3USDPool)(chainId, poolProvider);
        const calculateL1GasFees = async (route) => {
            const swapOptions = {
                type: __1.SwapType.UNIVERSAL_ROUTER,
                recipient: '0x0000000000000000000000000000000000000001',
                deadlineOrPreviousBlockhash: 100,
                slippageTolerance: new sdk_core_1.Percent(5, 10000),
            };
            let l1Used = bignumber_1.BigNumber.from(0);
            let l1FeeInWei = bignumber_1.BigNumber.from(0);
            if (chainId == util_1.ChainId.MANTA ||
                chainId == util_1.ChainId.MANTA_TESTNET) {
                [l1Used, l1FeeInWei] = this.calculateMantaToL1SecurityFee(route, swapOptions, l2GasData);
            }
            // wrap fee to native currency
            const nativeCurrency = __1.WRAPPED_NATIVE_CURRENCY[chainId];
            const costNativeCurrency = amounts_1.CurrencyAmount.fromRawAmount(nativeCurrency, l1FeeInWei.toString());
            // convert fee into usd
            const nativeTokenPrice = usdPool.token0.address == nativeCurrency.address
                ? usdPool.token0Price
                : usdPool.token1Price;
            const gasCostL1USD = nativeTokenPrice.quote(costNativeCurrency);
            let gasCostL1QuoteToken = costNativeCurrency;
            // if the inputted token is not in the native currency, quote a native/quote token pool to get the gas cost in terms of the quote token
            if (!quoteToken.equals(nativeCurrency)) {
                const nativePool = await (0, gas_factory_helpers_1.getHighestLiquidityV3NativePool)(quoteToken, poolProvider);
                if (!nativePool) {
                    log_1.log.info('Could not find a pool to convert the cost into the quote token');
                    gasCostL1QuoteToken = amounts_1.CurrencyAmount.fromRawAmount(quoteToken, 0);
                }
                else {
                    const nativeTokenPrice = nativePool.token0.address == nativeCurrency.address
                        ? nativePool.token0Price
                        : nativePool.token1Price;
                    gasCostL1QuoteToken = nativeTokenPrice.quote(costNativeCurrency);
                }
            }
            // gasUsedL1 is the gas units used calculated from the bytes of the calldata
            // gasCostL1USD and gasCostL1QuoteToken is the cost of gas in each of those tokens
            return {
                gasUsedL1: l1Used,
                gasCostL1USD,
                gasCostL1QuoteToken,
            };
        };
        // If our quote token is WETH, we don't need to convert our gas use to be in terms
        // of the quote token in order to produce a gas adjusted amount.
        // We do return a gas use in USD however, so we still convert to usd.
        const nativeCurrency = __1.WRAPPED_NATIVE_CURRENCY[chainId];
        if (quoteToken.equals(nativeCurrency)) {
            const estimateGasCost = (routeWithValidQuote) => {
                const { totalGasCostNativeCurrency, baseGasUse } = this.estimateGas(routeWithValidQuote, gasPriceWei, chainId);
                const token0 = usdPool.token0.address == nativeCurrency.address;
                const nativeTokenPrice = token0
                    ? usdPool.token0Price
                    : usdPool.token1Price;
                const gasCostInTermsOfUSD = nativeTokenPrice.quote(totalGasCostNativeCurrency);
                return {
                    gasEstimate: baseGasUse,
                    gasCostInToken: totalGasCostNativeCurrency,
                    gasCostInUSD: gasCostInTermsOfUSD,
                };
            };
            return {
                estimateGasCost,
                calculateL1GasFees,
            };
        }
        // If the quote token is not in the native currency, we convert the gas cost to be in terms of the quote token.
        // We do this by getting the highest liquidity <quoteToken>/<nativeCurrency> pool. eg. <quoteToken>/ETH pool.
        const nativePool = await (0, gas_factory_helpers_1.getHighestLiquidityV3NativePool)(quoteToken, poolProvider);
        let nativeAmountPool = null;
        if (!amountToken.equals(nativeCurrency)) {
            nativeAmountPool = await (0, gas_factory_helpers_1.getHighestLiquidityV3NativePool)(amountToken, poolProvider);
        }
        const usdToken = usdPool.token0.address == nativeCurrency.address
            ? usdPool.token1
            : usdPool.token0;
        const estimateGasCost = (routeWithValidQuote) => {
            const { totalGasCostNativeCurrency, baseGasUse } = this.estimateGas(routeWithValidQuote, gasPriceWei, chainId);
            let gasCostInTermsOfQuoteToken = null;
            if (nativePool) {
                const token0 = nativePool.token0.address == nativeCurrency.address;
                // returns mid price in terms of the native currency (the ratio of quoteToken/nativeToken)
                const nativeTokenPrice = token0
                    ? nativePool.token0Price
                    : nativePool.token1Price;
                try {
                    // native token is base currency
                    gasCostInTermsOfQuoteToken = nativeTokenPrice.quote(totalGasCostNativeCurrency);
                }
                catch (err) {
                    log_1.log.info({
                        nativeTokenPriceBase: nativeTokenPrice.baseCurrency,
                        nativeTokenPriceQuote: nativeTokenPrice.quoteCurrency,
                        gasCostInEth: totalGasCostNativeCurrency.currency,
                    }, 'Debug eth price token issue');
                    throw err;
                }
            }
            // we have a nativeAmountPool, but not a nativePool
            else {
                log_1.log.info(`Unable to find ${nativeCurrency.symbol} pool with the quote token, ${quoteToken.symbol} to produce gas adjusted costs. Using amountToken to calculate gas costs.`);
            }
            // Highest liquidity pool for the non quote token / ETH
            // A pool with the non quote token / ETH should not be required and errors should be handled separately
            if (nativeAmountPool) {
                // get current execution price (amountToken / quoteToken)
                const executionPrice = new sdk_core_1.Price(routeWithValidQuote.amount.currency, routeWithValidQuote.quote.currency, routeWithValidQuote.amount.quotient, routeWithValidQuote.quote.quotient);
                const inputIsToken0 = nativeAmountPool.token0.address == nativeCurrency.address;
                // ratio of input / native
                const nativeAmountTokenPrice = inputIsToken0
                    ? nativeAmountPool.token0Price
                    : nativeAmountPool.token1Price;
                const gasCostInTermsOfAmountToken = nativeAmountTokenPrice.quote(totalGasCostNativeCurrency);
                // Convert gasCostInTermsOfAmountToken to quote token using execution price
                const syntheticGasCostInTermsOfQuoteToken = executionPrice.quote(gasCostInTermsOfAmountToken);
                // Note that the syntheticGasCost being lessThan the original quoted value is not always strictly better
                // e.g. the scenario where the amountToken/ETH pool is very illiquid as well and returns an extremely small number
                // however, it is better to have the gasEstimation be almost 0 than almost infinity, as the user will still receive a quote
                if (gasCostInTermsOfQuoteToken === null ||
                    syntheticGasCostInTermsOfQuoteToken.lessThan(gasCostInTermsOfQuoteToken.asFraction)) {
                    log_1.log.info({
                        nativeAmountTokenPrice: nativeAmountTokenPrice.toSignificant(6),
                        gasCostInTermsOfQuoteToken: gasCostInTermsOfQuoteToken
                            ? gasCostInTermsOfQuoteToken.toExact()
                            : 0,
                        gasCostInTermsOfAmountToken: gasCostInTermsOfAmountToken.toExact(),
                        executionPrice: executionPrice.toSignificant(6),
                        syntheticGasCostInTermsOfQuoteToken: syntheticGasCostInTermsOfQuoteToken.toSignificant(6),
                    }, 'New gasCostInTermsOfQuoteToken calculated with synthetic quote token price is less than original');
                    gasCostInTermsOfQuoteToken = syntheticGasCostInTermsOfQuoteToken;
                }
            }
            // true if token0 is the native currency
            const token0USDPool = usdPool.token0.address == nativeCurrency.address;
            // gets the mid price of the pool in terms of the native token
            const nativeTokenPriceUSDPool = token0USDPool
                ? usdPool.token0Price
                : usdPool.token1Price;
            let gasCostInTermsOfUSD;
            try {
                gasCostInTermsOfUSD = nativeTokenPriceUSDPool.quote(totalGasCostNativeCurrency);
            }
            catch (err) {
                log_1.log.info({
                    usdT1: usdPool.token0.symbol,
                    usdT2: usdPool.token1.symbol,
                    gasCostInNativeToken: totalGasCostNativeCurrency.currency.symbol,
                }, 'Failed to compute USD gas price');
                throw err;
            }
            // If gasCostInTermsOfQuoteToken is null, both attempts to calculate gasCostInTermsOfQuoteToken failed (nativePool and amountNativePool)
            if (gasCostInTermsOfQuoteToken === null) {
                log_1.log.info(`Unable to find ${nativeCurrency.symbol} pool with the quote token, ${quoteToken.symbol}, or amount Token, ${amountToken.symbol} to produce gas adjusted costs. Route will not account for gas.`);
                return {
                    gasEstimate: baseGasUse,
                    gasCostInToken: amounts_1.CurrencyAmount.fromRawAmount(quoteToken, 0),
                    gasCostInUSD: amounts_1.CurrencyAmount.fromRawAmount(usdToken, 0),
                };
            }
            return {
                gasEstimate: baseGasUse,
                gasCostInToken: gasCostInTermsOfQuoteToken,
                gasCostInUSD: gasCostInTermsOfUSD,
            };
        };
        return {
            estimateGasCost: estimateGasCost.bind(this),
            calculateL1GasFees,
        };
    }
    estimateGas(routeWithValidQuote, gasPriceWei, chainId) {
        const totalInitializedTicksCrossed = bignumber_1.BigNumber.from(Math.max(1, lodash_1.default.sum(routeWithValidQuote.initializedTicksCrossedList)));
        const totalHops = bignumber_1.BigNumber.from(routeWithValidQuote.route.pools.length);
        const hopsGasUse = (0, gas_costs_1.COST_PER_HOP)(chainId).mul(totalHops);
        const tickGasUse = (0, gas_costs_1.COST_PER_INIT_TICK)(chainId).mul(totalInitializedTicksCrossed);
        const uninitializedTickGasUse = gas_costs_1.COST_PER_UNINIT_TICK.mul(0);
        // base estimate gas used based on chainId estimates for hops and ticks gas useage
        const baseGasUse = (0, gas_costs_1.BASE_SWAP_COST)(chainId)
            .add(hopsGasUse)
            .add(tickGasUse)
            .add(uninitializedTickGasUse);
        const baseGasCostWei = gasPriceWei.mul(baseGasUse);
        const wrappedCurrency = __1.WRAPPED_NATIVE_CURRENCY[chainId];
        const totalGasCostNativeCurrency = amounts_1.CurrencyAmount.fromRawAmount(wrappedCurrency, baseGasCostWei.toString());
        return {
            totalGasCostNativeCurrency,
            totalInitializedTicksCrossed,
            baseGasUse,
        };
    }
    /**
     * To avoid having a call to Manta's L1 security fee contract for every route and amount combination,
     * we replicate the gas cost accounting here.
     */
    calculateMantaToL1SecurityFee(routes, swapConfig, gasData) {
        const { l1BaseFee, scalar, decimals, overhead } = gasData;
        const route = routes[0];
        const amountToken = route.tradeType == sdk_core_1.TradeType.EXACT_INPUT
            ? route.amount.currency
            : route.quote.currency;
        const outputToken = route.tradeType == sdk_core_1.TradeType.EXACT_INPUT
            ? route.quote.currency
            : route.amount.currency;
        // build trade for swap calldata
        const trade = (0, methodParameters_1.buildTrade)(amountToken, outputToken, route.tradeType, routes);
        const data = (0, methodParameters_1.buildSwapMethodParameters)(trade, swapConfig, util_1.ChainId.MANTA).calldata;
        const l1GasUsed = (0, gas_factory_helpers_1.getL2ToL1GasUsed)(data, overhead);
        // l1BaseFee is L1 Gas Price on etherscan
        const l1Fee = l1GasUsed.mul(l1BaseFee);
        const unscaled = l1Fee.mul(scalar);
        // scaled = unscaled / (10 ** decimals)
        const scaledConversion = bignumber_1.BigNumber.from(10).pow(decimals);
        const scaled = unscaled.div(scaledConversion);
        return [l1GasUsed, scaled];
    }
}
exports.V3HeuristicGasModelFactory = V3HeuristicGasModelFactory;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidjMtaGV1cmlzdGljLWdhcy1tb2RlbC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uLy4uLy4uL3NyYy9yb3V0ZXJzL2FscGhhLXJvdXRlci9nYXMtbW9kZWxzL3YzL3YzLWhldXJpc3RpYy1nYXMtbW9kZWwudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7O0FBQUEsd0RBQXFEO0FBQ3JELGdEQUE4RDtBQUU5RCxvREFBdUI7QUFFdkIsbUNBSXFCO0FBSXJCLDJDQUEyQztBQUMzQyxzREFBMEQ7QUFDMUQsOEVBSThDO0FBQzlDLDhDQUEyQztBQUMzQyx3RUFHMkM7QUFFM0MsNENBSXNCO0FBRXRCLDJDQUtxQjtBQUVyQjs7Ozs7Ozs7Ozs7Ozs7Ozs7R0FpQkc7QUFDSCxNQUFhLDBCQUEyQixTQUFRLG1DQUF1QjtJQUNyRTtRQUNFLEtBQUssRUFBRSxDQUFDO0lBQ1YsQ0FBQztJQUVNLEtBQUssQ0FBQyxhQUFhLENBQUMsRUFDekIsT0FBTyxFQUNQLFdBQVcsRUFDWCxjQUFjLEVBQUUsWUFBWSxFQUM1QixXQUFXLEVBQ1gsVUFBVSxFQUNWLGlCQUFpQixHQUNlO1FBR2hDLE1BQU0sU0FBUyxHQUFHLGlCQUFpQjtZQUNqQyxDQUFDLENBQUMsTUFBTSxpQkFBaUIsQ0FBQyxVQUFVLEVBQUU7WUFDdEMsQ0FBQyxDQUFDLFNBQVMsQ0FBQztRQUVkLE1BQU0sT0FBTyxHQUFTLE1BQU0sSUFBQSxrREFBNEIsRUFDdEQsT0FBTyxFQUNQLFlBQVksQ0FDYixDQUFDO1FBRUYsTUFBTSxrQkFBa0IsR0FBRyxLQUFLLEVBQzlCLEtBQThCLEVBSzdCLEVBQUU7WUFDSCxNQUFNLFdBQVcsR0FBK0I7Z0JBQzlDLElBQUksRUFBRSxZQUFRLENBQUMsZ0JBQWdCO2dCQUMvQixTQUFTLEVBQUUsNENBQTRDO2dCQUN2RCwyQkFBMkIsRUFBRSxHQUFHO2dCQUNoQyxpQkFBaUIsRUFBRSxJQUFJLGtCQUFPLENBQUMsQ0FBQyxFQUFFLEtBQU0sQ0FB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