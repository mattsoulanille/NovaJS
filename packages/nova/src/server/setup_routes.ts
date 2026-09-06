import * as express from "express";
import { Express } from "express";
import * as path from 'path';
import { getDefaultControlBitNamespaces } from "novadatainterface/control_bit_namespaces";
import { idsPath, dataPath, batchPath, settingsPrefix, controlBitNamespacesPath } from "../common/game_data_paths.js";
import { GameDataInterface } from "novadatainterface/game_data_interface";
import { NovaDataType } from "novadatainterface/nova_data_interface";
import { isNovaIDNotFoundError } from "novadatainterface/nova_id_not_found_error";

/**
 * Request body for the batch endpoint: a map from data type to the
 * list of ids requested for that type.
 */
export type BatchRequest = { [dataType: string]: string[] };

/**
 * Response from the batch endpoint. For each requested (type, id), the
 * entry is either `{ data }` on success or `{ error }` if that single
 * id could not be resolved. A missing id must NOT fail the whole
 * batch, so errors are reported per-id rather than as a non-200 status.
 *
 * `notFound` (additive) marks the error as "no data source defines this
 * id" — the per-id equivalent of the GET route's 404 — so the client can
 * cache the miss instead of retrying it; every other error is a load
 * failure a retry may fix. Older servers omit the field.
 */
export type BatchResponseEntry<T = unknown> =
    { data: T } | { error: string, notFound?: true };
export type BatchResponse = {
    [dataType: string]: { [id: string]: BatchResponseEntry }
};

/**
 * True iff `id` is a safe resource id to feed to the filesystem-backed
 * data layer.
 *
 * Resource ids are opaque keys such as `nova:128`, `Starbridge Bay:500`,
 * `Star Wars Mod:1000`, `extra-outfits:200`, `planetNeutral`, or
 * `HypergatePassv1.0:128`. Their namespace prefix comes from a plug-in
 * filename, so a legitimate id may contain letters, digits, spaces, and
 * the punctuation `: . - _`. A legitimate id NEVER contains a path
 * separator or a `..` path component.
 *
 * The id flows (unescaped) into `path.join(rootPath, type, id + '.' +
 * ext)` in the filesystem data layer, so an id like `../../package`
 * escapes the objects directory and reads an arbitrary file. Rejecting
 * path separators, NUL, and `..` path components blocks every traversal
 * vector while admitting every legitimate id (none of which contain
 * those characters). This is a route-layer allowlist; the filesystem
 * layer additionally re-checks path containment as defense in depth.
 */
export function isValidResourceId(id: unknown): id is string {
    if (typeof id !== 'string' || id.length === 0) {
        return false;
    }
    // Reject path separators (either OS) and NUL outright.
    if (/[/\\\0]/.test(id)) {
        return false;
    }
    // Reject a bare `..` component. (Any embedded `..` can only reach a
    // parent directory via a separator, which is already rejected above.)
    if (id === '..') {
        return false;
    }
    return true;
}

/**
 * Resolves every (dataType, id) in `body` against `gameData`, returning
 * a per-id success/error map. Pure and transport-agnostic so it can be
 * unit tested without an HTTP server.
 *
 * Contract:
 *  - An unknown data type marks each of its ids with an error entry.
 *  - A per-id load rejection becomes that id's error entry; it never
 *    fails sibling ids or other types.
 *  - Binary (ArrayBuffer) results are rejected as errors: the batch
 *    endpoint carries only JSON metadata; binaries keep their
 *    per-resource routes.
 */
export async function resolveBatch(
    gameData: GameDataInterface,
    body: BatchRequest,
): Promise<BatchResponse> {
    const result: BatchResponse = {};
    await Promise.all(Object.entries(body).map(async ([name, ids]) => {
        const typeResult: { [id: string]: BatchResponseEntry } = {};
        result[name] = typeResult;

        // Object.hasOwn keeps inherited keys such as 'constructor' from
        // passing the check and yielding a non-Gettable value.
        const dataGettable = Object.hasOwn(gameData.data, name)
            ? gameData.data[name as NovaDataType] : undefined;
        if (!dataGettable) {
            for (const id of ids ?? []) {
                typeResult[id] = { error: 'Unknown data type ' + name };
            }
            return;
        }
        if (!Array.isArray(ids)) {
            return;
        }

        // Resolve every id concurrently; one rejection only affects its
        // own entry.
        await Promise.all(ids.map(async (id) => {
            // Reject traversal ids before they reach the filesystem. A
            // malformed id is per-id input, so it becomes that id's error
            // entry rather than failing the batch.
            if (!isValidResourceId(id)) {
                typeResult[String(id)] = { error: 'Invalid id ' + String(id) };
                return;
            }
            try {
                const data = await dataGettable.get(id);
                if (data instanceof ArrayBuffer) {
                    typeResult[id] = { error: 'Binary data is not available over the batch endpoint' };
                    return;
                }
                typeResult[id] = { data };
            } catch (e) {
                const error = e instanceof Error ? e.message : String(e);
                typeResult[id] = isNovaIDNotFoundError(e)
                    ? { error, notFound: true } : { error };
            }
        }));
    }));
    return result;
}


/**
 * Serves GameData to the client
 * Maybe consider https://github.com/RioloGiuseppe/byte-serializer in the future?
 */
export function setupRoutes(
    gameData: GameDataInterface,
    app: Express,
    htmlPath: string,
    bundlePath: string,
    bundleMapPath: string,
    simulationWorkerBundlePath: string,
    simulationWorkerBundleMapPath: string,
    settingsDir: string,
) {
    return new GameDataServer(
        gameData,
        app,
        htmlPath,
        bundlePath,
        bundleMapPath,
        simulationWorkerBundlePath,
        simulationWorkerBundleMapPath,
        settingsDir,
    );
}

// This is a helper class used by `setupRoutes`
class GameDataServer {
    constructor(
        private readonly gameData: GameDataInterface,
        private readonly app: Express,
        private readonly htmlPath: string,
        private readonly bundlePath: string,
        private readonly bundleMapPath: string,
        private readonly simulationWorkerBundlePath: string,
        private readonly simulationWorkerBundleMapPath: string,
        private readonly settingsDir: string) {
        this.setupRoutes();
    }

    private setupRoutes() {
        // The order in which these routes are set up matters.
        // Earlier routes take precedence over later ones.
        // NOTE: This can not be converted to RPCs because PIXI.js
        // expects assets to be loaded from URLs.

        // The batch route must be registered before the generic
        // `:name/:item` routes below, or `/data/batch` would be parsed
        // as `name=batch`. It coalesces many per-id metadata fetches
        // into one round trip; the per-resource routes remain for other
        // consumers (PIXI asset loads, node tooling, direct fetches).
        this.app.post(batchPath,
            express.json({ limit: '2mb' }),
            this.batchRequestFulfiller.bind(this));

        this.app.get(path.join(dataPath, ":name/:item.png"), this.requestFulfiller.bind(this));
        this.app.get(path.join(dataPath, ":name/:item.json"), this.requestFulfiller.bind(this));
        this.app.get(path.join(dataPath, ":name/:item.wav"), this.requestFulfiller.bind(this));
        this.app.get(path.join(dataPath, ":name/:item"), this.requestFulfiller.bind(this));
        this.app.get(idsPath + ".json", this.idRequestFulfiller.bind(this));
        this.app.get(controlBitNamespacesPath + ".json",
            this.controlBitNamespacesFulfiller.bind(this));

        this.app.use('/preloadData.json', async (_req, res) => {
            // Express 4 does not catch async rejections; see
            // requestFulfiller.
            try {
                res.send(this.gameData.preloadData ? await this.gameData.preloadData : {});
            } catch (e) {
                if (!res.headersSent) {
                    res.status(500).send({ error: 'Failed to get preload data' });
                }
            }
        });

        // Serves every client settings file in the settings directory
        // (controls.json, settings.json, ...).
        this.app.use(settingsPrefix,
            express.static(this.settingsDir));

        //        // This has to be here or else sourcemaps don't work!
        //        const staticPath = path.join(this.appRoot, "build", "static");
        //        this.app.use("/static", express.static(staticPath));

        // no-cache = revalidate every load (a 304 keeps it fast).
        // Without it, browsers cache heuristically for hours and a
        // STALE CLIENT BUILD joins a new server: it desyncs no matter
        // how healthy the netcode is, uploads no dumps, and reads as
        // an unsolvable netcode mystery (the 2026-07-26 session).
        const noCache = (res: express.Response) =>
            res.set('Cache-Control', 'no-cache');

        this.app.use("/browser_bundle.js", (_req: express.Request, res: express.Response) => {
            noCache(res).sendFile(this.bundlePath);
        });

        this.app.use("/browser_bundle.js.map", (_req: express.Request, res: express.Response) => {
            noCache(res).sendFile(this.bundleMapPath);
        });

        this.app.use("/simulation_bridge_browser_worker_bundle.js", (_req: express.Request, res: express.Response) => {
            noCache(res).sendFile(this.simulationWorkerBundlePath);
        });

        this.app.use("/simulation_bridge_browser_worker_bundle.js.map", (_req: express.Request, res: express.Response) => {
            noCache(res).sendFile(this.simulationWorkerBundleMapPath);
        });

        this.app.use("/", (_req: express.Request, res: express.Response) => {
            noCache(res).sendFile(this.htmlPath);
        });
    }

    private async requestFulfiller(req: express.Request, res: express.Response): Promise<void> {
        const name: string = req.params.name;
        const item: string = req.params.item;

        // Reject path-traversal ids before they can reach the filesystem
        // data layer, which joins the id straight into a file path.
        if (!isValidResourceId(item)) {
            res.status(400).send("Invalid id");
            return;
        }

        // Express 4 does not catch async rejections, and an escaped
        // rejection kills the process on modern Node
        // (--unhandled-rejections=throw is the default). Nothing in this
        // handler may throw past the try/catch below.
        try {
            // Object.hasOwn keeps inherited keys such as 'constructor'
            // (reachable straight from the URL path) from passing the
            // check and yielding a non-Gettable value.
            // (Responses are io-ts-encoded JSON; a compact binary encoding
            // such as protobufs is a tracker issue.)
            const dataGettable = Object.hasOwn(this.gameData.data, name)
                ? this.gameData.data[name as NovaDataType] : undefined;

            if (!dataGettable) {
                res.status(404).send("Unknown data type " + name);
                return;
            }

            let data = await dataGettable.get(item);
            if (data instanceof ArrayBuffer) {
                data = Buffer.from(data) as unknown as ArrayBuffer;
            }
            res.send(data);
        } catch (e) {
            if (!res.headersSent) {
                if (isNovaIDNotFoundError(e)) {
                    // No data source defines the id: 404, so a client can
                    // tell "does not exist" from a load failure. (It used
                    // to be a 200 carrying a placeholder default object.)
                    res.status(404).send("No " + name + " with id " + item);
                } else {
                    res.status(500).send("Failed to get " + name + "/" + item);
                }
            }
        }
    }

    /**
     * Resolves many (dataType, id) pairs in one request. The body is a
     * BatchRequest ({ [dataType]: id[] }); the response is a
     * BatchResponse ({ [dataType]: { [id]: { data } | { error } } }).
     *
     * A missing id, an unknown data type, or a per-id load failure is
     * reported in that id's entry and never fails the whole batch. Only
     * a malformed request body (not an object) yields a 400.
     */
    private async batchRequestFulfiller(req: express.Request, res: express.Response): Promise<void> {
        const body = req.body as BatchRequest | undefined;
        if (!body || typeof body !== 'object' || Array.isArray(body)) {
            res.status(400).send({ error: 'Batch request body must be a { dataType: id[] } object' });
            return;
        }
        // A traversal id is malformed input, not a missing resource, so
        // reject the whole request with a 400 (like a malformed body)
        // rather than silently degrading it to a per-id error. Missing
        // but well-formed ids still get their per-id error entry.
        for (const ids of Object.values(body)) {
            if (Array.isArray(ids) && ids.some((id) => !isValidResourceId(id))) {
                res.status(400).send({ error: 'Batch request contains an invalid id' });
                return;
            }
        }
        // Express 4 does not catch async rejections; see requestFulfiller.
        try {
            res.send(await resolveBatch(this.gameData, body));
        } catch (e) {
            if (!res.headersSent) {
                res.status(500).send({ error: 'Failed to resolve batch request' });
            }
        }
    }

    /**
     * The control-bit namespace mapping (see
     * novadatainterface/control_bit_namespaces.ts). A data source without
     * one serves the default (no plug-ins), which the client treats as
     * stock numbering.
     */
    private async controlBitNamespacesFulfiller(_req: express.Request,
        res: express.Response): Promise<void> {
        try {
            res.send(this.gameData.controlBitNamespaces
                ? await this.gameData.controlBitNamespaces
                : getDefaultControlBitNamespaces());
        } catch (e) {
            if (!res.headersSent) {
                res.status(500).send("Failed to get control bit namespaces");
            }
        }
    }

    private async idRequestFulfiller(_req: express.Request, res: express.Response): Promise<void> {
        // Express 4 does not catch async rejections; see requestFulfiller.
        try {
            res.send(await this.gameData.ids);
        } catch (e) {
            if (!res.headersSent) {
                res.status(500).send("Failed to get ids");
            }
        }
    }
}
