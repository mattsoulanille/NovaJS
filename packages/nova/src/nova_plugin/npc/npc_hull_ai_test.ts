import 'jasmine';
import { decodeCloakModVal } from 'novadatainterface/cloak_data';
import { getDefaultGovtData } from 'novadatainterface/govt_data';
import { MockGameData } from 'novadatainterface/mock_game_data';
import { getDefaultOutfitData, OutfitData } from 'novadatainterface/outfit_data';
import { getDefaultPlanetData } from 'novadatainterface/planet_data';
import {
    getDefaultShipAICloakFlags, getDefaultShipAIFlags, getDefaultShipData,
    ShipAIFlags, ShipData,
} from 'novadatainterface/ship_data';
import { getDefaultSystemData } from 'novadatainterface/system_data';
import {
    getDefaultProjectileWeaponData, WeaponData,
} from 'novadatainterface/weapon_data';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import {
    restoreWorld, snapshotWorld, SnapshotPoliciesResource,
} from 'nova_ecs/plugins/snapshot_plugin';
import { TimeResource } from 'nova_ecs/plugins/time_plugin';
import { hashWorld } from 'nova_ecs/plugins/world_hash';
import { World } from 'nova_ecs/world';
import { deriveEntityComponents, GovtComponent } from '../core/index.js';
import { makeSystem } from '../make_system.js';
import {
    ArmorComponent, CloakActiveComponent, makeShip, OutfitsStateComponent,
    ShieldComponent, TargetComponent,
} from '../ship/index.js';
import { completeEntity } from '../spawn/index.js';
import { AI_AFTERBURNER_FACTOR, npcAfterburning } from './npc_afterburner.js';
import {
    cloakSustainable, NPC_CLOAK_RESUME_FRACTION, NPC_CLOAK_REVEAL_AFTER_STAY_MS,
    npcCloaksWhileFlying,
} from './npc_cloak.js';
import { NpcComponent, NpcState } from './npc_component.js';
import { outOfAmmo } from './npc_out_of_ammo.js';

/**
 * ============================================================================
 * Hull AI flags against the reference: docs/reference_experiments.md
 * "W1 / C1 / H1 wave 15: first passes". Disc hulls, one flag each:
 *  - Flags2 0x0080 with ONLY a 5-round missile: attacked about 20 s, then
 *    left and was never seen again (npc_out_of_ammo.ts);
 *  - Flags 0x0040, no afterburner outfit: strafing runs at 1.6x the
 *    control's top speed, never over it while hanging close
 *    (npc_afterburner.ts);
 *  - Flags2 0x0800 trader with the stock Wraith Cloaking Device: seen only
 *    pulling away from the port; hostile 0x0800 + 0x1000 warships VISIBLE
 *    while attacking (npc_cloak.ts).
 * ============================================================================
 */

const US = 'test:us';
const THEM = 'test:them';
const SYSTEM = 'test:system';
const PORT = 'test:port';
const PORT_2 = 'test:port-2';
const GUN = 'test:gun';
const GUN_OUTFIT = 'test:gun-outfit';
const MISSILE = 'test:missile';
const MISSILE_OUTFIT = 'test:missile-launcher';
const MISSILES = 'test:missiles';
const FUEL_GUN = 'test:fuel-gun';
const FUEL_GUN_OUTFIT = 'test:fuel-gun-outfit';
const CLOAK = 'test:cloak';
const DRAINING_CLOAK = 'test:draining-cloak';

const MISSILE_ONLY = 'test:missile-only';
const MISSILE_ONLY_NO_FLAG = 'test:missile-only-no-flag';
const GUN_AND_MISSILE = 'test:gun-and-missile';
const BURNER = 'test:burner';
const CONTROL = 'test:control';
const CLOAKER = 'test:cloaker';
const CLOAKER_NO_DEVICE = 'test:cloaker-no-device';
const TARGET_HULL = 'test:target';

const SPEED = 100;

function hull(id: string, flags: Partial<ShipAIFlags>,
    outfits: Record<string, number>, over: Partial<ShipData> = {}): ShipData {
    const base = getDefaultShipData();
    return {
        ...base, id, name: id, outfits, strength: 100,
        physics: {
            ...base.physics, speed: SPEED, acceleration: 100, turnRate: 6,
        },
        aiFlags: { ...getDefaultShipAIFlags(), ...flags },
        ...over,
    };
}

function weapon(id: string, over: Partial<WeaponData> = {}): WeaponData {
    const data = getDefaultProjectileWeaponData();
    return {
        ...data, id, name: id, reload: 2000, shotDuration: 3000,
        damage: { ...data.damage, armor: 1, shield: 1 },
        physics: { ...data.physics, speed: 400 },
        ...over,
    } as WeaponData;
}

function outfit(id: string, over: Partial<OutfitData>): OutfitData {
    return { ...getDefaultOutfitData(), id, name: id, ...over };
}

const flyingAround = {
    cloak: { ...getDefaultShipAICloakFlags(), whenFlyingAround: true },
};

async function hullWorld() {
    const gameData = new MockGameData();
    gameData.data.Weapon.map.set(GUN, weapon(GUN));
    gameData.data.Weapon.map.set(MISSILE, weapon(MISSILE,
        { ammoType: ['weapon', MISSILE] }));
    gameData.data.Weapon.map.set(FUEL_GUN, weapon(FUEL_GUN,
        { ammoType: ['energy', 1] }));
    gameData.data.Outfit.map.set(GUN_OUTFIT,
        outfit(GUN_OUTFIT, { weapons: { [GUN]: 1 } }));
    gameData.data.Outfit.map.set(MISSILE_OUTFIT,
        outfit(MISSILE_OUTFIT, { weapons: { [MISSILE]: 1 } }));
    gameData.data.Outfit.map.set(MISSILES,
        outfit(MISSILES, { ammoFor: MISSILE }));
    gameData.data.Outfit.map.set(FUEL_GUN_OUTFIT,
        outfit(FUEL_GUN_OUTFIT, { weapons: { [FUEL_GUN]: 1 } }));
    // The stock Wraith Cloaking Device's ModVal (oütf 266): 0x0002, no
    // drain. And one that drains 8 shield a second.
    gameData.data.Outfit.map.set(CLOAK,
        outfit(CLOAK, { cloak: decodeCloakModVal(0x0002) }));
    gameData.data.Outfit.map.set(DRAINING_CLOAK,
        outfit(DRAINING_CLOAK, { cloak: decodeCloakModVal(0x0800) }));

    const ships: ShipData[] = [
        hull(MISSILE_ONLY, { runsAwayWhenOutOfAmmo: true },
            { [MISSILE_OUTFIT]: 1, [MISSILES]: 5 }),
        hull(MISSILE_ONLY_NO_FLAG, {}, { [MISSILE_OUTFIT]: 1, [MISSILES]: 5 }),
        hull(GUN_AND_MISSILE, { runsAwayWhenOutOfAmmo: true },
            { [GUN_OUTFIT]: 1, [MISSILE_OUTFIT]: 1, [MISSILES]: 5 }),
        hull(BURNER, { alwaysHasAfterburner: true }, { [GUN_OUTFIT]: 1 }),
        hull(CONTROL, {}, { [GUN_OUTFIT]: 1 }),
        hull(CLOAKER, flyingAround, { [CLOAK]: 1 }),
        hull(CLOAKER_NO_DEVICE, flyingAround, {}),
        hull(TARGET_HULL, {}, {}, {
            physics: {
                ...getDefaultShipData().physics, speed: 0, acceleration: 0,
                armor: 1e9, shield: 1e9,
            },
        }),
    ];
    for (const ship of ships) {
        gameData.data.Ship.map.set(ship.id, ship);
    }
    gameData.data.Govt.map.set(US, {
        ...getDefaultGovtData(), id: US, classes: [1], enemies: [2],
        maxOdds: 1000,
    });
    gameData.data.Govt.map.set(THEM, {
        ...getDefaultGovtData(), id: THEM, classes: [2], enemies: [1],
        maxOdds: 1000,
    });
    for (const [id, x] of [[PORT, -1500], [PORT_2, 1500]] as const) {
        gameData.data.Planet.map.set(id, {
            ...getDefaultPlanetData(), id, name: id, position: [x, 0],
        });
    }
    gameData.data.System.map.set(SYSTEM, {
        ...getDefaultSystemData(), id: SYSTEM, planets: [PORT, PORT_2],
    });
    const world = await makeSystem(SYSTEM, gameData, undefined,
        { npcs: false });

    async function addShip(uuid: string, hullId: string, x: number, y: number,
        govt: string, npc?: Partial<NpcState> & { aiType: number }) {
        const ship = makeShip(gameData.data.Ship.map.get(hullId)!);
        ship.components.set(MovementStateComponent, {
            accelerating: 0, position: new Position(x, y),
            rotation: new Angle(0), turnBack: false, turning: 0,
            velocity: new Vector(0, 0),
        });
        ship.components.set(GovtComponent, { id: govt });
        if (npc) {
            ship.components.set(NpcComponent, {
                departAt: Number.MAX_SAFE_INTEGER, ...npc,
            });
        }
        await completeEntity(world, ship);
        world.entities.set(uuid, ship);
        return ship;
    }
    return { world, gameData, addShip };
}

function now(world: World) {
    return world.resources.get(TimeResource)!.time;
}

function npcOf(world: World, uuid: string) {
    return world.entities.get(uuid)?.components.get(NpcComponent);
}

function runFor(world: World, seconds: number, each: () => void = () => { }) {
    const end = now(world) + seconds * 1000;
    while (now(world) < end) {
        world.step();
        each();
    }
}

function speedOf(world: World, uuid: string) {
    return world.entities.get(uuid)?.components.get(MovementStateComponent)
        ?.velocity.length ?? 0;
}

describe('hull AI flags (reference W1 / C1 wave 15)', () => {
    describe('out of ammo (shïp Flags2 0x0080)', () => {
        const weapons = (data: Record<string, WeaponData>) =>
            (id: string) => data[id];
        const outfits = (data: Record<string, OutfitData>) =>
            (id: string) => data[id];
        const missile = weapon(MISSILE, { ammoType: ['weapon', MISSILE] });
        const gun = weapon(GUN);
        const fuelGun = weapon(FUEL_GUN, { ammoType: ['energy', 1] });
        const ammo = { [MISSILES]: outfit(MISSILES, { ammoFor: MISSILE }) };
        const state = (count: number) => ({ count, firing: false });

        it('is every mounted weapon drawing from an empty magazine', () => {
            const ws = new Map([[MISSILE, state(1)]]);
            expect(outOfAmmo(ws, new Map([[MISSILES, { count: 0 }]]),
                weapons({ [MISSILE]: missile }), outfits(ammo))).toBeTrue();
            expect(outOfAmmo(ws, new Map(),
                weapons({ [MISSILE]: missile }), outfits(ammo))).toBeTrue();
            expect(outOfAmmo(ws, new Map([[MISSILES, { count: 1 }]]),
                weapons({ [MISSILE]: missile }), outfits(ammo))).toBeFalse();
        });

        it('is not when anything else is mounted: a gun, a fuel weapon',
            () => {
                const dry = new Map([[MISSILES, { count: 0 }]]);
                const all = weapons({
                    [MISSILE]: missile, [GUN]: gun, [FUEL_GUN]: fuelGun,
                });
                expect(outOfAmmo(new Map([[MISSILE, state(1)], [GUN, state(1)]]),
                    dry, all, outfits(ammo))).toBeFalse();
                expect(outOfAmmo(new Map([[MISSILE, state(1)],
                    [FUEL_GUN, state(1)]]), dry, all, outfits(ammo)))
                    .toBeFalse();
            });

        it('is not for an unarmed ship, or a weapon not staged', () => {
            expect(outOfAmmo(new Map(), new Map(), weapons({}), outfits({})))
                .toBeFalse();
            expect(outOfAmmo(new Map([[MISSILE, state(0)]]), new Map(),
                weapons({ [MISSILE]: missile }), outfits(ammo))).toBeFalse();
            expect(outOfAmmo(new Map([[MISSILE, state(1)]]), new Map(),
                weapons({}), outfits(ammo))).toBeFalse();
        });

        it('a missile-only 0x0080 warship fires its rounds at an enemy, '
            + 'then leaves (W1)', async () => {
                const { world, addShip } = await hullWorld();
                await addShip('enemy', TARGET_HULL, 600, 0, THEM);
                const ship = await addShip('raider', MISSILE_ONLY, 0, 0, US,
                    { aiType: 3 });
                let attacked = false;
                let departedAt: number | undefined;
                let dryAt: number | undefined;
                runFor(world, 40, () => {
                    const npc = npcOf(world, 'raider');
                    attacked ||= npc?.mode === 'attack';
                    const left = ship.components.get(OutfitsStateComponent)!
                        .get(MISSILES)?.count ?? 0;
                    if (left === 0 && dryAt === undefined) {
                        dryAt = now(world);
                    }
                    if ((npc?.mode === 'depart' || !world.entities.has('raider'))
                        && departedAt === undefined) {
                        departedAt = now(world);
                    }
                });
                expect(attacked).toBeTrue();
                expect(dryAt).toBeDefined();
                expect(departedAt).toBeDefined();
                // On its next think after the last round (1 s interval).
                expect(departedAt! - dryAt!).toBeLessThanOrEqual(1100);
                expect(departedAt! - dryAt!).toBeGreaterThanOrEqual(0);
            });

        it('stays with a gun aboard, or without the flag', async () => {
            const { world, addShip } = await hullWorld();
            await addShip('enemy', TARGET_HULL, 600, 0, THEM);
            const gunner = await addShip('gunner', GUN_AND_MISSILE, 0, 0, US,
                { aiType: 3 });
            const unflagged = await addShip('unflagged', MISSILE_ONLY_NO_FLAG,
                0, 50, US, { aiType: 3 });
            const modes = new Set<string | undefined>();
            runFor(world, 30, () => {
                modes.add(npcOf(world, 'gunner')?.mode);
                modes.add(npcOf(world, 'unflagged')?.mode);
            });
            expect(gunner.components.get(OutfitsStateComponent)!
                .get(MISSILES)?.count ?? 0).toBe(0);
            expect(unflagged.components.get(OutfitsStateComponent)!
                .get(MISSILES)?.count ?? 0).toBe(0);
            expect(modes.has('attack')).toBeTrue();
            expect(modes.has('depart')).toBeFalse();
        });
    });

    describe('AI afterburner (shïp Flags 0x0040)', () => {
        const flag = { alwaysHasAfterburner: true };

        it('burns only while attacking and thrusting', () => {
            expect(npcAfterburning({ aiType: 3, mode: 'attack' }, flag, 1,
                false)).toBeTrue();
            expect(npcAfterburning({ aiType: 3, mode: 'attack' }, flag, 0,
                false)).toBeFalse();
            for (const mode of ['travel', 'patrol', 'flee', 'depart'] as const) {
                expect(npcAfterburning({ aiType: 3, mode }, flag, 1, false))
                    .withContext(mode).toBeFalse();
            }
            expect(npcAfterburning({ aiType: 3, mode: 'attack' },
                { alwaysHasAfterburner: false }, 1, false)).toBeFalse();
            // A commanded escort, a gövt 0x0010 stand-off: no.
            expect(npcAfterburning({ aiType: 3, mode: 'attack' }, flag, 1,
                true)).toBeFalse();
            expect(npcAfterburning({ aiType: 3, mode: 'attack',
                retreatSince: 0 }, flag, 1, false)).toBeFalse();
        });

        it('runs at 1.6x the control hull\'s top speed on an attack run '
            + '(W1)', async () => {
                const { world, addShip } = await hullWorld();
                await addShip('enemy', TARGET_HULL, 0, 3000, THEM);
                await addShip('burner', BURNER, -100, 0, US, { aiType: 3 });
                await addShip('control', CONTROL, 100, 0, US, { aiType: 3 });
                let burner = 0;
                let control = 0;
                let burnerAttacked = false;
                runFor(world, 12, () => {
                    burner = Math.max(burner, speedOf(world, 'burner'));
                    control = Math.max(control, speedOf(world, 'control'));
                    burnerAttacked ||= npcOf(world, 'burner')?.mode === 'attack';
                });
                expect(burnerAttacked).toBeTrue();
                expect(control).toBeCloseTo(SPEED, 0);
                expect(burner).toBeCloseTo(SPEED * AI_AFTERBURNER_FACTOR, 0);
            });

        it('does not burn when it is not fighting', async () => {
            const { world, addShip } = await hullWorld();
            await addShip('burner', BURNER, 0, 0, US, { aiType: 3 });
            let top = 0;
            runFor(world, 20, () => {
                top = Math.max(top, speedOf(world, 'burner'));
            });
            expect(npcOf(world, 'burner')?.mode).toBe('patrol');
            expect(top).toBeLessThanOrEqual(SPEED + 1e-6);
        });
    });

    describe('NPC cloaking (shïp Flags2 0x0800)', () => {
        const trader = (over: Partial<NpcState>): NpcState =>
            ({ aiType: 1, ...over });

        it('a trader is cloaked travelling, parked and departing; visible '
            + 'just after a stay', () => {
                expect(npcCloaksWhileFlying(trader({ mode: 'travel' }), 0))
                    .toBeTrue();
                expect(npcCloaksWhileFlying(
                    trader({ mode: 'dwell', until: 5000 }), 1000)).toBeTrue();
                const after = trader({ mode: 'travel', until: 5000 });
                expect(npcCloaksWhileFlying(after, 5000)).toBeFalse();
                expect(npcCloaksWhileFlying(after,
                    5000 + NPC_CLOAK_REVEAL_AFTER_STAY_MS - 1)).toBeFalse();
                expect(npcCloaksWhileFlying(after,
                    5000 + NPC_CLOAK_REVEAL_AFTER_STAY_MS)).toBeTrue();
                expect(npcCloaksWhileFlying(trader({ mode: 'depart' }), 0))
                    .toBeTrue();
            });

        it('never fighting, fleeing or under attack; never a warship', () => {
            for (const mode of ['flee', 'attack', 'mine'] as const) {
                expect(npcCloaksWhileFlying(trader({ mode }), 0))
                    .withContext(mode).toBeFalse();
            }
            expect(npcCloaksWhileFlying(
                trader({ mode: 'travel', aggressor: 'x' }), 0)).toBeFalse();
            expect(npcCloaksWhileFlying(
                trader({ mode: undefined }), 0)).toBeFalse();
            expect(npcCloaksWhileFlying({ aiType: 3, mode: 'patrol' }, 0))
                .toBeFalse();
            expect(npcCloaksWhileFlying({ aiType: 4, mode: 'patrol' }, 0))
                .toBeFalse();
        });

        it('engages a draining cloak only with the resource well up', () => {
            const draining = { ...decodeCloakModVal(0x0800), canCloak: true };
            const free = { ...decodeCloakModVal(0x0002), canCloak: true };
            const stat = (fraction: number) =>
                ({ current: fraction * 100, max: 100 });
            expect(cloakSustainable(free, undefined, undefined)).toBeTrue();
            expect(cloakSustainable(draining,
                stat(NPC_CLOAK_RESUME_FRACTION + 0.01), undefined)).toBeTrue();
            expect(cloakSustainable(draining,
                stat(NPC_CLOAK_RESUME_FRACTION), undefined)).toBeFalse();
        });

        it('a trader flies cloaked, shows as it leaves a stellar, and is '
            + 'never cloaked without a device (C1)', async () => {
                const { world, addShip } = await hullWorld();
                await addShip('cloaker', CLOAKER, -1200, 0, US, { aiType: 1 });
                await addShip('plain', CLOAKER_NO_DEVICE, -1200, 50, US,
                    { aiType: 1 });
                const seen = new Map<string, boolean>();
                let revealedAfterStay = false;
                let cloakedTravelling = false;
                let plainCloaked = false;
                runFor(world, 60, () => {
                    const ship = world.entities.get('cloaker')!;
                    const npc = ship.components.get(NpcComponent)!;
                    const cloaked = ship.components.get(CloakActiveComponent)
                        ?.active === true;
                    seen.set(`${npc.mode}:${cloaked}`, true);
                    if (npc.mode === 'travel' && npc.until === undefined) {
                        cloakedTravelling ||= cloaked;
                    }
                    if (npc.mode === 'travel' && npc.until !== undefined
                        && now(world) < npc.until + 1000) {
                        revealedAfterStay ||= !cloaked;
                    }
                    plainCloaked ||= world.entities.get('plain')!.components
                        .get(CloakActiveComponent)?.active === true;
                });
                expect(cloakedTravelling).toBeTrue();
                expect(seen.get('dwell:true')).toBeTrue();
                expect(seen.get('dwell:false')).toBeUndefined();
                expect(revealedAfterStay).toBeTrue();
                expect(plainCloaked).toBeFalse();
            });

        it('a cloaking trader drops its cloak to run when attacked',
            async () => {
                const { world, addShip } = await hullWorld();
                await addShip('cloaker', CLOAKER, -1200, 0, US, { aiType: 1 });
                runFor(world, 3);
                const ship = world.entities.get('cloaker')!;
                expect(ship.components.get(CloakActiveComponent)?.active)
                    .toBeTrue();
                await addShip('raider', CONTROL, -1000, 0, THEM);
                ship.components.get(NpcComponent)!.aggressor = 'raider';
                runFor(world, 2);
                expect(ship.components.get(NpcComponent)!.mode).toBe('flee');
                expect(ship.components.get(CloakActiveComponent)?.active)
                    .toBeFalse();
            });

        it('a hostile 0x0800 warship attacks uncloaked (C1)', async () => {
            const { world, addShip } = await hullWorld();
            await addShip('enemy', TARGET_HULL, 400, 0, THEM);
            const ship = await addShip('wraith', CLOAKER, 0, 0, US,
                { aiType: 3 });
            let attacked = false;
            let cloaked = false;
            runFor(world, 10, () => {
                attacked ||= npcOf(world, 'wraith')?.mode === 'attack';
                cloaked ||= ship.components.get(CloakActiveComponent)?.active
                    === true;
            });
            expect(attacked).toBeTrue();
            expect(cloaked).toBeFalse();
        });
    });

    it('replays identically after a rollback', async () => {
        const { world, addShip } = await hullWorld();
        await addShip('enemy', TARGET_HULL, 900, 0, THEM);
        await addShip('raider', MISSILE_ONLY, 0, 0, US, { aiType: 3 });
        await addShip('burner', BURNER, -300, 200, US, { aiType: 3 });
        await addShip('cloaker', CLOAKER, -1200, 0, US, { aiType: 1 });
        world.step();
        const before = snapshotWorld(world);
        const record = () => {
            const hashes: string[] = [];
            for (let i = 0; i < 1800; i++) {
                world.step();
                hashes.push(hashWorld(world).hash);
            }
            return {
                hashes,
                raider: npcOf(world, 'raider')?.mode ?? 'gone',
                cloaked: world.entities.get('cloaker')?.components
                    .get(CloakActiveComponent)?.active,
                shield: world.entities.get('enemy')?.components
                    .get(ShieldComponent)?.current,
                armor: world.entities.get('enemy')?.components
                    .get(ArmorComponent)?.current,
                target: world.entities.get('burner')?.components
                    .get(TargetComponent)?.target,
            };
        };
        const first = record();
        restoreWorld(world, before, deriveEntityComponents);
        expect(record()).toEqual(first);
        const policies = world.resources.get(SnapshotPoliciesResource)!;
        expect([...policies.unhandled]).toEqual([]);
    });
});
