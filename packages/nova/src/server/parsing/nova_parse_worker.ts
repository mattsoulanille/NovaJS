import * as Comlink from 'comlink';
import nodeEndpointImport from 'comlink/dist/umd/node-adapter.js';
const nodeEndpoint = nodeEndpointImport as unknown as typeof nodeEndpointImport.default;
import { NovaParse } from "novaparse";
import { parentPort } from "worker_threads";

let novaParse: NovaParse | undefined;
const api = {
    init(path: string) {
        // NovaParse's load-time diagnostics — skipped plug-ins, malformed
        // resources, and the one-time Require/Contribute and control-bit
        // namespacing reports (cross-plug-in bits separated, a plug-in
        // Require that nothing contributes) — are written with
        // console.warn/error from inside this worker, using NovaParse's
        // defaults (flagNamespaceWarn, controlBitNamespaceWarn). Nothing
        // redirects them on purpose: worker_threads pipes a worker's
        // stdout/stderr into the parent process's unless the Worker is
        // built with `stdout`/`stderr: true` (server.ts does not), so they
        // land in the server's own log next to "listening at port", where
        // a plug-in author running the server sees them. There is no
        // player-facing surface for any of these diagnostics yet; that
        // would be a feature (a plug-in load report exposed to the
        // client), not a routing fix here.
        this.novaParse = Comlink.proxy(new NovaParse(path, false));
    },
    novaParse,
}

export type NovaParseWorkerApi = typeof api;

if (!parentPort) {
    throw new Error('Missing parent port');
}

Comlink.expose(api, nodeEndpoint(parentPort));
