import { Protocol } from '@uniswap/router-sdk'
import { ChainId, V2SubgraphProvider, V3SubgraphProvider } from '@monocerus/smart-order-router'

export const chainProtocols = [
  // V3.
  {
    protocol: Protocol.V3,
    chainId: ChainId.MAINNET,
    timeout: 90000,
    provider: new V3SubgraphProvider(ChainId.MAINNET, 3, 90000),
  },
  {
    protocol: Protocol.V3,
    chainId: ChainId.MANTA,
    timeout: 90000,
    provider: new V3SubgraphProvider(ChainId.MANTA, 3, 90000),
  },
  {
    protocol: Protocol.V3,
    chainId: ChainId.MANTA_TESTNET,
    timeout: 90000,
    provider: new V3SubgraphProvider(ChainId.MANTA_TESTNET, 3, 90000),
  },
  // Currently there is no working V3 subgraph for Optimism so we use a static provider.
  // V2.

  {
    protocol: Protocol.V2,
    chainId: ChainId.MAINNET,
    timeout: 840000,
    provider: new V2SubgraphProvider(ChainId.MAINNET, 3, 900000, true, 250),
  },
]
