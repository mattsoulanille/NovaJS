import 'jasmine';
import { MockGameData } from 'novadatainterface/mock_game_data';
import { getDefaultOutfitData, OutfitData } from 'novadatainterface/outfit_data';
import { getDefaultShipData, getDefaultShipPhysics, ShipData } from 'novadatainterface/ship_data';
import { BayWeaponData, getDefaultBayWeaponData } from 'novadatainterface/weapon_data';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { Entity } from 'nova_ecs/entity';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { RandomResource } from 'nova_ecs/plugins/random_plugin';
import { System } from 'nova_ecs/system';
import { SingletonComponent, World } from 'nova_ecs/world';
import { getIntegrationGameData } from '../../communication/simulation_test_fixture.js';
import { SoundEvent } from '../core/index.js';
import { EscortCommandComponent, NO_DEAL } from '../player/index.js';
import { FormationComponent, NpcComponent, RCS_ACCEL_FRACTION } from '../npc/index.js';
import {
    applyRefundFighter, bayExitKick, BayFighterComponent, BAY_LAUNCH_BRAKE,
    BAY_LAUNCH_COAST_MIN_ACCEL, BAY_LAUNCH_COAST_S, BAY_LAUNCH_FAST_BRAKE,
    FighterDockedEvent, startReturnHome,
} from './bay_plugin.js';
import { CollisionEvent, CollisionVulnerabilityComponent } from '../core/index.js';
import { MockCommunicator } from 'nova_ecs/plugins/mock_communicator';
import { CommunicatorResource } from 'nova_ecs/plugins/multiplayer_plugin';
import { SerializerResource } from 'nova_ecs/plugins/serializer_plugin';
import { wrapRollbackMessage } from '../../communication/rollback_protocol.js';
import { SimulationBridgeClient } from '../../communication/simulation_bridge_client.js';
import { SimulationBridgeHost } from '../../communication/simulation_bridge_host.js';
import {
    ControlledByComponent, PlayerEscortComponent, PlayerShipSelector,
} from '../player/index.js';
import { completeEntity } from '../spawn/index.js';
import { OwnerComponent, SourceComponent } from '../combat/index.js';
import { makeShip, ShipPhysicsComponent } from '../ship/index.js';
import { makeSystem, SIMULATION_STEP_MS } from '../make_system.js';
import { OutfitsStateComponent } from '../ship/index.js';
import { canSellOutfit } from '../../spaceport/outfitter_rules.js';
import { WeaponsStateComponent } from '../ship/index.js';

const CARRIER_ID = 'test:carrier';
const FIGHTER_SHIP_ID = 'test:fighterShip';
const BAY_ID = 'test:bay';
/** The bay's wëap Speed 400 (the stock Viper Bay) as a shot speed, px/s. */
const BAY_SHOT_SPEED = 400 * 3 / 10;
const BAY_OUTFIT_ID = 'test:bayOutfit';
// Two fighter outfits supplying the SAME bay, so the lowest-sorted-id
// consume/refund policy is observable. 'A' sorts before 'B'.
const FIGHTER_A_ID = 'test:fighterA';
const FIGHTER_B_ID = 'test:fighterB';
const CARRIER_UUID = 'test carrier uuid';

/**
 * A system holding one carrier with a single bay. `fighterCounts` is the
 * preinstalled fighter load (the outfits a bay spends as ammo).
 */
async function makeTestWorld({ fighterCounts = { [FIGHTER_A_ID]: 2 },
    maxAmmo = 4, bays = 1, sound }: {
        fighterCounts?: { [id: string]: number },
        maxAmmo?: number,
        bays?: number,
        /** The bay's wëap snd, as the stock bays carry one. */
        sound?: string,
    } = {}) {
    const gameData = new MockGameData();

    const bay: BayWeaponData = {
        ...getDefaultBayWeaponData(),
        id: BAY_ID,
        shipID: FIGHTER_SHIP_ID,
        sound,
        // What the parser now produces for a bay: its ammo is its
        // fighters, held by outfits whose ammoFor is the bay itself.
        ammoType: ['weapon', BAY_ID],
        maxAmmo,
        fireGroup: 'secondary',
        shotSpeed: BAY_SHOT_SPEED,
        // The shortest reload there is: WeaponsSystem floors it at one
        // original 30 fps frame, so a held trigger launches every SECOND
        // 60 Hz step (see launchOne).
        reload: 1,
    };
    gameData.data.Weapon.map.set(BAY_ID, bay);

    gameData.data.Outfit.map.set(BAY_OUTFIT_ID, {
        ...getDefaultOutfitData(),
        id: BAY_OUTFIT_ID,
        weapons: { [BAY_ID]: 1 },
    });
    for (const id of [FIGHTER_A_ID, FIGHTER_B_ID]) {
        gameData.data.Outfit.map.set(id, {
            ...getDefaultOutfitData(),
            id,
            ammoFor: BAY_ID,
        });
    }

    // The launched fighter's ship data.
    gameData.data.Ship.map.set(FIGHTER_SHIP_ID, {
        ...getDefaultShipData(),
        id: FIGHTER_SHIP_ID,
    });

    const carrierData: ShipData = {
        ...getDefaultShipData(),
        id: CARRIER_ID,
        outfits: { [BAY_OUTFIT_ID]: bays, ...fighterCounts },
        physics: { ...getDefaultShipPhysics() },
    };
    gameData.data.Ship.map.set(CARRIER_ID, carrierData);

    // npcs: false — a controlled battlefield, so the only entities that
    // appear are the carrier and what its bay launches.
    const world = await makeSystem('test:system', gameData, undefined,
        { npcs: false });
    const carrier = makeShip(carrierData);
    // A known position and a real velocity, so an inherited launch
    // velocity is distinguishable from a dead stop.
    carrier.components.set(MovementStateComponent, {
        accelerating: 0,
        position: new Position(0, 0),
        rotation: new Angle(0),
        turnBack: false,
        turning: 0,
        velocity: new Vector(120, -45),
    });
    await completeEntity(world, carrier);
    world.entities.set(CARRIER_UUID, carrier);

    // Let the provide systems attach weapon state, outfits, etc.
    await stepWorld(world, 2);

    return { world, carrier, gameData };
}

async function stepWorld(world: World, steps: number) {
    for (let i = 0; i < steps; i++) {
        world.step();
        await new Promise(resolve => setImmediate(resolve));
    }
}

function setFiring(carrier: Entity, firing: boolean) {
    carrier.components.get(WeaponsStateComponent)!.get(BAY_ID)!.firing = firing;
}

function outfitCount(carrier: Entity, id: string): number {
    return carrier.components.get(OutfitsStateComponent)?.get(id)?.count ?? 0;
}

/** Every live bay fighter, as [uuid, entity]. */
function fighters(world: World): [string, Entity][] {
    return [...world.entities]
        .filter(([, entity]) => entity.components.has(BayFighterComponent));
}

/**
 * Launches exactly one fighter and returns it. Two steps with the
 * trigger held: the launch on the first, and the second is the bay's
 * one-frame reload, so back-to-back calls each get their own fighter.
 */
async function launchOne(world: World, carrier: Entity) {
    const before = fighters(world).length;
    setFiring(carrier, true);
    await stepWorld(world, 2);
    setFiring(carrier, false);
    const now = fighters(world);
    expect(now.length).toBe(before + 1);
    return now[now.length - 1];
}

/**
 * A bay is a WEAPON, so launching a fighter is heard exactly like any other
 * shot — the wëap's own snd on the untargeted (everyone-hears) SoundEvent
 * channel. Launching used to be silent: BayWeaponEntry.fire simply never
 * emitted, unlike the projectile and beam entries.
 */
describe('bay launch sound', () => {
    const BAY_SOUND = 'test:baySound';

    function recordSounds(world: World): string[] {
        const sounds: string[] = [];
        world.addSystem(new System({
            name: 'BaySoundRecorder',
            events: [SoundEvent],
            // SingletonComponent, exactly as the real SoundSystem does:
            // SoundEvent is UNtargeted, so a system without it would run
            // once per matching entity and count every emission N times.
            args: [SoundEvent, SingletonComponent] as const,
            step({ id }) { sounds.push(id); },
        }));
        return sounds;
    }

    it('plays the bay weapon\'s sound on launch', async () => {
        const { world, carrier } = await makeTestWorld({ sound: BAY_SOUND });
        const sounds = recordSounds(world);
        await launchOne(world, carrier);
        expect(sounds).toContain(BAY_SOUND);
    });

    it('plays once per launched fighter', async () => {
        const { world, carrier } = await makeTestWorld({
            fighterCounts: { [FIGHTER_A_ID]: 2 }, sound: BAY_SOUND,
        });
        const sounds = recordSounds(world);
        await launchOne(world, carrier);
        expect(sounds.filter(id => id === BAY_SOUND).length).toBe(1);
        await launchOne(world, carrier);
        expect(sounds.filter(id => id === BAY_SOUND).length).toBe(2);
    });

    it('stays silent for a bay with no sound in its data', async () => {
        // One stock bay (nova:175 "Create Dart") genuinely has no snd; a
        // soundless bay must not invent one.
        const { world, carrier } = await makeTestWorld({ sound: undefined });
        const sounds = recordSounds(world);
        await launchOne(world, carrier);
        expect(sounds.length).toBe(0);
    });

    it('the stock bays really do carry sounds (real Nova data)', async () => {
        // The reason a launch can be heard at all: this is data, not
        // invention. 22 of the 23 stock bays name a snd; only nova:175
        // ("Create Dart", a mission-spawn utility) has none.
        const gameData = await getIntegrationGameData();
        const ids = await gameData.ids;
        const bays: { id: string, sound?: string }[] = [];
        for (const id of [...ids.Weapon].sort()) {
            const weapon = await gameData.data.Weapon.get(id);
            if (weapon.type === 'BayWeaponData') {
                bays.push({ id, sound: (weapon as { sound?: string }).sound });
            }
        }
        expect(bays.length).toBeGreaterThan(0);
        expect(bays.filter(bay => bay.sound).length)
            .toBeGreaterThan(bays.length / 2);
        // The Viper Bay, the archetypal stock carrier bay.
        expect(bays.find(bay => bay.id === 'nova:149')?.sound)
            .toBe('nova:221');
        // ...and the one that genuinely has none.
        expect(bays.find(bay => bay.id === 'nova:175')?.sound)
            .toBeUndefined();
    }, 60_000);

    it('the stock bay -> fighter link canSellOutfit keys on really exists '
        + '(real Nova data)', async () => {
            // The "can't sell a bay while its fighters are out" rule
            // (outfitter_rules canSellOutfit) walks outfit.weapons to find
            // the bay an outfit grants, then matches it against the
            // deployed fighters' ammoFor. Both halves are data, so if a
            // stock bay were granted some other way the rule would be a
            // silent no-op. Pin it on real resources.
            const gameData = await getIntegrationGameData();
            const ids = await gameData.ids;
            const bayIds = new Set<string>();
            for (const id of ids.Weapon) {
                if ((await gameData.data.Weapon.get(id)).type
                    === 'BayWeaponData') {
                    bayIds.add(id);
                }
            }
            const outfits = await Promise.all(
                [...ids.Outfit].sort().map(id => gameData.data.Outfit.get(id)));

            // bay weapon id -> the outfit that mounts it / its fighter ammo.
            const granting = new Map<string, OutfitData>();
            const ammo = new Map<string, OutfitData>();
            for (const outfit of outfits) {
                for (const weaponId of Object.keys(outfit.weapons)) {
                    if (bayIds.has(weaponId) && !granting.has(weaponId)) {
                        granting.set(weaponId, outfit);
                    }
                }
                if (outfit.ammoFor && bayIds.has(outfit.ammoFor)
                    && !ammo.has(outfit.ammoFor)) {
                    ammo.set(outfit.ammoFor, outfit);
                }
            }
            // Measured against stock data: all 23 bay weapons are granted
            // by an outfit, and each has a fighter outfit as its ammo. So
            // the rule has a link to follow for every bay in the game, not
            // just the common ones.
            expect(bayIds.size).toBe(23);
            expect(granting.size).toBe(bayIds.size);
            expect(ammo.size).toBe(bayIds.size);
            // The Viper Bay, the archetypal stock carrier bay.
            const bayOutfit = granting.get('nova:149');
            const fighter = ammo.get('nova:149');
            expect(bayOutfit?.name).toBe('Viper Bay');
            expect(fighter?.name).toBe('Viper');

            // ...and the rule fires on that real pair: one Viper out, and
            // the Viper Bay outfit is no longer sellable.
            const byId = new Map(outfits.map(o => [o.id, o]));
            const check = canSellOutfit(bayOutfit!, {
                shipData: getDefaultShipData(),
                outfits: new Map([[bayOutfit!.id, 1], [fighter!.id, 0]]),
                getOutfit: id => byId.get(id),
                getWeapon: () => undefined,
                bits: new Set(),
                credits: 0,
                deployedCounts: new Map([[fighter!.id, 1]]),
            });
            expect(check.allowed).toBeFalse();
            expect(check.allowed ? '' : check.reason).toBe('fightersDeployed');
        }, 60_000);

    it('makes no sound when an empty bay launches nothing', async () => {
        const { world, carrier } = await makeTestWorld({
            fighterCounts: { [FIGHTER_A_ID]: 0 }, sound: BAY_SOUND,
        });
        const sounds = recordSounds(world);
        setFiring(carrier, true);
        await stepWorld(world, 10);
        setFiring(carrier, false);
        expect(fighters(world).length).toBe(0);
        expect(sounds).not.toContain(BAY_SOUND);
    });
});

describe('bay weapons', () => {
    it('spends one fighter outfit per launch', async () => {
        const { world, carrier } = await makeTestWorld({
            fighterCounts: { [FIGHTER_A_ID]: 2 },
        });
        expect(outfitCount(carrier, FIGHTER_A_ID)).toBe(2);

        await launchOne(world, carrier);
        expect(outfitCount(carrier, FIGHTER_A_ID)).toBe(1);

        await launchOne(world, carrier);
        expect(outfitCount(carrier, FIGHTER_A_ID)).toBe(0);
        expect(fighters(world).length).toBe(2);
    });

    it('refuses to fire an empty bay, and fires again once restocked',
        async () => {
            const { world, carrier } = await makeTestWorld({
                fighterCounts: { [FIGHTER_A_ID]: 0 },
            });

            // Held trigger, many ticks: an empty bay launches nothing.
            setFiring(carrier, true);
            await stepWorld(world, 10);
            expect(fighters(world).length).toBe(0);
            setFiring(carrier, false);

            // Restocking makes it fire, so nothing else was blocking it.
            carrier.components.get(OutfitsStateComponent)!
                .get(FIGHTER_A_ID)!.count = 1;
            await launchOne(world, carrier);
            expect(outfitCount(carrier, FIGHTER_A_ID)).toBe(0);
        });

    it('spends the lowest-sorted supplying outfit first', async () => {
        const { world, carrier } = await makeTestWorld({
            fighterCounts: { [FIGHTER_A_ID]: 1, [FIGHTER_B_ID]: 1 },
        });
        await launchOne(world, carrier);
        // 'test:fighterA' sorts before 'test:fighterB'.
        expect(outfitCount(carrier, FIGHTER_A_ID)).toBe(0);
        expect(outfitCount(carrier, FIGHTER_B_ID)).toBe(1);
    });

    it('tags each fighter with the bay that launched it', async () => {
        const { world, carrier } = await makeTestWorld();
        const [, fighter] = await launchOne(world, carrier);
        expect(fighter.components.get(BayFighterComponent)?.bayWeaponId)
            .toEqual(BAY_ID);
        expect(fighter.components.get(SourceComponent)).toBe(CARRIER_UUID);
    });

    it('launches fighters with the carrier\'s velocity plus the exit kick',
        async () => {
            const { world, carrier } = await makeTestWorld();
            const carrierVelocity = Vector.fromVectorLike(
                carrier.components.get(MovementStateComponent)!.velocity);
            const [, fighter] = await launchOne(world, carrier);

            const launched = fighter.components
                .get(MovementStateComponent)!.velocity;
            // Regression: Vector is immutable, and the launch code used
            // to call velocity.add(...) for effect and throw the result
            // away, so every fighter left the bay at a dead stop while
            // its carrier flew off at speed.
            expect(launched.length).toBeGreaterThan(1);
            // The carrier's motion is inherited, and the leftover is the
            // exit kick — give or take the RCS station-keeping nudges
            // FormationSystem may have made in the (at most two) ticks since
            // launch (a fighter leaves the bay close beside its slot, a
            // few tens of px, near enough to be on RCS at once), and the
            // launch brake's shedding of a kick under the fighter's top
            // speed (BAY_LAUNCH_BRAKE) over the same ticks.
            const kick = launched.subtract(carrierVelocity);
            const rcsPerTick = fighter.components.get(ShipPhysicsComponent)!
                .acceleration * RCS_ACCEL_FRACTION * SIMULATION_STEP_MS / 1000;
            const brakePerTick = BAY_LAUNCH_BRAKE * SIMULATION_STEP_MS / 1000;
            expect(Math.abs(kick.length - BAY_SHOT_SPEED))
                .toBeLessThanOrEqual(2 * (rcsPerTick + brakePerTick) + 1e-9);
        });

    it('kicks the fighter out at the bay\'s own wëap Speed (reference '
        + '"Bay fighter launch speed (E8), wave 40")', () => {
            // Speed / 100 px a 30 fps frame, the shot-speed reading
            // (WEAP_SPEED_FACTOR 3 / 10): the stock Viper Bay's 400 is 4
            // px a frame, the kit's 1000 is 10.
            expect(bayExitKick({ shotSpeed: 400 * 3 / 10 }))
                .toBeCloseTo(4 * 30, 9);
            expect(bayExitKick({ shotSpeed: 1000 * 3 / 10 }))
                .toBeCloseTo(10 * 30, 9);
        });

    it('re-derives the carrier\'s return_escorts vulnerability after the '
        + 'carrier is rebuilt (land + depart with fighters deployed)',
        async () => {
            const { world, carrier } = await makeTestWorld({
                fighterCounts: { [FIGHTER_A_ID]: 1 },
            });
            const [, fighter] = await launchOne(world, carrier);
            const vuln = carrier.components
                .get(CollisionVulnerabilityComponent)!;
            expect(vuln.vulnerableTo.has('return_escorts')).toBeTrue();

            // Landing + departing rebuilds the carrier entity: the
            // providers derive a FRESH vulnerability set without the
            // launch-time 'return_escorts' side effect (shipped bug:
            // 'return to ship' silently failed after a landing until a
            // NEW launch re-added the tag).
            vuln.vulnerableTo.delete('return_escorts');

            startReturnHome(fighter);
            await stepWorld(world, 1);
            expect(carrier.components.get(CollisionVulnerabilityComponent)!
                .vulnerableTo.has('return_escorts')).toBeTrue();
        });

    it('refunds exactly one fighter and removes the fighter when it docks',
        async () => {
            const { world, carrier } = await makeTestWorld({
                fighterCounts: { [FIGHTER_A_ID]: 2 },
            });
            const [uuid, fighter] = await launchOne(world, carrier);
            expect(outfitCount(carrier, FIGHTER_A_ID)).toBe(1);

            startReturnHome(fighter);
            world.emit(CollisionEvent, { other: CARRIER_UUID, initiator: true },
                [uuid]);
            await stepWorld(world, 1);

            expect(outfitCount(carrier, FIGHTER_A_ID)).toBe(2);
            expect(world.entities.has(uuid)).toBeFalse();
        });

    it('refunds to the lowest-sorted supplying outfit, mirroring the '
        + 'consume policy', async () => {
            const { world, carrier } = await makeTestWorld({
                fighterCounts: { [FIGHTER_A_ID]: 1, [FIGHTER_B_ID]: 1 },
            });
            const [uuid, fighter] = await launchOne(world, carrier);
            expect(outfitCount(carrier, FIGHTER_A_ID)).toBe(0);

            startReturnHome(fighter);
            world.emit(CollisionEvent, { other: CARRIER_UUID, initiator: true },
                [uuid]);
            await stepWorld(world, 1);

            // Back into A (the one it came out of), not B.
            expect(outfitCount(carrier, FIGHTER_A_ID)).toBe(1);
            expect(outfitCount(carrier, FIGHTER_B_ID)).toBe(1);
        });

    it('ignores a collision with anything that is not its carrier',
        async () => {
            const { world, carrier } = await makeTestWorld();
            const [uuid, fighter] = await launchOne(world, carrier);
            // Parked well clear of the carrier, so the only collision
            // in play is the foreign one emitted below (a returning
            // fighter still alongside its carrier would really dock).
            fighter.components.set(MovementStateComponent, {
                ...fighter.components.get(MovementStateComponent)!,
                position: new Position(5000, 5000),
                velocity: new Vector(0, 0),
            });
            startReturnHome(fighter);
            world.emit(CollisionEvent,
                { other: 'some other ship', initiator: true }, [uuid]);
            await stepWorld(world, 1);

            expect(world.entities.has(uuid)).toBeTrue();
            expect(outfitCount(carrier, FIGHTER_A_ID)).toBe(1);
        });

    it('never refunds past the bay\'s capacity', async () => {
        // One bay holding one fighter: capacity is 1.
        const { world, carrier } = await makeTestWorld({
            fighterCounts: { [FIGHTER_A_ID]: 1 },
            maxAmmo: 1,
            bays: 1,
        });
        const [uuid, fighter] = await launchOne(world, carrier);
        expect(outfitCount(carrier, FIGHTER_A_ID)).toBe(0);

        // Simulate the magazine having been refilled behind the
        // fighter's back (what the outfitter's deployed-count
        // accounting exists to prevent). Docking must not overfill it.
        carrier.components.get(OutfitsStateComponent)!
            .get(FIGHTER_A_ID)!.count = 1;

        startReturnHome(fighter);
        world.emit(CollisionEvent, { other: CARRIER_UUID, initiator: true },
            [uuid]);
        await stepWorld(world, 1);

        expect(outfitCount(carrier, FIGHTER_A_ID)).toBe(1);
        // The fighter still docks; only the round is dropped.
        expect(world.entities.has(uuid)).toBeFalse();
    });

    it('caps a multi-bay carrier at MaxAmmo per bay', async () => {
        // 2 bays x MaxAmmo 2 = capacity 4.
        const { world, carrier } = await makeTestWorld({
            fighterCounts: { [FIGHTER_A_ID]: 4 },
            maxAmmo: 2,
            bays: 2,
        });
        const [uuid, fighter] = await launchOne(world, carrier);
        expect(outfitCount(carrier, FIGHTER_A_ID)).toBe(3);

        startReturnHome(fighter);
        world.emit(CollisionEvent, { other: CARRIER_UUID, initiator: true },
            [uuid]);
        await stepWorld(world, 1);
        // Room for it: 3 aboard, capacity 4.
        expect(outfitCount(carrier, FIGHTER_A_ID)).toBe(4);
    });

    it('leaves reload timing and weapon state alone when ammo changes, '
        + 'so consuming a fighter does not reset the bay\'s clock',
        async () => {
            const { world, carrier } = await makeTestWorld({
                fighterCounts: { [FIGHTER_A_ID]: 2 },
            });
            const weaponsStateBefore =
                carrier.components.get(WeaponsStateComponent);
            const localStateBefore = [...carrier.components.keys()]
                .find(c => c.name === 'WeaponsComponent');
            expect(localStateBefore).toBeDefined();
            const localBefore = carrier.components
                .get(localStateBefore!) as unknown;

            await launchOne(world, carrier);

            // Consuming ammo mutates the OutfitsState entry IN PLACE.
            // Provide's change detection only fires on component
            // REASSIGNMENT (nova_ecs/provide.ts), so WeaponsState is not
            // re-derived and the WeaponsComponent local state (reload
            // timers, burst counters) survives — the hazard behind the
            // tracker note on WeaponsComponentProvider in fire_weapon_plugin.ts.
            expect(carrier.components.get(WeaponsStateComponent))
                .toBe(weaponsStateBefore);
            expect(carrier.components.get(localStateBefore!) as unknown)
                .toBe(localBefore);
            // The bay is still mounted, with its count intact.
            expect(carrier.components.get(WeaponsStateComponent)!
                .get(BAY_ID)!.count).toBe(1);
        });

    /**
     * OrphanedBayFighterSystem's DEPART path: a bay fighter whose carrier
     * has been destroyed is handed a graceful exit instead of being left
     * steered by escort machinery that has no leader left.
     *
     * Three things about it were unpinned. It must actually retire the
     * fighter (drop the escort wiring, hand it the departing NPC brain).
     * It must NOT refund the round — the bay it came from no longer
     * exists, and crediting a dead carrier's magazine would resurrect
     * ammo that the docking path is the only legitimate source of. And it
     * must draw NOTHING from the seeded RandomResource: it runs off entity
     * state alone, so a carrier dying must not shift the PRNG stream for
     * everything else on that tick.
     */
    it('retires an orphaned fighter with no refund and no PRNG draw',
        async () => {
            const { world, carrier } = await makeTestWorld();
            const [, fighter] = await launchOne(world, carrier);
            expect(outfitCount(carrier, FIGHTER_A_ID)).toBe(1);

            // The escort wiring an NPC carrier's fighter flies under (the
            // bay launch itself stamps only the bay identity; the carrier's
            // command layer adds these). Stamped explicitly so the
            // assertions below that it is STRIPPED are not vacuous.
            fighter.components.set(FormationComponent,
                { leader: CARRIER_UUID, slot: 0 });
            fighter.components.set(EscortCommandComponent,
                { command: 'formation' });

            // The carrier is destroyed. `carrier` is still a live object,
            // so its magazine stays readable after it leaves the world.
            world.entities.delete(CARRIER_UUID);

            const random = world.resources.get(RandomResource)!;
            const stateBefore = random.getState();
            await stepWorld(world, 1);

            // Retired: escort wiring gone, departing NPC brain in place.
            expect(fighter.components.get(NpcComponent))
                .toEqual({ aiType: 3, mode: 'depart' });
            expect(fighter.components.has(EscortCommandComponent)).toBeFalse();
            expect(fighter.components.has(FormationComponent)).toBeFalse();
            // The round is NOT banked back into the dead carrier.
            expect(outfitCount(carrier, FIGHTER_A_ID)).toBe(1);
            // The seeded sequence is exactly where it was.
            expect(random.getState()).toEqual(stateBefore);
        });

    it('leaves an orphaned fighter alone once it has already been retired',
        async () => {
            // Idempotent: the NpcComponent it gains is what stops it
            // running again, so later ticks must add no further draws.
            const { world, carrier } = await makeTestWorld();
            await launchOne(world, carrier);
            world.entities.delete(CARRIER_UUID);
            await stepWorld(world, 1);

            const random = world.resources.get(RandomResource)!;
            const stateBefore = random.getState();
            await stepWorld(world, 3);
            expect(random.getState()).toEqual(stateBefore);
        });
});

/**
 * ============================================================================
 * THE LOST-FIGHTER REFUND (issue #258)
 * ============================================================================
 *
 * A bay fighter that vanished from the world without dying and without
 * docking is a round gone from the magazine; the ruling is to give it
 * back. The client's ledger proves the loss (client/fleet_ledger_test.ts)
 * and sends a `refundFighter` input record; these specs pin the SIM half:
 * the docking notice the ledger tells a dock apart by, and
 * applyRefundFighter — a docking's effect, owner-checked, bay-checked,
 * ceiling-capped, and applied exactly once under rollback resimulation.
 */
describe('the lost-fighter refund (issue #258)', () => {
    const PLAYER_PEER = 'player-peer';

    it('a docking announces itself to the display, targeting the fighter',
        async () => {
            const { world, carrier } = await makeTestWorld();
            const [uuid, fighter] = await launchOne(world, carrier);
            const docked: (string | Entity)[][] = [];
            world.events.get(FighterDockedEvent).subscribe(
                ({ data, entities }) => {
                    expect(data).toEqual({ carrier: CARRIER_UUID });
                    docked.push([...entities ?? []]);
                });
            startReturnHome(fighter);
            world.emit(CollisionEvent, { other: CARRIER_UUID, initiator: true },
                [uuid]);
            await stepWorld(world, 1);
            expect(world.entities.has(uuid)).toBeFalse();
            expect(docked).toEqual([[uuid]]);
        });

    it('credits one round to the player\'s own bay, exactly as a docking '
        + 'does, and never past the ceiling', async () => {
            // One bay, MaxAmmo 2: the ceiling is 2.
            const { world, carrier } = await makeTestWorld({
                fighterCounts: { [FIGHTER_A_ID]: 2 }, maxAmmo: 2,
            });
            carrier.components.set(PlayerShipSelector, undefined);
            await launchOne(world, carrier);
            await launchOne(world, carrier);
            expect(outfitCount(carrier, FIGHTER_A_ID)).toBe(0);
            const refund = { carrier: CARRIER_UUID, bayWeaponId: BAY_ID };
            // Local play: no peer, the PlayerShipSelector is the player.
            expect(applyRefundFighter(world, undefined, refund)).toBeTrue();
            expect(outfitCount(carrier, FIGHTER_A_ID)).toBe(1);
            expect(applyRefundFighter(world, undefined, refund)).toBeTrue();
            expect(outfitCount(carrier, FIGHTER_A_ID)).toBe(2);
            // A third round would exceed what the bay can hold.
            expect(applyRefundFighter(world, undefined, refund)).toBeFalse();
            expect(outfitCount(carrier, FIGHTER_A_ID)).toBe(2);
        });

    it('refuses a carrier that is not the player\'s, and credits a hired '
        + 'carrier escort\'s bay', async () => {
            const { world, carrier } = await makeTestWorld();
            await launchOne(world, carrier);
            const player = new Entity('player')
                .addComponent(PlayerShipSelector, undefined);
            world.entities.set('player-uuid', player);
            const refund = { carrier: CARRIER_UUID, bayWeaponId: BAY_ID };
            // An NPC carrier: nobody's, nothing credited.
            expect(applyRefundFighter(world, undefined, refund)).toBeFalse();
            expect(outfitCount(carrier, FIGHTER_A_ID)).toBe(1);
            // Somebody ELSE's escort: still nothing.
            carrier.components.set(PlayerEscortComponent,
                { player: 'somebody-else', parent: 'somebody-else', deal: NO_DEAL });
            expect(applyRefundFighter(world, undefined, refund)).toBeFalse();
            expect(outfitCount(carrier, FIGHTER_A_ID)).toBe(1);
            // The player's own hired carrier: its bay gets the round.
            carrier.components.set(PlayerEscortComponent,
                { player: 'player-uuid', parent: 'player-uuid', deal: NO_DEAL });
            expect(applyRefundFighter(world, undefined, refund)).toBeTrue();
            expect(outfitCount(carrier, FIGHTER_A_ID)).toBe(2);
        });

    it('refuses a bay the carrier does not mount, and a carrier that is '
        + 'gone', async () => {
            const { world, carrier } = await makeTestWorld();
            carrier.components.set(PlayerShipSelector, undefined);
            await launchOne(world, carrier);
            expect(applyRefundFighter(world, undefined,
                { carrier: CARRIER_UUID, bayWeaponId: 'test:noSuchBay' }))
                .toBeFalse();
            expect(applyRefundFighter(world, undefined,
                { carrier: 'no such carrier', bayWeaponId: BAY_ID }))
                .toBeFalse();
            expect(outfitCount(carrier, FIGHTER_A_ID)).toBe(1);
        });

    it('is applied exactly once under a rollback resimulation, as an '
        + 'input record through the bridge', async () => {
            const { world, carrier, gameData } = await makeTestWorld();
            // The record is stamped with this peer, which controls the
            // carrier.
            const communicator = new MockCommunicator(PLAYER_PEER);
            world.resources.set(CommunicatorResource, communicator);
            carrier.components.set(ControlledByComponent,
                { peerId: PLAYER_PEER });
            await launchOne(world, carrier);
            expect(outfitCount(carrier, FIGHTER_A_ID)).toBe(1);

            const host = new SimulationBridgeHost(world, gameData);
            const client = new SimulationBridgeClient(host,
                world.resources.get(SerializerResource)!);
            client.step(3);
            await client.refundFighter(
                { carrier: CARRIER_UUID, bayWeaponId: BAY_ID });
            client.step(); // The record lands on tick 4.
            expect(outfitCount(carrier, FIGHTER_A_ID)).toBe(2);

            // A late record for tick 3 arrives: the host rolls back past
            // the refund's tick and re-lives it. The refund is re-applied
            // from the input log on the restored state — one round, not
            // two.
            communicator.messages.next({
                source: 'server',
                message: wrapRollbackMessage({
                    kind: 'inputs',
                    record: {
                        peerId: 'other peer', tick: 3,
                        inputs: [{ kind: 'setTarget', target: null }],
                    },
                }),
            });
            client.step(2);
            expect(outfitCount(carrier, FIGHTER_A_ID)).toBe(2);
        });
});

/**
 * Reference "Bay launch kick (E8, the hub's question), wave 41": the kit's
 * Bay Disc (Speed / Accel 300, Turn 30: 135 px/s, 54 px/s², 90 deg/s)
 * launched from a carrier at rest. From the Speed-400 bay it stopped about
 * 35 px out 0.7 s after launch; from the Speed-1000 bay it kept about 10
 * px a frame straight off screen.
 */
describe('the bay launch kick (E8 wave 41)', () => {
    /** The kit's Bay Disc, or (`fast`) the Bay Disc Fast of E8 wave 42:
     * Speed / Accel 1000, Turn 60. */
    async function launchFrom(baySpeed: number, fast = false) {
        const gameData = new MockGameData();
        gameData.data.Weapon.map.set(BAY_ID, {
            ...getDefaultBayWeaponData(), id: BAY_ID, shipID: FIGHTER_SHIP_ID,
            ammoType: ['weapon', BAY_ID], maxAmmo: 4, fireGroup: 'secondary',
            shotSpeed: baySpeed * 3 / 10, reload: 30,
        });
        gameData.data.Outfit.map.set(BAY_OUTFIT_ID, {
            ...getDefaultOutfitData(), id: BAY_OUTFIT_ID,
            weapons: { [BAY_ID]: 1 },
        });
        gameData.data.Outfit.map.set(FIGHTER_A_ID, {
            ...getDefaultOutfitData(), id: FIGHTER_A_ID, ammoFor: BAY_ID,
        });
        gameData.data.Ship.map.set(FIGHTER_SHIP_ID, {
            ...getDefaultShipData(), id: FIGHTER_SHIP_ID,
            physics: fast ? {
                ...getDefaultShipPhysics(), speed: 1000 * 1.5 * 30 / 100,
                acceleration: 1000 * 30 * 30 / 5000,
                turnRate: 180 * Math.PI / 180,
            } : {
                ...getDefaultShipPhysics(), speed: 135, acceleration: 54,
                turnRate: 90 * Math.PI / 180,
            },
        });
        const carrierData: ShipData = {
            ...getDefaultShipData(), id: CARRIER_ID,
            outfits: { [BAY_OUTFIT_ID]: 1, [FIGHTER_A_ID]: 2 },
            physics: { ...getDefaultShipPhysics() },
        };
        gameData.data.Ship.map.set(CARRIER_ID, carrierData);
        const world = await makeSystem('test:system', gameData, undefined,
            { npcs: false });
        const carrier = makeShip(carrierData);
        carrier.components.set(MovementStateComponent, {
            accelerating: 0, position: new Position(0, 0),
            rotation: new Angle(0), turnBack: false, turning: 0,
            velocity: new Vector(0, 0),
        });
        await completeEntity(world, carrier);
        world.entities.set(CARRIER_UUID, carrier);
        await stepWorld(world, 2);
        const [, fighter] = await launchOne(world, carrier);
        /** The fighter's distance from the carrier after `frames` more
         * 30 fps frames. */
        const distanceAfter = async (frames: number) => {
            await stepWorld(world, 2 * frames);
            return Position.fromVectorLike(fighter.components
                .get(MovementStateComponent)!.position).length;
        };
        return { world, fighter, distanceAfter };
    }

    it('brakes a kick under the fighter\'s top speed: the Speed-400 bay\'s '
        + 'fighter stops about 35 px out within 0.7 s', async () => {
            const { fighter, distanceAfter } = await launchFrom(400);
            const at07 = await distanceAfter(21);
            expect(at07).toBeGreaterThan(25);
            expect(at07).toBeLessThan(45);
            // Stopped (or turning back toward its station), not coasting.
            const speed = Vector.fromVectorLike(fighter.components
                .get(MovementStateComponent)!.velocity).length;
            expect(speed).toBeLessThan(30);
            expect(fighter.components.get(BayFighterComponent)!.launchBrake)
                .toBeUndefined();
            expect(await distanceAfter(9)).toBeLessThan(45);
        });

    it('lets a kick over the fighter\'s top speed coast: the Speed-1000 '
        + 'bay\'s fighter keeps about 10 px a frame', async () => {
            const { fighter, distanceAfter } = await launchFrom(1000);
            expect(fighter.components.get(BayFighterComponent)!.launchBrake)
                .toBeUndefined();
            const at03 = await distanceAfter(9);
            const at13 = await distanceAfter(30);
            // About 100 px at 0.3 s and 400 at 1.3 s on the original.
            expect(at03).toBeGreaterThan(80);
            expect(at13).toBeGreaterThan(330);
            // The original read a steady 10. NovaJS bleeds the kick off
            // like any overspeed, at OVERSPEED_DECAY_FACTOR x 54 px/s²
            // (0.7 since the U4 wave-43 ruler; 0.5 before), about 9 px a
            // frame on average over this second.
            expect((at13 - at03) / 30).toBeGreaterThan(8.5);
        });

    it('brakes a Speed-200 kick about 18 px out (reference "Bay launch '
        + 'kicks under the fighter\'s top speed (E8 leftover), wave 42")',
        async () => {
            // 2 px a frame shed at 200 px/s²: 9 px of travel, which with
            // the original's frames of clearing the carrier's sprite
            // (about 10 px, the section) reads about 18.
            const { fighter, distanceAfter } = await launchFrom(200);
            let peak = 0;
            for (let frame = 0; frame < 15; frame++) {
                peak = Math.max(peak, await distanceAfter(1));
            }
            expect(peak).toBeGreaterThan(6);
            expect(peak).toBeLessThan(18);
            expect(fighter.components.get(BayFighterComponent)!.launchBrake)
                .toBeUndefined();
        });

    it('lets a strong-engined fighter coast a kick under its top speed '
        + 'about 0.8 s, then brake fast: the Speed-1000 disc from the '
        + 'Speed-400 bay stops about 145 px out (E8 wave 42)', async () => {
            const { fighter, distanceAfter } = await launchFrom(400, true);
            const state = () => fighter.components.get(BayFighterComponent)!;
            expect(state().launchBrake).toBeTrue();
            expect(state().launchCoast).toBeGreaterThan(0.7);
            // Still at the kick's 4 px a frame at 0.6 s.
            const at06 = await distanceAfter(18);
            const at07 = await distanceAfter(3);
            expect((at07 - at06) / 3).toBeGreaterThan(3.5);
            expect(at07).toBeGreaterThan(70);
            // Shed within about 8 frames of the coast's end.
            const at12 = await distanceAfter(15);
            expect(state().launchBrake).toBeUndefined();
            expect(state().launchCoast).toBeUndefined();
            expect(at12).toBeGreaterThan(90);
            expect(at12).toBeLessThan(160);
        });

    it('coasts only a fighter stronger than Accel 300', () => {
        expect(BAY_LAUNCH_COAST_MIN_ACCEL).toBeCloseTo(54, 9);
        expect(BAY_LAUNCH_COAST_S).toBe(0.8);
        expect(BAY_LAUNCH_FAST_BRAKE).toBe(500);
    });
});
