import { GasPrice, IGasPriceProvider } from '@tartz-one/smart-order-router';
import { BigNumber } from 'ethers';
export declare class StaticGasPriceProvider implements IGasPriceProvider {
    private gasPriceWei;
    constructor(gasPriceWei: BigNumber);
    getGasPrice(): Promise<GasPrice>;
}
