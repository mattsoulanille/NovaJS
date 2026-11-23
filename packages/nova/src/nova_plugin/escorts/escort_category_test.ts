import 'jasmine';
import { MockGameData } from 'novadatainterface/mock_game_data';
import { getDefaultShipData, ShipData } from 'novadatainterface/ship_data';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { World } from 'nova_ecs/world';
import { makeSystem } from '../make_system.js';
import { FormationComponent } from '../npc/index.js';
import {
    applyControlEvents, ControlledByComponent, ESCORT_CATEGORY_SELECTORS,
    EscortCategory, escortCategoryOf, EscortCommandComponent,
} from '../player/index.js';
import { makeShip, TargetComponent } from '../ship/index.js';
import { completeEntity } from '../spawn/index.js';
import { BayFighterComponent } from './bay_plugin.js';

const PEER = 'category peer';

/** One escort per category, plus an EscortType -1 hull. */
const HULLS: Record<string, Partial<ShipData>> = {
    'test:player': { escortType: 2 },
    'test:fighter': { escortType: 0 },
    'test:medium': { escortType: 1 },
    'test:warship': { escortType: 2 },
    'test:freighter': { escortType: 3 },
    'test:unknownTrader': { escortType: -1, inherentAI: 1 },
};

async function makeWorld() {
    const gameData = new MockGameData();
    for (const [id, fields] of Object.entries(HULLS)) {
        gameData.data.Ship.map.set(id,
            { ...getDefaultShipData(), id, outfits: {}, ...fields });
        await gameData.data.Ship.get(id);
    }
    const world = await makeSystem('test:system', gameData);
    async function addShip(uuid: string, shipId: string, x: number,
        setup: (ship: ReturnType<typeof makeShip>) => void = () => { }) {
        const ship = makeShip(gameData.data.Ship.map.get(shipId)!);
        ship.components.set(MovementStateComponent, {
            accelerating: 0,
            position: new Position(x, 200),
            rotation: new Angle(Math.PI / 2),
            turnBack: false,
            turning: 0,
            velocity: new Vector(0, 0),
        });
        setup(ship);
        await completeEntity(world, ship);
        world.entities.set(uuid, ship);
    }
    await addShip('player', 'test:player', 0, ship => {
        ship.components.set(ControlledByComponent, { peerId: PEER });
    });
    const escorts = ['fighter', 'medium', 'warship', 'freighter',
        'unknownTrader'];
    for (const [i, name] of escorts.entries()) {
        await addShip(name, `test:${name}`, 100 * (i + 1), ship => {
            ship.components.set(FormationComponent,
                { leader: 'player', slot: i });
            ship.components.set(EscortCommandComponent,
                { command: 'formation' });
        });
    }
    world.step();
    return { world, addShip, escorts };
}

/** One input record: `events` applied together, then a tick. */
function record(world: World,
    events: Array<{ action: string, state: false | 'start' }>) {
    applyControlEvents(world, PEER, events.map(e =>
        ({ action: e.action as never, state: e.state })));
    world.step();
}

function order(world: World, action: string, category?: EscortCategory) {
    const events: Array<{ action: string, state: false | 'start' }> = [];
    if (category) {
        events.push(
            { action: ESCORT_CATEGORY_SELECTORS[category], state: 'start' });
    }
    events.push({ action, state: 'start' });
    record(world, events);
    record(world, [{ action, state: false }]);
}

function commandOf(world: World, uuid: string) {
    return world.entities.get(uuid)!.components.get(EscortCommandComponent)!;
}

describe('escortCategoryOf', () => {
    const ship = (escortType: number, inherentAI = 3) =>
        ({ escortType, inherentAI });

    it('takes shïp EscortType 0-3 as Fighter/Medium/Warship/Freighter', () => {
        expect(escortCategoryOf(ship(0), false)).toBe('fighter');
        expect(escortCategoryOf(ship(1), false)).toBe('medium');
        expect(escortCategoryOf(ship(2), false)).toBe('warship');
        expect(escortCategoryOf(ship(3), false)).toBe('freighter');
        // An explicit type wins over everything the -1 guess looks at.
        expect(escortCategoryOf(ship(2, 1), true)).toBe('warship');
    });

    it('works EscortType -1 out at runtime: bay-launched -> Fighter, ' +
        'wimpy trader AI -> Freighter, warship AI -> Warship, else Medium',
        () => {
            expect(escortCategoryOf(ship(-1, 3), true)).toBe('fighter');
            expect(escortCategoryOf(ship(-1, 1), false)).toBe('freighter');
            expect(escortCategoryOf(ship(-1, 3), false)).toBe('warship');
            expect(escortCategoryOf(ship(-1, 2), false)).toBe('medium');
            expect(escortCategoryOf(ship(-1, 4), false)).toBe('medium');
            // Out-of-range values and a missing hull are treated like -1.
            expect(escortCategoryOf(ship(7, 4), false)).toBe('medium');
            expect(escortCategoryOf(undefined, true)).toBe('fighter');
            expect(escortCategoryOf(undefined, false)).toBe('medium');
        });
});

describe('per-category escort orders', () => {
    it('an order with no category selector reaches every category',
        async () => {
            const { world, escorts } = await makeWorld();
            order(world, 'holdPosition');
            for (const uuid of escorts) {
                expect(commandOf(world, uuid).command).toBe('holdPosition');
            }
        });

    it('a selector in the same record narrows the order to that category',
        async () => {
            const { world } = await makeWorld();
            order(world, 'holdPosition', 'fighter');
            expect(commandOf(world, 'fighter').command).toBe('holdPosition');
            for (const uuid of ['medium', 'warship', 'freighter',
                'unknownTrader']) {
                expect(commandOf(world, uuid).command).toBe('formation');
            }
            // EscortType -1 with the wimpy-trader AI counts as a Freighter.
            order(world, 'defend', 'freighter');
            expect(commandOf(world, 'freighter').command).toBe('defend');
            expect(commandOf(world, 'unknownTrader').command).toBe('defend');
            expect(commandOf(world, 'warship').command).toBe('formation');
            expect(commandOf(world, 'fighter').command).toBe('holdPosition');
        });

    it('a selector left held from an earlier record does not narrow a ' +
        'later plain order', async () => {
            const { world, escorts } = await makeWorld();
            // The selector's 'start' decays to held and is never released.
            order(world, 'holdPosition', 'medium');
            expect(commandOf(world, 'medium').command).toBe('holdPosition');
            expect(commandOf(world, 'warship').command).toBe('formation');
            order(world, 'defend');
            for (const uuid of escorts) {
                expect(commandOf(world, uuid).command).toBe('defend');
            }
        });

    it('a bay-launched EscortType -1 hull is a Fighter', async () => {
        const { world, addShip } = await makeWorld();
        await addShip('bayFighter', 'test:unknownTrader', 700, ship => {
            ship.components.set(FormationComponent,
                { leader: 'player', slot: 9 });
            ship.components.set(EscortCommandComponent,
                { command: 'formation' });
            ship.components.set(BayFighterComponent,
                { bayWeaponId: 'test:bay' });
        });
        world.step();
        order(world, 'holdPosition', 'fighter');
        expect(commandOf(world, 'bayFighter').command).toBe('holdPosition');
        expect(commandOf(world, 'unknownTrader').command).toBe('formation');
    });

    it('only the ordering player\'s escorts take the order', async () => {
        const { world, addShip } = await makeWorld();
        await addShip('rival', 'test:player', -500, ship => {
            ship.components.set(ControlledByComponent, { peerId: 'rival' });
        });
        await addShip('rivalFighter', 'test:fighter', -600, ship => {
            ship.components.set(FormationComponent,
                { leader: 'rival', slot: 0 });
            ship.components.set(EscortCommandComponent,
                { command: 'formation' });
        });
        world.step();
        order(world, 'holdPosition', 'fighter');
        expect(commandOf(world, 'fighter').command).toBe('holdPosition');
        expect(commandOf(world, 'rivalFighter').command).toBe('formation');
    });

    it('attack with no target still sets Attack; the escort keeps ' +
        'station and keeps the order', async () => {
            const { world } = await makeWorld();
            world.entities.get('player')!.components
                .set(TargetComponent, { target: undefined });
            order(world, 'attack', 'warship');
            expect(commandOf(world, 'warship')).toEqual({ command: 'attack' });
            // The player flies off; the escort follows in formation.
            const player = world.entities.get('player')!.components
                .get(MovementStateComponent)!;
            player.velocity = new Vector(300, 0);
            const start = world.entities.get('warship')!.components
                .get(MovementStateComponent)!.position;
            for (let i = 0; i < 60; i++) {
                world.step();
            }
            expect(commandOf(world, 'warship')).toEqual({ command: 'attack' });
            const now = world.entities.get('warship')!.components
                .get(MovementStateComponent)!.position;
            // Station-keeping after the player (a holding escort would not
            // have moved at all).
            expect(now.x - start.x).toBeGreaterThan(10);
        });
});
