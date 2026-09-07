import 'jasmine';
import * as PIXI from 'pixi.js';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { Entity } from 'nova_ecs/entity';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { TimeResource } from 'nova_ecs/plugins/time_plugin';
import { World } from 'nova_ecs/world';
import { getDefaultCloakData } from 'novadatainterface/cloak_data';
import { getDefaultCloakScannerData } from 'novadatainterface/cloak_scanner_data';
import { SimulationGameDataInterface } from '../client/gamedata/simulation_game_data.js';
import {
    CloakActiveComponent, IsIonizedComponent, OutfitsStateComponent, ShipComponent,
    WeaponsStateComponent,
} from '../nova_plugin/ship/index.js';
import { SimulationGameDataResource } from '../nova_plugin/core/index.js';
import { PlayerShipSelector } from '../nova_plugin/player/index.js';
import { AnimationGraphic } from './animation_graphic.js';
import { AnimationGraphicComponent } from './animation_graphic_plugin.js';
import { CloakDisplayPlugin } from './cloak_display_plugin.js';
import { ShipAnimationSystem } from './ship_animation_plugin.js';
import { MurkFadeSystem, MurkResource } from './system_environment_plugin.js';

/**
 * A ship graphic's CONTAINER alpha has two contributors — the system's
 * murk (MurkFadeSystem, by distance from the player) and the ship's own
 * cloak (ShipAnimationSystem) — and they have to COMPOSE. They used to
 * take turns assigning it, ShipAnimationSystem last, so in a murky
 * system (sÿst Murk > 0: "each space object fades into the background
 * colour with distance", EVN Bible) planets, asteroids and shots faded
 * but ships never did: no tactical concealment from exactly the objects
 * that matter.
 *
 * Headless: only PIXI.Container is touched, no renderer.
 */

/** A plug-in cloak scanner with the on-screen reveal bit (ModVal 0x0002). */
const SCANNER = 'plugin:scanner';

const gameData = {
    data: {
        Outfit: {
            getCached: (id: string) => id === SCANNER ? {
                cloak: getDefaultCloakData(),
                cloakScanner: {
                    ...getDefaultCloakScannerData(),
                    isCloakScanner: true,
                    revealsOnScreen: true,
                    rawModVal: 0x0002,
                },
            } : undefined,
        },
        Weapon: { getCached: () => undefined },
    },
} as unknown as SimulationGameDataInterface;

/** The pieces of an AnimationGraphic the two systems touch. */
function fakeGraphic(): AnimationGraphic {
    return {
        container: new PIXI.Container(),
        sprites: new Map(),
        cloakAlpha: 1,
        weaponFlashAlpha: 0,
        weaponFireSeen: false,
    } as unknown as AnimationGraphic;
}

function movement(x: number, y: number) {
    return {
        position: new Position(x, y),
        velocity: new Vector(0, 0),
        rotation: new Angle(0),
        accelerating: 0,
        turning: 0,
        turnBack: false,
    };
}

async function alphaWorld({ murk, withMurkSystem = true, murkSystemFirst = false }: {
    murk: number, withMurkSystem?: boolean, murkSystemFirst?: boolean,
}) {
    const world = new World('ship alpha test');
    world.resources.set(TimeResource,
        { time: 1000, delta_ms: 16, delta_s: 0.016 } as never);
    world.resources.set(SimulationGameDataResource, gameData);
    world.resources.set(MurkResource, { systemMurk: murk, murkReduction: 0 });
    // The display derives the player's scanner from their synced outfits.
    await world.addPlugin(CloakDisplayPlugin);
    // Insertion order is the topological sort's tiebreak, so a world that
    // adds MurkFadeSystem FIRST (production order: SystemEnvironmentPlugin
    // precedes ShipAnimationPlugin in Display) only composes last because
    // of MurkFadeSystem's `after: [ShipAnimationSystem]` edge.
    if (withMurkSystem && murkSystemFirst) {
        world.addSystem(MurkFadeSystem);
    }
    world.addSystem(ShipAnimationSystem);
    if (withMurkSystem && !murkSystemFirst) {
        world.addSystem(MurkFadeSystem);
    }

    const player = new Entity('player');
    player.components.set(PlayerShipSelector, undefined);
    player.components.set(MovementStateComponent, movement(0, 0) as never);
    player.components.set(OutfitsStateComponent, new Map());
    world.entities.set('player', player);

    /** A ship `distance` px from the player, with its own graphic. */
    const addShip = (uuid: string, distance: number, cloaked = false) => {
        const graphic = fakeGraphic();
        const ship = new Entity(uuid);
        ship.components.set(ShipComponent, { id: 'nova:128' });
        ship.components.set(WeaponsStateComponent, new Map() as never);
        ship.components.set(IsIonizedComponent, false);
        ship.components.set(AnimationGraphicComponent, graphic);
        ship.components.set(MovementStateComponent,
            movement(distance, 0) as never);
        if (cloaked) {
            ship.components.set(CloakActiveComponent, { active: true });
        }
        world.entities.set(uuid, ship);
        return graphic;
    };
    return { world, player, addShip };
}

// At murk 100 objects vanish at 120 px and are clear to 60 px, so 100 px
// out is 1/3 visible (see murkAlpha).
const MURK_ALPHA_AT_100 = 1 / 3;

describe('ship alpha: murk composed with cloak', () => {
    it('fades an uncloaked ship into the murk with distance', async () => {
        // THE BUG: this read 1 — ShipAnimationSystem's UNCLOAKED_ALPHA
        // overwrote the murk fade every frame.
        const { world, addShip } = await alphaWorld({ murk: 100 });
        const graphic = addShip('ship', 100);
        world.step();
        expect(graphic.container.alpha).toBeCloseTo(MURK_ALPHA_AT_100, 6);
        expect(graphic.cloakAlpha).toEqual(1);
    });

    it('leaves a nearby ship fully visible', async () => {
        const { world, addShip } = await alphaWorld({ murk: 100 });
        const graphic = addShip('ship', 30);
        world.step();
        expect(graphic.container.alpha).toEqual(1);
    });

    it('keeps a cloaked ship invisible in the murk', async () => {
        const { world, addShip } = await alphaWorld({ murk: 100 });
        const graphic = addShip('ship', 100, true);
        world.step();
        expect(graphic.cloakAlpha).toEqual(0);
        expect(graphic.container.alpha).toEqual(0);
    });

    it('multiplies a scanner reveal by the murk', async () => {
        const { world, player, addShip } = await alphaWorld({ murk: 100 });
        player.components.set(OutfitsStateComponent,
            new Map([[SCANNER, { count: 1 }]]));
        const graphic = addShip('ship', 100, true);
        world.step();
        expect(graphic.container.alpha)
            .toBeCloseTo(0.4 * MURK_ALPHA_AT_100, 6);
    });

    it('composes last by its `after` edge, not by insertion order', async () => {
        // Production adds SystemEnvironmentPlugin before ShipAnimationPlugin
        // (display_plugin.ts), so without MurkFadeSystem's
        // `after: [ShipAnimationSystem]` the cloak write (1.0 for an
        // uncloaked ship) would land after the murk fade and erase it.
        const { world, addShip } =
            await alphaWorld({ murk: 100, murkSystemFirst: true });
        const graphic = addShip('ship', 100);
        world.step();
        expect(graphic.container.alpha).toBeCloseTo(MURK_ALPHA_AT_100, 6);
    });

    it('is stable across frames (no compounding)', async () => {
        const { world, addShip } = await alphaWorld({ murk: 100 });
        const graphic = addShip('ship', 100);
        for (let i = 0; i < 5; i++) {
            world.step();
        }
        expect(graphic.container.alpha).toBeCloseTo(MURK_ALPHA_AT_100, 6);
    });
});

describe('ship alpha without a murk system', () => {
    // A world with no SystemEnvironmentPlugin at all: the cloak still
    // has to reach the container, and must not compound frame to frame.
    it('applies the cloak alone, stably', async () => {
        const { world, addShip } =
            await alphaWorld({ murk: 0, withMurkSystem: false });
        const clear = addShip('clear', 100);
        const cloaked = addShip('cloaked', 100, true);
        for (let i = 0; i < 5; i++) {
            world.step();
        }
        expect(clear.container.alpha).toEqual(1);
        expect(cloaked.container.alpha).toEqual(0);
    });
});

/**
 * The cloak scanner's on-screen reveal (oütf ModType 30, ModVal 0x0002):
 * a cloaked ship shows as a faint ghost (0.4) to a player carrying one.
 * ShipAnimationSystem's query reads CloakScannerComponent, which the
 * sim never sends, so until CloakDisplayPlugin derived it here the
 * query was always empty and the reveal unreachable.
 */
describe('cloak scanner on-screen reveal', () => {
    it('ghosts a cloaked ship for a scanner-equipped player', async () => {
        const { world, player, addShip } = await alphaWorld({ murk: 0 });
        player.components.set(OutfitsStateComponent,
            new Map([[SCANNER, { count: 1 }]]));
        const graphic = addShip('ship', 100, true);
        world.step();
        expect(graphic.container.alpha).toBeCloseTo(0.4, 6);
    });

    it('hides a cloaked ship from a player without one', async () => {
        const { world, addShip } = await alphaWorld({ murk: 0 });
        const graphic = addShip('ship', 100, true);
        world.step();
        expect(graphic.container.alpha).toEqual(0);
    });
});
