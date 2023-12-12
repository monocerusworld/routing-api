"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OnChainGasPriceProvider = void 0;
const chains_1 = require("../util/chains");
const gas_price_provider_1 = require("./gas-price-provider");
const DEFAULT_EIP_1559_SUPPORTED_CHAINS = [
    chains_1.ChainId.MAINNET,
    // infura endpoint having difficulty w/ eip-1559 on kovan
    // ChainId.KOVAN,
];
/**
 * Gets gas prices on chain. If the chain supports EIP-1559 and has the feeHistory API,
 * uses the EIP1559 provider. Otherwise it will use a legacy provider that uses eth_gasPrice
 *
 * @export
 * @class OnChainGasPriceProvider
 */
class OnChainGasPriceProvider extends gas_price_provider_1.IGasPriceProvider {
    constructor(chainId, eip1559GasPriceProvider, legacyGasPriceProvider, eipChains = DEFAULT_EIP_1559_SUPPORTED_CHAINS) {
        super();
        this.chainId = chainId;
        this.eip1559GasPriceProvider = eip1559GasPriceProvider;
        this.legacyGasPriceProvider = legacyGasPriceProvider;
        this.eipChains = eipChains;
    }
    async getGasPrice() {
        if (this.eipChains.includes(this.chainId)) {
            return this.eip1559GasPriceProvider.getGasPrice();
        }
        return this.legacyGasPriceProvider.getGasPrice();
    }
}
exports.OnChainGasPriceProvider = OnChainGasPriceProvider;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoib24tY2hhaW4tZ2FzLXByaWNlLXByb3ZpZGVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL3Byb3ZpZGVycy9vbi1jaGFpbi1nYXMtcHJpY2UtcHJvdmlkZXIudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBQUEsMkNBQXlDO0FBR3pDLDZEQUFtRTtBQUduRSxNQUFNLGlDQUFpQyxHQUFHO0lBQ3hDLGdCQUFPLENBQUMsT0FBTztJQUNmLHlEQUF5RDtJQUN6RCxpQkFBaUI7Q0FDbEIsQ0FBQztBQUVGOzs7Ozs7R0FNRztBQUNILE1BQWEsdUJBQXdCLFNBQVEsc0NBQWlCO0lBQzVELFlBQ1ksT0FBZ0IsRUFDaEIsdUJBQWdELEVBQ2hELHNCQUE4QyxFQUM5QyxZQUF1QixpQ0FBaUM7UUFFbEUsS0FBSyxFQUFFLENBQUM7UUFMRSxZQUFPLEdBQVAsT0FBTyxDQUFTO1FBQ2hCLDRCQUF1QixHQUF2Qix1QkFBdUIsQ0FBeUI7UUFDaEQsMkJBQXNCLEdBQXRCLHNCQUFzQixDQUF3QjtRQUM5QyxjQUFTLEdBQVQsU0FBUyxDQUErQztJQUdwRSxDQUFDO0lBRU0sS0FBSyxDQUFDLFdBQVc7UUFDdEIsSUFBSSxJQUFJLENBQUMsU0FBUyxDQUFDLFFBQVEsQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLEVBQUU7WUFDekMsT0FBTyxJQUFJLENBQUMsdUJBQXVCLENBQUMsV0FBVyxFQUFFLENBQUM7U0FDbkQ7UUFFRCxPQUFPLElBQUksQ0FBQyxzQkFBc0IsQ0FBQyxXQUFXLEVBQUUsQ0FBQztJQUNuRCxDQUFDO0NBQ0Y7QUFqQkQsMERBaUJDIn0=