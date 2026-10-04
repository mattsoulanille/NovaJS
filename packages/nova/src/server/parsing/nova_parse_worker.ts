import * as Comlink from 'comlink';
import { NovaParse } from "novaparse";
import { parentPort } from "worker_threads";
import { nodeEndpoint } from "../../util/comlink_node_endpoint.js";
import { loadServerNovaParse } from "./load_nova_parse.js";

let novaParse: NovaParse | undefined;
const api = {
    async init(path: string) {
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
        //
        // The one load problem that is NOT a diagnostic is a plug-in name
        // conflict (two plug-ins keyed to one namespace): init rejects
        // with it, Comlink carries the rejection to server.ts, and the
        // server refuses to start (load_nova_parse.ts).
        this.novaParse = Comlink.proxy(await loadServerNovaParse(path));
    },
    novaParse,
}

export type NovaParseWorkerApi = typeof api;

if (!parentPort) {
    throw new Error('Missing parent port');
}

Comlink.expose(api, nodeEndpoint(parentPort));
