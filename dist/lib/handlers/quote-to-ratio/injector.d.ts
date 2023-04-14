import { AlphaRouterConfig, ISwapToRatio, SwapAndAddConfig } from '@tartz-one/smart-order-router';
import { MetricsLogger } from 'aws-embedded-metrics';
import { APIGatewayProxyEvent, Context } from 'aws-lambda';
import { default as Logger } from 'bunyan';
import { ContainerInjected, InjectorSOR, RequestInjected } from '../injector-sor';
import { QuoteToRatioQueryParams } from './schema/quote-to-ratio-schema';
export declare class QuoteToRatioHandlerInjector extends InjectorSOR<ISwapToRatio<AlphaRouterConfig, SwapAndAddConfig>, QuoteToRatioQueryParams> {
    getRequestInjected(containerInjected: ContainerInjected, _requestBody: void, requestQueryParams: QuoteToRatioQueryParams, _event: APIGatewayProxyEvent, context: Context, log: Logger, metricsLogger: MetricsLogger): Promise<RequestInjected<ISwapToRatio<AlphaRouterConfig, SwapAndAddConfig>>>;
}
