import { ConsiderationItem, SeaportData } from '../../src/entities/protocols/seaport';
import { BigNumber } from 'ethers';
export declare const seaportDataETH: SeaportData;
export declare const seaportDataERC20: SeaportData;
export declare function calculateSeaportValue(considerations: ConsiderationItem[], token: string): BigNumber;
