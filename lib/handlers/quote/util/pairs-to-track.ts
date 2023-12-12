import { TradeType } from '@uniswap/sdk-core'
import { ChainId } from '@monocerus/smart-order-router'

export const PAIRS_TO_TRACK: Map<ChainId, Map<TradeType, string[]>> = new Map([
  [
    ChainId.MAINNET,
    new Map([
      [TradeType.EXACT_INPUT, ['WETH/USDC', 'USDC/WETH', 'USDT/WETH', 'WETH/USDT']],
      [TradeType.EXACT_OUTPUT, ['USDC/WETH']],
    ]),
  ],
  [ChainId.MANTA, new Map([[TradeType.EXACT_INPUT, ['WETH/USDC', 'USDC/WETH']]])],
  [ChainId.MANTA_TESTNET, new Map([[TradeType.EXACT_INPUT, ['WMANTA/USDC', 'USDC/WMANTA']]])],
])
