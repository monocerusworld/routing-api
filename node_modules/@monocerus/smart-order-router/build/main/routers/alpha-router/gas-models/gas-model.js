"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.IOnChainGasModelFactory = exports.IV2GasModelFactory = exports.usdGasTokensByChain = void 0;
const token_provider_1 = require("../../../providers/token-provider");
const chains_1 = require("../../../util/chains");
exports.usdGasTokensByChain = {
    [chains_1.ChainId.MAINNET]: [token_provider_1.USDC_MAINNET, token_provider_1.USDT_MAINNET],
    [chains_1.ChainId.MANTA_TESTNET]: [token_provider_1.USDC_MANTA_TESTNET, token_provider_1.USDT_MANTA_TESTNET],
    [chains_1.ChainId.MANTA]: [token_provider_1.USDC_MANTA, token_provider_1.USDT_MANTA],
};
/**
 * Factory for building gas models that can be used with any route to generate
 * gas estimates.
 *
 * Factory model is used so that any supporting data can be fetched once and
 * returned as part of the model.
 *
 * @export
 * @abstract
 * @class IV2GasModelFactory
 */
class IV2GasModelFactory {
}
exports.IV2GasModelFactory = IV2GasModelFactory;
/**
 * Factory for building gas models that can be used with any route to generate
 * gas estimates.
 *
 * Factory model is used so that any supporting data can be fetched once and
 * returned as part of the model.
 *
 * @export
 * @abstract
 * @class IOnChainGasModelFactory
 */
class IOnChainGasModelFactory {
}
exports.IOnChainGasModelFactory = IOnChainGasModelFactory;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZ2FzLW1vZGVsLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vLi4vc3JjL3JvdXRlcnMvYWxwaGEtcm91dGVyL2dhcy1tb2RlbHMvZ2FzLW1vZGVsLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUdBLHNFQU8yQztBQVMzQyxpREFBK0M7QUFRbEMsUUFBQSxtQkFBbUIsR0FBdUM7SUFDckUsQ0FBQyxnQkFBTyxDQUFDLE9BQU8sQ0FBQyxFQUFFLENBQUMsNkJBQVksRUFBRSw2QkFBWSxDQUFDO0lBQy9DLENBQUMsZ0JBQU8sQ0FBQyxhQUFhLENBQUMsRUFBRSxDQUFDLG1DQUFrQixFQUFFLG1DQUFrQixDQUFDO0lBQ2pFLENBQUMsZ0JBQU8sQ0FBQyxLQUFLLENBQUMsRUFBRSxDQUFDLDJCQUFVLEVBQUUsMkJBQVUsQ0FBQztDQUMxQyxDQUFDO0FBb0RGOzs7Ozs7Ozs7O0dBVUc7QUFDSCxNQUFzQixrQkFBa0I7Q0FPdkM7QUFQRCxnREFPQztBQUVEOzs7Ozs7Ozs7O0dBVUc7QUFDSCxNQUFzQix1QkFBdUI7Q0FZNUM7QUFaRCwwREFZQyJ9