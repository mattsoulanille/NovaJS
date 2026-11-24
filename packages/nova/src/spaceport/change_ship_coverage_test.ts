import 'jasmine';
import { GameDataAggregator } from '../server/parsing/game_data_aggregator.js';
import {
    getIntegrationGameData, getPluginGameData,
} from '../communication/simulation_test_fixture.js';
import { NCBSetOperation, parseNCBSet } from '../nova_plugin/ncb/index.js';

/**
 * #141 (Matthew, 2026-10-03 "wire it so it works everywhere", 2026-11-23
 * "yes, wire it"): Cxxx / Exxx / Hxxx (change ship) is wired on every path
 * a mïsn or oütf set string runs on — the landed venues through the
 * landing's transaction (bar, BBS, the landing and venue-entry popups,
 * OnSuccess/OnFailure in the landing pass, mission-info aborts, outfit
 * OnPurchase/OnSell: change_ship_venues_test.ts) and in flight (ship-
 * offered accept and refusal, crön OnStart/OnEnd and the date advance's
 * OnShipDone/OnFailure/OnAbort: change_ship_in_flight_test.ts).
 *
 * Three set-string sites still have no change-ship hook, because no data
 * reaches them with one: a chär's OnStart (a new pilot), a shïp's
 * OnPurchase / OnRetire (a shipyard trade), and the crons stepped by a
 * landed DatePostInc (MissionSession.commitState → settleDateAdvance;
 * crön strings in flight ARE wired). This is the parser check that keeps
 * that true: it reads every set string in the stock data, and in the
 * plug-ins that carry change-ship strings when they are installed, and
 * fails the moment one of those unwired sites gains a C/E/H — which is
 * when it would have to be wired.
 */
describe('change-ship set strings in the game data (#141)', () => {
    function changeShips(expression: string): NCBSetOperation[] {
        if (!expression) {
            return [];
        }
        let operations: NCBSetOperation[];
        try {
            operations = parseNCBSet(expression);
        } catch {
            // Unparseable strings warn and do nothing at run time.
            return [];
        }
        const flat: NCBSetOperation[] = [];
        const walk = (ops: NCBSetOperation[]) => {
            for (const op of ops) {
                if (op.type === 'random') {
                    walk(op.choices);
                } else if (op.type === 'changeShip') {
                    flat.push(op);
                }
            }
        };
        walk(operations);
        return flat;
    }

    /** "<type> <id> <field>" for every set string with a change of ship. */
    async function changeShipSites(gameData: GameDataAggregator) {
        const ids = await gameData.ids;
        const { data } = gameData;
        const sites: string[] = [];
        const scan = async <T>(type: string, list: string[],
            get: (id: string) => Promise<T>, fields: (keyof T & string)[]) => {
            for (const id of list) {
                const resource = await get(id);
                for (const field of fields) {
                    if (changeShips(resource[field] as unknown as string)
                        .length > 0) {
                        sites.push(`${type} ${id} ${field}`);
                    }
                }
            }
        };
        await scan('mïsn', ids.Mission, id => data.Mission.get(id),
            ['onAccept', 'onRefuse', 'onSuccess', 'onFailure', 'onAbort',
                'onShipDone']);
        await scan('oütf', ids.Outfit, id => data.Outfit.get(id),
            ['onPurchase', 'onSell']);
        await scan('crön', ids.Cron, id => data.Cron.get(id),
            ['onStart', 'onEnd']);
        await scan('chär', ids.PlayerStart, id => data.PlayerStart.get(id),
            ['onStart']);
        await scan('shïp', ids.Ship, id => data.Ship.get(id),
            ['onPurchase', 'onRetire']);
        return sites;
    }

    /** The sites no change-ship hook reaches. */
    const UNWIRED = /^(chär \S+ onStart|shïp \S+ on(Purchase|Retire))$/;

    it('changes ship in stock data only where the hook is wired', async () => {
        const sites = await changeShipSites(await getIntegrationGameData());
        expect(sites.filter(site => UNWIRED.test(site))).toEqual([]);
        // No crön changes ship at all, so the landed DatePostInc's crons
        // (the one cron path without the hook) cannot either.
        expect(sites.filter(site => site.startsWith('crön '))).toEqual([]);
        // What the parser finds today: five OnAccept `H`s (all accepted
        // at a landed venue, AvailLoc 3 or 5) and the five Chrome Valk
        // upgrades' OnPurchase.
        expect(sites.sort()).toEqual([
            'mïsn nova:197 onAccept', 'mïsn nova:320 onAccept',
            'mïsn nova:361 onAccept', 'mïsn nova:709 onAccept',
            'mïsn nova:748 onAccept',
            'oütf nova:314 onPurchase', 'oütf nova:315 onPurchase',
            'oütf nova:316 onPurchase', 'oütf nova:317 onPurchase',
            'oütf nova:318 onPurchase',
        ]);
    });

    for (const plugin of ['arpia', 'extra-outfits']) {
        it(`changes ship in plug-in ${plugin} only where the hook is wired`,
            async () => {
                const gameData = await getPluginGameData(plugin);
                if (!gameData) {
                    pending(`the ${plugin} plug-in is not installed`);
                    return;
                }
                const sites = await changeShipSites(gameData);
                expect(sites.filter(site => UNWIRED.test(site))).toEqual([]);
                expect(sites.filter(site => site.startsWith('crön ')))
                    .toEqual([]);
                expect(sites.length).toBeGreaterThan(0);
            });
    }
});
