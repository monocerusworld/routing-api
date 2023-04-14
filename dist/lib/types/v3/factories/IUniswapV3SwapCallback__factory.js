/* Autogenerated file. Do not edit manually. */
/* tslint:disable */
/* eslint-disable */
import { Contract, utils } from "ethers";
const _abi = [
    {
        inputs: [
            {
                internalType: "int256",
                name: "amount0Delta",
                type: "int256",
            },
            {
                internalType: "int256",
                name: "amount1Delta",
                type: "int256",
            },
            {
                internalType: "bytes",
                name: "data",
                type: "bytes",
            },
        ],
        name: "uniswapV3SwapCallback",
        outputs: [],
        stateMutability: "nonpayable",
        type: "function",
    },
];
export class IUniswapV3SwapCallback__factory {
    static createInterface() {
        return new utils.Interface(_abi);
    }
    static connect(address, signerOrProvider) {
        return new Contract(address, _abi, signerOrProvider);
    }
}
IUniswapV3SwapCallback__factory.abi = _abi;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiSVVuaXN3YXBWM1N3YXBDYWxsYmFja19fZmFjdG9yeS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uLy4uL2xpYi90eXBlcy92My9mYWN0b3JpZXMvSVVuaXN3YXBWM1N3YXBDYWxsYmFja19fZmFjdG9yeS50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSwrQ0FBK0M7QUFDL0Msb0JBQW9CO0FBQ3BCLG9CQUFvQjtBQUVwQixPQUFPLEVBQUUsUUFBUSxFQUFVLEtBQUssRUFBRSxNQUFNLFFBQVEsQ0FBQztBQU9qRCxNQUFNLElBQUksR0FBRztJQUNYO1FBQ0UsTUFBTSxFQUFFO1lBQ047Z0JBQ0UsWUFBWSxFQUFFLFFBQVE7Z0JBQ3RCLElBQUksRUFBRSxjQUFjO2dCQUNwQixJQUFJLEVBQUUsUUFBUTthQUNmO1lBQ0Q7Z0JBQ0UsWUFBWSxFQUFFLFFBQVE7Z0JBQ3RCLElBQUksRUFBRSxjQUFjO2dCQUNwQixJQUFJLEVBQUUsUUFBUTthQUNmO1lBQ0Q7Z0JBQ0UsWUFBWSxFQUFFLE9BQU87Z0JBQ3JCLElBQUksRUFBRSxNQUFNO2dCQUNaLElBQUksRUFBRSxPQUFPO2FBQ2Q7U0FDRjtRQUNELElBQUksRUFBRSx1QkFBdUI7UUFDN0IsT0FBTyxFQUFFLEVBQUU7UUFDWCxlQUFlLEVBQUUsWUFBWTtRQUM3QixJQUFJLEVBQUUsVUFBVTtLQUNqQjtDQUNGLENBQUM7QUFFRixNQUFNLE9BQU8sK0JBQStCO0lBRTFDLE1BQU0sQ0FBQyxlQUFlO1FBQ3BCLE9BQU8sSUFBSSxLQUFLLENBQUMsU0FBUyxDQUFDLElBQUksQ0FBb0MsQ0FBQztJQUN0RSxDQUFDO0lBQ0QsTUFBTSxDQUFDLE9BQU8sQ0FDWixPQUFlLEVBQ2YsZ0JBQW1DO1FBRW5DLE9BQU8sSUFBSSxRQUFRLENBQ2pCLE9BQU8sRUFDUCxJQUFJLEVBQ0osZ0JBQWdCLENBQ1MsQ0FBQztJQUM5QixDQUFDOztBQWJlLG1DQUFHLEdBQUcsSUFBSSxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLyogQXV0b2dlbmVyYXRlZCBmaWxlLiBEbyBub3QgZWRpdCBtYW51YWxseS4gKi9cbi8qIHRzbGludDpkaXNhYmxlICovXG4vKiBlc2xpbnQtZGlzYWJsZSAqL1xuXG5pbXBvcnQgeyBDb250cmFjdCwgU2lnbmVyLCB1dGlscyB9IGZyb20gXCJldGhlcnNcIjtcbmltcG9ydCB7IFByb3ZpZGVyIH0gZnJvbSBcIkBldGhlcnNwcm9qZWN0L3Byb3ZpZGVyc1wiO1xuaW1wb3J0IHR5cGUge1xuICBJVW5pc3dhcFYzU3dhcENhbGxiYWNrLFxuICBJVW5pc3dhcFYzU3dhcENhbGxiYWNrSW50ZXJmYWNlLFxufSBmcm9tIFwiLi4vSVVuaXN3YXBWM1N3YXBDYWxsYmFja1wiO1xuXG5jb25zdCBfYWJpID0gW1xuICB7XG4gICAgaW5wdXRzOiBbXG4gICAgICB7XG4gICAgICAgIGludGVybmFsVHlwZTogXCJpbnQyNTZcIixcbiAgICAgICAgbmFtZTogXCJhbW91bnQwRGVsdGFcIixcbiAgICAgICAgdHlwZTogXCJpbnQyNTZcIixcbiAgICAgIH0sXG4gICAgICB7XG4gICAgICAgIGludGVybmFsVHlwZTogXCJpbnQyNTZcIixcbiAgICAgICAgbmFtZTogXCJhbW91bnQxRGVsdGFcIixcbiAgICAgICAgdHlwZTogXCJpbnQyNTZcIixcbiAgICAgIH0sXG4gICAgICB7XG4gICAgICAgIGludGVybmFsVHlwZTogXCJieXRlc1wiLFxuICAgICAgICBuYW1lOiBcImRhdGFcIixcbiAgICAgICAgdHlwZTogXCJieXRlc1wiLFxuICAgICAgfSxcbiAgICBdLFxuICAgIG5hbWU6IFwidW5pc3dhcFYzU3dhcENhbGxiYWNrXCIsXG4gICAgb3V0cHV0czogW10sXG4gICAgc3RhdGVNdXRhYmlsaXR5OiBcIm5vbnBheWFibGVcIixcbiAgICB0eXBlOiBcImZ1bmN0aW9uXCIsXG4gIH0sXG5dO1xuXG5leHBvcnQgY2xhc3MgSVVuaXN3YXBWM1N3YXBDYWxsYmFja19fZmFjdG9yeSB7XG4gIHN0YXRpYyByZWFkb25seSBhYmkgPSBfYWJpO1xuICBzdGF0aWMgY3JlYXRlSW50ZXJmYWNlKCk6IElVbmlzd2FwVjNTd2FwQ2FsbGJhY2tJbnRlcmZhY2Uge1xuICAgIHJldHVybiBuZXcgdXRpbHMuSW50ZXJmYWNlKF9hYmkpIGFzIElVbmlzd2FwVjNTd2FwQ2FsbGJhY2tJbnRlcmZhY2U7XG4gIH1cbiAgc3RhdGljIGNvbm5lY3QoXG4gICAgYWRkcmVzczogc3RyaW5nLFxuICAgIHNpZ25lck9yUHJvdmlkZXI6IFNpZ25lciB8IFByb3ZpZGVyXG4gICk6IElVbmlzd2FwVjNTd2FwQ2FsbGJhY2sge1xuICAgIHJldHVybiBuZXcgQ29udHJhY3QoXG4gICAgICBhZGRyZXNzLFxuICAgICAgX2FiaSxcbiAgICAgIHNpZ25lck9yUHJvdmlkZXJcbiAgICApIGFzIElVbmlzd2FwVjNTd2FwQ2FsbGJhY2s7XG4gIH1cbn1cbiJdfQ==