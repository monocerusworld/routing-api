import { USDC_MAINNET, USDC_MANTA, USDC_MANTA_TESTNET, USDT_MAINNET, USDT_MANTA, USDT_MANTA_TESTNET, } from '../../../providers/token-provider';
import { ChainId } from '../../../util/chains';
export const usdGasTokensByChain = {
    [ChainId.MAINNET]: [USDC_MAINNET, USDT_MAINNET],
    [ChainId.MANTA_TESTNET]: [USDC_MANTA_TESTNET, USDT_MANTA_TESTNET],
    [ChainId.MANTA]: [USDC_MANTA, USDT_MANTA],
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
export class IV2GasModelFactory {
}
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
export class IOnChainGasModelFactory {
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZ2FzLW1vZGVsLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vLi4vc3JjL3JvdXRlcnMvYWxwaGEtcm91dGVyL2dhcy1tb2RlbHMvZ2FzLW1vZGVsLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUdBLE9BQU8sRUFDTCxZQUFZLEVBQ1osVUFBVSxFQUNWLGtCQUFrQixFQUNsQixZQUFZLEVBQ1osVUFBVSxFQUNWLGtCQUFrQixHQUNuQixNQUFNLG1DQUFtQyxDQUFDO0FBUzNDLE9BQU8sRUFBRSxPQUFPLEVBQUUsTUFBTSxzQkFBc0IsQ0FBQztBQVEvQyxNQUFNLENBQUMsTUFBTSxtQkFBbUIsR0FBdUM7SUFDckUsQ0FBQyxPQUFPLENBQUMsT0FBTyxDQUFDLEVBQUUsQ0FBQyxZQUFZLEVBQUUsWUFBWSxDQUFDO0lBQy9DLENBQUMsT0FBTyxDQUFDLGFBQWEsQ0FBQyxFQUFFLENBQUMsa0JBQWtCLEVBQUUsa0JBQWtCLENBQUM7SUFDakUsQ0FBQyxPQUFPLENBQUMsS0FBSyxDQUFDLEVBQUUsQ0FBQyxVQUFVLEVBQUUsVUFBVSxDQUFDO0NBQzFDLENBQUM7QUFvREY7Ozs7Ozs7Ozs7R0FVRztBQUNILE1BQU0sT0FBZ0Isa0JBQWtCO0NBT3ZDO0FBRUQ7Ozs7Ozs7Ozs7R0FVRztBQUNILE1BQU0sT0FBZ0IsdUJBQXVCO0NBWTVDIn0=