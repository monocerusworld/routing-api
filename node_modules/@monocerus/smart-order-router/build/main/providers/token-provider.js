"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WNATIVE_ON = exports.USDC_ON = exports.USDT_ON = exports.TokenProvider = exports.USDC_MANTA = exports.USDT_MANTA = exports.CERUS_MANTA = exports.WMANTA_MANTA_TESTNET = exports.USDT_MANTA_TESTNET = exports.USDC_MANTA_TESTNET = exports.USDT_MAINNET = exports.USDC_MAINNET = void 0;
const sdk_core_1 = require("@uniswap/sdk-core");
const lodash_1 = __importDefault(require("lodash"));
const IERC20Metadata__factory_1 = require("../types/v3/factories/IERC20Metadata__factory");
const util_1 = require("../util");
// Some well known tokens on each chain for seeding cache / testing.
exports.USDC_MAINNET = new sdk_core_1.Token(util_1.ChainId.MAINNET, '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', 6, 'USDC', 'USD//C');
exports.USDT_MAINNET = new sdk_core_1.Token(util_1.ChainId.MAINNET, '0xdAC17F958D2ee523a2206206994597C13D831ec7', 6, 'USDT', 'Tether USD');
// Manta Testnet Tokens
exports.USDC_MANTA_TESTNET = new sdk_core_1.Token(util_1.ChainId.MANTA_TESTNET, '0x8cDdB93BD8845aE509a6eC1e29836852A9b41b10', 18, 'USDC', 'USD Coin');
exports.USDT_MANTA_TESTNET = new sdk_core_1.Token(util_1.ChainId.MANTA_TESTNET, '0xC5a38c67077B713d6f28097B3C10Cc7Cdd3433F9', 6, 'USDT', 'Tether USD');
exports.WMANTA_MANTA_TESTNET = new sdk_core_1.Token(util_1.ChainId.MANTA_TESTNET, '0x226E0D9fBDE51708fC36Bb4E5d1af9728A285cF4', 18, 'WMANTA', 'Wrapped MANTA');
// Manta Tokens
exports.CERUS_MANTA = new sdk_core_1.Token(util_1.ChainId.MANTA, '0x657218E3535B32EDef9a722E35dcd6EA40E1202e', 18, 'CERUS', 'Monocerus');
exports.USDT_MANTA = new sdk_core_1.Token(util_1.ChainId.MANTA, '0xf417F5A458eC102B90352F697D6e2Ac3A3d2851f', 6, 'USDT', 'TetherToken');
exports.USDC_MANTA = new sdk_core_1.Token(util_1.ChainId.MANTA, '0xb73603C5d87fA094B7314C74ACE2e64D165016fb', 6, 'USDC', 'USD Coin');
class TokenProvider {
    constructor(chainId, multicall2Provider) {
        this.chainId = chainId;
        this.multicall2Provider = multicall2Provider;
    }
    async getTokens(_addresses, providerConfig) {
        const addressToToken = {};
        const symbolToToken = {};
        const addresses = (0, lodash_1.default)(_addresses)
            .map((address) => address.toLowerCase())
            .uniq()
            .value();
        if (addresses.length > 0) {
            const [symbolsResult, decimalsResult] = await Promise.all([
                this.multicall2Provider.callSameFunctionOnMultipleContracts({
                    addresses,
                    contractInterface: IERC20Metadata__factory_1.IERC20Metadata__factory.createInterface(),
                    functionName: 'symbol',
                    providerConfig,
                }),
                this.multicall2Provider.callSameFunctionOnMultipleContracts({
                    addresses,
                    contractInterface: IERC20Metadata__factory_1.IERC20Metadata__factory.createInterface(),
                    functionName: 'decimals',
                    providerConfig,
                }),
            ]);
            const { results: symbols } = symbolsResult;
            const { results: decimals } = decimalsResult;
            for (let i = 0; i < addresses.length; i++) {
                const address = addresses[i];
                const symbolResult = symbols[i];
                const decimalResult = decimals[i];
                if (!(symbolResult === null || symbolResult === void 0 ? void 0 : symbolResult.success) || !(decimalResult === null || decimalResult === void 0 ? void 0 : decimalResult.success)) {
                    util_1.log.info({
                        symbolResult,
                        decimalResult,
                    }, `Dropping token with address ${address} as symbol or decimal are invalid`);
                    continue;
                }
                const symbol = symbolResult.result[0];
                const decimal = decimalResult.result[0];
                addressToToken[address.toLowerCase()] = new sdk_core_1.Token(this.chainId, address, decimal, symbol);
                symbolToToken[symbol.toLowerCase()] =
                    addressToToken[address.toLowerCase()];
            }
            util_1.log.info(`Got token symbol and decimals for ${Object.values(addressToToken).length} out of ${addresses.length} tokens on-chain ${providerConfig ? `as of: ${providerConfig === null || providerConfig === void 0 ? void 0 : providerConfig.blockNumber}` : ''}`);
        }
        return {
            getTokenByAddress: (address) => {
                return addressToToken[address.toLowerCase()];
            },
            getTokenBySymbol: (symbol) => {
                return symbolToToken[symbol.toLowerCase()];
            },
            getAllTokens: () => {
                return Object.values(addressToToken);
            },
        };
    }
}
exports.TokenProvider = TokenProvider;
const USDT_ON = (chainId) => {
    switch (chainId) {
        case util_1.ChainId.MAINNET:
            return exports.USDT_MAINNET;
        case util_1.ChainId.MANTA_TESTNET:
            return exports.USDT_MANTA_TESTNET;
        case util_1.ChainId.MANTA:
            return exports.USDT_MANTA;
        default:
            throw new Error(`Chain id: ${chainId} not supported`);
    }
};
exports.USDT_ON = USDT_ON;
const USDC_ON = (chainId) => {
    switch (chainId) {
        case util_1.ChainId.MAINNET:
            return exports.USDC_MAINNET;
        case util_1.ChainId.MANTA_TESTNET:
            return exports.USDC_MANTA_TESTNET;
        case util_1.ChainId.MANTA:
            return exports.USDC_MANTA;
        default:
            throw new Error(`Chain id: ${chainId} not supported`);
    }
};
exports.USDC_ON = USDC_ON;
const WNATIVE_ON = (chainId) => {
    return util_1.WRAPPED_NATIVE_CURRENCY[chainId];
};
exports.WNATIVE_ON = WNATIVE_ON;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidG9rZW4tcHJvdmlkZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvcHJvdmlkZXJzL3Rva2VuLXByb3ZpZGVyLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7OztBQUFBLGdEQUEwQztBQUMxQyxvREFBdUI7QUFFdkIsMkZBQXdGO0FBQ3hGLGtDQUFnRTtBQStCaEUsb0VBQW9FO0FBQ3ZELFFBQUEsWUFBWSxHQUFHLElBQUksZ0JBQUssQ0FDbkMsY0FBTyxDQUFDLE9BQU8sRUFDZiw0Q0FBNEMsRUFDNUMsQ0FBQyxFQUNELE1BQU0sRUFDTixRQUFRLENBQ1QsQ0FBQztBQUNXLFFBQUEsWUFBWSxHQUFHLElBQUksZ0JBQUssQ0FDbkMsY0FBTyxDQUFDLE9BQU8sRUFDZiw0Q0FBNEMsRUFDNUMsQ0FBQyxFQUNELE1BQU0sRUFDTixZQUFZLENBQ2IsQ0FBQztBQUVGLHVCQUF1QjtBQUNWLFFBQUEsa0JBQWtCLEdBQUcsSUFBSSxnQkFBSyxDQUN6QyxjQUFPLENBQUMsYUFBYSxFQUNyQiw0Q0FBNEMsRUFDNUMsRUFBRSxFQUNGLE1BQU0sRUFDTixVQUFVLENBQ1gsQ0FBQztBQUVXLFFBQUEsa0JBQWtCLEdBQUcsSUFBSSxnQkFBSyxDQUN6QyxjQUFPLENBQUMsYUFBYSxFQUNyQiw0Q0FBNEMsRUFDNUMsQ0FBQyxFQUNELE1BQU0sRUFDTixZQUFZLENBQ2IsQ0FBQztBQUVXLFFBQUEsb0JBQW9CLEdBQUcsSUFBSSxnQkFBSyxDQUMzQyxjQUFPLENBQUMsYUFBYSxFQUNyQiw0Q0FBNEMsRUFDNUMsRUFBRSxFQUNGLFFBQVEsRUFDUixlQUFlLENBQ2hCLENBQUM7QUFFRixlQUFlO0FBQ0YsUUFBQSxXQUFXLEdBQUcsSUFBSSxnQkFBSyxDQUNsQyxjQUFPLENBQUMsS0FBSyxFQUNiLDRDQUE0QyxFQUM1QyxFQUFFLEVBQ0YsT0FBTyxFQUNQLFdBQVcsQ0FDWixDQUFDO0FBQ1csUUFBQSxVQUFVLEdBQUcsSUFBSSxnQkFBSyxD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