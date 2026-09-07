import 'jasmine';
import { Entity } from 'nova_ecs/entity';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { MovementState, MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { PlanetComponent } from './nova_plugin/travel/index.js';
import { ShipComponent } from './nova_plugin/ship/index.js';
import { pickNearest } from './tap_targeting.js';

function makeMovement(x: number, y: number): MovementState {
    return {
        position: new Position(x, y),
        velocity: new Vector(0, 0),
        rotation: new Angle(0),
        turning: 0,
        turnBack: false,
        accelerating: 0,
        turnTo: null,
    };
}

function planetAt(x: number, y: number): Entity {
    return new Entity()
        .addComponent(MovementStateComponent, makeMovement(x, y))
        .addComponent(PlanetComponent, { id: 'test:planet' });
}

function shipAt(x: number, y: number): Entity {
    return new Entity()
        .addComponent(MovementStateComponent, makeMovement(x, y))
        .addComponent(ShipComponent, { id: 'test:ship' });
}

describe('pickNearest', () => {
    it('selects a planet within the pick radius', () => {
        const entities: [string, Entity][] = [['planet', planetAt(100, 100)]];
        const { bestPlanet } = pickNearest(entities, undefined, 130, 100);
        expect(bestPlanet?.uuid).toEqual('planet');
    });

    it('hit-tests against the toroidal-nearest copy across the seam', () => {
        // The planet sits at the -x edge; the tap lands just short of the +x
        // edge. Literal distance is nearly a whole world, but across the seam
        // they are 50 units apart — the tap must still select it.
        const entities: [string, Entity][] = [['worm', planetAt(-10000, 0)]];
        const { bestPlanet } = pickNearest(entities, undefined, 9950, 0);
        expect(bestPlanet?.uuid).toEqual('worm');
    });

    it('wraps ship hit-testing the same way', () => {
        const entities: [string, Entity][] = [['ship', shipAt(0, -10000)]];
        const { bestShip } = pickNearest(entities, undefined, 0, 9980);
        expect(bestShip?.uuid).toEqual('ship');
    });

    it('still misses objects genuinely out of range', () => {
        const entities: [string, Entity][] = [['planet', planetAt(-10000, 0)]];
        const { bestPlanet } = pickNearest(entities, undefined, 9000, 0);
        expect(bestPlanet).toBeUndefined();
    });
});

describe('installTapTargeting: taps on UI do not fall through', () => {
    /** A view that records listeners so a tap can be replayed by hand. */
    function fakeView() {
        const listeners = new Map<string, ((e: any) => void)[]>();
        const view = {
            addEventListener: (type: string, fn: (e: any) => void) => {
                listeners.set(type, [...(listeners.get(type) ?? []), fn]);
            },
        } as unknown as HTMLElement;
        const fire = (type: string, e: object) =>
            (listeners.get(type) ?? []).forEach(fn => fn(e));
        const tap = (clientX: number, clientY: number) => {
            fire('pointerdown', { pointerId: 1, clientX, clientY });
            fire('pointerup', { pointerId: 1, clientX, clientY });
        };
        return { view, tap };
    }

    async function harness(isBlocked: (x: number, y: number) => boolean) {
        const { World } = await import('nova_ecs/world');
        const PIXI = await import('pixi.js');
        const { Space } = await import('./display/space_resource.js');
        const { installTapTargeting } = await import('./tap_targeting.js');
        const world = new World('tap');
        world.resources.set(Space, new PIXI.Container());
        world.entities.set('planet', planetAt(100, 100));
        const landed: string[] = [];
        const { view, tap } = fakeView();
        installTapTargeting(view, {
            getWorld: () => world,
            getMyPeerId: () => undefined,
            targetShip: () => { },
            navigateToPlanet: uuid => landed.push(uuid),
            isBlocked,
        });
        return { tap, landed };
    }

    it('lands on the planet under a tap on bare space', async () => {
        const { tap, landed } = await harness(() => false);
        tap(100, 100);
        expect(landed).toEqual(['planet']);
    });

    it('ignores the tap when it landed on UI (open map, dialog, status '
        + 'bar) even with a planet drawn underneath', async () => {
        const { tap, landed } = await harness(() => true);
        tap(100, 100);
        expect(landed).toEqual([]);
    });
});
