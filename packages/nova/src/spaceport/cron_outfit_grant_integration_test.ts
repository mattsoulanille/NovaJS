import 'jasmine';
import { OutfitData } from 'novadatainterface/outfit_data';
import { Entity } from 'nova_ecs/entity';
import { getPluginGameData } from '../communication/simulation_test_fixture.js';
import {
    makeShip, OutfitsStateComponent, WeaponsStateComponent,
} from '../nova_plugin/ship/index.js';
import { idPrefix } from '../nova_plugin/missions/index.js';
import { ControlBitsComponent } from '../nova_plugin/ncb/index.js';
import {
    CreditsComponent, GameDateComponent,
} from '../nova_plugin/player/index.js';
import { advanceEntityDate, MissionSession } from './mission_session.js';
import { MissionUniverse } from './mission_universe.js';

/**
 * "Extra Outfits' Weapon Construction Bay is not constructing weapons."
 *
 * The WCB is not an outfit ModType at all: it is five crön resources that
 * build ammunition while the player flies, against the plug-in's real data
 *
 *   oütf 534 Weapon Construction Bay   OnPurchase b9013   Contribute bit 69
 *   oütf 535 Metals & Cables           (the building materials)
 *   oütf 536 Warheads & Engine Segments
 *   crön 500 IR Missile Construction
 *       Require   1<<64  (nova oütf 134 IR Missile Launcher's Contribute)
 *       EnableOn  `!b9014 & b9013 & O535 & O536`
 *       OnStart   `b9014 D535 D536`      Duration 2
 *       OnEnd     `!b9014 G135 G135 G135`
 *   crön 501-504  the same shape for Radar Missiles (G137 x2, Duration 1),
 *       Raven Rockets (G143 x8), Stellar Grenades (G146 x4) and Siege Mines
 *       (G464 x3), each Require-d to its own launcher's Contribute bit.
 *
 * So the whole feature is Gxxx / Dxxx inside crön set strings, plus the
 * id-space rule for the bare numbers in them: `G135` is the STOCK IR
 * Missile (nova:135) because stock has a 135, while `G464` is the plug-in's
 * own Siege Mine (extra-outfits:464) because stock has no 464.
 *
 * Crons used to run their set strings with bit and rank hooks only, so
 * every Gxxx/Dxxx was dropped with a console warning: the bay consumed
 * nothing and produced nothing, exactly as reported.
 */
describe('Extra Outfits Weapon Construction Bay against real plug-in data',
    () => {
        const PLUGIN = 'extra-outfits';
        /** Terrapin: Contribute 0x1, which is all oütf 534 Requires. */
        const SHIP = 'nova:136';
        const BAY = `${PLUGIN}:534`;
        const METALS = `${PLUGIN}:535`;
        const WARHEADS = `${PLUGIN}:536`;
        /** Stock oütf 134/135: the launcher (Contribute 1<<64) and its ammo. */
        const IR_LAUNCHER = 'nova:134';
        const IR_MISSILE = 'nova:135';
        /** Extra Outfits' own launcher (Contribute 1<<68) and its ammo. */
        const MINE_LAUNCHER = `${PLUGIN}:463`;
        const SIEGE_MINE = `${PLUGIN}:464`;

        /** Undefined when the plug-in isn't installed; every spec skips. */
        async function bench(launcher: string) {
            const gameData = await getPluginGameData(PLUGIN);
            if (!gameData) {
                return undefined;
            }
            const universe = MissionUniverse.shared(gameData);
            await universe.load();
            const shipData = await gameData.data.Ship.get(SHIP);
            const entity = makeShip(shipData);
            entity.components.set(CreditsComponent, { credits: 100000000 });
            entity.components.set(GameDateComponent,
                { day: 1, month: 1, year: 1177 });
            entity.components.set(OutfitsStateComponent, new Map([
                [BAY, { count: 1 }],
                [launcher, { count: 1 }],
                [METALS, { count: 1 }],
                [WARHEADS, { count: 1 }],
            ]));

            // The bay's own OnPurchase is what tells the crons it is aboard.
            const bay: OutfitData = await gameData.data.Outfit.get(BAY);
            const session = await MissionSession.create(
                entity, gameData, universe, '<outfitter>');
            session.runMissionSet(bay.onPurchase, idPrefix(BAY));
            session.commit();

            const owned = () => new Map([...entity.components
                .get(OutfitsStateComponent)!].map(([id, { count }]) => [id, count]));
            return { gameData, universe, entity, owned };
        }

        it('builds three stock IR Missiles over the crön\'s two-day duration, '
            + 'consuming one unit of each building material', async () => {
                const b = await bench(IR_LAUNCHER);
                if (!b) {
                    pending('Extra Outfits plug-in not installed');
                    return;
                }
                expect(b.owned().get(IR_MISSILE) ?? 0).toBe(0);

                // Day 1 starts the build: `b9014 D535 D536`.
                await advanceEntityDate(b.entity, 1, b.universe, b.gameData);
                expect(b.owned().get(METALS) ?? 0)
                    .withContext('metals consumed at OnStart').toBe(0);
                expect(b.owned().get(WARHEADS) ?? 0)
                    .withContext('warheads consumed at OnStart').toBe(0);
                expect(b.owned().get(IR_MISSILE) ?? 0)
                    .withContext('nothing built yet').toBe(0);

                // Duration 2: OnEnd lands on the third day.
                await advanceEntityDate(b.entity, 2, b.universe, b.gameData);
                expect(b.owned().get(IR_MISSILE) ?? 0)
                    .withContext('G135 G135 G135 at OnEnd').toBe(3);
            });

        it('resolves a crön\'s bare outfit number the way every other '
            + 'numeric reference resolves: stock first, then its own plug-in',
            async () => {
                const b = await bench(MINE_LAUNCHER);
                if (!b) {
                    pending('Extra Outfits plug-in not installed');
                    return;
                }
                // crön 504's `G464` has no stock 464 to name, so it must be
                // the plug-in's own Siege Mine; naming "nova:464" would grant
                // an outfit that does not exist.
                await advanceEntityDate(b.entity, 3, b.universe, b.gameData);
                expect(b.owned().get(SIEGE_MINE) ?? 0).toBe(3);
                expect([...b.owned().keys()].some(id => id === 'nova:464'))
                    .toBe(false);
            });

        it('runs the bay again once it has fresh materials, and not without '
            + 'them', async () => {
                const b = await bench(IR_LAUNCHER);
                if (!b) {
                    pending('Extra Outfits plug-in not installed');
                    return;
                }
                await advanceEntityDate(b.entity, 3, b.universe, b.gameData);
                expect(b.owned().get(IR_MISSILE) ?? 0).toBe(3);
                // Out of materials: EnableOn's `O535 & O536` now fails.
                await advanceEntityDate(b.entity, 10, b.universe, b.gameData);
                expect(b.owned().get(IR_MISSILE) ?? 0).toBe(3);

                // Restock and it builds another batch.
                const outfits = new Map(b.entity.components
                    .get(OutfitsStateComponent)!);
                outfits.set(METALS, { count: 1 });
                outfits.set(WARHEADS, { count: 1 });
                b.entity.components.set(OutfitsStateComponent, outfits);
                await advanceEntityDate(b.entity, 3, b.universe, b.gameData);
                expect(b.owned().get(IR_MISSILE) ?? 0).toBe(6);
            });

        it('invalidates the derived weapon state when a crön changes the '
            + 'outfits', async () => {
                const b = await bench(IR_LAUNCHER);
                if (!b) {
                    pending('Extra Outfits plug-in not installed');
                    return;
                }
                b.entity.components.set(WeaponsStateComponent, new Map());
                await advanceEntityDate(b.entity, 3, b.universe, b.gameData);
                // The ammo the bay just built has to reach the launcher, so
                // the caches derived from the outfits must be dropped exactly
                // as the outfitter drops them (MissionSession.commitState).
                expect(b.entity.components.has(WeaponsStateComponent)).toBe(false);
            });

        it('leaves the outfits alone on a date advance that builds nothing',
            async () => {
                const b = await bench(IR_LAUNCHER);
                if (!b) {
                    pending('Extra Outfits plug-in not installed');
                    return;
                }
                // No bay bit: nothing in the plug-in touches the outfits.
                b.entity.components.set(ControlBitsComponent, new Set());
                const before = b.entity.components.get(OutfitsStateComponent)!;
                await advanceEntityDate(b.entity, 5, b.universe, b.gameData);
                expect(b.entity.components.get(OutfitsStateComponent))
                    .withContext('untouched map is not even replaced')
                    .toBe(before);
            });
    });
