import 'jasmine';
import { Entity } from 'nova_ecs/entity';
import { SYNTHETIC } from 'novaparse/synthetic/universe';
import {
    getIntegrationGameData, getSyntheticGameData,
} from '../communication/simulation_test_fixture.js';
import { ReturnWhenTargetRemovedComponent } from '../nova_plugin/escorts/bay_plugin.js';
import { CargoComponent } from '../nova_plugin/ship/cargo_plugin.js';
import { OutfitsStateComponent } from '../nova_plugin/ship/outfit_plugin.js';
import { ShipComponent } from '../nova_plugin/ship/ship_plugin.js';
import { standardTradeGoods, TradeGood } from '../nova_plugin/economy/trade_logic.js';
import {
    collectFleetHolds, commitFleetHolds, FleetCargoState, FleetEscortEntry,
    fleetBuy, fleetFreeSpace, fleetHeld, fleetSell, freeSpaceLines,
    quantityColumnHeader, shipFreeSpace,
} from './fleet_cargo.js';
import { computeCargoCapacity } from './mission_session.js';

/**
 * The trade center's fleet-cargo session, driven against PARSED game data
 * — the same sequence the dialog runs (collect the landed escorts' holds,
 * render the STR# 2002 wording, buy, sell, commit on Done), minus the PIXI
 * widgets. As elsewhere in this package the menu class itself is
 * PIXI-bound and cannot be constructed headlessly (PIXI.Text and
 * PIXI.Graphics both need a canvas), so the session is exercised through
 * the functions it delegates to; see outfitter_grid_integration_test.ts
 * for the same split.
 *
 * The point of using parsed data is the shïp InherentAI plumbing: the
 * Bible's cargo-escort rule is only as good as the field, so the hulls
 * below carry their AI and freeCargo all the way through novaparse into
 * ShipData. That stock Nova ITSELF marks its freighters 1/2 and its
 * warships 3 is a fact about the shipped game, and is pinned on the
 * integration data in the describe at the foot of this file.
 */

/** Synthetic hulls, with the freeCargo and InherentAI these specs assume. */
const SKIFF = SYNTHETIC.ships.skiff;    // AI 1, 20 tons — the player's hull.
const HULK = SYNTHETIC.ships.hulk;      // AI 2, 250 tons.
const MOTE = SYNTHETIC.ships.mote;      // AI 1, 5 tons.
const WARDEN = SYNTHETIC.ships.warden;  // AI 3, 60 tons — carries nothing.
const PORT = SYNTHETIC.planets.port;

/** The fleet's total capacity in these specs: 20 + 250 + 5. */
const FLEET_CAPACITY = 275;

/**
 * A bare ship entity: ShipComponent plus an EMPTY outfit set, so its
 * capacity is exactly the hull's freeCargo and the arithmetic below is
 * readable. (In the game the ship provider installs the hull's default
 * outfits, which a freeCargo outfit among them would add to.)
 */
function ship(shipId: string, cargo: [string, number][] = []): Entity {
    const entity = new Entity();
    entity.components.set(ShipComponent, { id: shipId });
    entity.components.set(OutfitsStateComponent, new Map());
    entity.components.set(CargoComponent, new Map(cargo));
    return entity;
}

function escort(uuid: string, shipId: string,
    cargo: [string, number][] = []): FleetEscortEntry {
    return { player: 'player', uuid, entity: ship(shipId, cargo) };
}

describe('trade center fleet cargo against parsed Nova data', () => {
    /** The player's hold, the escorts', and Port Amberline's Food row. */
    async function session(playerCargo: [string, number][] = [],
        roster: FleetEscortEntry[] = [], credits = 10_000_000):
        Promise<{ fleet: FleetCargoState, food: TradeGood }> {
        const gameData = await getSyntheticGameData();
        const player = ship(SKIFF, playerCargo);
        const fleet: FleetCargoState = {
            ship: {
                cargo: player.components.get(CargoComponent)!,
                credits: { credits },
                cargoCapacity:
                    await computeCargoCapacity(player, gameData),
            },
            holds: await collectFleetHolds(roster, 'player', gameData),
        };
        const planet = await gameData.data.Planet.get(PORT);
        const start = await gameData.ids
            .then(ids => gameData.data.PlayerStart.get(ids.PlayerStart[0]!));
        const goods = standardTradeGoods(planet, start.cargoNames);
        return { fleet, food: goods.find(g => g.key === 'cargo:0')! };
    }

    it('pins the hulls\' InherentAI and cargo space these specs stand '
        + 'on', async () => {
            const gameData = await getSyntheticGameData();
            const expected: [string, number, number][] = [
                [SKIFF, 1, 20],
                [HULK, 2, 250],
                [MOTE, 1, 5],
                [WARDEN, 3, 60],
            ];
            for (const [id, inherentAI, freeCargo] of expected) {
                const data = await gameData.data.Ship.get(id);
                expect(data.inherentAI).withContext(`${data.name} AI`)
                    .toBe(inherentAI);
                expect(data.physics.freeCargo)
                    .withContext(`${data.name} freeCargo`).toBe(freeCargo);
            }
        });

    it('trades the ship alone, with the solo wording, when nothing escorts '
        + 'the player', async () => {
            const { fleet } = await session();
            expect(quantityColumnHeader(fleet)).toBe('In Hold:');
            expect(freeSpaceLines(fleet))
                .toEqual(['Free cargo space: 20 tons']);
        });

    it('adds the trader-AI escorts\' holds and splits the readout', async () => {
        const { fleet } = await session([], [
            escort('b', MOTE),
            escort('a', HULK),
            // A warship escort brings guns, not cargo space.
            escort('c', WARDEN),
        ]);
        expect(fleet.holds.map(hold => hold.uuid)).toEqual(['a', 'b']);
        expect(fleet.holds.map(hold => hold.capacity)).toEqual([250, 5]);
        expect(quantityColumnHeader(fleet)).toBe('In Fleet:');
        expect(fleetFreeSpace(fleet)).toBe(FLEET_CAPACITY);
        expect(freeSpaceLines(fleet)).toEqual([
            'Free cargo space in your ship: 20 tons',
            `Free cargo space in your fleet: ${FLEET_CAPACITY} tons`,
        ]);
    });

    it('buys the whole fleet\'s worth in one click, filling the ship first '
        + 'and committing each escort\'s hold on Done', async () => {
            const roster = [escort('a', HULK), escort('b', MOTE)];
            const { fleet, food } = await session([], roster);
            expect(fleetBuy(fleet, food)).toBe(FLEET_CAPACITY);
            expect(shipFreeSpace(fleet)).toBe(0);
            expect(fleetFreeSpace(fleet)).toBe(0);
            expect(fleet.ship.cargo.get('cargo:0')).toBe(20);

            commitFleetHolds(fleet.holds);
            expect(roster[0]!.entity.components.get(CargoComponent))
                .toEqual(new Map([['cargo:0', 250]]));
            expect(roster[1]!.entity.components.get(CargoComponent))
                .toEqual(new Map([['cargo:0', 5]]));
        });

    it('keeps mission cargo on the player\'s ship and out of every escort '
        + 'hold, even when the purchase fills the fleet', async () => {
            const roster = [escort('a', HULK)];
            const { fleet, food } = await session([['mission:nova:700', 5]],
                roster);
            // 15 tons left in the hull (20 less the freight), 250 in the
            // escort: 265 bought.
            expect(shipFreeSpace(fleet)).toBe(15);
            expect(fleetBuy(fleet, food)).toBe(265);
            commitFleetHolds(fleet.holds);

            expect(fleet.ship.cargo.get('mission:nova:700')).toBe(5);
            expect(fleet.ship.cargo.get('cargo:0')).toBe(15);
            const escortCargo =
                roster[0]!.entity.components.get(CargoComponent)!;
            expect(escortCargo.get('cargo:0')).toBe(250);
            expect([...escortCargo.keys()]
                .some(key => key.startsWith('mission:'))).toBeFalse();
        });

    it('sells the fleet-wide holding and frees the SHIP\'s space first, so a '
        + 'sale can make room for mission freight', async () => {
            const roster = [escort('a', HULK, [['cargo:0', 250]])];
            const { fleet, food } = await session([['cargo:0', 20]], roster,
                0);
            // The hull's 20 tons plus the hulk's 250.
            expect(fleetHeld(fleet, 'cargo:0')).toBe(270);
            expect(shipFreeSpace(fleet)).toBe(0);
            expect(fleetFreeSpace(fleet)).toBe(0);

            expect(fleetSell(fleet, food)).toBe(270);
            expect(shipFreeSpace(fleet)).toBe(20);
            expect(fleet.ship.credits.credits).toBe(270 * food.price);

            commitFleetHolds(fleet.holds);
            expect(roster[0]!.entity.components.get(CargoComponent)?.size)
                .toBe(0);
        });

    it('never counts a fighter in the bays of a carrier escort, even a '
        + 'trader-AI one', async () => {
            const gameData = await getSyntheticGameData();
            const fighter = escort('a', HULK);
            // The bay-launched marker, as bay_plugin stamps it.
            fighter.entity.components.set(
                ReturnWhenTargetRemovedComponent, undefined);
            expect(await collectFleetHolds([fighter], 'player', gameData))
                .toEqual([]);
        });
});

/**
 * STAYS ON THE STOCK DATA. The rule above is only worth anything if the
 * shipped game really does mark its freighters InherentAI 1/2 and its
 * warships 3, which is a fact about stock Nova and about nothing else.
 */
describe('stock Nova\'s own freighter and warship InherentAI', () => {
    it('pins the stock hulls these specs were first written against',
        async () => {
            const gameData = await getIntegrationGameData();
            const expected: [string, number, number][] = [
                ['nova:129', 1, 15],   // Heavy Shuttle.
                ['nova:139', 2, 250],  // Enterprise.
                ['nova:134', 1, 120],  // Star Liner.
                ['nova:141', 3, 50],   // Fed Destroyer — carries nothing.
            ];
            for (const [id, inherentAI, freeCargo] of expected) {
                const data = await gameData.data.Ship.get(id);
                expect(data.inherentAI).withContext(`${data.name} AI`)
                    .toBe(inherentAI);
                expect(data.physics.freeCargo)
                    .withContext(`${data.name} freeCargo`).toBe(freeCargo);
            }
        });
});
