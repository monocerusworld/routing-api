"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.StaticV3SubgraphProvider = void 0;
const v3_sdk_1 = require("@uniswap/v3-sdk");
const jsbi_1 = __importDefault(require("jsbi"));
const lodash_1 = __importDefault(require("lodash"));
const amounts_1 = require("../../util/amounts");
const chains_1 = require("../../util/chains");
const log_1 = require("../../util/log");
const token_provider_1 = require("../token-provider");
const BASES_TO_CHECK_TRADES_AGAINST = {
    [chains_1.ChainId.MAINNET]: [
        chains_1.WRAPPED_NATIVE_CURRENCY[chains_1.ChainId.MAINNET],
        token_provider_1.DAI_MAINNET,
        token_provider_1.USDC_MAINNET,
        token_provider_1.USDT_MAINNET,
        token_provider_1.WBTC_MAINNET,
    ],
    [chains_1.ChainId.ROPSTEN]: [
        chains_1.WRAPPED_NATIVE_CURRENCY[chains_1.ChainId.ROPSTEN],
        token_provider_1.DAI_ROPSTEN,
        token_provider_1.USDT_ROPSTEN,
        token_provider_1.USDC_ROPSTEN,
    ],
    [chains_1.ChainId.RINKEBY]: [
        chains_1.WRAPPED_NATIVE_CURRENCY[chains_1.ChainId.RINKEBY],
        token_provider_1.DAI_RINKEBY_1,
        token_provider_1.DAI_RINKEBY_2,
        token_provider_1.USDC_RINKEBY,
        token_provider_1.USDT_RINKEBY,
    ],
    [chains_1.ChainId.GÖRLI]: [
        chains_1.WRAPPED_NATIVE_CURRENCY[chains_1.ChainId.GÖRLI],
        token_provider_1.USDT_GÖRLI,
        token_provider_1.USDC_GÖRLI,
        token_provider_1.WBTC_GÖRLI,
        token_provider_1.DAI_GÖRLI,
    ],
    [chains_1.ChainId.KOVAN]: [
        chains_1.WRAPPED_NATIVE_CURRENCY[chains_1.ChainId.KOVAN],
        token_provider_1.USDC_KOVAN,
        token_provider_1.USDT_KOVAN,
        token_provider_1.WBTC_KOVAN,
        token_provider_1.DAI_KOVAN,
    ],
    [chains_1.ChainId.OPTIMISM]: [
        chains_1.WRAPPED_NATIVE_CURRENCY[chains_1.ChainId.OPTIMISM],
        token_provider_1.USDC_OPTIMISM,
        token_provider_1.DAI_OPTIMISM,
        token_provider_1.USDT_OPTIMISM,
        token_provider_1.WBTC_OPTIMISM,
    ],
    [chains_1.ChainId.ARBITRUM_ONE]: [
        chains_1.WRAPPED_NATIVE_CURRENCY[chains_1.ChainId.ARBITRUM_ONE],
        token_provider_1.WBTC_ARBITRUM,
        token_provider_1.DAI_ARBITRUM,
        token_provider_1.USDC_ARBITRUM,
        token_provider_1.USDT_ARBITRUM,
    ],
    [chains_1.ChainId.ARBITRUM_RINKEBY]: [
        chains_1.WRAPPED_NATIVE_CURRENCY[chains_1.ChainId.ARBITRUM_RINKEBY],
        token_provider_1.DAI_ARBITRUM_RINKEBY,
        token_provider_1.UNI_ARBITRUM_RINKEBY,
        token_provider_1.USDT_ARBITRUM_RINKEBY,
    ],
    [chains_1.ChainId.ARBITRUM_GOERLI]: [
        chains_1.WRAPPED_NATIVE_CURRENCY[chains_1.ChainId.ARBITRUM_GOERLI],
        token_provider_1.USDC_ARBITRUM_GOERLI,
    ],
    [chains_1.ChainId.OPTIMISM_GOERLI]: [
        chains_1.WRAPPED_NATIVE_CURRENCY[chains_1.ChainId.OPTIMISM_GOERLI],
        token_provider_1.USDC_OPTIMISM_GOERLI,
        token_provider_1.DAI_OPTIMISM_GOERLI,
        token_provider_1.USDT_OPTIMISM_GOERLI,
        token_provider_1.WBTC_OPTIMISM_GOERLI,
    ],
    [chains_1.ChainId.OPTIMISTIC_KOVAN]: [
        chains_1.WRAPPED_NATIVE_CURRENCY[chains_1.ChainId.OPTIMISTIC_KOVAN],
        token_provider_1.DAI_OPTIMISTIC_KOVAN,
        token_provider_1.WBTC_OPTIMISTIC_KOVAN,
        token_provider_1.USDT_OPTIMISTIC_KOVAN,
        token_provider_1.USDC_OPTIMISTIC_KOVAN,
    ],
    [chains_1.ChainId.POLYGON]: [token_provider_1.USDC_POLYGON, token_provider_1.WETH_POLYGON, token_provider_1.WMATIC_POLYGON],
    [chains_1.ChainId.POLYGON_MUMBAI]: [
        token_provider_1.DAI_POLYGON_MUMBAI,
        chains_1.WRAPPED_NATIVE_CURRENCY[chains_1.ChainId.POLYGON_MUMBAI],
        token_provider_1.WMATIC_POLYGON_MUMBAI,
    ],
    [chains_1.ChainId.CELO]: [token_provider_1.CELO, token_provider_1.CUSD_CELO, token_provider_1.CEUR_CELO, token_provider_1.DAI_CELO],
    [chains_1.ChainId.CELO_ALFAJORES]: [
        token_provider_1.CELO_ALFAJORES,
        token_provider_1.CUSD_CELO_ALFAJORES,
        token_provider_1.CEUR_CELO_ALFAJORES,
        token_provider_1.DAI_CELO_ALFAJORES,
    ],
    [chains_1.ChainId.GNOSIS]: [
        chains_1.WRAPPED_NATIVE_CURRENCY[chains_1.ChainId.GNOSIS],
        token_provider_1.WBTC_GNOSIS,
        token_provider_1.WXDAI_GNOSIS,
        token_provider_1.USDC_ETHEREUM_GNOSIS,
    ],
    [chains_1.ChainId.BSC]: [
        chains_1.WRAPPED_NATIVE_CURRENCY[chains_1.ChainId.BSC],
        token_provider_1.BUSD_BSC,
        token_provider_1.DAI_BSC,
        token_provider_1.USDC_BSC,
        token_provider_1.USDT_BSC,
        token_provider_1.BTC_BSC,
        token_provider_1.ETH_BSC,
    ],
    [chains_1.ChainId.FANTOM]: [
        chains_1.WRAPPED_NATIVE_CURRENCY[chains_1.ChainId.FANTOM],
        token_provider_1.DAI_FANTOM,
        token_provider_1.USDC_FANTOM,
        token_provider_1.USDT_FANTOM,
        token_provider_1.BTC_FANTOM,
        token_provider_1.ETH_FANTOM,
    ],
    [chains_1.ChainId.GNOSIS]: [
        chains_1.WRAPPED_NATIVE_CURRENCY[chains_1.ChainId.GNOSIS],
        token_provider_1.DAI_GNOSIS,
        token_provider_1.USDC_GNOSIS,
        token_provider_1.USDT_GNOSIS,
        token_provider_1.BTC_GNOSIS,
        token_provider_1.ETH_GNOSIS,
    ],
    [chains_1.ChainId.KLAYTN]: [
        chains_1.WRAPPED_NATIVE_CURRENCY[chains_1.ChainId.KLAYTN],
        token_provider_1.DAI_KLAYTN,
        token_provider_1.USDC_KLAYTN,
        token_provider_1.USDT_KLAYTN,
        token_provider_1.BTC_KLAYTN,
        token_provider_1.ETH_KLAYTN,
    ],
    [chains_1.ChainId.AVALANCHE]: [
        chains_1.WRAPPED_NATIVE_CURRENCY[chains_1.ChainId.AVALANCHE],
        token_provider_1.DAI_AVALANCHE,
        token_provider_1.USDC_AVALANCHE,
        token_provider_1.USDT_AVALANCHE,
    ],
    [chains_1.ChainId.MOONBEAM]: [
        chains_1.WRAPPED_NATIVE_CURRENCY[chains_1.ChainId.MOONBEAM],
        token_provider_1.DAI_MOONBEAM,
        token_provider_1.USDC_MOONBEAM,
        token_provider_1.USDT_MOONBEAM,
        token_provider_1.WBTC_MOONBEAM,
    ],
};
/**
 * Provider that uses a hardcoded list of V3 pools to generate a list of subgraph pools.
 *
 * Since the pools are hardcoded and the data does not come from the Subgraph, the TVL values
 * are dummys and should not be depended on.
 *
 * Useful for instances where other data sources are unavailable. E.g. Subgraph not available.
 *
 * @export
 * @class StaticV3SubgraphProvider
 */
class StaticV3SubgraphProvider {
    constructor(chainId, poolProvider) {
        this.chainId = chainId;
        this.poolProvider = poolProvider;
    }
    async getPools(tokenIn, tokenOut) {
        log_1.log.info('In static subgraph provider for V3');
        const bases = BASES_TO_CHECK_TRADES_AGAINST[this.chainId];
        const basePairs = lodash_1.default.flatMap(bases, (base) => bases.map((otherBase) => [base, otherBase]));
        if (tokenIn && tokenOut) {
            basePairs.push([tokenIn, tokenOut], ...bases.map((base) => [tokenIn, base]), ...bases.map((base) => [tokenOut, base]));
        }
        const pairs = (0, lodash_1.default)(basePairs)
            .filter((tokens) => Boolean(tokens[0] && tokens[1]))
            .filter(([tokenA, tokenB]) => tokenA.address !== tokenB.address && !tokenA.equals(tokenB))
            .flatMap(([tokenA, tokenB]) => {
            return [
                [tokenA, tokenB, v3_sdk_1.FeeAmount.LOWEST],
                [tokenA, tokenB, v3_sdk_1.FeeAmount.LOW],
                [tokenA, tokenB, v3_sdk_1.FeeAmount.MEDIUM],
                [tokenA, tokenB, v3_sdk_1.FeeAmount.HIGH],
            ];
        })
            .value();
        log_1.log.info(`V3 Static subgraph provider about to get ${pairs.length} pools on-chain`);
        const poolAccessor = await this.poolProvider.getPools(pairs);
        const pools = poolAccessor.getAllPools();
        const poolAddressSet = new Set();
        const subgraphPools = (0, lodash_1.default)(pools)
            .map((pool) => {
            const { token0, token1, fee, liquidity } = pool;
            const poolAddress = v3_sdk_1.Pool.getAddress(pool.token0, pool.token1, pool.fee);
            if (poolAddressSet.has(poolAddress)) {
                return undefined;
            }
            poolAddressSet.add(poolAddress);
            const liquidityNumber = jsbi_1.default.toNumber(liquidity);
            return {
                id: poolAddress,
                feeTier: (0, amounts_1.unparseFeeAmount)(fee),
                liquidity: liquidity.toString(),
                token0: {
                    id: token0.address,
                },
                token1: {
                    id: token1.address,
                },
                // As a very rough proxy we just use liquidity for TVL.
                tvlETH: liquidityNumber,
                tvlUSD: liquidityNumber,
            };
        })
            .compact()
            .value();
        return subgraphPools;
    }
}
exports.StaticV3SubgraphProvider = StaticV3SubgraphProvider;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3RhdGljLXN1YmdyYXBoLXByb3ZpZGVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL3Byb3ZpZGVycy92My9zdGF0aWMtc3ViZ3JhcGgtcHJvdmlkZXIudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7O0FBRUEsNENBQWtEO0FBQ2xELGdEQUF3QjtBQUN4QixvREFBdUI7QUFFdkIsZ0RBQXNEO0FBQ3RELDhDQUFxRTtBQUNyRSx3Q0FBcUM7QUFDckMsc0RBb0YyQjtBQVMzQixNQUFNLDZCQUE2QixHQUFtQjtJQUNwRCxDQUFDLGdCQUFPLENBQUMsT0FBTyxDQUFDLEVBQUU7UUFDakIsZ0NBQXVCLENBQUMsZ0JBQU8sQ0FBQyxPQUFPLENBQUU7UUFDekMsNEJBQVc7UUFDWCw2QkFBWTtRQUNaLDZCQUFZO1FBQ1osNkJBQVk7S0FDYjtJQUNELENBQUMsZ0JBQU8sQ0FBQyxPQUFPLENBQUMsRUFBRTtRQUNqQixnQ0FBdUIsQ0FBQyxnQkFBTyxDQUFDLE9BQU8sQ0FBRTtRQUN6Qyw0QkFBVztRQUNYLDZCQUFZO1FBQ1osNkJBQVk7S0FDYjtJQUNELENBQUMsZ0JBQU8sQ0FBQyxPQUFPLENBQUMsRUFBRTtRQUNqQixnQ0FBdUIsQ0FBQyxnQkFBTyxDQUFDLE9BQU8sQ0FBRTtRQUN6Qyw4QkFBYTtRQUNiLDhCQUFhO1FBQ2IsNkJBQVk7UUFDWiw2QkFBWTtLQUNiO0lBQ0QsQ0FBQyxnQkFBTyxDQUFDLEtBQUssQ0FBQyxFQUFFO1FBQ2YsZ0NBQXVCLENBQUMsZ0JBQU8sQ0FBQyxLQUFLLENBQUU7UUFDdkMsMkJBQVU7UUFDViwyQkFBVTtRQUNWLDJCQUFVO1FBQ1YsMEJBQVM7S0FDVjtJQUNELENBQUMsZ0JBQU8sQ0FBQyxLQUFLLENBQUMsRUFBRTtRQUNmLGdDQUF1QixDQUFDLGdCQUFPLENBQUMsS0FBSyxDQUFFO1FBQ3ZDLDJCQUFVO1FBQ1YsMkJBQVU7UUFDViwyQkFBVTtRQUNWLDBCQUFTO0tBQ1Y7SUFDRCxD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