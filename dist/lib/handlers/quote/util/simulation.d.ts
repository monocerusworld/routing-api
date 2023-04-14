import { SimulationStatus } from '@tartz-one/smart-order-router';
import Logger from 'bunyan';
export declare const simulationStatusToString: (simulationStatus: SimulationStatus | undefined, log: Logger) => "" | "SUCCESS" | "FAILED" | "UNATTEMPTED" | "INSUFFICIENT_BALANCE" | "NOT_SUPPORTED" | "NOT_APPROVED";
