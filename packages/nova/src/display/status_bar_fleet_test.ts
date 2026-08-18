import 'jasmine';
import { Entity } from 'nova_ecs/entity';
import { SimulationGameDataInterface } from '../client/gamedata/simulation_game_data.js';
import { ReturnWhenTargetRemovedComponent } from '../nova_plugin/bay_plugin.js';
import { CargoComponent } from '../nova_plugin/cargo_plugin.js';
import { MissionShipComponent } from '../nova_plugin/mission_ship_plugin.js';
import { OutfitsStateComponent } from '../nova_plugin/outfit_plugin.js';
import { PlayerEscortComponent } from '../nova_plugin/player_escort.js';
import { ShipComponent } from '../nova_plugin/ship_plugin.js';
import { sumFleetCargo } from '../spaceport/fleet_cargo.js';
import {
    cargoDisplayOf, fleetCargoMembers, playerEscortEntities,
} from './status_bar.js';

/**
 * The status bar's cargo panel is FLEET-WIDE (Matthew's ruling: "'Free''s
 * total in the status bar should include the fleet"), matching
 * trade_center/earth_trade_center.png — "Free: 390" beside a hull with 15
 * tons free — and 390_medical_supplies.png, where the same 15-ton hull's
 * bar reads "Med: 390" after one purchase.
 *
 * These cover the two sources the readout draws escorts from: the world's
 * entity map in flight, and the client's landed roster while docked. Both
 * funnel into the same fleetCargoMembers -> sumFleetCargo -> cargoDisplayOf
 * pipeline, so the two readouts cannot drift apart.
 */

const PLAYER = 'player-uuid';
const FREIGHTER = 'nova:freighter';   // InherentAI 2, 100 tons.
const WARSHIP = 'nova:warship';       // InherentAI 3.
const EXPANDER = 'nova:expander';     // +25 tons.

function fakeGameData(): SimulationGameDataInterface {
    const ships: Record<string, { inherentAI: number, freeCargo: number }> = {
        [FREIGHTER]: { inherentAI: 2, freeCargo: 100 },
        [WARSHIP]: { inherentAI: 3, freeCargo: 80 },
    };
    return {
        data: {
            Ship: {
                getCached: (id: string) => {
                    const ship = ships[id];
                    return ship && {
                        inherentAI: ship.inherentAI,
                        physics: { freeCargo: ship.freeCargo },
                    };
                },
            },
            Outfit: {
                getCached: (id: string) =>
                    id === EXPANDER ? { physics: { freeCargo: 25 } } : undefined,
            },
            Junk: { getCached: () => undefined },
        },
    } as unknown as SimulationGameDataInterface;
}

function escortEntity(shipId: string, { player = PLAYER, cargo, fighter = false,
    missionShip = false, expanders = 0 }: {
        player?: string, cargo?: [string, number][], fighter?: boolean,
        missionShip?: boolean, expanders?: number,
    } = {}): Entity {
    const entity = new Entity();
    entity.components.set(ShipComponent, { id: shipId });
    entity.components.set(PlayerEscortComponent,
        { player, parent: player, detached: false });
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
    return entity;
}

describe('sumFleetCargo', () => {
    it('is the ship alone when nothing else is in the fleet', () => {
        expect(sumFleetCargo([
            { cargo: new Map([['cargo:0', 4]]), capacity: 15 },
        ])).toEqual({ cargo: new Map([['cargo:0', 4]]), capacity: 15 });
    });

    it('adds tonnages of the same commodity across the fleet and totals the '
        + 'capacities', () => {
            const summed = sumFleetCargo([
                { cargo: new Map([['cargo:0', 15]]), capacity: 15 },
                { cargo: new Map([['cargo:0', 200]]), capacity: 200 },
                { cargo: new Map([['cargo:0', 175]]), capacity: 175 },
            ]);
            // The reference pilot's 390 tons of one commodity on a 15-ton
            // hull (390_medical_supplies.png).
            expect(summed.capacity).toBe(390);
            expect(summed.cargo).toEqual(new Map([['cargo:0', 390]]));
            expect(cargoDisplayOf(summed.cargo, summed.capacity,
                fakeGameData()).free).toBe(0);
        });

    it('keeps the player\'s ship first in the manifest, so the bar\'s line '
        + 'order is stable', () => {
            const summed = sumFleetCargo([
                { cargo: new Map([['cargo:4', 1]]), capacity: 10 },
                { cargo: new Map([['cargo:0', 2], ['cargo:4', 3]]),
                    capacity: 10 },
            ]);
            expect([...summed.cargo]).toEqual([['cargo:4', 4], ['cargo:0', 2]]);
        });

    it('ignores empty and zeroed entries, and members with no hold at all',
        () => {
            expect(sumFleetCargo([
                { capacity: 20 },
                { cargo: new Map([['cargo:0', 0]]), capacity: 30 },
            ])).toEqual({ cargo: new Map(), capacity: 50 });
        });
});

describe('playerEscortEntities', () => {
    it('takes this player\'s escorts out of the world, in uuid order', () => {
        const entities = new Map([
            ['b', escortEntity(FREIGHTER)],
            ['a', escortEntity(WARSHIP)],
            ['c', escortEntity(FREIGHTER, { player: 'someone-else' })],
            ['d', new Entity()],
        ]);
        expect(playerEscortEntities(entities, PLAYER))
            .toEqual([entities.get('a')!, entities.get('b')!]);
    });

    it('finds nothing when the player\'s escorts are in another system — an '
        + 'absent entity simply is not in the map', () => {
            expect(playerEscortEntities(new Map(), PLAYER)).toEqual([]);
        });
});

describe('fleetCargoMembers', () => {
    it('counts only the trader-AI escorts, with their outfits\' capacity',
        () => {
            const members = fleetCargoMembers([
                escortEntity(FREIGHTER, { cargo: [['cargo:0', 40]] }),
                escortEntity(FREIGHTER, { expanders: 2 }),
                escortEntity(WARSHIP, { cargo: [['cargo:0', 5]] }),
            ], fakeGameData());
            expect(members.map(m => m.capacity)).toEqual([100, 150]);
            expect(members[0]?.cargo).toEqual(new Map([['cargo:0', 40]]));
        });

    it('never counts a bay fighter or a mission ship', () => {
        expect(fleetCargoMembers([
            escortEntity(FREIGHTER, { fighter: true }),
            escortEntity(FREIGHTER, { missionShip: true }),
        ], fakeGameData())).toEqual([]);
    });

    it('skips an escort whose ship data has not cached yet rather than '
        + 'reporting its cargo as free space', () => {
            expect(fleetCargoMembers([escortEntity('nova:not-loaded')],
                fakeGameData())).toEqual([]);
        });

    it('skips an escort whose OUTFIT data has not cached yet, for the same '
        + 'reason', () => {
            const escort = escortEntity(FREIGHTER);
            escort.components.set(OutfitsStateComponent,
                new Map([['nova:not-loaded', { count: 1 }]]));
            expect(fleetCargoMembers([escort], fakeGameData())).toEqual([]);
        });
});

describe('the fleet cargo readout end to end', () => {
    const gameData = fakeGameData();

    it('reports the fleet\'s free space in flight: the player\'s 15-ton hull '
        + 'plus the freighters flying with them', () => {
            const entities = new Map([
                ['a', escortEntity(FREIGHTER, { cargo: [['cargo:2', 100]] })],
                ['b', escortEntity(FREIGHTER)],
                // A warship escort adds guns, not tons.
                ['c', escortEntity(WARSHIP)],
            ]);
            const fleet = sumFleetCargo([
                { cargo: new Map([['cargo:2', 15]]), capacity: 15 },
                ...fleetCargoMembers(playerEscortEntities(entities, PLAYER),
                    gameData),
            ]);
            const { free, lines } =
                cargoDisplayOf(fleet.cargo, fleet.capacity, gameData);
            expect(fleet.capacity).toBe(215);
            expect(free).toBe(100);
            expect(lines).toEqual([{ name: 'Med', quantity: 115 }]);
        });

    it('reports the same totals while DOCKED, from the landed roster', () => {
        const roster = [
            { player: PLAYER, entity: escortEntity(FREIGHTER,
                { cargo: [['cargo:2', 100]] }) },
            { player: PLAYER, entity: escortEntity(FREIGHTER) },
            { player: 'someone-else', entity: escortEntity(FREIGHTER,
                { player: 'someone-else', cargo: [['cargo:2', 90]] }) },
        ];
        const fleet = sumFleetCargo([
            { cargo: new Map([['cargo:2', 15]]), capacity: 15 },
            ...fleetCargoMembers(
                roster.filter(({ player }) => player === PLAYER)
                    .map(({ entity }) => entity), gameData),
        ]);
        const { free, lines } =
            cargoDisplayOf(fleet.cargo, fleet.capacity, gameData);
        expect(fleet.capacity).toBe(215);
        expect(free).toBe(100);
        expect(lines).toEqual([{ name: 'Med', quantity: 115 }]);
    });

    it('keeps mission cargo the player\'s own in the "Special:" summary, '
        + 'while its tonnage still counts against the fleet total', () => {
            const entities = new Map([
                ['a', escortEntity(FREIGHTER, { cargo: [['cargo:0', 100]] })],
            ]);
            const fleet = sumFleetCargo([
                { cargo: new Map([['mission:nova:700', 5]]), capacity: 15 },
                ...fleetCargoMembers(playerEscortEntities(entities, PLAYER),
                    gameData),
            ]);
            const { free, lines, special } =
                cargoDisplayOf(fleet.cargo, fleet.capacity, gameData);
            expect(free).toBe(10);
            expect(lines).toEqual([{ name: 'Food', quantity: 100 }]);
            expect(special).toBe('Cargo');
        });
});
