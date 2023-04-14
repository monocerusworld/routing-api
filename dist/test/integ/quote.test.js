import { AllowanceTransfer } from '@uniswap/permit2-sdk';
import { CurrencyAmount, Ether, Fraction, WETH9 } from '@uniswap/sdk-core';
import { CEUR_CELO, CEUR_CELO_ALFAJORES, ChainId, CUSD_CELO, CUSD_CELO_ALFAJORES, DAI_MAINNET, ID_TO_NETWORK_NAME, NATIVE_CURRENCY, parseAmount, SWAP_ROUTER_02_ADDRESSES, USDC_MAINNET, USDT_MAINNET, WBTC_MAINNET, } from '@tartz-one/smart-order-router';
import { PERMIT2_ADDRESS, UNIVERSAL_ROUTER_ADDRESS as UNIVERSAL_ROUTER_ADDRESS_BY_CHAIN, } from '@tartz-one/universal-router-sdk';
import { fail } from 'assert';
import axiosStatic from 'axios';
import axiosRetry from 'axios-retry';
import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import chaiSubset from 'chai-subset';
import { BigNumber, Wallet } from 'ethers';
import hre from 'hardhat';
import _ from 'lodash';
import qs from 'qs';
import { SUPPORTED_CHAINS } from '../../lib/handlers/injector-sor';
import { Permit2__factory } from '../../lib/types/ext';
import { resetAndFundAtBlock } from '../utils/forkAndFund';
import { getBalance, getBalanceAndApprove } from '../utils/getBalanceAndApprove';
import { DAI_ON, getAmount, getAmountFromToken, UNI_MAINNET, USDC_ON, USDT_ON, WNATIVE_ON } from '../utils/tokens';
const { ethers } = hre;
chai.use(chaiAsPromised);
chai.use(chaiSubset);
const UNIVERSAL_ROUTER_ADDRESS = UNIVERSAL_ROUTER_ADDRESS_BY_CHAIN(1);
if (!process.env.UNISWAP_ROUTING_API || !process.env.ARCHIVE_NODE_RPC) {
    throw new Error('Must set UNISWAP_ROUTING_API and ARCHIVE_NODE_RPC env variables for integ tests. See README');
}
const API = `${process.env.UNISWAP_ROUTING_API}quote`;
const SLIPPAGE = '5';
const axios = axiosStatic.create();
axiosRetry(axios, {
    retries: 10,
    retryCondition: (err) => { var _a; return ((_a = err.response) === null || _a === void 0 ? void 0 : _a.status) == 429; },
    retryDelay: axiosRetry.exponentialDelay,
});
const callAndExpectFail = async (quoteReq, resp) => {
    const queryParams = qs.stringify(quoteReq);
    try {
        await axios.get(`${API}?${queryParams}`);
        fail();
    }
    catch (err) {
        expect(err.response).to.containSubset(resp);
    }
};
const checkQuoteToken = (before, after, tokensQuoted) => {
    // Check which is bigger to support exactIn and exactOut
    const tokensSwapped = after.greaterThan(before) ? after.subtract(before) : before.subtract(after);
    const tokensDiff = tokensQuoted.greaterThan(tokensSwapped)
        ? tokensQuoted.subtract(tokensSwapped)
        : tokensSwapped.subtract(tokensQuoted);
    const percentDiff = tokensDiff.asFraction.divide(tokensQuoted.asFraction);
    expect(percentDiff.lessThan(new Fraction(parseInt(SLIPPAGE), 100))).to.be.true;
};
let warnedTesterPK = false;
const isTesterPKEnvironmentSet = () => {
    const isSet = !!process.env.TESTER_PK;
    if (!isSet && !warnedTesterPK) {
        console.log('Skipping tests requiring real PK since env variables for TESTER_PK is not set.');
        warnedTesterPK = true;
    }
    return isSet;
};
const MAX_UINT160 = '0xffffffffffffffffffffffffffffffffffffffff';
describe('quote', function () {
    // Help with test flakiness by retrying.
    this.retries(0);
    this.timeout('500s');
    let alice;
    let block;
    let curNonce = 0;
    let nextPermitNonce = () => {
        const nonce = curNonce.toString();
        curNonce = curNonce + 1;
        return nonce;
    };
    const executeSwap = async (methodParameters, currencyIn, currencyOut, permit, chainId = ChainId.MAINNET) => {
        const permit2 = Permit2__factory.connect(PERMIT2_ADDRESS, alice);
        // Approve Permit2
        const tokenInBefore = await getBalanceAndApprove(alice, PERMIT2_ADDRESS, currencyIn);
        const tokenOutBefore = await getBalance(alice, currencyOut);
        // Approve SwapRouter02 in case we request calldata for it instead of Universal Router
        await getBalanceAndApprove(alice, SWAP_ROUTER_02_ADDRESSES(chainId), currencyIn);
        // If not using permit do a regular approval allowing narwhal max balance.
        if (!permit) {
            const approveNarwhal = await permit2.approve(currencyIn.wrapped.address, UNIVERSAL_ROUTER_ADDRESS, MAX_UINT160, 100000000000000);
            await approveNarwhal.wait();
        }
        const transaction = {
            data: methodParameters.calldata,
            to: methodParameters.to,
            value: BigNumber.from(methodParameters.value),
            from: alice.address,
            gasPrice: BigNumber.from(2000000000000),
            type: 1,
        };
        const transactionResponse = await alice.sendTransaction(transaction);
        await transactionResponse.wait();
        const tokenInAfter = await getBalance(alice, currencyIn);
        const tokenOutAfter = await getBalance(alice, currencyOut);
        return {
            tokenInAfter,
            tokenInBefore,
            tokenOutAfter,
            tokenOutBefore,
        };
    };
    before(async function () {
        this.timeout(40000);
        [alice] = await ethers.getSigners();
        // Make a dummy call to the API to get a block number to fork from.
        const quoteReq = {
            tokenInAddress: 'USDC',
            tokenInChainId: 1,
            tokenOutAddress: 'USDT',
            tokenOutChainId: 1,
            amount: await getAmount(1, 'exactIn', 'USDC', 'USDT', '100'),
            type: 'exactIn',
        };
        const { data: { blockNumber }, } = await axios.get(`${API}?${qs.stringify(quoteReq)}`);
        block = parseInt(blockNumber) - 10;
        alice = await resetAndFundAtBlock(alice, block, [
            parseAmount('8000000', USDC_MAINNET),
            parseAmount('5000000', USDT_MAINNET),
            parseAmount('10', WBTC_MAINNET),
            parseAmount('1000', UNI_MAINNET),
            parseAmount('4000', WETH9[1]),
            parseAmount('5000000', DAI_MAINNET),
        ]);
    });
    for (const algorithm of ['alpha']) {
        for (const type of ['exactIn', 'exactOut']) {
            describe(`${ID_TO_NETWORK_NAME(1)} ${algorithm} ${type} 2xx`, () => {
                describe(`+ Execute Swap`, () => {
                    it(`erc20 -> erc20`, async () => {
                        const quoteReq = {
                            tokenInAddress: 'USDC',
                            tokenInChainId: 1,
                            tokenOutAddress: 'USDT',
                            tokenOutChainId: 1,
                            amount: await getAmount(1, type, 'USDC', 'USDT', '100'),
                            type,
                            recipient: alice.address,
                            slippageTolerance: SLIPPAGE,
                            deadline: '360',
                            algorithm,
                            enableUniversalRouter: true,
                        };
                        const queryParams = qs.stringify(quoteReq);
                        const response = await axios.get(`${API}?${queryParams}`);
                        const { data: { quote, quoteDecimals, quoteGasAdjustedDecimals, methodParameters }, status, } = response;
                        expect(status).to.equal(200);
                        expect(parseFloat(quoteDecimals)).to.be.greaterThan(90);
                        expect(parseFloat(quoteDecimals)).to.be.lessThan(110);
                        if (type == 'exactIn') {
                            expect(parseFloat(quoteGasAdjustedDecimals)).to.be.lessThanOrEqual(parseFloat(quoteDecimals));
                        }
                        else {
                            expect(parseFloat(quoteGasAdjustedDecimals)).to.be.greaterThanOrEqual(parseFloat(quoteDecimals));
                        }
                        expect(methodParameters).to.not.be.undefined;
                        expect(methodParameters === null || methodParameters === void 0 ? void 0 : methodParameters.to).to.equal(UNIVERSAL_ROUTER_ADDRESS);
                        const { tokenInBefore, tokenInAfter, tokenOutBefore, tokenOutAfter } = await executeSwap(methodParameters, USDC_MAINNET, USDT_MAINNET);
                        if (type == 'exactIn') {
                            expect(tokenInBefore.subtract(tokenInAfter).toExact()).to.equal('100');
                            checkQuoteToken(tokenOutBefore, tokenOutAfter, CurrencyAmount.fromRawAmount(USDT_MAINNET, quote));
                        }
                        else {
                            expect(tokenOutAfter.subtract(tokenOutBefore).toExact()).to.equal('100');
                            checkQuoteToken(tokenInBefore, tokenInAfter, CurrencyAmount.fromRawAmount(USDC_MAINNET, quote));
                        }
                    });
                    it(`erc20 -> erc20 swaprouter02`, async () => {
                        const quoteReq = {
                            tokenInAddress: 'USDC',
                            tokenInChainId: 1,
                            tokenOutAddress: 'USDT',
                            tokenOutChainId: 1,
                            amount: await getAmount(1, type, 'USDC', 'USDT', '100'),
                            type,
                            recipient: alice.address,
                            slippageTolerance: SLIPPAGE,
                            deadline: '360',
                            algorithm,
                        };
                        const queryParams = qs.stringify(quoteReq);
                        const response = await axios.get(`${API}?${queryParams}`);
                        const { data: { quote, quoteDecimals, quoteGasAdjustedDecimals, methodParameters }, status, } = response;
                        expect(status).to.equal(200);
                        expect(parseFloat(quoteDecimals)).to.be.greaterThan(90);
                        expect(parseFloat(quoteDecimals)).to.be.lessThan(110);
                        if (type == 'exactIn') {
                            expect(parseFloat(quoteGasAdjustedDecimals)).to.be.lessThanOrEqual(parseFloat(quoteDecimals));
                        }
                        else {
                            expect(parseFloat(quoteGasAdjustedDecimals)).to.be.greaterThanOrEqual(parseFloat(quoteDecimals));
                        }
                        expect(methodParameters).to.not.be.undefined;
                        expect(methodParameters === null || methodParameters === void 0 ? void 0 : methodParameters.to).to.equal(SWAP_ROUTER_02_ADDRESSES(ChainId.MAINNET));
                        const { tokenInBefore, tokenInAfter, tokenOutBefore, tokenOutAfter } = await executeSwap(methodParameters, USDC_MAINNET, USDT_MAINNET);
                        if (type == 'exactIn') {
                            expect(tokenInBefore.subtract(tokenInAfter).toExact()).to.equal('100');
                            checkQuoteToken(tokenOutBefore, tokenOutAfter, CurrencyAmount.fromRawAmount(USDT_MAINNET, quote));
                        }
                        else {
                            expect(tokenOutAfter.subtract(tokenOutBefore).toExact()).to.equal('100');
                            checkQuoteToken(tokenInBefore, tokenInAfter, CurrencyAmount.fromRawAmount(USDC_MAINNET, quote));
                        }
                    });
                    it(`erc20 -> erc20 with permit`, async () => {
                        const amount = await getAmount(1, type, 'USDC', 'USDT', '10');
                        const nonce = nextPermitNonce();
                        const permit = {
                            details: {
                                token: USDC_MAINNET.address,
                                amount: '15000000',
                                expiration: Math.floor(new Date().getTime() / 1000 + 10000000).toString(),
                                nonce,
                            },
                            spender: UNIVERSAL_ROUTER_ADDRESS,
                            sigDeadline: Math.floor(new Date().getTime() / 1000 + 10000000).toString(),
                        };
                        const { domain, types, values } = AllowanceTransfer.getPermitData(permit, PERMIT2_ADDRESS, 1);
                        const signature = await alice._signTypedData(domain, types, values);
                        const quoteReq = {
                            tokenInAddress: 'USDC',
                            tokenInChainId: 1,
                            tokenOutAddress: 'USDT',
                            tokenOutChainId: 1,
                            amount,
                            type,
                            recipient: alice.address,
                            slippageTolerance: SLIPPAGE,
                            deadline: '360',
                            algorithm,
                            permitSignature: signature,
                            permitAmount: permit.details.amount.toString(),
                            permitExpiration: permit.details.expiration.toString(),
                            permitSigDeadline: permit.sigDeadline.toString(),
                            permitNonce: permit.details.nonce.toString(),
                            enableUniversalRouter: true,
                        };
                        const queryParams = qs.stringify(quoteReq);
                        const response = await axios.get(`${API}?${queryParams}`);
                        const { data: { quote, quoteDecimals, quoteGasAdjustedDecimals, methodParameters }, status, } = response;
                        expect(status).to.equal(200);
                        expect(parseFloat(quoteDecimals)).to.be.greaterThan(9);
                        expect(parseFloat(quoteDecimals)).to.be.lessThan(11);
                        if (type == 'exactIn') {
                            expect(parseFloat(quoteGasAdjustedDecimals)).to.be.lessThanOrEqual(parseFloat(quoteDecimals));
                        }
                        else {
                            expect(parseFloat(quoteGasAdjustedDecimals)).to.be.greaterThanOrEqual(parseFloat(quoteDecimals));
                        }
                        expect(methodParameters).to.not.be.undefined;
                        expect(methodParameters === null || methodParameters === void 0 ? void 0 : methodParameters.to).to.equal(UNIVERSAL_ROUTER_ADDRESS);
                        const { tokenInBefore, tokenInAfter, tokenOutBefore, tokenOutAfter } = await executeSwap(methodParameters, USDC_MAINNET, USDT_MAINNET, true);
                        if (type == 'exactIn') {
                            expect(tokenInBefore.subtract(tokenInAfter).toExact()).to.equal('10');
                            checkQuoteToken(tokenOutBefore, tokenOutAfter, CurrencyAmount.fromRawAmount(USDT_MAINNET, quote));
                        }
                        else {
                            expect(tokenOutAfter.subtract(tokenOutBefore).toExact()).to.equal('10');
                            checkQuoteToken(tokenInBefore, tokenInAfter, CurrencyAmount.fromRawAmount(USDC_MAINNET, quote));
                        }
                    });
                    it(`erc20 -> eth`, async () => {
                        const quoteReq = {
                            tokenInAddress: 'USDC',
                            tokenInChainId: 1,
                            tokenOutAddress: 'ETH',
                            tokenOutChainId: 1,
                            amount: await getAmount(1, type, 'USDC', 'ETH', type == 'exactIn' ? '1000000' : '10'),
                            type,
                            recipient: alice.address,
                            slippageTolerance: SLIPPAGE,
                            deadline: '360',
                            algorithm,
                            enableUniversalRouter: true,
                        };
                        const queryParams = qs.stringify(quoteReq);
                        const response = await axios.get(`${API}?${queryParams}`);
                        const { data: { quote, methodParameters }, status, } = response;
                        expect(status).to.equal(200);
                        expect(methodParameters).to.not.be.undefined;
                        const { tokenInBefore, tokenInAfter, tokenOutBefore, tokenOutAfter } = await executeSwap(methodParameters, USDC_MAINNET, Ether.onChain(1));
                        if (type == 'exactIn') {
                            expect(tokenInBefore.subtract(tokenInAfter).toExact()).to.equal('1000000');
                            checkQuoteToken(tokenOutBefore, tokenOutAfter, CurrencyAmount.fromRawAmount(Ether.onChain(1), quote));
                        }
                        else {
                            // Hard to test ETH balance due to gas costs for approval and swap. Just check tokenIn changes
                            checkQuoteToken(tokenInBefore, tokenInAfter, CurrencyAmount.fromRawAmount(USDC_MAINNET, quote));
                        }
                    });
                    it(`erc20 -> eth large trade`, async () => {
                        // Trade of this size almost always results in splits.
                        const quoteReq = {
                            tokenInAddress: 'USDC',
                            tokenInChainId: 1,
                            tokenOutAddress: 'ETH',
                            tokenOutChainId: 1,
                            amount: type == 'exactIn'
                                ? await getAmount(1, type, 'USDC', 'ETH', '1000000')
                                : await getAmount(1, type, 'USDC', 'ETH', '100'),
                            type,
                            recipient: alice.address,
                            slippageTolerance: SLIPPAGE,
                            deadline: '360',
                            algorithm,
                            enableUniversalRouter: true,
                        };
                        const queryParams = qs.stringify(quoteReq);
                        const response = await axios.get(`${API}?${queryParams}`);
                        const { data, status } = response;
                        expect(status).to.equal(200);
                        expect(data.methodParameters).to.not.be.undefined;
                        expect(data.route).to.not.be.undefined;
                        const amountInEdgesTotal = _(data.route)
                            .flatMap((route) => route[0])
                            .filter((pool) => !!pool.amountIn)
                            .map((pool) => BigNumber.from(pool.amountIn))
                            .reduce((cur, total) => total.add(cur), BigNumber.from(0));
                        const amountIn = BigNumber.from(data.quote);
                        expect(amountIn.eq(amountInEdgesTotal));
                        const amountOutEdgesTotal = _(data.route)
                            .flatMap((route) => route[0])
                            .filter((pool) => !!pool.amountOut)
                            .map((pool) => BigNumber.from(pool.amountOut))
                            .reduce((cur, total) => total.add(cur), BigNumber.from(0));
                        const amountOut = BigNumber.from(data.quote);
                        expect(amountOut.eq(amountOutEdgesTotal));
                        const { tokenInBefore, tokenInAfter, tokenOutBefore, tokenOutAfter } = await executeSwap(data.methodParameters, USDC_MAINNET, Ether.onChain(1));
                        if (type == 'exactIn') {
                            expect(tokenInBefore.subtract(tokenInAfter).toExact()).to.equal('1000000');
                            checkQuoteToken(tokenOutBefore, tokenOutAfter, CurrencyAmount.fromRawAmount(Ether.onChain(1), data.quote));
                        }
                        else {
                            // Hard to test ETH balance due to gas costs for approval and swap. Just check tokenIn changes
                            checkQuoteToken(tokenInBefore, tokenInAfter, CurrencyAmount.fromRawAmount(USDC_MAINNET, data.quote));
                        }
                    });
                    it(`erc20 -> eth large trade with permit`, async () => {
                        const nonce = nextPermitNonce();
                        const amount = type == 'exactIn'
                            ? await getAmount(1, type, 'USDC', 'ETH', '1000000')
                            : await getAmount(1, type, 'USDC', 'ETH', '100');
                        const permit = {
                            details: {
                                token: USDC_MAINNET.address,
                                amount: '1500000000000',
                                expiration: Math.floor(new Date().getTime() / 1000 + 10000000).toString(),
                                nonce,
                            },
                            spender: UNIVERSAL_ROUTER_ADDRESS,
                            sigDeadline: Math.floor(new Date().getTime() / 1000 + 10000000).toString(),
                        };
                        const { domain, types, values } = AllowanceTransfer.getPermitData(permit, PERMIT2_ADDRESS, 1);
                        const signature = await alice._signTypedData(domain, types, values);
                        // Trade of this size almost always results in splits.
                        const quoteReq = {
                            tokenInAddress: 'USDC',
                            tokenInChainId: 1,
                            tokenOutAddress: 'ETH',
                            tokenOutChainId: 1,
                            amount,
                            type,
                            recipient: alice.address,
                            slippageTolerance: SLIPPAGE,
                            deadline: '360',
                            algorithm,
                            permitSignature: signature,
                            permitAmount: permit.details.amount.toString(),
                            permitExpiration: permit.details.expiration.toString(),
                            permitSigDeadline: permit.sigDeadline.toString(),
                            permitNonce: permit.details.nonce.toString(),
                            enableUniversalRouter: true,
                        };
                        const queryParams = qs.stringify(quoteReq);
                        const response = await axios.get(`${API}?${queryParams}`);
                        const { data, status } = response;
                        expect(status).to.equal(200);
                        expect(data.methodParameters).to.not.be.undefined;
                        expect(data.route).to.not.be.undefined;
                        const { tokenInBefore, tokenInAfter, tokenOutBefore, tokenOutAfter } = await executeSwap(data.methodParameters, USDC_MAINNET, Ether.onChain(1), true);
                        if (type == 'exactIn') {
                            expect(tokenInBefore.subtract(tokenInAfter).toExact()).to.equal('1000000');
                            checkQuoteToken(tokenOutBefore, tokenOutAfter, CurrencyAmount.fromRawAmount(Ether.onChain(1), data.quote));
                        }
                        else {
                            // Hard to test ETH balance due to gas costs for approval and swap. Just check tokenIn changes
                            checkQuoteToken(tokenInBefore, tokenInAfter, CurrencyAmount.fromRawAmount(USDC_MAINNET, data.quote));
                        }
                    });
                    it(`eth -> erc20`, async () => {
                        const quoteReq = {
                            tokenInAddress: 'ETH',
                            tokenInChainId: 1,
                            tokenOutAddress: 'UNI',
                            tokenOutChainId: 1,
                            amount: type == 'exactIn'
                                ? await getAmount(1, type, 'ETH', 'UNI', '10')
                                : await getAmount(1, type, 'ETH', 'UNI', '10000'),
                            type,
                            recipient: alice.address,
                            slippageTolerance: SLIPPAGE,
                            deadline: '360',
                            algorithm,
                            enableUniversalRouter: true,
                        };
                        const queryParams = qs.stringify(quoteReq);
                        const response = await axios.get(`${API}?${queryParams}`);
                        const { data, status } = response;
                        expect(status).to.equal(200);
                        expect(data.methodParameters).to.not.be.undefined;
                        const { tokenInBefore, tokenInAfter, tokenOutBefore, tokenOutAfter } = await executeSwap(data.methodParameters, Ether.onChain(1), UNI_MAINNET);
                        if (type == 'exactIn') {
                            // We've swapped 10 ETH + gas costs
                            expect(tokenInBefore.subtract(tokenInAfter).greaterThan(parseAmount('10', Ether.onChain(1)))).to.be.true;
                            checkQuoteToken(tokenOutBefore, tokenOutAfter, CurrencyAmount.fromRawAmount(UNI_MAINNET, data.quote));
                        }
                        else {
                            expect(tokenOutAfter.subtract(tokenOutBefore).toExact()).to.equal('10000');
                            // Can't easily check slippage for ETH due to gas costs effecting ETH balance.
                        }
                    });
                    it(`eth -> erc20 swaprouter02`, async () => {
                        var _a;
                        const quoteReq = {
                            tokenInAddress: 'ETH',
                            tokenInChainId: 1,
                            tokenOutAddress: 'UNI',
                            tokenOutChainId: 1,
                            amount: type == 'exactIn'
                                ? await getAmount(1, type, 'ETH', 'UNI', '10')
                                : await getAmount(1, type, 'ETH', 'UNI', '10000'),
                            type,
                            recipient: alice.address,
                            slippageTolerance: SLIPPAGE,
                            deadline: '360',
                            algorithm,
                            enableUniversalRouter: false,
                        };
                        const queryParams = qs.stringify(quoteReq);
                        const response = await axios.get(`${API}?${queryParams}`);
                        const { data, status } = response;
                        expect(status).to.equal(200);
                        expect(data.methodParameters).to.not.be.undefined;
                        expect((_a = data.methodParameters) === null || _a === void 0 ? void 0 : _a.to).to.equal(SWAP_ROUTER_02_ADDRESSES(ChainId.MAINNET));
                        const { tokenInBefore, tokenInAfter, tokenOutBefore, tokenOutAfter } = await executeSwap(data.methodParameters, Ether.onChain(1), UNI_MAINNET);
                        if (type == 'exactIn') {
                            // We've swapped 10 ETH + gas costs
                            expect(tokenInBefore.subtract(tokenInAfter).greaterThan(parseAmount('10', Ether.onChain(1)))).to.be.true;
                            checkQuoteToken(tokenOutBefore, tokenOutAfter, CurrencyAmount.fromRawAmount(UNI_MAINNET, data.quote));
                        }
                        else {
                            expect(tokenOutAfter.subtract(tokenOutBefore).toExact()).to.equal('10000');
                            // Can't easily check slippage for ETH due to gas costs effecting ETH balance.
                        }
                    });
                    it(`weth -> erc20`, async () => {
                        const quoteReq = {
                            tokenInAddress: 'WETH',
                            tokenInChainId: 1,
                            tokenOutAddress: 'DAI',
                            tokenOutChainId: 1,
                            amount: await getAmount(1, type, 'WETH', 'DAI', '100'),
                            type,
                            recipient: alice.address,
                            slippageTolerance: SLIPPAGE,
                            deadline: '360',
                            algorithm,
                            enableUniversalRouter: true,
                        };
                        const queryParams = qs.stringify(quoteReq);
                        const response = await axios.get(`${API}?${queryParams}`);
                        const { data, status } = response;
                        expect(status).to.equal(200);
                        expect(data.methodParameters).to.not.be.undefined;
                        const { tokenInBefore, tokenInAfter, tokenOutBefore, tokenOutAfter } = await executeSwap(data.methodParameters, WETH9[1], DAI_MAINNET);
                        if (type == 'exactIn') {
                            expect(tokenInBefore.subtract(tokenInAfter).toExact()).to.equal('100');
                            checkQuoteToken(tokenOutBefore, tokenOutAfter, CurrencyAmount.fromRawAmount(DAI_MAINNET, data.quote));
                        }
                        else {
                            expect(tokenOutAfter.subtract(tokenOutBefore).toExact()).to.equal('100');
                            checkQuoteToken(tokenInBefore, tokenInAfter, CurrencyAmount.fromRawAmount(WETH9[1], data.quote));
                        }
                    });
                    it(`erc20 -> weth`, async () => {
                        const quoteReq = {
                            tokenInAddress: 'USDC',
                            tokenInChainId: 1,
                            tokenOutAddress: 'WETH',
                            tokenOutChainId: 1,
                            amount: await getAmount(1, type, 'USDC', 'WETH', '100'),
                            type,
                            recipient: alice.address,
                            slippageTolerance: SLIPPAGE,
                            deadline: '360',
                            algorithm,
                            enableUniversalRouter: true,
                        };
                        const queryParams = qs.stringify(quoteReq);
                        const response = await axios.get(`${API}?${queryParams}`);
                        const { data, status } = response;
                        expect(status).to.equal(200);
                        expect(data.methodParameters).to.not.be.undefined;
                        const { tokenInBefore, tokenInAfter, tokenOutBefore, tokenOutAfter } = await executeSwap(data.methodParameters, USDC_MAINNET, WETH9[1]);
                        if (type == 'exactIn') {
                            expect(tokenInBefore.subtract(tokenInAfter).toExact()).to.equal('100');
                            checkQuoteToken(tokenOutBefore, tokenOutAfter, CurrencyAmount.fromRawAmount(WETH9[1], data.quote));
                        }
                        else {
                            expect(tokenOutAfter.subtract(tokenOutBefore).toExact()).to.equal('100');
                            checkQuoteToken(tokenInBefore, tokenInAfter, CurrencyAmount.fromRawAmount(USDC_MAINNET, data.quote));
                        }
                    });
                    if (algorithm == 'alpha') {
                        it(`erc20 -> erc20 v3 only`, async () => {
                            const quoteReq = {
                                tokenInAddress: 'USDC',
                                tokenInChainId: 1,
                                tokenOutAddress: 'USDT',
                                tokenOutChainId: 1,
                                amount: await getAmount(1, type, 'USDC', 'USDT', '100'),
                                type,
                                recipient: alice.address,
                                slippageTolerance: SLIPPAGE,
                                deadline: '360',
                                algorithm: 'alpha',
                                protocols: 'v3',
                                enableUniversalRouter: true,
                            };
                            const queryParams = qs.stringify(quoteReq);
                            const response = await axios.get(`${API}?${queryParams}`);
                            const { data: { quote, quoteDecimals, quoteGasAdjustedDecimals, methodParameters, route }, status, } = response;
                            expect(status).to.equal(200);
                            expect(parseFloat(quoteDecimals)).to.be.greaterThan(90);
                            expect(parseFloat(quoteDecimals)).to.be.lessThan(110);
                            if (type == 'exactIn') {
                                expect(parseFloat(quoteGasAdjustedDecimals)).to.be.lessThanOrEqual(parseFloat(quoteDecimals));
                            }
                            else {
                                expect(parseFloat(quoteGasAdjustedDecimals)).to.be.greaterThanOrEqual(parseFloat(quoteDecimals));
                            }
                            expect(methodParameters).to.not.be.undefined;
                            for (const r of route) {
                                for (const pool of r) {
                                    expect(pool.type).to.equal('v3-pool');
                                }
                            }
                            const { tokenInBefore, tokenInAfter, tokenOutBefore, tokenOutAfter } = await executeSwap(response.data.methodParameters, USDC_MAINNET, USDT_MAINNET);
                            if (type == 'exactIn') {
                                expect(tokenInBefore.subtract(tokenInAfter).toExact()).to.equal('100');
                                checkQuoteToken(tokenOutBefore, tokenOutAfter, CurrencyAmount.fromRawAmount(USDT_MAINNET, quote));
                            }
                            else {
                                expect(tokenOutAfter.subtract(tokenOutBefore).toExact()).to.equal('100');
                                checkQuoteToken(tokenInBefore, tokenInAfter, CurrencyAmount.fromRawAmount(USDC_MAINNET, quote));
                            }
                        });
                        it(`erc20 -> erc20 v2 only`, async () => {
                            const quoteReq = {
                                tokenInAddress: 'USDC',
                                tokenInChainId: 1,
                                tokenOutAddress: 'USDT',
                                tokenOutChainId: 1,
                                amount: await getAmount(1, type, 'USDC', 'USDT', '100'),
                                type,
                                recipient: alice.address,
                                slippageTolerance: SLIPPAGE,
                                deadline: '360',
                                algorithm: 'alpha',
                                protocols: 'v2',
                                enableUniversalRouter: true,
                            };
                            const queryParams = qs.stringify(quoteReq);
                            const response = await axios.get(`${API}?${queryParams}`);
                            const { data: { quote, quoteDecimals, quoteGasAdjustedDecimals, methodParameters, route }, status, } = response;
                            expect(status).to.equal(200);
                            expect(parseFloat(quoteDecimals)).to.be.greaterThan(90);
                            expect(parseFloat(quoteDecimals)).to.be.lessThan(110);
                            if (type == 'exactIn') {
                                expect(parseFloat(quoteGasAdjustedDecimals)).to.be.lessThanOrEqual(parseFloat(quoteDecimals));
                            }
                            else {
                                expect(parseFloat(quoteGasAdjustedDecimals)).to.be.greaterThanOrEqual(parseFloat(quoteDecimals));
                            }
                            expect(methodParameters).to.not.be.undefined;
                            for (const r of route) {
                                for (const pool of r) {
                                    expect(pool.type).to.equal('v2-pool');
                                }
                            }
                            const { tokenInBefore, tokenInAfter, tokenOutBefore, tokenOutAfter } = await executeSwap(response.data.methodParameters, USDC_MAINNET, USDT_MAINNET);
                            if (type == 'exactIn') {
                                expect(tokenInBefore.subtract(tokenInAfter).toExact()).to.equal('100');
                                checkQuoteToken(tokenOutBefore, tokenOutAfter, CurrencyAmount.fromRawAmount(USDT_MAINNET, quote));
                            }
                            else {
                                expect(tokenOutAfter.subtract(tokenOutBefore).toExact()).to.equal('100');
                                checkQuoteToken(tokenInBefore, tokenInAfter, CurrencyAmount.fromRawAmount(USDC_MAINNET, quote));
                            }
                        });
                        it(`erc20 -> erc20 forceCrossProtocol`, async () => {
                            const quoteReq = {
                                tokenInAddress: 'USDC',
                                tokenInChainId: 1,
                                tokenOutAddress: 'USDT',
                                tokenOutChainId: 1,
                                amount: await getAmount(1, type, 'USDC', 'USDT', '100'),
                                type,
                                recipient: alice.address,
                                slippageTolerance: SLIPPAGE,
                                deadline: '360',
                                algorithm: 'alpha',
                                forceCrossProtocol: true,
                                enableUniversalRouter: true,
                            };
                            const queryParams = qs.stringify(quoteReq);
                            const response = await axios.get(`${API}?${queryParams}`);
                            const { data: { quote, quoteDecimals, quoteGasAdjustedDecimals, methodParameters, route }, status, } = response;
                            expect(status).to.equal(200);
                            expect(parseFloat(quoteDecimals)).to.be.greaterThan(90);
                            expect(parseFloat(quoteDecimals)).to.be.lessThan(110);
                            if (type == 'exactIn') {
                                expect(parseFloat(quoteGasAdjustedDecimals)).to.be.lessThanOrEqual(parseFloat(quoteDecimals));
                            }
                            else {
                                expect(parseFloat(quoteGasAdjustedDecimals)).to.be.greaterThanOrEqual(parseFloat(quoteDecimals));
                            }
                            expect(methodParameters).to.not.be.undefined;
                            let hasV3Pool = false;
                            let hasV2Pool = false;
                            for (const r of route) {
                                for (const pool of r) {
                                    if (pool.type == 'v3-pool') {
                                        hasV3Pool = true;
                                    }
                                    if (pool.type == 'v2-pool') {
                                        hasV2Pool = true;
                                    }
                                }
                            }
                            expect(hasV3Pool && hasV2Pool).to.be.true;
                            const { tokenInBefore, tokenInAfter, tokenOutBefore, tokenOutAfter } = await executeSwap(response.data.methodParameters, USDC_MAINNET, USDT_MAINNET);
                            if (type == 'exactIn') {
                                expect(tokenInBefore.subtract(tokenInAfter).toExact()).to.equal('100');
                                checkQuoteToken(tokenOutBefore, tokenOutAfter, CurrencyAmount.fromRawAmount(USDT_MAINNET, quote));
                            }
                            else {
                                expect(tokenOutAfter.subtract(tokenOutBefore).toExact()).to.equal('100');
                                checkQuoteToken(tokenInBefore, tokenInAfter, CurrencyAmount.fromRawAmount(USDC_MAINNET, quote));
                            }
                        });
                        /// Tests for routes likely to result in MixedRoutes being returned
                        if (type === 'exactIn') {
                            it(`erc20 -> erc20 forceMixedRoutes not specified for v2,v3 does not return mixed route even when it is better`, async () => {
                                const quoteReq = {
                                    tokenInAddress: 'BOND',
                                    tokenInChainId: 1,
                                    tokenOutAddress: 'APE',
                                    tokenOutChainId: 1,
                                    amount: await getAmount(1, type, 'BOND', 'APE', '10000'),
                                    type,
                                    recipient: alice.address,
                                    slippageTolerance: SLIPPAGE,
                                    deadline: '360',
                                    algorithm: 'alpha',
                                    protocols: 'v2,v3',
                                    enableUniversalRouter: true,
                                };
                                const queryParams = qs.stringify(quoteReq);
                                const response = await axios.get(`${API}?${queryParams}`);
                                const { data: { quoteDecimals, quoteGasAdjustedDecimals, methodParameters, routeString }, status, } = response;
                                expect(status).to.equal(200);
                                if (type == 'exactIn') {
                                    expect(parseFloat(quoteGasAdjustedDecimals)).to.be.lessThanOrEqual(parseFloat(quoteDecimals));
                                }
                                else {
                                    expect(parseFloat(quoteGasAdjustedDecimals)).to.be.greaterThanOrEqual(parseFloat(quoteDecimals));
                                }
                                expect(methodParameters).to.not.be.undefined;
                                expect(!routeString.includes('[V2 + V3]'));
                            });
                            it(`erc20 -> erc20 forceMixedRoutes true for v2,v3`, async () => {
                                const quoteReq = {
                                    tokenInAddress: 'BOND',
                                    tokenInChainId: 1,
                                    tokenOutAddress: 'APE',
                                    tokenOutChainId: 1,
                                    amount: await getAmount(1, type, 'BOND', 'APE', '10000'),
                                    type,
                                    recipient: alice.address,
                                    slippageTolerance: SLIPPAGE,
                                    deadline: '360',
                                    algorithm: 'alpha',
                                    forceMixedRoutes: true,
                                    protocols: 'v2,v3',
                                    enableUniversalRouter: true,
                                };
                                await callAndExpectFail(quoteReq, {
                                    status: 404,
                                    data: {
                                        detail: 'No route found',
                                        errorCode: 'NO_ROUTE',
                                    },
                                });
                            });
                            it(`erc20 -> erc20 forceMixedRoutes true for all protocols specified`, async () => {
                                const quoteReq = {
                                    tokenInAddress: 'BOND',
                                    tokenInChainId: 1,
                                    tokenOutAddress: 'APE',
                                    tokenOutChainId: 1,
                                    amount: await getAmount(1, type, 'BOND', 'APE', '10000'),
                                    type,
                                    recipient: alice.address,
                                    slippageTolerance: SLIPPAGE,
                                    deadline: '360',
                                    algorithm: 'alpha',
                                    forceMixedRoutes: true,
                                    protocols: 'v2,v3,mixed',
                                    enableUniversalRouter: true,
                                };
                                const queryParams = qs.stringify(quoteReq);
                                const response = await axios.get(`${API}?${queryParams}`);
                                const { data: { quoteDecimals, quoteGasAdjustedDecimals, methodParameters, routeString }, status, } = response;
                                expect(status).to.equal(200);
                                if (type == 'exactIn') {
                                    expect(parseFloat(quoteGasAdjustedDecimals)).to.be.lessThanOrEqual(parseFloat(quoteDecimals));
                                }
                                else {
                                    expect(parseFloat(quoteGasAdjustedDecimals)).to.be.greaterThanOrEqual(parseFloat(quoteDecimals));
                                }
                                expect(methodParameters).to.not.be.undefined;
                                /// since we only get the routeString back, we can check if there's V3 + V2
                                expect(routeString.includes('[V2 + V3]'));
                            });
                        }
                    }
                });
                if (algorithm == 'alpha') {
                    describe(`+ Simulate Swap + Execute Swap`, () => {
                        it(`erc20 -> erc20`, async () => {
                            const quoteReq = {
                                tokenInAddress: 'USDC',
                                tokenInChainId: 1,
                                tokenOutAddress: 'USDT',
                                tokenOutChainId: 1,
                                amount: await getAmount(1, type, 'USDC', 'USDT', '100'),
                                type,
                                recipient: alice.address,
                                slippageTolerance: SLIPPAGE,
                                deadline: '360',
                                algorithm,
                                simulateFromAddress: '0xf584f8728b874a6a5c7a8d4d387c9aae9172d621',
                                enableUniversalRouter: true,
                            };
                            const queryParams = qs.stringify(quoteReq);
                            const response = await axios.get(`${API}?${queryParams}`);
                            const { data: { quote, quoteDecimals, quoteGasAdjustedDecimals, methodParameters, simulationError }, status, } = response;
                            expect(status).to.equal(200);
                            expect(simulationError).to.equal(false);
                            expect(parseFloat(quoteDecimals)).to.be.greaterThan(90);
                            expect(parseFloat(quoteDecimals)).to.be.lessThan(110);
                            if (type == 'exactIn') {
                                expect(parseFloat(quoteGasAdjustedDecimals)).to.be.lessThanOrEqual(parseFloat(quoteDecimals));
                            }
                            else {
                                expect(parseFloat(quoteGasAdjustedDecimals)).to.be.greaterThanOrEqual(parseFloat(quoteDecimals));
                            }
                            expect(methodParameters).to.not.be.undefined;
                            const { tokenInBefore, tokenInAfter, tokenOutBefore, tokenOutAfter } = await executeSwap(methodParameters, USDC_MAINNET, USDT_MAINNET);
                            if (type == 'exactIn') {
                                expect(tokenInBefore.subtract(tokenInAfter).toExact()).to.equal('100');
                                checkQuoteToken(tokenOutBefore, tokenOutAfter, CurrencyAmount.fromRawAmount(USDT_MAINNET, quote));
                            }
                            else {
                                expect(tokenOutAfter.subtract(tokenOutBefore).toExact()).to.equal('100');
                                checkQuoteToken(tokenInBefore, tokenInAfter, CurrencyAmount.fromRawAmount(USDC_MAINNET, quote));
                            }
                        });
                        it(`erc20 -> erc20 swaprouter02`, async () => {
                            const quoteReq = {
                                tokenInAddress: 'USDC',
                                tokenInChainId: 1,
                                tokenOutAddress: 'USDT',
                                tokenOutChainId: 1,
                                amount: await getAmount(1, type, 'USDC', 'USDT', '100'),
                                type,
                                recipient: alice.address,
                                slippageTolerance: SLIPPAGE,
                                deadline: '360',
                                algorithm,
                                simulateFromAddress: '0xf584f8728b874a6a5c7a8d4d387c9aae9172d621',
                            };
                            const queryParams = qs.stringify(quoteReq);
                            const response = await axios.get(`${API}?${queryParams}`);
                            const { data: { quote, quoteDecimals, quoteGasAdjustedDecimals, methodParameters, simulationError }, status, } = response;
                            expect(status).to.equal(200);
                            expect(simulationError).to.equal(false);
                            expect(parseFloat(quoteDecimals)).to.be.greaterThan(90);
                            expect(parseFloat(quoteDecimals)).to.be.lessThan(110);
                            if (type == 'exactIn') {
                                expect(parseFloat(quoteGasAdjustedDecimals)).to.be.lessThanOrEqual(parseFloat(quoteDecimals));
                            }
                            else {
                                expect(parseFloat(quoteGasAdjustedDecimals)).to.be.greaterThanOrEqual(parseFloat(quoteDecimals));
                            }
                            expect(methodParameters).to.not.be.undefined;
                            expect(methodParameters.to).to.equal(SWAP_ROUTER_02_ADDRESSES(ChainId.MAINNET));
                            const { tokenInBefore, tokenInAfter, tokenOutBefore, tokenOutAfter } = await executeSwap(methodParameters, USDC_MAINNET, USDT_MAINNET);
                            if (type == 'exactIn') {
                                expect(tokenInBefore.subtract(tokenInAfter).toExact()).to.equal('100');
                                checkQuoteToken(tokenOutBefore, tokenOutAfter, CurrencyAmount.fromRawAmount(USDT_MAINNET, quote));
                            }
                            else {
                                expect(tokenOutAfter.subtract(tokenOutBefore).toExact()).to.equal('100');
                                checkQuoteToken(tokenInBefore, tokenInAfter, CurrencyAmount.fromRawAmount(USDC_MAINNET, quote));
                            }
                        });
                        if (isTesterPKEnvironmentSet()) {
                            it(`erc20 -> erc20 with permit with tester pk`, async () => {
                                // This test requires a private key with at least 10 USDC
                                // at FORK_BLOCK time.
                                const amount = await getAmount(1, type, 'USDC', 'USDT', '10');
                                const nonce = '0';
                                const permit = {
                                    details: {
                                        token: USDC_MAINNET.address,
                                        amount: amount,
                                        expiration: Math.floor(new Date().getTime() / 1000 + 10000000).toString(),
                                        nonce,
                                    },
                                    spender: UNIVERSAL_ROUTER_ADDRESS,
                                    sigDeadline: Math.floor(new Date().getTime() / 1000 + 10000000).toString(),
                                };
                                const wallet = new Wallet(process.env.TESTER_PK);
                                const { domain, types, values } = AllowanceTransfer.getPermitData(permit, PERMIT2_ADDRESS, 1);
                                const signature = await wallet._signTypedData(domain, types, values);
                                const quoteReq = {
                                    tokenInAddress: 'USDC',
                                    tokenInChainId: 1,
                                    tokenOutAddress: 'USDT',
                                    tokenOutChainId: 1,
                                    amount,
                                    type,
                                    recipient: wallet.address,
                                    slippageTolerance: SLIPPAGE,
                                    deadline: '360',
                                    algorithm,
                                    simulateFromAddress: wallet.address,
                                    permitSignature: signature,
                                    permitAmount: permit.details.amount.toString(),
                                    permitExpiration: permit.details.expiration.toString(),
                                    permitSigDeadline: permit.sigDeadline.toString(),
                                    permitNonce: permit.details.nonce.toString(),
                                    enableUniversalRouter: true,
                                };
                                const queryParams = qs.stringify(quoteReq);
                                const response = await axios.get(`${API}?${queryParams}`);
                                const { data: { quoteDecimals, quoteGasAdjustedDecimals, methodParameters, simulationError }, status, } = response;
                                expect(status).to.equal(200);
                                expect(simulationError).to.equal(false);
                                expect(parseFloat(quoteDecimals)).to.be.greaterThan(9);
                                expect(parseFloat(quoteDecimals)).to.be.lessThan(11);
                                if (type == 'exactIn') {
                                    expect(parseFloat(quoteGasAdjustedDecimals)).to.be.lessThanOrEqual(parseFloat(quoteDecimals));
                                }
                                else {
                                    expect(parseFloat(quoteGasAdjustedDecimals)).to.be.greaterThanOrEqual(parseFloat(quoteDecimals));
                                }
                                expect(methodParameters).to.not.be.undefined;
                            });
                        }
                        it(`erc20 -> eth`, async () => {
                            const quoteReq = {
                                tokenInAddress: 'USDC',
                                tokenInChainId: 1,
                                tokenOutAddress: 'ETH',
                                tokenOutChainId: 1,
                                amount: await getAmount(1, type, 'USDC', 'ETH', type == 'exactIn' ? '1000000' : '10'),
                                type,
                                recipient: alice.address,
                                slippageTolerance: SLIPPAGE,
                                deadline: '360',
                                algorithm,
                                simulateFromAddress: '0xf584f8728b874a6a5c7a8d4d387c9aae9172d621',
                                enableUniversalRouter: true,
                            };
                            const queryParams = qs.stringify(quoteReq);
                            const response = await axios.get(`${API}?${queryParams}`);
                            const { data: { quote, methodParameters, simulationError }, status, } = response;
                            expect(status).to.equal(200);
                            expect(simulationError).to.equal(false);
                            expect(methodParameters).to.not.be.undefined;
                            const { tokenInBefore, tokenInAfter, tokenOutBefore, tokenOutAfter } = await executeSwap(methodParameters, USDC_MAINNET, Ether.onChain(1));
                            if (type == 'exactIn') {
                                expect(tokenInBefore.subtract(tokenInAfter).toExact()).to.equal('1000000');
                                checkQuoteToken(tokenOutBefore, tokenOutAfter, CurrencyAmount.fromRawAmount(Ether.onChain(1), quote));
                            }
                            else {
                                // Hard to test ETH balance due to gas costs for approval and swap. Just check tokenIn changes
                                checkQuoteToken(tokenInBefore, tokenInAfter, CurrencyAmount.fromRawAmount(USDC_MAINNET, quote));
                            }
                        });
                        it(`erc20 -> eth large trade`, async () => {
                            // Trade of this size almost always results in splits.
                            const quoteReq = {
                                tokenInAddress: 'USDC',
                                tokenInChainId: 1,
                                tokenOutAddress: 'ETH',
                                tokenOutChainId: 1,
                                amount: type == 'exactIn'
                                    ? await getAmount(1, type, 'USDC', 'ETH', '1000000')
                                    : await getAmount(1, type, 'USDC', 'ETH', '100'),
                                type,
                                recipient: alice.address,
                                slippageTolerance: SLIPPAGE,
                                deadline: '360',
                                algorithm,
                                simulateFromAddress: '0xf584f8728b874a6a5c7a8d4d387c9aae9172d621',
                                enableUniversalRouter: true,
                            };
                            const queryParams = qs.stringify(quoteReq);
                            const response = await axios.get(`${API}?${queryParams}`);
                            const { data, status } = response;
                            expect(status).to.equal(200);
                            expect(data.simulationError).to.equal(false);
                            expect(data.methodParameters).to.not.be.undefined;
                            expect(data.route).to.not.be.undefined;
                            const amountInEdgesTotal = _(data.route)
                                .flatMap((route) => route[0])
                                .filter((pool) => !!pool.amountIn)
                                .map((pool) => BigNumber.from(pool.amountIn))
                                .reduce((cur, total) => total.add(cur), BigNumber.from(0));
                            const amountIn = BigNumber.from(data.quote);
                            expect(amountIn.eq(amountInEdgesTotal));
                            const amountOutEdgesTotal = _(data.route)
                                .flatMap((route) => route[0])
                                .filter((pool) => !!pool.amountOut)
                                .map((pool) => BigNumber.from(pool.amountOut))
                                .reduce((cur, total) => total.add(cur), BigNumber.from(0));
                            const amountOut = BigNumber.from(data.quote);
                            expect(amountOut.eq(amountOutEdgesTotal));
                            const { tokenInBefore, tokenInAfter, tokenOutBefore, tokenOutAfter } = await executeSwap(data.methodParameters, USDC_MAINNET, Ether.onChain(1));
                            if (type == 'exactIn') {
                                expect(tokenInBefore.subtract(tokenInAfter).toExact()).to.equal('1000000');
                                checkQuoteToken(tokenOutBefore, tokenOutAfter, CurrencyAmount.fromRawAmount(Ether.onChain(1), data.quote));
                            }
                            else {
                                // Hard to test ETH balance due to gas costs for approval and swap. Just check tokenIn changes
                                checkQuoteToken(tokenInBefore, tokenInAfter, CurrencyAmount.fromRawAmount(USDC_MAINNET, data.quote));
                            }
                        });
                        it(`eth -> erc20`, async () => {
                            const quoteReq = {
                                tokenInAddress: 'ETH',
                                tokenInChainId: 1,
                                tokenOutAddress: 'UNI',
                                tokenOutChainId: 1,
                                amount: type == 'exactIn'
                                    ? await getAmount(1, type, 'ETH', 'UNI', '10')
                                    : await getAmount(1, type, 'ETH', 'UNI', '10000'),
                                type,
                                recipient: alice.address,
                                slippageTolerance: SLIPPAGE,
                                deadline: '360',
                                algorithm,
                                simulateFromAddress: '0x0716a17FBAeE714f1E6aB0f9d59edbC5f09815C0',
                                enableUniversalRouter: true,
                            };
                            const queryParams = qs.stringify(quoteReq);
                            const response = await axios.get(`${API}?${queryParams}`);
                            const { data, status } = response;
                            expect(status).to.equal(200);
                            expect(data.simulationError).to.equal(false);
                            expect(data.methodParameters).to.not.be.undefined;
                            const { tokenInBefore, tokenInAfter, tokenOutBefore, tokenOutAfter } = await executeSwap(data.methodParameters, Ether.onChain(1), UNI_MAINNET);
                            if (type == 'exactIn') {
                                // We've swapped 10 ETH + gas costs
                                expect(tokenInBefore.subtract(tokenInAfter).greaterThan(parseAmount('10', Ether.onChain(1)))).to.be.true;
                                checkQuoteToken(tokenOutBefore, tokenOutAfter, CurrencyAmount.fromRawAmount(UNI_MAINNET, data.quote));
                            }
                            else {
                                expect(tokenOutAfter.subtract(tokenOutBefore).toExact()).to.equal('10000');
                                // Can't easily check slippage for ETH due to gas costs effecting ETH balance.
                            }
                        });
                        it(`eth -> erc20 swaprouter02`, async () => {
                            const quoteReq = {
                                tokenInAddress: 'ETH',
                                tokenInChainId: 1,
                                tokenOutAddress: 'UNI',
                                tokenOutChainId: 1,
                                amount: type == 'exactIn'
                                    ? await getAmount(1, type, 'ETH', 'UNI', '10')
                                    : await getAmount(1, type, 'ETH', 'UNI', '10000'),
                                type,
                                recipient: alice.address,
                                slippageTolerance: SLIPPAGE,
                                deadline: '360',
                                algorithm,
                                simulateFromAddress: '0x0716a17FBAeE714f1E6aB0f9d59edbC5f09815C0',
                                enableUniversalRouter: false,
                            };
                            const queryParams = qs.stringify(quoteReq);
                            const response = await axios.get(`${API}?${queryParams}`);
                            const { data, status } = response;
                            expect(status).to.equal(200);
                            expect(data.simulationError).to.equal(false);
                            expect(data.methodParameters).to.not.be.undefined;
                            const { tokenInBefore, tokenInAfter, tokenOutBefore, tokenOutAfter } = await executeSwap(data.methodParameters, Ether.onChain(1), UNI_MAINNET);
                            if (type == 'exactIn') {
                                // We've swapped 10 ETH + gas costs
                                expect(tokenInBefore.subtract(tokenInAfter).greaterThan(parseAmount('10', Ether.onChain(1)))).to.be.true;
                                checkQuoteToken(tokenOutBefore, tokenOutAfter, CurrencyAmount.fromRawAmount(UNI_MAINNET, data.quote));
                            }
                            else {
                                expect(tokenOutAfter.subtract(tokenOutBefore).toExact()).to.equal('10000');
                                // Can't easily check slippage for ETH due to gas costs effecting ETH balance.
                            }
                        });
                        it(`weth -> erc20`, async () => {
                            const quoteReq = {
                                tokenInAddress: 'WETH',
                                tokenInChainId: 1,
                                tokenOutAddress: 'DAI',
                                tokenOutChainId: 1,
                                amount: await getAmount(1, type, 'WETH', 'DAI', '100'),
                                type,
                                recipient: alice.address,
                                slippageTolerance: SLIPPAGE,
                                deadline: '360',
                                algorithm,
                                simulateFromAddress: '0xf04a5cc80b1e94c69b48f5ee68a08cd2f09a7c3e',
                                enableUniversalRouter: true,
                            };
                            const queryParams = qs.stringify(quoteReq);
                            const response = await axios.get(`${API}?${queryParams}`);
                            const { data, status } = response;
                            expect(status).to.equal(200);
                            expect(data.simulationError).to.equal(false);
                            expect(data.methodParameters).to.not.be.undefined;
                            const { tokenInBefore, tokenInAfter, tokenOutBefore, tokenOutAfter } = await executeSwap(data.methodParameters, WETH9[1], DAI_MAINNET);
                            if (type == 'exactIn') {
                                expect(tokenInBefore.subtract(tokenInAfter).toExact()).to.equal('100');
                                checkQuoteToken(tokenOutBefore, tokenOutAfter, CurrencyAmount.fromRawAmount(DAI_MAINNET, data.quote));
                            }
                            else {
                                expect(tokenOutAfter.subtract(tokenOutBefore).toExact()).to.equal('100');
                                checkQuoteToken(tokenInBefore, tokenInAfter, CurrencyAmount.fromRawAmount(WETH9[1], data.quote));
                            }
                        });
                        it(`erc20 -> weth`, async () => {
                            const quoteReq = {
                                tokenInAddress: 'USDC',
                                tokenInChainId: 1,
                                tokenOutAddress: 'WETH',
                                tokenOutChainId: 1,
                                amount: await getAmount(1, type, 'USDC', 'WETH', '100'),
                                type,
                                recipient: alice.address,
                                slippageTolerance: SLIPPAGE,
                                deadline: '360',
                                algorithm,
                                simulateFromAddress: '0xf584f8728b874a6a5c7a8d4d387c9aae9172d621',
                                enableUniversalRouter: true,
                            };
                            const queryParams = qs.stringify(quoteReq);
                            const response = await axios.get(`${API}?${queryParams}`);
                            const { data, status } = response;
                            expect(status).to.equal(200);
                            expect(data.simulationError).to.equal(false);
                            expect(data.methodParameters).to.not.be.undefined;
                            const { tokenInBefore, tokenInAfter, tokenOutBefore, tokenOutAfter } = await executeSwap(data.methodParameters, USDC_MAINNET, WETH9[1]);
                            if (type == 'exactIn') {
                                expect(tokenInBefore.subtract(tokenInAfter).toExact()).to.equal('100');
                                checkQuoteToken(tokenOutBefore, tokenOutAfter, CurrencyAmount.fromRawAmount(WETH9[1], data.quote));
                            }
                            else {
                                expect(tokenOutAfter.subtract(tokenOutBefore).toExact()).to.equal('100');
                                checkQuoteToken(tokenInBefore, tokenInAfter, CurrencyAmount.fromRawAmount(USDC_MAINNET, data.quote));
                            }
                        });
                    });
                }
                it(`erc20 -> erc20 no recipient/deadline/slippage`, async () => {
                    const quoteReq = {
                        tokenInAddress: 'USDC',
                        tokenInChainId: 1,
                        tokenOutAddress: 'USDT',
                        tokenOutChainId: 1,
                        amount: await getAmount(1, type, 'USDC', 'USDT', '100'),
                        type,
                        algorithm,
                        enableUniversalRouter: true,
                    };
                    const queryParams = qs.stringify(quoteReq);
                    const response = await axios.get(`${API}?${queryParams}`);
                    const { data: { quoteDecimals, quoteGasAdjustedDecimals, methodParameters }, status, } = response;
                    expect(status).to.equal(200);
                    expect(parseFloat(quoteDecimals)).to.be.greaterThan(90);
                    expect(parseFloat(quoteDecimals)).to.be.lessThan(110);
                    if (type == 'exactIn') {
                        expect(parseFloat(quoteGasAdjustedDecimals)).to.be.lessThanOrEqual(parseFloat(quoteDecimals));
                    }
                    else {
                        expect(parseFloat(quoteGasAdjustedDecimals)).to.be.greaterThanOrEqual(parseFloat(quoteDecimals));
                    }
                    expect(methodParameters).to.be.undefined;
                });
                it(`erc20 -> erc20 gas price specified`, async () => {
                    const quoteReq = {
                        tokenInAddress: 'USDC',
                        tokenInChainId: 1,
                        tokenOutAddress: 'USDT',
                        tokenOutChainId: 1,
                        amount: await getAmount(1, type, 'USDC', 'USDT', '100'),
                        type,
                        algorithm,
                        gasPriceWei: '60000000000',
                        enableUniversalRouter: true,
                    };
                    const queryParams = qs.stringify(quoteReq);
                    const response = await axios.get(`${API}?${queryParams}`);
                    const { data: { quoteDecimals, quoteGasAdjustedDecimals, methodParameters, gasPriceWei }, status, } = response;
                    expect(status).to.equal(200);
                    if (algorithm == 'alpha') {
                        expect(gasPriceWei).to.equal('60000000000');
                    }
                    expect(parseFloat(quoteDecimals)).to.be.greaterThan(90);
                    expect(parseFloat(quoteDecimals)).to.be.lessThan(110);
                    if (type == 'exactIn') {
                        expect(parseFloat(quoteGasAdjustedDecimals)).to.be.lessThanOrEqual(parseFloat(quoteDecimals));
                    }
                    else {
                        expect(parseFloat(quoteGasAdjustedDecimals)).to.be.greaterThanOrEqual(parseFloat(quoteDecimals));
                    }
                    expect(methodParameters).to.be.undefined;
                });
                it(`erc20 -> erc20 by address`, async () => {
                    const quoteReq = {
                        tokenInAddress: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
                        tokenInChainId: 1,
                        tokenOutAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
                        tokenOutChainId: 1,
                        amount: await getAmount(1, type, 'DAI', 'USDC', '100'),
                        type,
                        recipient: alice.address,
                        slippageTolerance: SLIPPAGE,
                        deadline: '360',
                        algorithm,
                        enableUniversalRouter: true,
                    };
                    const queryParams = qs.stringify(quoteReq);
                    const response = await axios.get(`${API}?${queryParams}`);
                    const { data: { quoteDecimals, quoteGasAdjustedDecimals }, status, } = response;
                    expect(status).to.equal(200);
                    expect(parseFloat(quoteDecimals)).to.be.greaterThan(90);
                    if (type == 'exactIn') {
                        expect(parseFloat(quoteGasAdjustedDecimals)).to.be.lessThanOrEqual(parseFloat(quoteDecimals));
                    }
                    else {
                        expect(parseFloat(quoteGasAdjustedDecimals)).to.be.greaterThanOrEqual(parseFloat(quoteDecimals));
                    }
                    expect(parseFloat(quoteDecimals)).to.be.lessThan(110);
                });
                it(`erc20 -> erc20 one by address one by symbol`, async () => {
                    const quoteReq = {
                        tokenInAddress: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
                        tokenInChainId: 1,
                        tokenOutAddress: 'USDC',
                        tokenOutChainId: 1,
                        amount: await getAmount(1, type, 'DAI', 'USDC', '100'),
                        type,
                        recipient: alice.address,
                        slippageTolerance: SLIPPAGE,
                        deadline: '360',
                        algorithm,
                        enableUniversalRouter: true,
                    };
                    const queryParams = qs.stringify(quoteReq);
                    const response = await axios.get(`${API}?${queryParams}`);
                    const { data: { quoteDecimals, quoteGasAdjustedDecimals }, status, } = response;
                    expect(status).to.equal(200);
                    expect(parseFloat(quoteDecimals)).to.be.greaterThan(90);
                    if (type == 'exactIn') {
                        expect(parseFloat(quoteGasAdjustedDecimals)).to.be.lessThanOrEqual(parseFloat(quoteDecimals));
                    }
                    else {
                        expect(parseFloat(quoteGasAdjustedDecimals)).to.be.greaterThanOrEqual(parseFloat(quoteDecimals));
                    }
                    expect(parseFloat(quoteDecimals)).to.be.lessThan(110);
                });
            });
            describe(`${ID_TO_NETWORK_NAME(1)} ${algorithm} ${type} 4xx`, () => {
                it(`field is missing in body`, async () => {
                    const quoteReq = {
                        tokenOutAddress: 'USDT',
                        tokenInChainId: 1,
                        tokenOutChainId: 1,
                        amount: await getAmount(1, type, 'USDC', 'USDT', '100'),
                        type,
                        recipient: alice.address,
                        slippageTolerance: SLIPPAGE,
                        deadline: '360',
                        algorithm,
                        enableUniversalRouter: true,
                    };
                    await callAndExpectFail(quoteReq, {
                        status: 400,
                        data: {
                            detail: '"tokenInAddress" is required',
                            errorCode: 'VALIDATION_ERROR',
                        },
                    });
                });
                it.skip(`amount is too big to find route`, async () => {
                    const quoteReq = {
                        tokenInAddress: 'UNI',
                        tokenInChainId: 1,
                        tokenOutAddress: 'KNC',
                        tokenOutChainId: 1,
                        amount: await getAmount(1, type, 'UNI', 'KNC', '9999999999999999999999999999999999999999999999999'),
                        type,
                        recipient: '0x88fc765949a27405480F374Aa49E20dcCD3fCfb8',
                        slippageTolerance: SLIPPAGE,
                        deadline: '360',
                        algorithm,
                        enableUniversalRouter: true,
                    };
                    await callAndExpectFail(quoteReq, {
                        status: 400,
                        data: {
                            detail: 'No route found',
                            errorCode: 'NO_ROUTE',
                        },
                    });
                });
                it(`amount is too big for uint256`, async () => {
                    const quoteReq = {
                        tokenInAddress: 'USDC',
                        tokenInChainId: 1,
                        tokenOutAddress: 'USDT',
                        tokenOutChainId: 1,
                        amount: await getAmount(1, type, 'USDC', 'USDT', '100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000'),
                        type,
                        recipient: alice.address,
                        slippageTolerance: SLIPPAGE,
                        deadline: '360',
                        algorithm,
                    };
                    await callAndExpectFail(quoteReq, {
                        status: 400,
                        data: {
                            detail: '"amount" length must be less than or equal to 77 characters long',
                            errorCode: 'VALIDATION_ERROR',
                        },
                    });
                });
                it(`amount is negative`, async () => {
                    const quoteReq = {
                        tokenInAddress: 'USDC',
                        tokenInChainId: 1,
                        tokenOutAddress: 'USDT',
                        tokenOutChainId: 1,
                        amount: '-10000000000',
                        type,
                        recipient: alice.address,
                        slippageTolerance: SLIPPAGE,
                        deadline: '360',
                        algorithm,
                        enableUniversalRouter: true,
                    };
                    await callAndExpectFail(quoteReq, {
                        status: 400,
                        data: {
                            detail: '"amount" with value "-10000000000" fails to match the required pattern: /^[0-9]+$/',
                            errorCode: 'VALIDATION_ERROR',
                        },
                    });
                });
                it(`amount is decimal`, async () => {
                    const quoteReq = {
                        tokenInAddress: 'USDC',
                        tokenInChainId: 1,
                        tokenOutAddress: 'USDT',
                        tokenOutChainId: 1,
                        amount: '1000000000.25',
                        type,
                        recipient: alice.address,
                        slippageTolerance: SLIPPAGE,
                        deadline: '360',
                        algorithm,
                        enableUniversalRouter: true,
                    };
                    await callAndExpectFail(quoteReq, {
                        status: 400,
                        data: {
                            detail: '"amount" with value "1000000000.25" fails to match the required pattern: /^[0-9]+$/',
                            errorCode: 'VALIDATION_ERROR',
                        },
                    });
                });
                it(`symbol doesnt exist`, async () => {
                    const quoteReq = {
                        tokenInAddress: 'USDC',
                        tokenInChainId: 1,
                        tokenOutAddress: 'NONEXISTANTTOKEN',
                        tokenOutChainId: 1,
                        amount: await getAmount(1, type, 'USDC', 'USDT', '100'),
                        type,
                        recipient: alice.address,
                        slippageTolerance: SLIPPAGE,
                        deadline: '360',
                        algorithm,
                    };
                    await callAndExpectFail(quoteReq, {
                        status: 400,
                        data: {
                            detail: 'Could not find token with address "NONEXISTANTTOKEN"',
                            errorCode: 'TOKEN_OUT_INVALID',
                        },
                    });
                });
                it(`tokens are the same symbol`, async () => {
                    const quoteReq = {
                        tokenInAddress: 'USDT',
                        tokenInChainId: 1,
                        tokenOutAddress: 'USDT',
                        tokenOutChainId: 1,
                        amount: await getAmount(1, type, 'USDC', 'USDT', '100'),
                        type,
                        recipient: alice.address,
                        slippageTolerance: SLIPPAGE,
                        deadline: '360',
                        algorithm,
                        enableUniversalRouter: true,
                    };
                    await callAndExpectFail(quoteReq, {
                        status: 400,
                        data: {
                            detail: 'tokenIn and tokenOut must be different',
                            errorCode: 'TOKEN_IN_OUT_SAME',
                        },
                    });
                });
                it(`tokens are the same symbol and address`, async () => {
                    const quoteReq = {
                        tokenInAddress: 'USDT',
                        tokenInChainId: 1,
                        tokenOutAddress: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
                        tokenOutChainId: 1,
                        amount: await getAmount(1, type, 'USDT', 'USDT', '100'),
                        type,
                        recipient: alice.address,
                        slippageTolerance: SLIPPAGE,
                        deadline: '360',
                        algorithm,
                        enableUniversalRouter: true,
                    };
                    await callAndExpectFail(quoteReq, {
                        status: 400,
                        data: {
                            detail: 'tokenIn and tokenOut must be different',
                            errorCode: 'TOKEN_IN_OUT_SAME',
                        },
                    });
                });
                it(`tokens are the same address`, async () => {
                    const quoteReq = {
                        tokenInAddress: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
                        tokenInChainId: 1,
                        tokenOutAddress: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
                        tokenOutChainId: 1,
                        amount: await getAmount(1, type, 'USDT', 'USDT', '100'),
                        type,
                        recipient: alice.address,
                        slippageTolerance: SLIPPAGE,
                        deadline: '360',
                        algorithm,
                        enableUniversalRouter: true,
                    };
                    await callAndExpectFail(quoteReq, {
                        status: 400,
                        data: {
                            detail: 'tokenIn and tokenOut must be different',
                            errorCode: 'TOKEN_IN_OUT_SAME',
                        },
                    });
                });
                it(`one of recipient/deadline/slippage is missing`, async () => {
                    const quoteReq = {
                        tokenInAddress: 'USDC',
                        tokenInChainId: 1,
                        tokenOutAddress: 'USDT',
                        tokenOutChainId: 1,
                        amount: await getAmount(1, type, 'USDC', 'USDT', '100'),
                        type,
                        slippageTolerance: SLIPPAGE,
                        deadline: '360',
                        algorithm,
                        enableUniversalRouter: true,
                    };
                    await callAndExpectFail(quoteReq, {
                        status: 400,
                        data: {
                            detail: '"value" contains [slippageTolerance, deadline] without its required peers [recipient]',
                            errorCode: 'VALIDATION_ERROR',
                        },
                    });
                });
                it(`recipient is an invalid address`, async () => {
                    const quoteReq = {
                        tokenInAddress: 'USDT',
                        tokenInChainId: 1,
                        tokenOutAddress: 'USDC',
                        tokenOutChainId: 1,
                        amount: await getAmount(1, type, 'USDT', 'USDC', '100'),
                        type,
                        recipient: '0xAb5801a7D398351b8bE11C439e05C5B3259aZZZZZZZ',
                        slippageTolerance: SLIPPAGE,
                        deadline: '360',
                        algorithm,
                        enableUniversalRouter: true,
                    };
                    await callAndExpectFail(quoteReq, {
                        status: 400,
                        data: {
                            detail: '"recipient" with value "0xAb5801a7D398351b8bE11C439e05C5B3259aZZZZZZZ" fails to match the required pattern: /^0x[a-fA-F0-9]{40}$/',
                            errorCode: 'VALIDATION_ERROR',
                        },
                    });
                });
                it(`unsupported chain`, async () => {
                    const quoteReq = {
                        tokenInAddress: 'USDC',
                        tokenInChainId: 70,
                        tokenOutAddress: 'USDT',
                        tokenOutChainId: 70,
                        amount: '10000000000',
                        type,
                        recipient: alice.address,
                        slippageTolerance: SLIPPAGE,
                        deadline: '360',
                        algorithm,
                        enableUniversalRouter: true,
                    };
                    const chains = SUPPORTED_CHAINS.values();
                    const chainStr = [...chains].toString().split(',').join(', ');
                    await callAndExpectFail(quoteReq, {
                        status: 400,
                        data: {
                            detail: `"tokenInChainId" must be one of [${chainStr}]`,
                            errorCode: 'VALIDATION_ERROR',
                        },
                    });
                });
            });
        }
    }
    const TEST_ERC20_1 = {
        [ChainId.MAINNET]: USDC_ON(1),
        [ChainId.ROPSTEN]: USDC_ON(ChainId.ROPSTEN),
        [ChainId.RINKEBY]: USDC_ON(ChainId.RINKEBY),
        [ChainId.GÖRLI]: USDC_ON(ChainId.GÖRLI),
        [ChainId.KOVAN]: USDC_ON(ChainId.KOVAN),
        [ChainId.OPTIMISM]: USDC_ON(ChainId.OPTIMISM),
        [ChainId.OPTIMISTIC_KOVAN]: USDC_ON(ChainId.OPTIMISTIC_KOVAN),
        [ChainId.OPTIMISM_GOERLI]: USDC_ON(ChainId.OPTIMISM_GOERLI),
        [ChainId.ARBITRUM_ONE]: USDC_ON(ChainId.ARBITRUM_ONE),
        [ChainId.ARBITRUM_RINKEBY]: USDC_ON(ChainId.ARBITRUM_RINKEBY),
        [ChainId.POLYGON]: USDC_ON(ChainId.POLYGON),
        [ChainId.POLYGON_MUMBAI]: USDC_ON(ChainId.POLYGON_MUMBAI),
        [ChainId.CELO]: CUSD_CELO,
        [ChainId.CELO_ALFAJORES]: CUSD_CELO_ALFAJORES,
        [ChainId.MOONBEAM]: null,
        [ChainId.GNOSIS]: null,
        [ChainId.ARBITRUM_GOERLI]: null,
        [ChainId.BSC]: USDC_ON(ChainId.BSC),
        [ChainId.FANTOM]: USDC_ON(ChainId.FANTOM),
        [ChainId.KLAYTN]: USDC_ON(ChainId.KLAYTN),
    };
    const TEST_ERC20_2 = {
        [ChainId.MAINNET]: DAI_ON(1),
        [ChainId.ROPSTEN]: DAI_ON(ChainId.ROPSTEN),
        [ChainId.RINKEBY]: DAI_ON(ChainId.RINKEBY),
        [ChainId.GÖRLI]: DAI_ON(ChainId.GÖRLI),
        [ChainId.KOVAN]: DAI_ON(ChainId.KOVAN),
        [ChainId.OPTIMISM]: DAI_ON(ChainId.OPTIMISM),
        [ChainId.OPTIMISTIC_KOVAN]: DAI_ON(ChainId.OPTIMISTIC_KOVAN),
        [ChainId.OPTIMISM_GOERLI]: DAI_ON(ChainId.OPTIMISM_GOERLI),
        [ChainId.ARBITRUM_ONE]: DAI_ON(ChainId.ARBITRUM_ONE),
        [ChainId.ARBITRUM_RINKEBY]: DAI_ON(ChainId.ARBITRUM_RINKEBY),
        [ChainId.POLYGON]: DAI_ON(ChainId.POLYGON),
        [ChainId.POLYGON_MUMBAI]: DAI_ON(ChainId.POLYGON_MUMBAI),
        [ChainId.CELO]: CEUR_CELO,
        [ChainId.CELO_ALFAJORES]: CEUR_CELO_ALFAJORES,
        [ChainId.MOONBEAM]: null,
        [ChainId.GNOSIS]: null,
        [ChainId.ARBITRUM_GOERLI]: null,
        [ChainId.BSC]: USDT_ON(ChainId.BSC),
        [ChainId.FANTOM]: USDT_ON(ChainId.FANTOM),
        [ChainId.KLAYTN]: USDT_ON(ChainId.KLAYTN),
    };
    // TODO: Find valid pools/tokens on optimistic kovan and polygon mumbai. We skip those tests for now.
    for (const chain of _.filter(SUPPORTED_CHAINS, (c) => c != ChainId.OPTIMISTIC_KOVAN &&
        c != ChainId.POLYGON_MUMBAI &&
        c != ChainId.ARBITRUM_RINKEBY &&
        c != ChainId.ARBITRUM_GOERLI &&
        c != ChainId.CELO_ALFAJORES &&
        c != ChainId.KOVAN &&
        c != ChainId.RINKEBY &&
        c != ChainId.ROPSTEN &&
        c != ChainId.GÖRLI)) {
        for (const type of ['exactIn', 'exactOut']) {
            const erc1 = TEST_ERC20_1[chain];
            const erc2 = TEST_ERC20_2[chain];
            // This is for Gnosis and Moonbeam which we don't have RPC Providers yet
            if (erc1 == null || erc2 == null)
                continue;
            describe(`${ID_TO_NETWORK_NAME(chain)} ${type} 2xx`, function () {
                // Help with test flakiness by retrying.
                this.retries(0);
                const wrappedNative = WNATIVE_ON(chain);
                it(`${wrappedNative.symbol} -> erc20`, async () => {
                    const quoteReq = {
                        tokenInAddress: wrappedNative.address,
                        tokenInChainId: chain,
                        tokenOutAddress: erc1.address,
                        tokenOutChainId: chain,
                        amount: await getAmountFromToken(type, wrappedNative, erc1, '1'),
                        type,
                        enableUniversalRouter: true,
                    };
                    const queryParams = qs.stringify(quoteReq);
                    try {
                        const response = await axios.get(`${API}?${queryParams}`);
                        const { status } = response;
                        expect(status).to.equal(200);
                    }
                    catch (err) {
                        fail(JSON.stringify(err.response.data));
                    }
                });
                it(`erc20 -> erc20`, async () => {
                    const quoteReq = {
                        tokenInAddress: erc1.address,
                        tokenInChainId: chain,
                        tokenOutAddress: erc2.address,
                        tokenOutChainId: chain,
                        amount: await getAmountFromToken(type, erc1, erc2, '1'),
                        type,
                    };
                    const queryParams = qs.stringify(quoteReq);
                    try {
                        const response = await axios.get(`${API}?${queryParams}`);
                        const { status } = response;
                        expect(status).to.equal(200);
                    }
                    catch (err) {
                        fail(JSON.stringify(err.response.data));
                    }
                });
                const native = NATIVE_CURRENCY[chain];
                it(`${native} -> erc20`, async () => {
                    const quoteReq = {
                        tokenInAddress: native,
                        tokenInChainId: chain,
                        tokenOutAddress: erc2.address,
                        tokenOutChainId: chain,
                        amount: await getAmountFromToken(type, WNATIVE_ON(chain), erc2, '1'),
                        type,
                        enableUniversalRouter: true,
                    };
                    const queryParams = qs.stringify(quoteReq);
                    try {
                        const response = await axios.get(`${API}?${queryParams}`);
                        const { status } = response;
                        expect(status).to.equal(200, JSON.stringify(response.data));
                    }
                    catch (err) {
                        fail(JSON.stringify(err.response.data));
                    }
                });
                it(`has quoteGasAdjusted values`, async () => {
                    const quoteReq = {
                        tokenInAddress: erc1.address,
                        tokenInChainId: chain,
                        tokenOutAddress: erc2.address,
                        tokenOutChainId: chain,
                        amount: await getAmountFromToken(type, erc1, erc2, '1'),
                        type,
                    };
                    const queryParams = qs.stringify(quoteReq);
                    try {
                        const response = await axios.get(`${API}?${queryParams}`);
                        const { data: { quoteDecimals, quoteGasAdjustedDecimals }, status, } = response;
                        expect(status).to.equal(200);
                        // check for quotes to be gas adjusted
                        if (type == 'exactIn') {
                            expect(parseFloat(quoteGasAdjustedDecimals)).to.be.lessThanOrEqual(parseFloat(quoteDecimals));
                        }
                        else {
                            expect(parseFloat(quoteGasAdjustedDecimals)).to.be.greaterThanOrEqual(parseFloat(quoteDecimals));
                        }
                    }
                    catch (err) {
                        fail(JSON.stringify(err.response.data));
                    }
                });
            });
        }
    }
});
describe('alpha only quote', function () {
    this.timeout(5000);
    for (const type of ['exactIn', 'exactOut']) {
        describe(`${type} 2xx`, () => { });
    }
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicXVvdGUudGVzdC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3Rlc3QvaW50ZWcvcXVvdGUudGVzdC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFDQSxPQUFPLEVBQUUsaUJBQWlCLEVBQWdCLE1BQU0sc0JBQXNCLENBQUE7QUFDdEUsT0FBTyxFQUFZLGNBQWMsRUFBRSxLQUFLLEVBQUUsUUFBUSxFQUFTLEtBQUssRUFBRSxNQUFNLG1CQUFtQixDQUFBO0FBQzNGLE9BQU8sRUFDTCxTQUFTLEVBQ1QsbUJBQW1CLEVBQ25CLE9BQU8sRUFDUCxTQUFTLEVBQ1QsbUJBQW1CLEVBQ25CLFdBQVcsRUFDWCxrQkFBa0IsRUFDbEIsZUFBZSxFQUNmLFdBQVcsRUFDWCx3QkFBd0IsRUFDeEIsWUFBWSxFQUNaLFlBQVksRUFDWixZQUFZLEdBQ2IsTUFBTSwrQkFBK0IsQ0FBQTtBQUN0QyxPQUFPLEVBQ0wsZUFBZSxFQUNmLHdCQUF3QixJQUFJLGlDQUFpQyxHQUM5RCxNQUFNLGlDQUFpQyxDQUFBO0FBRXhDLE9BQU8sRUFBRSxJQUFJLEVBQUUsTUFBTSxRQUFRLENBQUE7QUFDN0IsT0FBTyxXQUE4QixNQUFNLE9BQU8sQ0FBQTtBQUNsRCxPQUFPLFVBQVUsTUFBTSxhQUFhLENBQUE7QUFDcEMsT0FBTyxJQUFJLEVBQUUsRUFBRSxNQUFNLEVBQUUsTUFBTSxNQUFNLENBQUE7QUFDbkMsT0FBTyxjQUFjLE1BQU0sa0JBQWtCLENBQUE7QUFDN0MsT0FBTyxVQUFVLE1BQU0sYUFBYSxDQUFBO0FBQ3BDLE9BQU8sRUFBRSxTQUFTLEVBQWEsTUFBTSxFQUFFLE1BQU0sUUFBUSxDQUFBO0FBQ3JELE9BQU8sR0FBRyxNQUFNLFNBQVMsQ0FBQTtBQUN6QixPQUFPLENBQUMsTUFBTSxRQUFRLENBQUE7QUFDdEIsT0FBTyxFQUFFLE1BQU0sSUFBSSxDQUFBO0FBQ25CLE9BQU8sRUFBRSxnQkFBZ0IsRUFBRSxNQUFNLGlDQUFpQyxDQUFBO0FBR2xFLE9B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YnMvaGFyZGhhdC1ldGhlcnMvc2lnbmVycydcbmltcG9ydCB7IEFsbG93YW5jZVRyYW5zZmVyLCBQZXJtaXRTaW5nbGUgfSBmcm9tICdAdW5pc3dhcC9wZXJtaXQyLXNkaydcbmltcG9ydCB7IEN1cnJlbmN5LCBDdXJyZW5jeUFtb3VudCwgRXRoZXIsIEZyYWN0aW9uLCBUb2tlbiwgV0VUSDkgfSBmcm9tICdAdW5pc3dhcC9zZGstY29yZSdcbmltcG9ydCB7XG4gIENFVVJfQ0VMTyxcbiAgQ0VVUl9DRUxPX0FMRkFKT1JFUyxcbiAgQ2hhaW5JZCxcbiAgQ1VTRF9DRUxPLFxuICBDVVNEX0NFTE9fQUxGQUpPUkVTLFxuICBEQUlfTUFJTk5FVCxcbiAgSURfVE9fTkVUV09SS19OQU1FLFxuICBOQVRJVkVfQ1VSUkVOQ1ksXG4gIHBhcnNlQW1vdW50LFxuICBTV0FQX1JPVVRFUl8wMl9BRERSRVNTRVMsXG4gIFVTRENfTUFJTk5FVCxcbiAgVVNEVF9NQUlOTkVULFxuICBXQlRDX01BSU5ORVQsXG59IGZyb20gJ0B0YXJ0ei1vbmUvc21hcnQtb3JkZXItcm91dGVyJ1xuaW1wb3J0IHtcbiAgUEVSTUlUMl9BRERSRVNTLFxuICBVTklWRVJTQUxfUk9VVEVSX0FERFJFU1MgYXMgVU5JVkVSU0FMX1JPVVRFUl9BRERSRVNTX0JZX0NIQUlOLFxufSBmcm9tICdAdGFydHotb25lL3VuaXZlcnNhbC1yb3V0ZXItc2RrJ1xuaW1wb3J0IHsgTWV0aG9kUGFyYW1ldGVycyB9IGZyb20gJ0B0YXJ0ei1vbmUvc21hcnQtb3JkZXItcm91dGVyJ1xuaW1wb3J0IHsgZmFpbCB9IGZyb20gJ2Fzc2VydCdcbmltcG9ydCBheGlvc1N0YXRpYywgeyBBeGlvc1Jlc3BvbnNlIH0gZnJvbSAnYXhpb3MnXG5pbXBvcnQgYXhpb3NSZXRyeSBmcm9tICdheGlvcy1yZXRyeSdcbmltcG9ydCBjaGFpLCB7IGV4cGVjdCB9IGZyb20gJ2NoYWknXG5pbXBvcnQgY2hhaUFzUHJvbWlzZWQgZnJvbSAnY2hhaS1hcy1wcm9taXNlZCdcbmltcG9ydCBjaGFpU3Vic2V0IGZyb20gJ2NoYWktc3Vic2V0J1xuaW1wb3J0IHsgQmlnTnVtYmVyLCBwcm92aWRlcnMsIFdhbGxldCB9IGZyb20gJ2V0aGVycydcbmltcG9ydCBocmUgZnJvbSAnaGFyZGhhdCdcbmltcG9ydCBfIGZyb20gJ2xvZGFzaCdcbmltcG9ydCBxcyBmcm9tICdxcydcbmltcG9ydCB7IFNVUFBPUlRFRF9DSEFJTlMgfSBmcm9tICcuLi8uLi9saWIvaGFuZGxlcnMvaW5qZWN0b3Itc29yJ1xuaW1wb3J0IHsgUXVvdGVRdWVyeVBhcmFtcyB9IGZyb20gJy4uLy4uL2xpYi9oYW5kbGVycy9xdW90ZS9zY2hlbWEvcXVvdGUtc2NoZW1hJ1xuaW1wb3J0IHsgUXVvdGVSZXNwb25zZSB9IGZyb20gJy4uLy4uL2xpYi9oYW5kbGVycy9zY2hlbWEnXG5pbXBvcnQgeyBQZXJtaXQyX19mYWN0b3J5IH0gZnJvbSAnLi4vLi4vbGliL3R5cGVzL2V4dCdcbmltcG9ydCB7IHJlc2V0QW5kRnVuZEF0QmxvY2sgfSBmcm9tICcuLi91dGlscy9mb3JrQW5kRnVuZCdcbmltcG9ydCB7IGdldEJhbGFuY2UsIGdldEJhbGFuY2VBbmRBcHByb3ZlIH0gZnJvbSAnLi4vdXRpbHMvZ2V0QmFsYW5jZUFuZEFwcHJvdmUnXG5pbXBvcnQgeyBEQUlfT04sIGdldEFtb3VudCwgZ2V0QW1vdW50RnJvbVRva2VuLCBVTklfTUFJTk5FVCwgVVNEQ19PTiwgVVNEVF9PTiwgV05BVElWRV9PTiB9IGZyb20gJy4uL3V0aWxzL3Rva2VucydcblxuY29uc3QgeyBldGhlcnMgfSA9IGhyZVxuXG5jaGFpLnVzZShjaGFpQXNQcm9taXNlZClcbmNoYWkudXNlKGNoYWlTdWJzZXQpXG5cbmNvbnN0IFVOSVZFUlNBTF9ST1VURVJfQUREUkVTUyA9IFVOSVZFUlNBTF9ST1VURVJfQUREUkVTU19CWV9DSEFJTigxKVxuXG5pZiAoIXByb2Nlc3MuZW52LlVOSVNXQVBfUk9VVElOR19BUEkgfHwgIXByb2Nlc3MuZW52LkFSQ0hJVkVfTk9ERV9SUEMpIHtcbiAgdGhyb3cgbmV3IEVycm9yKCdNdXN0IHNldCBVTklTV0FQX1JPVVRJTkdfQVBJIGFuZCBBUkNISVZFX05PREVfUlBDIGVudiB2YXJpYWJsZXMgZm9yIGludGVnIHRlc3RzLiBTZWUgUkVBRE1FJylcbn1cblxuY29uc3QgQVBJID0gYCR7cHJvY2Vzcy5lbnYuVU5JU1dBUF9ST1VUSU5HX0FQSSF9cXVvdGVgXG5cbmNvbnN0IFNMSVBQQUdFID0gJzUnXG5cbmNvbnN0IGF4aW9zID0gYXhpb3NTdGF0aWMuY3JlYXRlKClcbmF4aW9zUmV0cnkoYXhpb3MsIHtcbiAgcmV0cmllczogMTAsXG4gIHJldHJ5Q29uZGl0aW9uOiAoZXJyKSA9PiBlcnIucmVzcG9uc2U/LnN0YXR1cyA9PSA0MjksXG4gIHJldHJ5RGVsYXk6IGF4aW9zUmV0cnkuZXhwb25lbnRpYWxEZWxheSxcbn0pXG5cbmNvbnN0IGNhbGxBbmRFeHBlY3RGYWlsID0gYXN5bmMgKHF1b3RlUmVxOiBQYXJ0aWFsPFF1b3RlUXVlcnlQYXJhbXM+LCByZXNwOiB7IHN0YXR1czogbnVtYmVyOyBkYXRhOiBhbnkgfSkgPT4ge1xuICBjb25zdCBxdWVyeVBhcmFtcyA9IHFzLnN0cmluZ2lmeShxdW90ZVJlcSlcbiAgdHJ5IHtcbiAgICBhd2FpdCBheGlvcy5nZXQ8UXVvdGVSZXNwb25zZT4oYCR7QVBJfT8ke3F1ZXJ5UGFyYW1zfWApXG4gICAgZmFpbCgpXG4gIH0gY2F0Y2ggKGVycjogYW55KSB7XG4gICAgZXhwZWN0KGVyci5yZXNwb25zZSkudG8uY29udGFpblN1YnNldChyZXNwKVxuICB9XG59XG5cbmNvbnN0IGNoZWNrUXVvdGVUb2tlbiA9IChcbiAgYmVmb3JlOiBDdXJyZW5jeUFtb3VudDxDdXJyZW5jeT4sXG4gIGFmdGVyOiBDdXJyZW5jeUFtb3VudDxDdXJyZW5jeT4sXG4gIHRva2Vuc1F1b3RlZDogQ3VycmVuY3lBbW91bnQ8Q3VycmVuY3k+XG4pID0+IHtcbiAgLy8gQ2hlY2sgd2hpY2ggaXMgYmlnZ2VyIHRvIHN1cHBvcnQgZXhhY3RJbiBhbmQgZXhhY3RPdXRcbiAgY29uc3QgdG9rZW5zU3dhcHBlZCA9IGFmdGVyLmdyZWF0ZXJUaGFuKGJlZm9yZSkgPyBhZnRlci5zdWJ0cmFjdChiZWZvcmUpIDogYmVmb3JlLnN1YnRyYWN0KGFmdGVyKVxuXG4gIGNvbnN0IHRva2Vuc0RpZmYgPSB0b2tlbnNRdW90ZWQuZ3JlYXRlclRoYW4odG9rZW5zU3dhcHBlZClcbiAgICA/IHRva2Vuc1F1b3RlZC5zdWJ0cmFjdCh0b2tlbnNTd2FwcGVkKVxuICAgIDogdG9rZW5zU3dhcHBlZC5zdWJ0cmFjdCh0b2tlbnNRdW90ZWQpXG4gIGNvbnN0IHBlcmNlbnREaWZmID0gdG9rZW5zRGlmZi5hc0ZyYWN0aW9uLmRpdmlkZSh0b2tlbnNRdW90ZWQuYXNGcmFjdGlvbilcbiAgZXhwZWN0KHBlcmNlbnREaWZmLmxlc3NUaGFuKG5ldyBGcmFjdGlvbihwYXJzZUludChTTElQUEFHRSksIDEwMCkpKS50by5iZS50cnVlXG59XG5cbmxldCB3YXJuZWRUZXN0ZXJQSyA9IGZhbHNlXG5jb25zdCBpc1Rlc3RlclBLRW52aXJvbm1lbnRTZXQgPSAoKTogYm9vbGVhbiA9PiB7XG4gIGNvbnN0IGlzU2V0ID0gISFwcm9jZXNzLmVudi5URVNURVJfUEtcbiAgaWYgKCFpc1NldCAmJiAhd2FybmVkVGVzdGVyUEspIHtcbiAgICBjb25zb2xlLmxvZygnU2tpcHBpbmcgdGVzdHMgcmVxdWlyaW5nIHJlYWwgUEsgc2luY2UgZW52IHZhcmlhYmxlcyBmb3IgVEVTVEVSX1BLIGlzIG5vdCBzZXQuJylcbiAgICB3YXJuZWRUZXN0ZXJQSyA9IHRydWVcbiAgfVxuICByZXR1cm4gaXNTZXRcbn1cblxuY29uc3QgTUFYX1VJTlQxNjAgPSAnMHhmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmJ1xuXG5kZXNjcmliZSgncXVvdGUnLCBmdW5jdGlvbiAoKSB7XG4gIC8vIEhlbHAgd2l0aCB0ZXN0IGZsYWtpbmVzcyBieSByZXRyeWluZy5cbiAgdGhpcy5yZXRyaWVzKDApXG5cbiAgdGhpcy50aW1lb3V0KCc1MDBzJylcblxuICBsZXQgYWxpY2U6IFNpZ25lcldpdGhBZGRyZXNzXG4gIGxldCBibG9jazogbnVtYmVyXG4gIGxldCBjdXJOb25jZTogbnVtYmVyID0gMFxuICBsZXQgbmV4dFBlcm1pdE5vbmNlOiAoKSA9PiBzdHJpbmcgPSAoKSA9PiB7XG4gICAgY29uc3Qgbm9uY2UgPSBjdXJOb25jZS50b1N0cmluZygpXG4gICAgY3VyTm9uY2UgPSBjdXJOb25jZSArIDFcbiAgICByZXR1cm4gbm9uY2VcbiAgfVxuXG4gIGNvbnN0IGV4ZWN1dGVTd2FwID0gYXN5bmMgKFxuICAgIG1ldGhvZFBhcmFtZXRlcnM6IE1ldGhvZFBhcmFtZXRlcnMsXG4gICAgY3VycmVuY3lJbjogQ3VycmVuY3ksXG4gICAgY3VycmVuY3lPdXQ6IEN1cnJlbmN5LFxuICAgIHBlcm1pdD86IGJvb2xlYW4sXG4gICAgY2hhaW5JZCA9IENoYWluSWQuTUFJTk5FVFxuICApOiBQcm9taXNlPHtcbiAgICB0b2tlbkluQWZ0ZXI6IEN1cnJlbmN5QW1vdW50PEN1cnJlbmN5PlxuICAgIHRva2VuSW5CZWZvcmU6IEN1cnJlbmN5QW1vdW50PEN1cnJlbmN5PlxuICAgIHRva2VuT3V0QWZ0ZXI6IEN1cnJlbmN5QW1vdW50PEN1cnJlbmN5PlxuICAgIHRva2VuT3V0QmVmb3JlOiBDdXJyZW5jeUFtb3VudDxDdXJyZW5jeT5cbiAgfT4gPT4ge1xuICAgIGNvbnN0IHBlcm1pdDIgPSBQZXJtaXQyX19mYWN0b3J5LmNvbm5lY3QoUEVSTUlUMl9BRERSRVNTLCBhbGljZSlcblxuICAgIC8vIEFwcHJvdmUgUGVybWl0MlxuICAgIGNvbnN0IHRva2VuSW5CZWZvcmUgPSBhd2FpdCBnZXRCYWxhbmNlQW5kQXBwcm92ZShhbGljZSwgUEVSTUlUMl9BRERSRVNTLCBjdXJyZW5jeUluKVxuICAgIGNvbnN0IHRva2VuT3V0QmVmb3JlID0gYXdhaXQgZ2V0QmFsYW5jZShhbGljZSwgY3VycmVuY3lPdXQpXG5cbiAgICAvLyBBcHByb3ZlIFN3YXBSb3V0ZXIwMiBpbiBjYXNlIHdlIHJlcXVlc3QgY2FsbGRhdGEgZm9yIGl0IGluc3RlYWQgb2YgVW5pdmVyc2FsIFJvdXRlclxuICAgIGF3YWl0IGdldEJhbGFuY2VBbmRBcHByb3ZlKGFsaWNlLCBTV0FQX1JPVVRFUl8wMl9BRERSRVNTRVMoY2hhaW5JZCksIGN1cnJlbmN5SW4pXG5cbiAgICAvLyBJZiBub3QgdXNpbmcgcGVybWl0IGRvIGEgcmVndWxhciBhcHByb3ZhbCBhbGxvd2luZyBuYXJ3aGFsIG1heCBiYWxhbmNlLlxuICAgIGlmICghcGVybWl0KSB7XG4gICAgICBjb25zdCBhcHByb3ZlTmFyd2hhbCA9IGF3YWl0IHBlcm1pdDIuYXBwcm92ZShcbiAgICAgICAgY3VycmVuY3lJbi53cmFwcGVkLmFkZHJlc3MsXG4gICAgICAgIFVOSVZFUlNBTF9ST1VURVJfQUREUkVTUyxcbiAgICAgICAgTUFYX1VJTlQxNjAsXG4gICAgICAgIDEwMDAwMDAwMDAwMDAwMFxuICAgICAgKVxuICAgICAgYXdhaXQgYXBwcm92ZU5hcndoYWwud2FpdCgpXG4gICAgfVxuXG4gICAgY29uc3QgdHJhbnNhY3Rpb24gPSB7XG4gICAgICBkYXRhOiBtZXRob2RQYXJhbWV0ZXJzLmNhbGxkYXRhLFxuICAgICAgdG86IG1ldGhvZFBhcmFtZXRlcnMudG8sXG4gICAgICB2YWx1ZTogQmlnTnVtYmVyLmZyb20obWV0aG9kUGFyYW1ldGVycy52YWx1ZSksXG4gICAgICBmcm9tOiBhbGljZS5hZGRyZXNzLFxuICAgICAgZ2FzUHJpY2U6IEJpZ051bWJlci5mcm9tKDIwMDAwMDAwMDAwMDApLFxuICAgICAgdHlwZTogMSxcbiAgICB9XG5cbiAgICBjb25zdCB0cmFuc2FjdGlvblJlc3BvbnNlOiBwcm92aWRlcnMuVHJhbnNhY3Rpb25SZXNwb25zZSA9IGF3YWl0IGFsaWNlLnNlbmRUcmFuc2FjdGlvbih0cmFuc2FjdGlvbilcbiAgICBhd2FpdCB0cmFuc2FjdGlvblJlc3BvbnNlLndhaXQoKVxuXG4gICAgY29uc3QgdG9rZW5JbkFmdGVyID0gYXdhaXQgZ2V0QmFsYW5jZShhbGljZSwgY3VycmVuY3lJbilcbiAgICBjb25zdCB0b2tlbk91dEFmdGVyID0gYXdhaXQgZ2V0QmFsYW5jZShhbGljZSwgY3VycmVuY3lPdXQpXG5cbiAgICByZXR1cm4ge1xuICAgICAgdG9rZW5JbkFmdGVyLFxuICAgICAgdG9rZW5JbkJlZm9yZSxcbiAgICAgIHRva2VuT3V0QWZ0ZXIsXG4gICAgICB0b2tlbk91dEJlZm9yZSxcbiAgICB9XG4gIH1cblxuICBiZWZvcmUoYXN5bmMgZnVuY3Rpb24gKCkge1xuICAgIHRoaXMudGltZW91dCg0MDAwMClcbiAgICA7W2FsaWNlXSA9IGF3YWl0IGV0aGVycy5nZXRTaWduZXJzKClcblxuICAgIC8vIE1ha2UgYSBkdW1teSBjYWxsIHRvIHRoZSBBUEkgdG8gZ2V0IGEgYmxvY2sgbnVtYmVyIHRvIGZvcmsgZnJvbS5cbiAgICBjb25zdCBxdW90ZVJlcTogUXVvdGVRdWVyeVBhcmFtcyA9IHtcbiAgICAgIHRva2VuSW5BZGRyZXNzOiAnVVNEQycsXG4gICAgICB0b2tlbkluQ2hhaW5JZDogMSxcbiAgICAgIHRva2VuT3V0QWRkcmVzczogJ1VTRFQnLFxuICAgICAgdG9rZW5PdXRDaGFpbklkOiAxLFxuICAgICAgYW1vdW50OiBhd2FpdCBnZXRBbW91bnQoMSwgJ2V4YWN0SW4nLCAnVVNEQycsICdVU0RUJywgJzEwMCcpLFxuICAgICAgdHlwZTogJ2V4YWN0SW4nLFxuICAgIH1cblxuICAgIGNvbnN0IHtcbiAgICAgIGRhdGE6IHsgYmxvY2tOdW1iZXIgfSxcbiAgICB9ID0gYXdhaXQgYXhpb3MuZ2V0PFF1b3RlUmVzcG9uc2U+KGAke0FQSX0/JHtxcy5zdHJpbmdpZnkocXVvdGVSZXEpfWApXG5cbiAgICBibG9jayA9IHBhcnNlSW50KGJsb2NrTnVtYmVyKSAtIDEwXG5cbiAgICBhbGljZSA9IGF3YWl0IHJlc2V0QW5kRnVuZEF0QmxvY2soYWxpY2UsIGJsb2NrLCBbXG4gICAgICBwYXJzZUFtb3VudCgnODAwMDAwMCcsIFVTRENfTUFJTk5FVCksXG4gICAgICBwYXJzZUFtb3VudCgnNTAwMDAwMCcsIFVTRFRfTUFJTk5FVCksXG4gICAgICBwYXJzZUFtb3VudCgnMTAnLCBXQlRDX01BSU5ORVQpLFxuICAgICAgcGFyc2VBbW91bnQoJzEwMDAnLCBVTklfTUFJTk5FVCksXG4gICAgICBwYXJzZUFtb3VudCgnNDAwMCcsIFdFVEg5WzFdKSxcbiAgICAgIHBhcnNlQW1vdW50KCc1MDAwMDAwJywgREFJX01BSU5ORVQpLFxuICAgIF0pXG4gIH0pXG5cbiAgZm9yIChjb25zdCBhbGdvcml0aG0gb2YgWydhbHBoYSddKSB7XG4gICAgZm9yIChjb25zdCB0eXBlIG9mIFsnZXhhY3RJbicsICdleGFjdE91dCddKSB7XG4gICAgICBkZXNjcmliZShgJHtJRF9UT19ORVRXT1JLX05BTUUoMSl9ICR7YWxnb3JpdGhtfSAke3R5cGV9IDJ4eGAsICgpID0+IHtcbiAgICAgICAgZGVzY3JpYmUoYCsgRXhlY3V0ZSBTd2FwYCwgKCkgPT4ge1xuICAgICAgICAgIGl0KGBlcmMyMCAtPiBlcmMyMGAsIGFzeW5jICgpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IHF1b3RlUmVxOiBRdW90ZVF1ZXJ5UGFyYW1zID0ge1xuICAgICAgICAgICAgICB0b2tlbkluQWRkcmVzczogJ1VTREMnLFxuICAgICAgICAgICAgICB0b2tlbkluQ2hhaW5JZDogMSxcbiAgICAgICAgICAgICAgdG9rZW5PdXRBZGRyZXNzOiAnVVNEVCcsXG4gICAgICAgICAgICAgIHRva2VuT3V0Q2hhaW5JZDogMSxcbiAgICAgICAgICAgICAgYW1vdW50OiBhd2FpdCBnZXRBbW91bnQoMSwgdHlwZSwgJ1VTREMnLCAnVVNEVCcsICcxMDAnKSxcbiAgICAgICAgICAgICAgdHlwZSxcbiAgICAgICAgICAgICAgcmVjaXBpZW50OiBhbGljZS5hZGRyZXNzLFxuICAgICAgICAgICAgICBzbGlwcGFnZVRvbGVyYW5jZTogU0xJUFBBR0UsXG4gICAgICAgICAgICAgIGRlYWRsaW5lOiAnMzYwJyxcbiAgICAgICAgICAgICAgYWxnb3JpdGhtLFxuICAgICAgICAgICAgICBlbmFibGVVbml2ZXJzYWxSb3V0ZXI6IHRydWUsXG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGNvbnN0IHF1ZXJ5UGFyYW1zID0gcXMuc3RyaW5naWZ5KHF1b3RlUmVxKVxuXG4gICAgICAgICAgICBjb25zdCByZXNwb25zZTogQXhpb3NSZXNwb25zZTxRdW90ZVJlc3BvbnNlPiA9IGF3YWl0IGF4aW9zLmdldDxRdW90ZVJlc3BvbnNlPihgJHtBUEl9PyR7cXVlcnlQYXJhbXN9YClcbiAgICAgICAgICAgIGNvbnN0IHtcbiAgICAgICAgICAgICAgZGF0YTogeyBxdW90ZSwgcXVvdGVEZWNpbWFscywgcXVvdGVHYXNBZGp1c3RlZERlY2ltYWxzLCBtZXRob2RQYXJhbWV0ZXJzIH0sXG4gICAgICAgICAgICAgIHN0YXR1cyxcbiAgICAgICAgICAgIH0gPSByZXNwb25zZVxuXG4gICAgICAgICAgICBleHBlY3Qoc3RhdHVzKS50by5lcXVhbCgyMDApXG4gICAgICAgICAgICBleHBlY3QocGFyc2VGbG9hdChxdW90ZURlY2ltYWxzKSkudG8uYmUuZ3JlYXRlclRoYW4oOTApXG4gICAgICAgICAgICBleHBlY3QocGFyc2VGbG9hdChxdW90ZURlY2ltYWxzKSkudG8uYmUubGVzc1RoYW4oMTEwKVxuXG4gICAgICAgICAgICBpZiAodHlwZSA9PSAnZXhhY3RJbicpIHtcbiAgICAgICAgICAgICAgZXhwZWN0KHBhcnNlRmxvYXQocXVvdGVHYXNBZGp1c3RlZERlY2ltYWxzKSkudG8uYmUubGVzc1RoYW5PckVxdWFsKHBhcnNlRmxvYXQocXVvdGVEZWNpbWFscykpXG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICBleHBlY3QocGFyc2VGbG9hdChxdW90ZUdhc0FkanVzdGVkRGVjaW1hbHMpKS50by5iZS5ncmVhdGVyVGhhbk9yRXF1YWwocGFyc2VGbG9hdChxdW90ZURlY2ltYWxzKSlcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgZXhwZWN0KG1ldGhvZFBhcmFtZXRlcnMpLnRvLm5vdC5iZS51bmRlZmluZWRcbiAgICAgICAgICAgIGV4cGVjdChtZXRob2RQYXJhbWV0ZXJzPy50bykudG8uZXF1YWwoVU5JVkVSU0FMX1JPVVRFUl9BRERSRVNTKVxuXG4gICAgICAgICAgICBjb25zdCB7IHRva2VuSW5CZWZvcmUsIHRva2VuSW5BZnRlciwgdG9rZW5PdXRCZWZvcmUsIHRva2VuT3V0QWZ0ZXIgfSA9IGF3YWl0IGV4ZWN1dGVTd2FwKFxuICAgICAgICAgICAgICBtZXRob2RQYXJhbWV0ZXJzISxcbiAgICAgICAgICAgICAgVVNEQ19NQUlOTkVULFxuICAgICAgICAgICAgICBVU0RUX01BSU5ORVRcbiAgICAgICAgICAgIClcblxuICAgICAgICAgICAgaWYgKHR5cGUgPT0gJ2V4YWN0SW4nKSB7XG4gICAgICAgICAgICAgIGV4cGVjdCh0b2tlbkluQmVmb3JlLnN1YnRyYWN0KHRva2VuSW5BZnRlcikudG9FeGFjdCgpKS50by5lcXVhbCgnMTAwJylcbiAgICAgICAgICAgICAgY2hlY2tRdW90ZVRva2VuKHRva2VuT3V0QmVmb3JlLCB0b2tlbk91dEFmdGVyLCBDdXJyZW5jeUFtb3VudC5mcm9tUmF3QW1vdW50KFVTRFRfTUFJTk5FVCwgcXVvdGUpKVxuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgZXhwZWN0KHRva2VuT3V0QWZ0ZXIuc3VidHJhY3QodG9rZW5PdXRCZWZvcmUpLnRvRXhhY3QoKSkudG8uZXF1YWwoJzEwMCcpXG4gICAgICAgICAgICAgIGNoZWNrUXVvdGVUb2tlbih0b2tlbkluQmVmb3JlLCB0b2tlbkluQWZ0ZXIsIEN1cnJlbmN5QW1vdW50LmZyb21SYXdBbW91bnQoVVNEQ19NQUlOTkVULCBxdW90ZSkpXG4gICAgICAgICAgICB9XG4gICAgICAgICAgfSlcblxuICAgICAgICAgIGl0KGBlcmMyMCAtPiBlcmMyMCBzd2Fwcm91dGVyMDJgLCBhc3luYyAoKSA9PiB7XG4gICAgICAgICAgICBjb25zdCBxdW90ZVJlcTogUXVvdGVRdWVyeVBhcmFtcyA9IHtcbiAgICAgICAgICAgICAgdG9rZW5JbkFkZHJlc3M6ICdVU0RDJyxcbiAgICAgICAgICAgICAgdG9rZW5JbkNoYWluSWQ6IDEsXG4gICAgICAgICAgICAgIHRva2VuT3V0QWRkcmVzczogJ1VTRFQnLFxuICAgICAgICAgICAgICB0b2tlbk91dENoYWluSWQ6IDEsXG4gICAgICAgICAgICAgIGFtb3VudDogYXdhaXQgZ2V0QW1vdW50KDEsIHR5cGUsICdVU0RDJywgJ1VTRFQnLCAnMTAwJyksXG4gICAgICAgICAgICAgIHR5cGUsXG4gICAgICAgICAgICAgIHJlY2lwaWVudDogYWxpY2UuYWRkcmVzcyxcbiAgICAgICAgICAgICAgc2xpcHBhZ2VUb2xlcmFuY2U6IFNMSVBQQUdFLFxuICAgICAgICAgICAgICBkZWFkbGluZTogJzM2MCcsXG4gICAgICAgICAgICAgIGFsZ29yaXRobSxcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgY29uc3QgcXVlcnlQYXJhbXMgPSBxcy5zdHJpbmdpZnkocXVvdGVSZXEpXG5cbiAgICAgICAgICAgIGNvbnN0IHJlc3BvbnNlOiBBeGlvc1Jlc3BvbnNlPFF1b3RlUmVzcG9uc2U+ID0gYXdhaXQgYXhpb3MuZ2V0PFF1b3RlUmVzcG9uc2U+KGAke0FQSX0/JHtxdWVyeVBhcmFtc31gKVxuICAgICAgICAgICAgY29uc3Qge1xuICAgICAgICAgICAgICBkYXRhOiB7IHF1b3RlLCBxdW90ZURlY2ltYWxzLCBxdW90ZUdhc0FkanVzdGVkRGVjaW1hbHMsIG1ldGhvZFBhcmFtZXRlcnMgfSxcbiAgICAgICAgICAgICAgc3RhdHVzLFxuICAgICAgICAgICAgfSA9IHJlc3BvbnNlXG5cbiAgICAgICAgICAgIGV4cGVjdChzdGF0dXMpLnRvLmVxdWFsKDIwMClcbiAgICAgICAgICAgIGV4cGVjdChwYXJzZUZsb2F0KHF1b3RlRGVjaW1hbHMpKS50by5iZS5ncmVhdGVyVGhhbig5MClcbiAgICAgICAgICAgIGV4cGVjdChwYXJzZUZsb2F0KHF1b3RlRGVjaW1hbHMpKS50by5iZS5sZXNzVGhhbigxMTApXG5cbiAgICAgICAgICAgIGlmICh0eXBlID09ICdleGFjdEluJykge1xuICAgICAgICAgICAgICBleHBlY3QocGFyc2VGbG9hdChxdW90ZUdhc0FkanVzdGVkRGVjaW1hbHMpKS50by5iZS5sZXNzVGhhbk9yRXF1YWwocGFyc2VGbG9hdChxdW90ZURlY2ltYWxzKSlcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgIGV4cGVjdChwYXJzZUZsb2F0KHF1b3RlR2FzQWRqdXN0ZWREZWNpbWFscykpLnRvLmJlLmdyZWF0ZXJUaGFuT3JFcXVhbChwYXJzZUZsb2F0KHF1b3RlRGVjaW1hbHMpKVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBleHBlY3QobWV0aG9kUGFyYW1ldGVycykudG8ubm90LmJlLnVuZGVmaW5lZFxuICAgICAgICAgICAgZXhwZWN0KG1ldGhvZFBhcmFtZXRlcnM/LnRvKS50by5lcXVhbChTV0FQX1JPVVRFUl8wMl9BRERSRVNTRVMoQ2hhaW5JZC5NQUlOTkVUKSlcblxuICAgICAgICAgICAgY29uc3QgeyB0b2tlbkluQmVmb3JlLCB0b2tlbkluQWZ0ZXIsIHRva2VuT3V0QmVmb3JlLCB0b2tlbk91dEFmdGVyIH0gPSBhd2FpdCBleGVjdXRlU3dhcChcbiAgICAgICAgICAgICAgbWV0aG9kUGFyYW1ldGVycyEsXG4gICAgICAgICAgICAgIFVTRENfTUFJTk5FVCxcbiAgICAgICAgICAgICAgVVNEVF9NQUlOTkVUXG4gICAgICAgICAgICApXG5cbiAgICAgICAgICAgIGlmICh0eXBlID09ICdleGFjdEluJykge1xuICAgICAgICAgICAgICBleHBlY3QodG9rZW5JbkJlZm9yZS5zdWJ0cmFjdCh0b2tlbkluQWZ0ZXIpLnRvRXhhY3QoKSkudG8uZXF1YWwoJzEwMCcpXG4gICAgICAgICAgICAgIGNoZWNrUXVvdGVUb2tlbih0b2tlbk91dEJlZm9yZSwgdG9rZW5PdXRBZnRlciwgQ3VycmVuY3lBbW91bnQuZnJvbVJhd0Ftb3VudChVU0RUX01BSU5ORVQsIHF1b3RlKSlcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgIGV4cGVjdCh0b2tlbk91dEFmdGVyLnN1YnRyYWN0KHRva2VuT3V0QmVmb3JlKS50b0V4YWN0KCkpLnRvLmVxdWFsKCcxMDAnKVxuICAgICAgICAgICAgICBjaGVja1F1b3RlVG9rZW4odG9rZW5JbkJlZm9yZSwgdG9rZW5JbkFmdGVyLCBDdXJyZW5jeUFtb3VudC5mcm9tUmF3QW1vdW50KFVTRENfTUFJTk5FVCwgcXVvdGUpKVxuICAgICAgICAgICAgfVxuICAgICAgICAgIH0pXG5cbiAgICAgICAgICBpdChgZXJjMjAgLT4gZXJjMjAgd2l0aCBwZXJtaXRgLCBhc3luYyAoKSA9PiB7XG4gICAgICAgICAgICBjb25zdCBhbW91bnQgPSBhd2FpdCBnZXRBbW91bnQoMSwgdHlwZSwgJ1VTREMnLCAnVVNEVCcsICcxMCcpXG5cbiAgICAgICAgICAgIGNvbnN0IG5vbmNlID0gbmV4dFBlcm1pdE5vbmNlKClcblxuICAgICAgICAgICAgY29uc3QgcGVybWl0OiBQZXJtaXRTaW5nbGUgPSB7XG4gICAgICAgICAgICAgIGRldGFpbHM6IHtcbiAgICAgICAgICAgICAgICB0b2tlbjogVVNEQ19NQUlOTkVULmFkZHJlc3MsXG4gICAgICAgICAgICAgICAgYW1vdW50OiAnMTUwMDAwMDAnLCAvLyBGb3IgZXhhY3Qgb3V0IHdlIGRvbid0IGtub3cgdGhlIGV4YWN0IGFtb3VudCBuZWVkZWQgdG8gcGVybWl0LCBzbyBqdXN0IHNwZWNpZnkgYSBsYXJnZSBhbW91bnQuXG4gICAgICAgICAgICAgICAgZXhwaXJhdGlvbjogTWF0aC5mbG9vcihuZXcgRGF0ZSgpLmdldFRpbWUoKSAvIDEwMDAgKyAxMDAwMDAwMCkudG9TdHJpbmcoKSxcbiAgICAgICAgICAgICAgICBub25jZSxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgc3BlbmRlcjogVU5JVkVSU0FMX1JPVVRFUl9BRERSRVNTLFxuICAgICAgICAgICAgICBzaWdEZWFkbGluZTogTWF0aC5mbG9vcihuZXcgRGF0ZSgpLmdldFRpbWUoKSAvIDEwMDAgKyAxMDAwMDAwMCkudG9TdHJpbmcoKSxcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgY29uc3QgeyBkb21haW4sIHR5cGVzLCB2YWx1ZXMgfSA9IEFsbG93YW5jZVRyYW5zZmVyLmdldFBlcm1pdERhdGEocGVybWl0LCBQRVJNSVQyX0FERFJFU1MsIDEpXG5cbiAgICAgICAgICAgIGNvbnN0IHNpZ25hdHVyZSA9IGF3YWl0IGFsaWNlLl9zaWduVHlwZWREYXRhKGRvbWFpbiwgdHlwZXMsIHZhbHVlcylcblxuICAgICAgICAgICAgY29uc3QgcXVvdGVSZXE6IFF1b3RlUXVlcnlQYXJhbXMgPSB7XG4gICAgICAgICAgICAgIHRva2VuSW5BZGRyZXNzOiAnVVNEQycsXG4gICAgICAgICAgICAgIHRva2VuSW5DaGFpbklkOiAxLFxuICAgICAgICAgICAgICB0b2tlbk91dEFkZHJlc3M6ICdVU0RUJyxcbiAgICAgICAgICAgICAgdG9rZW5PdXRDaGFpbklkOiAxLFxuICAgICAgICAgICAgICBhbW91bnQsXG4gICAgICAgICAgICAgIHR5cGUsXG4gICAgICAgICAgICAgIHJlY2lwaWVudDogYWxpY2UuYWRkcmVzcyxcbiAgICAgICAgICAgICAgc2xpcHBhZ2VUb2xlcmFuY2U6IFNMSVBQQUdFLFxuICAgICAgICAgICAgICBkZWFkbGluZTogJzM2MCcsXG4gICAgICAgICAgICAgIGFsZ29yaXRobSxcbiAgICAgICAgICAgICAgcGVybWl0U2lnbmF0dXJlOiBzaWduYXR1cmUsXG4gICAgICAgICAgICAgIHBlcm1pdEFtb3VudDogcGVybWl0LmRldGFpbHMuYW1vdW50LnRvU3RyaW5nKCksXG4gICAgICAgICAgICAgIHBlcm1pdEV4cGlyYXRpb246IHBlcm1pdC5kZXRhaWxzLmV4cGlyYXRpb24udG9TdHJpbmcoKSxcbiAgICAgICAgICAgICAgcGVybWl0U2lnRGVhZGxpbmU6IHBlcm1pdC5zaWdEZWFkbGluZS50b1N0cmluZygpLFxuICAgICAgICAgICAgICBwZXJtaXROb25jZTogcGVybWl0LmRldGFpbHMubm9uY2UudG9TdHJpbmcoKSxcbiAgICAgICAgICAgICAgZW5hYmxlVW5pdmVyc2FsUm91dGVyOiB0cnVlLFxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBjb25zdCBxdWVyeVBhcmFtcyA9IHFzLnN0cmluZ2lmeShxdW90ZVJlcSlcblxuICAgICAgICAgICAgY29uc3QgcmVzcG9uc2U6IEF4aW9zUmVzcG9uc2U8UXVvdGVSZXNwb25zZT4gPSBhd2FpdCBheGlvcy5nZXQ8UXVvdGVSZXNwb25zZT4oYCR7QVBJfT8ke3F1ZXJ5UGFyYW1zfWApXG4gICAgICAgICAgICBjb25zdCB7XG4gICAgICAgICAgICAgIGRhdGE6IHsgcXVvdGUsIHF1b3RlRGVjaW1hbHMsIHF1b3RlR2FzQWRqdXN0ZWREZWNpbWFscywgbWV0aG9kUGFyYW1ldGVycyB9LFxuICAgICAgICAgICAgICBzdGF0dXMsXG4gICAgICAgICAgICB9ID0gcmVzcG9uc2VcblxuICAgICAgICAgICAgZXhwZWN0KHN0YXR1cykudG8uZXF1YWwoMjAwKVxuICAgICAgICAgICAgZXhwZWN0KHBhcnNlRmxvYXQocXVvdGVEZWNpbWFscykpLnRvLmJlLmdyZWF0ZXJUaGFuKDkpXG4gICAgICAgICAgICBleHBlY3QocGFyc2VGbG9hdChxdW90ZURlY2ltYWxzKSkudG8uYmUubGVzc1RoYW4oMTEpXG5cbiAgICAgICAgICAgIGlmICh0eXBlID09ICdleGFjdEluJykge1xuICAgICAgICAgICAgICBleHBlY3QocGFyc2VGbG9hdChxdW90ZUdhc0FkanVzdGVkRGVjaW1hbHMpKS50by5iZS5sZXNzVGhhbk9yRXF1YWwocGFyc2VGbG9hdChxdW90ZURlY2ltYWxzKSlcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgIGV4cGVjdChwYXJzZUZsb2F0KHF1b3RlR2FzQWRqdXN0ZWREZWNpbWFscykpLnRvLmJlLmdyZWF0ZXJUaGFuT3JFcXVhbChwYXJzZUZsb2F0KHF1b3RlRGVjaW1hbHMpKVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBleHBlY3QobWV0aG9kUGFyYW1ldGVycykudG8ubm90LmJlLnVuZGVmaW5lZFxuICAgICAgICAgICAgZXhwZWN0KG1ldGhvZFBhcmFtZXRlcnM/LnRvKS50by5lcXVhbChVTklWRVJTQUxfUk9VVEVSX0FERFJFU1MpXG5cbiAgICAgICAgICAgIGNvbnN0IHsgdG9rZW5JbkJlZm9yZSwgdG9rZW5JbkFmdGVyLCB0b2tlbk91dEJlZm9yZSwgdG9rZW5PdXRBZnRlciB9ID0gYXdhaXQgZXhlY3V0ZVN3YXAoXG4gICAgICAgICAgICAgIG1ldGhvZFBhcmFtZXRlcnMhLFxuICAgICAgICAgICAgICBVU0RDX01BSU5ORVQsXG4gICAgICAgICAgICAgIFVTRFRfTUFJTk5FVCxcbiAgICAgICAgICAgICAgdHJ1ZVxuICAgICAgICAgICAgKVxuXG4gICAgICAgICAgICBpZiAodHlwZSA9PSAnZXhhY3RJbicpIHtcbiAgICAgICAgICAgICAgZXhwZWN0KHRva2VuSW5CZWZvcmUuc3VidHJhY3QodG9rZW5JbkFmdGVyKS50b0V4YWN0KCkpLnRvLmVxdWFsKCcxMCcpXG4gICAgICAgICAgICAgIGNoZWNrUXVvdGVUb2tlbih0b2tlbk91dEJlZm9yZSwgdG9rZW5PdXRBZnRlciwgQ3VycmVuY3lBbW91bnQuZnJvbVJhd0Ftb3VudChVU0RUX01BSU5ORVQsIHF1b3RlKSlcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgIGV4cGVjdCh0b2tlbk91dEFmdGVyLnN1YnRyYWN0KHRva2VuT3V0QmVmb3JlKS50b0V4YWN0KCkpLnRvLmVxdWFsKCcxMCcpXG4gICAgICAgICAgICAgIGNoZWNrUXVvdGVUb2tlbih0b2tlbkluQmVmb3JlLCB0b2tlbkluQWZ0ZXIsIEN1cnJlbmN5QW1vdW50LmZyb21SYXdBbW91bnQoVVNEQ19NQUlOTkVULCBxdW90ZSkpXG4gICAgICAgICAgICB9XG4gICAgICAgICAgfSlcblxuICAgICAgICAgIGl0KGBlcmMyMCAtPiBldGhgLCBhc3luYyAoKSA9PiB7XG4gICAgICAgICAgICBjb25zdCBxdW90ZVJlcTogUXVvdGVRdWVyeVBhcmFtcyA9IHtcbiAgICAgICAgICAgICAgdG9rZW5JbkFkZHJlc3M6ICdVU0RDJyxcbiAgICAgICAgICAgICAgdG9rZW5JbkNoYWluSWQ6IDEsXG4gICAgICAgICAgICAgIHRva2VuT3V0QWRkcmVzczogJ0VUSCcsXG4gICAgICAgICAgICAgIHRva2VuT3V0Q2hhaW5JZDogMSxcbiAgICAgICAgICAgICAgYW1vdW50OiBhd2FpdCBnZXRBbW91bnQoMSwgdHlwZSwgJ1VTREMnLCAnRVRIJywgdHlwZSA9PSAnZXhhY3RJbicgPyAnMTAwMDAwMCcgOiAnMTAnKSxcbiAgICAgICAgICAgICAgdHlwZSxcbiAgICAgICAgICAgICAgcmVjaXBpZW50OiBhbGljZS5hZGRyZXNzLFxuICAgICAgICAgICAgICBzbGlwcGFnZVRvbGVyYW5jZTogU0xJUFBBR0UsXG4gICAgICAgICAgICAgIGRlYWRsaW5lOiAnMzYwJyxcbiAgICAgICAgICAgICAgYWxnb3JpdGhtLFxuICAgICAgICAgICAgICBlbmFibGVVbml2ZXJzYWxSb3V0ZXI6IHRydWUsXG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGNvbnN0IHF1ZXJ5UGFyYW1zID0gcXMuc3RyaW5naWZ5KHF1b3RlUmVxKVxuXG4gICAgICAgICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGF4aW9zLmdldDxRdW90ZVJlc3BvbnNlPihgJHtBUEl9PyR7cXVlcnlQYXJhbXN9YClcbiAgICAgICAgICAgIGNvbnN0IHtcbiAgICAgICAgICAgICAgZGF0YTogeyBxdW90ZSwgbWV0aG9kUGFyYW1ldGVycyB9LFxuICAgICAgICAgICAgICBzdGF0dXMsXG4gICAgICAgICAgICB9ID0gcmVzcG9uc2VcblxuICAgICAgICAgICAgZXhwZWN0KHN0YXR1cykudG8uZXF1YWwoMjAwKVxuICAgICAgICAgICAgZXhwZWN0KG1ldGhvZFBhcmFtZXRlcnMpLnRvLm5vdC5iZS51bmRlZmluZWRcblxuICAgICAgICAgICAgY29uc3QgeyB0b2tlbkluQmVmb3JlLCB0b2tlbkluQWZ0ZXIsIHRva2VuT3V0QmVmb3JlLCB0b2tlbk91dEFmdGVyIH0gPSBhd2FpdCBleGVjdXRlU3dhcChcbiAgICAgICAgICAgICAgbWV0aG9kUGFyYW1ldGVycyEsXG4gICAgICAgICAgICAgIFVTRENfTUFJTk5FVCxcbiAgICAgICAgICAgICAgRXRoZXIub25DaGFpbigxKVxuICAgICAgICAgICAgKVxuXG4gICAgICAgICAgICBpZiAodHlwZSA9PSAnZXhhY3RJbicpIHtcbiAgICAgICAgICAgICAgZXhwZWN0KHRva2VuSW5CZWZvcmUuc3VidHJhY3QodG9rZW5JbkFmdGVyKS50b0V4YWN0KCkpLnRvLmVxdWFsKCcxMDAwMDAwJylcbiAgICAgICAgICAgICAgY2hlY2tRdW90ZVRva2VuKHRva2VuT3V0QmVmb3JlLCB0b2tlbk91dEFmdGVyLCBDdXJyZW5jeUFtb3VudC5mcm9tUmF3QW1vdW50KEV0aGVyLm9uQ2hhaW4oMSksIHF1b3RlKSlcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgIC8vIEhhcmQgdG8gdGVzdCBFVEggYmFsYW5jZSBkdWUgdG8gZ2FzIGNvc3RzIGZvciBhcHByb3ZhbCBhbmQgc3dhcC4gSnVzdCBjaGVjayB0b2tlbkluIGNoYW5nZXNcbiAgICAgICAgICAgICAgY2hlY2tRdW90ZVRva2VuKHRva2VuSW5CZWZvcmUsIHRva2VuSW5BZnRlciwgQ3VycmVuY3lBbW91bnQuZnJvbVJhd0Ftb3VudChVU0RDX01BSU5ORVQsIHF1b3RlKSlcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9KVxuXG4gICAgICAgICAgaXQoYGVyYzIwIC0+IGV0aCBsYXJnZSB0cmFkZWAsIGFzeW5jICgpID0+IHtcbiAgICAgICAgICAgIC8vIFRyYWRlIG9mIHRoaXMgc2l6ZSBhbG1vc3QgYWx3YXlzIHJlc3VsdHMgaW4gc3BsaXRzLlxuICAgICAgICAgICAgY29uc3QgcXVvdGVSZXE6IFF1b3RlUXVlcnlQYXJhbXMgPSB7XG4gICAgICAgICAgICAgIHRva2VuSW5BZGRyZXNzOiAnVVNEQycsXG4gICAgICAgICAgICAgIHRva2VuSW5DaGFpbklkOiAxLFxuICAgICAgICAgICAgICB0b2tlbk91dEFkZHJlc3M6ICdFVEgnLFxuICAgICAgICAgICAgICB0b2tlbk91dENoYWluSWQ6IDEsXG4gICAgICAgICAgICAgIGFtb3VudDpcbiAgICAgICAgICAgICAgICB0eXBlID09ICdleGFjdEluJ1xuICAgICAgICAgICAgICAgICAgPyBhd2FpdCBnZXRBbW91bnQoMSwgdHlwZSwgJ1VTREMnLCAnRVRIJywgJzEwMDAwMDAnKVxuICAgICAgICAgICAgICAgICAgOiBhd2FpdCBnZXRBbW91bnQoMSwgdHlwZSwgJ1VTREMnLCAnRVRIJywgJzEwMCcpLFxuICAgICAgICAgICAgICB0eXBlLFxuICAgICAgICAgICAgICByZWNpcGllbnQ6IGFsaWNlLmFkZHJlc3MsXG4gICAgICAgICAgICAgIHNsaXBwYWdlVG9sZXJhbmNlOiBTTElQUEFHRSxcbiAgICAgICAgICAgICAgZGVhZGxpbmU6ICczNjAnLFxuICAgICAgICAgICAgICBhbGdvcml0aG0sXG4gICAgICAgICAgICAgIGVuYWJsZVVuaXZlcnNhbFJvdXRlcjogdHJ1ZSxcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgY29uc3QgcXVlcnlQYXJhbXMgPSBxcy5zdHJpbmdpZnkocXVvdGVSZXEpXG5cbiAgICAgICAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgYXhpb3MuZ2V0PFF1b3RlUmVzcG9uc2U+KGAke0FQSX0/JHtxdWVyeVBhcmFtc31gKVxuICAgICAgICAgICAgY29uc3QgeyBkYXRhLCBzdGF0dXMgfSA9IHJlc3BvbnNlXG5cbiAgICAgICAgICAgIGV4cGVjdChzdGF0dXMpLnRvLmVxdWFsKDIwMClcbiAgICAgICAgICAgIGV4cGVjdChkYXRhLm1ldGhvZFBhcmFtZXRlcnMpLnRvLm5vdC5iZS51bmRlZmluZWRcblxuICAgICAgICAgICAgZXhwZWN0KGRhdGEucm91dGUpLnRvLm5vdC5iZS51bmRlZmluZWRcblxuICAgICAgICAgICAgY29uc3QgYW1vdW50SW5FZGdlc1RvdGFsID0gXyhkYXRhLnJvdXRlKVxuICAgICAgICAgICAgICAuZmxhdE1hcCgocm91dGUpID0+IHJvdXRlWzBdISlcbiAgICAgICAgICAgICAgLmZpbHRlcigocG9vbCkgPT4gISFwb29sLmFtb3VudEluKVxuICAgICAgICAgICAgICAubWFwKChwb29sKSA9PiBCaWdOdW1iZXIuZnJvbShwb29sLmFtb3VudEluKSlcbiAgICAgICAgICAgICAgLnJlZHVjZSgoY3VyLCB0b3RhbCkgPT4gdG90YWwuYWRkKGN1ciksIEJpZ051bWJlci5mcm9tKDApKVxuICAgICAgICAgICAgY29uc3QgYW1vdW50SW4gPSBCaWdOdW1iZXIuZnJvbShkYXRhLnF1b3RlKVxuICAgICAgICAgICAgZXhwZWN0KGFtb3VudEluLmVxKGFtb3VudEluRWRnZXNUb3RhbCkpXG5cbiAgICAgICAgICAgIGNvbnN0IGFtb3VudE91dEVkZ2VzVG90YWwgPSBfKGRhdGEucm91dGUpXG4gICAgICAgICAgICAgIC5mbGF0TWFwKChyb3V0ZSkgPT4gcm91dGVbMF0hKVxuICAgICAgICAgICAgICAuZmlsdGVyKChwb29sKSA9PiAhIXBvb2wuYW1vdW50T3V0KVxuICAgICAgICAgICAgICAubWFwKChwb29sKSA9PiBCaWdOdW1iZXIuZnJvbShwb29sLmFtb3VudE91dCkpXG4gICAgICAgICAgICAgIC5yZWR1Y2UoKGN1ciwgdG90YWwpID0+IHRvdGFsLmFkZChjdXIpLCBCaWdOdW1iZXIuZnJvbSgwKSlcbiAgICAgICAgICAgIGNvbnN0IGFtb3VudE91dCA9IEJpZ051bWJlci5mcm9tKGRhdGEucXVvdGUpXG4gICAgICAgICAgICBleHBlY3QoYW1vdW50T3V0LmVxKGFtb3VudE91dEVkZ2VzVG90YWwpKVxuXG4gICAgICAgICAgICBjb25zdCB7IHRva2VuSW5CZWZvcmUsIHRva2VuSW5BZnRlciwgdG9rZW5PdXRCZWZvcmUsIHRva2VuT3V0QWZ0ZXIgfSA9IGF3YWl0IGV4ZWN1dGVTd2FwKFxuICAgICAgICAgICAgICBkYXRhLm1ldGhvZFBhcmFtZXRlcnMhLFxuICAgICAgICAgICAgICBVU0RDX01BSU5ORVQsXG4gICAgICAgICAgICAgIEV0aGVyLm9uQ2hhaW4oMSlcbiAgICAgICAgICAgIClcblxuICAgICAgICAgICAgaWYgKHR5cGUgPT0gJ2V4YWN0SW4nKSB7XG4gICAgICAgICAgICAgIGV4cGVjdCh0b2tlbkluQmVmb3JlLnN1YnRyYWN0KHRva2VuSW5BZnRlcikudG9FeGFjdCgpKS50by5lcXVhbCgnMTAwMDAwMCcpXG4gICAgICAgICAgICAgIGNoZWNrUXVvdGVUb2tlbih0b2tlbk91dEJlZm9yZSwgdG9rZW5PdXRBZnRlciwgQ3VycmVuY3lBbW91bnQuZnJvbVJhd0Ftb3VudChFdGhlci5vbkNoYWluKDEpLCBkYXRhLnF1b3RlKSlcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgIC8vIEhhcmQgdG8gdGVzdCBFVEggYmFsYW5jZSBkdWUgdG8gZ2FzIGNvc3RzIGZvciBhcHByb3ZhbCBhbmQgc3dhcC4gSnVzdCBjaGVjayB0b2tlbkluIGNoYW5nZXNcbiAgICAgICAgICAgICAgY2hlY2tRdW90ZVRva2VuKHRva2VuSW5CZWZvcmUsIHRva2VuSW5BZnRlciwgQ3VycmVuY3lBbW91bnQuZnJvbVJhd0Ftb3VudChVU0RDX01BSU5ORVQsIGRhdGEucXVvdGUpKVxuICAgICAgICAgICAgfVxuICAgICAgICAgIH0pXG5cbiAgICAgICAgICBpdChgZXJjMjAgLT4gZXRoIGxhcmdlIHRyYWRlIHdpdGggcGVybWl0YCwgYXN5bmMgKCkgPT4ge1xuICAgICAgICAgICAgY29uc3Qgbm9uY2UgPSBuZXh0UGVybWl0Tm9uY2UoKVxuXG4gICAgICAgICAgICBjb25zdCBhbW91bnQgPVxuICAgICAgICAgICAgICB0eXBlID09ICdleGFjdEluJ1xuICAgICAgICAgICAgICAgID8gYXdhaXQgZ2V0QW1vdW50KDEsIHR5cGUsICdVU0RDJywgJ0VUSCcsICcxMDAwMDAwJylcbiAgICAgICAgICAgICAgICA6IGF3YWl0IGdldEFtb3VudCgxLCB0eXBlLCAnVVNEQycsICdFVEgnLCAnMTAwJylcblxuICAgICAgICAgICAgY29uc3QgcGVybWl0OiBQZXJtaXRTaW5nbGUgPSB7XG4gICAgICAgICAgICAgIGRldGFpbHM6IHtcbiAgICAgICAgICAgICAgICB0b2tlbjogVVNEQ19NQUlOTkVULmFkZHJlc3MsXG4gICAgICAgICAgICAgICAgYW1vdW50OiAnMTUwMDAwMDAwMDAwMCcsIC8vIEZvciBleGFjdCBvdXQgd2UgZG9uJ3Qga25vdyB0aGUgZXhhY3QgYW1vdW50IG5lZWRlZCB0byBwZXJtaXQsIHNvIGp1c3Qgc3BlY2lmeSBhIGxhcmdlIGFtb3VudC5cbiAgICAgICAgICAgICAgICBleHBpcmF0aW9uOiBNYXRoLmZsb29yKG5ldyBEYXRlKCkuZ2V0VGltZSgpIC8gMTAwMCArIDEwMDAwMDAwKS50b1N0cmluZygpLFxuICAgICAgICAgICAgICAgIG5vbmNlLFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICBzcGVuZGVyOiBVTklWRVJTQUxfUk9VVEVSX0FERFJFU1MsXG4gICAgICAgICAgICAgIHNpZ0RlYWRsaW5lOiBNYXRoLmZsb29yKG5ldyBEYXRlKCkuZ2V0VGltZSgpIC8gMTAwMCArIDEwMDAwMDAwKS50b1N0cmluZygpLFxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBjb25zdCB7IGRvbWFpbiwgdHlwZXMsIHZhbHVlcyB9ID0gQWxsb3dhbmNlVHJhbnNmZXIuZ2V0UGVybWl0RGF0YShwZXJtaXQsIFBFUk1JVDJfQUREUkVTUywgMSlcblxuICAgICAgICAgICAgY29uc3Qgc2lnbmF0dXJlID0gYXdhaXQgYWxpY2UuX3NpZ25UeXBlZERhdGEoZG9tYWluLCB0eXBlcywgdmFsdWVzKVxuXG4gICAgICAgICAgICAvLyBUcmFkZSBvZiB0aGlzIHNpemUgYWxtb3N0IGFsd2F5cyByZXN1bHRzIGluIHNwbGl0cy5cbiAgICAgICAgICAgIGNvbnN0IHF1b3RlUmVxOiBRdW90ZVF1ZXJ5UGFyYW1zID0ge1xuICAgICAgICAgICAgICB0b2tlbkluQWRkcmVzczogJ1VTREMnLFxuICAgICAgICAgICAgICB0b2tlbkluQ2hhaW5JZDogMSxcbiAgICAgICAgICAgICAgdG9rZW5PdXRBZGRyZXNzOiAnRVRIJyxcbiAgICAgICAgICAgICAgdG9rZW5PdXRDaGFpbklkOiAxLFxuICAgICAgICAgICAgICBhbW91bnQsXG4gICAgICAgICAgICAgIHR5cGUsXG4gICAgICAgICAgICAgIHJlY2lwaWVudDogYWxpY2UuYWRkcmVzcyxcbiAgICAgICAgICAgICAgc2xpcHBhZ2VUb2xlcmFuY2U6IFNMSVBQQUdFLFxuICAgICAgICAgICAgICBkZWFkbGluZTogJzM2MCcsXG4gICAgICAgICAgICAgIGFsZ29yaXRobSxcbiAgICAgICAgICAgICAgcGVybWl0U2lnbmF0dXJlOiBzaWduYXR1cmUsXG4gICAgICAgICAgICAgIHBlcm1pdEFtb3VudDogcGVybWl0LmRldGFpbHMuYW1vdW50LnRvU3RyaW5nKCksXG4gICAgICAgICAgICAgIHBlcm1pdEV4cGlyYXRpb246IHBlcm1pdC5kZXRhaWxzLmV4cGlyYXRpb24udG9TdHJpbmcoKSxcbiAgICAgICAgICAgICAgcGVybWl0U2lnRGVhZGxpbmU6IHBlcm1pdC5zaWdEZWFkbGluZS50b1N0cmluZygpLFxuICAgICAgICAgICAgICBwZXJtaXROb25jZTogcGVybWl0LmRldGFpbHMubm9uY2UudG9TdHJpbmcoKSxcbiAgICAgICAgICAgICAgZW5hYmxlVW5pdmVyc2FsUm91dGVyOiB0cnVlLFxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBjb25zdCBxdWVyeVBhcmFtcyA9IHFzLnN0cmluZ2lmeShxdW90ZVJlcSlcblxuICAgICAgICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBheGlvcy5nZXQ8UXVvdGVSZXNwb25zZT4oYCR7QVBJfT8ke3F1ZXJ5UGFyYW1zfWApXG4gICAgICAgICAgICBjb25zdCB7IGRhdGEsIHN0YXR1cyB9ID0gcmVzcG9uc2VcblxuICAgICAgICAgICAgZXhwZWN0KHN0YXR1cykudG8uZXF1YWwoMjAwKVxuICAgICAgICAgICAgZXhwZWN0KGRhdGEubWV0aG9kUGFyYW1ldGVycykudG8ubm90LmJlLnVuZGVmaW5lZFxuICAgICAgICAgICAgZXhwZWN0KGRhdGEucm91dGUpLnRvLm5vdC5iZS51bmRlZmluZWRcblxuICAgICAgICAgICAgY29uc3QgeyB0b2tlbkluQmVmb3JlLCB0b2tlbkluQWZ0ZXIsIHRva2VuT3V0QmVmb3JlLCB0b2tlbk91dEFmdGVyIH0gPSBhd2FpdCBleGVjdXRlU3dhcChcbiAgICAgICAgICAgICAgZGF0YS5tZXRob2RQYXJhbWV0ZXJzISxcbiAgICAgICAgICAgICAgVVNEQ19NQUlOTkVULFxuICAgICAgICAgICAgICBFdGhlci5vbkNoYWluKDEpLFxuICAgICAgICAgICAgICB0cnVlXG4gICAgICAgICAgICApXG5cbiAgICAgICAgICAgIGlmICh0eXBlID09ICdleGFjdEluJykge1xuICAgICAgICAgICAgICBleHBlY3QodG9rZW5JbkJlZm9yZS5zdWJ0cmFjdCh0b2tlbkluQWZ0ZXIpLnRvRXhhY3QoKSkudG8uZXF1YWwoJzEwMDAwMDAnKVxuICAgICAgICAgICAgICBjaGVja1F1b3RlVG9rZW4odG9rZW5PdXRCZWZvcmUsIHRva2VuT3V0QWZ0ZXIsIEN1cnJlbmN5QW1vdW50LmZyb21SYXdBbW91bnQoRXRoZXIub25DaGFpbigxKSwgZGF0YS5xdW90ZSkpXG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAvLyBIYXJkIHRvIHRlc3QgRVRIIGJhbGFuY2UgZHVlIHRvIGdhcyBjb3N0cyBmb3IgYXBwcm92YWwgYW5kIHN3YXAuIEp1c3QgY2hlY2sgdG9rZW5JbiBjaGFuZ2VzXG4gICAgICAgICAgICAgIGNoZWNrUXVvdGVUb2tlbih0b2tlbkluQmVmb3JlLCB0b2tlbkluQWZ0ZXIsIEN1cnJlbmN5QW1vdW50LmZyb21SYXdBbW91bnQoVVNEQ19NQUlOTkVULCBkYXRhLnF1b3RlKSlcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9KVxuXG4gICAgICAgICAgaXQoYGV0aCAtPiBlcmMyMGAsIGFzeW5jICgpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IHF1b3RlUmVxOiBRdW90ZVF1ZXJ5UGFyYW1zID0ge1xuICAgICAgICAgICAgICB0b2tlbkluQWRkcmVzczogJ0VUSCcsXG4gICAgICAgICAgICAgIHRva2VuSW5DaGFpbklkOiAxLFxuICAgICAgICAgICAgICB0b2tlbk91dEFkZHJlc3M6ICdVTkknLFxuICAgICAgICAgICAgICB0b2tlbk91dENoYWluSWQ6IDEsXG4gICAgICAgICAgICAgIGFtb3VudDpcbiAgICAgICAgICAgICAgICB0eXBlID09ICdleGFjdEluJ1xuICAgICAgICAgICAgICAgICAgPyBhd2FpdCBnZXRBbW91bnQoMSwgdHlwZSwgJ0VUSCcsICdVTkknLCAnMTAnKVxuICAgICAgICAgICAgICAgICAgOiBhd2FpdCBnZXRBbW91bnQoMSwgdHlwZSwgJ0VUSCcsICdVTkknLCAnMTAwMDAnKSxcbiAgICAgICAgICAgICAgdHlwZSxcbiAgICAgICAgICAgICAgcmVjaXBpZW50OiBhbGljZS5hZGRyZXNzLFxuICAgICAgICAgICAgICBzbGlwcGFnZVRvbGVyYW5jZTogU0xJUFBBR0UsXG4gICAgICAgICAgICAgIGRlYWRsaW5lOiAnMzYwJyxcbiAgICAgICAgICAgICAgYWxnb3JpdGhtLFxuICAgICAgICAgICAgICBlbmFibGVVbml2ZXJzYWxSb3V0ZXI6IHRydWUsXG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGNvbnN0IHF1ZXJ5UGFyYW1zID0gcXMuc3RyaW5naWZ5KHF1b3RlUmVxKVxuXG4gICAgICAgICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGF4aW9zLmdldDxRdW90ZVJlc3BvbnNlPihgJHtBUEl9PyR7cXVlcnlQYXJhbXN9YClcbiAgICAgICAgICAgIGNvbnN0IHsgZGF0YSwgc3RhdHVzIH0gPSByZXNwb25zZVxuXG4gICAgICAgICAgICBleHBlY3Qoc3RhdHVzKS50by5lcXVhbCgyMDApXG4gICAgICAgICAgICBleHBlY3QoZGF0YS5tZXRob2RQYXJhbWV0ZXJzKS50by5ub3QuYmUudW5kZWZpbmVkXG5cbiAgICAgICAgICAgIGNvbnN0IHsgdG9rZW5JbkJlZm9yZSwgdG9rZW5JbkFmdGVyLCB0b2tlbk91dEJlZm9yZSwgdG9rZW5PdXRBZnRlciB9ID0gYXdhaXQgZXhlY3V0ZVN3YXAoXG4gICAgICAgICAgICAgIGRhdGEubWV0aG9kUGFyYW1ldGVycyEsXG4gICAgICAgICAgICAgIEV0aGVyLm9uQ2hhaW4oMSksXG4gICAgICAgICAgICAgIFVOSV9NQUlOTkVUXG4gICAgICAgICAgICApXG5cbiAgICAgICAgICAgIGlmICh0eXBlID09ICdleGFjdEluJykge1xuICAgICAgICAgICAgICAvLyBXZSd2ZSBzd2FwcGVkIDEwIEVUSCArIGdhcyBjb3N0c1xuICAgICAgICAgICAgICBleHBlY3QodG9rZW5JbkJlZm9yZS5zdWJ0cmFjdCh0b2tlbkluQWZ0ZXIpLmdyZWF0ZXJUaGFuKHBhcnNlQW1vdW50KCcxMCcsIEV0aGVyLm9uQ2hhaW4oMSkpKSkudG8uYmUudHJ1ZVxuICAgICAgICAgICAgICBjaGVja1F1b3RlVG9rZW4odG9rZW5PdXRCZWZvcmUsIHRva2VuT3V0QWZ0ZXIsIEN1cnJlbmN5QW1vdW50LmZyb21SYXdBbW91bnQoVU5JX01BSU5ORVQsIGRhdGEucXVvdGUpKVxuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgZXhwZWN0KHRva2VuT3V0QWZ0ZXIuc3VidHJhY3QodG9rZW5PdXRCZWZvcmUpLnRvRXhhY3QoKSkudG8uZXF1YWwoJzEwMDAwJylcbiAgICAgICAgICAgICAgLy8gQ2FuJ3QgZWFzaWx5IGNoZWNrIHNsaXBwYWdlIGZvciBFVEggZHVlIHRvIGdhcyBjb3N0cyBlZmZlY3RpbmcgRVRIIGJhbGFuY2UuXG4gICAgICAgICAgICB9XG4gICAgICAgICAgfSlcblxuICAgICAgICAgIGl0KGBldGggLT4gZXJjMjAgc3dhcHJvdXRlcjAyYCwgYXN5bmMgKCkgPT4ge1xuICAgICAgICAgICAgY29uc3QgcXVvdGVSZXE6IFF1b3RlUXVlcnlQYXJhbXMgPSB7XG4gICAgICAgICAgICAgIHRva2VuSW5BZGRyZXNzOiAnRVRIJyxcbiAgICAgICAgICAgICAgdG9rZW5JbkNoYWluSWQ6IDEsXG4gICAgICAgICAgICAgIHRva2VuT3V0QWRkcmVzczogJ1VOSScsXG4gICAgICAgICAgICAgIHRva2VuT3V0Q2hhaW5JZDogMSxcbiAgICAgICAgICAgICAgYW1vdW50OlxuICAgICAgICAgICAgICAgIHR5cGUgPT0gJ2V4YWN0SW4nXG4gICAgICAgICAgICAgICAgICA/IGF3YWl0IGdldEFtb3VudCgxLCB0eXBlLCAnRVRIJywgJ1VOSScsICcxMCcpXG4gICAgICAgICAgICAgICAgICA6IGF3YWl0IGdldEFtb3VudCgxLCB0eXBlLCAnRVRIJywgJ1VOSScsICcxMDAwMCcpLFxuICAgICAgICAgICAgICB0eXBlLFxuICAgICAgICAgICAgICByZWNpcGllbnQ6IGFsaWNlLmFkZHJlc3MsXG4gICAgICAgICAgICAgIHNsaXBwYWdlVG9sZXJhbmNlOiBTTElQUEFHRSxcbiAgICAgICAgICAgICAgZGVhZGxpbmU6ICczNjAnLFxuICAgICAgICAgICAgICBhbGdvcml0aG0sXG4gICAgICAgICAgICAgIGVuYWJsZVVuaXZlcnNhbFJvdXRlcjogZmFsc2UsXG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGNvbnN0IHF1ZXJ5UGFyYW1zID0gcXMuc3RyaW5naWZ5KHF1b3RlUmVxKVxuXG4gICAgICAgICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGF4aW9zLmdldDxRdW90ZVJlc3BvbnNlPihgJHtBUEl9PyR7cXVlcnlQYXJhbXN9YClcbiAgICAgICAgICAgIGNvbnN0IHsgZGF0YSwgc3RhdHVzIH0gPSByZXNwb25zZVxuXG4gICAgICAgICAgICBleHBlY3Qoc3RhdHVzKS50by5lcXVhbCgyMDApXG4gICAgICAgICAgICBleHBlY3QoZGF0YS5tZXRob2RQYXJhbWV0ZXJzKS50by5ub3QuYmUudW5kZWZpbmVkXG4gICAgICAgICAgICBleHBlY3QoZGF0YS5tZXRob2RQYXJhbWV0ZXJzPy50bykudG8uZXF1YWwoU1dBUF9ST1VURVJfMDJfQUREUkVTU0VTKENoYWluSWQuTUFJTk5FVCkpXG5cbiAgICAgICAgICAgIGNvbnN0IHsgdG9rZW5JbkJlZm9yZSwgdG9rZW5JbkFmdGVyLCB0b2tlbk91dEJlZm9yZSwgdG9rZW5PdXRBZnRlciB9ID0gYXdhaXQgZXhlY3V0ZVN3YXAoXG4gICAgICAgICAgICAgIGRhdGEubWV0aG9kUGFyYW1ldGVycyEsXG4gICAgICAgICAgICAgIEV0aGVyLm9uQ2hhaW4oMSksXG4gICAgICAgICAgICAgIFVOSV9NQUlOTkVUXG4gICAgICAgICAgICApXG5cbiAgICAgICAgICAgIGlmICh0eXBlID09ICdleGFjdEluJykge1xuICAgICAgICAgICAgICAvLyBXZSd2ZSBzd2FwcGVkIDEwIEVUSCArIGdhcyBjb3N0c1xuICAgICAgICAgICAgICBleHBlY3QodG9rZW5JbkJlZm9yZS5zdWJ0cmFjdCh0b2tlbkluQWZ0ZXIpLmdyZWF0ZXJUaGFuKHBhcnNlQW1vdW50KCcxMCcsIEV0aGVyLm9uQ2hhaW4oMSkpKSkudG8uYmUudHJ1ZVxuICAgICAgICAgICAgICBjaGVja1F1b3RlVG9rZW4odG9rZW5PdXRCZWZvcmUsIHRva2VuT3V0QWZ0ZXIsIEN1cnJlbmN5QW1vdW50LmZyb21SYXdBbW91bnQoVU5JX01BSU5ORVQsIGRhdGEucXVvdGUpKVxuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgZXhwZWN0KHRva2VuT3V0QWZ0ZXIuc3VidHJhY3QodG9rZW5PdXRCZWZvcmUpLnRvRXhhY3QoKSkudG8uZXF1YWwoJzEwMDAwJylcbiAgICAgICAgICAgICAgLy8gQ2FuJ3QgZWFzaWx5IGNoZWNrIHNsaXBwYWdlIGZvciBFVEggZHVlIHRvIGdhcyBjb3N0cyBlZmZlY3RpbmcgRVRIIGJhbGFuY2UuXG4gICAgICAgICAgICB9XG4gICAgICAgICAgfSlcblxuICAgICAgICAgIGl0KGB3ZXRoIC0+IGVyYzIwYCwgYXN5bmMgKCkgPT4ge1xuICAgICAgICAgICAgY29uc3QgcXVvdGVSZXE6IFF1b3RlUXVlcnlQYXJhbXMgPSB7XG4gICAgICAgICAgICAgIHRva2VuSW5BZGRyZXNzOiAnV0VUSCcsXG4gICAgICAgICAgICAgIHRva2VuSW5DaGFpbklkOiAxLFxuICAgICAgICAgICAgICB0b2tlbk91dEFkZHJlc3M6ICdEQUknLFxuICAgICAgICAgICAgICB0b2tlbk91dENoYWluSWQ6IDEsXG4gICAgICAgICAgICAgIGFtb3VudDogYXdhaXQgZ2V0QW1vdW50KDEsIHR5cGUsICdXRVRIJywgJ0RBSScsICcxMDAnKSxcbiAgICAgICAgICAgICAgdHlwZSxcbiAgICAgICAgICAgICAgcmVjaXBpZW50OiBhbGljZS5hZGRyZXNzLFxuICAgICAgICAgICAgICBzbGlwcGFnZVRvbGVyYW5jZTogU0xJUFBBR0UsXG4gICAgICAgICAgICAgIGRlYWRsaW5lOiAnMzYwJyxcbiAgICAgICAgICAgICAgYWxnb3JpdGhtLFxuICAgICAgICAgICAgICBlbmFibGVVbml2ZXJzYWxSb3V0ZXI6IHRydWUsXG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGNvbnN0IHF1ZXJ5UGFyYW1zID0gcXMuc3RyaW5naWZ5KHF1b3RlUmVxKVxuXG4gICAgICAgICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGF4aW9zLmdldDxRdW90ZVJlc3BvbnNlPihgJHtBUEl9PyR7cXVlcnlQYXJhbXN9YClcbiAgICAgICAgICAgIGNvbnN0IHsgZGF0YSwgc3RhdHVzIH0gPSByZXNwb25zZVxuXG4gICAgICAgICAgICBleHBlY3Qoc3RhdHVzKS50by5lcXVhbCgyMDApXG4gICAgICAgICAgICBleHBlY3QoZGF0YS5tZXRob2RQYXJhbWV0ZXJzKS50by5ub3QuYmUudW5kZWZpbmVkXG5cbiAgICAgICAgICAgIGNvbnN0IHsgdG9rZW5JbkJlZm9yZSwgdG9rZW5JbkFmdGVyLCB0b2tlbk91dEJlZm9yZSwgdG9rZW5PdXRBZnRlciB9ID0gYXdhaXQgZXhlY3V0ZVN3YXAoXG4gICAgICAgICAgICAgIGRhdGEubWV0aG9kUGFyYW1ldGVycyEsXG4gICAgICAgICAgICAgIFdFVEg5WzFdISxcbiAgICAgICAgICAgICAgREFJX01BSU5ORVRcbiAgICAgICAgICAgIClcblxuICAgICAgICAgICAgaWYgKHR5cGUgPT0gJ2V4YWN0SW4nKSB7XG4gICAgICAgICAgICAgIGV4cGVjdCh0b2tlbkluQmVmb3JlLnN1YnRyYWN0KHRva2VuSW5BZnRlcikudG9FeGFjdCgpKS50by5lcXVhbCgnMTAwJylcbiAgICAgICAgICAgICAgY2hlY2tRdW90ZVRva2VuKHRva2VuT3V0QmVmb3JlLCB0b2tlbk91dEFmdGVyLCBDdXJyZW5jeUFtb3VudC5mcm9tUmF3QW1vdW50KERBSV9NQUlOTkVULCBkYXRhLnF1b3RlKSlcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgIGV4cGVjdCh0b2tlbk91dEFmdGVyLnN1YnRyYWN0KHRva2VuT3V0QmVmb3JlKS50b0V4YWN0KCkpLnRvLmVxdWFsKCcxMDAnKVxuICAgICAgICAgICAgICBjaGVja1F1b3RlVG9rZW4odG9rZW5JbkJlZm9yZSwgdG9rZW5JbkFmdGVyLCBDdXJyZW5jeUFtb3VudC5mcm9tUmF3QW1vdW50KFdFVEg5WzFdISwgZGF0YS5xdW90ZSkpXG4gICAgICAgICAgICB9XG4gICAgICAgICAgfSlcblxuICAgICAgICAgIGl0KGBlcmMyMCAtPiB3ZXRoYCwgYXN5bmMgKCkgPT4ge1xuICAgICAgICAgICAgY29uc3QgcXVvdGVSZXE6IFF1b3RlUXVlcnlQYXJhbXMgPSB7XG4gICAgICAgICAgICAgIHRva2VuSW5BZGRyZXNzOiAnVVNEQycsXG4gICAgICAgICAgICAgIHRva2VuSW5DaGFpbklkOiAxLFxuICAgICAgICAgICAgICB0b2tlbk91dEFkZHJlc3M6ICdXRVRIJyxcbiAgICAgICAgICAgICAgdG9rZW5PdXRDaGFpbklkOiAxLFxuICAgICAgICAgICAgICBhbW91bnQ6IGF3YWl0IGdldEFtb3VudCgxLCB0eXBlLCAnVVNEQycsICdXRVRIJywgJzEwMCcpLFxuICAgICAgICAgICAgICB0eXBlLFxuICAgICAgICAgICAgICByZWNpcGllbnQ6IGFsaWNlLmFkZHJlc3MsXG4gICAgICAgICAgICAgIHNsaXBwYWdlVG9sZXJhbmNlOiBTTElQUEFHRSxcbiAgICAgICAgICAgICAgZGVhZGxpbmU6ICczNjAnLFxuICAgICAgICAgICAgICBhbGdvcml0aG0sXG4gICAgICAgICAgICAgIGVuYWJsZVVuaXZlcnNhbFJvdXRlcjogdHJ1ZSxcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgY29uc3QgcXVlcnlQYXJhbXMgPSBxcy5zdHJpbmdpZnkocXVvdGVSZXEpXG5cbiAgICAgICAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgYXhpb3MuZ2V0PFF1b3RlUmVzcG9uc2U+KGAke0FQSX0/JHtxdWVyeVBhcmFtc31gKVxuICAgICAgICAgICAgY29uc3QgeyBkYXRhLCBzdGF0dXMgfSA9IHJlc3BvbnNlXG5cbiAgICAgICAgICAgIGV4cGVjdChzdGF0dXMpLnRvLmVxdWFsKDIwMClcbiAgICAgICAgICAgIGV4cGVjdChkYXRhLm1ldGhvZFBhcmFtZXRlcnMpLnRvLm5vdC5iZS51bmRlZmluZWRcblxuICAgICAgICAgICAgY29uc3QgeyB0b2tlbkluQmVmb3JlLCB0b2tlbkluQWZ0ZXIsIHRva2VuT3V0QmVmb3JlLCB0b2tlbk91dEFmdGVyIH0gPSBhd2FpdCBleGVjdXRlU3dhcChcbiAgICAgICAgICAgICAgZGF0YS5tZXRob2RQYXJhbWV0ZXJzISxcbiAgICAgICAgICAgICAgVVNEQ19NQUlOTkVULFxuICAgICAgICAgICAgICBXRVRIOVsxXSFcbiAgICAgICAgICAgIClcblxuICAgICAgICAgICAgaWYgKHR5cGUgPT0gJ2V4YWN0SW4nKSB7XG4gICAgICAgICAgICAgIGV4cGVjdCh0b2tlbkluQmVmb3JlLnN1YnRyYWN0KHRva2VuSW5BZnRlcikudG9FeGFjdCgpKS50by5lcXVhbCgnMTAwJylcbiAgICAgICAgICAgICAgY2hlY2tRdW90ZVRva2VuKHRva2VuT3V0QmVmb3JlLCB0b2tlbk91dEFmdGVyLCBDdXJyZW5jeUFtb3VudC5mcm9tUmF3QW1vdW50KFdFVEg5WzFdLCBkYXRhLnF1b3RlKSlcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgIGV4cGVjdCh0b2tlbk91dEFmdGVyLnN1YnRyYWN0KHRva2VuT3V0QmVmb3JlKS50b0V4YWN0KCkpLnRvLmVxdWFsKCcxMDAnKVxuICAgICAgICAgICAgICBjaGVja1F1b3RlVG9rZW4odG9rZW5JbkJlZm9yZSwgdG9rZW5JbkFmdGVyLCBDdXJyZW5jeUFtb3VudC5mcm9tUmF3QW1vdW50KFVTRENfTUFJTk5FVCwgZGF0YS5xdW90ZSkpXG4gICAgICAgICAgICB9XG4gICAgICAgICAgfSlcblxuICAgICAgICAgIGlmIChhbGdvcml0aG0gPT0gJ2FscGhhJykge1xuICAgICAgICAgICAgaXQoYGVyYzIwIC0+IGVyYzIwIHYzIG9ubHlgLCBhc3luYyAoKSA9PiB7XG4gICAgICAgICAgICAgIGNvbnN0IHF1b3RlUmVxOiBRdW90ZVF1ZXJ5UGFyYW1zID0ge1xuICAgICAgICAgICAgICAgIHRva2VuSW5BZGRyZXNzOiAnVVNEQycsXG4gICAgICAgICAgICAgICAgdG9rZW5JbkNoYWluSWQ6IDEsXG4gICAgICAgICAgICAgICAgdG9rZW5PdXRBZGRyZXNzOiAnVVNEVCcsXG4gICAgICAgICAgICAgICAgdG9rZW5PdXRDaGFpbklkOiAxLFxuICAgICAgICAgICAgICAgIGFtb3VudDogYXdhaXQgZ2V0QW1vdW50KDEsIHR5cGUsICdVU0RDJywgJ1VTRFQnLCAnMTAwJyksXG4gICAgICAgICAgICAgICAgdHlwZSxcbiAgICAgICAgICAgICAgICByZWNpcGllbnQ6IGFsaWNlLmFkZHJlc3MsXG4gICAgICAgICAgICAgICAgc2xpcHBhZ2VUb2xlcmFuY2U6IFNMSVBQQUdFLFxuICAgICAgICAgICAgICAgIGRlYWRsaW5lOiAnMzYwJyxcbiAgICAgICAgICAgICAgICBhbGdvcml0aG06ICdhbHBoYScsXG4gICAgICAgICAgICAgICAgcHJvdG9jb2xzOiAndjMnLFxuICAgICAgICAgICAgICAgIGVuYWJsZVVuaXZlcnNhbFJvdXRlcjogdHJ1ZSxcbiAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgIGNvbnN0IHF1ZXJ5UGFyYW1zID0gcXMuc3RyaW5naWZ5KHF1b3RlUmVxKVxuXG4gICAgICAgICAgICAgIGNvbnN0IHJlc3BvbnNlOiBBeGlvc1Jlc3BvbnNlPFF1b3RlUmVzcG9uc2U+ID0gYXdhaXQgYXhpb3MuZ2V0PFF1b3RlUmVzcG9uc2U+KGAke0FQSX0/JHtxdWVyeVBhcmFtc31gKVxuICAgICAgICAgICAgICBjb25zdCB7XG4gICAgICAgICAgICAgICAgZGF0YTogeyBxdW90ZSwgcXVvdGVEZWNpbWFscywgcXVvdGVHYXNBZGp1c3RlZERlY2ltYWxzLCBtZXRob2RQYXJhbWV0ZXJzLCByb3V0ZSB9LFxuICAgICAgICAgICAgICAgIHN0YXR1cyxcbiAgICAgICAgICAgICAgfSA9IHJlc3BvbnNlXG5cbiAgICAgICAgICAgICAgZXhwZWN0KHN0YXR1cykudG8uZXF1YWwoMjAwKVxuICAgICAgICAgICAgICBleHBlY3QocGFyc2VGbG9hdChxdW90ZURlY2ltYWxzKSkudG8uYmUuZ3JlYXRlclRoYW4oOTApXG4gICAgICAgICAgICAgIGV4cGVjdChwYXJzZUZsb2F0KHF1b3RlRGVjaW1hbHMpKS50by5iZS5sZXNzVGhhbigxMTApXG5cbiAgICAgICAgICAgICAgaWYgKHR5cGUgPT0gJ2V4YWN0SW4nKSB7XG4gICAgICAgICAgICAgICAgZXhwZWN0KHBhcnNlRmxvYXQocXVvdGVHYXNBZGp1c3RlZERlY2ltYWxzKSkudG8uYmUubGVzc1RoYW5PckVxdWFsKHBhcnNlRmxvYXQocXVvdGVEZWNpbWFscykpXG4gICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgZXhwZWN0KHBhcnNlRmxvYXQocXVvdGVHYXNBZGp1c3RlZERlY2ltYWxzKSkudG8uYmUuZ3JlYXRlclRoYW5PckVxdWFsKHBhcnNlRmxvYXQocXVvdGVEZWNpbWFscykpXG4gICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICBleHBlY3QobWV0aG9kUGFyYW1ldGVycykudG8ubm90LmJlLnVuZGVmaW5lZFxuXG4gICAgICAgICAgICAgIGZvciAoY29uc3QgciBvZiByb3V0ZSkge1xuICAgICAgICAgICAgICAgIGZvciAoY29uc3QgcG9vbCBvZiByKSB7XG4gICAgICAgICAgICAgICAgICBleHBlY3QocG9vbC50eXBlKS50by5lcXVhbCgndjMtcG9vbCcpXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgY29uc3QgeyB0b2tlbkluQmVmb3JlLCB0b2tlbkluQWZ0ZXIsIHRva2VuT3V0QmVmb3JlLCB0b2tlbk91dEFmdGVyIH0gPSBhd2FpdCBleGVjdXRlU3dhcChcbiAgICAgICAgICAgICAgICByZXNwb25zZS5kYXRhLm1ldGhvZFBhcmFtZXRlcnMhLFxuICAgICAgICAgICAgICAgIFVTRENfTUFJTk5FVCxcbiAgICAgICAgICAgICAgICBVU0RUX01BSU5ORVQhXG4gICAgICAgICAgICAgIClcblxuICAgICAgICAgICAgICBpZiAodHlwZSA9PSAnZXhhY3RJbicpIHtcbiAgICAgICAgICAgICAgICBleHBlY3QodG9rZW5JbkJlZm9yZS5zdWJ0cmFjdCh0b2tlbkluQWZ0ZXIpLnRvRXhhY3QoKSkudG8uZXF1YWwoJzEwMCcpXG4gICAgICAgICAgICAgICAgY2hlY2tRdW90ZVRva2VuKHRva2VuT3V0QmVmb3JlLCB0b2tlbk91dEFmdGVyLCBDdXJyZW5jeUFtb3VudC5mcm9tUmF3QW1vdW50KFVTRFRfTUFJTk5FVCwgcXVvdGUpKVxuICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIGV4cGVjdCh0b2tlbk91dEFmdGVyLnN1YnRyYWN0KHRva2VuT3V0QmVmb3JlKS50b0V4YWN0KCkpLnRvLmVxdWFsKCcxMDAnKVxuICAgICAgICAgICAgICAgIGNoZWNrUXVvdGVUb2tlbih0b2tlbkluQmVmb3JlLCB0b2tlbkluQWZ0ZXIsIEN1cnJlbmN5QW1vdW50LmZyb21SYXdBbW91bnQoVVNEQ19NQUlOTkVULCBxdW90ZSkpXG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pXG5cbiAgICAgICAgICAgIGl0KGBlcmMyMCAtPiBlcmMyMCB2MiBvbmx5YCwgYXN5bmMgKCkgPT4ge1xuICAgICAgICAgICAgICBjb25zdCBxdW90ZVJlcTogUXVvdGVRdWVyeVBhcmFtcyA9IHtcbiAgICAgICAgICAgICAgICB0b2tlbkluQWRkcmVzczogJ1VTREMnLFxuICAgICAgICAgICAgICAgIHRva2VuSW5DaGFpbklkOiAxLFxuICAgICAgICAgICAgICAgIHRva2VuT3V0QWRkcmVzczogJ1VTRFQnLFxuICAgICAgICAgICAgICAgIHRva2VuT3V0Q2hhaW5JZDogMSxcbiAgICAgICAgICAgICAgICBhbW91bnQ6IGF3YWl0IGdldEFtb3VudCgxLCB0eXBlLCAnVVNEQycsICdVU0RUJywgJzEwMCcpLFxuICAgICAgICAgICAgICAgIHR5cGUsXG4gICAgICAgICAgICAgICAgcmVjaXBpZW50OiBhbGljZS5hZGRyZXNzLFxuICAgICAgICAgICAgICAgIHNsaXBwYWdlVG9sZXJhbmNlOiBTTElQUEFHRSxcbiAgICAgICAgICAgICAgICBkZWFkbGluZTogJzM2MCcsXG4gICAgICAgICAgICAgICAgYWxnb3JpdGhtOiAnYWxwaGEnLFxuICAgICAgICAgICAgICAgIHByb3RvY29sczogJ3YyJyxcbiAgICAgICAgICAgICAgICBlbmFibGVVbml2ZXJzYWxSb3V0ZXI6IHRydWUsXG4gICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICBjb25zdCBxdWVyeVBhcmFtcyA9IHFzLnN0cmluZ2lmeShxdW90ZVJlcSlcblxuICAgICAgICAgICAgICBjb25zdCByZXNwb25zZTogQXhpb3NSZXNwb25zZTxRdW90ZVJlc3BvbnNlPiA9IGF3YWl0IGF4aW9zLmdldDxRdW90ZVJlc3BvbnNlPihgJHtBUEl9PyR7cXVlcnlQYXJhbXN9YClcbiAgICAgICAgICAgICAgY29uc3Qge1xuICAgICAgICAgICAgICAgIGRhdGE6IHsgcXVvdGUsIHF1b3RlRGVjaW1hbHMsIHF1b3RlR2FzQWRqdXN0ZWREZWNpbWFscywgbWV0aG9kUGFyYW1ldGVycywgcm91dGUgfSxcbiAgICAgICAgICAgICAgICBzdGF0dXMsXG4gICAgICAgICAgICAgIH0gPSByZXNwb25zZVxuXG4gICAgICAgICAgICAgIGV4cGVjdChzdGF0dXMpLnRvLmVxdWFsKDIwMClcbiAgICAgICAgICAgICAgZXhwZWN0KHBhcnNlRmxvYXQocXVvdGVEZWNpbWFscykpLnRvLmJlLmdyZWF0ZXJUaGFuKDkwKVxuICAgICAgICAgICAgICBleHBlY3QocGFyc2VGbG9hdChxdW90ZURlY2ltYWxzKSkudG8uYmUubGVzc1RoYW4oMTEwKVxuXG4gICAgICAgICAgICAgIGlmICh0eXBlID09ICdleGFjdEluJykge1xuICAgICAgICAgICAgICAgIGV4cGVjdChwYXJzZUZsb2F0KHF1b3RlR2FzQWRqdXN0ZWREZWNpbWFscykpLnRvLmJlLmxlc3NUaGFuT3JFcXVhbChwYXJzZUZsb2F0KHF1b3RlRGVjaW1hbHMpKVxuICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIGV4cGVjdChwYXJzZUZsb2F0KHF1b3RlR2FzQWRqdXN0ZWREZWNpbWFscykpLnRvLmJlLmdyZWF0ZXJUaGFuT3JFcXVhbChwYXJzZUZsb2F0KHF1b3RlRGVjaW1hbHMpKVxuICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgZXhwZWN0KG1ldGhvZFBhcmFtZXRlcnMpLnRvLm5vdC5iZS51bmRlZmluZWRcblxuICAgICAgICAgICAgICBmb3IgKGNvbnN0IHIgb2Ygcm91dGUpIHtcbiAgICAgICAgICAgICAgICBmb3IgKGNvbnN0IHBvb2wgb2Ygcikge1xuICAgICAgICAgICAgICAgICAgZXhwZWN0KHBvb2wudHlwZSkudG8uZXF1YWwoJ3YyLXBvb2wnKVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgIGNvbnN0IHsgdG9rZW5JbkJlZm9yZSwgdG9rZW5JbkFmdGVyLCB0b2tlbk91dEJlZm9yZSwgdG9rZW5PdXRBZnRlciB9ID0gYXdhaXQgZXhlY3V0ZVN3YXAoXG4gICAgICAgICAgICAgICAgcmVzcG9uc2UuZGF0YS5tZXRob2RQYXJhbWV0ZXJzISxcbiAgICAgICAgICAgICAgICBVU0RDX01BSU5ORVQsXG4gICAgICAgICAgICAgICAgVVNEVF9NQUlOTkVUIVxuICAgICAgICAgICAgICApXG5cbiAgICAgICAgICAgICAgaWYgKHR5cGUgPT0gJ2V4YWN0SW4nKSB7XG4gICAgICAgICAgICAgICAgZXhwZWN0KHRva2VuSW5CZWZvcmUuc3VidHJhY3QodG9rZW5JbkFmdGVyKS50b0V4YWN0KCkpLnRvLmVxdWFsKCcxMDAnKVxuICAgICAgICAgICAgICAgIGNoZWNrUXVvdGVUb2tlbih0b2tlbk91dEJlZm9yZSwgdG9rZW5PdXRBZnRlciwgQ3VycmVuY3lBbW91bnQuZnJvbVJhd0Ftb3VudChVU0RUX01BSU5ORVQsIHF1b3RlKSlcbiAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBleHBlY3QodG9rZW5PdXRBZnRlci5zdWJ0cmFjdCh0b2tlbk91dEJlZm9yZSkudG9FeGFjdCgpKS50by5lcXVhbCgnMTAwJylcbiAgICAgICAgICAgICAgICBjaGVja1F1b3RlVG9rZW4odG9rZW5JbkJlZm9yZSwgdG9rZW5JbkFmdGVyLCBDdXJyZW5jeUFtb3VudC5mcm9tUmF3QW1vdW50KFVTRENfTUFJTk5FVCwgcXVvdGUpKVxuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KVxuXG4gICAgICAgICAgICBpdChgZXJjMjAgLT4gZXJjMjAgZm9yY2VDcm9zc1Byb3RvY29sYCwgYXN5bmMgKCkgPT4ge1xuICAgICAgICAgICAgICBjb25zdCBxdW90ZVJlcTogUXVvdGVRdWVyeVBhcmFtcyA9IHtcbiAgICAgICAgICAgICAgICB0b2tlbkluQWRkcmVzczogJ1VTREMnLFxuICAgICAgICAgICAgICAgIHRva2VuSW5DaGFpbklkOiAxLFxuICAgICAgICAgICAgICAgIHRva2VuT3V0QWRkcmVzczogJ1VTRFQnLFxuICAgICAgICAgICAgICAgIHRva2VuT3V0Q2hhaW5JZDogMSxcbiAgICAgICAgICAgICAgICBhbW91bnQ6IGF3YWl0IGdldEFtb3VudCgxLCB0eXBlLCAnVVNEQycsICdVU0RUJywgJzEwMCcpLFxuICAgICAgICAgICAgICAgIHR5cGUsXG4gICAgICAgICAgICAgICAgcmVjaXBpZW50OiBhbGljZS5hZGRyZXNzLFxuICAgICAgICAgICAgICAgIHNsaXBwYWdlVG9sZXJhbmNlOiBTTElQUEFHRSxcbiAgICAgICAgICAgICAgICBkZWFkbGluZTogJzM2MCcsXG4gICAgICAgICAgICAgICAgYWxnb3JpdGhtOiAnYWxwaGEnLFxuICAgICAgICAgICAgICAgIGZvcmNlQ3Jvc3NQcm90b2NvbDogdHJ1ZSxcbiAgICAgICAgICAgICAgICBlbmFibGVVbml2ZXJzYWxSb3V0ZXI6IHRydWUsXG4gICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICBjb25zdCBxdWVyeVBhcmFtcyA9IHFzLnN0cmluZ2lmeShxdW90ZVJlcSlcblxuICAgICAgICAgICAgICBjb25zdCByZXNwb25zZTogQXhpb3NSZXNwb25zZTxRdW90ZVJlc3BvbnNlPiA9IGF3YWl0IGF4aW9zLmdldDxRdW90ZVJlc3BvbnNlPihgJHtBUEl9PyR7cXVlcnlQYXJhbXN9YClcbiAgICAgICAgICAgICAgY29uc3Qge1xuICAgICAgICAgICAgICAgIGRhdGE6IHsgcXVvdGUsIHF1b3RlRGVjaW1hbHMsIHF1b3RlR2FzQWRqdXN0ZWREZWNpbWFscywgbWV0aG9kUGFyYW1ldGVycywgcm91dGUgfSxcbiAgICAgICAgICAgICAgICBzdGF0dXMsXG4gICAgICAgICAgICAgIH0gPSByZXNwb25zZVxuXG4gICAgICAgICAgICAgIGV4cGVjdChzdGF0dXMpLnRvLmVxdWFsKDIwMClcbiAgICAgICAgICAgICAgZXhwZWN0KHBhcnNlRmxvYXQocXVvdGVEZWNpbWFscykpLnRvLmJlLmdyZWF0ZXJUaGFuKDkwKVxuICAgICAgICAgICAgICBleHBlY3QocGFyc2VGbG9hdChxdW90ZURlY2ltYWxzKSkudG8uYmUubGVzc1RoYW4oMTEwKVxuXG4gICAgICAgICAgICAgIGlmICh0eXBlID09ICdleGFjdEluJykge1xuICAgICAgICAgICAgICAgIGV4cGVjdChwYXJzZUZsb2F0KHF1b3RlR2FzQWRqdXN0ZWREZWNpbWFscykpLnRvLmJlLmxlc3NUaGFuT3JFcXVhbChwYXJzZUZsb2F0KHF1b3RlRGVjaW1hbHMpKVxuICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIGV4cGVjdChwYXJzZUZsb2F0KHF1b3RlR2FzQWRqdXN0ZWREZWNpbWFscykpLnRvLmJlLmdyZWF0ZXJUaGFuT3JFcXVhbChwYXJzZUZsb2F0KHF1b3RlRGVjaW1hbHMpKVxuICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgZXhwZWN0KG1ldGhvZFBhcmFtZXRlcnMpLnRvLm5vdC5iZS51bmRlZmluZWRcblxuICAgICAgICAgICAgICBsZXQgaGFzVjNQb29sID0gZmFsc2VcbiAgICAgICAgICAgICAgbGV0IGhhc1YyUG9vbCA9IGZhbHNlXG4gICAgICAgICAgICAgIGZvciAoY29uc3QgciBvZiByb3V0ZSkge1xuICAgICAgICAgICAgICAgIGZvciAoY29uc3QgcG9vbCBvZiByKSB7XG4gICAgICAgICAgICAgICAgICBpZiAocG9vbC50eXBlID09ICd2My1wb29sJykge1xuICAgICAgICAgICAgICAgICAgICBoYXNWM1Bvb2wgPSB0cnVlXG4gICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICBpZiAocG9vbC50eXBlID09ICd2Mi1wb29sJykge1xuICAgICAgICAgICAgICAgICAgICBoYXNWMlBvb2wgPSB0cnVlXG4gICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgZXhwZWN0KGhhc1YzUG9vbCAmJiBoYXNWMlBvb2wpLnRvLmJlLnRydWVcblxuICAgICAgICAgICAgICBjb25zdCB7IHRva2VuSW5CZWZvcmUsIHRva2VuSW5BZnRlciwgdG9rZW5PdXRCZWZvcmUsIHRva2VuT3V0QWZ0ZXIgfSA9IGF3YWl0IGV4ZWN1dGVTd2FwKFxuICAgICAgICAgICAgICAgIHJlc3BvbnNlLmRhdGEubWV0aG9kUGFyYW1ldGVycyEsXG4gICAgICAgICAgICAgICAgVVNEQ19NQUlOTkVULFxuICAgICAgICAgICAgICAgIFVTRFRfTUFJTk5FVCFcbiAgICAgICAgICAgICAgKVxuXG4gICAgICAgICAgICAgIGlmICh0eXBlID09ICdleGFjdEluJykge1xuICAgICAgICAgICAgICAgIGV4cGVjdCh0b2tlbkluQmVmb3JlLnN1YnRyYWN0KHRva2VuSW5BZnRlcikudG9FeGFjdCgpKS50by5lcXVhbCgnMTAwJylcbiAgICAgICAgICAgICAgICBjaGVja1F1b3RlVG9rZW4odG9rZW5PdXRCZWZvcmUsIHRva2VuT3V0QWZ0ZXIsIEN1cnJlbmN5QW1vdW50LmZyb21SYXdBbW91bnQoVVNEVF9NQUlOTkVULCBxdW90ZSkpXG4gICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgZXhwZWN0KHRva2VuT3V0QWZ0ZXIuc3VidHJhY3QodG9rZW5PdXRCZWZvcmUpLnRvRXhhY3QoKSkudG8uZXF1YWwoJzEwMCcpXG4gICAgICAgICAgICAgICAgY2hlY2tRdW90ZVRva2VuKHRva2VuSW5CZWZvcmUsIHRva2VuSW5BZnRlciwgQ3VycmVuY3lBbW91bnQuZnJvbVJhd0Ftb3VudChVU0RDX01BSU5ORVQsIHF1b3RlKSlcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSlcblxuICAgICAgICAgICAgLy8vIFRlc3RzIGZvciByb3V0ZXMgbGlrZWx5IHRvIHJlc3VsdCBpbiBNaXhlZFJvdXRlcyBiZWluZyByZXR1cm5lZFxuICAgICAgICAgICAgaWYgKHR5cGUgPT09ICdleGFjdEluJykge1xuICAgICAgICAgICAgICBpdChgZXJjMjAgLT4gZXJjMjAgZm9yY2VNaXhlZFJvdXRlcyBub3Qgc3BlY2lmaWVkIGZvciB2Mix2MyBkb2VzIG5vdCByZXR1cm4gbWl4ZWQgcm91dGUgZXZlbiB3aGVuIGl0IGlzIGJldHRlcmAsIGFzeW5jICgpID0+IHtcbiAgICAgICAgICAgICAgICBjb25zdCBxdW90ZVJlcTogUXVvdGVRdWVyeVBhcmFtcyA9IHtcbiAgICAgICAgICAgICAgICAgIHRva2VuSW5BZGRyZXNzOiAnQk9ORCcsXG4gICAgICAgICAgICAgICAgICB0b2tlbkluQ2hhaW5JZDogMSxcbiAgICAgICAgICAgICAgICAgIHRva2VuT3V0QWRkcmVzczogJ0FQRScsXG4gICAgICAgICAgICAgICAgICB0b2tlbk91dENoYWluSWQ6IDEsXG4gICAgICAgICAgICAgICAgICBhbW91bnQ6IGF3YWl0IGdldEFtb3VudCgxLCB0eXBlLCAnQk9ORCcsICdBUEUnLCAnMTAwMDAnKSxcbiAgICAgICAgICAgICAgICAgIHR5cGUsXG4gICAgICAgICAgICAgICAgICByZWNpcGllbnQ6IGFsaWNlLmFkZHJlc3MsXG4gICAgICAgICAgICAgICAgICBzbGlwcGFnZVRvbGVyYW5jZTogU0xJUFBBR0UsXG4gICAgICAgICAgICAgICAgICBkZWFkbGluZTogJzM2MCcsXG4gICAgICAgICAgICAgICAgICBhbGdvcml0aG06ICdhbHBoYScsXG4gICAgICAgICAgICAgICAgICBwcm90b2NvbHM6ICd2Mix2MycsXG4gICAgICAgICAgICAgICAgICBlbmFibGVVbml2ZXJzYWxSb3V0ZXI6IHRydWUsXG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgY29uc3QgcXVlcnlQYXJhbXMgPSBxcy5zdHJpbmdpZnkocXVvdGVSZXEpXG5cbiAgICAgICAgICAgICAgICBjb25zdCByZXNwb25zZTogQXhpb3NSZXNwb25zZTxRdW90ZVJlc3BvbnNlPiA9IGF3YWl0IGF4aW9zLmdldDxRdW90ZVJlc3BvbnNlPihgJHtBUEl9PyR7cXVlcnlQYXJhbXN9YClcbiAgICAgICAgICAgICAgICBjb25zdCB7XG4gICAgICAgICAgICAgICAgICBkYXRhOiB7IHF1b3RlRGVjaW1hbHMsIHF1b3RlR2FzQWRqdXN0ZWREZWNpbWFscywgbWV0aG9kUGFyYW1ldGVycywgcm91dGVTdHJpbmcgfSxcbiAgICAgICAgICAgICAgICAgIHN0YXR1cyxcbiAgICAgICAgICAgICAgICB9ID0gcmVzcG9uc2VcblxuICAgICAgICAgICAgICAgIGV4cGVjdChzdGF0dXMpLnRvLmVxdWFsKDIwMClcblxuICAgICAgICAgICAgICAgIGlmICh0eXBlID09ICdleGFjdEluJykge1xuICAgICAgICAgICAgICAgICAgZXhwZWN0KHBhcnNlRmxvYXQocXVvdGVHYXNBZGp1c3RlZERlY2ltYWxzKSkudG8uYmUubGVzc1RoYW5PckVxdWFsKHBhcnNlRmxvYXQocXVvdGVEZWNpbWFscykpXG4gICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgIGV4cGVjdChwYXJzZUZsb2F0KHF1b3RlR2FzQWRqdXN0ZWREZWNpbWFscykpLnRvLmJlLmdyZWF0ZXJUaGFuT3JFcXVhbChwYXJzZUZsb2F0KHF1b3RlRGVjaW1hbHMpKVxuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIGV4cGVjdChtZXRob2RQYXJhbWV0ZXJzKS50by5ub3QuYmUudW5kZWZpbmVkXG5cbiAgICAgICAgICAgICAgICBleHBlY3QoIXJvdXRlU3RyaW5nLmluY2x1ZGVzKCdbVjIgKyBWM10nKSlcbiAgICAgICAgICAgICAgfSlcblxuICAgICAgICAgICAgICBpdChgZXJjMjAgLT4gZXJjMjAgZm9yY2VNaXhlZFJvdXRlcyB0cnVlIGZvciB2Mix2M2AsIGFzeW5jICgpID0+IHtcbiAgICAgICAgICAgICAgICBjb25zdCBxdW90ZVJlcTogUXVvdGVRdWVyeVBhcmFtcyA9IHtcbiAgICAgICAgICAgICAgICAgIHRva2VuSW5BZGRyZXNzOiAnQk9ORCcsXG4gICAgICAgICAgICAgICAgICB0b2tlbkluQ2hhaW5JZDogMSxcbiAgICAgICAgICAgICAgICAgIHRva2VuT3V0QWRkcmVzczogJ0FQRScsXG4gICAgICAgICAgICAgICAgICB0b2tlbk91dENoYWluSWQ6IDEsXG4gICAgICAgICAgICAgICAgICBhbW91bnQ6IGF3YWl0IGdldEFtb3VudCgxLCB0eXBlLCAnQk9ORCcsICdBUEUnLCAnMTAwMDAnKSxcbiAgICAgICAgICAgICAgICAgIHR5cGUsXG4gICAgICAgICAgICAgICAgICByZWNpcGllbnQ6IGFsaWNlLmFkZHJlc3MsXG4gICAgICAgICAgICAgICAgICBzbGlwcGFnZVRvbGVyYW5jZTogU0xJUFBBR0UsXG4gICAgICAgICAgICAgICAgICBkZWFkbGluZTogJzM2MCcsXG4gICAgICAgICAgICAgICAgICBhbGdvcml0aG06ICdhbHBoYScsXG4gICAgICAgICAgICAgICAgICBmb3JjZU1peGVkUm91dGVzOiB0cnVlLFxuICAgICAgICAgICAgICAgICAgcHJvdG9jb2xzOiAndjIsdjMnLFxuICAgICAgICAgICAgICAgICAgZW5hYmxlVW5pdmVyc2FsUm91dGVyOiB0cnVlLFxuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIGF3YWl0IGNhbGxBbmRFeHBlY3RGYWlsKHF1b3RlUmVxLCB7XG4gICAgICAgICAgICAgICAgICBzdGF0dXM6IDQwNCxcbiAgICAgICAgICAgICAgICAgIGRhdGE6IHtcbiAgICAgICAgICAgICAgICAgICAgZGV0YWlsOiAnTm8gcm91dGUgZm91bmQnLFxuICAgICAgICAgICAgICAgICAgICBlcnJvckNvZGU6ICdOT19ST1VURScsXG4gICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICAgIH0pXG5cbiAgICAgICAgICAgICAgaXQoYGVyYzIwIC0+IGVyYzIwIGZvcmNlTWl4ZWRSb3V0ZXMgdHJ1ZSBmb3IgYWxsIHByb3RvY29scyBzcGVjaWZpZWRgLCBhc3luYyAoKSA9PiB7XG4gICAgICAgICAgICAgICAgY29uc3QgcXVvdGVSZXE6IFF1b3RlUXVlcnlQYXJhbXMgPSB7XG4gICAgICAgICAgICAgICAgICB0b2tlbkluQWRkcmVzczogJ0JPTkQnLFxuICAgICAgICAgICAgICAgICAgdG9rZW5JbkNoYWluSWQ6IDEsXG4gICAgICAgICAgICAgICAgICB0b2tlbk91dEFkZHJlc3M6ICdBUEUnLFxuICAgICAgICAgICAgICAgICAgdG9rZW5PdXRDaGFpbklkOiAxLFxuICAgICAgICAgICAgICAgICAgYW1vdW50OiBhd2FpdCBnZXRBbW91bnQoMSwgdHlwZSwgJ0JPTkQnLCAnQVBFJywgJzEwMDAwJyksXG4gICAgICAgICAgICAgICAgICB0eXBlLFxuICAgICAgICAgICAgICAgICAgcmVjaXBpZW50OiBhbGljZS5hZGRyZXNzLFxuICAgICAgICAgICAgICAgICAgc2xpcHBhZ2VUb2xlcmFuY2U6IFNMSVBQQUdFLFxuICAgICAgICAgICAgICAgICAgZGVhZGxpbmU6ICczNjAnLFxuICAgICAgICAgICAgICAgICAgYWxnb3JpdGhtOiAnYWxwaGEnLFxuICAgICAgICAgICAgICAgICAgZm9yY2VNaXhlZFJvdXRlczogdHJ1ZSxcbiAgICAgICAgICAgICAgICAgIHByb3RvY29sczogJ3YyLHYzLG1peGVkJyxcbiAgICAgICAgICAgICAgICAgIGVuYWJsZVVuaXZlcnNhbFJvdXRlcjogdHJ1ZSxcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICBjb25zdCBxdWVyeVBhcmFtcyA9IHFzLnN0cmluZ2lmeShxdW90ZVJlcSlcblxuICAgICAgICAgICAgICAgIGNvbnN0IHJlc3BvbnNlOiBBeGlvc1Jlc3BvbnNlPFF1b3RlUmVzcG9uc2U+ID0gYXdhaXQgYXhpb3MuZ2V0PFF1b3RlUmVzcG9uc2U+KGAke0FQSX0/JHtxdWVyeVBhcmFtc31gKVxuICAgICAgICAgICAgICAgIGNvbnN0IHtcbiAgICAgICAgICAgICAgICAgIGRhdGE6IHsgcXVvdGVEZWNpbWFscywgcXVvdGVHYXNBZGp1c3RlZERlY2ltYWxzLCBtZXRob2RQYXJhbWV0ZXJzLCByb3V0ZVN0cmluZyB9LFxuICAgICAgICAgICAgICAgICAgc3RhdHVzLFxuICAgICAgICAgICAgICAgIH0gPSByZXNwb25zZVxuXG4gICAgICAgICAgICAgICAgZXhwZWN0KHN0YXR1cykudG8uZXF1YWwoMjAwKVxuXG4gICAgICAgICAgICAgICAgaWYgKHR5cGUgPT0gJ2V4YWN0SW4nKSB7XG4gICAgICAgICAgICAgICAgICBleHBlY3QocGFyc2VGbG9hdChxdW90ZUdhc0FkanVzdGVkRGVjaW1hbHMpKS50by5iZS5sZXNzVGhhbk9yRXF1YWwocGFyc2VGbG9hdChxdW90ZURlY2ltYWxzKSlcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgZXhwZWN0KHBhcnNlRmxvYXQocXVvdGVHYXNBZGp1c3RlZERlY2ltYWxzKSkudG8uYmUuZ3JlYXRlclRoYW5PckVxdWFsKHBhcnNlRmxvYXQocXVvdGVEZWNpbWFscykpXG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgZXhwZWN0KG1ldGhvZFBhcmFtZXRlcnMpLnRvLm5vdC5iZS51bmRlZmluZWRcblxuICAgICAgICAgICAgICAgIC8vLyBzaW5jZSB3ZSBvbmx5IGdldCB0aGUgcm91dGVTdHJpbmcgYmFjaywgd2UgY2FuIGNoZWNrIGlmIHRoZXJlJ3MgVjMgKyBWMlxuICAgICAgICAgICAgICAgIGV4cGVjdChyb3V0ZVN0cmluZy5pbmNsdWRlcygnW1YyICsgVjNdJykpXG4gICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICB9KVxuXG4gICAgICAgIGlmIChhbGdvcml0aG0gPT0gJ2FscGhhJykge1xuICAgICAgICAgIGRlc2NyaWJlKGArIFNpbXVsYXRlIFN3YXAgKyBFeGVjdXRlIFN3YXBgLCAoKSA9PiB7XG4gICAgICAgICAgICBpdChgZXJjMjAgLT4gZXJjMjBgLCBhc3luYyAoKSA9PiB7XG4gICAgICAgICAgICAgIGNvbnN0IHF1b3RlUmVxOiBRdW90ZVF1ZXJ5UGFyYW1zID0ge1xuICAgICAgICAgICAgICAgIHRva2VuSW5BZGRyZXNzOiAnVVNEQycsXG4gICAgICAgICAgICAgICAgdG9rZW5JbkNoYWluSWQ6IDEsXG4gICAgICAgICAgICAgICAgdG9rZW5PdXRBZGRyZXNzOiAnVVNEVCcsXG4gICAgICAgICAgICAgICAgdG9rZW5PdXRDaGFpbklkOiAxLFxuICAgICAgICAgICAgICAgIGFtb3VudDogYXdhaXQgZ2V0QW1vdW50KDEsIHR5cGUsICdVU0RDJywgJ1VTRFQnLCAnMTAwJyksXG4gICAgICAgICAgICAgICAgdHlwZSxcbiAgICAgICAgICAgICAgICByZWNpcGllbnQ6IGFsaWNlLmFkZHJlc3MsXG4gICAgICAgICAgICAgICAgc2xpcHBhZ2VUb2xlcmFuY2U6IFNMSVBQQUdFLFxuICAgICAgICAgICAgICAgIGRlYWRsaW5lOiAnMzYwJyxcbiAgICAgICAgICAgICAgICBhbGdvcml0aG0sXG4gICAgICAgICAgICAgICAgc2ltdWxhdGVGcm9tQWRkcmVzczogJzB4ZjU4NGY4NzI4Yjg3NGE2YTVjN2E4ZDRkMzg3YzlhYWU5MTcyZDYyMScsXG4gICAgICAgICAgICAgICAgZW5hYmxlVW5pdmVyc2FsUm91dGVyOiB0cnVlLFxuICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgY29uc3QgcXVlcnlQYXJhbXMgPSBxcy5zdHJpbmdpZnkocXVvdGVSZXEpXG5cbiAgICAgICAgICAgICAgY29uc3QgcmVzcG9uc2U6IEF4aW9zUmVzcG9uc2U8UXVvdGVSZXNwb25zZT4gPSBhd2FpdCBheGlvcy5nZXQ8UXVvdGVSZXNwb25zZT4oYCR7QVBJfT8ke3F1ZXJ5UGFyYW1zfWApXG4gICAgICAgICAgICAgIGNvbnN0IHtcbiAgICAgICAgICAgICAgICBkYXRhOiB7IHF1b3RlLCBxdW90ZURlY2ltYWxzLCBxdW90ZUdhc0FkanVzdGVkRGVjaW1hbHMsIG1ldGhvZFBhcmFtZXRlcnMsIHNpbXVsYXRpb25FcnJvciB9LFxuICAgICAgICAgICAgICAgIHN0YXR1cyxcbiAgICAgICAgICAgICAgfSA9IHJlc3BvbnNlXG5cbiAgICAgICAgICAgICAgZXhwZWN0KHN0YXR1cykudG8uZXF1YWwoMjAwKVxuICAgICAgICAgICAgICBleHBlY3Qoc2ltdWxhdGlvbkVycm9yKS50by5lcXVhbChmYWxzZSlcbiAgICAgICAgICAgICAgZXhwZWN0KHBhcnNlRmxvYXQocXVvdGVEZWNpbWFscykpLnRvLmJlLmdyZWF0ZXJUaGFuKDkwKVxuICAgICAgICAgICAgICBleHBlY3QocGFyc2VGbG9hdChxdW90ZURlY2ltYWxzKSkudG8uYmUubGVzc1RoYW4oMTEwKVxuXG4gICAgICAgICAgICAgIGlmICh0eXBlID09ICdleGFjdEluJykge1xuICAgICAgICAgICAgICAgIGV4cGVjdChwYXJzZUZsb2F0KHF1b3RlR2FzQWRqdXN0ZWREZWNpbWFscykpLnRvLmJlLmxlc3NUaGFuT3JFcXVhbChwYXJzZUZsb2F0KHF1b3RlRGVjaW1hbHMpKVxuICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIGV4cGVjdChwYXJzZUZsb2F0KHF1b3RlR2FzQWRqdXN0ZWREZWNpbWFscykpLnRvLmJlLmdyZWF0ZXJUaGFuT3JFcXVhbChwYXJzZUZsb2F0KHF1b3RlRGVjaW1hbHMpKVxuICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgZXhwZWN0KG1ldGhvZFBhcmFtZXRlcnMpLnRvLm5vdC5iZS51bmRlZmluZWRcblxuICAgICAgICAgICAgICBjb25zdCB7IHRva2VuSW5CZWZvcmUsIHRva2VuSW5BZnRlciwgdG9rZW5PdXRCZWZvcmUsIHRva2VuT3V0QWZ0ZXIgfSA9IGF3YWl0IGV4ZWN1dGVTd2FwKFxuICAgICAgICAgICAgICAgIG1ldGhvZFBhcmFtZXRlcnMhLFxuICAgICAgICAgICAgICAgIFVTRENfTUFJTk5FVCxcbiAgICAgICAgICAgICAgICBVU0RUX01BSU5ORVRcbiAgICAgICAgICAgICAgKVxuXG4gICAgICAgICAgICAgIGlmICh0eXBlID09ICdleGFjdEluJykge1xuICAgICAgICAgICAgICAgIGV4cGVjdCh0b2tlbkluQmVmb3JlLnN1YnRyYWN0KHRva2VuSW5BZnRlcikudG9FeGFjdCgpKS50by5lcXVhbCgnMTAwJylcbiAgICAgICAgICAgICAgICBjaGVja1F1b3RlVG9rZW4odG9rZW5PdXRCZWZvcmUsIHRva2VuT3V0QWZ0ZXIsIEN1cnJlbmN5QW1vdW50LmZyb21SYXdBbW91bnQoVVNEVF9NQUlOTkVULCBxdW90ZSkpXG4gICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgZXhwZWN0KHRva2VuT3V0QWZ0ZXIuc3VidHJhY3QodG9rZW5PdXRCZWZvcmUpLnRvRXhhY3QoKSkudG8uZXF1YWwoJzEwMCcpXG4gICAgICAgICAgICAgICAgY2hlY2tRdW90ZVRva2VuKHRva2VuSW5CZWZvcmUsIHRva2VuSW5BZnRlciwgQ3VycmVuY3lBbW91bnQuZnJvbVJhd0Ftb3VudChVU0RDX01BSU5ORVQsIHF1b3RlKSlcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSlcblxuICAgICAgICAgICAgaXQoYGVyYzIwIC0+IGVyYzIwIHN3YXByb3V0ZXIwMmAsIGFzeW5jICgpID0+IHtcbiAgICAgICAgICAgICAgY29uc3QgcXVvdGVSZXE6IFF1b3RlUXVlcnlQYXJhbXMgPSB7XG4gICAgICAgICAgICAgICAgdG9rZW5JbkFkZHJlc3M6ICdVU0RDJyxcbiAgICAgICAgICAgICAgICB0b2tlbkluQ2hhaW5JZDogMSxcbiAgICAgICAgICAgICAgICB0b2tlbk91dEFkZHJlc3M6ICdVU0RUJyxcbiAgICAgICAgICAgICAgICB0b2tlbk91dENoYWluSWQ6IDEsXG4gICAgICAgICAgICAgICAgYW1vdW50OiBhd2FpdCBnZXRBbW91bnQoMSwgdHlwZSwgJ1VTREMnLCAnVVNEVCcsICcxMDAnKSxcbiAgICAgICAgICAgICAgICB0eXBlLFxuICAgICAgICAgICAgICAgIHJlY2lwaWVudDogYWxpY2UuYWRkcmVzcyxcbiAgICAgICAgICAgICAgICBzbGlwcGFnZVRvbGVyYW5jZTogU0xJUFBBR0UsXG4gICAgICAgICAgICAgICAgZGVhZGxpbmU6ICczNjAnLFxuICAgICAgICAgICAgICAgIGFsZ29yaXRobSxcbiAgICAgICAgICAgICAgICBzaW11bGF0ZUZyb21BZGRyZXNzOiAnMHhmNTg0Zjg3MjhiODc0YTZhNWM3YThkNGQzODdjOWFhZTkxNzJkNjIxJyxcbiAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgIGNvbnN0IHF1ZXJ5UGFyYW1zID0gcXMuc3RyaW5naWZ5KHF1b3RlUmVxKVxuXG4gICAgICAgICAgICAgIGNvbnN0IHJlc3BvbnNlOiBBeGlvc1Jlc3BvbnNlPFF1b3RlUmVzcG9uc2U+ID0gYXdhaXQgYXhpb3MuZ2V0PFF1b3RlUmVzcG9uc2U+KGAke0FQSX0/JHtxdWVyeVBhcmFtc31gKVxuICAgICAgICAgICAgICBjb25zdCB7XG4gICAgICAgICAgICAgICAgZGF0YTogeyBxdW90ZSwgcXVvdGVEZWNpbWFscywgcXVvdGVHYXNBZGp1c3RlZERlY2ltYWxzLCBtZXRob2RQYXJhbWV0ZXJzLCBzaW11bGF0aW9uRXJyb3IgfSxcbiAgICAgICAgICAgICAgICBzdGF0dXMsXG4gICAgICAgICAgICAgIH0gPSByZXNwb25zZVxuXG4gICAgICAgICAgICAgIGV4cGVjdChzdGF0dXMpLnRvLmVxdWFsKDIwMClcbiAgICAgICAgICAgICAgZXhwZWN0KHNpbXVsYXRpb25FcnJvcikudG8uZXF1YWwoZmFsc2UpXG4gICAgICAgICAgICAgIGV4cGVjdChwYXJzZUZsb2F0KHF1b3RlRGVjaW1hbHMpKS50by5iZS5ncmVhdGVyVGhhbig5MClcbiAgICAgICAgICAgICAgZXhwZWN0KHBhcnNlRmxvYXQocXVvdGVEZWNpbWFscykpLnRvLmJlLmxlc3NUaGFuKDExMClcblxuICAgICAgICAgICAgICBpZiAodHlwZSA9PSAnZXhhY3RJbicpIHtcbiAgICAgICAgICAgICAgICBleHBlY3QocGFyc2VGbG9hdChxdW90ZUdhc0FkanVzdGVkRGVjaW1hbHMpKS50by5iZS5sZXNzVGhhbk9yRXF1YWwocGFyc2VGbG9hdChxdW90ZURlY2ltYWxzKSlcbiAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBleHBlY3QocGFyc2VGbG9hdChxdW90ZUdhc0FkanVzdGVkRGVjaW1hbHMpKS50by5iZS5ncmVhdGVyVGhhbk9yRXF1YWwocGFyc2VGbG9hdChxdW90ZURlY2ltYWxzKSlcbiAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgIGV4cGVjdChtZXRob2RQYXJhbWV0ZXJzKS50by5ub3QuYmUudW5kZWZpbmVkXG4gICAgICAgICAgICAgIGV4cGVjdChtZXRob2RQYXJhbWV0ZXJzIS50bykudG8uZXF1YWwoU1dBUF9ST1VURVJfMDJfQUREUkVTU0VTKENoYWluSWQuTUFJTk5FVCkpXG5cbiAgICAgICAgICAgICAgY29uc3QgeyB0b2tlbkluQmVmb3JlLCB0b2tlbkluQWZ0ZXIsIHRva2VuT3V0QmVmb3JlLCB0b2tlbk91dEFmdGVyIH0gPSBhd2FpdCBleGVjdXRlU3dhcChcbiAgICAgICAgICAgICAgICBtZXRob2RQYXJhbWV0ZXJzISxcbiAgICAgICAgICAgICAgICBVU0RDX01BSU5ORVQsXG4gICAgICAgICAgICAgICAgVVNEVF9NQUlOTkVUXG4gICAgICAgICAgICAgIClcblxuICAgICAgICAgICAgICBpZiAodHlwZSA9PSAnZXhhY3RJbicpIHtcbiAgICAgICAgICAgICAgICBleHBlY3QodG9rZW5JbkJlZm9yZS5zdWJ0cmFjdCh0b2tlbkluQWZ0ZXIpLnRvRXhhY3QoKSkudG8uZXF1YWwoJzEwMCcpXG4gICAgICAgICAgICAgICAgY2hlY2tRdW90ZVRva2VuKHRva2VuT3V0QmVmb3JlLCB0b2tlbk91dEFmdGVyLCBDdXJyZW5jeUFtb3VudC5mcm9tUmF3QW1vdW50KFVTRFRfTUFJTk5FVCwgcXVvdGUpKVxuICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIGV4cGVjdCh0b2tlbk91dEFmdGVyLnN1YnRyYWN0KHRva2VuT3V0QmVmb3JlKS50b0V4YWN0KCkpLnRvLmVxdWFsKCcxMDAnKVxuICAgICAgICAgICAgICAgIGNoZWNrUXVvdGVUb2tlbih0b2tlbkluQmVmb3JlLCB0b2tlbkluQWZ0ZXIsIEN1cnJlbmN5QW1vdW50LmZyb21SYXdBbW91bnQoVVNEQ19NQUlOTkVULCBxdW90ZSkpXG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pXG5cbiAgICAgICAgICAgIGlmIChpc1Rlc3RlclBLRW52aXJvbm1lbnRTZXQoKSkge1xuICAgICAgICAgICAgICBpdChgZXJjMjAgLT4gZXJjMjAgd2l0aCBwZXJtaXQgd2l0aCB0ZXN0ZXIgcGtgLCBhc3luYyAoKSA9PiB7XG4gICAgICAgICAgICAgICAgLy8gVGhpcyB0ZXN0IHJlcXVpcmVzIGEgcHJpdmF0ZSBrZXkgd2l0aCBhdCBsZWFzdCAxMCBVU0RDXG4gICAgICAgICAgICAgICAgLy8gYXQgRk9SS19CTE9DSyB0aW1lLlxuICAgICAgICAgICAgICAgIGNvbnN0IGFtb3VudCA9IGF3YWl0IGdldEFtb3VudCgxLCB0eXBlLCAnVVNEQycsICdVU0RUJywgJzEwJylcblxuICAgICAgICAgICAgICAgIGNvbnN0IG5vbmNlID0gJzAnXG5cbiAgICAgICAgICAgICAgICBjb25zdCBwZXJtaXQ6IFBlcm1pdFNpbmdsZSA9IHtcbiAgICAgICAgICAgICAgICAgIGRldGFpbHM6IHtcbiAgICAgICAgICAgICAgICAgICAgdG9rZW46IFVTRENfTUFJTk5FVC5hZGRyZXNzLFxuICAgICAgICAgICAgICAgICAgICBhbW91bnQ6IGFtb3VudCxcbiAgICAgICAgICAgICAgICAgICAgZXhwaXJhdGlvbjogTWF0aC5mbG9vcihuZXcgRGF0ZSgpLmdldFRpbWUoKSAvIDEwMDAgKyAxMDAwMDAwMCkudG9TdHJpbmcoKSxcbiAgICAgICAgICAgICAgICAgICAgbm9uY2UsXG4gICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgc3BlbmRlcjogVU5JVkVSU0FMX1JPVVRFUl9BRERSRVNTLFxuICAgICAgICAgICAgICAgICAgc2lnRGVhZGxpbmU6IE1hdGguZmxvb3IobmV3IERhdGUoKS5nZXRUaW1lKCkgLyAxMDAwICsgMTAwMDAwMDApLnRvU3RyaW5nKCksXG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgY29uc3Qgd2FsbGV0ID0gbmV3IFdhbGxldChwcm9jZXNzLmVudi5URVNURVJfUEshKVxuXG4gICAgICAgICAgICAgICAgY29uc3QgeyBkb21haW4sIHR5cGVzLCB2YWx1ZXMgfSA9IEFsbG93YW5jZVRyYW5zZmVyLmdldFBlcm1pdERhdGEocGVybWl0LCBQRVJNSVQyX0FERFJFU1MsIDEpXG5cbiAgICAgICAgICAgICAgICBjb25zdCBzaWduYXR1cmUgPSBhd2FpdCB3YWxsZXQuX3NpZ25UeXBlZERhdGEoZG9tYWluLCB0eXBlcywgdmFsdWVzKVxuXG4gICAgICAgICAgICAgICAgY29uc3QgcXVvdGVSZXE6IFF1b3RlUXVlcnlQYXJhbXMgPSB7XG4gICAgICAgICAgICAgICAgICB0b2tlbkluQWRkcmVzczogJ1VTREMnLFxuICAgICAgICAgICAgICAgICAgdG9rZW5JbkNoYWluSWQ6IDEsXG4gICAgICAgICAgICAgICAgICB0b2tlbk91dEFkZHJlc3M6ICdVU0RUJyxcbiAgICAgICAgICAgICAgICAgIHRva2VuT3V0Q2hhaW5JZDogMSxcbiAgICAgICAgICAgICAgICAgIGFtb3VudCxcbiAgICAgICAgICAgICAgICAgIHR5cGUsXG4gICAgICAgICAgICAgICAgICByZWNpcGllbnQ6IHdhbGxldC5hZGRyZXNzLFxuICAgICAgICAgICAgICAgICAgc2xpcHBhZ2VUb2xlcmFuY2U6IFNMSVBQQUdFLFxuICAgICAgICAgICAgICAgICAgZGVhZGxpbmU6ICczNjAnLFxuICAgICAgICAgICAgICAgICAgYWxnb3JpdGhtLFxuICAgICAgICAgICAgICAgICAgc2ltdWxhdGVGcm9tQWRkcmVzczogd2FsbGV0LmFkZHJlc3MsXG4gICAgICAgICAgICAgICAgICBwZXJtaXRTaWduYXR1cmU6IHNpZ25hdHVyZSxcbiAgICAgICAgICAgICAgICAgIHBlcm1pdEFtb3VudDogcGVybWl0LmRldGFpbHMuYW1vdW50LnRvU3RyaW5nKCksXG4gICAgICAgICAgICAgICAgICBwZXJtaXRFeHBpcmF0aW9uOiBwZXJtaXQuZGV0YWlscy5leHBpcmF0aW9uLnRvU3RyaW5nKCksXG4gICAgICAgICAgICAgICAgICBwZXJtaXRTaWdEZWFkbGluZTogcGVybWl0LnNpZ0RlYWRsaW5lLnRvU3RyaW5nKCksXG4gICAgICAgICAgICAgICAgICBwZXJtaXROb25jZTogcGVybWl0LmRldGFpbHMubm9uY2UudG9TdHJpbmcoKSxcbiAgICAgICAgICAgICAgICAgIGVuYWJsZVVuaXZlcnNhbFJvdXRlcjogdHJ1ZSxcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICBjb25zdCBxdWVyeVBhcmFtcyA9IHFzLnN0cmluZ2lmeShxdW90ZVJlcSlcblxuICAgICAgICAgICAgICAgIGNvbnN0IHJlc3BvbnNlOiBBeGlvc1Jlc3BvbnNlPFF1b3RlUmVzcG9uc2U+ID0gYXdhaXQgYXhpb3MuZ2V0PFF1b3RlUmVzcG9uc2U+KGAke0FQSX0/JHtxdWVyeVBhcmFtc31gKVxuICAgICAgICAgICAgICAgIGNvbnN0IHtcbiAgICAgICAgICAgICAgICAgIGRhdGE6IHsgcXVvdGVEZWNpbWFscywgcXVvdGVHYXNBZGp1c3RlZERlY2ltYWxzLCBtZXRob2RQYXJhbWV0ZXJzLCBzaW11bGF0aW9uRXJyb3IgfSxcbiAgICAgICAgICAgICAgICAgIHN0YXR1cyxcbiAgICAgICAgICAgICAgICB9ID0gcmVzcG9uc2VcbiAgICAgICAgICAgICAgICBleHBlY3Qoc3RhdHVzKS50by5lcXVhbCgyMDApXG5cbiAgICAgICAgICAgICAgICBleHBlY3Qoc2ltdWxhdGlvbkVycm9yKS50by5lcXVhbChmYWxzZSlcblxuICAgICAgICAgICAgICAgIGV4cGVjdChwYXJzZUZsb2F0KHF1b3RlRGVjaW1hbHMpKS50by5iZS5ncmVhdGVyVGhhbig5KVxuICAgICAgICAgICAgICAgIGV4cGVjdChwYXJzZUZsb2F0KHF1b3RlRGVjaW1hbHMpKS50by5iZS5sZXNzVGhhbigxMSlcblxuICAgICAgICAgICAgICAgIGlmICh0eXBlID09ICdleGFjdEluJykge1xuICAgICAgICAgICAgICAgICAgZXhwZWN0KHBhcnNlRmxvYXQocXVvdGVHYXNBZGp1c3RlZERlY2ltYWxzKSkudG8uYmUubGVzc1RoYW5PckVxdWFsKHBhcnNlRmxvYXQocXVvdGVEZWNpbWFscykpXG4gICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgIGV4cGVjdChwYXJzZUZsb2F0KHF1b3RlR2FzQWRqdXN0ZWREZWNpbWFscykpLnRvLmJlLmdyZWF0ZXJUaGFuT3JFcXVhbChwYXJzZUZsb2F0KHF1b3RlRGVjaW1hbHMpKVxuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIGV4cGVjdChtZXRob2RQYXJhbWV0ZXJzKS50by5ub3QuYmUudW5kZWZpbmVkXG4gICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGl0KGBlcmMyMCAtPiBldGhgLCBhc3luYyAoKSA9PiB7XG4gICAgICAgICAgICAgIGNvbnN0IHF1b3RlUmVxOiBRdW90ZVF1ZXJ5UGFyYW1zID0ge1xuICAgICAgICAgICAgICAgIHRva2VuSW5BZGRyZXNzOiAnVVNEQycsXG4gICAgICAgICAgICAgICAgdG9rZW5JbkNoYWluSWQ6IDEsXG4gICAgICAgICAgICAgICAgdG9rZW5PdXRBZGRyZXNzOiAnRVRIJyxcbiAgICAgICAgICAgICAgICB0b2tlbk91dENoYWluSWQ6IDEsXG4gICAgICAgICAgICAgICAgYW1vdW50OiBhd2FpdCBnZXRBbW91bnQoMSwgdHlwZSwgJ1VTREMnLCAnRVRIJywgdHlwZSA9PSAnZXhhY3RJbicgPyAnMTAwMDAwMCcgOiAnMTAnKSxcbiAgICAgICAgICAgICAgICB0eXBlLFxuICAgICAgICAgICAgICAgIHJlY2lwaWVudDogYWxpY2UuYWRkcmVzcyxcbiAgICAgICAgICAgICAgICBzbGlwcGFnZVRvbGVyYW5jZTogU0xJUFBBR0UsXG4gICAgICAgICAgICAgICAgZGVhZGxpbmU6ICczNjAnLFxuICAgICAgICAgICAgICAgIGFsZ29yaXRobSxcbiAgICAgICAgICAgICAgICBzaW11bGF0ZUZyb21BZGRyZXNzOiAnMHhmNTg0Zjg3MjhiODc0YTZhNWM3YThkNGQzODdjOWFhZTkxNzJkNjIxJyxcbiAgICAgICAgICAgICAgICBlbmFibGVVbml2ZXJzYWxSb3V0ZXI6IHRydWUsXG4gICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICBjb25zdCBxdWVyeVBhcmFtcyA9IHFzLnN0cmluZ2lmeShxdW90ZVJlcSlcblxuICAgICAgICAgICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGF4aW9zLmdldDxRdW90ZVJlc3BvbnNlPihgJHtBUEl9PyR7cXVlcnlQYXJhbXN9YClcbiAgICAgICAgICAgICAgY29uc3Qge1xuICAgICAgICAgICAgICAgIGRhdGE6IHsgcXVvdGUsIG1ldGhvZFBhcmFtZXRlcnMsIHNpbXVsYXRpb25FcnJvciB9LFxuICAgICAgICAgICAgICAgIHN0YXR1cyxcbiAgICAgICAgICAgICAgfSA9IHJlc3BvbnNlXG5cbiAgICAgICAgICAgICAgZXhwZWN0KHN0YXR1cykudG8uZXF1YWwoMjAwKVxuICAgICAgICAgICAgICBleHBlY3Qoc2ltdWxhdGlvbkVycm9yKS50by5lcXVhbChmYWxzZSlcbiAgICAgICAgICAgICAgZXhwZWN0KG1ldGhvZFBhcmFtZXRlcnMpLnRvLm5vdC5iZS51bmRlZmluZWRcblxuICAgICAgICAgICAgICBjb25zdCB7IHRva2VuSW5CZWZvcmUsIHRva2VuSW5BZnRlciwgdG9rZW5PdXRCZWZvcmUsIHRva2VuT3V0QWZ0ZXIgfSA9IGF3YWl0IGV4ZWN1dGVTd2FwKFxuICAgICAgICAgICAgICAgIG1ldGhvZFBhcmFtZXRlcnMhLFxuICAgICAgICAgICAgICAgIFVTRENfTUFJTk5FVCxcbiAgICAgICAgICAgICAgICBFdGhlci5vbkNoYWluKDEpXG4gICAgICAgICAgICAgIClcblxuICAgICAgICAgICAgICBpZiAodHlwZSA9PSAnZXhhY3RJbicpIHtcbiAgICAgICAgICAgICAgICBleHBlY3QodG9rZW5JbkJlZm9yZS5zdWJ0cmFjdCh0b2tlbkluQWZ0ZXIpLnRvRXhhY3QoKSkudG8uZXF1YWwoJzEwMDAwMDAnKVxuICAgICAgICAgICAgICAgIGNoZWNrUXVvdGVUb2tlbih0b2tlbk91dEJlZm9yZSwgdG9rZW5PdXRBZnRlciwgQ3VycmVuY3lBbW91bnQuZnJvbVJhd0Ftb3VudChFdGhlci5vbkNoYWluKDEpLCBxdW90ZSkpXG4gICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgLy8gSGFyZCB0byB0ZXN0IEVUSCBiYWxhbmNlIGR1ZSB0byBnYXMgY29zdHMgZm9yIGFwcHJvdmFsIGFuZCBzd2FwLiBKdXN0IGNoZWNrIHRva2VuSW4gY2hhbmdlc1xuICAgICAgICAgICAgICAgIGNoZWNrUXVvdGVUb2tlbih0b2tlbkluQmVmb3JlLCB0b2tlbkluQWZ0ZXIsIEN1cnJlbmN5QW1vdW50LmZyb21SYXdBbW91bnQoVVNEQ19NQUlOTkVULCBxdW90ZSkpXG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pXG5cbiAgICAgICAgICAgIGl0KGBlcmMyMCAtPiBldGggbGFyZ2UgdHJhZGVgLCBhc3luYyAoKSA9PiB7XG4gICAgICAgICAgICAgIC8vIFRyYWRlIG9mIHRoaXMgc2l6ZSBhbG1vc3QgYWx3YXlzIHJlc3VsdHMgaW4gc3BsaXRzLlxuICAgICAgICAgICAgICBjb25zdCBxdW90ZVJlcTogUXVvdGVRdWVyeVBhcmFtcyA9IHtcbiAgICAgICAgICAgICAgICB0b2tlbkluQWRkcmVzczogJ1VTREMnLFxuICAgICAgICAgICAgICAgIHRva2VuSW5DaGFpbklkOiAxLFxuICAgICAgICAgICAgICAgIHRva2VuT3V0QWRkcmVzczogJ0VUSCcsXG4gICAgICAgICAgICAgICAgdG9rZW5PdXRDaGFpbklkOiAxLFxuICAgICAgICAgICAgICAgIGFtb3VudDpcbiAgICAgICAgICAgICAgICAgIHR5cGUgPT0gJ2V4YWN0SW4nXG4gICAgICAgICAgICAgICAgICAgID8gYXdhaXQgZ2V0QW1vdW50KDEsIHR5cGUsICdVU0RDJywgJ0VUSCcsICcxMDAwMDAwJylcbiAgICAgICAgICAgICAgICAgICAgOiBhd2FpdCBnZXRBbW91bnQoMSwgdHlwZSwgJ1VTREMnLCAnRVRIJywgJzEwMCcpLFxuICAgICAgICAgICAgICAgIHR5cGUsXG4gICAgICAgICAgICAgICAgcmVjaXBpZW50OiBhbGljZS5hZGRyZXNzLFxuICAgICAgICAgICAgICAgIHNsaXBwYWdlVG9sZXJhbmNlOiBTTElQUEFHRSxcbiAgICAgICAgICAgICAgICBkZWFkbGluZTogJzM2MCcsXG4gICAgICAgICAgICAgICAgYWxnb3JpdGhtLFxuICAgICAgICAgICAgICAgIHNpbXVsYXRlRnJvbUFkZHJlc3M6ICcweGY1ODRmODcyOGI4NzRhNmE1YzdhOGQ0ZDM4N2M5YWFlOTE3MmQ2MjEnLFxuICAgICAgICAgICAgICAgIGVuYWJsZVVuaXZlcnNhbFJvdXRlcjogdHJ1ZSxcbiAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgIGNvbnN0IHF1ZXJ5UGFyYW1zID0gcXMuc3RyaW5naWZ5KHF1b3RlUmVxKVxuXG4gICAgICAgICAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgYXhpb3MuZ2V0PFF1b3RlUmVzcG9uc2U+KGAke0FQSX0/JHtxdWVyeVBhcmFtc31gKVxuICAgICAgICAgICAgICBjb25zdCB7IGRhdGEsIHN0YXR1cyB9ID0gcmVzcG9uc2VcblxuICAgICAgICAgICAgICBleHBlY3Qoc3RhdHVzKS50by5lcXVhbCgyMDApXG4gICAgICAgICAgICAgIGV4cGVjdChkYXRhLnNpbXVsYXRpb25FcnJvcikudG8uZXF1YWwoZmFsc2UpXG4gICAgICAgICAgICAgIGV4cGVjdChkYXRhLm1ldGhvZFBhcmFtZXRlcnMpLnRvLm5vdC5iZS51bmRlZmluZWRcblxuICAgICAgICAgICAgICBleHBlY3QoZGF0YS5yb3V0ZSkudG8ubm90LmJlLnVuZGVmaW5lZFxuXG4gICAgICAgICAgICAgIGNvbnN0IGFtb3VudEluRWRnZXNUb3RhbCA9IF8oZGF0YS5yb3V0ZSlcbiAgICAgICAgICAgICAgICAuZmxhdE1hcCgocm91dGUpID0+IHJvdXRlWzBdISlcbiAgICAgICAgICAgICAgICAuZmlsdGVyKChwb29sKSA9PiAhIXBvb2wuYW1vdW50SW4pXG4gICAgICAgICAgICAgICAgLm1hcCgocG9vbCkgPT4gQmlnTnVtYmVyLmZyb20ocG9vbC5hbW91bnRJbikpXG4gICAgICAgICAgICAgICAgLnJlZHVjZSgoY3VyLCB0b3RhbCkgPT4gdG90YWwuYWRkKGN1ciksIEJpZ051bWJlci5mcm9tKDApKVxuICAgICAgICAgICAgICBjb25zdCBhbW91bnRJbiA9IEJpZ051bWJlci5mcm9tKGRhdGEucXVvdGUpXG4gICAgICAgICAgICAgIGV4cGVjdChhbW91bnRJbi5lcShhbW91bnRJbkVkZ2VzVG90YWwpKVxuXG4gICAgICAgICAgICAgIGNvbnN0IGFtb3VudE91dEVkZ2VzVG90YWwgPSBfKGRhdGEucm91dGUpXG4gICAgICAgICAgICAgICAgLmZsYXRNYXAoKHJvdXRlKSA9PiByb3V0ZVswXSEpXG4gICAgICAgICAgICAgICAgLmZpbHRlcigocG9vbCkgPT4gISFwb29sLmFtb3VudE91dClcbiAgICAgICAgICAgICAgICAubWFwKChwb29sKSA9PiBCaWdOdW1iZXIuZnJvbShwb29sLmFtb3VudE91dCkpXG4gICAgICAgICAgICAgICAgLnJlZHVjZSgoY3VyLCB0b3RhbCkgPT4gdG90YWwuYWRkKGN1ciksIEJpZ051bWJlci5mcm9tKDApKVxuICAgICAgICAgICAgICBjb25zdCBhbW91bnRPdXQgPSBCaWdOdW1iZXIuZnJvbShkYXRhLnF1b3RlKVxuICAgICAgICAgICAgICBleHBlY3QoYW1vdW50T3V0LmVxKGFtb3VudE91dEVkZ2VzVG90YWwpKVxuXG4gICAgICAgICAgICAgIGNvbnN0IHsgdG9rZW5JbkJlZm9yZSwgdG9rZW5JbkFmdGVyLCB0b2tlbk91dEJlZm9yZSwgdG9rZW5PdXRBZnRlciB9ID0gYXdhaXQgZXhlY3V0ZVN3YXAoXG4gICAgICAgICAgICAgICAgZGF0YS5tZXRob2RQYXJhbWV0ZXJzISxcbiAgICAgICAgICAgICAgICBVU0RDX01BSU5ORVQsXG4gICAgICAgICAgICAgICAgRXRoZXIub25DaGFpbigxKVxuICAgICAgICAgICAgICApXG5cbiAgICAgICAgICAgICAgaWYgKHR5cGUgPT0gJ2V4YWN0SW4nKSB7XG4gICAgICAgICAgICAgICAgZXhwZWN0KHRva2VuSW5CZWZvcmUuc3VidHJhY3QodG9rZW5JbkFmdGVyKS50b0V4YWN0KCkpLnRvLmVxdWFsKCcxMDAwMDAwJylcbiAgICAgICAgICAgICAgICBjaGVja1F1b3RlVG9rZW4oXG4gICAgICAgICAgICAgICAgICB0b2tlbk91dEJlZm9yZSxcbiAgICAgICAgICAgICAgICAgIHRva2VuT3V0QWZ0ZXIsXG4gICAgICAgICAgICAgICAgICBDdXJyZW5jeUFtb3VudC5mcm9tUmF3QW1vdW50KEV0aGVyLm9uQ2hhaW4oMSksIGRhdGEucXVvdGUpXG4gICAgICAgICAgICAgICAgKVxuICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIC8vIEhhcmQgdG8gdGVzdCBFVEggYmFsYW5jZSBkdWUgdG8gZ2FzIGNvc3RzIGZvciBhcHByb3ZhbCBhbmQgc3dhcC4gSnVzdCBjaGVjayB0b2tlbkluIGNoYW5nZXNcbiAgICAgICAgICAgICAgICBjaGVja1F1b3RlVG9rZW4odG9rZW5JbkJlZm9yZSwgdG9rZW5JbkFmdGVyLCBDdXJyZW5jeUFtb3VudC5mcm9tUmF3QW1vdW50KFVTRENfTUFJTk5FVCwgZGF0YS5xdW90ZSkpXG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pXG5cbiAgICAgICAgICAgIGl0KGBldGggLT4gZXJjMjBgLCBhc3luYyAoKSA9PiB7XG4gICAgICAgICAgICAgIGNvbnN0IHF1b3RlUmVxOiBRdW90ZVF1ZXJ5UGFyYW1zID0ge1xuICAgICAgICAgICAgICAgIHRva2VuSW5BZGRyZXNzOiAnRVRIJyxcbiAgICAgICAgICAgICAgICB0b2tlbkluQ2hhaW5JZDogMSxcbiAgICAgICAgICAgICAgICB0b2tlbk91dEFkZHJlc3M6ICdVTkknLFxuICAgICAgICAgICAgICAgIHRva2VuT3V0Q2hhaW5JZDogMSxcbiAgICAgICAgICAgICAgICBhbW91bnQ6XG4gICAgICAgICAgICAgICAgICB0eXBlID09ICdleGFjdEluJ1xuICAgICAgICAgICAgICAgICAgICA/IGF3YWl0IGdldEFtb3VudCgxLCB0eXBlLCAnRVRIJywgJ1VOSScsICcxMCcpXG4gICAgICAgICAgICAgICAgICAgIDogYXdhaXQgZ2V0QW1vdW50KDEsIHR5cGUsICdFVEgnLCAnVU5JJywgJzEwMDAwJyksXG4gICAgICAgICAgICAgICAgdHlwZSxcbiAgICAgICAgICAgICAgICByZWNpcGllbnQ6IGFsaWNlLmFkZHJlc3MsXG4gICAgICAgICAgICAgICAgc2xpcHBhZ2VUb2xlcmFuY2U6IFNMSVBQQUdFLFxuICAgICAgICAgICAgICAgIGRlYWRsaW5lOiAnMzYwJyxcbiAgICAgICAgICAgICAgICBhbGdvcml0aG0sXG4gICAgICAgICAgICAgICAgc2ltdWxhdGVGcm9tQWRkcmVzczogJzB4MDcxNmExN0ZCQWVFNzE0ZjFFNmFCMGY5ZDU5ZWRiQzVmMDk4MTVDMCcsXG4gICAgICAgICAgICAgICAgZW5hYmxlVW5pdmVyc2FsUm91dGVyOiB0cnVlLFxuICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgY29uc3QgcXVlcnlQYXJhbXMgPSBxcy5zdHJpbmdpZnkocXVvdGVSZXEpXG5cbiAgICAgICAgICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBheGlvcy5nZXQ8UXVvdGVSZXNwb25zZT4oYCR7QVBJfT8ke3F1ZXJ5UGFyYW1zfWApXG4gICAgICAgICAgICAgIGNvbnN0IHsgZGF0YSwgc3RhdHVzIH0gPSByZXNwb25zZVxuICAgICAgICAgICAgICBleHBlY3Qoc3RhdHVzKS50by5lcXVhbCgyMDApXG4gICAgICAgICAgICAgIGV4cGVjdChkYXRhLnNpbXVsYXRpb25FcnJvcikudG8uZXF1YWwoZmFsc2UpXG4gICAgICAgICAgICAgIGV4cGVjdChkYXRhLm1ldGhvZFBhcmFtZXRlcnMpLnRvLm5vdC5iZS51bmRlZmluZWRcblxuICAgICAgICAgICAgICBjb25zdCB7IHRva2VuSW5CZWZvcmUsIHRva2VuSW5BZnRlciwgdG9rZW5PdXRCZWZvcmUsIHRva2VuT3V0QWZ0ZXIgfSA9IGF3YWl0IGV4ZWN1dGVTd2FwKFxuICAgICAgICAgICAgICAgIGRhdGEubWV0aG9kUGFyYW1ldGVycyEsXG4gICAgICAgICAgICAgICAgRXRoZXIub25DaGFpbigxKSxcbiAgICAgICAgICAgICAgICBVTklfTUFJTk5FVFxuICAgICAgICAgICAgICApXG5cbiAgICAgICAgICAgICAgaWYgKHR5cGUgPT0gJ2V4YWN0SW4nKSB7XG4gICAgICAgICAgICAgICAgLy8gV2UndmUgc3dhcHBlZCAxMCBFVEggKyBnYXMgY29zdHNcbiAgICAgICAgICAgICAgICBleHBlY3QodG9rZW5JbkJlZm9yZS5zdWJ0cmFjdCh0b2tlbkluQWZ0ZXIpLmdyZWF0ZXJUaGFuKHBhcnNlQW1vdW50KCcxMCcsIEV0aGVyLm9uQ2hhaW4oMSkpKSkudG8uYmUudHJ1ZVxuICAgICAgICAgICAgICAgIGNoZWNrUXVvdGVUb2tlbih0b2tlbk91dEJlZm9yZSwgdG9rZW5PdXRBZnRlciwgQ3VycmVuY3lBbW91bnQuZnJvbVJhd0Ftb3VudChVTklfTUFJTk5FVCwgZGF0YS5xdW90ZSkpXG4gICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgZXhwZWN0KHRva2VuT3V0QWZ0ZXIuc3VidHJhY3QodG9rZW5PdXRCZWZvcmUpLnRvRXhhY3QoKSkudG8uZXF1YWwoJzEwMDAwJylcbiAgICAgICAgICAgICAgICAvLyBDYW4ndCBlYXNpbHkgY2hlY2sgc2xpcHBhZ2UgZm9yIEVUSCBkdWUgdG8gZ2FzIGNvc3RzIGVmZmVjdGluZyBFVEggYmFsYW5jZS5cbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSlcblxuICAgICAgICAgICAgaXQoYGV0aCAtPiBlcmMyMCBzd2Fwcm91dGVyMDJgLCBhc3luYyAoKSA9PiB7XG4gICAgICAgICAgICAgIGNvbnN0IHF1b3RlUmVxOiBRdW90ZVF1ZXJ5UGFyYW1zID0ge1xuICAgICAgICAgICAgICAgIHRva2VuSW5BZGRyZXNzOiAnRVRIJyxcbiAgICAgICAgICAgICAgICB0b2tlbkluQ2hhaW5JZDogMSxcbiAgICAgICAgICAgICAgICB0b2tlbk91dEFkZHJlc3M6ICdVTkknLFxuICAgICAgICAgICAgICAgIHRva2VuT3V0Q2hhaW5JZDogMSxcbiAgICAgICAgICAgICAgICBhbW91bnQ6XG4gICAgICAgICAgICAgICAgICB0eXBlID09ICdleGFjdEluJ1xuICAgICAgICAgICAgICAgICAgICA/IGF3YWl0IGdldEFtb3VudCgxLCB0eXBlLCAnRVRIJywgJ1VOSScsICcxMCcpXG4gICAgICAgICAgICAgICAgICAgIDogYXdhaXQgZ2V0QW1vdW50KDEsIHR5cGUsICdFVEgnLCAnVU5JJywgJzEwMDAwJyksXG4gICAgICAgICAgICAgICAgdHlwZSxcbiAgICAgICAgICAgICAgICByZWNpcGllbnQ6IGFsaWNlLmFkZHJlc3MsXG4gICAgICAgICAgICAgICAgc2xpcHBhZ2VUb2xlcmFuY2U6IFNMSVBQQUdFLFxuICAgICAgICAgICAgICAgIGRlYWRsaW5lOiAnMzYwJyxcbiAgICAgICAgICAgICAgICBhbGdvcml0aG0sXG4gICAgICAgICAgICAgICAgc2ltdWxhdGVGcm9tQWRkcmVzczogJzB4MDcxNmExN0ZCQWVFNzE0ZjFFNmFCMGY5ZDU5ZWRiQzVmMDk4MTVDMCcsXG4gICAgICAgICAgICAgICAgZW5hYmxlVW5pdmVyc2FsUm91dGVyOiBmYWxzZSxcbiAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgIGNvbnN0IHF1ZXJ5UGFyYW1zID0gcXMuc3RyaW5naWZ5KHF1b3RlUmVxKVxuXG4gICAgICAgICAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgYXhpb3MuZ2V0PFF1b3RlUmVzcG9uc2U+KGAke0FQSX0/JHtxdWVyeVBhcmFtc31gKVxuICAgICAgICAgICAgICBjb25zdCB7IGRhdGEsIHN0YXR1cyB9ID0gcmVzcG9uc2VcbiAgICAgICAgICAgICAgZXhwZWN0KHN0YXR1cykudG8uZXF1YWwoMjAwKVxuICAgICAgICAgICAgICBleHBlY3QoZGF0YS5zaW11bGF0aW9uRXJyb3IpLnRvLmVxdWFsKGZhbHNlKVxuICAgICAgICAgICAgICBleHBlY3QoZGF0YS5tZXRob2RQYXJhbWV0ZXJzKS50by5ub3QuYmUudW5kZWZpbmVkXG5cbiAgICAgICAgICAgICAgY29uc3QgeyB0b2tlbkluQmVmb3JlLCB0b2tlbkluQWZ0ZXIsIHRva2VuT3V0QmVmb3JlLCB0b2tlbk91dEFmdGVyIH0gPSBhd2FpdCBleGVjdXRlU3dhcChcbiAgICAgICAgICAgICAgICBkYXRhLm1ldGhvZFBhcmFtZXRlcnMhLFxuICAgICAgICAgICAgICAgIEV0aGVyLm9uQ2hhaW4oMSksXG4gICAgICAgICAgICAgICAgVU5JX01BSU5ORVRcbiAgICAgICAgICAgICAgKVxuXG4gICAgICAgICAgICAgIGlmICh0eXBlID09ICdleGFjdEluJykge1xuICAgICAgICAgICAgICAgIC8vIFdlJ3ZlIHN3YXBwZWQgMTAgRVRIICsgZ2FzIGNvc3RzXG4gICAgICAgICAgICAgICAgZXhwZWN0KHRva2VuSW5CZWZvcmUuc3VidHJhY3QodG9rZW5JbkFmdGVyKS5ncmVhdGVyVGhhbihwYXJzZUFtb3VudCgnMTAnLCBFdGhlci5vbkNoYWluKDEpKSkpLnRvLmJlLnRydWVcbiAgICAgICAgICAgICAgICBjaGVja1F1b3RlVG9rZW4odG9rZW5PdXRCZWZvcmUsIHRva2VuT3V0QWZ0ZXIsIEN1cnJlbmN5QW1vdW50LmZyb21SYXdBbW91bnQoVU5JX01BSU5ORVQsIGRhdGEucXVvdGUpKVxuICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIGV4cGVjdCh0b2tlbk91dEFmdGVyLnN1YnRyYWN0KHRva2VuT3V0QmVmb3JlKS50b0V4YWN0KCkpLnRvLmVxdWFsKCcxMDAwMCcpXG4gICAgICAgICAgICAgICAgLy8gQ2FuJ3QgZWFzaWx5IGNoZWNrIHNsaXBwYWdlIGZvciBFVEggZHVlIHRvIGdhcyBjb3N0cyBlZmZlY3RpbmcgRVRIIGJhbGFuY2UuXG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pXG5cbiAgICAgICAgICAgIGl0KGB3ZXRoIC0+IGVyYzIwYCwgYXN5bmMgKCkgPT4ge1xuICAgICAgICAgICAgICBjb25zdCBxdW90ZVJlcTogUXVvdGVRdWVyeVBhcmFtcyA9IHtcbiAgICAgICAgICAgICAgICB0b2tlbkluQWRkcmVzczogJ1dFVEgnLFxuICAgICAgICAgICAgICAgIHRva2VuSW5DaGFpbklkOiAxLFxuICAgICAgICAgICAgICAgIHRva2VuT3V0QWRkcmVzczogJ0RBSScsXG4gICAgICAgICAgICAgICAgdG9rZW5PdXRDaGFpbklkOiAxLFxuICAgICAgICAgICAgICAgIGFtb3VudDogYXdhaXQgZ2V0QW1vdW50KDEsIHR5cGUsICdXRVRIJywgJ0RBSScsICcxMDAnKSxcbiAgICAgICAgICAgICAgICB0eXBlLFxuICAgICAgICAgICAgICAgIHJlY2lwaWVudDogYWxpY2UuYWRkcmVzcyxcbiAgICAgICAgICAgICAgICBzbGlwcGFnZVRvbGVyYW5jZTogU0xJUFBBR0UsXG4gICAgICAgICAgICAgICAgZGVhZGxpbmU6ICczNjAnLFxuICAgICAgICAgICAgICAgIGFsZ29yaXRobSxcbiAgICAgICAgICAgICAgICBzaW11bGF0ZUZyb21BZGRyZXNzOiAnMHhmMDRhNWNjODBiMWU5NGM2OWI0OGY1ZWU2OGEwOGNkMmYwOWE3YzNlJyxcbiAgICAgICAgICAgICAgICBlbmFibGVVbml2ZXJzYWxSb3V0ZXI6IHRydWUsXG4gICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICBjb25zdCBxdWVyeVBhcmFtcyA9IHFzLnN0cmluZ2lmeShxdW90ZVJlcSlcblxuICAgICAgICAgICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGF4aW9zLmdldDxRdW90ZVJlc3BvbnNlPihgJHtBUEl9PyR7cXVlcnlQYXJhbXN9YClcbiAgICAgICAgICAgICAgY29uc3QgeyBkYXRhLCBzdGF0dXMgfSA9IHJlc3BvbnNlXG4gICAgICAgICAgICAgIGV4cGVjdChzdGF0dXMpLnRvLmVxdWFsKDIwMClcbiAgICAgICAgICAgICAgZXhwZWN0KGRhdGEuc2ltdWxhdGlvbkVycm9yKS50by5lcXVhbChmYWxzZSlcbiAgICAgICAgICAgICAgZXhwZWN0KGRhdGEubWV0aG9kUGFyYW1ldGVycykudG8ubm90LmJlLnVuZGVmaW5lZFxuXG4gICAgICAgICAgICAgIGNvbnN0IHsgdG9rZW5JbkJlZm9yZSwgdG9rZW5JbkFmdGVyLCB0b2tlbk91dEJlZm9yZSwgdG9rZW5PdXRBZnRlciB9ID0gYXdhaXQgZXhlY3V0ZVN3YXAoXG4gICAgICAgICAgICAgICAgZGF0YS5tZXRob2RQYXJhbWV0ZXJzISxcbiAgICAgICAgICAgICAgICBXRVRIOVsxXSEsXG4gICAgICAgICAgICAgICAgREFJX01BSU5ORVRcbiAgICAgICAgICAgICAgKVxuXG4gICAgICAgICAgICAgIGlmICh0eXBlID09ICdleGFjdEluJykge1xuICAgICAgICAgICAgICAgIGV4cGVjdCh0b2tlbkluQmVmb3JlLnN1YnRyYWN0KHRva2VuSW5BZnRlcikudG9FeGFjdCgpKS50by5lcXVhbCgnMTAwJylcbiAgICAgICAgICAgICAgICBjaGVja1F1b3RlVG9rZW4odG9rZW5PdXRCZWZvcmUsIHRva2VuT3V0QWZ0ZXIsIEN1cnJlbmN5QW1vdW50LmZyb21SYXdBbW91bnQoREFJX01BSU5ORVQsIGRhdGEucXVvdGUpKVxuICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIGV4cGVjdCh0b2tlbk91dEFmdGVyLnN1YnRyYWN0KHRva2VuT3V0QmVmb3JlKS50b0V4YWN0KCkpLnRvLmVxdWFsKCcxMDAnKVxuICAgICAgICAgICAgICAgIGNoZWNrUXVvdGVUb2tlbih0b2tlbkluQmVmb3JlLCB0b2tlbkluQWZ0ZXIsIEN1cnJlbmN5QW1vdW50LmZyb21SYXdBbW91bnQoV0VUSDlbMV0hLCBkYXRhLnF1b3RlKSlcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSlcblxuICAgICAgICAgICAgaXQoYGVyYzIwIC0+IHdldGhgLCBhc3luYyAoKSA9PiB7XG4gICAgICAgICAgICAgIGNvbnN0IHF1b3RlUmVxOiBRdW90ZVF1ZXJ5UGFyYW1zID0ge1xuICAgICAgICAgICAgICAgIHRva2VuSW5BZGRyZXNzOiAnVVNEQycsXG4gICAgICAgICAgICAgICAgdG9rZW5JbkNoYWluSWQ6IDEsXG4gICAgICAgICAgICAgICAgdG9rZW5PdXRBZGRyZXNzOiAnV0VUSCcsXG4gICAgICAgICAgICAgICAgdG9rZW5PdXRDaGFpbklkOiAxLFxuICAgICAgICAgICAgICAgIGFtb3VudDogYXdhaXQgZ2V0QW1vdW50KDEsIHR5cGUsICdVU0RDJywgJ1dFVEgnLCAnMTAwJyksXG4gICAgICAgICAgICAgICAgdHlwZSxcbiAgICAgICAgICAgICAgICByZWNpcGllbnQ6IGFsaWNlLmFkZHJlc3MsXG4gICAgICAgICAgICAgICAgc2xpcHBhZ2VUb2xlcmFuY2U6IFNMSVBQQUdFLFxuICAgICAgICAgICAgICAgIGRlYWRsaW5lOiAnMzYwJyxcbiAgICAgICAgICAgICAgICBhbGdvcml0aG0sXG4gICAgICAgICAgICAgICAgc2ltdWxhdGVGcm9tQWRkcmVzczogJzB4ZjU4NGY4NzI4Yjg3NGE2YTVjN2E4ZDRkMzg3YzlhYWU5MTcyZDYyMScsXG4gICAgICAgICAgICAgICAgZW5hYmxlVW5pdmVyc2FsUm91dGVyOiB0cnVlLFxuICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgY29uc3QgcXVlcnlQYXJhbXMgPSBxcy5zdHJpbmdpZnkocXVvdGVSZXEpXG5cbiAgICAgICAgICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBheGlvcy5nZXQ8UXVvdGVSZXNwb25zZT4oYCR7QVBJfT8ke3F1ZXJ5UGFyYW1zfWApXG4gICAgICAgICAgICAgIGNvbnN0IHsgZGF0YSwgc3RhdHVzIH0gPSByZXNwb25zZVxuICAgICAgICAgICAgICBleHBlY3Qoc3RhdHVzKS50by5lcXVhbCgyMDApXG4gICAgICAgICAgICAgIGV4cGVjdChkYXRhLnNpbXVsYXRpb25FcnJvcikudG8uZXF1YWwoZmFsc2UpXG4gICAgICAgICAgICAgIGV4cGVjdChkYXRhLm1ldGhvZFBhcmFtZXRlcnMpLnRvLm5vdC5iZS51bmRlZmluZWRcblxuICAgICAgICAgICAgICBjb25zdCB7IHRva2VuSW5CZWZvcmUsIHRva2VuSW5BZnRlciwgdG9rZW5PdXRCZWZvcmUsIHRva2VuT3V0QWZ0ZXIgfSA9IGF3YWl0IGV4ZWN1dGVTd2FwKFxuICAgICAgICAgICAgICAgIGRhdGEubWV0aG9kUGFyYW1ldGVycyEsXG4gICAgICAgICAgICAgICAgVVNEQ19NQUlOTkVULFxuICAgICAgICAgICAgICAgIFdFVEg5WzFdIVxuICAgICAgICAgICAgICApXG5cbiAgICAgICAgICAgICAgaWYgKHR5cGUgPT0gJ2V4YWN0SW4nKSB7XG4gICAgICAgICAgICAgICAgZXhwZWN0KHRva2VuSW5CZWZvcmUuc3VidHJhY3QodG9rZW5JbkFmdGVyKS50b0V4YWN0KCkpLnRvLmVxdWFsKCcxMDAnKVxuICAgICAgICAgICAgICAgIGNoZWNrUXVvdGVUb2tlbih0b2tlbk91dEJlZm9yZSwgdG9rZW5PdXRBZnRlciwgQ3VycmVuY3lBbW91bnQuZnJvbVJhd0Ftb3VudChXRVRIOVsxXSwgZGF0YS5xdW90ZSkpXG4gICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgZXhwZWN0KHRva2VuT3V0QWZ0ZXIuc3VidHJhY3QodG9rZW5PdXRCZWZvcmUpLnRvRXhhY3QoKSkudG8uZXF1YWwoJzEwMCcpXG4gICAgICAgICAgICAgICAgY2hlY2tRdW90ZVRva2VuKHRva2VuSW5CZWZvcmUsIHRva2VuSW5BZnRlciwgQ3VycmVuY3lBbW91bnQuZnJvbVJhd0Ftb3VudChVU0RDX01BSU5ORVQsIGRhdGEucXVvdGUpKVxuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KVxuICAgICAgICAgIH0pXG4gICAgICAgIH1cbiAgICAgICAgaXQoYGVyYzIwIC0+IGVyYzIwIG5vIHJlY2lwaWVudC9kZWFkbGluZS9zbGlwcGFnZWAsIGFzeW5jICgpID0+IHtcbiAgICAgICAgICBjb25zdCBxdW90ZVJlcTogUXVvdGVRdWVyeVBhcmFtcyA9IHtcbiAgICAgICAgICAgIHRva2VuSW5BZGRyZXNzOiAnVVNEQycsXG4gICAgICAgICAgICB0b2tlbkluQ2hhaW5JZDogMSxcbiAgICAgICAgICAgIHRva2VuT3V0QWRkcmVzczogJ1VTRFQnLFxuICAgICAgICAgICAgdG9rZW5PdXRDaGFpbklkOiAxLFxuICAgICAgICAgICAgYW1vdW50OiBhd2FpdCBnZXRBbW91bnQoMSwgdHlwZSwgJ1VTREMnLCAnVVNEVCcsICcxMDAnKSxcbiAgICAgICAgICAgIHR5cGUsXG4gICAgICAgICAgICBhbGdvcml0aG0sXG4gICAgICAgICAgICBlbmFibGVVbml2ZXJzYWxSb3V0ZXI6IHRydWUsXG4gICAgICAgICAgfVxuXG4gICAgICAgICAgY29uc3QgcXVlcnlQYXJhbXMgPSBxcy5zdHJpbmdpZnkocXVvdGVSZXEpXG5cbiAgICAgICAgICBjb25zdCByZXNwb25zZTogQXhpb3NSZXNwb25zZTxRdW90ZVJlc3BvbnNlPiA9IGF3YWl0IGF4aW9zLmdldDxRdW90ZVJlc3BvbnNlPihgJHtBUEl9PyR7cXVlcnlQYXJhbXN9YClcbiAgICAgICAgICBjb25zdCB7XG4gICAgICAgICAgICBkYXRhOiB7IHF1b3RlRGVjaW1hbHMsIHF1b3RlR2FzQWRqdXN0ZWREZWNpbWFscywgbWV0aG9kUGFyYW1ldGVycyB9LFxuICAgICAgICAgICAgc3RhdHVzLFxuICAgICAgICAgIH0gPSByZXNwb25zZVxuXG4gICAgICAgICAgZXhwZWN0KHN0YXR1cykudG8uZXF1YWwoMjAwKVxuICAgICAgICAgIGV4cGVjdChwYXJzZUZsb2F0KHF1b3RlRGVjaW1hbHMpKS50by5iZS5ncmVhdGVyVGhhbig5MClcbiAgICAgICAgICBleHBlY3QocGFyc2VGbG9hdChxdW90ZURlY2ltYWxzKSkudG8uYmUubGVzc1RoYW4oMTEwKVxuXG4gICAgICAgICAgaWYgKHR5cGUgPT0gJ2V4YWN0SW4nKSB7XG4gICAgICAgICAgICBleHBlY3QocGFyc2VGbG9hdChxdW90ZUdhc0FkanVzdGVkRGVjaW1hbHMpKS50by5iZS5sZXNzVGhhbk9yRXF1YWwocGFyc2VGbG9hdChxdW90ZURlY2ltYWxzKSlcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgZXhwZWN0KHBhcnNlRmxvYXQocXVvdGVHYXNBZGp1c3RlZERlY2ltYWxzKSkudG8uYmUuZ3JlYXRlclRoYW5PckVxdWFsKHBhcnNlRmxvYXQocXVvdGVEZWNpbWFscykpXG4gICAgICAgICAgfVxuXG4gICAgICAgICAgZXhwZWN0KG1ldGhvZFBhcmFtZXRlcnMpLnRvLmJlLnVuZGVmaW5lZFxuICAgICAgICB9KVxuXG4gICAgICAgIGl0KGBlcmMyMCAtPiBlcmMyMCBnYXMgcHJpY2Ugc3BlY2lmaWVkYCwgYXN5bmMgKCkgPT4ge1xuICAgICAgICAgIGNvbnN0IHF1b3RlUmVxOiBRdW90ZVF1ZXJ5UGFyYW1zID0ge1xuICAgICAgICAgICAgdG9rZW5JbkFkZHJlc3M6ICdVU0RDJyxcbiAgICAgICAgICAgIHRva2VuSW5DaGFpbklkOiAxLFxuICAgICAgICAgICAgdG9rZW5PdXRBZGRyZXNzOiAnVVNEVCcsXG4gICAgICAgICAgICB0b2tlbk91dENoYWluSWQ6IDEsXG4gICAgICAgICAgICBhbW91bnQ6IGF3YWl0IGdldEFtb3VudCgxLCB0eXBlLCAnVVNEQycsICdVU0RUJywgJzEwMCcpLFxuICAgICAgICAgICAgdHlwZSxcbiAgICAgICAgICAgIGFsZ29yaXRobSxcbiAgICAgICAgICAgIGdhc1ByaWNlV2VpOiAnNjAwMDAwMDAwMDAnLFxuICAgICAgICAgICAgZW5hYmxlVW5pdmVyc2FsUm91dGVyOiB0cnVlLFxuICAgICAgICAgIH1cblxuICAgICAgICAgIGNvbnN0IHF1ZXJ5UGFyYW1zID0gcXMuc3RyaW5naWZ5KHF1b3RlUmVxKVxuXG4gICAgICAgICAgY29uc3QgcmVzcG9uc2U6IEF4aW9zUmVzcG9uc2U8UXVvdGVSZXNwb25zZT4gPSBhd2FpdCBheGlvcy5nZXQ8UXVvdGVSZXNwb25zZT4oYCR7QVBJfT8ke3F1ZXJ5UGFyYW1zfWApXG4gICAgICAgICAgY29uc3Qge1xuICAgICAgICAgICAgZGF0YTogeyBxdW90ZURlY2ltYWxzLCBxdW90ZUdhc0FkanVzdGVkRGVjaW1hbHMsIG1ldGhvZFBhcmFtZXRlcnMsIGdhc1ByaWNlV2VpIH0sXG4gICAgICAgICAgICBzdGF0dXMsXG4gICAgICAgICAgfSA9IHJlc3BvbnNlXG5cbiAgICAgICAgICBleHBlY3Qoc3RhdHVzKS50by5lcXVhbCgyMDApXG5cbiAgICAgICAgICBpZiAoYWxnb3JpdGhtID09ICdhbHBoYScpIHtcbiAgICAgICAgICAgIGV4cGVjdChnYXNQcmljZVdlaSkudG8uZXF1YWwoJzYwMDAwMDAwMDAwJylcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBleHBlY3QocGFyc2VGbG9hdChxdW90ZURlY2ltYWxzKSkudG8uYmUuZ3JlYXRlclRoYW4oOTApXG4gICAgICAgICAgZXhwZWN0KHBhcnNlRmxvYXQocXVvdGVEZWNpbWFscykpLnRvLmJlLmxlc3NUaGFuKDExMClcblxuICAgICAgICAgIGlmICh0eXBlID09ICdleGFjdEluJykge1xuICAgICAgICAgICAgZXhwZWN0KHBhcnNlRmxvYXQocXVvdGVHYXNBZGp1c3RlZERlY2ltYWxzKSkudG8uYmUubGVzc1RoYW5PckVxdWFsKHBhcnNlRmxvYXQocXVvdGVEZWNpbWFscykpXG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGV4cGVjdChwYXJzZUZsb2F0KHF1b3RlR2FzQWRqdXN0ZWREZWNpbWFscykpLnRvLmJlLmdyZWF0ZXJUaGFuT3JFcXVhbChwYXJzZUZsb2F0KHF1b3RlRGVjaW1hbHMpKVxuICAgICAgICAgIH1cblxuICAgICAgICAgIGV4cGVjdChtZXRob2RQYXJhbWV0ZXJzKS50by5iZS51bmRlZmluZWRcbiAgICAgICAgfSlcblxuICAgICAgICBpdChgZXJjMjAgLT4gZXJjMjAgYnkgYWRkcmVzc2AsIGFzeW5jICgpID0+IHtcbiAgICAgICAgICBjb25zdCBxdW90ZVJlcTogUXVvdGVRdWVyeVBhcmFtcyA9IHtcbiAgICAgICAgICAgIHRva2VuSW5BZGRyZXNzOiAnMHg2QjE3NTQ3NEU4OTA5NEM0NERhOThiOTU0RWVkZUFDNDk1MjcxZDBGJyxcbiAgICAgICAgICAgIHRva2VuSW5DaGFpbklkOiAxLCAvLyBEQUlcbiAgICAgICAgICAgIHRva2VuT3V0QWRkcmVzczogJzB4QTBiODY5OTFjNjIxOGIzNmMxZDE5RDRhMmU5RWIwY0UzNjA2ZUI0OCcsXG4gICAgICAgICAgICB0b2tlbk91dENoYWluSWQ6IDEsIC8vIFVTRENcbiAgICAgICAgICAgIGFtb3VudDogYXdhaXQgZ2V0QW1vdW50KDEsIHR5cGUsICdEQUknLCAnVVNEQycsICcxMDAnKSxcbiAgICAgICAgICAgIHR5cGUsXG4gICAgICAgICAgICByZWNpcGllbnQ6IGFsaWNlLmFkZHJlc3MsXG4gICAgICAgICAgICBzbGlwcGFnZVRvbGVyYW5jZTogU0xJUFBBR0UsXG4gICAgICAgICAgICBkZWFkbGluZTogJzM2MCcsXG4gICAgICAgICAgICBhbGdvcml0aG0sXG4gICAgICAgICAgICBlbmFibGVVbml2ZXJzYWxSb3V0ZXI6IHRydWUsXG4gICAgICAgICAgfVxuXG4gICAgICAgICAgY29uc3QgcXVlcnlQYXJhbXMgPSBxcy5zdHJpbmdpZnkocXVvdGVSZXEpXG5cbiAgICAgICAgICBjb25zdCByZXNwb25zZTogQXhpb3NSZXNwb25zZTxRdW90ZVJlc3BvbnNlPiA9IGF3YWl0IGF4aW9zLmdldDxRdW90ZVJlc3BvbnNlPihgJHtBUEl9PyR7cXVlcnlQYXJhbXN9YClcblxuICAgICAgICAgIGNvbnN0IHtcbiAgICAgICAgICAgIGRhdGE6IHsgcXVvdGVEZWNpbWFscywgcXVvdGVHYXNBZGp1c3RlZERlY2ltYWxzIH0sXG4gICAgICAgICAgICBzdGF0dXMsXG4gICAgICAgICAgfSA9IHJlc3BvbnNlXG5cbiAgICAgICAgICBleHBlY3Qoc3RhdHVzKS50by5lcXVhbCgyMDApXG4gICAgICAgICAgZXhwZWN0KHBhcnNlRmxvYXQocXVvdGVEZWNpbWFscykpLnRvLmJlLmdyZWF0ZXJUaGFuKDkwKVxuXG4gICAgICAgICAgaWYgKHR5cGUgPT0gJ2V4YWN0SW4nKSB7XG4gICAgICAgICAgICBleHBlY3QocGFyc2VGbG9hdChxdW90ZUdhc0FkanVzdGVkRGVjaW1hbHMpKS50by5iZS5sZXNzVGhhbk9yRXF1YWwocGFyc2VGbG9hdChxdW90ZURlY2ltYWxzKSlcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgZXhwZWN0KHBhcnNlRmxvYXQocXVvdGVHYXNBZGp1c3RlZERlY2ltYWxzKSkudG8uYmUuZ3JlYXRlclRoYW5PckVxdWFsKHBhcnNlRmxvYXQocXVvdGVEZWNpbWFscykpXG4gICAgICAgICAgfVxuXG4gICAgICAgICAgZXhwZWN0KHBhcnNlRmxvYXQocXVvdGVEZWNpbWFscykpLnRvLmJlLmxlc3NUaGFuKDExMClcbiAgICAgICAgfSlcblxuICAgICAgICBpdChgZXJjMjAgLT4gZXJjMjAgb25lIGJ5IGFkZHJlc3Mgb25lIGJ5IHN5bWJvbGAsIGFzeW5jICgpID0+IHtcbiAgICAgICAgICBjb25zdCBxdW90ZVJlcTogUXVvdGVRdWVyeVBhcmFtcyA9IHtcbiAgICAgICAgICAgIHRva2VuSW5BZGRyZXNzOiAnMHg2QjE3NTQ3NEU4OTA5NEM0NERhOThiOTU0RWVkZUFDNDk1MjcxZDBGJyxcbiAgICAgICAgICAgIHRva2VuSW5DaGFpbklkOiAxLFxuICAgICAgICAgICAgdG9rZW5PdXRBZGRyZXNzOiAnVVNEQycsXG4gICAgICAgICAgICB0b2tlbk91dENoYWluSWQ6IDEsXG4gICAgICAgICAgICBhbW91bnQ6IGF3YWl0IGdldEFtb3VudCgxLCB0eXBlLCAnREFJJywgJ1VTREMnLCAnMTAwJyksXG4gICAgICAgICAgICB0eXBlLFxuICAgICAgICAgICAgcmVjaXBpZW50OiBhbGljZS5hZGRyZXNzLFxuICAgICAgICAgICAgc2xpcHBhZ2VUb2xlcmFuY2U6IFNMSVBQQUdFLFxuICAgICAgICAgICAgZGVhZGxpbmU6ICczNjAnLFxuICAgICAgICAgICAgYWxnb3JpdGhtLFxuICAgICAgICAgICAgZW5hYmxlVW5pdmVyc2FsUm91dGVyOiB0cnVlLFxuICAgICAgICAgIH1cblxuICAgICAgICAgIGNvbnN0IHF1ZXJ5UGFyYW1zID0gcXMuc3RyaW5naWZ5KHF1b3RlUmVxKVxuXG4gICAgICAgICAgY29uc3QgcmVzcG9uc2U6IEF4aW9zUmVzcG9uc2U8UXVvdGVSZXNwb25zZT4gPSBhd2FpdCBheGlvcy5nZXQ8UXVvdGVSZXNwb25zZT4oYCR7QVBJfT8ke3F1ZXJ5UGFyYW1zfWApXG4gICAgICAgICAgY29uc3Qge1xuICAgICAgICAgICAgZGF0YTogeyBxdW90ZURlY2ltYWxzLCBxdW90ZUdhc0FkanVzdGVkRGVjaW1hbHMgfSxcbiAgICAgICAgICAgIHN0YXR1cyxcbiAgICAgICAgICB9ID0gcmVzcG9uc2VcblxuICAgICAgICAgIGV4cGVjdChzdGF0dXMpLnRvLmVxdWFsKDIwMClcbiAgICAgICAgICBleHBlY3QocGFyc2VGbG9hdChxdW90ZURlY2ltYWxzKSkudG8uYmUuZ3JlYXRlclRoYW4oOTApXG5cbiAgICAgICAgICBpZiAodHlwZSA9PSAnZXhhY3RJbicpIHtcbiAgICAgICAgICAgIGV4cGVjdChwYXJzZUZsb2F0KHF1b3RlR2FzQWRqdXN0ZWREZWNpbWFscykpLnRvLmJlLmxlc3NUaGFuT3JFcXVhbChwYXJzZUZsb2F0KHF1b3RlRGVjaW1hbHMpKVxuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBleHBlY3QocGFyc2VGbG9hdChxdW90ZUdhc0FkanVzdGVkRGVjaW1hbHMpKS50by5iZS5ncmVhdGVyVGhhbk9yRXF1YWwocGFyc2VGbG9hdChxdW90ZURlY2ltYWxzKSlcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBleHBlY3QocGFyc2VGbG9hdChxdW90ZURlY2ltYWxzKSkudG8uYmUubGVzc1RoYW4oMTEwKVxuICAgICAgICB9KVxuICAgICAgfSlcblxuICAgICAgZGVzY3JpYmUoYCR7SURfVE9fTkVUV09SS19OQU1FKDEpfSAke2FsZ29yaXRobX0gJHt0eXBlfSA0eHhgLCAoKSA9PiB7XG4gICAgICAgIGl0KGBmaWVsZCBpcyBtaXNzaW5nIGluIGJvZHlgLCBhc3luYyAoKSA9PiB7XG4gICAgICAgICAgY29uc3QgcXVvdGVSZXE6IFBhcnRpYWw8UXVvdGVRdWVyeVBhcmFtcz4gPSB7XG4gICAgICAgICAgICB0b2tlbk91dEFkZHJlc3M6ICdVU0RUJyxcbiAgICAgICAgICAgIHRva2VuSW5DaGFpbklkOiAxLFxuICAgICAgICAgICAgdG9rZW5PdXRDaGFpbklkOiAxLFxuICAgICAgICAgICAgYW1vdW50OiBhd2FpdCBnZXRBbW91bnQoMSwgdHlwZSwgJ1VTREMnLCAnVVNEVCcsICcxMDAnKSxcbiAgICAgICAgICAgIHR5cGUsXG4gICAgICAgICAgICByZWNpcGllbnQ6IGFsaWNlLmFkZHJlc3MsXG4gICAgICAgICAgICBzbGlwcGFnZVRvbGVyYW5jZTogU0xJUFBBR0UsXG4gICAgICAgICAgICBkZWFkbGluZTogJzM2MCcsXG4gICAgICAgICAgICBhbGdvcml0aG0sXG4gICAgICAgICAgICBlbmFibGVVbml2ZXJzYWxSb3V0ZXI6IHRydWUsXG4gICAgICAgICAgfVxuXG4gICAgICAgICAgYXdhaXQgY2FsbEFuZEV4cGVjdEZhaWwocXVvdGVSZXEsIHtcbiAgICAgICAgICAgIHN0YXR1czogNDAwLFxuICAgICAgICAgICAgZGF0YToge1xuICAgICAgICAgICAgICBkZXRhaWw6ICdcInRva2VuSW5BZGRyZXNzXCIgaXMgcmVxdWlyZWQnLFxuICAgICAgICAgICAgICBlcnJvckNvZGU6ICdWQUxJREFUSU9OX0VSUk9SJyxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSlcbiAgICAgICAgfSlcblxuICAgICAgICBpdC5za2lwKGBhbW91bnQgaXMgdG9vIGJpZyB0byBmaW5kIHJvdXRlYCwgYXN5bmMgKCkgPT4ge1xuICAgICAgICAgIGNvbnN0IHF1b3RlUmVxOiBRdW90ZVF1ZXJ5UGFyYW1zID0ge1xuICAgICAgICAgICAgdG9rZW5JbkFkZHJlc3M6ICdVTkknLFxuICAgICAgICAgICAgdG9rZW5JbkNoYWluSWQ6IDEsXG4gICAgICAgICAgICB0b2tlbk91dEFkZHJlc3M6ICdLTkMnLFxuICAgICAgICAgICAgdG9rZW5PdXRDaGFpbklkOiAxLFxuICAgICAgICAgICAgYW1vdW50OiBhd2FpdCBnZXRBbW91bnQoMSwgdHlwZSwgJ1VOSScsICdLTkMnLCAnOTk5OTk5OTk5OTk5OTk5OTk5OTk5OTk5OTk5OTk5OTk5OTk5OTk5OTk5OTk5OTk5OScpLFxuICAgICAgICAgICAgdHlwZSxcbiAgICAgICAgICAgIHJlY2lwaWVudDogJzB4ODhmYzc2NTk0OWEyNzQwNTQ4MEYzNzRBYTQ5RTIwZGNDRDNmQ2ZiOCcsXG4gICAgICAgICAgICBzbGlwcGFnZVRvbGVyYW5jZTogU0xJUFBBR0UsXG4gICAgICAgICAgICBkZWFkbGluZTogJzM2MCcsXG4gICAgICAgICAgICBhbGdvcml0aG0sXG4gICAgICAgICAgICBlbmFibGVVbml2ZXJzYWxSb3V0ZXI6IHRydWUsXG4gICAgICAgICAgfVxuXG4gICAgICAgICAgYXdhaXQgY2FsbEFuZEV4cGVjdEZhaWwocXVvdGVSZXEsIHtcbiAgICAgICAgICAgIHN0YXR1czogNDAwLFxuICAgICAgICAgICAgZGF0YToge1xuICAgICAgICAgICAgICBkZXRhaWw6ICdObyByb3V0ZSBmb3VuZCcsXG4gICAgICAgICAgICAgIGVycm9yQ29kZTogJ05PX1JPVVRFJyxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSlcbiAgICAgICAgfSlcblxuICAgICAgICBpdChgYW1vdW50IGlzIHRvbyBiaWcgZm9yIHVpbnQyNTZgLCBhc3luYyAoKSA9PiB7XG4gICAgICAgICAgY29uc3QgcXVvdGVSZXE6IFF1b3RlUXVlcnlQYXJhbXMgPSB7XG4gICAgICAgICAgICB0b2tlbkluQWRkcmVzczogJ1VTREMnLFxuICAgICAgICAgICAgdG9rZW5JbkNoYWluSWQ6IDEsXG4gICAgICAgICAgICB0b2tlbk91dEFkZHJlc3M6ICdVU0RUJyxcbiAgICAgICAgICAgIHRva2VuT3V0Q2hhaW5JZDogMSxcbiAgICAgICAgICAgIGFtb3VudDogYXdhaXQgZ2V0QW1vdW50KFxuICAgICAgICAgICAgICAxLFxuICAgICAgICAgICAgICB0eXBlLFxuICAgICAgICAgICAgICAnVVNEQycsXG4gICAgICAgICAgICAgICdVU0RUJyxcbiAgICAgICAgICAgICAgJzEwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMCdcbiAgICAgICAgICAgICksXG4gICAgICAgICAgICB0eXBlLFxuICAgICAgICAgICAgcmVjaXBpZW50OiBhbGljZS5hZGRyZXNzLFxuICAgICAgICAgICAgc2xpcHBhZ2VUb2xlcmFuY2U6IFNMSVBQQUdFLFxuICAgICAgICAgICAgZGVhZGxpbmU6ICczNjAnLFxuICAgICAgICAgICAgYWxnb3JpdGhtLFxuICAgICAgICAgIH1cblxuICAgICAgICAgIGF3YWl0IGNhbGxBbmRFeHBlY3RGYWlsKHF1b3RlUmVxLCB7XG4gICAgICAgICAgICBzdGF0dXM6IDQwMCxcbiAgICAgICAgICAgIGRhdGE6IHtcbiAgICAgICAgICAgICAgZGV0YWlsOiAnXCJhbW91bnRcIiBsZW5ndGggbXVzdCBiZSBsZXNzIHRoYW4gb3IgZXF1YWwgdG8gNzcgY2hhcmFjdGVycyBsb25nJyxcbiAgICAgICAgICAgICAgZXJyb3JDb2RlOiAnVkFMSURBVElPTl9FUlJPUicsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIH0pXG4gICAgICAgIH0pXG5cbiAgICAgICAgaXQoYGFtb3VudCBpcyBuZWdhdGl2ZWAsIGFzeW5jICgpID0+IHtcbiAgICAgICAgICBjb25zdCBxdW90ZVJlcTogUXVvdGVRdWVyeVBhcmFtcyA9IHtcbiAgICAgICAgICAgIHRva2VuSW5BZGRyZXNzOiAnVVNEQycsXG4gICAgICAgICAgICB0b2tlbkluQ2hhaW5JZDogMSxcbiAgICAgICAgICAgIHRva2VuT3V0QWRkcmVzczogJ1VTRFQnLFxuICAgICAgICAgICAgdG9rZW5PdXRDaGFpbklkOiAxLFxuICAgICAgICAgICAgYW1vdW50OiAnLTEwMDAwMDAwMDAwJyxcbiAgICAgICAgICAgIHR5cGUsXG4gICAgICAgICAgICByZWNpcGllbnQ6IGFsaWNlLmFkZHJlc3MsXG4gICAgICAgICAgICBzbGlwcGFnZVRvbGVyYW5jZTogU0xJUFBBR0UsXG4gICAgICAgICAgICBkZWFkbGluZTogJzM2MCcsXG4gICAgICAgICAgICBhbGdvcml0aG0sXG4gICAgICAgICAgICBlbmFibGVVbml2ZXJzYWxSb3V0ZXI6IHRydWUsXG4gICAgICAgICAgfVxuXG4gICAgICAgICAgYXdhaXQgY2FsbEFuZEV4cGVjdEZhaWwocXVvdGVSZXEsIHtcbiAgICAgICAgICAgIHN0YXR1czogNDAwLFxuICAgICAgICAgICAgZGF0YToge1xuICAgICAgICAgICAgICBkZXRhaWw6ICdcImFtb3VudFwiIHdpdGggdmFsdWUgXCItMTAwMDAwMDAwMDBcIiBmYWlscyB0byBtYXRjaCB0aGUgcmVxdWlyZWQgcGF0dGVybjogL15bMC05XSskLycsXG4gICAgICAgICAgICAgIGVycm9yQ29kZTogJ1ZBTElEQVRJT05fRVJST1InLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICB9KVxuICAgICAgICB9KVxuXG4gICAgICAgIGl0KGBhbW91bnQgaXMgZGVjaW1hbGAsIGFzeW5jICgpID0+IHtcbiAgICAgICAgICBjb25zdCBxdW90ZVJlcTogUXVvdGVRdWVyeVBhcmFtcyA9IHtcbiAgICAgICAgICAgIHRva2VuSW5BZGRyZXNzOiAnVVNEQycsXG4gICAgICAgICAgICB0b2tlbkluQ2hhaW5JZDogMSxcbiAgICAgICAgICAgIHRva2VuT3V0QWRkcmVzczogJ1VTRFQnLFxuICAgICAgICAgICAgdG9rZW5PdXRDaGFpbklkOiAxLFxuICAgICAgICAgICAgYW1vdW50OiAnMTAwMDAwMDAwMC4yNScsXG4gICAgICAgICAgICB0eXBlLFxuICAgICAgICAgICAgcmVjaXBpZW50OiBhbGljZS5hZGRyZXNzLFxuICAgICAgICAgICAgc2xpcHBhZ2VUb2xlcmFuY2U6IFNMSVBQQUdFLFxuICAgICAgICAgICAgZGVhZGxpbmU6ICczNjAnLFxuICAgICAgICAgICAgYWxnb3JpdGhtLFxuICAgICAgICAgICAgZW5hYmxlVW5pdmVyc2FsUm91dGVyOiB0cnVlLFxuICAgICAgICAgIH1cblxuICAgICAgICAgIGF3YWl0IGNhbGxBbmRFeHBlY3RGYWlsKHF1b3RlUmVxLCB7XG4gICAgICAgICAgICBzdGF0dXM6IDQwMCxcbiAgICAgICAgICAgIGRhdGE6IHtcbiAgICAgICAgICAgICAgZGV0YWlsOiAnXCJhbW91bnRcIiB3aXRoIHZhbHVlIFwiMTAwMDAwMDAwMC4yNVwiIGZhaWxzIHRvIG1hdGNoIHRoZSByZXF1aXJlZCBwYXR0ZXJuOiAvXlswLTldKyQvJyxcbiAgICAgICAgICAgICAgZXJyb3JDb2RlOiAnVkFMSURBVElPTl9FUlJPUicsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIH0pXG4gICAgICAgIH0pXG5cbiAgICAgICAgaXQoYHN5bWJvbCBkb2VzbnQgZXhpc3RgLCBhc3luYyAoKSA9PiB7XG4gICAgICAgICAgY29uc3QgcXVvdGVSZXE6IFF1b3RlUXVlcnlQYXJhbXMgPSB7XG4gICAgICAgICAgICB0b2tlbkluQWRkcmVzczogJ1VTREMnLFxuICAgICAgICAgICAgdG9rZW5JbkNoYWluSWQ6IDEsXG4gICAgICAgICAgICB0b2tlbk91dEFkZHJlc3M6ICdOT05FWElTVEFOVFRPS0VOJyxcbiAgICAgICAgICAgIHRva2VuT3V0Q2hhaW5JZDogMSxcbiAgICAgICAgICAgIGFtb3VudDogYXdhaXQgZ2V0QW1vdW50KDEsIHR5cGUsICdVU0RDJywgJ1VTRFQnLCAnMTAwJyksXG4gICAgICAgICAgICB0eXBlLFxuICAgICAgICAgICAgcmVjaXBpZW50OiBhbGljZS5hZGRyZXNzLFxuICAgICAgICAgICAgc2xpcHBhZ2VUb2xlcmFuY2U6IFNMSVBQQUdFLFxuICAgICAgICAgICAgZGVhZGxpbmU6ICczNjAnLFxuICAgICAgICAgICAgYWxnb3JpdGhtLFxuICAgICAgICAgIH1cblxuICAgICAgICAgIGF3YWl0IGNhbGxBbmRFeHBlY3RGYWlsKHF1b3RlUmVxLCB7XG4gICAgICAgICAgICBzdGF0dXM6IDQwMCxcbiAgICAgICAgICAgIGRhdGE6IHtcbiAgICAgICAgICAgICAgZGV0YWlsOiAnQ291bGQgbm90IGZpbmQgdG9rZW4gd2l0aCBhZGRyZXNzIFwiTk9ORVhJU1RBTlRUT0tFTlwiJyxcbiAgICAgICAgICAgICAgZXJyb3JDb2RlOiAnVE9LRU5fT1VUX0lOVkFMSUQnLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICB9KVxuICAgICAgICB9KVxuXG4gICAgICAgIGl0KGB0b2tlbnMgYXJlIHRoZSBzYW1lIHN5bWJvbGAsIGFzeW5jICgpID0+IHtcbiAgICAgICAgICBjb25zdCBxdW90ZVJlcTogUXVvdGVRdWVyeVBhcmFtcyA9IHtcbiAgICAgICAgICAgIHRva2VuSW5BZGRyZXNzOiAnVVNEVCcsXG4gICAgICAgICAgICB0b2tlbkluQ2hhaW5JZDogMSxcbiAgICAgICAgICAgIHRva2VuT3V0QWRkcmVzczogJ1VTRFQnLFxuICAgICAgICAgICAgdG9rZW5PdXRDaGFpbklkOiAxLFxuICAgICAgICAgICAgYW1vdW50OiBhd2FpdCBnZXRBbW91bnQoMSwgdHlwZSwgJ1VTREMnLCAnVVNEVCcsICcxMDAnKSxcbiAgICAgICAgICAgIHR5cGUsXG4gICAgICAgICAgICByZWNpcGllbnQ6IGFsaWNlLmFkZHJlc3MsXG4gICAgICAgICAgICBzbGlwcGFnZVRvbGVyYW5jZTogU0xJUFBBR0UsXG4gICAgICAgICAgICBkZWFkbGluZTogJzM2MCcsXG4gICAgICAgICAgICBhbGdvcml0aG0sXG4gICAgICAgICAgICBlbmFibGVVbml2ZXJzYWxSb3V0ZXI6IHRydWUsXG4gICAgICAgICAgfVxuXG4gICAgICAgICAgYXdhaXQgY2FsbEFuZEV4cGVjdEZhaWwocXVvdGVSZXEsIHtcbiAgICAgICAgICAgIHN0YXR1czogNDAwLFxuICAgICAgICAgICAgZGF0YToge1xuICAgICAgICAgICAgICBkZXRhaWw6ICd0b2tlbkluIGFuZCB0b2tlbk91dCBtdXN0IGJlIGRpZmZlcmVudCcsXG4gICAgICAgICAgICAgIGVycm9yQ29kZTogJ1RPS0VOX0lOX09VVF9TQU1FJyxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSlcbiAgICAgICAgfSlcblxuICAgICAgICBpdChgdG9rZW5zIGFyZSB0aGUgc2FtZSBzeW1ib2wgYW5kIGFkZHJlc3NgLCBhc3luYyAoKSA9PiB7XG4gICAgICAgICAgY29uc3QgcXVvdGVSZXE6IFF1b3RlUXVlcnlQYXJhbXMgPSB7XG4gICAgICAgICAgICB0b2tlbkluQWRkcmVzczogJ1VTRFQnLFxuICAgICAgICAgICAgdG9rZW5JbkNoYWluSWQ6IDEsXG4gICAgICAgICAgICB0b2tlbk91dEFkZHJlc3M6ICcweGRBQzE3Rjk1OEQyZWU1MjNhMjIwNjIwNjk5NDU5N0MxM0Q4MzFlYzcnLFxuICAgICAgICAgICAgdG9rZW5PdXRDaGFpbklkOiAxLFxuICAgICAgICAgICAgYW1vdW50OiBhd2FpdCBnZXRBbW91bnQoMSwgdHlwZSwgJ1VTRFQnLCAnVVNEVCcsICcxMDAnKSxcbiAgICAgICAgICAgIHR5cGUsXG4gICAgICAgICAgICByZWNpcGllbnQ6IGFsaWNlLmFkZHJlc3MsXG4gICAgICAgICAgICBzbGlwcGFnZVRvbGVyYW5jZTogU0xJUFBBR0UsXG4gICAgICAgICAgICBkZWFkbGluZTogJzM2MCcsXG4gICAgICAgICAgICBhbGdvcml0aG0sXG4gICAgICAgICAgICBlbmFibGVVbml2ZXJzYWxSb3V0ZXI6IHRydWUsXG4gICAgICAgICAgfVxuXG4gICAgICAgICAgYXdhaXQgY2FsbEFuZEV4cGVjdEZhaWwocXVvdGVSZXEsIHtcbiAgICAgICAgICAgIHN0YXR1czogNDAwLFxuICAgICAgICAgICAgZGF0YToge1xuICAgICAgICAgICAgICBkZXRhaWw6ICd0b2tlbkluIGFuZCB0b2tlbk91dCBtdXN0IGJlIGRpZmZlcmVudCcsXG4gICAgICAgICAgICAgIGVycm9yQ29kZTogJ1RPS0VOX0lOX09VVF9TQU1FJyxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSlcbiAgICAgICAgfSlcblxuICAgICAgICBpdChgdG9rZW5zIGFyZSB0aGUgc2FtZSBhZGRyZXNzYCwgYXN5bmMgKCkgPT4ge1xuICAgICAgICAgIGNvbnN0IHF1b3RlUmVxOiBRdW90ZVF1ZXJ5UGFyYW1zID0ge1xuICAgICAgICAgICAgdG9rZW5JbkFkZHJlc3M6ICcweGRBQzE3Rjk1OEQyZWU1MjNhMjIwNjIwNjk5NDU5N0MxM0Q4MzFlYzcnLFxuICAgICAgICAgICAgdG9rZW5JbkNoYWluSWQ6IDEsXG4gICAgICAgICAgICB0b2tlbk91dEFkZHJlc3M6ICcweGRBQzE3Rjk1OEQyZWU1MjNhMjIwNjIwNjk5NDU5N0MxM0Q4MzFlYzcnLFxuICAgICAgICAgICAgdG9rZW5PdXRDaGFpbklkOiAxLFxuICAgICAgICAgICAgYW1vdW50OiBhd2FpdCBnZXRBbW91bnQoMSwgdHlwZSwgJ1VTRFQnLCAnVVNEVCcsICcxMDAnKSxcbiAgICAgICAgICAgIHR5cGUsXG4gICAgICAgICAgICByZWNpcGllbnQ6IGFsaWNlLmFkZHJlc3MsXG4gICAgICAgICAgICBzbGlwcGFnZVRvbGVyYW5jZTogU0xJUFBBR0UsXG4gICAgICAgICAgICBkZWFkbGluZTogJzM2MCcsXG4gICAgICAgICAgICBhbGdvcml0aG0sXG4gICAgICAgICAgICBlbmFibGVVbml2ZXJzYWxSb3V0ZXI6IHRydWUsXG4gICAgICAgICAgfVxuICAgICAgICAgIGF3YWl0IGNhbGxBbmRFeHBlY3RGYWlsKHF1b3RlUmVxLCB7XG4gICAgICAgICAgICBzdGF0dXM6IDQwMCxcbiAgICAgICAgICAgIGRhdGE6IHtcbiAgICAgICAgICAgICAgZGV0YWlsOiAndG9rZW5JbiBhbmQgdG9rZW5PdXQgbXVzdCBiZSBkaWZmZXJlbnQnLFxuICAgICAgICAgICAgICBlcnJvckNvZGU6ICdUT0tFTl9JTl9PVVRfU0FNRScsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIH0pXG4gICAgICAgIH0pXG5cbiAgICAgICAgaXQoYG9uZSBvZiByZWNpcGllbnQvZGVhZGxpbmUvc2xpcHBhZ2UgaXMgbWlzc2luZ2AsIGFzeW5jICgpID0+IHtcbiAgICAgICAgICBjb25zdCBxdW90ZVJlcTogUXVvdGVRdWVyeVBhcmFtcyA9IHtcbiAgICAgICAgICAgIHRva2VuSW5BZGRyZXNzOiAnVVNEQycsXG4gICAgICAgICAgICB0b2tlbkluQ2hhaW5JZDogMSxcbiAgICAgICAgICAgIHRva2VuT3V0QWRkcmVzczogJ1VTRFQnLFxuICAgICAgICAgICAgdG9rZW5PdXRDaGFpbklkOiAxLFxuICAgICAgICAgICAgYW1vdW50OiBhd2FpdCBnZXRBbW91bnQoMSwgdHlwZSwgJ1VTREMnLCAnVVNEVCcsICcxMDAnKSxcbiAgICAgICAgICAgIHR5cGUsXG4gICAgICAgICAgICBzbGlwcGFnZVRvbGVyYW5jZTogU0xJUFBBR0UsXG4gICAgICAgICAgICBkZWFkbGluZTogJzM2MCcsXG4gICAgICAgICAgICBhbGdvcml0aG0sXG4gICAgICAgICAgICBlbmFibGVVbml2ZXJzYWxSb3V0ZXI6IHRydWUsXG4gICAgICAgICAgfVxuICAgICAgICAgIGF3YWl0IGNhbGxBbmRFeHBlY3RGYWlsKHF1b3RlUmVxLCB7XG4gICAgICAgICAgICBzdGF0dXM6IDQwMCxcbiAgICAgICAgICAgIGRhdGE6IHtcbiAgICAgICAgICAgICAgZGV0YWlsOiAnXCJ2YWx1ZVwiIGNvbnRhaW5zIFtzbGlwcGFnZVRvbGVyYW5jZSwgZGVhZGxpbmVdIHdpdGhvdXQgaXRzIHJlcXVpcmVkIHBlZXJzIFtyZWNpcGllbnRdJyxcbiAgICAgICAgICAgICAgZXJyb3JDb2RlOiAnVkFMSURBVElPTl9FUlJPUicsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIH0pXG4gICAgICAgIH0pXG5cbiAgICAgICAgaXQoYHJlY2lwaWVudCBpcyBhbiBpbnZhbGlkIGFkZHJlc3NgLCBhc3luYyAoKSA9PiB7XG4gICAgICAgICAgY29uc3QgcXVvdGVSZXE6IFF1b3RlUXVlcnlQYXJhbXMgPSB7XG4gICAgICAgICAgICB0b2tlbkluQWRkcmVzczogJ1VTRFQnLFxuICAgICAgICAgICAgdG9rZW5JbkNoYWluSWQ6IDEsXG4gICAgICAgICAgICB0b2tlbk91dEFkZHJlc3M6ICdVU0RDJyxcbiAgICAgICAgICAgIHRva2VuT3V0Q2hhaW5JZDogMSxcbiAgICAgICAgICAgIGFtb3VudDogYXdhaXQgZ2V0QW1vdW50KDEsIHR5cGUsICdVU0RUJywgJ1VTREMnLCAnMTAwJyksXG4gICAgICAgICAgICB0eXBlLFxuICAgICAgICAgICAgcmVjaXBpZW50OiAnMHhBYjU4MDFhN0QzOTgzNTFiOGJFMTFDNDM5ZTA1QzVCMzI1OWFaWlpaWlpaJyxcbiAgICAgICAgICAgIHNsaXBwYWdlVG9sZXJhbmNlOiBTTElQUEFHRSxcbiAgICAgICAgICAgIGRlYWRsaW5lOiAnMzYwJyxcbiAgICAgICAgICAgIGFsZ29yaXRobSxcbiAgICAgICAgICAgIGVuYWJsZVVuaXZlcnNhbFJvdXRlcjogdHJ1ZSxcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBhd2FpdCBjYWxsQW5kRXhwZWN0RmFpbChxdW90ZVJlcSwge1xuICAgICAgICAgICAgc3RhdHVzOiA0MDAsXG4gICAgICAgICAgICBkYXRhOiB7XG4gICAgICAgICAgICAgIGRldGFpbDpcbiAgICAgICAgICAgICAgICAnXCJyZWNpcGllbnRcIiB3aXRoIHZhbHVlIFwiMHhBYjU4MDFhN0QzOTgzNTFiOGJFMTFDNDM5ZTA1QzVCMzI1OWFaWlpaWlpaXCIgZmFpbHMgdG8gbWF0Y2ggdGhlIHJlcXVpcmVkIHBhdHRlcm46IC9eMHhbYS1mQS1GMC05XXs0MH0kLycsXG4gICAgICAgICAgICAgIGVycm9yQ29kZTogJ1ZBTElEQVRJT05fRVJST1InLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICB9KVxuICAgICAgICB9KVxuXG4gICAgICAgIGl0KGB1bnN1cHBvcnRlZCBjaGFpbmAsIGFzeW5jICgpID0+IHtcbiAgICAgICAgICBjb25zdCBxdW90ZVJlcTogUXVvdGVRdWVyeVBhcmFtcyA9IHtcbiAgICAgICAgICAgIHRva2VuSW5BZGRyZXNzOiAnVVNEQycsXG4gICAgICAgICAgICB0b2tlbkluQ2hhaW5JZDogNzAsXG4gICAgICAgICAgICB0b2tlbk91dEFkZHJlc3M6ICdVU0RUJyxcbiAgICAgICAgICAgIHRva2VuT3V0Q2hhaW5JZDogNzAsXG4gICAgICAgICAgICBhbW91bnQ6ICcxMDAwMDAwMDAwMCcsXG4gICAgICAgICAgICB0eXBlLFxuICAgICAgICAgICAgcmVjaXBpZW50OiBhbGljZS5hZGRyZXNzLFxuICAgICAgICAgICAgc2xpcHBhZ2VUb2xlcmFuY2U6IFNMSVBQQUdFLFxuICAgICAgICAgICAgZGVhZGxpbmU6ICczNjAnLFxuICAgICAgICAgICAgYWxnb3JpdGhtLFxuICAgICAgICAgICAgZW5hYmxlVW5pdmVyc2FsUm91dGVyOiB0cnVlLFxuICAgICAgICAgIH1cblxuICAgICAgICAgIGNvbnN0IGNoYWlucyA9IFNVUFBPUlRFRF9DSEFJTlMudmFsdWVzKClcbiAgICAgICAgICBjb25zdCBjaGFpblN0ciA9IFsuLi5jaGFpbnNdLnRvU3RyaW5nKCkuc3BsaXQoJywnKS5qb2luKCcsICcpXG5cbiAgICAgICAgICBhd2FpdCBjYWxsQW5kRXhwZWN0RmFpbChxdW90ZVJlcSwge1xuICAgICAgICAgICAgc3RhdHVzOiA0MDAsXG4gICAgICAgICAgICBkYXRhOiB7XG4gICAgICAgICAgICAgIGRldGFpbDogYFwidG9rZW5JbkNoYWluSWRcIiBtdXN0IGJlIG9uZSBvZiBbJHtjaGFpblN0cn1dYCxcbiAgICAgICAgICAgICAgZXJyb3JDb2RlOiAnVkFMSURBVElPTl9FUlJPUicsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIH0pXG4gICAgICAgIH0pXG4gICAgICB9KVxuICAgIH1cbiAgfVxuXG4gIGNvbnN0IFRFU1RfRVJDMjBfMTogeyBbY2hhaW5JZCBpbiBDaGFpbklkXTogbnVsbCB8IFRva2VuIH0gPSB7XG4gICAgW0NoYWluSWQuTUFJTk5FVF06IFVTRENfT04oMSksXG4gICAgW0NoYWluSWQuUk9QU1RFTl06IFVTRENfT04oQ2hhaW5JZC5ST1BTVEVOKSxcbiAgICBbQ2hhaW5JZC5SSU5LRUJZXTogVVNEQ19PTihDaGFpbklkLlJJTktFQlkpLFxuICAgIFtDaGFpbklkLkfDllJMSV06IFVTRENfT04oQ2hhaW5JZC5Hw5ZSTEkpLFxuICAgIFtDaGFpbklkLktPVkFOXTogVVNEQ19PTihDaGFpbklkLktPVkFOKSxcbiAgICBbQ2hhaW5JZC5PUFRJTUlTTV06IFVTRENfT04oQ2hhaW5JZC5PUFRJTUlTTSksXG4gICAgW0NoYWluSWQuT1BUSU1JU1RJQ19LT1ZBTl06IFVTRENfT04oQ2hhaW5JZC5PUFRJTUlTVElDX0tPVkFOKSxcbiAgICBbQ2hhaW5JZC5PUFRJTUlTTV9HT0VSTEldOiBVU0RDX09OKENoYWluSWQuT1BUSU1JU01fR09FUkxJKSxcbiAgICBbQ2hhaW5JZC5BUkJJVFJVTV9PTkVdOiBVU0RDX09OKENoYWluSWQuQVJCSVRSVU1fT05FKSxcbiAgICBbQ2hhaW5JZC5BUkJJVFJVTV9SSU5LRUJZXTogVVNEQ19PTihDaGFpbklkLkFSQklUUlVNX1JJTktFQlkpLFxuICAgIFtDaGFpbklkLlBPTFlHT05dOiBVU0RDX09OKENoYWluSWQuUE9MWUdPTiksXG4gICAgW0NoYWluSWQuUE9MWUdPTl9NVU1CQUldOiBVU0RDX09OKENoYWluSWQuUE9MWUdPTl9NVU1CQUkpLFxuICAgIFtDaGFpbklkLkNFTE9dOiBDVVNEX0NFTE8sXG4gICAgW0NoYWluSWQuQ0VMT19BTEZBSk9SRVNdOiBDVVNEX0NFTE9fQUxGQUpPUkVTLFxuICAgIFtDaGFpbklkLk1PT05CRUFNXTogbnVsbCxcbiAgICBbQ2hhaW5JZC5HTk9TSVNdOiBudWxsLFxuICAgIFtDaGFpbklkLkFSQklUUlVNX0dPRVJMSV06IG51bGwsXG4gICAgW0NoYWluSWQuQlNDXTogVVNEQ19PTihDaGFpbklkLkJTQyksXG4gICAgW0NoYWluSWQuRkFOVE9NXTogVVNEQ19PTihDaGFpbklkLkZBTlRPTSksXG4gICAgW0NoYWluSWQuS0xBWVROXTogVVNEQ19PTihDaGFpbklkLktMQVlUTiksXG4gIH1cblxuICBjb25zdCBURVNUX0VSQzIwXzI6IHsgW2NoYWluSWQgaW4gQ2hhaW5JZF06IFRva2VuIHwgbnVsbCB9ID0ge1xuICAgIFtDaGFpbklkLk1BSU5ORVRdOiBEQUlfT04oMSksXG4gICAgW0NoYWluSWQuUk9QU1RFTl06IERBSV9PTihDaGFpbklkLlJPUFNURU4pLFxuICAgIFtDaGFpbklkLlJJTktFQlldOiBEQUlfT04oQ2hhaW5JZC5SSU5LRUJZKSxcbiAgICBbQ2hhaW5JZC5Hw5ZSTEldOiBEQUlfT04oQ2hhaW5JZC5Hw5ZSTEkpLFxuICAgIFtDaGFpbklkLktPVkFOXTogREFJX09OKENoYWluSWQuS09WQU4pLFxuICAgIFtDaGFpbklkLk9QVElNSVNNXTogREFJX09OKENoYWluSWQuT1BUSU1JU00pLFxuICAgIFtDaGFpbklkLk9QVElNSVNUSUNfS09WQU5dOiBEQUlfT04oQ2hhaW5JZC5PUFRJTUlTVElDX0tPVkFOKSxcbiAgICBbQ2hhaW5JZC5PUFRJTUlTTV9HT0VSTEldOiBEQUlfT04oQ2hhaW5JZC5PUFRJTUlTTV9HT0VSTEkpLFxuICAgIFtDaGFpbklkLkFSQklUUlVNX09ORV06IERBSV9PTihDaGFpbklkLkFSQklUUlVNX09ORSksXG4gICAgW0NoYWluSWQuQVJCSVRSVU1fUklOS0VCWV06IERBSV9PTihDaGFpbklkLkFSQklUUlVNX1JJTktFQlkpLFxuICAgIFtDaGFpbklkLlBPTFlHT05dOiBEQUlfT04oQ2hhaW5JZC5QT0xZR09OKSxcbiAgICBbQ2hhaW5JZC5QT0xZR09OX01VTUJBSV06IERBSV9PTihDaGFpbklkLlBPTFlHT05fTVVNQkFJKSxcbiAgICBbQ2hhaW5JZC5DRUxPXTogQ0VVUl9DRUxPLFxuICAgIFtDaGFpbklkLkNFTE9fQUxGQUpPUkVTXTogQ0VVUl9DRUxPX0FMRkFKT1JFUyxcbiAgICBbQ2hhaW5JZC5NT09OQkVBTV06IG51bGwsXG4gICAgW0NoYWluSWQuR05PU0lTXTogbnVsbCxcbiAgICBbQ2hhaW5JZC5BUkJJVFJVTV9HT0VSTEldOiBudWxsLFxuICAgIFtDaGFpbklkLkJTQ106IFVTRFRfT04oQ2hhaW5JZC5CU0MpLFxuICAgIFtDaGFpbklkLkZBTlRPTV06IFVTRFRfT04oQ2hhaW5JZC5GQU5UT00pLFxuICAgIFtDaGFpbklkLktMQVlUTl06IFVTRFRfT04oQ2hhaW5JZC5LTEFZVE4pLFxuICB9XG5cbiAgLy8gVE9ETzogRmluZCB2YWxpZCBwb29scy90b2tlbnMgb24gb3B0aW1pc3RpYyBrb3ZhbiBhbmQgcG9seWdvbiBtdW1iYWkuIFdlIHNraXAgdGhvc2UgdGVzdHMgZm9yIG5vdy5cbiAgZm9yIChjb25zdCBjaGFpbiBvZiBfLmZpbHRlcihcbiAgICBTVVBQT1JURURfQ0hBSU5TLFxuICAgIChjKSA9PlxuICAgICAgYyAhPSBDaGFpbklkLk9QVElNSVNUSUNfS09WQU4gJiZcbiAgICAgIGMgIT0gQ2hhaW5JZC5QT0xZR09OX01VTUJBSSAmJlxuICAgICAgYyAhPSBDaGFpbklkLkFSQklUUlVNX1JJTktFQlkgJiZcbiAgICAgIGMgIT0gQ2hhaW5JZC5BUkJJVFJVTV9HT0VSTEkgJiZcbiAgICAgIGMgIT0gQ2hhaW5JZC5DRUxPX0FMRkFKT1JFUyAmJlxuICAgICAgYyAhPSBDaGFpbklkLktPVkFOICYmXG4gICAgICBjICE9IENoYWluSWQuUklOS0VCWSAmJlxuICAgICAgYyAhPSBDaGFpbklkLlJPUFNURU4gJiZcbiAgICAgIGMgIT0gQ2hhaW5JZC5Hw5ZSTElcbiAgKSkge1xuICAgIGZvciAoY29uc3QgdHlwZSBvZiBbJ2V4YWN0SW4nLCAnZXhhY3RPdXQnXSkge1xuICAgICAgY29uc3QgZXJjMSA9IFRFU1RfRVJDMjBfMVtjaGFpbl1cbiAgICAgIGNvbnN0IGVyYzIgPSBURVNUX0VSQzIwXzJbY2hhaW5dXG5cbiAgICAgIC8vIFRoaXMgaXMgZm9yIEdub3NpcyBhbmQgTW9vbmJlYW0gd2hpY2ggd2UgZG9uJ3QgaGF2ZSBSUEMgUHJvdmlkZXJzIHlldFxuICAgICAgaWYgKGVyYzEgPT0gbnVsbCB8fCBlcmMyID09IG51bGwpIGNvbnRpbnVlXG5cbiAgICAgIGRlc2NyaWJlKGAke0lEX1RPX05FVFdPUktfTkFNRShjaGFpbil9ICR7dHlwZX0gMnh4YCwgZnVuY3Rpb24gKCkge1xuICAgICAgICAvLyBIZWxwIHdpdGggdGVzdCBmbGFraW5lc3MgYnkgcmV0cnlpbmcuXG4gICAgICAgIHRoaXMucmV0cmllcygwKVxuICAgICAgICBjb25zdCB3cmFwcGVkTmF0aXZlID0gV05BVElWRV9PTihjaGFpbilcblxuICAgICAgICBpdChgJHt3cmFwcGVkTmF0aXZlLnN5bWJvbH0gLT4gZXJjMjBgLCBhc3luYyAoKSA9PiB7XG4gICAgICAgICAgY29uc3QgcXVvdGVSZXE6IFF1b3RlUXVlcnlQYXJhbXMgPSB7XG4gICAgICAgICAgICB0b2tlbkluQWRkcmVzczogd3JhcHBlZE5hdGl2ZS5hZGRyZXNzLFxuICAgICAgICAgICAgdG9rZW5JbkNoYWluSWQ6IGNoYWluLFxuICAgICAgICAgICAgdG9rZW5PdXRBZGRyZXNzOiBlcmMxLmFkZHJlc3MsXG4gICAgICAgICAgICB0b2tlbk91dENoYWluSWQ6IGNoYWluLFxuICAgICAgICAgICAgYW1vdW50OiBhd2FpdCBnZXRBbW91bnRGcm9tVG9rZW4odHlwZSwgd3JhcHBlZE5hdGl2ZSwgZXJjMSwgJzEnKSxcbiAgICAgICAgICAgIHR5cGUsXG4gICAgICAgICAgICBlbmFibGVVbml2ZXJzYWxSb3V0ZXI6IHRydWUsXG4gICAgICAgICAgfVxuXG4gICAgICAgICAgY29uc3QgcXVlcnlQYXJhbXMgPSBxcy5zdHJpbmdpZnkocXVvdGVSZXEpXG5cbiAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgY29uc3QgcmVzcG9uc2U6IEF4aW9zUmVzcG9uc2U8UXVvdGVSZXNwb25zZT4gPSBhd2FpdCBheGlvcy5nZXQ8UXVvdGVSZXNwb25zZT4oYCR7QVBJfT8ke3F1ZXJ5UGFyYW1zfWApXG4gICAgICAgICAgICBjb25zdCB7IHN0YXR1cyB9ID0gcmVzcG9uc2VcblxuICAgICAgICAgICAgZXhwZWN0KHN0YXR1cykudG8uZXF1YWwoMjAwKVxuICAgICAgICAgIH0gY2F0Y2ggKGVycjogYW55KSB7XG4gICAgICAgICAgICBmYWlsKEpTT04uc3RyaW5naWZ5KGVyci5yZXNwb25zZS5kYXRhKSlcbiAgICAgICAgICB9XG4gICAgICAgIH0pXG5cbiAgICAgICAgaXQoYGVyYzIwIC0+IGVyYzIwYCwgYXN5bmMgKCkgPT4ge1xuICAgICAgICAgIGNvbnN0IHF1b3RlUmVxOiBRdW90ZVF1ZXJ5UGFyYW1zID0ge1xuICAgICAgICAgICAgdG9rZW5JbkFkZHJlc3M6IGVyYzEuYWRkcmVzcyxcbiAgICAgICAgICAgIHRva2VuSW5DaGFpbklkOiBjaGFpbixcbiAgICAgICAgICAgIHRva2VuT3V0QWRkcmVzczogZXJjMi5hZGRyZXNzLFxuICAgICAgICAgICAgdG9rZW5PdXRDaGFpbklkOiBjaGFpbixcbiAgICAgICAgICAgIGFtb3VudDogYXdhaXQgZ2V0QW1vdW50RnJvbVRva2VuKHR5cGUsIGVyYzEsIGVyYzIsICcxJyksXG4gICAgICAgICAgICB0eXBlLFxuICAgICAgICAgIH1cblxuICAgICAgICAgIGNvbnN0IHF1ZXJ5UGFyYW1zID0gcXMuc3RyaW5naWZ5KHF1b3RlUmVxKVxuXG4gICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGNvbnN0IHJlc3BvbnNlOiBBeGlvc1Jlc3BvbnNlPFF1b3RlUmVzcG9uc2U+ID0gYXdhaXQgYXhpb3MuZ2V0PFF1b3RlUmVzcG9uc2U+KGAke0FQSX0/JHtxdWVyeVBhcmFtc31gKVxuICAgICAgICAgICAgY29uc3QgeyBzdGF0dXMgfSA9IHJlc3BvbnNlXG5cbiAgICAgICAgICAgIGV4cGVjdChzdGF0dXMpLnRvLmVxdWFsKDIwMClcbiAgICAgICAgICB9IGNhdGNoIChlcnI6IGFueSkge1xuICAgICAgICAgICAgZmFpbChKU09OLnN0cmluZ2lmeShlcnIucmVzcG9uc2UuZGF0YSkpXG4gICAgICAgICAgfVxuICAgICAgICB9KVxuICAgICAgICBjb25zdCBuYXRpdmUgPSBOQVRJVkVfQ1VSUkVOQ1lbY2hhaW5dXG4gICAgICAgIGl0KGAke25hdGl2ZX0gLT4gZXJjMjBgLCBhc3luYyAoKSA9PiB7XG4gICAgICAgICAgY29uc3QgcXVvdGVSZXE6IFF1b3RlUXVlcnlQYXJhbXMgPSB7XG4gICAgICAgICAgICB0b2tlbkluQWRkcmVzczogbmF0aXZlLFxuICAgICAgICAgICAgdG9rZW5JbkNoYWluSWQ6IGNoYWluLFxuICAgICAgICAgICAgdG9rZW5PdXRBZGRyZXNzOiBlcmMyLmFkZHJlc3MsXG4gICAgICAgICAgICB0b2tlbk91dENoYWluSWQ6IGNoYWluLFxuICAgICAgICAgICAgYW1vdW50OiBhd2FpdCBnZXRBbW91bnRGcm9tVG9rZW4odHlwZSwgV05BVElWRV9PTihjaGFpbiksIGVyYzIsICcxJyksXG4gICAgICAgICAgICB0eXBlLFxuICAgICAgICAgICAgZW5hYmxlVW5pdmVyc2FsUm91dGVyOiB0cnVlLFxuICAgICAgICAgIH1cblxuICAgICAgICAgIGNvbnN0IHF1ZXJ5UGFyYW1zID0gcXMuc3RyaW5naWZ5KHF1b3RlUmVxKVxuICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICBjb25zdCByZXNwb25zZTogQXhpb3NSZXNwb25zZTxRdW90ZVJlc3BvbnNlPiA9IGF3YWl0IGF4aW9zLmdldDxRdW90ZVJlc3BvbnNlPihgJHtBUEl9PyR7cXVlcnlQYXJhbXN9YClcbiAgICAgICAgICAgIGNvbnN0IHsgc3RhdHVzIH0gPSByZXNwb25zZVxuXG4gICAgICAgICAgICBleHBlY3Qoc3RhdHVzKS50by5lcXVhbCgyMDAsIEpTT04uc3RyaW5naWZ5KHJlc3BvbnNlLmRhdGEpKVxuICAgICAgICAgIH0gY2F0Y2ggKGVycjogYW55KSB7XG4gICAgICAgICAgICBmYWlsKEpTT04uc3RyaW5naWZ5KGVyci5yZXNwb25zZS5kYXRhKSlcbiAgICAgICAgICB9XG4gICAgICAgIH0pXG4gICAgICAgIGl0KGBoYXMgcXVvdGVHYXNBZGp1c3RlZCB2YWx1ZXNgLCBhc3luYyAoKSA9PiB7XG4gICAgICAgICAgY29uc3QgcXVvdGVSZXE6IFF1b3RlUXVlcnlQYXJhbXMgPSB7XG4gICAgICAgICAgICB0b2tlbkluQWRkcmVzczogZXJjMS5hZGRyZXNzLFxuICAgICAgICAgICAgdG9rZW5JbkNoYWluSWQ6IGNoYWluLFxuICAgICAgICAgICAgdG9rZW5PdXRBZGRyZXNzOiBlcmMyLmFkZHJlc3MsXG4gICAgICAgICAgICB0b2tlbk91dENoYWluSWQ6IGNoYWluLFxuICAgICAgICAgICAgYW1vdW50OiBhd2FpdCBnZXRBbW91bnRGcm9tVG9rZW4odHlwZSwgZXJjMSwgZXJjMiwgJzEnKSxcbiAgICAgICAgICAgIHR5cGUsXG4gICAgICAgICAgfVxuXG4gICAgICAgICAgY29uc3QgcXVlcnlQYXJhbXMgPSBxcy5zdHJpbmdpZnkocXVvdGVSZXEpXG5cbiAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgY29uc3QgcmVzcG9uc2U6IEF4aW9zUmVzcG9uc2U8UXVvdGVSZXNwb25zZT4gPSBhd2FpdCBheGlvcy5nZXQ8UXVvdGVSZXNwb25zZT4oYCR7QVBJfT8ke3F1ZXJ5UGFyYW1zfWApXG4gICAgICAgICAgICBjb25zdCB7XG4gICAgICAgICAgICAgIGRhdGE6IHsgcXVvdGVEZWNpbWFscywgcXVvdGVHYXNBZGp1c3RlZERlY2ltYWxzIH0sXG4gICAgICAgICAgICAgIHN0YXR1cyxcbiAgICAgICAgICAgIH0gPSByZXNwb25zZVxuXG4gICAgICAgICAgICBleHBlY3Qoc3RhdHVzKS50by5lcXVhbCgyMDApXG5cbiAgICAgICAgICAgIC8vIGNoZWNrIGZvciBxdW90ZXMgdG8gYmUgZ2FzIGFkanVzdGVkXG4gICAgICAgICAgICBpZiAodHlwZSA9PSAnZXhhY3RJbicpIHtcbiAgICAgICAgICAgICAgZXhwZWN0KHBhcnNlRmxvYXQocXVvdGVHYXNBZGp1c3RlZERlY2ltYWxzKSkudG8uYmUubGVzc1RoYW5PckVxdWFsKHBhcnNlRmxvYXQocXVvdGVEZWNpbWFscykpXG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICBleHBlY3QocGFyc2VGbG9hdChxdW90ZUdhc0FkanVzdGVkRGVjaW1hbHMpKS50by5iZS5ncmVhdGVyVGhhbk9yRXF1YWwocGFyc2VGbG9hdChxdW90ZURlY2ltYWxzKSlcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9IGNhdGNoIChlcnI6IGFueSkge1xuICAgICAgICAgICAgZmFpbChKU09OLnN0cmluZ2lmeShlcnIucmVzcG9uc2UuZGF0YSkpXG4gICAgICAgICAgfVxuICAgICAgICB9KVxuICAgICAgfSlcbiAgICB9XG4gIH1cbn0pXG5cbmRlc2NyaWJlKCdhbHBoYSBvbmx5IHF1b3RlJywgZnVuY3Rpb24gKCkge1xuICB0aGlzLnRpbWVvdXQoNTAwMClcblxuICBmb3IgKGNvbnN0IHR5cGUgb2YgWydleGFjdEluJywgJ2V4YWN0T3V0J10pIHtcbiAgICBkZXNjcmliZShgJHt0eXBlfSAyeHhgLCAoKSA9PiB7fSlcbiAgfVxufSlcbiJdfQ==