import { expect } from 'chai';
import { PairTradeTypeChainId } from '../../../../../../lib/handlers/router-entities/route-caching';
import { TradeType } from '@uniswap/sdk-core';
import { ChainId } from '@tartz-one/smart-order-router';
describe('PairTradeTypeChainId', () => {
    const WETH = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';
    const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
    describe('toString', () => {
        it('returns a stringified version of the object', () => {
            const pairTradeTypeChainId = new PairTradeTypeChainId({
                tokenIn: WETH,
                tokenOut: USDC,
                tradeType: TradeType.EXACT_INPUT,
                chainId: ChainId.MAINNET,
            });
            expect(pairTradeTypeChainId.toString()).to.eq(`${WETH.toLowerCase()}/${USDC.toLowerCase()}/${TradeType.EXACT_INPUT}/${ChainId.MAINNET}`);
        });
        it('token addresses are converted to lowercase', () => {
            const pairTradeTypeChainId = new PairTradeTypeChainId({
                tokenIn: WETH.toUpperCase(),
                tokenOut: USDC.toUpperCase(),
                tradeType: TradeType.EXACT_INPUT,
                chainId: ChainId.MAINNET,
            });
            expect(pairTradeTypeChainId.toString()).to.eq(`${WETH.toLowerCase()}/${USDC.toLowerCase()}/${TradeType.EXACT_INPUT}/${ChainId.MAINNET}`);
        });
        it('works with ExactOutput too', () => {
            const pairTradeTypeChainId = new PairTradeTypeChainId({
                tokenIn: WETH.toUpperCase(),
                tokenOut: USDC.toUpperCase(),
                tradeType: TradeType.EXACT_OUTPUT,
                chainId: ChainId.MAINNET,
            });
            expect(pairTradeTypeChainId.toString()).to.eq(`${WETH.toLowerCase()}/${USDC.toLowerCase()}/${TradeType.EXACT_OUTPUT}/${ChainId.MAINNET}`);
        });
        it('works with other chains', () => {
            const pairTradeTypeChainId = new PairTradeTypeChainId({
                tokenIn: WETH.toUpperCase(),
                tokenOut: USDC.toUpperCase(),
                tradeType: TradeType.EXACT_OUTPUT,
                chainId: ChainId.ARBITRUM_ONE,
            });
            expect(pairTradeTypeChainId.toString()).to.eq(`${WETH.toLowerCase()}/${USDC.toLowerCase()}/${TradeType.EXACT_OUTPUT}/${ChainId.ARBITRUM_ONE}`);
        });
    });
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicGFpci10cmFkZS10eXBlLWNoYWluLWlkLnRlc3QuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi8uLi8uLi90ZXN0L3VuaXQvaGFuZGxlcnMvcm91dGVyLWVudGl0aWVzL3JvdXRlLWNhY2hpbmcvbW9kZWwvcGFpci10cmFkZS10eXBlLWNoYWluLWlkLnRlc3QudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsT0FBTyxFQUFFLE1BQU0sRUFBRSxNQUFNLE1BQU0sQ0FBQTtBQUM3QixPQUFPLEVBQUUsb0JBQW9CLEVBQUUsTUFBTSw4REFBOEQsQ0FBQTtBQUNuRyxPQUFPLEVBQUUsU0FBUyxFQUFFLE1BQU0sbUJBQW1CLENBQUE7QUFDN0MsT0FBTyxFQUFFLE9BQU8sRUFBRSxNQUFNLCtCQUErQixDQUFBO0FBQ3ZELFFBQVEsQ0FBQyxzQkFBc0IsRUFBRSxHQUFHLEVBQUU7SUFDcEMsTUFBTSxJQUFJLEdBQUcsNENBQTRDLENBQUE7SUFDekQsTUFBTSxJQUFJLEdBQUcsNENBQTRDLENBQUE7SUFFekQsUUFBUSxDQUFDLFVBQVUsRUFBRSxHQUFHLEVBQUU7UUFDeEIsRUFBRSxDQUFDLDZDQUE2QyxFQUFFLEdBQUcsRUFBRTtZQUNyRCxNQUFNLG9CQUFvQixHQUFHLElBQUksb0JBQW9CLENBQUM7Z0JBQ3BELE9BQU8sRUFBRSxJQUFJO2dCQUNiLFFBQVEsRUFBRSxJQUFJO2dCQUNkLFNBQVMsRUFBRSxTQUFTLENBQUMsV0FBVztnQkFDaEMsT0FBTyxFQUFFLE9BQU8sQ0FBQyxPQUFPO2FBQ3pCLENBQUMsQ0FBQTtZQUVGLE1BQU0sQ0FBQyxvQkFBb0IsQ0FBQyxRQUFRLEVBQUUsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxFQUFFLENBQzNDLEdBQUcsSUFBSSxDQUFDLFdBQVcsRUFBRSxJQUFJLElBQUksQ0FBQyxXQUFXLEVBQUUsSUFBSSxTQUFTLENBQUMsV0FBVyxJQUFJLE9BQU8sQ0FBQyxPQUFPLEVBQUUsQ0FDMUYsQ0FBQTtRQUNILENBQUMsQ0FBQyxDQUFBO1FBRUYsRUFBRSxDQUFDLDRDQUE0QyxFQUFFLEdBQUcsRUFBRTtZQUNwRCxNQUFNLG9CQUFvQixHQUFHLElBQUksb0JBQW9CLENBQUM7Z0JBQ3BELE9BQU8sRUFBRSxJQUFJLENBQUMsV0FBVyxFQUFFO2dCQUMzQixRQUFRLEVBQUUsSUFBSSxDQUFDLFdBQVcsRUFBRTtnQkFDNUIsU0FBUyxFQUFFLFNBQVMsQ0FBQyxXQUFXO2dCQUNoQyxPQUFPLEVBQUUsT0FBTyxDQUFDLE9BQU87YUFDekIsQ0FBQyxDQUFBO1lBRUYsTUFBTSxDQUFDLG9CQUFvQixDQUFDLFFBQVEsRUFBRSxDQUFDLENBQUMsRUFBRSxDQUFDLEVBQUUsQ0FDM0MsR0FBRyxJQUFJLENBQUMsV0FBVyxFQUFFLElBQUksSUFBSSxDQUFDLFdBQVcsRUFBRSxJQUFJLFNBQVMsQ0FBQyxXQUFXLElBQUksT0FBTyxDQUFDLE9BQU8sRUFBRSxDQUMxRixDQUFBO1FBQ0gsQ0FBQyxDQUFDLENBQUE7UUFFRixFQUFFLENBQUMsNEJBQTRCLEVBQUUsR0FBRyxFQUFFO1lBQ3BDLE1BQU0sb0JBQW9CLEdBQUcsSUFBSSxvQkFBb0IsQ0FBQztnQkFDcEQsT0FBTyxFQUFFLElBQUksQ0FBQyxXQUFXLEVBQUU7Z0JBQzNCLFFBQVEsRUFBRSxJQUFJLENBQUMsV0FBVyxFQUFFO2dCQUM1QixTQUFTLEVBQUUsU0FBUyxDQUFDLFlBQVk7Z0JBQ2pDLE9BQU8sRUFBRSxPQUFPLENBQUMsT0FBTzthQUN6QixDQUFDLENBQUE7WUFFRixNQUFNLENBQUMsb0JBQW9CLENBQUMsUUFBUSxFQUFFLENBQUMsQ0FBQyxFQUFFLENBQUMsRUFBRSxDQUMzQyxHQUFHLElBQUksQ0FBQyxXQUFXLEVBQUUsSUFBSSxJQUFJLENBQUMsV0FBVyxFQUFFLElBQUksU0FBUyxDQUFDLFlBQVksSUFBSSxPQUFPLENBQUMsT0FBTyxFQUFFLENBQzNGLENBQUE7UUFDSCxDQUFDLENBQUMsQ0FBQTtRQUVGLEVBQUUsQ0FBQyx5QkFBeUIsRUFBRSxHQUFHLEVBQUU7WUFDakMsTUFBTSxvQkFBb0IsR0FBRyxJQUFJLG9CQUFvQixDQUFDO2dCQUNwRCxPQUFPLEVBQUUsSUFBSSxDQUFDLFdBQVcsRUFBRTtnQkFDM0IsUUFBUSxFQUFFLElBQUksQ0FBQyxXQUFXLEVBQUU7Z0JBQzVCLFNBQVMsRUFBRSxTQUFTLENBQUMsWUFBWTtnQkFDakMsT0FBTyxFQUFFLE9BQU8sQ0FBQyxZQUFZO2FBQzlCLENBQUMsQ0FBQTtZQUVGLE1BQU0sQ0FBQyxvQkFBb0IsQ0FBQyxRQUFRLEVBQUUsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxFQUFFLENBQzNDLEdBQUcsSUFBSSxDQUFDLFdBQVcsRUFBRSxJQUFJLElBQUksQ0FBQyxXQUFXLEVBQUUsSUFBSSxTQUFTLENBQUMsWUFBWSxJQUFJLE9BQU8sQ0FBQyxZQUFZLEVBQUUsQ0FDaEcsQ0FBQTtRQUNILENBQUMsQ0FBQyxDQUFBO0lBQ0osQ0FBQyxDQUFDLENBQUE7QUFDSixDQUFDLENBQUMsQ0FBQSIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IGV4cGVjdCB9IGZyb20gJ2NoYWknXG5pbXBvcnQgeyBQYWlyVHJhZGVUeXBlQ2hhaW5JZCB9IGZyb20gJy4uLy4uLy4uLy4uLy4uLy4uL2xpYi9oYW5kbGVycy9yb3V0ZXItZW50aXRpZXMvcm91dGUtY2FjaGluZydcbmltcG9ydCB7IFRyYWRlVHlwZSB9IGZyb20gJ0B1bmlzd2FwL3Nkay1jb3JlJ1xuaW1wb3J0IHsgQ2hhaW5JZCB9IGZyb20gJ0B0YXJ0ei1vbmUvc21hcnQtb3JkZXItcm91dGVyJ1xuZGVzY3JpYmUoJ1BhaXJUcmFkZVR5cGVDaGFpbklkJywgKCkgPT4ge1xuICBjb25zdCBXRVRIID0gJzB4YzAyYWFhMzliMjIzZmU4ZDBhMGU1YzRmMjdlYWQ5MDgzYzc1NmNjMidcbiAgY29uc3QgVVNEQyA9ICcweGEwYjg2OTkxYzYyMThiMzZjMWQxOWQ0YTJlOWViMGNlMzYwNmViNDgnXG5cbiAgZGVzY3JpYmUoJ3RvU3RyaW5nJywgKCkgPT4ge1xuICAgIGl0KCdyZXR1cm5zIGEgc3RyaW5naWZpZWQgdmVyc2lvbiBvZiB0aGUgb2JqZWN0JywgKCkgPT4ge1xuICAgICAgY29uc3QgcGFpclRyYWRlVHlwZUNoYWluSWQgPSBuZXcgUGFpclRyYWRlVHlwZUNoYWluSWQoe1xuICAgICAgICB0b2tlbkluOiBXRVRILFxuICAgICAgICB0b2tlbk91dDogVVNEQyxcbiAgICAgICAgdHJhZGVUeXBlOiBUcmFkZVR5cGUuRVhBQ1RfSU5QVVQsXG4gICAgICAgIGNoYWluSWQ6IENoYWluSWQuTUFJTk5FVCxcbiAgICAgIH0pXG5cbiAgICAgIGV4cGVjdChwYWlyVHJhZGVUeXBlQ2hhaW5JZC50b1N0cmluZygpKS50by5lcShcbiAgICAgICAgYCR7V0VUSC50b0xvd2VyQ2FzZSgpfS8ke1VTREMudG9Mb3dlckNhc2UoKX0vJHtUcmFkZVR5cGUuRVhBQ1RfSU5QVVR9LyR7Q2hhaW5JZC5NQUlOTkVUfWBcbiAgICAgIClcbiAgICB9KVxuXG4gICAgaXQoJ3Rva2VuIGFkZHJlc3NlcyBhcmUgY29udmVydGVkIHRvIGxvd2VyY2FzZScsICgpID0+IHtcbiAgICAgIGNvbnN0IHBhaXJUcmFkZVR5cGVDaGFpbklkID0gbmV3IFBhaXJUcmFkZVR5cGVDaGFpbklkKHtcbiAgICAgICAgdG9rZW5JbjogV0VUSC50b1VwcGVyQ2FzZSgpLFxuICAgICAgICB0b2tlbk91dDogVVNEQy50b1VwcGVyQ2FzZSgpLFxuICAgICAgICB0cmFkZVR5cGU6IFRyYWRlVHlwZS5FWEFDVF9JTlBVVCxcbiAgICAgICAgY2hhaW5JZDogQ2hhaW5JZC5NQUlOTkVULFxuICAgICAgfSlcblxuICAgICAgZXhwZWN0KHBhaXJUcmFkZVR5cGVDaGFpbklkLnRvU3RyaW5nKCkpLnRvLmVxKFxuICAgICAgICBgJHtXRVRILnRvTG93ZXJDYXNlKCl9LyR7VVNEQy50b0xvd2VyQ2FzZSgpfS8ke1RyYWRlVHlwZS5FWEFDVF9JTlBVVH0vJHtDaGFpbklkLk1BSU5ORVR9YFxuICAgICAgKVxuICAgIH0pXG5cbiAgICBpdCgnd29ya3Mgd2l0aCBFeGFjdE91dHB1dCB0b28nLCAoKSA9PiB7XG4gICAgICBjb25zdCBwYWlyVHJhZGVUeXBlQ2hhaW5JZCA9IG5ldyBQYWlyVHJhZGVUeXBlQ2hhaW5JZCh7XG4gICAgICAgIHRva2VuSW46IFdFVEgudG9VcHBlckNhc2UoKSxcbiAgICAgICAgdG9rZW5PdXQ6IFVTREMudG9VcHBlckNhc2UoKSxcbiAgICAgICAgdHJhZGVUeXBlOiBUcmFkZVR5cGUuRVhBQ1RfT1VUUFVULFxuICAgICAgICBjaGFpbklkOiBDaGFpbklkLk1BSU5ORVQsXG4gICAgICB9KVxuXG4gICAgICBleHBlY3QocGFpclRyYWRlVHlwZUNoYWluSWQudG9TdHJpbmcoKSkudG8uZXEoXG4gICAgICAgIGAke1dFVEgudG9Mb3dlckNhc2UoKX0vJHtVU0RDLnRvTG93ZXJDYXNlKCl9LyR7VHJhZGVUeXBlLkVYQUNUX09VVFBVVH0vJHtDaGFpbklkLk1BSU5ORVR9YFxuICAgICAgKVxuICAgIH0pXG5cbiAgICBpdCgnd29ya3Mgd2l0aCBvdGhlciBjaGFpbnMnLCAoKSA9PiB7XG4gICAgICBjb25zdCBwYWlyVHJhZGVUeXBlQ2hhaW5JZCA9IG5ldyBQYWlyVHJhZGVUeXBlQ2hhaW5JZCh7XG4gICAgICAgIHRva2VuSW46IFdFVEgudG9VcHBlckNhc2UoKSxcbiAgICAgICAgdG9rZW5PdXQ6IFVTREMudG9VcHBlckNhc2UoKSxcbiAgICAgICAgdHJhZGVUeXBlOiBUcmFkZVR5cGUuRVhBQ1RfT1VUUFVULFxuICAgICAgICBjaGFpbklkOiBDaGFpbklkLkFSQklUUlVNX09ORSxcbiAgICAgIH0pXG5cbiAgICAgIGV4cGVjdChwYWlyVHJhZGVUeXBlQ2hhaW5JZC50b1N0cmluZygpKS50by5lcShcbiAgICAgICAgYCR7V0VUSC50b0xvd2VyQ2FzZSgpfS8ke1VTREMudG9Mb3dlckNhc2UoKX0vJHtUcmFkZVR5cGUuRVhBQ1RfT1VUUFVUfS8ke0NoYWluSWQuQVJCSVRSVU1fT05FfWBcbiAgICAgIClcbiAgICB9KVxuICB9KVxufSlcbiJdfQ==