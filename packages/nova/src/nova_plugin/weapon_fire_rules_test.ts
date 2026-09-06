import 'jasmine';
import { getDefaultAnimation, getDefaultExitPoints } from 'novadatainterface/animation';
import { MockGameData } from 'novadatainterface/mock_game_data';
import { getDefaultOutfitData, OutfitData } from 'novadatainterface/outfit_data';
import {
    getDefaultShipData, getDefaultShipPhysics, ShipData,
} from 'novadatainterface/ship_data';
import {
    getDefaultProjectileWeaponData, ProjectileWeaponData, WeaponData,
} from 'novadatainterface/weapon_data';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { Entity } from 'nova_ecs/entity';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { TimeResource, TimeSystem } from 'nova_ecs/plugins/time_plugin';
import { World } from 'nova_ecs/world';
import { CloakActiveComponent } from './cloak_plugin.js';
import { completeEntity } from './entity_data_loader.js';
import {
    defaultWeaponLocalState, OwnerComponent, VulnerableToPD, WeaponsComponent,
} from './fire_weapon_plugin.js';
import { FuelComponent, IonizationComponent } from './health_plugin.js';
import { IsIonizedComponent } from './ionization_plugin.js';
import { makeShip } from './make_ship.js';
import { makeSystem, SIMULATION_STEP_MS } from './make_system.js';
import { ProjectileComponent } from './projectile_data.js';
import { ControlledByComponent } from './ship_control.js';
import { TargetComponent } from './target_component.js';
import {
    effectiveReload, FAST_SHIP_TURN_RATE, intervalElapsed, ORIGINAL_FRAME_MS,
    WeaponsSystem,
} from './weapon_plugin.js';
import { WeaponsStateComponent, WeaponState } from './weapons_state.js';

/**
 * ============================================================================
 * WeaponsSystem firing rules against the EVN Bible's wëap fields
 * ============================================================================
 *
 * Reload cadence (#23): "Reload: the number of frames it takes for one of
 * this weapon to reload. 30 = 1 shot/sec" (~:3072). The original checks a
 * weapon once per 30 fps FRAME, so Reload 0 fires once per frame — not
 * once per 60 Hz simulation tick, which doubled every continuous beam and
 * the Hail Chaingun.
 *
 * Burst (#48, ~:3339-3349): BurstReload "is imposed when the weapon has
 * fired >= BurstCount shots"; BurstCount is multiplied by the mount count
 * for weapons that do not fire simultaneously and "independent of how
 * many of the weapon the ship has" for those that do.
 *
 * Cloak (#152, Flags2 0x4000), ionization (Seeker 0x0020), the AI-only
 * rules (Flags2 0x0100, Flags 0x0008), one-in-flight (Flags3 0x0004),
 * exclusive (Flags3 0x0020) and the fixed side angle (Inaccuracy < 0,
 * #99, #100): see weapon_plugin.ts / fire_weapon_plugin.ts for each
 * ruling and its Bible line.
 */

const SHIP_ID = 'test:ship';
const SHIP_UUID = 'test ship uuid';
const LAUNCHER_ID = 'test:launcher';
const FRAME = ORIGINAL_FRAME_MS;

function weapon(id: string, over: Partial<ProjectileWeaponData> = {}): ProjectileWeaponData {
    return {
        ...getDefaultProjectileWeaponData(),
        id,
        // Reload 0: the fastest a wëap can be. Shots live for the whole
        // spec so counting projectiles counts every shot ever fired.
        reload: 0,
        shotDuration: 1e9,
        fireGroup: 'primary',
        guidance: 'unguided',
        ammoType: 'unlimited',
        exitType: 'gun',
        ...over,
    };
}

interface WorldOptions {
    /** Weapon data -> mount count. */
    weapons: Array<[WeaponData, number]>;
    ship?: Partial<ShipData>;
    /**
     * Ticks to run before handing the world over (default 2). 0 leaves
     * the world's clock untouched, for specs about the very first tick.
     */
    prestep?: number;
}

async function makeTestWorld({ weapons, ship: shipOver = {}, prestep = 2 }:
    WorldOptions) {
    const gameData = new MockGameData();
    const mounts: { [id: string]: number } = {};
    for (const [data, count] of weapons) {
        gameData.data.Weapon.map.set(data.id, data);
        mounts[data.id] = count;
    }
    const launcher: OutfitData = {
        ...getDefaultOutfitData(),
        id: LAUNCHER_ID,
        weapons: mounts,
    };
    gameData.data.Outfit.map.set(LAUNCHER_ID, launcher);

    const shipData: ShipData = {
        ...getDefaultShipData(),
        id: SHIP_ID,
        outfits: { [LAUNCHER_ID]: 1 },
        physics: { ...getDefaultShipPhysics(), armorRecharge: 0 },
        // A gun position on each flank, so the fixed side angle has a
        // side to lean to; compression 100% so the exit points are used
        // as given (getDefaultExitPoints compresses them to nothing).
        animation: {
            ...getDefaultAnimation(),
            exitPoints: {
                ...getDefaultExitPoints(),
                gun: [[10, 0, 0], [-10, 0, 0]],
                upCompress: [100, 100],
                downCompress: [100, 100],
            },
        },
        ...shipOver,
    };
    gameData.data.Ship.map.set(SHIP_ID, shipData);

    const world = await makeSystem('test:system', gameData);
    const ship = makeShip(shipData);
    await completeEntity(world, ship);
    pin(ship);
    world.entities.set(SHIP_UUID, ship);

    await stepWorld(world, prestep);
    return { world, ship, gameData };
}

/** Nova rotation 0 faces -y; makeShip randomizes both, so fix them. */
function pin(entity: Entity, x = 0, y = 0) {
    entity.components.set(MovementStateComponent, {
        position: new Position(x, y),
        velocity: new Vector(0, 0),
        rotation: new Angle(0),
        accelerating: 0,
        turning: 0,
        turnBack: false,
    });
}

async function stepWorld(world: World, steps: number) {
    for (let i = 0; i < steps; i++) {
        world.step();
        await new Promise(resolve => setImmediate(resolve));
    }
}

function setFiring(ship: Entity, id: string, firing: boolean) {
    ship.components.get(WeaponsStateComponent)!.get(id)!.firing = firing;
}

function projectiles(world: World, id?: string): Entity[] {
    const found: Entity[] = [];
    for (const [, entity] of world.entities) {
        const projectile = entity.components.get(ProjectileComponent);
        if (projectile && (id === undefined || projectile.id === id)) {
            found.push(entity);
        }
    }
    return found;
}

describe('intervalElapsed', () => {
    const DELTA = SIMULATION_STEP_MS;

    it('is reached on the tick nearest the interval, not a tick late', () => {
        // Two steps of the accumulated 60 Hz clock against one frame:
        // the rounding-noise case that made a one-frame weapon wait a
        // third tick under a strict comparison.
        let clock = 0;
        clock += DELTA;
        clock += DELTA;
        expect(intervalElapsed(clock, FRAME, DELTA)).toBeTrue();
        expect(intervalElapsed(DELTA, FRAME, DELTA)).toBeFalse();
        expect(intervalElapsed(0, FRAME, DELTA)).toBeFalse();
    });

    it('agrees with the plain comparison for whole-tick intervals', () => {
        for (let ticks = 1; ticks <= 40; ticks++) {
            const interval = ticks * DELTA;
            expect(intervalElapsed((ticks - 1) * DELTA, interval, DELTA))
                .withContext(`${ticks - 1} of ${ticks} ticks`).toBeFalse();
            expect(intervalElapsed(ticks * DELTA, interval, DELTA))
                .withContext(`${ticks} of ${ticks} ticks`).toBeTrue();
        }
    });

    it('rounds a fractional-tick interval to the nearest tick, halves down', () => {
        // Only a plug-in reaches this (a per-mount reload share that is
        // not a whole number of ticks, e.g. Reload 5 on four mounts =
        // 2.5 ticks); see the intervalElapsed doc. The plain comparison
        // would wait for tick 3 in all three cases below.
        expect(intervalElapsed(2 * DELTA, 2.25 * DELTA, DELTA)).toBeTrue();
        expect(intervalElapsed(2 * DELTA, 2.5 * DELTA, DELTA)).toBeTrue();
        expect(intervalElapsed(2 * DELTA, 2.75 * DELTA, DELTA)).toBeFalse();
        expect(intervalElapsed(3 * DELTA, 2.75 * DELTA, DELTA)).toBeTrue();
        // Never before the tick below the interval.
        expect(intervalElapsed(1 * DELTA, 2.25 * DELTA, DELTA)).toBeFalse();
    });
});

describe('effectiveReload', () => {
    const local = () => defaultWeaponLocalState();
    const state = (count: number): WeaponState => ({ count, firing: true });

    it('floors a Reload of 0 at one original frame', () => {
        expect(effectiveReload(weapon('w', { reload: 0 }), local(), state(1)))
            .toEqual({ reloadTime: FRAME, reloadingBurst: false });
    });

    it('shares the reload across mounts, then floors it', () => {
        // Reload 2 frames on 4 mounts is half a frame per shot: still
        // at most one shot per frame.
        expect(effectiveReload(weapon('w', { reload: 2 * FRAME }), local(), state(4))
            .reloadTime).toEqual(FRAME);
        expect(effectiveReload(weapon('w', { reload: 8 * FRAME }), local(), state(4))
            .reloadTime).toBeCloseTo(2 * FRAME, 9);
    });

    it('does not share a simultaneous weapon\'s reload across mounts', () => {
        expect(effectiveReload(weapon('w', { reload: 8 * FRAME, fireSimultaneously: true }),
            local(), state(4)).reloadTime).toBeCloseTo(8 * FRAME, 9);
    });

    it('imposes the burst reload at >= BurstCount shots, not after', () => {
        const w = weapon('w', { burstCount: 4, burstReload: 1000 });
        const l = local();
        for (let shots = 0; shots < 4; shots++) {
            l.burstCount = shots;
            expect(effectiveReload(w, l, state(1)).reloadingBurst)
                .withContext(`${shots} shots fired`).toBeFalse();
        }
        l.burstCount = 4;
        expect(effectiveReload(w, l, state(1)))
            .toEqual({ reloadTime: 1000, reloadingBurst: true });
    });

    it('multiplies BurstCount by the mount count when not simultaneous', () => {
        const w = weapon('w', { burstCount: 4, burstReload: 1000 });
        const l = local();
        l.burstCount = 4;
        expect(effectiveReload(w, l, state(3)).reloadingBurst).toBeFalse();
        l.burstCount = 12;
        expect(effectiveReload(w, l, state(3)).reloadingBurst).toBeTrue();
    });

    it('counts volleys, independent of mounts, when simultaneous', () => {
        const w = weapon('w', { burstCount: 3, burstReload: 1000, fireSimultaneously: true });
        const l = local();
        l.burstCount = 3;
        expect(effectiveReload(w, l, state(2)).reloadingBurst).toBeTrue();
    });

    it('never enters a burst reload with BurstCount 0 (unused)', () => {
        const w = weapon('w', { burstCount: 0, burstReload: 1000 });
        expect(effectiveReload(w, local(), state(1)).reloadingBurst).toBeFalse();
    });

    it('floors a zero BurstReload at one frame too', () => {
        // Stock Ion Cannon: BurstCount 60, BurstReload 0.
        const w = weapon('w', { burstCount: 60, burstReload: 0 });
        const l = local();
        l.burstCount = 60;
        expect(effectiveReload(w, l, state(1)).reloadTime).toEqual(FRAME);
    });
});

describe('WeaponsSystem reload cadence (#23)', () => {
    it('fires a Reload-0 weapon once per original frame, not per sim tick',
        async () => {
            const { world, ship } = await makeTestWorld({
                weapons: [[weapon('test:fast', { reload: 0 }), 1]],
            });
            setFiring(ship, 'test:fast', true);
            await stepWorld(world, 60);
            // 60 ticks at 60 Hz is one second: 30 frames, 30 shots.
            expect(projectiles(world).length).toEqual(30);
        });

    it('fires a Reload-1 weapon at exactly 30 per second', async () => {
        const { world, ship } = await makeTestWorld({
            weapons: [[weapon('test:one', { reload: FRAME }), 1]],
        });
        setFiring(ship, 'test:one', true);
        await stepWorld(world, 120);
        expect(projectiles(world).length).toEqual(60);
    });

    it('fires a Reload-3 weapon every sixth tick', async () => {
        const { world, ship } = await makeTestWorld({
            weapons: [[weapon('test:three', { reload: 3 * FRAME }), 1]],
        });
        setFiring(ship, 'test:three', true);
        await stepWorld(world, 60);
        expect(projectiles(world).length).toEqual(10);
    });
});

describe('WeaponsSystem burst cycles (#48)', () => {
    it('fires exactly BurstCount shots before the burst reload', async () => {
        const { world, ship } = await makeTestWorld({
            weapons: [[weapon('test:burst', { burstCount: 4, burstReload: 1000 }), 1]],
        });
        setFiring(ship, 'test:burst', true);
        await stepWorld(world, 20);
        expect(projectiles(world).length).toEqual(4);
        // ...and resumes once the burst reload has run (1000 ms = 60
        // ticks after the fourth shot on tick 7).
        await stepWorld(world, 60);
        expect(projectiles(world).length).toBeGreaterThan(4);
    });

    it('multiplies BurstCount by the mount count for a non-simultaneous weapon',
        async () => {
            const { world, ship } = await makeTestWorld({
                weapons: [[weapon('test:burst2', { burstCount: 4, burstReload: 1000 }), 2]],
            });
            setFiring(ship, 'test:burst2', true);
            await stepWorld(world, 30);
            expect(projectiles(world).length).toEqual(8);
        });

    it('counts volleys, not shots, for a simultaneous weapon', async () => {
        const { world, ship } = await makeTestWorld({
            weapons: [[weapon('test:volley', {
                burstCount: 3, burstReload: 1000, fireSimultaneously: true,
            }), 2]],
        });
        setFiring(ship, 'test:volley', true);
        await stepWorld(world, 30);
        // Three volleys of two.
        expect(projectiles(world).length).toEqual(6);
    });

    it('charges ammo once per burst with oneAmmoPerBurst, for exactly one burst',
        async () => {
            // The extra shot used to be a FREE shot for these weapons.
            const { world, ship } = await makeTestWorld({
                weapons: [[weapon('test:burstammo', {
                    burstCount: 3, burstReload: 1e9, oneAmmoPerBurst: true,
                    ammoType: ['energy', 10],
                }), 1]],
            });
            setFiring(ship, 'test:burstammo', true);
            await stepWorld(world, 30);
            expect(projectiles(world).length).toEqual(3);
        });
});

/**
 * Maintainer ruling #152, tested in the original game: a weapon that
 * cannot fire while cloaked REFUSES to fire and does NOT decloak the
 * ship. (PR #133 had an unflagged trigger fire and drop the cloak; that
 * reading is gone.) Point defense is refused the same way; a weapon
 * flagged fire-while-cloaked fires and keeps the cloak.
 */
describe('firing while cloaked (#152, wëap Flags2 0x4000)', () => {
    async function cloakedWorld(weaponData: ProjectileWeaponData,
        ship: Partial<ShipData> = {}) {
        const made = await makeTestWorld({ weapons: [[weaponData, 1]], ship });
        made.ship.components.set(CloakActiveComponent, { active: true });
        return made;
    }

    it('an ordinary weapon is refused: nothing fires and the cloak holds',
        async () => {
            const { world, ship } = await cloakedWorld(weapon('test:gun'));
            setFiring(ship, 'test:gun', true);
            await stepWorld(world, 5);
            expect(projectiles(world).length).toEqual(0);
            expect(ship.components.get(CloakActiveComponent)!.active).toBeTrue();
        });

    it('a refused shot spends nothing, and the trigger is honoured the '
        + 'moment the cloak drops', async () => {
            // The stock hull trickle-recharges fuel (ShipFuelProvider
            // re-derives the rate every step); a hull with none, so the
            // tank reads the shot's cost and nothing else.
            const { world, ship } = await cloakedWorld(
                weapon('test:gun', { ammoType: ['energy', 10] }), {
                    physics: {
                        ...getDefaultShipPhysics(), armorRecharge: 0,
                        energyRecharge: 0, autoRefuel: false,
                    },
                });
            const fuel = ship.components.get(FuelComponent)!;
            fuel.current = 100;
            setFiring(ship, 'test:gun', true);
            await stepWorld(world, 5);
            expect(projectiles(world).length).toEqual(0);
            expect(fuel.current).toEqual(100);
            // No reload clock was started by the refusal: the first tick
            // out of the cloak fires.
            ship.components.get(CloakActiveComponent)!.active = false;
            await stepWorld(world, 1);
            expect(projectiles(world).length).toEqual(1);
            expect(fuel.current).toEqual(90);
        });

    it('a weapon that can be fired while cloaked keeps the cloak', async () => {
        const { world, ship } = await cloakedWorld(
            weapon('test:torp', { fireWhileCloaked: true }));
        setFiring(ship, 'test:torp', true);
        await stepWorld(world, 5);
        expect(projectiles(world).length).toEqual(3);
        expect(ship.components.get(CloakActiveComponent)!.active).toBeTrue();
    });

    describe('point defense', () => {
        function pointDefense(over: Partial<ProjectileWeaponData> = {}) {
            return weapon('test:pd', {
                guidance: 'pointDefense', fireGroup: 'pointDefense', ...over,
            });
        }

        /** An incoming missile aimed at the ship, in range of its PD. */
        function addIncoming(world: World) {
            const incoming = new Entity()
                .addComponent(VulnerableToPD, undefined)
                .addComponent(OwnerComponent, { owner: 'enemy' })
                .addComponent(TargetComponent, { target: SHIP_UUID });
            pin(incoming, 0, -100);
            world.entities.set('incoming', incoming);
        }

        it('fires on its own when the ship is not cloaked', async () => {
            const { world } = await makeTestWorld({ weapons: [[pointDefense(), 1]] });
            addIncoming(world);
            await stepWorld(world, 5);
            expect(projectiles(world).length).toBeGreaterThan(0);
        });

        it('is refused while cloaked rather than blowing the cloak', async () => {
            const { world, ship } = await cloakedWorld(pointDefense());
            addIncoming(world);
            await stepWorld(world, 5);
            expect(projectiles(world).length).toEqual(0);
            expect(ship.components.get(CloakActiveComponent)!.active).toBeTrue();
        });

        it('fires while cloaked when the weapon allows it', async () => {
            const { world, ship } = await cloakedWorld(
                pointDefense({ fireWhileCloaked: true }));
            addIncoming(world);
            await stepWorld(world, 5);
            expect(projectiles(world).length).toBeGreaterThan(0);
            expect(ship.components.get(CloakActiveComponent)!.active).toBeTrue();
        });
    });
});

describe("can't fire if ship is ionized (wëap Seeker 0x0020)", () => {
    function ionize(ship: Entity) {
        const ionization = ship.components.get(IonizationComponent)!;
        ionization.current = ionization.max;
    }

    it('holds the weapon while the ship is fully ionized', async () => {
        const { world, ship } = await makeTestWorld({
            weapons: [[weapon('test:ion', { cantFireWhileIonized: true }), 1]],
        });
        ionize(ship);
        await stepWorld(world, 1);
        expect(ship.components.get(IsIonizedComponent)).toBeTrue();
        setFiring(ship, 'test:ion', true);
        await stepWorld(world, 5);
        expect(projectiles(world).length).toEqual(0);
    });

    it('fires as normal without the flag', async () => {
        const { world, ship } = await makeTestWorld({
            weapons: [[weapon('test:noion'), 1]],
        });
        ionize(ship);
        await stepWorld(world, 1);
        setFiring(ship, 'test:noion', true);
        await stepWorld(world, 5);
        expect(projectiles(world).length).toEqual(3);
    });
});

describe("AI ships won't use this weapon (wëap Flags2 0x0100)", () => {
    it('an AI ship (no controlling peer) never fires it', async () => {
        const { world, ship } = await makeTestWorld({
            weapons: [[weapon('test:noai', { npcCantUse: true }), 1]],
        });
        setFiring(ship, 'test:noai', true);
        await stepWorld(world, 5);
        expect(projectiles(world).length).toEqual(0);
    });

    it('a player-controlled ship fires it', async () => {
        const { world, ship } = await makeTestWorld({
            weapons: [[weapon('test:noai', { npcCantUse: true }), 1]],
        });
        ship.components.set(ControlledByComponent, { peerId: 'peer' });
        setFiring(ship, 'test:noai', true);
        await stepWorld(world, 5);
        expect(projectiles(world).length).toEqual(3);
    });
});

describe("don't fire guided weapons at fast ships (wëap Flags 0x0008)", () => {
    const TARGET_UUID = 'fast target';

    async function withTarget(turnRate: number, over: Partial<ProjectileWeaponData> = {}) {
        const made = await makeTestWorld({
            weapons: [[weapon('test:missile', {
                guidance: 'guided', dontFireAtFastShips: true, ...over,
            }), 1]],
        });
        const targetData: ShipData = {
            ...getDefaultShipData(),
            id: 'test:target',
            physics: { ...getDefaultShipPhysics(), turnRate },
        };
        made.gameData.data.Ship.map.set(targetData.id, targetData);
        const target = makeShip(targetData);
        await completeEntity(made.world, target);
        pin(target, 0, -300);
        made.world.entities.set(TARGET_UUID, target);
        made.ship.components.set(TargetComponent, { target: TARGET_UUID });
        await stepWorld(made.world, 2);
        return made;
    }

    it('an AI ship holds fire at a target turning faster than 30', async () => {
        const { world, ship } = await withTarget(FAST_SHIP_TURN_RATE * 1.5);
        setFiring(ship, 'test:missile', true);
        await stepWorld(world, 5);
        expect(projectiles(world).length).toEqual(0);
    });

    it('an AI ship fires at a slower target', async () => {
        const { world, ship } = await withTarget(FAST_SHIP_TURN_RATE * 0.5);
        setFiring(ship, 'test:missile', true);
        await stepWorld(world, 5);
        expect(projectiles(world).length).toEqual(3);
    });

    it('is an AI rule: a player fires at anything', async () => {
        const { world, ship } = await withTarget(FAST_SHIP_TURN_RATE * 1.5);
        ship.components.set(ControlledByComponent, { peerId: 'peer' });
        setFiring(ship, 'test:missile', true);
        await stepWorld(world, 5);
        expect(projectiles(world).length).toEqual(3);
    });

    it('only applies to guided weapons', async () => {
        const { world, ship } = await withTarget(FAST_SHIP_TURN_RATE * 1.5,
            { guidance: 'unguided' });
        setFiring(ship, 'test:missile', true);
        await stepWorld(world, 5);
        expect(projectiles(world).length).toEqual(3);
    });
});

describe("can't fire until the previous shot expires (wëap Flags3 0x0004)", () => {
    // Shots that live 10 frames (20 ticks); the reload alone would allow
    // a shot every 2 ticks.
    const LIFE = 10 * FRAME;

    async function countShots(over: Partial<ProjectileWeaponData>) {
        const { world, ship } = await makeTestWorld({
            weapons: [[weapon('test:single', { shotDuration: LIFE, ...over }), 1]],
        });
        setFiring(ship, 'test:single', true);
        const seen = new Set<string>();
        for (let i = 0; i < 60; i++) {
            await stepWorld(world, 1);
            for (const shot of projectiles(world)) {
                seen.add(shot.uuid);
            }
        }
        return seen.size;
    }

    it('fires one shot at a time', async () => {
        // 60 ticks with a shot alive for 20 of them each: three shots,
        // or four if the expiry tick lines up.
        const shots = await countShots({ cantFireUntilShotExpires: true });
        expect(shots).toBeGreaterThanOrEqual(3);
        expect(shots).toBeLessThanOrEqual(4);
    });

    it('streams shots at the reload rate without the flag', async () => {
        expect(await countShots({})).toEqual(30);
    });

    it('records the last shot in the weapon\'s local state', async () => {
        const { world, ship } = await makeTestWorld({
            weapons: [[weapon('test:single'), 1]],
        });
        setFiring(ship, 'test:single', true);
        await stepWorld(world, 1);
        const [shot] = projectiles(world);
        expect(ship.components.get(WeaponsComponent)!.get('test:single').lastShot)
            .toEqual(shot.uuid);
    });
});

describe('exclusive weapon (wëap Flags3 0x0020)', () => {
    const RELOAD = 12 * FRAME;

    async function pair() {
        const made = await makeTestWorld({
            weapons: [
                // Iterated first (insertion order), so it locks the
                // other out on the very tick it fires.
                [weapon('test:exclusive', { exclusive: true, reload: RELOAD }), 1],
                [weapon('test:other'), 1],
            ],
        });
        // A fresh weapon's lastFired of 0 makes it serve one full reload
        // from world creation before its first shot (pre-existing, not
        // this spec's subject); run that off so the clock below starts
        // with both weapons ready.
        await stepWorld(made.world, 30);
        return made;
    }

    it('silences the other weapons while it is reloading', async () => {
        const { world, ship } = await pair();
        setFiring(ship, 'test:exclusive', true);
        setFiring(ship, 'test:other', true);
        // Two exclusive shots (ticks 1 and 25); the other weapon, which
        // could fire every second tick, never gets a word in.
        await stepWorld(world, 30);
        expect(projectiles(world, 'test:exclusive').length).toEqual(2);
        expect(projectiles(world, 'test:other').length).toEqual(0);
    });

    it('lets the others fire again once its reload has run', async () => {
        const { world, ship } = await pair();
        setFiring(ship, 'test:exclusive', true);
        setFiring(ship, 'test:other', true);
        await stepWorld(world, 1);
        expect(projectiles(world, 'test:exclusive').length).toEqual(1);
        setFiring(ship, 'test:exclusive', false);
        // The lock holds for the exclusive weapon's 24-tick reload...
        await stepWorld(world, 20);
        expect(projectiles(world, 'test:other').length).toEqual(0);
        // ...and lifts when it could fire again.
        await stepWorld(world, 20);
        expect(projectiles(world, 'test:other').length).toBeGreaterThan(0);
    });

    it('does not lock anything before it has ever fired', async () => {
        const { world, ship } = await pair();
        setFiring(ship, 'test:other', true);
        await stepWorld(world, 5);
        expect(projectiles(world, 'test:other').length).toEqual(3);
    });

    // isExclusiveLocking reads a lastFired of 0 as "never fired". That
    // is only sound if no shot can ever be stamped at time 0, which the
    // three assertions below pin: the simulation clock is past 0 by the
    // time any weapon is consulted, so the sentinel is unambiguous.
    describe('the never-fired sentinel (lastFired 0)', () => {
        it('cannot collide with a real shot: the clock is past 0 on tick 1', async () => {
            const { world } = await makeTestWorld({
                weapons: [[weapon('test:other'), 1]], prestep: 0,
            });
            const time = world.resources.get(TimeResource)!;
            expect(time.time).toEqual(0);
            await stepWorld(world, 1);
            expect(time.time).toEqual(SIMULATION_STEP_MS);
            expect(time.time).toBeGreaterThan(0);
        });

        it('is read after TimeSystem has advanced the clock', () => {
            expect(WeaponsSystem.after).toContain(TimeSystem);
        });

        it('locks from a weapon\'s very first shot in a fresh world', async () => {
            const { world, ship } = await makeTestWorld({
                weapons: [
                    [weapon('test:exclusive', { exclusive: true }), 1],
                    [weapon('test:other'), 1],
                ],
                prestep: 0,
            });
            setFiring(ship, 'test:exclusive', true);
            setFiring(ship, 'test:other', true);
            // A fresh weapon serves one full (floored) reload from world
            // creation, so the earliest shot in any world is tick 2 —
            // and it stamps the smallest lastFired a weapon can hold.
            await stepWorld(world, 2);
            expect(projectiles(world, 'test:exclusive').length).toEqual(1);
            const local = ship.components.get(WeaponsComponent)!
                .get('test:exclusive');
            expect(local.lastFired).toEqual(2 * SIMULATION_STEP_MS);
            expect(local.lastFired).toBeGreaterThan(0);
            // The lock holds from that first shot: the other weapon,
            // ready every second tick, never fires.
            await stepWorld(world, 8);
            expect(projectiles(world, 'test:exclusive').length).toEqual(5);
            expect(projectiles(world, 'test:other').length).toEqual(0);
        });
    });
});

describe('fixed side angle (wëap Inaccuracy < 0, #99)', () => {
    it('fires to the side its exit point is on, by exactly the angle', async () => {
        const { world, ship } = await makeTestWorld({
            weapons: [[weapon('test:side', { accuracy: 90, firesAtFixedAngle: true }), 1]],
        });
        setFiring(ship, 'test:side', true);
        await stepWorld(world, 3);
        // The exit cursor advances before each shot, so shot 1 leaves
        // the port gun (x = -10) and shot 2 the starboard one (x = +10).
        const [first, second] = projectiles(world)
            .sort((a, b) => a.uuid.localeCompare(b.uuid));
        expect(first.components.get(MovementStateComponent)!.rotation.angle)
            .toBeCloseTo(-Math.PI / 2, 9);
        expect(second.components.get(MovementStateComponent)!.rotation.angle)
            .toBeCloseTo(Math.PI / 2, 9);
    });

    it('goes to starboard from an exit on the ship\'s axis', async () => {
        const { world, ship } = await makeTestWorld({
            weapons: [[weapon('test:sidec', {
                accuracy: 30, firesAtFixedAngle: true, exitType: 'center',
            }), 1]],
        });
        setFiring(ship, 'test:sidec', true);
        await stepWorld(world, 1);
        const [shot] = projectiles(world);
        expect(shot.components.get(MovementStateComponent)!.rotation.angle)
            .toBeCloseTo(Math.PI / 6, 9);
    });

    it('is a spread, not a fixed angle, for a positive Inaccuracy', async () => {
        const { world, ship } = await makeTestWorld({
            weapons: [[weapon('test:spread', { accuracy: 90 }), 1]],
        });
        setFiring(ship, 'test:spread', true);
        await stepWorld(world, 20);
        const angles = projectiles(world).map(
            shot => shot.components.get(MovementStateComponent)!.rotation.angle);
        // Ten random draws in (-90°, 90°) do not all land on the two
        // fixed angles.
        expect(angles.every(a => Math.abs(Math.abs(a) - Math.PI / 2) < 1e-9))
            .toBeFalse();
        expect(angles.every(a => Math.abs(a) <= Math.PI / 2 + 1e-9)).toBeTrue();
    });
});
