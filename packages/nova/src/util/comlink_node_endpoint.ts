import nodeEndpointImport from 'comlink/dist/umd/node-adapter.js';

/**
 * Comlink's node-adapter wrapper for a worker_threads port, resolved once.
 *
 * cast: comlink's node-adapter.d.ts declares `export default function`,
 * but its UMD build assigns the function itself to `module.exports`. Under
 * nodenext the default import of that CommonJS file IS the function at
 * runtime, while TypeScript types it as the `{ default }` namespace the
 * .d.ts describes. This is the one place that mismatch is bridged.
 */
export const nodeEndpoint: typeof nodeEndpointImport.default =
    nodeEndpointImport as unknown as typeof nodeEndpointImport.default;
