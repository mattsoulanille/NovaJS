import 'jasmine';
import { getDefaultShipData, ShipData } from 'novadatainterface/ship_data';
import { getDefaultOutfitData, OutfitData } from 'novadatainterface/outfit_data';
import { Entity } from 'nova_ecs/entity';
import { SimulationGameDataInterface } from '../client/gamedata/simulation_game_data.js';
import { ReturnWhenTargetRemovedComponent } from '../nova_plugin/bay_plugin.js';
import { CargoComponent } from '../nova_plugin/cargo_plugin.js';
import { MissionShipComponent } from '../nova_plugin/mission_ship_plugin.js';
import { OutfitsStateComponent } from '../nova_plugin/outfit_plugin.js';
import { ShipComponent } from '../nova_plugin/ship_plugin.js';
import { TradeGood } from '../nova_plugin/trade_logic.js';
import {
    carriesCargo, collectFleetHolds, commitFleetHolds, FleetCargoState,
    FleetEscortEntry, FleetHold, fleetBuy, fleetBuyQuantity, fleetCapacity,
    fleetCargo, fleetFreeSpace, fleetHeld, fleetSell, fleetSellQuantity,
    freeSpaceLines, hasCargoEscorts, maxFleetBuyQuantity, maxFleetSellQuantity,
    quantityColumnHeader, shipFreeSpace,
} from './fleet_cargo.js';

const FOOD: TradeGood = {
    key: 'cargo:0', name: 'Food', tier: 'med', price: 75,
    canBuy: true, canSell: true,
};

function state({ shipCargo = [], credits = 1_000_000, shipCapacity = 100,
    holds = [] }: {
        shipCargo?: [string, number][],
        credits?: number,
        shipCapacity?: number,
        holds?: { uuid: string, capacity: number, cargo?: [string, number][] }[],
    } = {}): FleetCargoState {
    return {
        ship: {
            cargo: new Map(shipCargo),
            credits: { credits },
            cargoCapacity: shipCapacity,
        },
        holds: holds.map(hold => ({
            uuid: hold.uuid,
            capacity: hold.capacity,
            cargo: new Map(hold.cargo ?? []),
        })),
    };
}

/** A hold's tons of one key, for readable expectations. */
function held(hold: FleetHold, key = FOOD.key): number {
    return hold.cargo.get(key) ?? 0;
}

describe('carriesCargo (shïp InherentAI)', () => {
    const ship = (inherentAI: number): ShipData =>
        ({ ...getDefaultShipData(), inherentAI });

    it('accepts the two trader brains, per the Bible\'s "only ships with '
        + 'inherent AI of 1 or 2 can be used to carry cargo"', () => {
            expect(carriesCargo(ship(1))).toBeTrue();
            expect(carriesCargo(ship(2))).toBeTrue();
        });

    it('rejects warship and interceptor brains', () => {
        expect(carriesCargo(ship(3))).toBeFalse();
        expect(carriesCargo(ship(4))).toBeFalse();
    });

    it('rejects out-of-range values rather than guessing', () => {
        expect(carriesCargo(ship(0))).toBeFalse();
        expect(carriesCargo(ship(-1))).toBeFalse();
        expect(carriesCargo(ship(5))).toBeFalse();
    });
});

describe('fleet capacity and free space', () => {
    it('is the ship alone with no escorts', () => {
        const fleet = state({ shipCapacity: 40, shipCargo: [['cargo:0', 15]] });
        expect(hasCargoEscorts(fleet)).toBeFalse();
        expect(fleetCapacity(fleet)).toBe(40);
        expect(fleetFreeSpace(fleet)).toBe(25);
        expect(shipFreeSpace(fleet)).toBe(25);
    });

    it('sums the escorts\' holds on top of the ship\'s', () => {
        const fleet = state({
            shipCapacity: 15,
            holds: [
                { uuid: 'a', capacity: 200 },
                { uuid: 'b', capacity: 175 },
            ],
        });
        // The reference pilot: 15 tons in the hull, 390 in the fleet
        // (trade_center/earth_trade_center.png).
        expect(fleetCapacity(fleet)).toBe(390);
        expect(fleetFreeSpace(fleet)).toBe(390);
        expect(shipFreeSpace(fleet)).toBe(15);
    });

    it('never lets a hold\'s free space go negative (an over-full prize)',
        () => {
            const fleet = state({
                shipCapacity: 10,
                holds: [{ uuid: 'a', capacity: 5, cargo: [['cargo:1', 9]] }],
            });
            expect(fleetFreeSpace(fleet)).toBe(10);
        });

    it('reports fleet-wide holdings and a merged manifest', () => {
        const fleet = state({
            shipCargo: [['cargo:0', 4], ['mission:nova:700', 5]],
            holds: [
                { uuid: 'a', capacity: 50, cargo: [['cargo:0', 6]] },
                { uuid: 'b', capacity: 50, cargo: [['junk:nova:128', 3]] },
            ],
        });
        expect(fleetHeld(fleet, 'cargo:0')).toBe(10);
        expect(fleetHeld(fleet, 'junk:nova:128')).toBe(3);
        expect([...fleetCargo(fleet)]).toEqual([
            ['cargo:0', 10], ['mission:nova:700', 5], ['junk:nova:128', 3],
        ]);
    });
});

describe('buying into the fleet', () => {
    it('fills the player\'s own hold before spilling into escorts, in uuid '
        + 'order', () => {
            const fleet = state({
                shipCapacity: 15,
                holds: [
                    { uuid: 'a', capacity: 200 },
                    { uuid: 'b', capacity: 175 },
                ],
            });
            expect(fleetBuyQuantity(fleet, FOOD, 300)).toBe(300);
            expect(fleet.ship.cargo.get('cargo:0')).toBe(15);
            expect(held(fleet.holds[0]!)).toBe(200);
            expect(held(fleet.holds[1]!)).toBe(85);
        });

    it('buys as much as the FLEET can hold in one click, as the reference\'s '
        + '390-ton purchase onto a 15-ton hull does', () => {
            const fleet = state({
                shipCapacity: 15, credits: 1_000_000,
                holds: [{ uuid: 'a', capacity: 375 }],
            });
            expect(maxFleetBuyQuantity(fleet, FOOD)).toBe(390);
            expect(fleetBuy(fleet, FOOD)).toBe(390);
            expect(fleetFreeSpace(fleet)).toBe(0);
            expect(shipFreeSpace(fleet)).toBe(0);
            expect(fleetHeld(fleet, FOOD.key)).toBe(390);
        });

    it('is limited by credits, not just space', () => {
        const fleet = state({
            shipCapacity: 15, credits: 750,
            holds: [{ uuid: 'a', capacity: 375 }],
        });
        expect(maxFleetBuyQuantity(fleet, FOOD)).toBe(10);
        expect(fleetBuy(fleet, FOOD)).toBe(10);
        expect(fleet.ship.credits.credits).toBe(0);
        expect(fleet.ship.cargo.get('cargo:0')).toBe(10);
        expect(held(fleet.holds[0]!)).toBe(0);
    });

    it('charges only for the tons that actually fit', () => {
        const fleet = state({ shipCapacity: 5, credits: 10_000 });
        expect(fleetBuyQuantity(fleet, FOOD, 99)).toBe(5);
        expect(fleet.ship.credits.credits).toBe(10_000 - 5 * 75);
    });

    it('refuses a mission-cargo key outright, so nothing can route mission '
        + 'freight onto an escort', () => {
            const fleet = state({
                shipCapacity: 100,
                holds: [{ uuid: 'a', capacity: 100 }],
            });
            const missionGood: TradeGood = {
                ...FOOD, key: 'mission:nova:700', name: 'Probe',
            };
            expect(maxFleetBuyQuantity(fleet, missionGood)).toBe(0);
            expect(fleetBuyQuantity(fleet, missionGood, 10)).toBe(0);
            expect(fleet.holds[0]!.cargo.size).toBe(0);
        });

    it('leaves the player\'s own free space alone once the ship is full — the '
        + 'invariant mission acceptance and the outfitter rely on', () => {
            const fleet = state({
                shipCapacity: 10,
                holds: [{ uuid: 'a', capacity: 500 }],
            });
            fleetBuy(fleet, FOOD);
            // Fleet space was spent, but the ship-local reading is its own.
            expect(shipFreeSpace(fleet)).toBe(0);
            expect(fleet.ship.cargoCapacity).toBe(10);
            // ...and the escort's tons are not in the ship's hold.
            expect(fleet.ship.cargo.get('cargo:0')).toBe(10);
            expect(held(fleet.holds[0]!)).toBe(500);
        });
});

describe('selling out of the fleet', () => {
    it('draws the fleet-wide total, draining the player\'s ship first so a '
        + 'sale can free space for mission cargo', () => {
            const fleet = state({
                shipCapacity: 15, credits: 0, shipCargo: [['cargo:0', 15]],
                holds: [
                    { uuid: 'a', capacity: 200, cargo: [['cargo:0', 200]] },
                    { uuid: 'b', capacity: 175, cargo: [['cargo:0', 175]] },
                ],
            });
            expect(maxFleetSellQuantity(fleet, FOOD)).toBe(390);
            expect(fleetSellQuantity(fleet, FOOD, 20)).toBe(20);
            expect(fleet.ship.cargo.has('cargo:0')).toBeFalse();
            expect(shipFreeSpace(fleet)).toBe(15);
            expect(held(fleet.holds[0]!)).toBe(195);
            expect(held(fleet.holds[1]!)).toBe(175);
            expect(fleet.ship.credits.credits).toBe(20 * 75);
        });

    it('sells the whole fleet holding in one click', () => {
        const fleet = state({
            shipCapacity: 15, credits: 0, shipCargo: [['cargo:0', 15]],
            holds: [{ uuid: 'a', capacity: 375, cargo: [['cargo:0', 375]] }],
        });
        expect(fleetSell(fleet, FOOD)).toBe(390);
        expect(fleetHeld(fleet, FOOD.key)).toBe(0);
        expect(fleet.ship.credits.credits).toBe(390 * 75);
    });

    it('cannot reach cargo the fleet does not have', () => {
        const fleet = state({ holds: [{ uuid: 'a', capacity: 50 }] });
        expect(maxFleetSellQuantity(fleet, FOOD)).toBe(0);
        expect(fleetSellQuantity(fleet, FOOD, 10)).toBe(0);
        expect(fleet.ship.credits.credits).toBe(1_000_000);
    });

    it('loses an escort\'s cargo with the escort: the fleet total drops by '
        + 'exactly its hold', () => {
            const fleet = state({
                shipCargo: [['cargo:0', 4]],
                holds: [
                    { uuid: 'a', capacity: 50, cargo: [['cargo:0', 50]] },
                    { uuid: 'b', capacity: 50, cargo: [['cargo:0', 20]] },
                ],
            });
            expect(fleetHeld(fleet, FOOD.key)).toBe(74);
            fleet.holds.splice(0, 1); // Escort 'a' was shot down.
            expect(fleetHeld(fleet, FOOD.key)).toBe(24);
            expect(maxFleetSellQuantity(fleet, FOOD)).toBe(24);
        });
});

describe('the exchange\'s wording (STR# 2002)', () => {
    it('says "In Hold:" and one free-space line with no cargo escorts', () => {
        const fleet = state({ shipCapacity: 40, shipCargo: [['cargo:0', 15]] });
        expect(quantityColumnHeader(fleet)).toBe('In Hold:');
        expect(freeSpaceLines(fleet)).toEqual(['Free cargo space: 25 tons']);
    });

    it('says "In Fleet:" and splits the readout once escorts carry cargo, '
        + 'exactly as earth_trade_center.png reads', () => {
            const fleet = state({
                shipCapacity: 15,
                holds: [{ uuid: 'a', capacity: 375 }],
            });
            expect(quantityColumnHeader(fleet)).toBe('In Fleet:');
            expect(freeSpaceLines(fleet)).toEqual([
                'Free cargo space in your ship: 15 tons',
                'Free cargo space in your fleet: 390 tons',
            ]);
        });

    it('reads 0 / 0 after the reference\'s 390-ton purchase '
        + '(390_medical_supplies.png)', () => {
            const fleet = state({
                shipCapacity: 15,
                holds: [{ uuid: 'a', capacity: 375 }],
            });
            fleetBuy(fleet, FOOD);
            expect(freeSpaceLines(fleet)).toEqual([
                'Free cargo space in your ship: 0 tons',
                'Free cargo space in your fleet: 0 tons',
            ]);
        });
});

describe('collectFleetHolds', () => {
    const FREIGHTER = 'nova:freighter';
    const WARSHIP = 'nova:warship';
    const EXPANDER = 'nova:expander';

    const ships: Record<string, ShipData> = {
        [FREIGHTER]: {
            ...getDefaultShipData(), inherentAI: 2,
            physics: { ...getDefaultShipData().physics, freeCargo: 100 },
        },
        [WARSHIP]: {
            ...getDefaultShipData(), inherentAI: 3,
            physics: { ...getDefaultShipData().physics, freeCargo: 30 },
        },
    };
    const outfits: Record<string, OutfitData> = {
        [EXPANDER]: {
            ...getDefaultOutfitData(),
            physics: { ...getDefaultOutfitData().physics, freeCargo: 25 },
        },
    };
    const gameData = {
        data: {
            Ship: {
                get: async (id: string) => {
                    const ship = ships[id];
                    if (!ship) {
                        throw new Error(`no ship ${id}`);
                    }
                    return ship;
                },
            },
            Outfit: {
                get: async (id: string) => {
                    const outfit = outfits[id];
                    if (!outfit) {
                        throw new Error(`no outfit ${id}`);
                    }
                    return outfit;
                },
            },
        },
    } as unknown as SimulationGameDataInterface;

    function escort(uuid: string, shipId: string,
        { player = 'player', cargo, fighter = false, missionShip = false,
            expanders = 0 }: {
                player?: string, cargo?: [string, number][],
                fighter?: boolean, missionShip?: boolean, expanders?: number,
            } = {}): FleetEscortEntry {
        const entity = new Entity();
        entity.components.set(ShipComponent, { id: shipId });
        if (cargo) {
            entity.components.set(CargoComponent, new Map(cargo));
        }
        if (fighter) {
            entity.components.set(ReturnWhenTargetRemovedComponent, undefined);
        }
        if (missionShip) {
            entity.components.set(MissionShipComponent,
                { mission: 'nova:700', owner: player });
        }
        if (expanders > 0) {
            entity.components.set(OutfitsStateComponent,
                new Map([[EXPANDER, { count: expanders }]]));
        }
        return { player, uuid, entity };
    }

    it('keeps only the trader-AI escorts and orders them by uuid',
        async () => {
            const holds = await collectFleetHolds([
                escort('b', FREIGHTER),
                escort('c', WARSHIP),
                escort('a', FREIGHTER),
            ], 'player', gameData);
            expect(holds.map(h => h.uuid)).toEqual(['a', 'b']);
            expect(holds.map(h => h.capacity)).toEqual([100, 100]);
        });

    it('collapses a repeated uuid to one hold, so a landing overlap cannot '
        + 'double the fleet\'s capacity', async () => {
            const entry = escort('a', FREIGHTER);
            const holds = await collectFleetHolds([entry, entry], 'player',
                gameData);
            expect(holds.length).toBe(1);
            expect(holds[0]?.capacity).toBe(100);
        });

    it('never counts a bay-launched fighter, whatever its hull\'s AI is',
        async () => {
            const holds = await collectFleetHolds(
                [escort('a', FREIGHTER, { fighter: true })], 'player',
                gameData);
            expect(holds).toEqual([]);
        });

    it('skips mission ships and other players\' escorts', async () => {
        const holds = await collectFleetHolds([
            escort('a', FREIGHTER, { missionShip: true }),
            escort('b', FREIGHTER, { player: 'someone-else' }),
        ], 'player', gameData);
        expect(holds).toEqual([]);
    });

    it('includes the escort\'s own freeCargo outfits in its capacity',
        async () => {
            const holds = await collectFleetHolds(
                [escort('a', FREIGHTER, { expanders: 2 })], 'player', gameData);
            expect(holds[0]?.capacity).toBe(150);
        });

    it('copies the escort\'s existing cargo (a captured freighter arrives '
        + 'loaded) without aliasing the component', async () => {
            const entry = escort('a', FREIGHTER, { cargo: [['cargo:3', 12]] });
            const holds = await collectFleetHolds([entry], 'player', gameData);
            expect([...holds[0]!.cargo]).toEqual([['cargo:3', 12]]);
            holds[0]!.cargo.set('cargo:3', 1);
            expect(entry.entity.components.get(CargoComponent)?.get('cargo:3'))
                .toBe(12);
        });

    it('skips an escort whose ship data will not load rather than inventing '
        + 'capacity for it', async () => {
            const holds = await collectFleetHolds(
                [escort('a', 'nova:missing')], 'player', gameData);
            expect(holds).toEqual([]);
        });

    it('trades every landed escort when the client could not attribute the '
        + 'landing (no player uuid)', async () => {
            const holds = await collectFleetHolds(
                [escort('a', FREIGHTER, { player: 'whoever' })], undefined,
                gameData);
            expect(holds.map(h => h.uuid)).toEqual(['a']);
        });
});

describe('commitFleetHolds', () => {
    function entity(cargo?: [string, number][]): Entity {
        const built = new Entity();
        built.components.set(ShipComponent, { id: 'nova:freighter' });
        if (cargo) {
            built.components.set(CargoComponent, new Map(cargo));
        }
        return built;
    }

    it('writes each working hold back onto its escort so it lifts off (and '
        + 'saves) carrying the goods', () => {
            const target = entity([['cargo:0', 1]]);
            commitFleetHolds([{
                uuid: 'a', capacity: 100, entity: target,
                cargo: new Map([['cargo:0', 40], ['junk:nova:128', 2]]),
            }]);
            expect([...target.components.get(CargoComponent)!]).toEqual([
                ['cargo:0', 40], ['junk:nova:128', 2],
            ]);
        });

    it('drops emptied entries and refuses to write mission cargo onto an '
        + 'escort', () => {
            const target = entity();
            commitFleetHolds([{
                uuid: 'a', capacity: 100, entity: target,
                cargo: new Map([
                    ['cargo:0', 0], ['mission:nova:700', 5], ['cargo:1', 3],
                ]),
            }]);
            expect([...target.components.get(CargoComponent)!])
                .toEqual([['cargo:1', 3]]);
        });

    it('ignores holds with no entity (the unit-test shape)', () => {
        expect(() => commitFleetHolds([{
            uuid: 'a', capacity: 10, cargo: new Map([['cargo:0', 1]]),
        }])).not.toThrow();
    });
});
