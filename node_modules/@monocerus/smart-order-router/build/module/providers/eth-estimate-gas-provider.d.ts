import { JsonRpcProvider } from '@ethersproject/providers';
import { SwapOptions, SwapRoute } from '../routers';
import { ChainId } from '../util';
import { ProviderConfig } from './provider';
import { Simulator } from './simulation-provider';
import { IV2PoolProvider } from './v2/pool-provider';
import { ArbitrumGasData, MantaGasData } from './v3/gas-data-provider';
import { IV3PoolProvider } from './v3/pool-provider';
export declare class EthEstimateGasSimulator extends Simulator {
    v2PoolProvider: IV2PoolProvider;
    v3PoolProvider: IV3PoolProvider;
    constructor(chainId: ChainId, provider: JsonRpcProvider, v2PoolProvider: IV2PoolProvider, v3PoolProvider: IV3PoolProvider);
    ethEstimateGas(fromAddress: string, swapOptions: SwapOptions, route: SwapRoute, l2GasData?: ArbitrumGasData | MantaGasData): Promise<SwapRoute>;
    private inflateGasLimit;
    protected simulateTransaction(fromAddress: string, swapOptions: any, swapRoute: SwapRoute, l2GasData?: MantaGasData | ArbitrumGasData | undefined, _providerConfig?: ProviderConfig | undefined): Promise<SwapRoute>;
}
