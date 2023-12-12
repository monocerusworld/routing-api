import { Token } from '@uniswap/sdk-core';
import { ChainId } from './chains';
export declare const MANTA_TICK_LENS_ADDRESS = "0x0D9CBCA9c0e3517aB9d414A09ABAAa8257e70E51";
export declare const MANTA_NONFUNGIBLE_POSITION_MANAGER_ADDRESS = "0xE0836a2DFd8Ba6C63786803EA75DF801383af68C";
export declare const MANTA_SWAP_ROUTER_02_ADDRESS = "0xC9D4926c1241cb83339c42ee24fb7e8a8637D6Ad";
export declare const MANTA_V3_MIGRATOR_ADDRESS = "0xE810cAca8a86907ffEEfC7Ee4787559dcdf698B9";
export declare const MANTA_TESTNET_TICK_LENS_ADDRESS = "0x4E9a7cF6823E2D8Fc0fE16c321ceF982E49C0a1f";
export declare const MANTA_TESTNET_NONFUNGIBLE_POSITION_MANAGER_ADDRESS = "0xB6a264a95993Cd4FfF22B9B2d98605964E0f4D86";
export declare const MANTA_TESTNET_SWAP_ROUTER_02_ADDRESS = "0xF23F011Bd42E08fc32377b4bBf43FDF8a47EaBe3";
export declare const MANTA_TESTNET_V3_MIGRATOR_ADDRESS = "0x84Ecbb66f32db87A9b0AbFF51fD7fa6E4F633132";
export declare const V3_CORE_FACTORY_ADDRESSES: AddressMap;
export declare const QUOTER_V2_ADDRESSES: AddressMap;
export declare const MIXED_ROUTE_QUOTER_V1_ADDRESSES: AddressMap;
export declare const UNISWAP_MULTICALL_ADDRESSES: AddressMap;
export declare const SWAP_ROUTER_02_ADDRESSES: (chainId: number) => "0xC9D4926c1241cb83339c42ee24fb7e8a8637D6Ad" | "0xF23F011Bd42E08fc32377b4bBf43FDF8a47EaBe3" | "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45";
export declare const OVM_GASPRICE_ADDRESS = "0x420000000000000000000000000000000000000F";
export declare const ARB_GASINFO_ADDRESS = "0x000000000000000000000000000000000000006C";
export declare const TICK_LENS_ADDRESS = "0x4E9a7cF6823E2D8Fc0fE16c321ceF982E49C0a1f";
export declare const NONFUNGIBLE_POSITION_MANAGER_ADDRESS = "0xB6a264a95993Cd4FfF22B9B2d98605964E0f4D86";
export declare const V3_MIGRATOR_ADDRESS = "0x84Ecbb66f32db87A9b0AbFF51fD7fa6E4F633132";
export declare const MULTICALL2_ADDRESS = "0x751fc1884628fc943cb766714a79eC467faefB01";
export type AddressMap = {
    [chainId: number]: string;
};
export declare function constructSameAddressMap<T extends string>(address: T, additionalNetworks?: ChainId[]): {
    [chainId: number]: T;
};
export declare const WETH9: {
    [chainId in Exclude<ChainId, ChainId.MANTA_TESTNET>]: Token;
};
