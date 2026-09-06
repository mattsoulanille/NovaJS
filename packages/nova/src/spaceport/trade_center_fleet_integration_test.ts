import 'jasmine';
import { Entity } from 'nova_ecs/entity';
import { getIntegrationGameData } from '../communication/simulation_test_fixture.js';
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
 * The trade center's fleet-cargo session, driven against the REAL Nova
 * data — the same sequence the dialog runs (collect the landed escorts'
 * holds, render the STR# 2002 wording, buy, sell, commit on Done), minus
 * the PIXI widgets. As elsewhere in this package the menu class itself is
 * PIXI-bound and cannot be constructed headlessly (PIXI.Text and
 * PIXI.Graphics both need a canvas), so the session is exercised through
 * the functions it delegates to; see outfitter_grid_integration_test.ts
 * for the same split.
 *
 * The point of using real data is the shïp InherentAI plumbing: the
 * Bible's cargo-escort rule is only as good as the field, so these specs
 * pin that stock Nova really does mark its freighters 1/2 and its
 * warships 3, all the way through novaparse into ShipData.
 */

/** Stock hulls, with the freeCargo and InherentAI these specs assume. */
const HEAVY_SHUTTLE = 'nova:129';   // AI 1, 15 tons — the player's hull.
const ENTERPRISE = 'nova:139';      // AI 2, 250 tons.
const STAR_LINER = 'nova:134';      // AI 1, 120 tons.
const FED_DESTROYER = 'nova:141';   // AI 3, 50 tons — carries nothing.
const EARTH = 'nova:128';

/** The fleet's total capacity in these specs: 15 + 250 + 120. */
const FLEET_CAPACITY = 385;

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

describe('trade center fleet cargo against real Nova data', () => {
    /** The player's hold, the escorts', and Earth's Food row. */
    async function session(playerCargo: [string, number][] = [],
        roster: FleetEscortEntry[] = [], credits = 10_000_000):
        Promise<{ fleet: FleetCargoState, food: TradeGood }> {
        const gameData = await getIntegrationGameData();
        const player = ship(HEAVY_SHUTTLE, playerCargo);
        const fleet: FleetCargoState = {
            ship: {
                cargo: player.components.get(CargoComponent)!,
                credits: { credits },
                cargoCapacity:
                    await computeCargoCapacity(player, gameData),
            },
            holds: await collectFleetHolds(roster, 'player', gameData),
        };
        const planet = await gameData.data.Planet.get(EARTH);
        const start = await gameData.ids
            .then(ids => gameData.data.PlayerStart.get(ids.PlayerStart[0]!));
        const goods = standardTradeGoods(planet, start.cargoNames);
        return { fleet, food: goods.find(g => g.key === 'cargo:0')! };
    }

    it('pins the stock hulls\' InherentAI and cargo space these specs stand '
        + 'on', async () => {
            const gameData = await getIntegrationGameData();
            const expected: [string, number, number][] = [
                [HEAVY_SHUTTLE, 1, 15],
                [ENTERPRISE, 2, 250],
                [STAR_LINER, 1, 120],
                [FED_DESTROYER, 3, 50],
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
                .toEqual(['Free cargo space: 15 tons']);
        });

    it('adds the trader-AI escorts\' holds and splits the readout', async () => {
        const { fleet } = await session([], [
            escort('b', STAR_LINER),
            escort('a', ENTERPRISE),
            // A warship escort brings guns, not cargo space.
            escort('c', FED_DESTROYER),
        ]);
        expect(fleet.holds.map(hold => hold.uuid)).toEqual(['a', 'b']);
        expect(fleet.holds.map(hold => hold.capacity)).toEqual([250, 120]);
        expect(quantityColumnHeader(fleet)).toBe('In Fleet:');
        expect(fleetFreeSpace(fleet)).toBe(FLEET_CAPACITY);
        expect(freeSpaceLines(fleet)).toEqual([
            'Free cargo space in your ship: 15 tons',
            `Free cargo space in your fleet: ${FLEET_CAPACITY} tons`,
        ]);
    });

    it('buys the whole fleet\'s worth in one click, filling the ship first '
        + 'and committing each escort\'s hold on Done', async () => {
            const roster = [escort('a', ENTERPRISE), escort('b', STAR_LINER)];
            const { fleet, food } = await session([], roster);
            expect(fleetBuy(fleet, food)).toBe(FLEET_CAPACITY);
            expect(shipFreeSpace(fleet)).toBe(0);
            expect(fleetFreeSpace(fleet)).toBe(0);
            expect(fleet.ship.cargo.get('cargo:0')).toBe(15);

            commitFleetHolds(fleet.holds);
            expect(roster[0]!.entity.components.get(CargoComponent))
                .toEqual(new Map([['cargo:0', 250]]));
            expect(roster[1]!.entity.components.get(CargoComponent))
                .toEqual(new Map([['cargo:0', 120]]));
        });

    it('keeps mission cargo on the player\'s ship and out of every escort '
        + 'hold, even when the purchase fills the fleet', async () => {
            const roster = [escort('a', ENTERPRISE)];
            const { fleet, food } = await session([['mission:nova:700', 5]],
                roster);
            // 10 tons left in the hull, 250 in the escort.
            expect(shipFreeSpace(fleet)).toBe(10);
            expect(fleetBuy(fleet, food)).toBe(260);
            commitFleetHolds(fleet.holds);

            expect(fleet.ship.cargo.get('mission:nova:700')).toBe(5);
            expect(fleet.ship.cargo.get('cargo:0')).toBe(10);
            const escortCargo =
                roster[0]!.entity.components.get(CargoComponent)!;
            expect(escortCargo.get('cargo:0')).toBe(250);
            expect([...escortCargo.keys()]
                .some(key => key.startsWith('mission:'))).toBeFalse();
        });

    it('sells the fleet-wide holding and frees the SHIP\'s space first, so a '
        + 'sale can make room for mission freight', async () => {
            const roster = [escort('a', ENTERPRISE, [['cargo:0', 250]])];
            const { fleet, food } = await session([['cargo:0', 15]], roster,
                0);
            expect(fleetHeld(fleet, 'cargo:0')).toBe(265);
            expect(shipFreeSpace(fleet)).toBe(0);
            expect(fleetFreeSpace(fleet)).toBe(0);

            expect(fleetSell(fleet, food)).toBe(265);
            expect(shipFreeSpace(fleet)).toBe(15);
            expect(fleet.ship.credits.credits).toBe(265 * food.price);

            commitFleetHolds(fleet.holds);
            expect(roster[0]!.entity.components.get(CargoComponent)?.size)
                .toBe(0);
        });

    it('never counts a fighter in the bays of a carrier escort, even a '
        + 'trader-AI one', async () => {
            const gameData = await getIntegrationGameData();
            const fighter = escort('a', ENTERPRISE);
            // The bay-launched marker, as bay_plugin stamps it.
            fighter.entity.components.set(
                ReturnWhenTargetRemovedComponent, undefined);
            expect(await collectFleetHolds([fighter], 'player', gameData))
                .toEqual([]);
        });
});
