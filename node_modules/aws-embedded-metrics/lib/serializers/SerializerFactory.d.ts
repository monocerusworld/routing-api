import { LogSerializer } from './LogSerializer';
declare enum FormatVersion {
    ZERO = "0"
}
declare const _default: {
    createSerializer: (version: FormatVersion) => LogSerializer;
    FormatVersion: typeof FormatVersion;
};
export default _default;
