import { Protocol } from '@uniswap/router-sdk';
import { MixedRoute, V2Route, V3Route } from '../../../../routers';
interface CachedRouteParams<Route extends V3Route | V2Route | MixedRoute> {
    route: Route;
    percent: number;
}
/**
 * Class defining the route to cache
 *
 * @export
 * @class CachedRoute
 */
export declare class CachedRoute<Route extends V3Route | V2Route | MixedRoute> {
    readonly route: Route;
    readonly percent: number;
    /**
     * @param route
     * @param percent
     */
    constructor({ route, percent }: CachedRouteParams<Route>);
    get protocol(): Protocol;
}
export {};
