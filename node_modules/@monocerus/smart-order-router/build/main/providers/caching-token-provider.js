"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CachingTokenProviderWithFallback = exports.CACHE_SEED_TOKENS = void 0;
/* eslint-disable @typescript-eslint/no-non-null-assertion */
const sdk_core_1 = require("@uniswap/sdk-core");
const lodash_1 = __importDefault(require("lodash"));
const util_1 = require("../util");
const token_provider_1 = require("./token-provider");
// These tokens will added to the Token cache on initialization.
exports.CACHE_SEED_TOKENS = {
    [util_1.ChainId.MAINNET]: {
        WETH: util_1.WRAPPED_NATIVE_CURRENCY[util_1.ChainId.MAINNET],
        USDC: token_provider_1.USDC_MAINNET,
        USDT: token_provider_1.USDT_MAINNET,
        // This token stores its symbol as bytes32, therefore can not be fetched on-chain using
        // our token providers.
        // This workaround adds it to the cache, so we won't try to fetch it on-chain.
        RING: new sdk_core_1.Token(util_1.ChainId.MAINNET, '0x9469D013805bFfB7D3DEBe5E7839237e535ec483', 18, 'RING', 'RING'),
    },
    [util_1.ChainId.MANTA]: {
        WETH: util_1.WRAPPED_NATIVE_CURRENCY[util_1.ChainId.MANTA],
        USDC: token_provider_1.USDC_MANTA,
        USDT: token_provider_1.USDT_MANTA,
    },
    [util_1.ChainId.MANTA_TESTNET]: {
        USDC: token_provider_1.USDC_MANTA_TESTNET,
        USDT: token_provider_1.USDT_MANTA_TESTNET,
        WMANTA: util_1.WRAPPED_NATIVE_CURRENCY[util_1.ChainId.MANTA_TESTNET],
    },
};
/**
 * Provider for getting token metadata that falls back to a different provider
 * in the event of failure.
 *
 * @export
 * @class CachingTokenProviderWithFallback
 */
class CachingTokenProviderWithFallback {
    constructor(chainId, 
    // Token metadata (e.g. symbol and decimals) don't change so can be cached indefinitely.
    // Constructing a new token object is slow as sdk-core does checksumming.
    tokenCache, primaryTokenProvider, fallbackTokenProvider) {
        this.chainId = chainId;
        this.tokenCache = tokenCache;
        this.primaryTokenProvider = primaryTokenProvider;
        this.fallbackTokenProvider = fallbackTokenProvider;
        this.CACHE_KEY = (chainId, address) => `token-${chainId}-${address}`;
    }
    async getTokens(_addresses) {
        const seedTokens = exports.CACHE_SEED_TOKENS[this.chainId];
        if (seedTokens) {
            for (const token of Object.values(seedTokens)) {
                await this.tokenCache.set(this.CACHE_KEY(this.chainId, token.address.toLowerCase()), token);
            }
        }
        const addressToToken = {};
        const symbolToToken = {};
        const addresses = (0, lodash_1.default)(_addresses)
            .map((address) => address.toLowerCase())
            .uniq()
            .value();
        const addressesToFindInPrimary = [];
        const addressesToFindInSecondary = [];
        for (const address of addresses) {
            if (await this.tokenCache.has(this.CACHE_KEY(this.chainId, address))) {
                addressToToken[address.toLowerCase()] = (await this.tokenCache.get(this.CACHE_KEY(this.chainId, address)));
                symbolToToken[addressToToken[address].symbol] =
                    (await this.tokenCache.get(this.CACHE_KEY(this.chainId, address)));
            }
            else {
                addressesToFindInPrimary.push(address);
            }
        }
        util_1.log.info({ addressesToFindInPrimary }, `Found ${addresses.length - addressesToFindInPrimary.length} out of ${addresses.length} tokens in local cache. ${addressesToFindInPrimary.length > 0
            ? `Checking primary token provider for ${addressesToFindInPrimary.length} tokens`
            : ``}
      `);
        if (addressesToFindInPrimary.length > 0) {
            const primaryTokenAccessor = await this.primaryTokenProvider.getTokens(addressesToFindInPrimary);
            for (const address of addressesToFindInPrimary) {
                const token = primaryTokenAccessor.getTokenByAddress(address);
                if (token) {
                    addressToToken[address.toLowerCase()] = token;
                    symbolToToken[addressToToken[address].symbol] = token;
                    await this.tokenCache.set(this.CACHE_KEY(this.chainId, address.toLowerCase()), addressToToken[address]);
                }
                else {
                    addressesToFindInSecondary.push(address);
                }
            }
            util_1.log.info({ addressesToFindInSecondary }, `Found ${addressesToFindInPrimary.length - addressesToFindInSecondary.length} tokens in primary. ${this.fallbackTokenProvider
                ? `Checking secondary token provider for ${addressesToFindInSecondary.length} tokens`
                : `No fallback token provider specified. About to return.`}`);
        }
        if (this.fallbackTokenProvider && addressesToFindInSecondary.length > 0) {
            const secondaryTokenAccessor = await this.fallbackTokenProvider.getTokens(addressesToFindInSecondary);
            for (const address of addressesToFindInSecondary) {
                const token = secondaryTokenAccessor.getTokenByAddress(address);
                if (token) {
                    addressToToken[address.toLowerCase()] = token;
                    symbolToToken[addressToToken[address].symbol] = token;
                    await this.tokenCache.set(this.CACHE_KEY(this.chainId, address.toLowerCase()), addressToToken[address]);
                }
            }
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
exports.CachingTokenProviderWithFallback = CachingTokenProviderWithFallback;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY2FjaGluZy10b2tlbi1wcm92aWRlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9wcm92aWRlcnMvY2FjaGluZy10b2tlbi1wcm92aWRlci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7QUFBQSw2REFBNkQ7QUFDN0QsZ0RBQTBDO0FBQzFDLG9EQUF1QjtBQUV2QixrQ0FBZ0U7QUFHaEUscURBUzBCO0FBRTFCLGdFQUFnRTtBQUNuRCxRQUFBLGlCQUFpQixHQUUxQjtJQUNGLENBQUMsY0FBTyxDQUFDLE9BQU8sQ0FBQyxFQUFFO1FBQ2pCLElBQUksRUFBRSw4QkFBdUIsQ0FBQyxjQUFPLENBQUMsT0FBTyxDQUFFO1FBQy9DLElBQUksRUFBRSw2QkFBWTtRQUNsQixJQUFJLEVBQUUsNkJBQVk7UUFDbEIsdUZBQXVGO1FBQ3ZGLHVCQUF1QjtRQUN2Qiw4RUFBOEU7UUFDOUUsSUFBSSxFQUFFLElBQUksZ0JBQUssQ0FDYixjQUFPLENBQUMsT0FBTyxFQUNmLDRDQUE0QyxFQUM1QyxFQUFFLEVBQ0YsTUFBTSxFQUNOLE1BQU0sQ0FDUDtLQUNGO0lBQ0QsQ0FBQyxjQUFPLENBQUMsS0FBSyxDQUFDLEVBQUU7UUFDZixJQUFJLEVBQUUsOEJBQXVCLENBQUMsY0FBTyxDQUFDLEtBQUssQ0FBQztRQUM1QyxJQUFJLEVBQUUsMkJBQVU7UUFDaEIsSUFBSSxFQUFFLDJCQUFVO0tBQ2pCO0lBQ0QsQ0FBQyxjQUFPLENBQUMsYUFBYSxDQUFDLEVBQUU7UUFDdkIsSUFBSSxFQUFFLG1DQUFrQjtRQUN4QixJQUFJLEVBQUUsbUNBQWtCO1FBQ3hCLE1BQU0sRUFBRSw4QkFBdUIsQ0FBQyxjQUFPLENBQUMsYUFBYSxDQUFDO0tBQ3ZEO0NBQ0YsQ0FBQztBQUVGOzs7Ozs7R0FNRztBQUNILE1BQWEsZ0NBQWdDO0lBSTNDLFlBQ1ksT0FBZ0I7SUFDMUIsd0ZBQXdGO0lBQ3hGLHlFQUF5RTtJQUNqRSxVQUF5QixFQUN2QixvQkFBb0Ms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