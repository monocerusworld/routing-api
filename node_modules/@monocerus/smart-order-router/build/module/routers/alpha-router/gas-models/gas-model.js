import { USDC_MAINNET, USDC_MANTA, USDC_MANTA_TESTNET, USDT_MAINNET, CERUS_MANTA, USDT_MANTA, USDT_MANTA_TESTNET, } from '../../../providers/token-provider';
import { ChainId } from '../../../util/chains';
export const usdGasTokensByChain = {
    [ChainId.MAINNET]: [USDC_MAINNET, USDT_MAINNET],
    [ChainId.MANTA_TESTNET]: [USDC_MANTA_TESTNET, USDT_MANTA_TESTNET],
    [ChainId.MANTA]: [USDC_MANTA, USDT_MANTA, CERUS_MANTA],
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZ2FzLW1vZGVsLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vLi4vc3JjL3JvdXRlcnMvYWxwaGEtcm91dGVyL2dhcy1tb2RlbHMvZ2FzLW1vZGVsLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUdBLE9BQU8sRUFDTCxZQUFZLEVBQ1osVUFBVSxFQUNWLGtCQUFrQixFQUNsQixZQUFZLEVBQ1osV0FBVyxFQUNYLFVBQVUsRUFDVixrQkFBa0IsR0FDbkIsTUFBTSxtQ0FBbUMsQ0FBQztBQVMzQyxPQUFPLEVBQUUsT0FBTyxFQUFFLE1BQU0sc0JBQXNCLENBQUM7QUFRL0MsTUFBTSxDQUFDLE1BQU0sbUJBQW1CLEdBQXVDO0lBQ3JFLENBQUMsT0FBTyxDQUFDLE9BQU8sQ0FBQyxFQUFFLENBQUMsWUFBWSxFQUFFLFlBQVksQ0FBQztJQUMvQyxDQUFDLE9BQU8sQ0FBQyxhQUFhLENBQUMsRUFBRSxDQUFDLGtCQUFrQixFQUFFLGtCQUFrQixDQUFDO0lBQ2pFLENBQUMsT0FBTyxDQUFDLEtBQUssQ0FBQyxFQUFFLENBQUMsVUFBVSxFQUFFLFVBQVUsRUFBRSxXQUFXLENBQUM7Q0FDdkQsQ0FBQztBQW9ERjs7Ozs7Ozs7OztHQVVHO0FBQ0gsTUFBTSxPQUFnQixrQkFBa0I7Q0FPdkM7QUFFRDs7Ozs7Ozs7OztHQVVHO0FBQ0gsTUFBTSxPQUFnQix1QkFBdUI7Q0FZNUMifQ==