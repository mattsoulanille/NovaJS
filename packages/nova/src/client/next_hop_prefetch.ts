/**
 * ============================================================================
 * Warming the NEXT system on the player's route, one jump ahead (#370)
 * ============================================================================
 *
 * Entering a system stages its genesis (#368) and then draws it; each
 * cold load is a round trip to the server. While the player is IN SPACE
 * with a hyperspace route selected, this warms what the route's FIRST
 * hop will need, so the jump's system entry finds its caches warm:
 *
 *  - the hop's resource list (server/system_resources.ts: the data its
 *    genesis stages, the art and sound its display draws and plays),
 *    fetched once per system and kept;
 *  - its DATA through the main thread's SimulationGameData Gettables —
 *    the ones the entry's own makeSystem (the serializer world), the
 *    frame staging and the mission preparation read — in a few batched
 *    requests;
 *  - its ASSETS through the display's caches: sprite sheets (frames and
 *    image), bööms, snds, and the landable stellars' PICTs.
 *
 * THE SIM WORKER starts with a fresh cache on every entry, so it cannot
 * be warmed ahead of time; instead, at entry, `seedFor` hands it the
 * hop's genesis data out of the main thread's caches (GameDataSeed),
 * which the worker merges in before its own makeSystem.
 *
 * ONLY THE FIRST HOP (the maintainer's ruling: "Let's do this for one
 * jump ahead"): not the rest of a multi-jump route, not the neighbours.
 * While a jump is under way the hop is the jump's destination (the route
 * has already moved on to the hop after it).
 *
 * IT ONLY WARMS. Nothing here decides what anything shows, and nothing
 * touches simulation state: the main thread's caches are the display
 * side's, and the worker's seed changes only WHEN its values are cached,
 * never what they are (the list is what genesis stages anyway).
 *
 * LOW PRIORITY, on the #369 machinery (client/background_prefetch.ts):
 * idle callbacks, a small concurrency budget shared with the landed-UI
 * prefetch. Leaving space, or a route change, CANCELS the run (requests
 * already in flight just land in the cache); a new first hop starts a
 * new one. Failures are swallowed: one debug line per run.
 *
 * Client-local.
 */
import { isNovaIDNotFoundError } from 'novadatainterface/nova_id_not_found_error';
import urlJoin from 'url-join';
import { systemResourcesPath } from '../common/game_data_paths.js';
import type { SystemResourceList } from '../common/system_resources.js';
import {
    BackgroundPrefetch, BackgroundPrefetchOptions, PrefetchRun,
} from './background_prefetch.js';
import type { ClientState, ClientStateSlot } from './client_state.js';
import type { DisplayAssetDataResources } from './gamedata/display_asset_data.js';
import {
    cachedSeedData, GameDataSeed, SimulationGameDataInterface,
    SimulationGameDataResources,
} from './gamedata/simulation_game_data.js';

/** What the prefetch warms the display side through. */
export interface NextHopAssets {
    readonly data: Pick<DisplayAssetDataResources,
        'SpriteSheetFrames' | 'SpriteSheetImage' | 'Explosion' | 'Sound'>;
    /** Loads a PICT into the cache spriteFromPict reads. */
    prefetchPict(id: string): Promise<void>;
}

/** Fetches a system's resource list. */
export type SystemResourceFetcher = (systemId: string) =>
    Promise<SystemResourceList>;

/** The server's list route (server/setup_routes.ts). */
export function fetchSystemResources(baseUrl = '',
    fetchImpl: typeof fetch = (...args) => fetch(...args)):
    SystemResourceFetcher {
    return async systemId => {
        const route = `${systemResourcesPath}/${encodeURIComponent(systemId)}.json`;
        const url = baseUrl ? urlJoin(baseUrl, route) : route;
        const response = await fetchImpl(url);
        if (!response.ok) {
            throw new Error(`${url}: HTTP ${response.status}`);
        }
        return await response.json() as SystemResourceList;
    };
}

/** Ids per batched data request (each one a step of the budget). */
export const DATA_IDS_PER_STEP = 400;

export class NextHopPrefetch extends BackgroundPrefetch {
    /** A/B lever: when set, nothing is warmed and no worker is seeded. */
    disabled = false;
    private inSpaceSystem: string | undefined;
    /** The hop the pump last reported, and the system it was seen from. */
    private hop: { from: string, to: string | undefined } | undefined;
    private readonly lists = new Map<string, Promise<SystemResourceList>>();
    private readonly listsInHand = new Map<string, SystemResourceList>();

    constructor(private readonly gameData: SimulationGameDataInterface,
        private readonly assets: NextHopAssets,
        private readonly fetchList: SystemResourceFetcher,
        options: BackgroundPrefetchOptions = {}) {
        super(options);
    }

    /**
     * Follows the client state from now on (the current state included);
     * returns the unsubscribe, which also cancels any run.
     */
    follow(slot: ClientStateSlot): () => void {
        const unsubscribe = slot.subscribe(next => this.onState(next));
        this.onState(slot.state);
        return () => {
            unsubscribe();
            this.cancel();
        };
    }

    onState(state: ClientState): void {
        this.inSpaceSystem = state.kind === 'inSpace'
            ? state.system.systemId : undefined;
        this.update();
    }

    /**
     * The player's next system as the display sees it from `from` (the
     * frame pump reports it every frame): the destination of a jump under
     * way, else the selected route's first hop, else undefined.
     */
    noteNextHop(from: string, to: string | undefined): void {
        if (this.hop?.from === from && this.hop.to === to) {
            return;
        }
        this.hop = { from, to };
        this.update();
    }

    /** The system the current (or last) run warms. */
    get systemId(): string | undefined {
        return this.current?.key;
    }

    /**
     * The seed for a sim worker entering `systemId`: its genesis data as
     * the main thread holds it now, the id catalog and the settings files
     * read (controls.json). Undefined unless
     * this prefetch has that system's list in hand (it never fetches
     * anything itself, so an entry never waits on it).
     */
    async seedFor(systemId: string): Promise<GameDataSeed | undefined> {
        const list = this.listsInHand.get(systemId);
        if (this.disabled || !list) {
            return undefined;
        }
        const ids = await this.gameData.ids.catch(() => undefined);
        return {
            ...(ids ? { ids } : {}),
            settings: { ...this.gameData.settingsRead },
            data: cachedSeedData(this.gameData, list.data),
        };
    }

    private update(): void {
        const from = this.inSpaceSystem;
        const to = this.hop?.from === from ? this.hop?.to : undefined;
        if (this.disabled || from === undefined || to === undefined
            || to === from) {
            this.cancel();
            return;
        }
        this.ensureRun(to, 'Next-hop', (run, failures) =>
            this.warm(run, failures));
    }

    /** The list of `systemId`, fetched once (a failure is retried). */
    private list(systemId: string): Promise<SystemResourceList> {
        let list = this.lists.get(systemId);
        if (!list) {
            list = this.fetchList(systemId).then(fetched => {
                this.listsInHand.set(systemId, fetched);
                return fetched;
            });
            this.lists.set(systemId, list);
            list.catch(() => this.lists.delete(systemId));
        }
        return list;
    }

    private async warm(run: PrefetchRun, failures: unknown[]): Promise<void> {
        const list = await this.step(run, () => this.list(run.key));

        // DATA first: the entry reads it before anything is drawn. Only
        // what is not cached yet, in a few batched requests.
        const pending: [Gettable, string][] = [];
        for (const [type, ids] of Object.entries(list.data)) {
            const gettable = Object.hasOwn(this.gameData.data, type)
                ? this.gameData.data[type as keyof SimulationGameDataResources]
                : undefined;
            if (!gettable) {
                continue;
            }
            for (const id of ids ?? []) {
                if (!(id in gettable.gotten) && !gettable.isMissing(id)) {
                    pending.push([gettable, id]);
                }
            }
        }
        const chunks: [Gettable, string][][] = [];
        for (let i = 0; i < pending.length; i += DATA_IDS_PER_STEP) {
            chunks.push(pending.slice(i, i + DATA_IDS_PER_STEP));
        }
        // Every get of a chunk is issued in the same task, so the batch
        // fetcher sends the chunk as one request. A not-found is the
        // data set's (and cached as such), not a failure of the warm-up.
        await this.each(run, failures, chunks.map(chunk => () =>
            Promise.all(chunk.map(([gettable, id]) => gettable.get(id)
                .catch(e => {
                    if (!isNovaIDNotFoundError(e)) {
                        throw e;
                    }
                })))));

        // Then the ASSETS, in the order they are wanted on arrival: the
        // sprite sheets (the stellars' first), the bööms, the sounds, and
        // last the landing art.
        const { data } = this.assets;
        await Promise.all([
            this.each(run, failures, list.assets.SpriteSheet.map(id => () =>
                Promise.all([data.SpriteSheetFrames.get(id),
                    data.SpriteSheetImage.get(id)]))),
            this.each(run, failures, list.assets.Explosion.map(id => () =>
                data.Explosion.get(id))),
            this.each(run, failures, list.assets.Sound.map(id => () =>
                data.Sound.get(id))),
            this.each(run, failures, list.assets.Pict.map(id => () =>
                this.assets.prefetchPict(id))),
        ]);
    }
}

type Gettable = SimulationGameDataResources[keyof SimulationGameDataResources];
