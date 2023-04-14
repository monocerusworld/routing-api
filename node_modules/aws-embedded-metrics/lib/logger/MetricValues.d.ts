import { Unit } from '..';
export declare class MetricValues {
    values: number[];
    unit: string;
    constructor(value: number, unit?: Unit | string);
    /**
     * Appends the provided value to the current metric
     * @param value
     */
    addValue(value: number): void;
}
