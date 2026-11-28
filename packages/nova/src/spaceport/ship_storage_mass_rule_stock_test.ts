import 'jasmine';
import { installedOutfitMass, OutfitData } from 'novadatainterface/outfit_data';
import { ShipData } from 'novadatainterface/ship_data';
import { Entity } from 'nova_ecs/entity';
import { Stat } from '../nova_plugin/core/index.js';
import { StoredShip } from '../nova_plugin/player/index.js';
import {
    CargoComponent, FuelComponent, OutfitsStateComponent, ShipComponent,
} from '../nova_plugin/ship/index.js';
import { getIntegrationGameData } from '../communication/simulation_test_fixture.js';
import { novaDataInstalled, requireNovaData } from '../test_support/nova_data_gate.js';
import {
    outfitsFollowingPilot, setStoredShips, StorageLookups, storedShipsOf,
    swapWithStored,
} from './ship_storage.js';
import { buildPurchasedShip, canBuyShip } from './shipyard_rules.js';

/**
 * ============================================================================
 * Ship storage's MASS RULE against the REAL stock data
 * ============================================================================
 *
 * Matthew (2026-11-27): a persistent outfit (oütf 0x0004) with Mass stays
 * installed on its hull across a storage swap; a weightless one follows the
 * pilot (ship_storage.ts, docs/ship_storage.md). The stock case that
 * motivated it: the Fed Cloaking Device (oütf nova:211, Mass 15, granted by
 * mïsn 466, the only stock persistent outfit with Mass) used to follow the
 * pilot from a Starbridge into a Shuttle with 8 t free, leaving -7 t.
 */
describe('ship storage mass rule against real stock data', () => {
    const SHUTTLE = 'nova:128';
    const STARBRIDGE = 'nova:133';
    const FED_CLOAK = 'nova:211';
    const HEAVY_WEAPONS_LICENSE = 'nova:257';
    const CREATE_DART = 'nova:225';
    const DART = 'nova:226';
    const HERE = 'nova:128';

    const ships = new Map<string, ShipData>();
    const outfits = new Map<string, OutfitData>();
    const lookups: StorageLookups = {
        getShip: id => ships.get(id),
        getOutfit: id => outfits.get(id),
    };

    beforeEach(requireNovaData);
    beforeAll(async () => {
        if (!novaDataInstalled()) return; // each spec pends instead
        const gameData = await getIntegrationGameData();
        for (const id of [SHUTTLE, STARBRIDGE]) {
            ships.set(id, await gameData.data.Ship.get(id));
        }
        const ids = new Set([FED_CLOAK, HEAVY_WEAPONS_LICENSE, CREATE_DART,
            DART]);
        for (const ship of ships.values()) {
            Object.keys(ship.outfits).forEach(id => ids.add(id));
        }
        for (const id of ids) {
            outfits.set(id, await gameData.data.Outfit.get(id));
        }
    });

    /** The stock loadout of `shipId` as [id, count] pairs, plus `extra`. */
    function loadout(shipId: string, extra: [string, number][] = []):
        [string, number][] {
        return [...Object.entries(ships.get(shipId)!.outfits), ...extra];
    }

    /** A hull's free mass: the class's empty capacity less every outfit. */
    function freeMassOf(shipId: string,
        aboard: Iterable<[string, number]>): number {
        const ship = ships.get(shipId)!;
        let free = ship.physics.freeMass;
        for (const [id, count] of aboard) {
            free -= installedOutfitMass(outfits.get(id)!, ship.physics.mass)
                * count;
        }
        return free;
    }

    function countsOf(entity: Entity): [string, number][] {
        return [...entity.components.get(OutfitsStateComponent)!]
            .map(([id, { count }]) => [id, count]);
    }

    function pilot(shipId: string, aboard: [string, number][],
        stored: StoredShip[]): Entity {
        const entity = new Entity('pilot')
            .addComponent(ShipComponent, { id: shipId })
            .addComponent(OutfitsStateComponent, new Map(
                aboard.map(([id, count]) => [id, { count }])))
            .addComponent(CargoComponent, new Map())
            .addComponent(FuelComponent, new Stat({
                current: 100, max: 100, recharge: 0,
            }));
        setStoredShips(entity, stored);
        return entity;
    }

    it('reads the data the rule rests on', () => {
        const cloak = outfits.get(FED_CLOAK)!;
        expect(cloak.persistent).toBeTrue();
        expect(cloak.physics.freeMass).toBe(15);
        const license = outfits.get(HEAVY_WEAPONS_LICENSE)!;
        expect(license.persistent).toBeTrue();
        expect(license.physics.freeMass).toBe(0);
        // The stored Shuttle has less room than the cloak weighs.
        expect(freeMassOf(SHUTTLE, loadout(SHUTTLE))).toBeLessThan(15);
        expect(freeMassOf(SHUTTLE, loadout(SHUTTLE))).toBeGreaterThanOrEqual(0);
    });

    it('a swap from a cloaked Starbridge into a stored Shuttle takes the '
        + 'licence along, leaves the 15 t cloak on the Starbridge, and '
        + 'leaves neither hull with negative free mass', () => {
        const starbridgeAboard = loadout(STARBRIDGE,
            [[FED_CLOAK, 1], [HEAVY_WEAPONS_LICENSE, 1]]);
        const hull = pilot(STARBRIDGE, starbridgeAboard, [{
            ship: SHUTTLE, name: 'Shuttle', outfits: loadout(SHUTTLE),
            cargo: [], fuel: 100, storedAt: HERE,
        }]);
        expect(freeMassOf(STARBRIDGE, starbridgeAboard))
            .toBeGreaterThanOrEqual(0);

        const flown = swapWithStored(hull, 0, HERE, lookups);
        expect(flown.components.get(ShipComponent)).toEqual({ id: SHUTTLE });
        const shuttleAboard = countsOf(flown);
        expect(shuttleAboard).toContain([HEAVY_WEAPONS_LICENSE, 1]);
        expect(shuttleAboard.map(([id]) => id)).not.toContain(FED_CLOAK);
        expect(freeMassOf(SHUTTLE, shuttleAboard)).toBe(
            freeMassOf(SHUTTLE, loadout(SHUTTLE)));
        expect(freeMassOf(SHUTTLE, shuttleAboard)).toBeGreaterThanOrEqual(0);

        const putAway = storedShipsOf(flown)[0];
        expect(putAway.ship).toBe(STARBRIDGE);
        expect(putAway.outfits).toContain([FED_CLOAK, 1]);
        expect(putAway.outfits.map(([id]) => id))
            .not.toContain(HEAVY_WEAPONS_LICENSE);
        expect(freeMassOf(STARBRIDGE, putAway.outfits))
            .toBe(freeMassOf(STARBRIDGE, starbridgeAboard));

        // And back: the cloak is on the Starbridge again, with the licence.
        const back = swapWithStored(flown, 0, HERE, lookups);
        expect(countsOf(back)).toEqual(jasmine.arrayWithExactContents(
            starbridgeAboard.filter(([, count]) => count > 0)));
    });

    it('a shipyard PURCHASE is not a swap: as on the original, the cloak '
        + 'comes along and the Shuttle is left over-full', () => {
        // reference_experiments "Persistent heavy outfits across a ship
        // purchase": Starbridge + Fed Cloak -> Shuttle, no refusal, the
        // cloak aboard, free mass -7 t (shown as "Available: 0 tons").
        const aboard = loadout(STARBRIDGE,
            [[FED_CLOAK, 1], [HEAVY_WEAPONS_LICENSE, 1]]);
        const hull = pilot(STARBRIDGE, aboard, []);
        const context = {
            currentShip: ships.get(STARBRIDGE)!,
            outfits: new Map(aboard),
            getOutfit: (id: string) => outfits.get(id),
            credits: 1_000_000,
        };
        const shuttle = ships.get(SHUTTLE)!;
        expect(canBuyShip(shuttle, context).allowed).toBeTrue();
        const bought = buildPurchasedShip(hull, shuttle, context);
        const boughtAboard = countsOf(bought);
        expect(boughtAboard).toContain([FED_CLOAK, 1]);
        expect(boughtAboard).toContain([HEAVY_WEAPONS_LICENSE, 1]);
        expect(freeMassOf(SHUTTLE, boughtAboard)).toBe(
            freeMassOf(SHUTTLE, loadout(SHUTTLE)) - 15);
        expect(freeMassOf(SHUTTLE, boughtAboard)).toBeLessThan(0);
    });

    it('the stock Darts (not persistent) follow the persistent, weightless '
        + 'Create Dart that launches them', () => {
        expect(outfits.get(CREATE_DART)!.persistent).toBeTrue();
        expect(outfits.get(DART)!.persistent).toBeFalse();
        expect(Object.keys(outfits.get(CREATE_DART)!.weapons))
            .toContain(outfits.get(DART)!.ammoFor!);
        const hull = pilot(STARBRIDGE,
            loadout(STARBRIDGE, [[CREATE_DART, 1], [DART, 8]]), []);
        expect(outfitsFollowingPilot(hull, lookups)).toEqual(
            new Map([[CREATE_DART, 1], [DART, 8]]));
    });
});
