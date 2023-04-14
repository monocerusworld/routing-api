import { CurrencyAmount, Ether, Fraction, WETH9 } from '@uniswap/sdk-core';
import { CEUR_CELO, CEUR_CELO_ALFAJORES, ChainId, CUSD_CELO, CUSD_CELO_ALFAJORES, DAI_MAINNET, ID_TO_NETWORK_NAME, NATIVE_CURRENCY, parseAmount, USDC_MAINNET, USDT_MAINNET, WBTC_MAINNET, } from '@tartz-one/smart-order-router';
import { Pool, Position } from '@uniswap/v3-sdk';
import { fail } from 'assert';
import axios from 'axios';
import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import chaiSubset from 'chai-subset';
import { BigNumber } from 'ethers';
import hre from 'hardhat';
import JSBI from 'jsbi';
import _ from 'lodash';
import qs from 'qs';
import { SUPPORTED_CHAINS } from '../../lib/handlers/injector-sor';
import { parseSlippageTolerance } from '../../lib/handlers/shared';
import { absoluteValue } from '../utils/absoluteValue';
import { resetAndFundAtBlock } from '../utils/forkAndFund';
import { getBalance, getBalanceAndApprove, getBalanceOfAddress } from '../utils/getBalanceAndApprove';
import { minimumAmountOut } from '../utils/minimumAmountOut';
import { getTestParamsFromEvents, parseEvents } from '../utils/parseEvents';
import { FeeAmount, getMaxTick, getMinTick, TICK_SPACINGS } from '../utils/ticks';
import { DAI_ON, UNI_MAINNET, USDC_ON, USDT_ON, WNATIVE_ON } from '../utils/tokens';
const { ethers } = hre;
chai.use(chaiAsPromised);
chai.use(chaiSubset);
const API = `${process.env.UNISWAP_ROUTING_API}quoteToRatio`;
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
function parseFraction(fraction) {
    return new Fraction(JSBI.BigInt(fraction.numerator), JSBI.BigInt(fraction.denominator));
}
const SWAP_ROUTER_V2 = '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45';
describe('quote-to-ratio', async function () {
    // Help with test flakiness by retrying.
    this.retries(2);
    this.timeout(10000);
    // chain parameters
    let alice;
    let block;
    // request parameters
    let quoteToRatioParams;
    let response;
    const DEFAULT_QUERY_PARAMS = {
        token0Address: DAI_MAINNET.address,
        token0ChainId: 1,
        token1Address: USDC_MAINNET.address,
        token1ChainId: 1,
        token0Balance: parseAmount('5000', DAI_MAINNET).quotient.toString(),
        token1Balance: parseAmount('2000', USDC_MAINNET).quotient.toString(),
        tickLower: getMinTick(TICK_SPACINGS[FeeAmount.LOW]),
        tickUpper: getMaxTick(TICK_SPACINGS[FeeAmount.LOW]),
        feeAmount: FeeAmount.LOW,
        recipient: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
        slippageTolerance: '5',
        deadline: '360',
        ratioErrorTolerance: 1,
        maxIterations: 6,
        addLiquidityRecipient: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266', // alice address
    };
    const errorToleranceFraction = (ratioErrorTolerance) => {
        return new Fraction(ratioErrorTolerance * 100, 10000);
    };
    const executeSwapAndAdd = async (pool, methodParameters, currencyIn, currencyOut) => {
        let currency0, currency1;
        currencyIn.wrapped.sortsBefore(currencyOut.wrapped)
            ? ([currency0, currency1] = [currencyIn, currencyOut])
            : ([currency0, currency1] = [currencyOut, currencyIn]);
        const token0BeforeAlice = await getBalanceAndApprove(alice, SWAP_ROUTER_V2, currency0);
        const token1BeforeAlice = await getBalanceAndApprove(alice, SWAP_ROUTER_V2, currency1);
        const token0BeforePool = await getBalanceOfAddress(alice, pool, currency0.wrapped);
        const token1BeforePool = await getBalanceOfAddress(alice, pool, currency1.wrapped);
        const transaction = {
            data: methodParameters.calldata,
            to: SWAP_ROUTER_V2,
            value: BigNumber.from(methodParameters.value),
            from: alice.address,
            gasPrice: BigNumber.from(2000000000000),
            type: 1,
        };
        const transactionResponse = await alice.sendTransaction(transaction);
        const txReceipt = await transactionResponse.wait();
        const events = parseEvents(txReceipt, [
            SWAP_ROUTER_V2,
            pool,
            alice.address,
            currency0.wrapped.address,
            currency1.wrapped.address,
        ]);
        const token0AfterPool = await getBalanceOfAddress(alice, pool, currency0.wrapped);
        const token1AfterPool = await getBalanceOfAddress(alice, pool, currency1.wrapped);
        const token0AfterAlice = await getBalance(alice, currency0);
        const token1AfterAlice = await getBalance(alice, currency1);
        const swapRouterFinalBalance0 = await getBalanceOfAddress(alice, SWAP_ROUTER_V2, currency0.wrapped);
        const swapRouterFinalBalance1 = await getBalanceOfAddress(alice, SWAP_ROUTER_V2, currency1.wrapped);
        return {
            token0AfterAlice,
            token0BeforeAlice,
            token1AfterAlice,
            token1BeforeAlice,
            token0AfterPool,
            token0BeforePool,
            token1AfterPool,
            token1BeforePool,
            swapRouterFinalBalance0,
            swapRouterFinalBalance1,
            events,
        };
    };
    async function testSuccessfulContractExecution(response, params, token0, token1, zeroForOne) {
        const { tickLower, tickUpper, feeAmount, slippageTolerance, token0Balance: token0BalanceStr, token1Balance: token1BalanceStr, } = params;
        const token0Balance = CurrencyAmount.fromRawAmount(token0, JSBI.BigInt(token0BalanceStr));
        const token1Balance = CurrencyAmount.fromRawAmount(token1, JSBI.BigInt(token1BalanceStr));
        const { data: { amount, quote, methodParameters, postSwapTargetPool, token0BalanceUpdated, token1BalanceUpdated }, } = response;
        const [tokenIn, tokenOut] = zeroForOne ? [token0, token1] : [token1, token0];
        const postSwapPool = new Pool(token0.wrapped, token1.wrapped, feeAmount, postSwapTargetPool.sqrtRatioX96, postSwapTargetPool.liquidity, parseInt(postSwapTargetPool.tickCurrent));
        const { token0BeforeAlice, token0AfterAlice, token1BeforeAlice, token1AfterAlice, token0BeforePool, token0AfterPool, token1BeforePool, token1AfterPool, swapRouterFinalBalance0, swapRouterFinalBalance1, events, } = await executeSwapAndAdd(postSwapTargetPool.address, methodParameters, token0, token1);
        const { 
        // total amounts transferred from alice. including amounts transferred back as a result of dust
        amount0TransferredFromAlice, amount1TransferredFromAlice, amount0SwappedInPool, amount1SwappedInPool, onChainPosition, } = getTestParamsFromEvents(events, token0.wrapped, token1.wrapped, alice.address, postSwapTargetPool.address);
        // alice's balance differences after entire completed transaction
        const amount0DiffAlice = token0BeforeAlice.subtract(token0AfterAlice);
        const amount1DiffAlice = token1BeforeAlice.subtract(token1AfterAlice);
        const currencyInSwapped = CurrencyAmount.fromRawAmount(tokenIn, JSBI.BigInt(amount));
        const currencyOutQuote = CurrencyAmount.fromRawAmount(tokenOut, JSBI.BigInt(quote));
        const newPoolBalance0 = token0AfterPool.subtract(token0BeforePool);
        const newPoolBalance1 = token1AfterPool.subtract(token1BeforePool);
        const mintedPositionQuoted = Position.fromAmounts({
            pool: postSwapPool,
            tickLower,
            tickUpper,
            amount0: token0BalanceUpdated,
            amount1: token1BalanceUpdated,
            useFullPrecision: true,
        });
        const { amount0: minPositionAmount0, amount1: minPositionAmount1 } = mintedPositionQuoted.mintAmountsWithSlippage(parseSlippageTolerance(slippageTolerance));
        // collect position with minimum amount out from swap with max slippage. Min amounts added to position
        // will either be mintAmountsWithSlippage for quoted position OR amounts resulting from minimum possible amount quoted from swap.
        // the lesser of the two, since mintAmountsWithSlippage can be undependable in certain scenarios, specifically involving out-of-range positions
        const amountOutMaxSwapSlippage = minimumAmountOut(parseSlippageTolerance(slippageTolerance), currencyOutQuote);
        const mintedPositionMaxSwapSlippage = Position.fromAmounts({
            pool: postSwapPool,
            tickLower,
            tickUpper,
            amount0: zeroForOne ? token0BalanceUpdated : amountOutMaxSwapSlippage.quotient,
            amount1: zeroForOne ? amountOutMaxSwapSlippage.quotient : token1BalanceUpdated,
            useFullPrecision: true,
        });
        // make sure we never transfer more than the user-stated available balance
        expect(!amount0TransferredFromAlice.greaterThan(token0Balance)).to.be.true;
        expect(!amount1TransferredFromAlice.greaterThan(token1Balance)).to.be.true;
        // make sure router has no funds left
        expect(swapRouterFinalBalance0.quotient.toString()).to.equal('0');
        expect(swapRouterFinalBalance1.quotient.toString()).to.equal('0');
        // total amountIn pulled but not swapped now lives in the position
        // with native currency, other checks should suffice, gas effects these numbers.
        if (zeroForOne && amount0DiffAlice.currency.symbol !== 'ETH') {
            expect(amount0DiffAlice.subtract(currencyInSwapped).quotient.toString()).to.equal(newPoolBalance0.subtract(amount0SwappedInPool).quotient.toString());
        }
        else if (amount1DiffAlice.currency.symbol !== 'ETH') {
            expect(amount1DiffAlice.subtract(currencyInSwapped).quotient.toString()).to.equal(newPoolBalance1.subtract(amount1SwappedInPool).quotient.toString());
        }
        // check position details
        expect(onChainPosition.amount0.quotient.toString()).to.equal(newPoolBalance0.subtract(amount0SwappedInPool).quotient.toString());
        expect(onChainPosition.amount1.quotient.toString()).to.equal(newPoolBalance1.subtract(amount1SwappedInPool).quotient.toString());
        // check only for newly minted positions
        if (onChainPosition.newMint) {
            expect(onChainPosition.owner).to.equal(alice.address);
            expect(onChainPosition.tickLower).to.equal(tickLower);
            expect(onChainPosition.tickUpper).to.equal(tickUpper);
        }
        // check slippage tolerance was not hit
        const min0 = mintedPositionMaxSwapSlippage.amount0.lessThan(minPositionAmount0)
            ? mintedPositionMaxSwapSlippage.amount0
            : minPositionAmount0;
        const min1 = mintedPositionMaxSwapSlippage.amount1.lessThan(minPositionAmount1)
            ? mintedPositionMaxSwapSlippage.amount1
            : minPositionAmount1;
        expect(!onChainPosition.amount0.lessThan(min0)).to.be.true;
        expect(!onChainPosition.amount1.lessThan(min1)).to.be.true;
    }
    before('generate blockchain fork', async function () {
        this.timeout(40000);
        [alice] = await ethers.getSigners();
        // Make a dummy call to the API to get a block number to fork from.
        const quoteToRatioRec = DEFAULT_QUERY_PARAMS;
        const queryParams = qs.stringify(quoteToRatioRec);
        const response = await axios.get(`${API}?${queryParams}`);
        const { data: { blockNumber }, } = response;
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
    const SUCCESS_TEST_CASES = [
        {
            testCase: 'erc20 -> erc20 low volume trade token0Excess',
            token0: DAI_MAINNET,
            token1: USDC_MAINNET,
            zeroForOne: true,
            requestParams: DEFAULT_QUERY_PARAMS,
        },
        {
            testCase: 'erc20 -> erc20 high volume trade token0Excess',
            token0: DAI_MAINNET,
            token1: USDC_MAINNET,
            zeroForOne: true,
            requestParams: {
                ...DEFAULT_QUERY_PARAMS,
                token0Balance: parseAmount('1000000', DAI_MAINNET).quotient.toString(),
                token1Balance: parseAmount('2000', USDC_MAINNET).quotient.toString(),
                slippageTolerance: '0.05',
            },
        },
        {
            testCase: 'erc20 -> erc20 low volume trade token1Excess',
            token0: DAI_MAINNET,
            token1: USDC_MAINNET,
            zeroForOne: false,
            requestParams: {
                ...DEFAULT_QUERY_PARAMS,
                token0Balance: parseAmount('2000', DAI_MAINNET).quotient.toString(),
                token1Balance: parseAmount('5000', USDC_MAINNET).quotient.toString(),
            },
        },
        {
            testCase: 'erc20 -> erc20 high volume trade token1Excess',
            token0: DAI_MAINNET,
            token1: USDC_MAINNET,
            zeroForOne: false,
            requestParams: {
                ...DEFAULT_QUERY_PARAMS,
                token0Balance: parseAmount('2000', DAI_MAINNET).quotient.toString(),
                token1Balance: parseAmount('2000000', USDC_MAINNET).quotient.toString(),
            },
        },
        {
            testCase: 'erc20 -> erc20 range order position token0 excess',
            token0: DAI_MAINNET,
            token1: USDC_MAINNET,
            zeroForOne: true,
            requestParams: {
                ...DEFAULT_QUERY_PARAMS,
                token0Balance: parseAmount('50000', DAI_MAINNET).quotient.toString(),
                token1Balance: parseAmount('2000', USDC_MAINNET).quotient.toString(),
                tickLower: -286420,
                tickUpper: -276420,
            },
        },
        {
            testCase: 'erc20 -> erc20 range order position token1 excess',
            token0: DAI_MAINNET,
            token1: USDC_MAINNET,
            zeroForOne: false,
            requestParams: {
                ...DEFAULT_QUERY_PARAMS,
                token0Balance: parseAmount('2000', DAI_MAINNET).quotient.toString(),
                token1Balance: parseAmount('50000', USDC_MAINNET).quotient.toString(),
                tickLower: 0,
                tickUpper: 60,
            },
        },
        {
            testCase: 'erc20 -> eth',
            token0: DAI_MAINNET,
            token1: Ether.onChain(1),
            zeroForOne: true,
            requestParams: {
                ...DEFAULT_QUERY_PARAMS,
                token1Address: 'ETH',
                token0Balance: parseAmount('10000', DAI_MAINNET).quotient.toString(),
                token1Balance: parseAmount('1', WETH9[1]).quotient.toString(),
            },
        },
        {
            testCase: 'eth -> erc20',
            token0: DAI_MAINNET,
            token1: Ether.onChain(1),
            zeroForOne: false,
            requestParams: {
                ...DEFAULT_QUERY_PARAMS,
                token1Address: 'ETH',
                token0Balance: parseAmount('1000', DAI_MAINNET).quotient.toString(),
                token1Balance: parseAmount('3', Ether.onChain(1)).quotient.toString(),
            },
        },
    ];
    for (const { testCase, token0, token1, zeroForOne, requestParams } of SUCCESS_TEST_CASES) {
        describe(testCase, () => {
            before(async function () {
                const queryParams = qs.stringify(requestParams);
                response = await axios.get(`${API}?${queryParams}`);
            });
            it('generates a legitimate trade with routing-api', async function () {
                const { data: { tokenInAddress, tokenOutAddress, newRatioFraction, optimalRatioFraction }, status, } = response;
                const newRatio = parseFraction(newRatioFraction);
                const optimalRatio = parseFraction(optimalRatioFraction);
                const ratioDeviation = absoluteValue(new Fraction(1, 1).subtract(newRatio.divide(optimalRatio)));
                const ratioErrorToleranceFraction = errorToleranceFraction(requestParams.ratioErrorTolerance);
                expect(status).to.equal(200, JSON.stringify(response.data));
                expect(!ratioDeviation.greaterThan(ratioErrorToleranceFraction)).to.equal(true, JSON.stringify(response.data));
                if (zeroForOne) {
                    expect(tokenInAddress.toLowerCase()).to.equal(token0.wrapped.address.toLowerCase());
                    expect(tokenOutAddress.toLowerCase()).to.equal(token1.wrapped.address.toLowerCase());
                }
                else {
                    expect(tokenInAddress.toLowerCase()).to.equal(token1.wrapped.address.toLowerCase());
                    expect(tokenOutAddress.toLowerCase()).to.equal(token0.wrapped.address.toLowerCase());
                }
            });
            it('executes properly at the contract level', async function () {
                await testSuccessfulContractExecution(response, requestParams, token0, token1, zeroForOne);
            });
        });
    }
    // ALL tests in this block are subsequent and must be run together
    describe('when adding to an existing position', async () => {
        let tokenId;
        // before hook times out. This test needed for subsequent tests in this block.
        it('first mint new position', async () => {
            const token0Balance = parseAmount('2000', DAI_MAINNET).quotient.toString();
            const token1Balance = parseAmount('5000', USDC_MAINNET).quotient.toString();
            quoteToRatioParams = {
                ...DEFAULT_QUERY_PARAMS,
                token0Balance,
                token1Balance,
            };
            const queryParams = qs.stringify(quoteToRatioParams);
            response = await axios.get(`${API}?${queryParams}`);
            const { data: { methodParameters, postSwapTargetPool }, } = response;
            const { events } = await executeSwapAndAdd(postSwapTargetPool.address, methodParameters, DAI_MAINNET, USDC_MAINNET);
            const { onChainPosition } = getTestParamsFromEvents(events, DAI_MAINNET, USDC_MAINNET, alice.address, postSwapTargetPool.address);
            tokenId = onChainPosition.tokenId.toString();
        });
        it('generates a legitimate trade with routing-api', async () => {
            const token0Balance = parseAmount('3000', DAI_MAINNET).quotient.toString();
            const token1Balance = parseAmount('8000', USDC_MAINNET).quotient.toString();
            const addLiquidityTokenId = tokenId;
            const addLiquidityRecipient = undefined;
            quoteToRatioParams = {
                ...DEFAULT_QUERY_PARAMS,
                token0Balance,
                token1Balance,
                addLiquidityTokenId,
                addLiquidityRecipient,
            };
            const queryParams = qs.stringify(quoteToRatioParams);
            response = await axios.get(`${API}?${queryParams}`);
            const { data: { tokenInAddress, tokenOutAddress, newRatioFraction, optimalRatioFraction }, status, } = response;
            const newRatio = parseFraction(newRatioFraction);
            const optimalRatio = parseFraction(optimalRatioFraction);
            const ratioDeviation = absoluteValue(new Fraction(1, 1).subtract(newRatio.divide(optimalRatio)));
            const ratioErrorToleranceFraction = errorToleranceFraction(quoteToRatioParams.ratioErrorTolerance);
            expect(status).to.equal(200, JSON.stringify(response.data));
            expect(ratioDeviation.lessThan(ratioErrorToleranceFraction)).to.be.true;
            expect(tokenInAddress.toLowerCase()).to.equal(USDC_MAINNET.address.toLowerCase());
            expect(tokenOutAddress.toLowerCase()).to.equal(DAI_MAINNET.address.toLowerCase());
        });
        it('successfully executes at the contract level', async () => {
            const zeroForOne = false;
            await testSuccessfulContractExecution(response, quoteToRatioParams, DAI_MAINNET, USDC_MAINNET, zeroForOne);
        });
    });
    describe('4xx Error response', () => {
        const ERROR_TEST_CASES = [
            {
                testCase: 'when both balances are 0',
                requestParams: {
                    ...DEFAULT_QUERY_PARAMS,
                    token0Balance: '0',
                    token1Balance: '0',
                },
                result: {
                    status: 400,
                    data: {
                        detail: 'No swap needed',
                        errorCode: 'NO_SWAP_NEEDED',
                    },
                },
            },
            {
                testCase: 'when max iterations is 0',
                requestParams: {
                    ...DEFAULT_QUERY_PARAMS,
                    maxIterations: 0,
                },
                result: {
                    status: 400,
                    data: {
                        detail: '"maxIterations" must be larger than or equal to 1',
                        errorCode: 'VALIDATION_ERROR',
                    },
                },
            },
            {
                testCase: 'when ratio is already fulfilled with token1',
                requestParams: {
                    ...DEFAULT_QUERY_PARAMS,
                    token0Balance: parseAmount('0', DAI_MAINNET).quotient.toString(),
                    token1Balance: parseAmount('5000', USDC_MAINNET).quotient.toString(),
                    tickLower: -286420,
                    tickUpper: -276420,
                },
                result: {
                    status: 400,
                    data: {
                        detail: 'No swap needed for range order',
                        errorCode: 'NO_SWAP_NEEDED',
                    },
                },
            },
            {
                testCase: 'when ratio is already fulfilled with token0',
                requestParams: {
                    ...DEFAULT_QUERY_PARAMS,
                    token0Balance: parseAmount('50000', DAI_MAINNET).quotient.toString(),
                    token1Balance: parseAmount('0', USDC_MAINNET).quotient.toString(),
                    tickLower: 0,
                    tickUpper: 60,
                },
                result: {
                    status: 400,
                    data: {
                        detail: 'No swap needed for range order',
                        errorCode: 'NO_SWAP_NEEDED',
                    },
                },
            },
            {
                testCase: 'amount exceeds uint256',
                requestParams: {
                    ...DEFAULT_QUERY_PARAMS,
                    token0Balance: '100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
                },
                result: {
                    status: 400,
                    data: {
                        detail: '"token0Balance" length must be less than or equal to 77 characters long',
                        errorCode: 'VALIDATION_ERROR',
                    },
                },
            },
            {
                testCase: 'with unknown token',
                requestParams: {
                    ...DEFAULT_QUERY_PARAMS,
                    token0Address: 'UNKNOWNTOKEN',
                },
                result: {
                    status: 400,
                    data: {
                        detail: 'Could not find token with address "UNKNOWNTOKEN"',
                        errorCode: 'TOKEN_0_INVALID',
                    },
                },
            },
            {
                testCase: 'when tokens are the same',
                requestParams: {
                    ...DEFAULT_QUERY_PARAMS,
                    token0Address: DAI_MAINNET.address,
                    token1Address: DAI_MAINNET.address,
                },
                result: {
                    status: 400,
                    data: {
                        detail: 'token0 and token1 must be different',
                        errorCode: 'TOKEN_0_1_SAME',
                    },
                },
            },
            {
                testCase: 'when token are out of order',
                requestParams: {
                    ...DEFAULT_QUERY_PARAMS,
                    token0Address: USDC_MAINNET.address,
                    token1Address: DAI_MAINNET.address,
                },
                result: {
                    status: 400,
                    data: {
                        detail: 'token0 address must be less than token1 address',
                        errorCode: 'TOKENS_MISORDERED',
                    },
                },
            },
            {
                testCase: 'when tick is not a multiple of target pool tick spacing',
                requestParams: {
                    ...DEFAULT_QUERY_PARAMS,
                    tickLower: -44,
                },
                result: {
                    status: 400,
                    data: {
                        detail: 'tickLower and tickUpper must comply with the tick spacing of the target pool',
                        errorCode: 'INVALID_TICK_SPACING',
                    },
                },
            },
        ];
        for (const { testCase, requestParams, result } of ERROR_TEST_CASES) {
            it(testCase, async () => {
                await callAndExpectFail(requestParams, result);
            });
        }
    });
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
        [ChainId.ARBITRUM_GOERLI]: null,
        [ChainId.POLYGON]: USDC_ON(ChainId.POLYGON),
        [ChainId.POLYGON_MUMBAI]: USDC_ON(ChainId.POLYGON_MUMBAI),
        [ChainId.CELO]: CUSD_CELO,
        [ChainId.CELO_ALFAJORES]: CUSD_CELO_ALFAJORES,
        [ChainId.MOONBEAM]: null,
        [ChainId.GNOSIS]: null,
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
    for (const chain of _.filter(SUPPORTED_CHAINS, (c) => c != ChainId.POLYGON &&
        c != ChainId.RINKEBY &&
        c != ChainId.OPTIMISM &&
        c != ChainId.OPTIMISTIC_KOVAN &&
        c != ChainId.OPTIMISM_GOERLI &&
        c != ChainId.POLYGON_MUMBAI &&
        c != ChainId.ARBITRUM_RINKEBY &&
        c != ChainId.ARBITRUM_GOERLI &&
        c != ChainId.GÖRLI &&
        c != ChainId.MOONBEAM &&
        c != ChainId.GNOSIS &&
        c != ChainId.FANTOM &&
        c != ChainId.KLAYTN &&
        c != ChainId.CELO &&
        c != ChainId.CELO_ALFAJORES &&
        c != ChainId.KOVAN &&
        c != ChainId.ROPSTEN &&
        /// @dev We can enable for BSC after more pools are created
        c != ChainId.BSC)) {
        const erc1 = TEST_ERC20_1[chain];
        const erc2 = TEST_ERC20_2[chain];
        // This is for Gnosis, Moonbeam, and Arbitrum Goerli which we don't have RPC Providers yet
        if (erc1 == null || erc2 == null)
            continue;
        describe(`${ID_TO_NETWORK_NAME(chain)} 2xx`, function () {
            // Help with test flakiness by retrying.
            this.retries(1);
            const wrappedNative = WNATIVE_ON(chain);
            let currency0;
            let currency1;
            let currency0Balance;
            let currency1Balance;
            let token0;
            let token1;
            beforeEach(async () => {
                if (erc1.sortsBefore(wrappedNative)) {
                    currency0 = erc1;
                    currency1 = wrappedNative;
                    currency0Balance = parseAmount('10', currency0).quotient.toString();
                    currency1Balance = parseAmount('0.5', currency1).quotient.toString();
                }
                else {
                    currency0 = wrappedNative;
                    currency1 = erc1;
                    currency0Balance = parseAmount('0.5', currency0).quotient.toString();
                    currency1Balance = parseAmount('10', currency1).quotient.toString();
                }
                if (erc1.sortsBefore(erc2)) {
                    token0 = erc1;
                    token1 = erc2;
                }
                else {
                    token0 = erc2;
                    token1 = erc1;
                }
            });
            it(`${wrappedNative.symbol} -> erc20`, async () => {
                quoteToRatioParams = {
                    ...DEFAULT_QUERY_PARAMS,
                    tickLower: getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
                    tickUpper: getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
                    feeAmount: FeeAmount.MEDIUM,
                    token0Balance: currency0Balance,
                    token1Balance: currency1Balance,
                    token0Address: currency0.wrapped.address,
                    token0ChainId: chain,
                    token1Address: currency1.wrapped.address,
                    token1ChainId: chain,
                };
                const queryParams = qs.stringify(quoteToRatioParams);
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
                let token0Address;
                let token1Address;
                let token0Balance;
                let token1Balance;
                let feeTierParams;
                // finding active pools on arb-rink is difficult
                if (chain == ChainId.ARBITRUM_RINKEBY) {
                    token0Address = '0xe2c750ed87e81e2d4da24982eae385bad116eefe';
                    token1Address = '0xfec501fcc518a69473f132b4fff28a542ffffec4';
                    token0Balance = `1${'0'.repeat(18)}`;
                    token1Balance = `30000${'0'.repeat(18)}`;
                    feeTierParams = {
                        tickLower: getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
                        tickUpper: getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
                        feeAmount: FeeAmount.MEDIUM,
                    };
                }
                else {
                    feeTierParams = {};
                    token0Address = token0.wrapped.address;
                    token1Address = token1.wrapped.address;
                    token0Balance = parseAmount('2000', token0).quotient.toString();
                    token1Balance = parseAmount('1000', token1).quotient.toString();
                    feeTierParams = {
                        tickLower: getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
                        tickUpper: getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
                        feeAmount: FeeAmount.MEDIUM,
                    };
                }
                quoteToRatioParams = {
                    ...DEFAULT_QUERY_PARAMS,
                    ...feeTierParams,
                    token0Address,
                    token0ChainId: chain,
                    token1Address,
                    token1ChainId: chain,
                    token0Balance,
                    token1Balance,
                };
                const queryParams = qs.stringify(quoteToRatioParams);
                try {
                    response = await axios.get(`${API}?${queryParams}`);
                    const { status } = response;
                    expect(status).to.equal(200);
                }
                catch (err) {
                    fail(JSON.stringify(err.response.data));
                }
            });
            const native = NATIVE_CURRENCY[chain];
            it(`${native} -> erc20`, async () => {
                const token0Address = erc2.sortsBefore(wrappedNative) ? erc2.wrapped.address : native;
                const token1Address = erc2.sortsBefore(wrappedNative) ? native : erc2.wrapped.address;
                quoteToRatioParams = {
                    ...DEFAULT_QUERY_PARAMS,
                    tickLower: getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
                    tickUpper: getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
                    feeAmount: FeeAmount.MEDIUM,
                    token0Address: token0Address,
                    token0ChainId: chain,
                    token1Address: token1Address,
                    token1ChainId: chain,
                    token0Balance: currency0Balance,
                    token1Balance: currency1Balance,
                };
                const queryParams = qs.stringify(quoteToRatioParams);
                try {
                    response = await axios.get(`${API}?${queryParams}`);
                    const { status } = response;
                    expect(status).to.equal(200);
                }
                catch (err) {
                    fail(JSON.stringify(err.response.data));
                }
            });
        });
    }
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicXVvdGUtdG8tcmF0aW8udGVzdC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3Rlc3QvaW50ZWcvcXVvdGUtdG8tcmF0aW8udGVzdC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFDQSxPQUFPLEVBQVksY0FBYyxFQUFFLEtBQUssRUFBRSxRQUFRLEVBQVMsS0FBSyxFQUFFLE1BQU0sbUJBQW1CLENBQUE7QUFDM0YsT0FBTyxFQUNMLFNBQVMsRUFDVCxtQkFBbUIsRUFDbkIsT0FBTyxFQUNQLFNBQVMsRUFDVCxtQkFBbUIsRUFDbkIsV0FBVyxFQUNYLGtCQUFrQixFQUNsQixlQUFlLEVBQ2YsV0FBVyxFQUNYLFlBQVksRUFDWixZQUFZLEVBQ1osWUFBWSxHQUNiLE1BQU0sK0JBQStCLENBQUE7QUFDdEMsT0FBTyxFQUFvQixJQUFJLEVBQUUsUUFBUSxFQUFFLE1BQU0saUJBQWlCLENBQUE7QUFDbEUsT0FBTyxFQUFFLElBQUksRUFBRSxNQUFNLFFBQVEsQ0FBQTtBQUM3QixPQUFPLEtBQXdCLE1BQU0sT0FBTyxDQUFBO0FBQzVDLE9BQU8sSUFBSSxFQUFFLEVBQUUsTUFBTSxFQUFFLE1BQU0sTUFBTSxDQUFBO0FBQ25DLE9BQU8sY0FBYyxNQUFNLGtCQUFrQixDQUFBO0FBQzdDLE9BQU8sVUFBVSxNQUFNLGFBQWEsQ0FBQTtBQUNwQyxPQUFPLEVBQUUsU0FBUyxFQUFhLE1BQU0sUUFBUSxDQUFBO0FBQzdDLE9BQU8sR0FBRyxNQUFNLFNBQVMsQ0FBQTtBQUN6QixPQUFPLElBQUksTUFBTSxNQUFNLENBQUE7QUFDdkIsT0FBTyxDQUFDLE1BQU0sUUFBUSxDQUFBO0FBQ3RCLE9BQU8sRUFBRSxNQUFNLElBQUksQ0FBQTtBQUNuQixPQUFPLEVBQUUsZ0JBQWdCLEVBQUUsTUFBTSxpQ0FBaUMsQ0FBQTtBQU1sRSxPQUFPLEVBQUUsc0JBQXNCLEVBQUUsTUFBTSwyQkFBMkIsQ0FBQTtBQUNsRSxPQUFPLEVBQUUsYUFBYSxFQUFFLE1B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QUFDLE1BQU07b0JBQzNCLGFBQWEsRUFBRSxhQUFhO29CQUM1QixhQUFhLEVBQUUsS0FBSztvQkFDcEIsYUFBYSxFQUFFLGFBQWE7b0JBQzVCLGFBQWEsRUFBRSxLQUFLO29CQUNwQixhQUFhLEVBQUUsZ0JBQWdCO29CQUMvQixhQUFhLEVBQUUsZ0JBQWdCO2lCQUNoQyxDQUFBO2dCQUNELE1BQU0sV0FBVyxHQUFHLEVBQUUsQ0FBQyxTQUFTLENBQUMsa0JBQWtCLENBQUMsQ0FBQTtnQkFFcEQsSUFBSTtvQkFDRixRQUFRLEdBQUcsTUFBTSxLQUFLLENBQUMsR0FBRyxDQUF1QixHQUFHLEdBQUcsSUFBSSxXQUFXLEVBQUUsQ0FBQyxDQUFBO29CQUN6RSxNQUFNLEVBQUUsTUFBTSxFQUFFLEdBQUcsUUFBUSxDQUFBO29CQUUzQixNQUFNLENBQUMsTUFBTSxDQUFDLENBQUMsRUFBRSxDQUFDLEtBQUssQ0FBQyxHQUFHLENBQUMsQ0FBQTtpQkFDN0I7Z0JBQUMsT0FBTyxHQUFRLEVBQUU7b0JBQ2pCLElBQUksQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLEdBQUcsQ0FBQyxRQUFRLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQTtpQkFDeEM7WUFDSCxDQUFDLENBQUMsQ0FBQTtRQUNKLENBQUMsQ0FBQyxDQUFBO0tBQ0g7QUFDSCxDQUFDLENBQUMsQ0FBQSIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IFNpZ25lcldpdGhBZGRyZXNzIH0gZnJvbSAnQG5vbWljbGFicy9oYXJkaGF0LWV0aGVycy9zaWduZXJzJ1xuaW1wb3J0IHsgQ3VycmVuY3ksIEN1cnJlbmN5QW1vdW50LCBFdGhlciwgRnJhY3Rpb24sIFRva2VuLCBXRVRIOSB9IGZyb20gJ0B1bmlzd2FwL3Nkay1jb3JlJ1xuaW1wb3J0IHtcbiAgQ0VVUl9DRUxPLFxuICBDRVVSX0NFTE9fQUxGQUpPUkVTLFxuICBDaGFpbklkLFxuICBDVVNEX0NFTE8sXG4gIENVU0RfQ0VMT19BTEZBSk9SRVMsXG4gIERBSV9NQUlOTkVULFxuICBJRF9UT19ORVRXT1JLX05BTUUsXG4gIE5BVElWRV9DVVJSRU5DWSxcbiAgcGFyc2VBbW91bnQsXG4gIFVTRENfTUFJTk5FVCxcbiAgVVNEVF9NQUlOTkVULFxuICBXQlRDX01BSU5ORVQsXG59IGZyb20gJ0B0YXJ0ei1vbmUvc21hcnQtb3JkZXItcm91dGVyJ1xuaW1wb3J0IHsgTWV0aG9kUGFyYW1ldGVycywgUG9vbCwgUG9zaXRpb24gfSBmcm9tICdAdW5pc3dhcC92My1zZGsnXG5pbXBvcnQgeyBmYWlsIH0gZnJvbSAnYXNzZXJ0J1xuaW1wb3J0IGF4aW9zLCB7IEF4aW9zUmVzcG9uc2UgfSBmcm9tICdheGlvcydcbmltcG9ydCBjaGFpLCB7IGV4cGVjdCB9IGZyb20gJ2NoYWknXG5pbXBvcnQgY2hhaUFzUHJvbWlzZWQgZnJvbSAnY2hhaS1hcy1wcm9taXNlZCdcbmltcG9ydCBjaGFpU3Vic2V0IGZyb20gJ2NoYWktc3Vic2V0J1xuaW1wb3J0IHsgQmlnTnVtYmVyLCBwcm92aWRlcnMgfSBmcm9tICdldGhlcnMnXG5pbXBvcnQgaHJlIGZyb20gJ2hhcmRoYXQnXG5pbXBvcnQgSlNCSSBmcm9tICdqc2JpJ1xuaW1wb3J0IF8gZnJvbSAnbG9kYXNoJ1xuaW1wb3J0IHFzIGZyb20gJ3FzJ1xuaW1wb3J0IHsgU1VQUE9SVEVEX0NIQUlOUyB9IGZyb20gJy4uLy4uL2xpYi9oYW5kbGVycy9pbmplY3Rvci1zb3InXG5pbXBvcnQge1xuICBRdW90ZVRvUmF0aW9RdWVyeVBhcmFtcyxcbiAgUXVvdGVUb1JhdGlvUmVzcG9uc2UsXG4gIFJlc3BvbnNlRnJhY3Rpb24sXG59IGZyb20gJy4uLy4uL2xpYi9oYW5kbGVycy9xdW90ZS10by1yYXRpby9zY2hlbWEvcXVvdGUtdG8tcmF0aW8tc2NoZW1hJ1xuaW1wb3J0IHsgcGFyc2VTbGlwcGFnZVRvbGVyYW5jZSB9IGZyb20gJy4uLy4uL2xpYi9oYW5kbGVycy9zaGFyZWQnXG5pbXBvcnQgeyBhYnNvbHV0ZVZhbHVlIH0gZnJvbSAnLi4vdXRpbHMvYWJzb2x1dGVWYWx1ZSdcbmltcG9ydCB7IHJlc2V0QW5kRnVuZEF0QmxvY2sgfSBmcm9tICcuLi91dGlscy9mb3JrQW5kRnVuZCdcbmltcG9ydCB7IGdldEJhbGFuY2UsIGdldEJhbGFuY2VBbmRBcHByb3ZlLCBnZXRCYWxhbmNlT2ZBZGRyZXNzIH0gZnJvbSAnLi4vdXRpbHMvZ2V0QmFsYW5jZUFuZEFwcHJvdmUnXG5pbXBvcnQgeyBtaW5pbXVtQW1vdW50T3V0IH0gZnJvbSAnLi4vdXRpbHMvbWluaW11bUFtb3VudE91dCdcbmltcG9ydCB7IGdldFRlc3RQYXJhbXNGcm9tRXZlbnRzLCBwYXJzZUV2ZW50cyB9IGZyb20gJy4uL3V0aWxzL3BhcnNlRXZlbnRzJ1xuaW1wb3J0IHsgRmVlQW1vdW50LCBnZXRNYXhUaWNrLCBnZXRNaW5UaWNrLCBUSUNLX1NQQUNJTkdTIH0gZnJvbSAnLi4vdXRpbHMvdGlja3MnXG5pbXBvcnQgeyBEQUlfT04sIFVOSV9NQUlOTkVULCBVU0RDX09OLCBVU0RUX09OLCBXTkFUSVZFX09OIH0gZnJvbSAnLi4vdXRpbHMvdG9rZW5zJ1xuXG5jb25zdCB7IGV0aGVycyB9ID0gaHJlXG5cbmNoYWkudXNlKGNoYWlBc1Byb21pc2VkKVxuY2hhaS51c2UoY2hhaVN1YnNldClcblxuY29uc3QgQVBJID0gYCR7cHJvY2Vzcy5lbnYuVU5JU1dBUF9ST1VUSU5HX0FQSSF9cXVvdGVUb1JhdGlvYFxuXG5jb25zdCBjYWxsQW5kRXhwZWN0RmFpbCA9IGFzeW5jIChxdW90ZVJlcTogUGFydGlhbDxRdW90ZVRvUmF0aW9RdWVyeVBhcmFtcz4sIHJlc3A6IHsgc3RhdHVzOiBudW1iZXI7IGRhdGE6IGFueSB9KSA9PiB7XG4gIGNvbnN0IHF1ZXJ5UGFyYW1zID0gcXMuc3RyaW5naWZ5KHF1b3RlUmVxKVxuICB0cnkge1xuICAgIGF3YWl0IGF4aW9zLmdldDxRdW90ZVRvUmF0aW9SZXNwb25zZT4oYCR7QVBJfT8ke3F1ZXJ5UGFyYW1zfWApXG4gICAgZmFpbCgpXG4gIH0gY2F0Y2ggKGVycjogYW55KSB7XG4gICAgZXhwZWN0KGVyci5yZXNwb25zZSkudG8uY29udGFpblN1YnNldChyZXNwKVxuICB9XG59XG5cbmZ1bmN0aW9uIHBhcnNlRnJhY3Rpb24oZnJhY3Rpb246IFJlc3BvbnNlRnJhY3Rpb24pOiBGcmFjdGlvbiB7XG4gIHJldHVybiBuZXcgRnJhY3Rpb24oSlNCSS5CaWdJbnQoZnJhY3Rpb24ubnVtZXJhdG9yKSwgSlNCSS5CaWdJbnQoZnJhY3Rpb24uZGVub21pbmF0b3IpKVxufVxuXG5jb25zdCBTV0FQX1JPVVRFUl9WMiA9ICcweDY4YjM0NjU4MzNmYjcyQTcwZWNERjQ4NUUwZTRDN2JEODY2NUZjNDUnXG5cbmRlc2NyaWJlKCdxdW90ZS10by1yYXRpbycsIGFzeW5jIGZ1bmN0aW9uICgpIHtcbiAgLy8gSGVscCB3aXRoIHRlc3QgZmxha2luZXNzIGJ5IHJldHJ5aW5nLlxuICB0aGlzLnJldHJpZXMoMilcblxuICB0aGlzLnRpbWVvdXQoMTAwMDApXG5cbiAgLy8gY2hhaW4gcGFyYW1ldGVyc1xuICBsZXQgYWxpY2U6IFNpZ25lcldpdGhBZGRyZXNzXG4gIGxldCBibG9jazogbnVtYmVyXG5cbiAgLy8gcmVxdWVzdCBwYXJhbWV0ZXJzXG4gIGxldCBxdW90ZVRvUmF0aW9QYXJhbXM6IFF1b3RlVG9SYXRpb1F1ZXJ5UGFyYW1zXG4gIGxldCByZXNwb25zZTogQXhpb3NSZXNwb25zZTxRdW90ZVRvUmF0aW9SZXNwb25zZT5cblxuICBjb25zdCBERUZBVUxUX1FVRVJZX1BBUkFNUyA9IHtcbiAgICB0b2tlbjBBZGRyZXNzOiBEQUlfTUFJTk5FVC5hZGRyZXNzLFxuICAgIHRva2VuMENoYWluSWQ6IDEsXG4gICAgdG9rZW4xQWRkcmVzczogVVNEQ19NQUlOTkVULmFkZHJlc3MsXG4gICAgdG9rZW4xQ2hhaW5JZDogMSxcbiAgICB0b2tlbjBCYWxhbmNlOiBwYXJzZUFtb3VudCgnNTAwMCcsIERBSV9NQUlOTkVUKS5xdW90aWVudC50b1N0cmluZygpLFxuICAgIHRva2VuMUJhbGFuY2U6IHBhcnNlQW1vdW50KCcyMDAwJywgVVNEQ19NQUlOTkVUKS5xdW90aWVudC50b1N0cmluZygpLFxuICAgIHRpY2tMb3dlcjogZ2V0TWluVGljayhUSUNLX1NQQUNJTkdTW0ZlZUFtb3VudC5MT1ddKSxcbiAgICB0aWNrVXBwZXI6IGdldE1heFRpY2soVElDS19TUEFDSU5HU1tGZWVBbW91bnQuTE9XXSksXG4gICAgZmVlQW1vdW50OiBGZWVBbW91bnQuTE9XLFxuICAgIHJlY2lwaWVudDogJzB4ZjM5RmQ2ZTUxYWFkODhGNkY0Y2U2YUI4ODI3Mjc5Y2ZmRmI5MjI2NicsIC8vIGFsaWNlIGFkZHJlc3NcbiAgICBzbGlwcGFnZVRvbGVyYW5jZTogJzUnLFxuICAgIGRlYWRsaW5lOiAnMzYwJyxcbiAgICByYXRpb0Vycm9yVG9sZXJhbmNlOiAxLFxuICAgIG1heEl0ZXJhdGlvbnM6IDYsXG4gICAgYWRkTGlxdWlkaXR5UmVjaXBpZW50OiAnMHhmMzlGZDZlNTFhYWQ4OEY2RjRjZTZhQjg4MjcyNzljZmZGYjkyMjY2JywgLy8gYWxpY2UgYWRkcmVzc1xuICB9XG5cbiAgY29uc3QgZXJyb3JUb2xlcmFuY2VGcmFjdGlvbiA9IChyYXRpb0Vycm9yVG9sZXJhbmNlOiBudW1iZXIpOiBGcmFjdGlvbiA9PiB7XG4gICAgcmV0dXJuIG5ldyBGcmFjdGlvbihyYXRpb0Vycm9yVG9sZXJhbmNlICogMTAwLCAxMF8wMDApXG4gIH1cblxuICBjb25zdCBleGVjdXRlU3dhcEFuZEFkZCA9IGFzeW5jIChcbiAgICBwb29sOiBzdHJpbmcsXG4gICAgbWV0aG9kUGFyYW1ldGVyczogTWV0aG9kUGFyYW1ldGVycyxcbiAgICBjdXJyZW5jeUluOiBDdXJyZW5jeSxcbiAgICBjdXJyZW5jeU91dDogQ3VycmVuY3lcbiAgKTogUHJvbWlzZTx7XG4gICAgdG9rZW4wQWZ0ZXJBbGljZTogQ3VycmVuY3lBbW91bnQ8Q3VycmVuY3k+XG4gICAgdG9rZW4wQmVmb3JlQWxpY2U6IEN1cnJlbmN5QW1vdW50PEN1cnJlbmN5PlxuICAgIHRva2VuMUFmdGVyQWxpY2U6IEN1cnJlbmN5QW1vdW50PEN1cnJlbmN5PlxuICAgIHRva2VuMUJlZm9yZUFsaWNlOiBDdXJyZW5jeUFtb3VudDxDdXJyZW5jeT5cbiAgICB0b2tlbjBBZnRlclBvb2w6IEN1cnJlbmN5QW1vdW50PEN1cnJlbmN5PlxuICAgIHRva2VuMEJlZm9yZVBvb2w6IEN1cnJlbmN5QW1vdW50PEN1cnJlbmN5PlxuICAgIHRva2VuMUFmdGVyUG9vbDogQ3VycmVuY3lBbW91bnQ8Q3VycmVuY3k+XG4gICAgdG9rZW4xQmVmb3JlUG9vbDogQ3VycmVuY3lBbW91bnQ8Q3VycmVuY3k+XG4gICAgc3dhcFJvdXRlckZpbmFsQmFsYW5jZTA6IEN1cnJlbmN5QW1vdW50PEN1cnJlbmN5PlxuICAgIHN3YXBSb3V0ZXJGaW5hbEJhbGFuY2UxOiBDdXJyZW5jeUFtb3VudDxDdXJyZW5jeT5cbiAgICBldmVudHM6IGFueVtdXG4gIH0+ID0+IHtcbiAgICBsZXQgY3VycmVuY3kwLCBjdXJyZW5jeTE6IEN1cnJlbmN5XG4gICAgY3VycmVuY3lJbi53cmFwcGVkLnNvcnRzQmVmb3JlKGN1cnJlbmN5T3V0LndyYXBwZWQpXG4gICAgICA/IChbY3VycmVuY3kwLCBjdXJyZW5jeTFdID0gW2N1cnJlbmN5SW4sIGN1cnJlbmN5T3V0XSlcbiAgICAgIDogKFtjdXJyZW5jeTAsIGN1cnJlbmN5MV0gPSBbY3VycmVuY3lPdXQsIGN1cnJlbmN5SW5dKVxuXG4gICAgY29uc3QgdG9rZW4wQmVmb3JlQWxpY2UgPSBhd2FpdCBnZXRCYWxhbmNlQW5kQXBwcm92ZShhbGljZSwgU1dBUF9ST1VURVJfVjIsIGN1cnJlbmN5MClcbiAgICBjb25zdCB0b2tlbjFCZWZvcmVBbGljZSA9IGF3YWl0IGdldEJhbGFuY2VBbmRBcHByb3ZlKGFsaWNlLCBTV0FQX1JPVVRFUl9WMiwgY3VycmVuY3kxKVxuXG4gICAgY29uc3QgdG9rZW4wQmVmb3JlUG9vbCA9IGF3YWl0IGdldEJhbGFuY2VPZkFkZHJlc3MoYWxpY2UsIHBvb2wsIGN1cnJlbmN5MC53cmFwcGVkKVxuICAgIGNvbnN0IHRva2VuMUJlZm9yZVBvb2wgPSBhd2FpdCBnZXRCYWxhbmNlT2ZBZGRyZXNzKGFsaWNlLCBwb29sLCBjdXJyZW5jeTEud3JhcHBlZClcblxuICAgIGNvbnN0IHRyYW5zYWN0aW9uID0ge1xuICAgICAgZGF0YTogbWV0aG9kUGFyYW1ldGVycy5jYWxsZGF0YSxcbiAgICAgIHRvOiBTV0FQX1JPVVRFUl9WMixcbiAgICAgIHZhbHVlOiBCaWdOdW1iZXIuZnJvbShtZXRob2RQYXJhbWV0ZXJzLnZhbHVlKSxcbiAgICAgIGZyb206IGFsaWNlLmFkZHJlc3MsXG4gICAgICBnYXNQcmljZTogQmlnTnVtYmVyLmZyb20oMjAwMDAwMDAwMDAwMCksXG4gICAgICB0eXBlOiAxLFxuICAgIH1cblxuICAgIGNvbnN0IHRyYW5zYWN0aW9uUmVzcG9uc2U6IHByb3ZpZGVycy5UcmFuc2FjdGlvblJlc3BvbnNlID0gYXdhaXQgYWxpY2Uuc2VuZFRyYW5zYWN0aW9uKHRyYW5zYWN0aW9uKVxuICAgIGNvbnN0IHR4UmVjZWlwdCA9IGF3YWl0IHRyYW5zYWN0aW9uUmVzcG9uc2Uud2FpdCgpXG5cbiAgICBjb25zdCBldmVudHMgPSBwYXJzZUV2ZW50cyh0eFJlY2VpcHQsIFtcbiAgICAgIFNXQVBfUk9VVEVSX1YyLFxuICAgICAgcG9vbCxcbiAgICAgIGFsaWNlLmFkZHJlc3MsXG4gICAgICBjdXJyZW5jeTAud3JhcHBlZC5hZGRyZXNzLFxuICAgICAgY3VycmVuY3kxLndyYXBwZWQuYWRkcmVzcyxcbiAgICBdKVxuXG4gICAgY29uc3QgdG9rZW4wQWZ0ZXJQb29sID0gYXdhaXQgZ2V0QmFsYW5jZU9mQWRkcmVzcyhhbGljZSwgcG9vbCwgY3VycmVuY3kwLndyYXBwZWQpXG4gICAgY29uc3QgdG9rZW4xQWZ0ZXJQb29sID0gYXdhaXQgZ2V0QmFsYW5jZU9mQWRkcmVzcyhhbGljZSwgcG9vbCwgY3VycmVuY3kxLndyYXBwZWQpXG4gICAgY29uc3QgdG9rZW4wQWZ0ZXJBbGljZSA9IGF3YWl0IGdldEJhbGFuY2UoYWxpY2UsIGN1cnJlbmN5MClcbiAgICBjb25zdCB0b2tlbjFBZnRlckFsaWNlID0gYXdhaXQgZ2V0QmFsYW5jZShhbGljZSwgY3VycmVuY3kxKVxuICAgIGNvbnN0IHN3YXBSb3V0ZXJGaW5hbEJhbGFuY2UwID0gYXdhaXQgZ2V0QmFsYW5jZU9mQWRkcmVzcyhhbGljZSwgU1dBUF9ST1VURVJfVjIsIGN1cnJlbmN5MC53cmFwcGVkKVxuICAgIGNvbnN0IHN3YXBSb3V0ZXJGaW5hbEJhbGFuY2UxID0gYXdhaXQgZ2V0QmFsYW5jZU9mQWRkcmVzcyhhbGljZSwgU1dBUF9ST1VURVJfVjIsIGN1cnJlbmN5MS53cmFwcGVkKVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIHRva2VuMEFmdGVyQWxpY2UsXG4gICAgICB0b2tlbjBCZWZvcmVBbGljZSxcbiAgICAgIHRva2VuMUFmdGVyQWxpY2UsXG4gICAgICB0b2tlbjFCZWZvcmVBbGljZSxcbiAgICAgIHRva2VuMEFmdGVyUG9vbCxcbiAgICAgIHRva2VuMEJlZm9yZVBvb2wsXG4gICAgICB0b2tlbjFBZnRlclBvb2wsXG4gICAgICB0b2tlbjFCZWZvcmVQb29sLFxuICAgICAgc3dhcFJvdXRlckZpbmFsQmFsYW5jZTAsXG4gICAgICBzd2FwUm91dGVyRmluYWxCYWxhbmNlMSxcbiAgICAgIGV2ZW50cyxcbiAgICB9XG4gIH1cblxuICBhc3luYyBmdW5jdGlvbiB0ZXN0U3VjY2Vzc2Z1bENvbnRyYWN0RXhlY3V0aW9uKFxuICAgIHJlc3BvbnNlOiBBeGlvc1Jlc3BvbnNlPFF1b3RlVG9SYXRpb1Jlc3BvbnNlPixcbiAgICBwYXJhbXM6IFF1b3RlVG9SYXRpb1F1ZXJ5UGFyYW1zLFxuICAgIHRva2VuMDogQ3VycmVuY3ksXG4gICAgdG9rZW4xOiBDdXJyZW5jeSxcbiAgICB6ZXJvRm9yT25lOiBib29sZWFuXG4gICkge1xuICAgIGNvbnN0IHtcbiAgICAgIHRpY2tMb3dlcixcbiAgICAgIHRpY2tVcHBlcixcbiAgICAgIGZlZUFtb3VudCxcbiAgICAgIHNsaXBwYWdlVG9sZXJhbmNlLFxuICAgICAgdG9rZW4wQmFsYW5jZTogdG9rZW4wQmFsYW5jZVN0cixcbiAgICAgIHRva2VuMUJhbGFuY2U6IHRva2VuMUJhbGFuY2VTdHIsXG4gICAgfSA9IHBhcmFtc1xuICAgIGNvbnN0IHRva2VuMEJhbGFuY2UgPSBDdXJyZW5jeUFtb3VudC5mcm9tUmF3QW1vdW50KHRva2VuMCwgSlNCSS5CaWdJbnQodG9rZW4wQmFsYW5jZVN0cikpXG4gICAgY29uc3QgdG9rZW4xQmFsYW5jZSA9IEN1cnJlbmN5QW1vdW50LmZyb21SYXdBbW91bnQodG9rZW4xLCBKU0JJLkJpZ0ludCh0b2tlbjFCYWxhbmNlU3RyKSlcbiAgICBjb25zdCB7XG4gICAgICBkYXRhOiB7IGFtb3VudCwgcXVvdGUsIG1ldGhvZFBhcmFtZXRlcnMsIHBvc3RTd2FwVGFyZ2V0UG9vbCwgdG9rZW4wQmFsYW5jZVVwZGF0ZWQsIHRva2VuMUJhbGFuY2VVcGRhdGVkIH0sXG4gICAgfSA9IHJlc3BvbnNlXG5cbiAgICBjb25zdCBbdG9rZW5JbiwgdG9rZW5PdXRdID0gemVyb0Zvck9uZSA/IFt0b2tlbjAsIHRva2VuMV0gOiBbdG9rZW4xLCB0b2tlbjBdXG5cbiAgICBjb25zdCBwb3N0U3dhcFBvb2wgPSBuZXcgUG9vbChcbiAgICAgIHRva2VuMC53cmFwcGVkLFxuICAgICAgdG9rZW4xLndyYXBwZWQsXG4gICAgICBmZWVBbW91bnQsXG4gICAgICBwb3N0U3dhcFRhcmdldFBvb2wuc3FydFJhdGlvWDk2LFxuICAgICAgcG9zdFN3YXBUYXJnZXRQb29sLmxpcXVpZGl0eSxcbiAgICAgIHBhcnNlSW50KHBvc3RTd2FwVGFyZ2V0UG9vbC50aWNrQ3VycmVudClcbiAgICApXG5cbiAgICBjb25zdCB7XG4gICAgICB0b2tlbjBCZWZvcmVBbGljZSxcbiAgICAgIHRva2VuMEFmdGVyQWxpY2UsXG4gICAgICB0b2tlbjFCZWZvcmVBbGljZSxcbiAgICAgIHRva2VuMUFmdGVyQWxpY2UsXG4gICAgICB0b2tlbjBCZWZvcmVQb29sLFxuICAgICAgdG9rZW4wQWZ0ZXJQb29sLFxuICAgICAgdG9rZW4xQmVmb3JlUG9vbCxcbiAgICAgIHRva2VuMUFmdGVyUG9vbCxcbiAgICAgIHN3YXBSb3V0ZXJGaW5hbEJhbGFuY2UwLFxuICAgICAgc3dhcFJvdXRlckZpbmFsQmFsYW5jZTEsXG4gICAgICBldmVudHMsXG4gICAgfSA9IGF3YWl0IGV4ZWN1dGVTd2FwQW5kQWRkKHBvc3RTd2FwVGFyZ2V0UG9vbC5hZGRyZXNzLCBtZXRob2RQYXJhbWV0ZXJzISwgdG9rZW4wLCB0b2tlbjEpXG5cbiAgICBjb25zdCB7XG4gICAgICAvLyB0b3RhbCBhbW91bnRzIHRyYW5zZmVycmVkIGZyb20gYWxpY2UuIGluY2x1ZGluZyBhbW91bnRzIHRyYW5zZmVycmVkIGJhY2sgYXMgYSByZXN1bHQgb2YgZHVzdFxuICAgICAgYW1vdW50MFRyYW5zZmVycmVkRnJvbUFsaWNlLFxuICAgICAgYW1vdW50MVRyYW5zZmVycmVkRnJvbUFsaWNlLFxuICAgICAgYW1vdW50MFN3YXBwZWRJblBvb2wsXG4gICAgICBhbW91bnQxU3dhcHBlZEluUG9vbCxcbiAgICAgIG9uQ2hhaW5Qb3NpdGlvbixcbiAgICB9ID0gZ2V0VGVzdFBhcmFtc0Zyb21FdmVudHMoZXZlbnRzLCB0b2tlbjAud3JhcHBlZCwgdG9rZW4xLndyYXBwZWQsIGFsaWNlLmFkZHJlc3MsIHBvc3RTd2FwVGFyZ2V0UG9vbC5hZGRyZXNzKVxuXG4gICAgLy8gYWxpY2UncyBiYWxhbmNlIGRpZmZlcmVuY2VzIGFmdGVyIGVudGlyZSBjb21wbGV0ZWQgdHJhbnNhY3Rpb25cbiAgICBjb25zdCBhbW91bnQwRGlmZkFsaWNlID0gdG9rZW4wQmVmb3JlQWxpY2Uuc3VidHJhY3QodG9rZW4wQWZ0ZXJBbGljZSlcbiAgICBjb25zdCBhbW91bnQxRGlmZkFsaWNlID0gdG9rZW4xQmVmb3JlQWxpY2Uuc3VidHJhY3QodG9rZW4xQWZ0ZXJBbGljZSlcblxuICAgIGNvbnN0IGN1cnJlbmN5SW5Td2FwcGVkID0gQ3VycmVuY3lBbW91bnQuZnJvbVJhd0Ftb3VudCh0b2tlbkluLCBKU0JJLkJpZ0ludChhbW91bnQpKVxuICAgIGNvbnN0IGN1cnJlbmN5T3V0UXVvdGUgPSBDdXJyZW5jeUFtb3VudC5mcm9tUmF3QW1vdW50KHRva2VuT3V0LCBKU0JJLkJpZ0ludChxdW90ZSkpXG5cbiAgICBjb25zdCBuZXdQb29sQmFsYW5jZTAgPSB0b2tlbjBBZnRlclBvb2wuc3VidHJhY3QodG9rZW4wQmVmb3JlUG9vbClcbiAgICBjb25zdCBuZXdQb29sQmFsYW5jZTEgPSB0b2tlbjFBZnRlclBvb2wuc3VidHJhY3QodG9rZW4xQmVmb3JlUG9vbClcblxuICAgIGNvbnN0IG1pbnRlZFBvc2l0aW9uUXVvdGVkID0gUG9zaXRpb24uZnJvbUFtb3VudHMoe1xuICAgICAgcG9vbDogcG9zdFN3YXBQb29sLFxuICAgICAgdGlja0xvd2VyLFxuICAgICAgdGlja1VwcGVyLFxuICAgICAgYW1vdW50MDogdG9rZW4wQmFsYW5jZVVwZGF0ZWQsXG4gICAgICBhbW91bnQxOiB0b2tlbjFCYWxhbmNlVXBkYXRlZCxcbiAgICAgIHVzZUZ1bGxQcmVjaXNpb246IHRydWUsXG4gICAgfSlcbiAgICBjb25zdCB7IGFtb3VudDA6IG1pblBvc2l0aW9uQW1vdW50MCwgYW1vdW50MTogbWluUG9zaXRpb25BbW91bnQxIH0gPSBtaW50ZWRQb3NpdGlvblF1b3RlZC5taW50QW1vdW50c1dpdGhTbGlwcGFnZShcbiAgICAgIHBhcnNlU2xpcHBhZ2VUb2xlcmFuY2Uoc2xpcHBhZ2VUb2xlcmFuY2UhKVxuICAgIClcblxuICAgIC8vIGNvbGxlY3QgcG9zaXRpb24gd2l0aCBtaW5pbXVtIGFtb3VudCBvdXQgZnJvbSBzd2FwIHdpdGggbWF4IHNsaXBwYWdlLiBNaW4gYW1vdW50cyBhZGRlZCB0byBwb3NpdGlvblxuICAgIC8vIHdpbGwgZWl0aGVyIGJlIG1pbnRBbW91bnRzV2l0aFNsaXBwYWdlIGZvciBxdW90ZWQgcG9zaXRpb24gT1IgYW1vdW50cyByZXN1bHRpbmcgZnJvbSBtaW5pbXVtIHBvc3NpYmxlIGFtb3VudCBxdW90ZWQgZnJvbSBzd2FwLlxuICAgIC8vIHRoZSBsZXNzZXIgb2YgdGhlIHR3bywgc2luY2UgbWludEFtb3VudHNXaXRoU2xpcHBhZ2UgY2FuIGJlIHVuZGVwZW5kYWJsZSBpbiBjZXJ0YWluIHNjZW5hcmlvcywgc3BlY2lmaWNhbGx5IGludm9sdmluZyBvdXQtb2YtcmFuZ2UgcG9zaXRpb25zXG4gICAgY29uc3QgYW1vdW50T3V0TWF4U3dhcFNsaXBwYWdlID0gbWluaW11bUFtb3VudE91dChwYXJzZVNsaXBwYWdlVG9sZXJhbmNlKHNsaXBwYWdlVG9sZXJhbmNlISksIGN1cnJlbmN5T3V0UXVvdGUpXG4gICAgY29uc3QgbWludGVkUG9zaXRpb25NYXhTd2FwU2xpcHBhZ2UgPSBQb3NpdGlvbi5mcm9tQW1vdW50cyh7XG4gICAgICBwb29sOiBwb3N0U3dhcFBvb2wsXG4gICAgICB0aWNrTG93ZXIsXG4gICAgICB0aWNrVXBwZXIsXG4gICAgICBhbW91bnQwOiB6ZXJvRm9yT25lID8gdG9rZW4wQmFsYW5jZVVwZGF0ZWQgOiBhbW91bnRPdXRNYXhTd2FwU2xpcHBhZ2UucXVvdGllbnQsXG4gICAgICBhbW91bnQxOiB6ZXJvRm9yT25lID8gYW1vdW50T3V0TWF4U3dhcFNsaXBwYWdlLnF1b3RpZW50IDogdG9rZW4xQmFsYW5jZVVwZGF0ZWQsXG4gICAgICB1c2VGdWxsUHJlY2lzaW9uOiB0cnVlLFxuICAgIH0pXG5cbiAgICAvLyBtYWtlIHN1cmUgd2UgbmV2ZXIgdHJhbnNmZXIgbW9yZSB0aGFuIHRoZSB1c2VyLXN0YXRlZCBhdmFpbGFibGUgYmFsYW5jZVxuICAgIGV4cGVjdCghYW1vdW50MFRyYW5zZmVycmVkRnJvbUFsaWNlLmdyZWF0ZXJUaGFuKHRva2VuMEJhbGFuY2UpKS50by5iZS50cnVlXG4gICAgZXhwZWN0KCFhbW91bnQxVHJhbnNmZXJyZWRGcm9tQWxpY2UuZ3JlYXRlclRoYW4odG9rZW4xQmFsYW5jZSkpLnRvLmJlLnRydWVcblxuICAgIC8vIG1ha2Ugc3VyZSByb3V0ZXIgaGFzIG5vIGZ1bmRzIGxlZnRcbiAgICBleHBlY3Qoc3dhcFJvdXRlckZpbmFsQmFsYW5jZTAucXVvdGllbnQudG9TdHJpbmcoKSkudG8uZXF1YWwoJzAnKVxuICAgIGV4cGVjdChzd2FwUm91dGVyRmluYWxCYWxhbmNlMS5xdW90aWVudC50b1N0cmluZygpKS50by5lcXVhbCgnMCcpXG5cbiAgICAvLyB0b3RhbCBhbW91bnRJbiBwdWxsZWQgYnV0IG5vdCBzd2FwcGVkIG5vdyBsaXZlcyBpbiB0aGUgcG9zaXRpb25cbiAgICAvLyB3aXRoIG5hdGl2ZSBjdXJyZW5jeSwgb3RoZXIgY2hlY2tzIHNob3VsZCBzdWZmaWNlLCBnYXMgZWZmZWN0cyB0aGVzZSBudW1iZXJzLlxuICAgIGlmICh6ZXJvRm9yT25lICYmIGFtb3VudDBEaWZmQWxpY2UuY3VycmVuY3kuc3ltYm9sICE9PSAnRVRIJykge1xuICAgICAgZXhwZWN0KGFtb3VudDBEaWZmQWxpY2Uuc3VidHJhY3QoY3VycmVuY3lJblN3YXBwZWQpLnF1b3RpZW50LnRvU3RyaW5nKCkpLnRvLmVxdWFsKFxuICAgICAgICBuZXdQb29sQmFsYW5jZTAuc3VidHJhY3QoYW1vdW50MFN3YXBwZWRJblBvb2wpLnF1b3RpZW50LnRvU3RyaW5nKClcbiAgICAgIClcbiAgICB9IGVsc2UgaWYgKGFtb3VudDFEaWZmQWxpY2UuY3VycmVuY3kuc3ltYm9sICE9PSAnRVRIJykge1xuICAgICAgZXhwZWN0KGFtb3VudDFEaWZmQWxpY2Uuc3VidHJhY3QoY3VycmVuY3lJblN3YXBwZWQpLnF1b3RpZW50LnRvU3RyaW5nKCkpLnRvLmVxdWFsKFxuICAgICAgICBuZXdQb29sQmFsYW5jZTEuc3VidHJhY3QoYW1vdW50MVN3YXBwZWRJblBvb2wpLnF1b3RpZW50LnRvU3RyaW5nKClcbiAgICAgIClcbiAgICB9XG5cbiAgICAvLyBjaGVjayBwb3NpdGlvbiBkZXRhaWxzXG4gICAgZXhwZWN0KG9uQ2hhaW5Qb3NpdGlvbi5hbW91bnQwLnF1b3RpZW50LnRvU3RyaW5nKCkpLnRvLmVxdWFsKFxuICAgICAgbmV3UG9vbEJhbGFuY2UwLnN1YnRyYWN0KGFtb3VudDBTd2FwcGVkSW5Qb29sKS5xdW90aWVudC50b1N0cmluZygpXG4gICAgKVxuICAgIGV4cGVjdChvbkNoYWluUG9zaXRpb24uYW1vdW50MS5xdW90aWVudC50b1N0cmluZygpKS50by5lcXVhbChcbiAgICAgIG5ld1Bvb2xCYWxhbmNlMS5zdWJ0cmFjdChhbW91bnQxU3dhcHBlZEluUG9vbCkucXVvdGllbnQudG9TdHJpbmcoKVxuICAgIClcblxuICAgIC8vIGNoZWNrIG9ubHkgZm9yIG5ld2x5IG1pbnRlZCBwb3NpdGlvbnNcbiAgICBpZiAob25DaGFpblBvc2l0aW9uLm5ld01pbnQpIHtcbiAgICAgIGV4cGVjdChvbkNoYWluUG9zaXRpb24ub3duZXIpLnRvLmVxdWFsKGFsaWNlLmFkZHJlc3MpXG4gICAgICBleHBlY3Qob25DaGFpblBvc2l0aW9uLnRpY2tMb3dlcikudG8uZXF1YWwodGlja0xvd2VyKVxuICAgICAgZXhwZWN0KG9uQ2hhaW5Qb3NpdGlvbi50aWNrVXBwZXIpLnRvLmVxdWFsKHRpY2tVcHBlcilcbiAgICB9XG5cbiAgICAvLyBjaGVjayBzbGlwcGFnZSB0b2xlcmFuY2Ugd2FzIG5vdCBoaXRcbiAgICBjb25zdCBtaW4wID0gbWludGVkUG9zaXRpb25NYXhTd2FwU2xpcHBhZ2UuYW1vdW50MC5sZXNzVGhhbihtaW5Qb3NpdGlvbkFtb3VudDApXG4gICAgICA/IG1pbnRlZFBvc2l0aW9uTWF4U3dhcFNsaXBwYWdlLmFtb3VudDBcbiAgICAgIDogbWluUG9zaXRpb25BbW91bnQwXG4gICAgY29uc3QgbWluMSA9IG1pbnRlZFBvc2l0aW9uTWF4U3dhcFNsaXBwYWdlLmFtb3VudDEubGVzc1RoYW4obWluUG9zaXRpb25BbW91bnQxKVxuICAgICAgPyBtaW50ZWRQb3NpdGlvbk1heFN3YXBTbGlwcGFnZS5hbW91bnQxXG4gICAgICA6IG1pblBvc2l0aW9uQW1vdW50MVxuICAgIGV4cGVjdCghb25DaGFpblBvc2l0aW9uLmFtb3VudDAubGVzc1RoYW4obWluMCkpLnRvLmJlLnRydWVcbiAgICBleHBlY3QoIW9uQ2hhaW5Qb3NpdGlvbi5hbW91bnQxLmxlc3NUaGFuKG1pbjEpKS50by5iZS50cnVlXG4gIH1cblxuICBiZWZvcmUoJ2dlbmVyYXRlIGJsb2NrY2hhaW4gZm9yaycsIGFzeW5jIGZ1bmN0aW9uICgpIHtcbiAgICB0aGlzLnRpbWVvdXQoNDAwMDApXG4gICAgO1thbGljZV0gPSBhd2FpdCBldGhlcnMuZ2V0U2lnbmVycygpXG5cbiAgICAvLyBNYWtlIGEgZHVtbXkgY2FsbCB0byB0aGUgQVBJIHRvIGdldCBhIGJsb2NrIG51bWJlciB0byBmb3JrIGZyb20uXG4gICAgY29uc3QgcXVvdGVUb1JhdGlvUmVjOiBRdW90ZVRvUmF0aW9RdWVyeVBhcmFtcyA9IERFRkFVTFRfUVVFUllfUEFSQU1TXG5cbiAgICBjb25zdCBxdWVyeVBhcmFtcyA9IHFzLnN0cmluZ2lmeShxdW90ZVRvUmF0aW9SZWMpXG4gICAgY29uc3QgcmVzcG9uc2U6IEF4aW9zUmVzcG9uc2U8UXVvdGVUb1JhdGlvUmVzcG9uc2U+ID0gYXdhaXQgYXhpb3MuZ2V0PFF1b3RlVG9SYXRpb1Jlc3BvbnNlPihgJHtBUEl9PyR7cXVlcnlQYXJhbXN9YClcbiAgICBjb25zdCB7XG4gICAgICBkYXRhOiB7IGJsb2NrTnVtYmVyIH0sXG4gICAgfSA9IHJlc3BvbnNlXG5cbiAgICBibG9jayA9IHBhcnNlSW50KGJsb2NrTnVtYmVyKSAtIDEwXG5cbiAgICBhbGljZSA9IGF3YWl0IHJlc2V0QW5kRnVuZEF0QmxvY2soYWxpY2UsIGJsb2NrLCBbXG4gICAgICBwYXJzZUFtb3VudCgnODAwMDAwMCcsIFVTRENfTUFJTk5FVCksXG4gICAgICBwYXJzZUFtb3VudCgnNTAwMDAwMCcsIFVTRFRfTUFJTk5FVCksXG4gICAgICBwYXJzZUFtb3VudCgnMTAnLCBXQlRDX01BSU5ORVQpLFxuICAgICAgcGFyc2VBbW91bnQoJzEwMDAnLCBVTklfTUFJTk5FVCksXG4gICAgICBwYXJzZUFtb3VudCgnNDAwMCcsIFdFVEg5WzFdKSxcbiAgICAgIHBhcnNlQW1vdW50KCc1MDAwMDAwJywgREFJX01BSU5ORVQpLFxuICAgIF0pXG4gIH0pXG5cbiAgY29uc3QgU1VDQ0VTU19URVNUX0NBU0VTOiB7XG4gICAgdGVzdENhc2U6IHN0cmluZ1xuICAgIHRva2VuMDogQ3VycmVuY3lcbiAgICB0b2tlbjE6IEN1cnJlbmN5XG4gICAgemVyb0Zvck9uZTogYm9vbGVhblxuICAgIHJlcXVlc3RQYXJhbXM6IFF1b3RlVG9SYXRpb1F1ZXJ5UGFyYW1zXG4gIH1bXSA9IFtcbiAgICB7XG4gICAgICB0ZXN0Q2FzZTogJ2VyYzIwIC0+IGVyYzIwIGxvdyB2b2x1bWUgdHJhZGUgdG9rZW4wRXhjZXNzJyxcbiAgICAgIHRva2VuMDogREFJX01BSU5ORVQsXG4gICAgICB0b2tlbjE6IFVTRENfTUFJTk5FVCxcbiAgICAgIHplcm9Gb3JPbmU6IHRydWUsXG4gICAgICByZXF1ZXN0UGFyYW1zOiBERUZBVUxUX1FVRVJZX1BBUkFNUyxcbiAgICB9LFxuICAgIHtcbiAgICAgIHRlc3RDYXNlOiAnZXJjMjAgLT4gZXJjMjAgaGlnaCB2b2x1bWUgdHJhZGUgdG9rZW4wRXhjZXNzJyxcbiAgICAgIHRva2VuMDogREFJX01BSU5ORVQsXG4gICAgICB0b2tlbjE6IFVTRENfTUFJTk5FVCxcbiAgICAgIHplcm9Gb3JPbmU6IHRydWUsXG4gICAgICByZXF1ZXN0UGFyYW1zOiB7XG4gICAgICAgIC4uLkRFRkFVTFRfUVVFUllfUEFSQU1TLFxuICAgICAgICB0b2tlbjBCYWxhbmNlOiBwYXJzZUFtb3VudCgnMTAwMDAwMCcsIERBSV9NQUlOTkVUKS5xdW90aWVudC50b1N0cmluZygpLFxuICAgICAgICB0b2tlbjFCYWxhbmNlOiBwYXJzZUFtb3VudCgnMjAwMCcsIFVTRENfTUFJTk5FVCkucXVvdGllbnQudG9TdHJpbmcoKSxcbiAgICAgICAgc2xpcHBhZ2VUb2xlcmFuY2U6ICcwLjA1JyxcbiAgICAgIH0sXG4gICAgfSxcbiAgICB7XG4gICAgICB0ZXN0Q2FzZTogJ2VyYzIwIC0+IGVyYzIwIGxvdyB2b2x1bWUgdHJhZGUgdG9rZW4xRXhjZXNzJyxcbiAgICAgIHRva2VuMDogREFJX01BSU5ORVQsXG4gICAgICB0b2tlbjE6IFVTRENfTUFJTk5FVCxcbiAgICAgIHplcm9Gb3JPbmU6IGZhbHNlLFxuICAgICAgcmVxdWVzdFBhcmFtczoge1xuICAgICAgICAuLi5ERUZBVUxUX1FVRVJZX1BBUkFNUyxcbiAgICAgICAgdG9rZW4wQmFsYW5jZTogcGFyc2VBbW91bnQoJzIwMDAnLCBEQUlfTUFJTk5FVCkucXVvdGllbnQudG9TdHJpbmcoKSxcbiAgICAgICAgdG9rZW4xQmFsYW5jZTogcGFyc2VBbW91bnQoJzUwMDAnLCBVU0RDX01BSU5ORVQpLnF1b3RpZW50LnRvU3RyaW5nKCksXG4gICAgICB9LFxuICAgIH0sXG4gICAge1xuICAgICAgdGVzdENhc2U6ICdlcmMyMCAtPiBlcmMyMCBoaWdoIHZvbHVtZSB0cmFkZSB0b2tlbjFFeGNlc3MnLFxuICAgICAgdG9rZW4wOiBEQUlfTUFJTk5FVCxcbiAgICAgIHRva2VuMTogVVNEQ19NQUlOTkVULFxuICAgICAgemVyb0Zvck9uZTogZmFsc2UsXG4gICAgICByZXF1ZXN0UGFyYW1zOiB7XG4gICAgICAgIC4uLkRFRkFVTFRfUVVFUllfUEFSQU1TLFxuICAgICAgICB0b2tlbjBCYWxhbmNlOiBwYXJzZUFtb3VudCgnMjAwMCcsIERBSV9NQUlOTkVUKS5xdW90aWVudC50b1N0cmluZygpLFxuICAgICAgICB0b2tlbjFCYWxhbmNlOiBwYXJzZUFtb3VudCgnMjAwMDAwMCcsIFVTRENfTUFJTk5FVCkucXVvdGllbnQudG9TdHJpbmcoKSxcbiAgICAgIH0sXG4gICAgfSxcbiAgICB7XG4gICAgICB0ZXN0Q2FzZTogJ2VyYzIwIC0+IGVyYzIwIHJhbmdlIG9yZGVyIHBvc2l0aW9uIHRva2VuMCBleGNlc3MnLFxuICAgICAgdG9rZW4wOiBEQUlfTUFJTk5FVCxcbiAgICAgIHRva2VuMTogVVNEQ19NQUlOTkVULFxuICAgICAgemVyb0Zvck9uZTogdHJ1ZSxcbiAgICAgIHJlcXVlc3RQYXJhbXM6IHtcbiAgICAgICAgLi4uREVGQVVMVF9RVUVSWV9QQVJBTVMsXG4gICAgICAgIHRva2VuMEJhbGFuY2U6IHBhcnNlQW1vdW50KCc1MDAwMCcsIERBSV9NQUlOTkVUKS5xdW90aWVudC50b1N0cmluZygpLFxuICAgICAgICB0b2tlbjFCYWxhbmNlOiBwYXJzZUFtb3VudCgnMjAwMCcsIFVTRENfTUFJTk5FVCkucXVvdGllbnQudG9TdHJpbmcoKSxcbiAgICAgICAgdGlja0xvd2VyOiAtMjg2NDIwLFxuICAgICAgICB0aWNrVXBwZXI6IC0yNzY0MjAsXG4gICAgICB9LFxuICAgIH0sXG4gICAge1xuICAgICAgdGVzdENhc2U6ICdlcmMyMCAtPiBlcmMyMCByYW5nZSBvcmRlciBwb3NpdGlvbiB0b2tlbjEgZXhjZXNzJyxcbiAgICAgIHRva2VuMDogREFJX01BSU5ORVQsXG4gICAgICB0b2tlbjE6IFVTRENfTUFJTk5FVCxcbiAgICAgIHplcm9Gb3JPbmU6IGZhbHNlLFxuICAgICAgcmVxdWVzdFBhcmFtczoge1xuICAgICAgICAuLi5ERUZBVUxUX1FVRVJZX1BBUkFNUyxcbiAgICAgICAgdG9rZW4wQmFsYW5jZTogcGFyc2VBbW91bnQoJzIwMDAnLCBEQUlfTUFJTk5FVCkucXVvdGllbnQudG9TdHJpbmcoKSxcbiAgICAgICAgdG9rZW4xQmFsYW5jZTogcGFyc2VBbW91bnQoJzUwMDAwJywgVVNEQ19NQUlOTkVUKS5xdW90aWVudC50b1N0cmluZygpLFxuICAgICAgICB0aWNrTG93ZXI6IDAsXG4gICAgICAgIHRpY2tVcHBlcjogNjAsXG4gICAgICB9LFxuICAgIH0sXG4gICAge1xuICAgICAgdGVzdENhc2U6ICdlcmMyMCAtPiBldGgnLFxuICAgICAgdG9rZW4wOiBEQUlfTUFJTk5FVCxcbiAgICAgIHRva2VuMTogRXRoZXIub25DaGFpbigxKSxcbiAgICAgIHplcm9Gb3JPbmU6IHRydWUsXG4gICAgICByZXF1ZXN0UGFyYW1zOiB7XG4gICAgICAgIC4uLkRFRkFVTFRfUVVFUllfUEFSQU1TLFxuICAgICAgICB0b2tlbjFBZGRyZXNzOiAnRVRIJyxcbiAgICAgICAgdG9rZW4wQmFsYW5jZTogcGFyc2VBbW91bnQoJzEwMDAwJywgREFJX01BSU5ORVQpLnF1b3RpZW50LnRvU3RyaW5nKCksXG4gICAgICAgIHRva2VuMUJhbGFuY2U6IHBhcnNlQW1vdW50KCcxJywgV0VUSDlbMV0pLnF1b3RpZW50LnRvU3RyaW5nKCksXG4gICAgICB9LFxuICAgIH0sXG4gICAge1xuICAgICAgdGVzdENhc2U6ICdldGggLT4gZXJjMjAnLFxuICAgICAgdG9rZW4wOiBEQUlfTUFJTk5FVCxcbiAgICAgIHRva2VuMTogRXRoZXIub25DaGFpbigxKSxcbiAgICAgIHplcm9Gb3JPbmU6IGZhbHNlLFxuICAgICAgcmVxdWVzdFBhcmFtczoge1xuICAgICAgICAuLi5ERUZBVUxUX1FVRVJZX1BBUkFNUyxcbiAgICAgICAgdG9rZW4xQWRkcmVzczogJ0VUSCcsXG4gICAgICAgIHRva2VuMEJhbGFuY2U6IHBhcnNlQW1vdW50KCcxMDAwJywgREFJX01BSU5ORVQpLnF1b3RpZW50LnRvU3RyaW5nKCksXG4gICAgICAgIHRva2VuMUJhbGFuY2U6IHBhcnNlQW1vdW50KCczJywgRXRoZXIub25DaGFpbigxKSkucXVvdGllbnQudG9TdHJpbmcoKSxcbiAgICAgIH0sXG4gICAgfSxcbiAgXVxuXG4gIGZvciAoY29uc3QgeyB0ZXN0Q2FzZSwgdG9rZW4wLCB0b2tlbjEsIHplcm9Gb3JPbmUsIHJlcXVlc3RQYXJhbXMgfSBvZiBTVUNDRVNTX1RFU1RfQ0FTRVMpIHtcbiAgICBkZXNjcmliZSh0ZXN0Q2FzZSwgKCkgPT4ge1xuICAgICAgYmVmb3JlKGFzeW5jIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgY29uc3QgcXVlcnlQYXJhbXMgPSBxcy5zdHJpbmdpZnkocmVxdWVzdFBhcmFtcylcbiAgICAgICAgcmVzcG9uc2UgPSBhd2FpdCBheGlvcy5nZXQ8UXVvdGVUb1JhdGlvUmVzcG9uc2U+KGAke0FQSX0/JHtxdWVyeVBhcmFtc31gKVxuICAgICAgfSlcblxuICAgICAgaXQoJ2dlbmVyYXRlcyBhIGxlZ2l0aW1hdGUgdHJhZGUgd2l0aCByb3V0aW5nLWFwaScsIGFzeW5jIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgY29uc3Qge1xuICAgICAgICAgIGRhdGE6IHsgdG9rZW5JbkFkZHJlc3MsIHRva2VuT3V0QWRkcmVzcywgbmV3UmF0aW9GcmFjdGlvbiwgb3B0aW1hbFJhdGlvRnJhY3Rpb24gfSxcbiAgICAgICAgICBzdGF0dXMsXG4gICAgICAgIH0gPSByZXNwb25zZVxuXG4gICAgICAgIGNvbnN0IG5ld1JhdGlvID0gcGFyc2VGcmFjdGlvbihuZXdSYXRpb0ZyYWN0aW9uKVxuICAgICAgICBjb25zdCBvcHRpbWFsUmF0aW8gPSBwYXJzZUZyYWN0aW9uKG9wdGltYWxSYXRpb0ZyYWN0aW9uKVxuICAgICAgICBjb25zdCByYXRpb0RldmlhdGlvbiA9IGFic29sdXRlVmFsdWUobmV3IEZyYWN0aW9uKDEsIDEpLnN1YnRyYWN0KG5ld1JhdGlvLmRpdmlkZShvcHRpbWFsUmF0aW8pKSlcbiAgICAgICAgY29uc3QgcmF0aW9FcnJvclRvbGVyYW5jZUZyYWN0aW9uID0gZXJyb3JUb2xlcmFuY2VGcmFjdGlvbihyZXF1ZXN0UGFyYW1zLnJhdGlvRXJyb3JUb2xlcmFuY2UpXG5cbiAgICAgICAgZXhwZWN0KHN0YXR1cykudG8uZXF1YWwoMjAwLCBKU09OLnN0cmluZ2lmeShyZXNwb25zZS5kYXRhKSlcbiAgICAgICAgZXhwZWN0KCFyYXRpb0RldmlhdGlvbi5ncmVhdGVyVGhhbihyYXRpb0Vycm9yVG9sZXJhbmNlRnJhY3Rpb24pKS50by5lcXVhbCh0cnVlLCBKU09OLnN0cmluZ2lmeShyZXNwb25zZS5kYXRhKSlcbiAgICAgICAgaWYgKHplcm9Gb3JPbmUpIHtcbiAgICAgICAgICBleHBlY3QodG9rZW5JbkFkZHJlc3MudG9Mb3dlckNhc2UoKSkudG8uZXF1YWwodG9rZW4wLndyYXBwZWQuYWRkcmVzcy50b0xvd2VyQ2FzZSgpKVxuICAgICAgICAgIGV4cGVjdCh0b2tlbk91dEFkZHJlc3MudG9Mb3dlckNhc2UoKSkudG8uZXF1YWwodG9rZW4xLndyYXBwZWQuYWRkcmVzcy50b0xvd2VyQ2FzZSgpKVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGV4cGVjdCh0b2tlbkluQWRkcmVzcy50b0xvd2VyQ2FzZSgpKS50by5lcXVhbCh0b2tlbjEud3JhcHBlZC5hZGRyZXNzLnRvTG93ZXJDYXNlKCkpXG4gICAgICAgICAgZXhwZWN0KHRva2VuT3V0QWRkcmVzcy50b0xvd2VyQ2FzZSgpKS50by5lcXVhbCh0b2tlbjAud3JhcHBlZC5hZGRyZXNzLnRvTG93ZXJDYXNlKCkpXG4gICAgICAgIH1cbiAgICAgIH0pXG5cbiAgICAgIGl0KCdleGVjdXRlcyBwcm9wZXJseSBhdCB0aGUgY29udHJhY3QgbGV2ZWwnLCBhc3luYyBmdW5jdGlvbiAoKSB7XG4gICAgICAgIGF3YWl0IHRlc3RTdWNjZXNzZnVsQ29udHJhY3RFeGVjdXRpb24ocmVzcG9uc2UsIHJlcXVlc3RQYXJhbXMsIHRva2VuMCwgdG9rZW4xLCB6ZXJvRm9yT25lKVxuICAgICAgfSlcbiAgICB9KVxuICB9XG5cbiAgLy8gQUxMIHRlc3RzIGluIHRoaXMgYmxvY2sgYXJlIHN1YnNlcXVlbnQgYW5kIG11c3QgYmUgcnVuIHRvZ2V0aGVyXG4gIGRlc2NyaWJlKCd3aGVuIGFkZGluZyB0byBhbiBleGlzdGluZyBwb3NpdGlvbicsIGFzeW5jICgpID0+IHtcbiAgICBsZXQgdG9rZW5JZDogc3RyaW5nXG5cbiAgICAvLyBiZWZvcmUgaG9vayB0aW1lcyBvdXQuIFRoaXMgdGVzdCBuZWVkZWQgZm9yIHN1YnNlcXVlbnQgdGVzdHMgaW4gdGhpcyBibG9jay5cbiAgICBpdCgnZmlyc3QgbWludCBuZXcgcG9zaXRpb24nLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCB0b2tlbjBCYWxhbmNlID0gcGFyc2VBbW91bnQoJzIwMDAnLCBEQUlfTUFJTk5FVCkucXVvdGllbnQudG9TdHJpbmcoKVxuICAgICAgY29uc3QgdG9rZW4xQmFsYW5jZSA9IHBhcnNlQW1vdW50KCc1MDAwJywgVVNEQ19NQUlOTkVUKS5xdW90aWVudC50b1N0cmluZygpXG5cbiAgICAgIHF1b3RlVG9SYXRpb1BhcmFtcyA9IHtcbiAgICAgICAgLi4uREVGQVVMVF9RVUVSWV9QQVJBTVMsXG4gICAgICAgIHRva2VuMEJhbGFuY2UsXG4gICAgICAgIHRva2VuMUJhbGFuY2UsXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHF1ZXJ5UGFyYW1zID0gcXMuc3RyaW5naWZ5KHF1b3RlVG9SYXRpb1BhcmFtcylcbiAgICAgIHJlc3BvbnNlID0gYXdhaXQgYXhpb3MuZ2V0PFF1b3RlVG9SYXRpb1Jlc3BvbnNlPihgJHtBUEl9PyR7cXVlcnlQYXJhbXN9YClcblxuICAgICAgY29uc3Qge1xuICAgICAgICBkYXRhOiB7IG1ldGhvZFBhcmFtZXRlcnMsIHBvc3RTd2FwVGFyZ2V0UG9vbCB9LFxuICAgICAgfSA9IHJlc3BvbnNlXG5cbiAgICAgIGNvbnN0IHsgZXZlbnRzIH0gPSBhd2FpdCBleGVjdXRlU3dhcEFuZEFkZChcbiAgICAgICAgcG9zdFN3YXBUYXJnZXRQb29sLmFkZHJlc3MsXG4gICAgICAgIG1ldGhvZFBhcmFtZXRlcnMhLFxuICAgICAgICBEQUlfTUFJTk5FVCxcbiAgICAgICAgVVNEQ19NQUlOTkVUXG4gICAgICApXG5cbiAgICAgIGNvbnN0IHsgb25DaGFpblBvc2l0aW9uIH0gPSBnZXRUZXN0UGFyYW1zRnJvbUV2ZW50cyhcbiAgICAgICAgZXZlbnRzLFxuICAgICAgICBEQUlfTUFJTk5FVCxcbiAgICAgICAgVVNEQ19NQUlOTkVULFxuICAgICAgICBhbGljZS5hZGRyZXNzLFxuICAgICAgICBwb3N0U3dhcFRhcmdldFBvb2wuYWRkcmVzc1xuICAgICAgKVxuXG4gICAgICB0b2tlbklkID0gb25DaGFpblBvc2l0aW9uLnRva2VuSWQudG9TdHJpbmcoKVxuICAgIH0pXG5cbiAgICBpdCgnZ2VuZXJhdGVzIGEgbGVnaXRpbWF0ZSB0cmFkZSB3aXRoIHJvdXRpbmctYXBpJywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgdG9rZW4wQmFsYW5jZSA9IHBhcnNlQW1vdW50KCczMDAwJywgREFJX01BSU5ORVQpLnF1b3RpZW50LnRvU3RyaW5nKClcbiAgICAgIGNvbnN0IHRva2VuMUJhbGFuY2UgPSBwYXJzZUFtb3VudCgnODAwMCcsIFVTRENfTUFJTk5FVCkucXVvdGllbnQudG9TdHJpbmcoKVxuICAgICAgY29uc3QgYWRkTGlxdWlkaXR5VG9rZW5JZCA9IHRva2VuSWRcbiAgICAgIGNvbnN0IGFkZExpcXVpZGl0eVJlY2lwaWVudCA9IHVuZGVmaW5lZFxuXG4gICAgICBxdW90ZVRvUmF0aW9QYXJhbXMgPSB7XG4gICAgICAgIC4uLkRFRkFVTFRfUVVFUllfUEFSQU1TLFxuICAgICAgICB0b2tlbjBCYWxhbmNlLFxuICAgICAgICB0b2tlbjFCYWxhbmNlLFxuICAgICAgICBhZGRMaXF1aWRpdHlUb2tlbklkLFxuICAgICAgICBhZGRMaXF1aWRpdHlSZWNpcGllbnQsXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHF1ZXJ5UGFyYW1zID0gcXMuc3RyaW5naWZ5KHF1b3RlVG9SYXRpb1BhcmFtcylcbiAgICAgIHJlc3BvbnNlID0gYXdhaXQgYXhpb3MuZ2V0PFF1b3RlVG9SYXRpb1Jlc3BvbnNlPihgJHtBUEl9PyR7cXVlcnlQYXJhbXN9YClcblxuICAgICAgY29uc3Qge1xuICAgICAgICBkYXRhOiB7IHRva2VuSW5BZGRyZXNzLCB0b2tlbk91dEFkZHJlc3MsIG5ld1JhdGlvRnJhY3Rpb24sIG9wdGltYWxSYXRpb0ZyYWN0aW9uIH0sXG4gICAgICAgIHN0YXR1cyxcbiAgICAgIH0gPSByZXNwb25zZVxuXG4gICAgICBjb25zdCBuZXdSYXRpbyA9IHBhcnNlRnJhY3Rpb24obmV3UmF0aW9GcmFjdGlvbilcbiAgICAgIGNvbnN0IG9wdGltYWxSYXRpbyA9IHBhcnNlRnJhY3Rpb24ob3B0aW1hbFJhdGlvRnJhY3Rpb24pXG4gICAgICBjb25zdCByYXRpb0RldmlhdGlvbiA9IGFic29sdXRlVmFsdWUobmV3IEZyYWN0aW9uKDEsIDEpLnN1YnRyYWN0KG5ld1JhdGlvLmRpdmlkZShvcHRpbWFsUmF0aW8pKSlcbiAgICAgIGNvbnN0IHJhdGlvRXJyb3JUb2xlcmFuY2VGcmFjdGlvbiA9IGVycm9yVG9sZXJhbmNlRnJhY3Rpb24ocXVvdGVUb1JhdGlvUGFyYW1zLnJhdGlvRXJyb3JUb2xlcmFuY2UpXG5cbiAgICAgIGV4cGVjdChzdGF0dXMpLnRvLmVxdWFsKDIwMCwgSlNPTi5zdHJpbmdpZnkocmVzcG9uc2UuZGF0YSkpXG4gICAgICBleHBlY3QocmF0aW9EZXZpYXRpb24ubGVzc1RoYW4ocmF0aW9FcnJvclRvbGVyYW5jZUZyYWN0aW9uKSkudG8uYmUudHJ1ZVxuICAgICAgZXhwZWN0KHRva2VuSW5BZGRyZXNzLnRvTG93ZXJDYXNlKCkpLnRvLmVxdWFsKFVTRENfTUFJTk5FVC5hZGRyZXNzLnRvTG93ZXJDYXNlKCkpXG4gICAgICBleHBlY3QodG9rZW5PdXRBZGRyZXNzLnRvTG93ZXJDYXNlKCkpLnRvLmVxdWFsKERBSV9NQUlOTkVULmFkZHJlc3MudG9Mb3dlckNhc2UoKSlcbiAgICB9KVxuXG4gICAgaXQoJ3N1Y2Nlc3NmdWxseSBleGVjdXRlcyBhdCB0aGUgY29udHJhY3QgbGV2ZWwnLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCB6ZXJvRm9yT25lID0gZmFsc2VcbiAgICAgIGF3YWl0IHRlc3RTdWNjZXNzZnVsQ29udHJhY3RFeGVjdXRpb24ocmVzcG9uc2UsIHF1b3RlVG9SYXRpb1BhcmFtcywgREFJX01BSU5ORVQsIFVTRENfTUFJTk5FVCwgemVyb0Zvck9uZSlcbiAgICB9KVxuICB9KVxuXG4gIGRlc2NyaWJlKCc0eHggRXJyb3IgcmVzcG9uc2UnLCAoKSA9PiB7XG4gICAgY29uc3QgRVJST1JfVEVTVF9DQVNFUzoge1xuICAgICAgdGVzdENhc2U6IHN0cmluZ1xuICAgICAgcmVxdWVzdFBhcmFtczogUXVvdGVUb1JhdGlvUXVlcnlQYXJhbXNcbiAgICAgIHJlc3VsdDoge1xuICAgICAgICBzdGF0dXM6IG51bWJlclxuICAgICAgICBkYXRhOiB7XG4gICAgICAgICAgZGV0YWlsOiBzdHJpbmdcbiAgICAgICAgICBlcnJvckNvZGU6IHN0cmluZ1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVtdID0gW1xuICAgICAge1xuICAgICAgICB0ZXN0Q2FzZTogJ3doZW4gYm90aCBiYWxhbmNlcyBhcmUgMCcsXG4gICAgICAgIHJlcXVlc3RQYXJhbXM6IHtcbiAgICAgICAgICAuLi5ERUZBVUxUX1FVRVJZX1BBUkFNUyxcbiAgICAgICAgICB0b2tlbjBCYWxhbmNlOiAnMCcsXG4gICAgICAgICAgdG9rZW4xQmFsYW5jZTogJzAnLFxuICAgICAgICB9LFxuICAgICAgICByZXN1bHQ6IHtcbiAgICAgICAgICBzdGF0dXM6IDQwMCxcbiAgICAgICAgICBkYXRhOiB7XG4gICAgICAgICAgICBkZXRhaWw6ICdObyBzd2FwIG5lZWRlZCcsXG4gICAgICAgICAgICBlcnJvckNvZGU6ICdOT19TV0FQX05FRURFRCcsXG4gICAgICAgICAgfSxcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgICB7XG4gICAgICAgIHRlc3RDYXNlOiAnd2hlbiBtYXggaXRlcmF0aW9ucyBpcyAwJyxcbiAgICAgICAgcmVxdWVzdFBhcmFtczoge1xuICAgICAgICAgIC4uLkRFRkFVTFRfUVVFUllfUEFSQU1TLFxuICAgICAgICAgIG1heEl0ZXJhdGlvbnM6IDAsXG4gICAgICAgIH0sXG4gICAgICAgIHJlc3VsdDoge1xuICAgICAgICAgIHN0YXR1czogNDAwLFxuICAgICAgICAgIGRhdGE6IHtcbiAgICAgICAgICAgIGRldGFpbDogJ1wibWF4SXRlcmF0aW9uc1wiIG11c3QgYmUgbGFyZ2VyIHRoYW4gb3IgZXF1YWwgdG8gMScsXG4gICAgICAgICAgICBlcnJvckNvZGU6ICdWQUxJREFUSU9OX0VSUk9SJyxcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgfSxcbiAgICAgIHtcbiAgICAgICAgdGVzdENhc2U6ICd3aGVuIHJhdGlvIGlzIGFscmVhZHkgZnVsZmlsbGVkIHdpdGggdG9rZW4xJyxcbiAgICAgICAgcmVxdWVzdFBhcmFtczoge1xuICAgICAgICAgIC4uLkRFRkFVTFRfUVVFUllfUEFSQU1TLFxuICAgICAgICAgIHRva2VuMEJhbGFuY2U6IHBhcnNlQW1vdW50KCcwJywgREFJX01BSU5ORVQpLnF1b3RpZW50LnRvU3RyaW5nKCksXG4gICAgICAgICAgdG9rZW4xQmFsYW5jZTogcGFyc2VBbW91bnQoJzUwMDAnLCBVU0RDX01BSU5ORVQpLnF1b3RpZW50LnRvU3RyaW5nKCksXG4gICAgICAgICAgdGlja0xvd2VyOiAtMjg2NDIwLFxuICAgICAgICAgIHRpY2tVcHBlcjogLTI3NjQyMCxcbiAgICAgICAgfSxcbiAgICAgICAgcmVzdWx0OiB7XG4gICAgICAgICAgc3RhdHVzOiA0MDAsXG4gICAgICAgICAgZGF0YToge1xuICAgICAgICAgICAgZGV0YWlsOiAnTm8gc3dhcCBuZWVkZWQgZm9yIHJhbmdlIG9yZGVyJyxcbiAgICAgICAgICAgIGVycm9yQ29kZTogJ05PX1NXQVBfTkVFREVEJyxcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgfSxcbiAgICAgIHtcbiAgICAgICAgdGVzdENhc2U6ICd3aGVuIHJhdGlvIGlzIGFscmVhZHkgZnVsZmlsbGVkIHdpdGggdG9rZW4wJyxcbiAgICAgICAgcmVxdWVzdFBhcmFtczoge1xuICAgICAgICAgIC4uLkRFRkFVTFRfUVVFUllfUEFSQU1TLFxuICAgICAgICAgIHRva2VuMEJhbGFuY2U6IHBhcnNlQW1vdW50KCc1MDAwMCcsIERBSV9NQUlOTkVUKS5xdW90aWVudC50b1N0cmluZygpLFxuICAgICAgICAgIHRva2VuMUJhbGFuY2U6IHBhcnNlQW1vdW50KCcwJywgVVNEQ19NQUlOTkVUKS5xdW90aWVudC50b1N0cmluZygpLFxuICAgICAgICAgIHRpY2tMb3dlcjogMCxcbiAgICAgICAgICB0aWNrVXBwZXI6IDYwLFxuICAgICAgICB9LFxuICAgICAgICByZXN1bHQ6IHtcbiAgICAgICAgICBzdGF0dXM6IDQwMCxcbiAgICAgICAgICBkYXRhOiB7XG4gICAgICAgICAgICBkZXRhaWw6ICdObyBzd2FwIG5lZWRlZCBmb3IgcmFuZ2Ugb3JkZXInLFxuICAgICAgICAgICAgZXJyb3JDb2RlOiAnTk9fU1dBUF9ORUVERUQnLFxuICAgICAgICAgIH0sXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgICAge1xuICAgICAgICB0ZXN0Q2FzZTogJ2Ftb3VudCBleGNlZWRzIHVpbnQyNTYnLFxuICAgICAgICByZXF1ZXN0UGFyYW1zOiB7XG4gICAgICAgICAgLi4uREVGQVVMVF9RVUVSWV9QQVJBTVMsXG4gICAgICAgICAgdG9rZW4wQmFsYW5jZTpcbiAgICAgICAgICAgICcxMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAnLFxuICAgICAgICB9LFxuICAgICAgICByZXN1bHQ6IHtcbiAgICAgICAgICBzdGF0dXM6IDQwMCxcbiAgICAgICAgICBkYXRhOiB7XG4gICAgICAgICAgICBkZXRhaWw6ICdcInRva2VuMEJhbGFuY2VcIiBsZW5ndGggbXVzdCBiZSBsZXNzIHRoYW4gb3IgZXF1YWwgdG8gNzcgY2hhcmFjdGVycyBsb25nJyxcbiAgICAgICAgICAgIGVycm9yQ29kZTogJ1ZBTElEQVRJT05fRVJST1InLFxuICAgICAgICAgIH0sXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgICAge1xuICAgICAgICB0ZXN0Q2FzZTogJ3dpdGggdW5rbm93biB0b2tlbicsXG4gICAgICAgIHJlcXVlc3RQYXJhbXM6IHtcbiAgICAgICAgICAuLi5ERUZBVUxUX1FVRVJZX1BBUkFNUyxcbiAgICAgICAgICB0b2tlbjBBZGRyZXNzOiAnVU5LTk9XTlRPS0VOJyxcbiAgICAgICAgfSxcbiAgICAgICAgcmVzdWx0OiB7XG4gICAgICAgICAgc3RhdHVzOiA0MDAsXG4gICAgICAgICAgZGF0YToge1xuICAgICAgICAgICAgZGV0YWlsOiAnQ291bGQgbm90IGZpbmQgdG9rZW4gd2l0aCBhZGRyZXNzIFwiVU5LTk9XTlRPS0VOXCInLFxuICAgICAgICAgICAgZXJyb3JDb2RlOiAnVE9LRU5fMF9JTlZBTElEJyxcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgfSxcbiAgICAgIHtcbiAgICAgICAgdGVzdENhc2U6ICd3aGVuIHRva2VucyBhcmUgdGhlIHNhbWUnLFxuICAgICAgICByZXF1ZXN0UGFyYW1zOiB7XG4gICAgICAgICAgLi4uREVGQVVMVF9RVUVSWV9QQVJBTVMsXG4gICAgICAgICAgdG9rZW4wQWRkcmVzczogREFJX01BSU5ORVQuYWRkcmVzcyxcbiAgICAgICAgICB0b2tlbjFBZGRyZXNzOiBEQUlfTUFJTk5FVC5hZGRyZXNzLFxuICAgICAgICB9LFxuICAgICAgICByZXN1bHQ6IHtcbiAgICAgICAgICBzdGF0dXM6IDQwMCxcbiAgICAgICAgICBkYXRhOiB7XG4gICAgICAgICAgICBkZXRhaWw6ICd0b2tlbjAgYW5kIHRva2VuMSBtdXN0IGJlIGRpZmZlcmVudCcsXG4gICAgICAgICAgICBlcnJvckNvZGU6ICdUT0tFTl8wXzFfU0FNRScsXG4gICAgICAgICAgfSxcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgICB7XG4gICAgICAgIHRlc3RDYXNlOiAnd2hlbiB0b2tlbiBhcmUgb3V0IG9mIG9yZGVyJyxcbiAgICAgICAgcmVxdWVzdFBhcmFtczoge1xuICAgICAgICAgIC4uLkRFRkFVTFRfUVVFUllfUEFSQU1TLFxuICAgICAgICAgIHRva2VuMEFkZHJlc3M6IFVTRENfTUFJTk5FVC5hZGRyZXNzLFxuICAgICAgICAgIHRva2VuMUFkZHJlc3M6IERBSV9NQUlOTkVULmFkZHJlc3MsXG4gICAgICAgIH0sXG4gICAgICAgIHJlc3VsdDoge1xuICAgICAgICAgIHN0YXR1czogNDAwLFxuICAgICAgICAgIGRhdGE6IHtcbiAgICAgICAgICAgIGRldGFpbDogJ3Rva2VuMCBhZGRyZXNzIG11c3QgYmUgbGVzcyB0aGFuIHRva2VuMSBhZGRyZXNzJyxcbiAgICAgICAgICAgIGVycm9yQ29kZTogJ1RPS0VOU19NSVNPUkRFUkVEJyxcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgfSxcbiAgICAgIHtcbiAgICAgICAgdGVzdENhc2U6ICd3aGVuIHRpY2sgaXMgbm90IGEgbXVsdGlwbGUgb2YgdGFyZ2V0IHBvb2wgdGljayBzcGFjaW5nJyxcbiAgICAgICAgcmVxdWVzdFBhcmFtczoge1xuICAgICAgICAgIC4uLkRFRkFVTFRfUVVFUllfUEFSQU1TLFxuICAgICAgICAgIHRpY2tMb3dlcjogLTQ0LFxuICAgICAgICB9LFxuICAgICAgICByZXN1bHQ6IHtcbiAgICAgICAgICBzdGF0dXM6IDQwMCxcbiAgICAgICAgICBkYXRhOiB7XG4gICAgICAgICAgICBkZXRhaWw6ICd0aWNrTG93ZXIgYW5kIHRpY2tVcHBlciBtdXN0IGNvbXBseSB3aXRoIHRoZSB0aWNrIHNwYWNpbmcgb2YgdGhlIHRhcmdldCBwb29sJyxcbiAgICAgICAgICAgIGVycm9yQ29kZTogJ0lOVkFMSURfVElDS19TUEFDSU5HJyxcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgfSxcbiAgICBdXG5cbiAgICBmb3IgKGNvbnN0IHsgdGVzdENhc2UsIHJlcXVlc3RQYXJhbXMsIHJlc3VsdCB9IG9mIEVSUk9SX1RFU1RfQ0FTRVMpIHtcbiAgICAgIGl0KHRlc3RDYXNlLCBhc3luYyAoKSA9PiB7XG4gICAgICAgIGF3YWl0IGNhbGxBbmRFeHBlY3RGYWlsKHJlcXVlc3RQYXJhbXMsIHJlc3VsdClcbiAgICAgIH0pXG4gICAgfVxuICB9KVxuXG4gIGNvbnN0IFRFU1RfRVJDMjBfMTogeyBbY2hhaW5JZCBpbiBDaGFpbklkXTogbnVsbCB8IFRva2VuIH0gPSB7XG4gICAgW0NoYWluSWQuTUFJTk5FVF06IFVTRENfT04oMSksXG4gICAgW0NoYWluSWQuUk9QU1RFTl06IFVTRENfT04oQ2hhaW5JZC5ST1BTVEVOKSxcbiAgICBbQ2hhaW5JZC5SSU5LRUJZXTogVVNEQ19PTihDaGFpbklkLlJJTktFQlkpLFxuICAgIFtDaGFpbklkLkfDllJMSV06IFVTRENfT04oQ2hhaW5JZC5Hw5ZSTEkpLFxuICAgIFtDaGFpbklkLktPVkFOXTogVVNEQ19PTihDaGFpbklkLktPVkFOKSxcbiAgICBbQ2hhaW5JZC5PUFRJTUlTTV06IFVTRENfT04oQ2hhaW5JZC5PUFRJTUlTTSksXG4gICAgW0NoYWluSWQuT1BUSU1JU1RJQ19LT1ZBTl06IFVTRENfT04oQ2hhaW5JZC5PUFRJTUlTVElDX0tPVkFOKSxcbiAgICBbQ2hhaW5JZC5PUFRJTUlTTV9HT0VSTEldOiBVU0RDX09OKENoYWluSWQuT1BUSU1JU01fR09FUkxJKSxcbiAgICBbQ2hhaW5JZC5BUkJJVFJVTV9PTkVdOiBVU0RDX09OKENoYWluSWQuQVJCSVRSVU1fT05FKSxcbiAgICBbQ2hhaW5JZC5BUkJJVFJVTV9SSU5LRUJZXTogVVNEQ19PTihDaGFpbklkLkFSQklUUlVNX1JJTktFQlkpLFxuICAgIFtDaGFpbklkLkFSQklUUlVNX0dPRVJMSV06IG51bGwsXG4gICAgW0NoYWluSWQuUE9MWUdPTl06IFVTRENfT04oQ2hhaW5JZC5QT0xZR09OKSxcbiAgICBbQ2hhaW5JZC5QT0xZR09OX01VTUJBSV06IFVTRENfT04oQ2hhaW5JZC5QT0xZR09OX01VTUJBSSksXG4gICAgW0NoYWluSWQuQ0VMT106IENVU0RfQ0VMTyxcbiAgICBbQ2hhaW5JZC5DRUxPX0FMRkFKT1JFU106IENVU0RfQ0VMT19BTEZBSk9SRVMsXG4gICAgW0NoYWluSWQuTU9PTkJFQU1dOiBudWxsLFxuICAgIFtDaGFpbklkLkdOT1NJU106IG51bGwsXG4gICAgW0NoYWluSWQuQlNDXTogVVNEQ19PTihDaGFpbklkLkJTQyksXG4gICAgW0NoYWluSWQuRkFOVE9NXTogVVNEQ19PTihDaGFpbklkLkZBTlRPTSksXG4gICAgW0NoYWluSWQuS0xBWVROXTogVVNEQ19PTihDaGFpbklkLktMQVlUTiksXG4gIH1cblxuICBjb25zdCBURVNUX0VSQzIwXzI6IHsgW2NoYWluSWQgaW4gQ2hhaW5JZF06IFRva2VuIHwgbnVsbCB9ID0ge1xuICAgIFtDaGFpbklkLk1BSU5ORVRdOiBEQUlfT04oMSksXG4gICAgW0NoYWluSWQuUk9QU1RFTl06IERBSV9PTihDaGFpbklkLlJPUFNURU4pLFxuICAgIFtDaGFpbklkLlJJTktFQlldOiBEQUlfT04oQ2hhaW5JZC5SSU5LRUJZKSxcbiAgICBbQ2hhaW5JZC5Hw5ZSTEldOiBEQUlfT04oQ2hhaW5JZC5Hw5ZSTEkpLFxuICAgIFtDaGFpbklkLktPVkFOXTogREFJX09OKENoYWluSWQuS09WQU4pLFxuICAgIFtDaGFpbklkLk9QVElNSVNNXTogREFJX09OKENoYWluSWQuT1BUSU1JU00pLFxuICAgIFtDaGFpbklkLk9QVElNSVNUSUNfS09WQU5dOiBEQUlfT04oQ2hhaW5JZC5PUFRJTUlTVElDX0tPVkFOKSxcbiAgICBbQ2hhaW5JZC5PUFRJTUlTTV9HT0VSTEldOiBEQUlfT04oQ2hhaW5JZC5PUFRJTUlTTV9HT0VSTEkpLFxuICAgIFtDaGFpbklkLkFSQklUUlVNX09ORV06IERBSV9PTihDaGFpbklkLkFSQklUUlVNX09ORSksXG4gICAgW0NoYWluSWQuQVJCSVRSVU1fUklOS0VCWV06IERBSV9PTihDaGFpbklkLkFSQklUUlVNX1JJTktFQlkpLFxuICAgIFtDaGFpbklkLlBPTFlHT05dOiBEQUlfT04oQ2hhaW5JZC5QT0xZR09OKSxcbiAgICBbQ2hhaW5JZC5QT0xZR09OX01VTUJBSV06IERBSV9PTihDaGFpbklkLlBPTFlHT05fTVVNQkFJKSxcbiAgICBbQ2hhaW5JZC5DRUxPXTogQ0VVUl9DRUxPLFxuICAgIFtDaGFpbklkLkNFTE9fQUxGQUpPUkVTXTogQ0VVUl9DRUxPX0FMRkFKT1JFUyxcbiAgICBbQ2hhaW5JZC5NT09OQkVBTV06IG51bGwsXG4gICAgW0NoYWluSWQuR05PU0lTXTogbnVsbCxcbiAgICBbQ2hhaW5JZC5BUkJJVFJVTV9HT0VSTEldOiBudWxsLFxuICAgIFtDaGFpbklkLkJTQ106IFVTRFRfT04oQ2hhaW5JZC5CU0MpLFxuICAgIFtDaGFpbklkLkZBTlRPTV06IFVTRFRfT04oQ2hhaW5JZC5GQU5UT00pLFxuICAgIFtDaGFpbklkLktMQVlUTl06IFVTRFRfT04oQ2hhaW5JZC5LTEFZVE4pLFxuICB9XG5cbiAgZm9yIChjb25zdCBjaGFpbiBvZiBfLmZpbHRlcihcbiAgICBTVVBQT1JURURfQ0hBSU5TLFxuICAgIChjKSA9PlxuICAgICAgYyAhPSBDaGFpbklkLlBPTFlHT04gJiZcbiAgICAgIGMgIT0gQ2hhaW5JZC5SSU5LRUJZICYmXG4gICAgICBjICE9IENoYWluSWQuT1BUSU1JU00gJiZcbiAgICAgIGMgIT0gQ2hhaW5JZC5PUFRJTUlTVElDX0tPVkFOICYmXG4gICAgICBjICE9IENoYWluSWQuT1BUSU1JU01fR09FUkxJICYmXG4gICAgICBjICE9IENoYWluSWQuUE9MWUdPTl9NVU1CQUkgJiZcbiAgICAgIGMgIT0gQ2hhaW5JZC5BUkJJVFJVTV9SSU5LRUJZICYmXG4gICAgICBjICE9IENoYWluSWQuQVJCSVRSVU1fR09FUkxJICYmXG4gICAgICBjICE9IENoYWluSWQuR8OWUkxJICYmXG4gICAgICBjICE9IENoYWluSWQuTU9PTkJFQU0gJiZcbiAgICAgIGMgIT0gQ2hhaW5JZC5HTk9TSVMgJiZcbiAgICAgIGMgIT0gQ2hhaW5JZC5GQU5UT00gJiZcbiAgICAgIGMgIT0gQ2hhaW5JZC5LTEFZVE4gJiZcbiAgICAgIGMgIT0gQ2hhaW5JZC5DRUxPICYmXG4gICAgICBjICE9IENoYWluSWQuQ0VMT19BTEZBSk9SRVMgJiZcbiAgICAgIGMgIT0gQ2hhaW5JZC5LT1ZBTiAmJlxuICAgICAgYyAhPSBDaGFpbklkLlJPUFNURU4gJiZcbiAgICAgIC8vLyBAZGV2IFdlIGNhbiBlbmFibGUgZm9yIEJTQyBhZnRlciBtb3JlIHBvb2xzIGFyZSBjcmVhdGVkXG4gICAgICBjICE9IENoYWluSWQuQlNDXG4gICkpIHtcbiAgICBjb25zdCBlcmMxID0gVEVTVF9FUkMyMF8xW2NoYWluXVxuICAgIGNvbnN0IGVyYzIgPSBURVNUX0VSQzIwXzJbY2hhaW5dXG5cbiAgICAvLyBUaGlzIGlzIGZvciBHbm9zaXMsIE1vb25iZWFtLCBhbmQgQXJiaXRydW0gR29lcmxpIHdoaWNoIHdlIGRvbid0IGhhdmUgUlBDIFByb3ZpZGVycyB5ZXRcbiAgICBpZiAoZXJjMSA9PSBudWxsIHx8IGVyYzIgPT0gbnVsbCkgY29udGludWVcblxuICAgIGRlc2NyaWJlKGAke0lEX1RPX05FVFdPUktfTkFNRShjaGFpbil9IDJ4eGAsIGZ1bmN0aW9uICgpIHtcbiAgICAgIC8vIEhlbHAgd2l0aCB0ZXN0IGZsYWtpbmVzcyBieSByZXRyeWluZy5cbiAgICAgIHRoaXMucmV0cmllcygxKVxuICAgICAgY29uc3Qgd3JhcHBlZE5hdGl2ZSA9IFdOQVRJVkVfT04oY2hhaW4pXG5cbiAgICAgIGxldCBjdXJyZW5jeTA6IEN1cnJlbmN5XG4gICAgICBsZXQgY3VycmVuY3kxOiBDdXJyZW5jeVxuXG4gICAgICBsZXQgY3VycmVuY3kwQmFsYW5jZTogc3RyaW5nXG4gICAgICBsZXQgY3VycmVuY3kxQmFsYW5jZTogc3RyaW5nXG5cbiAgICAgIGxldCB0b2tlbjA6IEN1cnJlbmN5XG4gICAgICBsZXQgdG9rZW4xOiBDdXJyZW5jeVxuXG4gICAgICBiZWZvcmVFYWNoKGFzeW5jICgpID0+IHtcbiAgICAgICAgaWYgKGVyYzEuc29ydHNCZWZvcmUod3JhcHBlZE5hdGl2ZSkpIHtcbiAgICAgICAgICBjdXJyZW5jeTAgPSBlcmMxXG4gICAgICAgICAgY3VycmVuY3kxID0gd3JhcHBlZE5hdGl2ZVxuICAgICAgICAgIGN1cnJlbmN5MEJhbGFuY2UgPSBwYXJzZUFtb3VudCgnMTAnLCBjdXJyZW5jeTApLnF1b3RpZW50LnRvU3RyaW5nKClcbiAgICAgICAgICBjdXJyZW5jeTFCYWxhbmNlID0gcGFyc2VBbW91bnQoJzAuNScsIGN1cnJlbmN5MSkucXVvdGllbnQudG9TdHJpbmcoKVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGN1cnJlbmN5MCA9IHdyYXBwZWROYXRpdmVcbiAgICAgICAgICBjdXJyZW5jeTEgPSBlcmMxXG4gICAgICAgICAgY3VycmVuY3kwQmFsYW5jZSA9IHBhcnNlQW1vdW50KCcwLjUnLCBjdXJyZW5jeTApLnF1b3RpZW50LnRvU3RyaW5nKClcbiAgICAgICAgICBjdXJyZW5jeTFCYWxhbmNlID0gcGFyc2VBbW91bnQoJzEwJywgY3VycmVuY3kxKS5xdW90aWVudC50b1N0cmluZygpXG4gICAgICAgIH1cblxuICAgICAgICBpZiAoZXJjMS5zb3J0c0JlZm9yZShlcmMyKSkge1xuICAgICAgICAgIHRva2VuMCA9IGVyYzFcbiAgICAgICAgICB0b2tlbjEgPSBlcmMyXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgdG9rZW4wID0gZXJjMlxuICAgICAgICAgIHRva2VuMSA9IGVyYzFcbiAgICAgICAgfVxuICAgICAgfSlcblxuICAgICAgaXQoYCR7d3JhcHBlZE5hdGl2ZS5zeW1ib2x9IC0+IGVyYzIwYCwgYXN5bmMgKCkgPT4ge1xuICAgICAgICBxdW90ZVRvUmF0aW9QYXJhbXMgPSB7XG4gICAgICAgICAgLi4uREVGQVVMVF9RVUVSWV9QQVJBTVMsXG4gICAgICAgICAgdGlja0xvd2VyOiBnZXRNaW5UaWNrKFRJQ0tfU1BBQ0lOR1NbRmVlQW1vdW50Lk1FRElVTV0pLFxuICAgICAgICAgIHRpY2tVcHBlcjogZ2V0TWF4VGljayhUSUNLX1NQQUNJTkdTW0ZlZUFtb3VudC5NRURJVU1dKSxcbiAgICAgICAgICBmZWVBbW91bnQ6IEZlZUFtb3VudC5NRURJVU0sXG4gICAgICAgICAgdG9rZW4wQmFsYW5jZTogY3VycmVuY3kwQmFsYW5jZSxcbiAgICAgICAgICB0b2tlbjFCYWxhbmNlOiBjdXJyZW5jeTFCYWxhbmNlLFxuICAgICAgICAgIHRva2VuMEFkZHJlc3M6IGN1cnJlbmN5MC53cmFwcGVkLmFkZHJlc3MsXG4gICAgICAgICAgdG9rZW4wQ2hhaW5JZDogY2hhaW4sXG4gICAgICAgICAgdG9rZW4xQWRkcmVzczogY3VycmVuY3kxLndyYXBwZWQuYWRkcmVzcyxcbiAgICAgICAgICB0b2tlbjFDaGFpbklkOiBjaGFpbixcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHF1ZXJ5UGFyYW1zID0gcXMuc3RyaW5naWZ5KHF1b3RlVG9SYXRpb1BhcmFtcylcblxuICAgICAgICB0cnkge1xuICAgICAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgYXhpb3MuZ2V0PFF1b3RlVG9SYXRpb1Jlc3BvbnNlPihgJHtBUEl9PyR7cXVlcnlQYXJhbXN9YClcbiAgICAgICAgICBjb25zdCB7IHN0YXR1cyB9ID0gcmVzcG9uc2VcblxuICAgICAgICAgIGV4cGVjdChzdGF0dXMpLnRvLmVxdWFsKDIwMClcbiAgICAgICAgfSBjYXRjaCAoZXJyOiBhbnkpIHtcbiAgICAgICAgICBmYWlsKEpTT04uc3RyaW5naWZ5KGVyci5yZXNwb25zZS5kYXRhKSlcbiAgICAgICAgfVxuICAgICAgfSlcblxuICAgICAgaXQoYGVyYzIwIC0+IGVyYzIwYCwgYXN5bmMgKCkgPT4ge1xuICAgICAgICBsZXQgdG9rZW4wQWRkcmVzczogc3RyaW5nXG4gICAgICAgIGxldCB0b2tlbjFBZGRyZXNzOiBzdHJpbmdcbiAgICAgICAgbGV0IHRva2VuMEJhbGFuY2U6IHN0cmluZ1xuICAgICAgICBsZXQgdG9rZW4xQmFsYW5jZTogc3RyaW5nXG4gICAgICAgIGxldCBmZWVUaWVyUGFyYW1zOiBhbnlcblxuICAgICAgICAvLyBmaW5kaW5nIGFjdGl2ZSBwb29scyBvbiBhcmItcmluayBpcyBkaWZmaWN1bHRcbiAgICAgICAgaWYgKGNoYWluID09IENoYWluSWQuQVJCSVRSVU1fUklOS0VCWSkge1xuICAgICAgICAgIHRva2VuMEFkZHJlc3MgPSAnMHhlMmM3NTBlZDg3ZTgxZTJkNGRhMjQ5ODJlYWUzODViYWQxMTZlZWZlJ1xuICAgICAgICAgIHRva2VuMUFkZHJlc3MgPSAnMHhmZWM1MDFmY2M1MThhNjk0NzNmMTMyYjRmZmYyOGE1NDJmZmZmZWM0J1xuICAgICAgICAgIHRva2VuMEJhbGFuY2UgPSBgMSR7JzAnLnJlcGVhdCgxOCl9YFxuICAgICAgICAgIHRva2VuMUJhbGFuY2UgPSBgMzAwMDAkeycwJy5yZXBlYXQoMTgpfWBcbiAgICAgICAgICBmZWVUaWVyUGFyYW1zID0ge1xuICAgICAgICAgICAgdGlja0xvd2VyOiBnZXRNaW5UaWNrKFRJQ0tfU1BBQ0lOR1NbRmVlQW1vdW50Lk1FRElVTV0pLFxuICAgICAgICAgICAgdGlja1VwcGVyOiBnZXRNYXhUaWNrKFRJQ0tfU1BBQ0lOR1NbRmVlQW1vdW50Lk1FRElVTV0pLFxuICAgICAgICAgICAgZmVlQW1vdW50OiBGZWVBbW91bnQuTUVESVVNLFxuICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBmZWVUaWVyUGFyYW1zID0ge31cbiAgICAgICAgICB0b2tlbjBBZGRyZXNzID0gdG9rZW4wLndyYXBwZWQuYWRkcmVzc1xuICAgICAgICAgIHRva2VuMUFkZHJlc3MgPSB0b2tlbjEud3JhcHBlZC5hZGRyZXNzXG4gICAgICAgICAgdG9rZW4wQmFsYW5jZSA9IHBhcnNlQW1vdW50KCcyMDAwJywgdG9rZW4wKS5xdW90aWVudC50b1N0cmluZygpXG4gICAgICAgICAgdG9rZW4xQmFsYW5jZSA9IHBhcnNlQW1vdW50KCcxMDAwJywgdG9rZW4xKS5xdW90aWVudC50b1N0cmluZygpXG4gICAgICAgICAgZmVlVGllclBhcmFtcyA9IHtcbiAgICAgICAgICAgIHRpY2tMb3dlcjogZ2V0TWluVGljayhUSUNLX1NQQUNJTkdTW0ZlZUFtb3VudC5NRURJVU1dKSxcbiAgICAgICAgICAgIHRpY2tVcHBlcjogZ2V0TWF4VGljayhUSUNLX1NQQUNJTkdTW0ZlZUFtb3VudC5NRURJVU1dKSxcbiAgICAgICAgICAgIGZlZUFtb3VudDogRmVlQW1vdW50Lk1FRElVTSxcbiAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBxdW90ZVRvUmF0aW9QYXJhbXMgPSB7XG4gICAgICAgICAgLi4uREVGQVVMVF9RVUVSWV9QQVJBTVMsXG4gICAgICAgICAgLi4uZmVlVGllclBhcmFtcyxcbiAgICAgICAgICB0b2tlbjBBZGRyZXNzLFxuICAgICAgICAgIHRva2VuMENoYWluSWQ6IGNoYWluLFxuICAgICAgICAgIHRva2VuMUFkZHJlc3MsXG4gICAgICAgICAgdG9rZW4xQ2hhaW5JZDogY2hhaW4sXG4gICAgICAgICAgdG9rZW4wQmFsYW5jZSxcbiAgICAgICAgICB0b2tlbjFCYWxhbmNlLFxuICAgICAgICB9XG4gICAgICAgIGNvbnN0IHF1ZXJ5UGFyYW1zID0gcXMuc3RyaW5naWZ5KHF1b3RlVG9SYXRpb1BhcmFtcylcblxuICAgICAgICB0cnkge1xuICAgICAgICAgIHJlc3BvbnNlID0gYXdhaXQgYXhpb3MuZ2V0PFF1b3RlVG9SYXRpb1Jlc3BvbnNlPihgJHtBUEl9PyR7cXVlcnlQYXJhbXN9YClcbiAgICAgICAgICBjb25zdCB7IHN0YXR1cyB9ID0gcmVzcG9uc2VcblxuICAgICAgICAgIGV4cGVjdChzdGF0dXMpLnRvLmVxdWFsKDIwMClcbiAgICAgICAgfSBjYXRjaCAoZXJyOiBhbnkpIHtcbiAgICAgICAgICBmYWlsKEpTT04uc3RyaW5naWZ5KGVyci5yZXNwb25zZS5kYXRhKSlcbiAgICAgICAgfVxuICAgICAgfSlcblxuICAgICAgY29uc3QgbmF0aXZlID0gTkFUSVZFX0NVUlJFTkNZW2NoYWluXVxuXG4gICAgICBpdChgJHtuYXRpdmV9IC0+IGVyYzIwYCwgYXN5bmMgKCkgPT4ge1xuICAgICAgICBjb25zdCB0b2tlbjBBZGRyZXNzID0gZXJjMi5zb3J0c0JlZm9yZSh3cmFwcGVkTmF0aXZlKSA/IGVyYzIud3JhcHBlZC5hZGRyZXNzIDogbmF0aXZlXG4gICAgICAgIGNvbnN0IHRva2VuMUFkZHJlc3MgPSBlcmMyLnNvcnRzQmVmb3JlKHdyYXBwZWROYXRpdmUpID8gbmF0aXZlIDogZXJjMi53cmFwcGVkLmFkZHJlc3NcblxuICAgICAgICBxdW90ZVRvUmF0aW9QYXJhbXMgPSB7XG4gICAgICAgICAgLi4uREVGQVVMVF9RVUVSWV9QQVJBTVMsXG4gICAgICAgICAgdGlja0xvd2VyOiBnZXRNaW5UaWNrKFRJQ0tfU1BBQ0lOR1NbRmVlQW1vdW50Lk1FRElVTV0pLFxuICAgICAgICAgIHRpY2tVcHBlcjogZ2V0TWF4VGljayhUSUNLX1NQQUNJTkdTW0ZlZUFtb3VudC5NRURJVU1dKSxcbiAgICAgICAgICBmZWVBbW91bnQ6IEZlZUFtb3VudC5NRURJVU0sXG4gICAgICAgICAgdG9rZW4wQWRkcmVzczogdG9rZW4wQWRkcmVzcyxcbiAgICAgICAgICB0b2tlbjBDaGFpbklkOiBjaGFpbixcbiAgICAgICAgICB0b2tlbjFBZGRyZXNzOiB0b2tlbjFBZGRyZXNzLFxuICAgICAgICAgIHRva2VuMUNoYWluSWQ6IGNoYWluLFxuICAgICAgICAgIHRva2VuMEJhbGFuY2U6IGN1cnJlbmN5MEJhbGFuY2UsXG4gICAgICAgICAgdG9rZW4xQmFsYW5jZTogY3VycmVuY3kxQmFsYW5jZSxcbiAgICAgICAgfVxuICAgICAgICBjb25zdCBxdWVyeVBhcmFtcyA9IHFzLnN0cmluZ2lmeShxdW90ZVRvUmF0aW9QYXJhbXMpXG5cbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICByZXNwb25zZSA9IGF3YWl0IGF4aW9zLmdldDxRdW90ZVRvUmF0aW9SZXNwb25zZT4oYCR7QVBJfT8ke3F1ZXJ5UGFyYW1zfWApXG4gICAgICAgICAgY29uc3QgeyBzdGF0dXMgfSA9IHJlc3BvbnNlXG5cbiAgICAgICAgICBleHBlY3Qoc3RhdHVzKS50by5lcXVhbCgyMDApXG4gICAgICAgIH0gY2F0Y2ggKGVycjogYW55KSB7XG4gICAgICAgICAgZmFpbChKU09OLnN0cmluZ2lmeShlcnIucmVzcG9uc2UuZGF0YSkpXG4gICAgICAgIH1cbiAgICAgIH0pXG4gICAgfSlcbiAgfVxufSlcbiJdfQ==