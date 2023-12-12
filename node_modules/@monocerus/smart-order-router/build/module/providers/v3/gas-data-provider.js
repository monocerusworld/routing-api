import { GasDataArbitrum__factory } from '../../types/other/factories/GasDataArbitrum__factory';
import { GasPriceOracle__factory } from '../../types/other/factories/GasPriceOracle__factory';
import { ARB_GASINFO_ADDRESS, ChainId, log, OVM_GASPRICE_ADDRESS, } from '../../util';
export class MantaGasDataProvider {
    constructor(chainId, multicall2Provider, gasPriceAddress) {
        this.chainId = chainId;
        this.multicall2Provider = multicall2Provider;
        if (chainId != ChainId.MANTA && chainId != ChainId.MANTA_TESTNET) {
            throw new Error('This data provider is used only on Manta networks.');
        }
        this.gasOracleAddress = gasPriceAddress !== null && gasPriceAddress !== void 0 ? gasPriceAddress : OVM_GASPRICE_ADDRESS;
    }
    /**
     * Gets the data constants needed to calculate the l1 security fee on Manta.
     * @returns An MantaGasData object that includes the l1BaseFee,
     * scalar, decimals, and overhead values.
     */
    async getGasData() {
        var _a, _b, _c, _d;
        const funcNames = ['l1BaseFee', 'scalar', 'decimals', 'overhead'];
        const tx = await this.multicall2Provider.callMultipleFunctionsOnSameContract({
            address: this.gasOracleAddress,
            contractInterface: GasPriceOracle__factory.createInterface(),
            functionNames: funcNames,
        });
        if (!((_a = tx.results[0]) === null || _a === void 0 ? void 0 : _a.success) ||
            !((_b = tx.results[1]) === null || _b === void 0 ? void 0 : _b.success) ||
            !((_c = tx.results[2]) === null || _c === void 0 ? void 0 : _c.success) ||
            !((_d = tx.results[3]) === null || _d === void 0 ? void 0 : _d.success)) {
            log.info({ results: tx.results }, 'Failed to get gas constants data from the Manta gas oracle');
            throw new Error('Failed to get gas constants data from the Manta gas oracle');
        }
        const { result: l1BaseFee } = tx.results[0];
        const { result: scalar } = tx.results[1];
        const { result: decimals } = tx.results[2];
        const { result: overhead } = tx.results[3];
        return {
            l1BaseFee: l1BaseFee[0],
            scalar: scalar[0],
            decimals: decimals[0],
            overhead: overhead[0],
        };
    }
}
export class ArbitrumGasDataProvider {
    constructor(chainId, provider, gasDataAddress) {
        this.chainId = chainId;
        this.provider = provider;
        this.gasFeesAddress = gasDataAddress ? gasDataAddress : ARB_GASINFO_ADDRESS;
    }
    async getGasData() {
        const gasDataContract = GasDataArbitrum__factory.connect(this.gasFeesAddress, this.provider);
        const gasData = await gasDataContract.getPricesInWei();
        return {
            perL2TxFee: gasData[0],
            perL1CalldataFee: gasData[1],
            perArbGasTotal: gasData[5],
        };
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZ2FzLWRhdGEtcHJvdmlkZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvcHJvdmlkZXJzL3YzL2dhcy1kYXRhLXByb3ZpZGVyLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUdBLE9BQU8sRUFBRSx3QkFBd0IsRUFBRSxNQUFNLHNEQUFzRCxDQUFDO0FBQ2hHLE9BQU8sRUFBRSx1QkFBdUIsRUFBRSxNQUFNLHFEQUFxRCxDQUFDO0FBQzlGLE9BQU8sRUFDTCxtQkFBbUIsRUFDbkIsT0FBTyxFQUNQLEdBQUcsRUFDSCxvQkFBb0IsR0FDckIsTUFBTSxZQUFZLENBQUM7QUF3QnBCLE1BQU0sT0FBTyxvQkFBb0I7SUFLL0IsWUFDWSxPQUFnQixFQUNoQixrQkFBc0MsRUFDaEQsZUFBd0I7UUFGZCxZQUFPLEdBQVAsT0FBTyxDQUFTO1FBQ2hCLHVCQUFrQixHQUFsQixrQkFBa0IsQ0FBb0I7UUFHaEQsSUFBSSxPQUFPLElBQUksT0FBTyxDQUFDLEtBQUssSUFBSSxPQUFPLElBQUksT0FBTyxDQUFDLGFBQWEsRUFBRTtZQUNoRSxNQUFNLElBQUksS0FBSyxDQUFDLG9EQUFvRCxDQUFDLENBQUM7U0FDdkU7UUFDRCxJQUFJLENBQUMsZ0JBQWdCLEdBQUcsZUFBZSxhQUFmLGVBQWUsY0FBZixlQUFlLEdBQUksb0JBQW9CLENBQUM7SUFDbEUsQ0FBQztJQUVEOzs7O09BSUc7SUFDSSxLQUFLLENBQUMsVUFBVTs7UUFDckIsTUFBTSxTQUFTLEdBQUcsQ0FBQyxXQUFXLEVBQUUsUUFBUSxFQUFFLFVBQVUsRUFBRSxVQUFVLENBQUMsQ0FBQztRQUNsRSxNQUFNLEVBQUUsR0FDTixNQUFNLElBQUksQ0FBQyxrQkFBa0IsQ0FBQyxtQ0FBbUMsQ0FHL0Q7WUFDQSxPQUFPLEVBQUUsSUFBSSxDQUFDLGdCQUFnQjtZQUM5QixpQkFBaUIsRUFBRSx1QkFBdUIsQ0FBQyxlQUFlLEVBQUU7WUFDNUQsYUFBYSxFQUFFLFNBQVM7U0FDekIsQ0FBQyxDQUFDO1FBRUwsSUFDRSxDQUFDLENBQUEsTUFBQSxFQUFFLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQywwQ0FBRSxPQUFPLENBQUE7WUFDdkIsQ0FBQyxDQUFBLE1BQUEsRUFBRSxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsMENBQUUsT0FBTyxDQUFBO1lBQ3ZCLENBQUMsQ0FBQSxNQUFBLEVBQUUsQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLDBDQUFFLE9BQU8sQ0FBQTtZQUN2QixDQUFDLENBQUEsTUFBQSxFQUFFLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQywwQ0FBRSxPQUFPLENBQUEsRUFDdkI7WUFDQSxHQUFHLENBQUMsSUFBSSxDQUNOLEVBQUUsT0FBTyxFQUFFLEVBQUUsQ0FBQyxPQUFPLEVBQUUsRUFDdkIsNERBQTRELENBQzdELENBQUM7WUFDRixNQUFNLElBQUksS0FBSyxDQUNiLDREQUE0RCxDQUM3RCxDQUFDO1NBQ0g7UUFFRCxNQUFNLEVBQUUsTUFBTSxFQUFFLFNBQVMsRUFBRSxHQUFHLEVBQUUsQ0FBQyxPQUFRLENBQUMsQ0FBQyxDQUFDLENBQUM7UUFDN0MsTUFBTSxFQUFFLE1BQU0sRUFBRSxNQUFNLEVBQUUsR0FBRyxFQUFFLENBQUMsT0FBUSxDQUFDLENBQUMsQ0FBQyxDQUFDO1FBQzFDLE1BQU0sRUFBRSxNQUFNLEVBQUUsUUFBUSxFQUFFLEdBQUcsRUFBRSxDQUFDLE9BQVEsQ0FBQyxDQUFDLENBQUMsQ0FBQztRQUM1QyxNQUFNLEVBQUUsTUFBTSxFQUFFLFFBQVEsRUFBRSxHQUFHLEVBQUUsQ0FBQyxPQUFRLENBQUMsQ0FBQyxDQUFDLENBQUM7UUFFNUMsT0FBTztZQUNMLFNBQVMsRUFBRSxTQUFTLENBQUMsQ0FBQyxDQUFDO1lBQ3ZCLE1BQU0sRUFBRSxNQUFNLENBQUMsQ0FBQyxDQUFDO1lBQ2pCLFFBQVEsRUFBRSxRQUFRLENBQUMsQ0FBQyxDQUFDO1lBQ3JCLFFBQVEsRUFBRSxRQUFRLENBQUMsQ0FBQyxDQUFDO1NBQ3RCLENBQUM7SUFDSixDQUFDO0NBQ0Y7QUFhRCxNQUFNLE9BQU8sdUJBQXVCO0lBS2xDLFlBQ1ksT0FBZ0IsRUFDaEIsUUFBc0IsRUFDaEMsY0FBdUI7UUFGYixZQUFPLEdBQVAsT0FBTyxDQUFTO1FBQ2hCLGFBQVEsR0FBUixRQUFRLENBQWM7UUFHaEMsSUFBSSxDQUFDLGNBQWMsR0FBRyxjQUFjLENBQUMsQ0FBQyxDQUFDLGNBQWMsQ0FBQyxDQUFDLENBQUMsbUJBQW1CLENBQUM7SUFDOUUsQ0FBQztJQUVNLEtBQUssQ0FBQyxVQUFVO1FBQ3JCLE1BQU0sZUFBZSxHQUFHLHdCQUF3QixDQUFDLE9BQU8sQ0FDdEQsSUFBSSxDQUFDLGNBQWMsRUFDbkIsSUFBSSxDQUFDLFFBQVEsQ0FDZCxDQUFDO1FBQ0YsTUFBTSxPQUFPLEdBQUcsTUFBTSxlQUFlLENBQUMsY0FBYyxFQUFFLENBQUM7UUFDdkQsT0FBTztZQUNMLFVBQVUsRUFBRSxPQUFPLENBQUMsQ0FBQyxDQUFDO1lBQ3RCLGdCQUFnQixFQUFFLE9BQU8sQ0FBQyxDQUFDLENBQUM7WUFDNUIsY0FBYyxFQUFFLE9BQU8sQ0FBQyxDQUFDLENBQUM7U0FDM0IsQ0FBQztJQUNKLENBQUM7Q0FDRiJ9