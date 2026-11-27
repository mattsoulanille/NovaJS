import 'jasmine';
import { getDefaultSystemData } from 'novadatainterface/system_data';
import { MockGameData } from 'novadatainterface/mock_game_data';
import { getDefaultGovtData } from 'novadatainterface/govt_data';
import { getDefaultOutfitData } from 'novadatainterface/outfit_data';
import {
    getDefaultShipData, getDefaultShipPhysics, ShipData,
} from 'novadatainterface/ship_data';
import { BayWeaponData, getDefaultBayWeaponData } from 'novadatainterface/weapon_data';
import { Angle, Vector } from 'nova_ecs/datatypes/vector';
import { Position } from 'nova_ecs/datatypes/position';
import { Entity } from 'nova_ecs/entity';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { Random, RandomResource } from 'nova_ecs/plugins/random_plugin';
import {
    restoreWorld, snapshotWorld, SnapshotPoliciesResource,
} from 'nova_ecs/plugins/snapshot_plugin';
import { hashWorld } from 'nova_ecs/plugins/world_hash';
import { World } from 'nova_ecs/world';
import { UUID } from 'nova_ecs/arg_types';
import { System } from 'nova_ecs/system';
import {
    boardingBlockedMessage, plunderSelfDestructMessage,
} from '../../display/status_bar_content.js';
import { SYNTHETIC } from 'novaparse/synthetic/universe';
import { getSyntheticGameData } from '../../communication/simulation_test_fixture.js';
import {
    BayCaptureEvent, BoardingBlockedEvent, CaptureAssignedEvent, captureOddsDraw,
    CapturedShip, clearHostilityToward,
    EscortRepairedEvent, PlunderSelfDestructEvent, reassignCapturedWing,
} from './boarding_plugin.js';
import {
    applySimulationInputs, SimulationInput, SimulationInputType,
} from '../../communication/simulation_input.js';
import { MissionUniverse } from '../../spaceport/mission_universe.js';
import { buildCaptureSetStrings } from '../../spaceport/ship_mission_accept.js';
import { ControlBitsComponent } from '../ncb/index.js';
import { PlayerNamesComponent } from '../player/index.js';
import { AggressionComponent } from '../combat/index.js';
import { MissionShipComponent, NO_DEAL } from '../player/index.js';
import { SystemHoldComponent } from '../npc/index.js';
import {
    boardCaptureOdds, BoardedComponent, BoardingComponent, captureChance,
    creditBooty, ExplodingComponent,
    PLUNDER_SELF_DESTRUCT_CHANCE, plunderTripsSelfDestruct,
    CAPTURE_SELF_DESTRUCT_CHANCE,
} from '../ship/index.js';
import { InitiateJumpEvent } from '../travel/index.js';
import { LandEvent } from '../travel/index.js';
import {
    BayFighterComponent, CollectableEscortComponent, ReturnComponent,
    ReturnWhenTargetRemovedComponent, startReturnHome,
} from '../escorts/index.js';
import { CollisionHitterComponent } from '../core/index.js';
import { HurtboxHullComponent } from '../core/index.js';
import { isBelowDisableThreshold, REPAIR_MARGIN_FRACTION } from '../ship/index.js';
import { CargoComponent } from '../ship/index.js';
import {
    CollisionEvent, CollisionVulnerabilityComponent,
} from '../core/index.js';
import { DisabledComponent } from '../ship/index.js';
import { completeEntity } from '../spawn/index.js';
import { cappedEscortCount, MAX_ESCORTS } from '../escorts/index.js';
import { EscortCommandComponent } from '../player/index.js';
import { escortParent } from '../escorts/index.js';
import { OwnerComponent, SourceComponent } from '../combat/index.js';
import { FiringGroupComponent } from '../ship/index.js';
import { isInFlock } from '../combat/index.js';
import { deriveEntityComponents, GovtComponent } from '../core/index.js';
import { ArmorComponent, FuelComponent, ShieldComponent } from '../ship/index.js';
import { makeShip } from '../ship/index.js';
import { makeSystem } from '../make_system.js';
import { FormationComponent, NpcComponent } from '../npc/index.js';
import { OutfitsStateComponent } from '../ship/index.js';
import { PlayerEscortComponent } from '../player/index.js';
import {
    CreditsComponent, MissionsComponent,
} from '../player/index.js';
import {
    CombatRatingComponent, DamageAttributionComponent, LegalRecordsComponent,
} from '../reputation/index.js';
import {
    ControlledByComponent, ShipControlEvent, ShipControlStateComponent,
} from '../player/index.js';
import { ShipComponent, ShipDataComponent } from '../ship/index.js';
import { PersComponent } from '../spawn/index.js';
import { TargetComponent } from '../ship/index.js';
import { WeaponsStateComponent } from '../ship/index.js';

const BOARDER = 'boarder';
const SECOND_BOARDER = 'boarder2';
const TARGET = 'target';

/**
 * Pins the seeded capture roll: `next()` returns CAPTURE_SELF_DESTRUCT_
 * CHANCE (0.1), which never trips the capture self-destruct drawn first
 * and lands inside any chance above 10% (a SUCCESS; every success here is
 * at 75%), or 0.999, which does neither (REPELLED). Every plunder take
 * still trips at 0.1, as it did at 0.
 *
 * Needed because the player now gets exactly ONE capture attempt per
 * session (Matthew's ruling), so the old "press until it lands" loops
 * cannot work — and forcing the roll makes every capture spec exact
 * rather than merely overwhelmingly likely.
 */
function forceCaptureRoll(world: World, succeed: boolean) {
    const random = new Random();
    random.next = () => (succeed ? CAPTURE_SELF_DESTRUCT_CHANCE : 0.999);
    world.resources.set(RandomResource, random);
}

/**
 * Live-world boarding against the real simulation stack (mirrors
 * disabled_plugin_test): a controlled boarder pulled alongside a
 * disabled target in an asteroid-free, traffic-free system.
 *
 * On the SYNTHETIC scenario: Thessaly Reach (Asteroids 0; it does list
 * NPC traffic, but the world is built with npcs: false), two Wren Skiffs,
 * and the Concord of Meridian — gövt BoardPenalty 10 — as the victim's
 * government. The Wren Skiff's price of 20,000 pays the credit booty's
 * 1,000 floor (creditBooty), and its 24 px frame makes the board square's
 * half-side 12 px between two Skiffs (boardingRange).
 */
/**
 * The capture prompt's "Use As Escort", as the owner's client sends it: a
 * `captureShip` record with `escort: true` (and, here, no OnCapture
 * deltas), through the wire codec and the input apply; then one step. The
 * record is the pilot's, so the boarder is made a peer's ship if it is not
 * one yet.
 */
function useAsEscort(world: World, uuid: string,
    capture: CapturedShip = { name: '', escort: true }) {
    const boarder = world.entities.get(uuid)!;
    if (!boarder.components.has(ControlledByComponent)) {
        boarder.components.set(ControlledByComponent,
            { peerId: 'escort peer' });
    }
    const input: SimulationInput = { kind: 'captureShip', capture };
    expect(SimulationInputType.is(input)).toBeTrue();
    applySimulationInputs(world, [input],
        boarder.components.get(ControlledByComponent)!.peerId);
    world.step();
}

describe('boarding in a live world', () => {
    /** The victim's government: BoardPenalty 10. */
    const MERIDIAN = SYNTHETIC.govts.meridian;
    /** The hostile wing's own government, kept through a capture. */
    const RAIDERS = SYNTHETIC.govts.raiders;

    async function boardingWorld({
        aligned = true,
        distance = 5,
        boarderCrew = 200,
        targetCrew = 4,
        targetFuel = 30,
        cargo = new Map<string, number>([['cargo:0', 2]]),
        targetOutfits = undefined as [string, number][] | undefined,
        boarderOutfits = undefined as [string, number][] | undefined,
        targetShip = SYNTHETIC.ships.skiff as string,
    } = {}) {
        const gameData = await getSyntheticGameData();
        const world = await makeSystem(SYNTHETIC.systems.thessaly, gameData,
            'worker', { npcs: false });
        const shipData = (await gameData.data.Ship.get(SYNTHETIC.ships.skiff))!;
        const targetData = (await gameData.data.Ship.get(targetShip))!;

        const boarder = makeShip(shipData);
        boarder.components.set(MovementStateComponent, {
            position: new Position(0, 0), velocity: new Vector(0, 0),
            rotation: new Angle(0), turning: 0, turnBack: false,
            accelerating: 0,
        });
        boarder.components.set(CreditsComponent, { credits: 0 });
        boarder.components.set(LegalRecordsComponent, new Map());
        if (boarderOutfits) {
            boarder.components.set(OutfitsStateComponent, new Map(
                boarderOutfits.map(([id, count]) => [id, { count }])));
        }

        const target = makeShip(targetData);
        target.components.set(MovementStateComponent, {
            position: new Position(distance, 0), velocity: new Vector(0, 0),
            rotation: new Angle(aligned ? 0 : Math.PI / 2), turning: 0,
            turnBack: false, accelerating: 0,
        });
        target.components.set(GovtComponent, { id: MERIDIAN });

        if (targetOutfits) {
            target.components.set(OutfitsStateComponent, new Map(
                targetOutfits.map(([id, count]) => [id, { count }])));
        }
        await completeEntity(world, boarder);
        await completeEntity(world, target);
        world.entities.set(BOARDER, boarder);
        world.entities.set(TARGET, target);
        world.step();

        // Crew overrides (real ship data may have too little crew for a
        // deterministic gate / capture). Clone so the shared cached
        // ShipData isn't mutated. Applied after the provide step so the
        // ShipDataProvider doesn't overwrite them.
        boarder.components.set(ShipDataComponent,
            { ...boarder.components.get(ShipDataComponent)!, crew: boarderCrew });
        target.components.set(ShipDataComponent,
            { ...target.components.get(ShipDataComponent)!, crew: targetCrew });

        // Cargo/fuel booty on the target.
        target.components.set(CargoComponent, new Map(cargo));
        const tf = target.components.get(FuelComponent)!;
        tf.current = targetFuel;
        const bf = boarder.components.get(FuelComponent)!;
        bf.current = 0;

        // Point the boarder at the target and disable the target.
        boarder.components.get(TargetComponent)!.target = TARGET;
        damageToFraction(target, 0.33);
        world.step();

        return { world, boarder, target, gameData };
    }

    function damageToFraction(ship: Entity, fraction: number) {
        const armor = ship.components.get(ArmorComponent)!;
        armor.current = fraction * armor.max;
        const shield = ship.components.get(ShieldComponent);
        if (shield) {
            shield.current = 0;
        }
    }

    function press(world: World, uuid: string, action: string) {
        const entity = world.entities.get(uuid)!;
        entity.components.set(ShipControlStateComponent,
            new Map([[action, 'start']]) as any);
        world.emit(ShipControlEvent, undefined, [uuid]);
        world.step();
    }

    it('disables the target before a board is possible', async () => {
        const { target } = await boardingWorld();
        expect(target.components.has(DisabledComponent)).toBeTrue();
    });

    it('opens a plunder session when aligned, close, and slow', async () => {
        const { world, boarder, target } = await boardingWorld();
        press(world, BOARDER, 'board');
        const boarding = boarder.components.get(BoardingComponent);
        expect(boarding?.target).toEqual(TARGET);
        expect(target.components.has(BoardedComponent)).toBeTrue();
    });

    it('rejects a perpendicular boarder (axis gate)', async () => {
        const { world, boarder } = await boardingWorld({ aligned: false });
        press(world, BOARDER, 'board');
        expect(boarder.components.has(BoardingComponent)).toBeFalse();
    });

    it('rejects a boarder that is too far away', async () => {
        const { world, boarder } = await boardingWorld({ distance: 1000 });
        press(world, BOARDER, 'board');
        expect(boarder.components.has(BoardingComponent)).toBeFalse();
    });

    /**
     * Ruling #378: the gate matches the original's measurements
     * (boarding_component.ts has the fits; these drive them through the
     * live gate system). Between two 24 px Wren Skiffs the board square's
     * half-side is 12.
     */
    describe('the original\'s gate (ruling #378)', () => {
        function recordBlocked(world: World): string[] {
            const reasons: string[] = [];
            world.addSystem(new System({
                name: 'CollectBlockedOriginalGate',
                events: [BoardingBlockedEvent],
                args: [BoardingBlockedEvent] as const,
                step: ({ reason }) => { reasons.push(reason); },
            }));
            return reasons;
        }

        /** Moves the boarder so the hulk sits at (dx, dy) from it, with
         * the boarder at `speed` px/s along x (the hulk is at rest). */
        function placeBoarder(boarder: Entity, target: Entity, dx: number,
            dy: number, speed = 0) {
            const at = target.components.get(MovementStateComponent)!
                .position;
            const movement = boarder.components.get(MovementStateComponent)!;
            movement.position = new Position(at.x - dx, at.y - dy);
            movement.velocity = new Vector(speed, 0);
        }

        it('boards inside the square, on the diagonal too', async () => {
            const { world, boarder, target } = await boardingWorld();
            // 11.5 px both ways: 16.3 px away, inside a 12 px square.
            placeBoarder(boarder, target, 11.5, -11.5);
            press(world, BOARDER, 'board');
            expect(boarder.components.get(BoardingComponent)?.target)
                .toEqual(TARGET);
        });

        it('is "not close enough" just outside it', async () => {
            const { world, boarder, target } = await boardingWorld();
            const reasons = recordBlocked(world);
            placeBoarder(boarder, target, 0.5, 12.6);
            press(world, BOARDER, 'board');
            expect(boarder.components.has(BoardingComponent)).toBeFalse();
            expect(reasons).toEqual(['tooFar']);
            expect(boardingBlockedMessage('tooFar'))
                .toEqual("You're not close enough to board this ship.");
        });

        it('refuses 9 px/s on top of the hulk as "not close enough"',
            async () => {
                const { world, boarder, target } = await boardingWorld();
                const reasons = recordBlocked(world);
                placeBoarder(boarder, target, 0, 0, 9);
                press(world, BOARDER, 'board');
                expect(boarder.components.has(BoardingComponent)).toBeFalse();
                expect(reasons).toEqual(['tooFar']);
            });

        it('boards at 7 px/s', async () => {
            const { world, boarder, target } = await boardingWorld();
            placeBoarder(boarder, target, 2, 0, 7);
            press(world, BOARDER, 'board');
            expect(boarder.components.get(BoardingComponent)?.target)
                .toEqual(TARGET);
        });

        it('says "too fast" at 16 px/s, 70 px out', async () => {
            const { world, boarder, target } = await boardingWorld();
            const reasons = recordBlocked(world);
            placeBoarder(boarder, target, 70, 0, 16);
            press(world, BOARDER, 'board');
            expect(boarder.components.has(BoardingComponent)).toBeFalse();
            expect(reasons).toEqual(['tooFast']);
            expect(boardingBlockedMessage('tooFast'))
                .toEqual("You're moving too fast to board this ship.");
        });

        it('refuses a misaligned board SILENTLY', async () => {
            const { world, boarder } = await boardingWorld({ aligned: false });
            const reasons = recordBlocked(world);
            press(world, BOARDER, 'board');
            expect(boarder.components.has(BoardingComponent)).toBeFalse();
            expect(reasons).toEqual(['notAligned']);
            // No hint: the status line is cleared and says nothing.
            expect(boardingBlockedMessage('notAligned')).toEqual('');
        });

        it('freezes the money booty from ONE seeded draw per board',
            async () => {
                const { world, boarder, target } = await boardingWorld();
                target.components.set(ShipDataComponent, {
                    ...target.components.get(ShipDataComponent)!,
                    price: 750_000,
                });
                const random = new Random();
                let draws = 0;
                random.next = () => { draws++; return 0.999999; };
                world.resources.set(RandomResource, random);
                press(world, BOARDER, 'board');
                expect(draws).toBe(1);
                // The top step of a 750,000 hull: 35,750, as the original
                // paid once.
                expect(boarder.components.get(BoardingComponent)
                    ?.creditsAvailable).toEqual(35_750);
                press(world, BOARDER, 'plunderCredits');
                expect(boarder.components.get(CreditsComponent)!.credits)
                    .toEqual(35_750);
            });

        it('never captures a DERELICT: no roll, the session open',
            async () => {
                const { world, boarder, target } = await boardingWorld({
                    boarderCrew: 500, targetCrew: 1,
                });
                target.components.set(GovtComponent,
                    { id: SYNTHETIC.govts.wrecks });
                const random = new Random();
                let draws = 0;
                random.next = () => { draws++; return 0; };
                world.resources.set(RandomResource, random);
                press(world, BOARDER, 'board');
                expect(draws).toBe(1); // the money booty's draw
                press(world, BOARDER, 'plunderCapture');
                expect(draws).toBe(1);
                expect(boarder.components.get(BoardingComponent)?.capture)
                    .toEqual('none');
                expect(target.components.has(PlayerEscortComponent))
                    .toBeFalse();
                // Plunder is untouched (a draw that does not trip the
                // hulk's self-destruct).
                random.next = () => 0.99;
                press(world, BOARDER, 'plunderCredits');
                expect(boarder.components.get(CreditsComponent)!.credits)
                    .toBeGreaterThan(0);
            });

        it('replays the board identically after a rollback', async () => {
            // The world's own seeded PRNG, a hull dear enough that the
            // draw matters (750,000: 18 steps).
            const { world, boarder, target } = await boardingWorld();
            target.components.set(ShipDataComponent, {
                ...target.components.get(ShipDataComponent)!,
                price: 750_000,
            });
            world.step();
            const beforeBoard = snapshotWorld(world);
            const run = () => {
                press(world, BOARDER, 'board');
                const credits = world.entities.get(BOARDER)!.components
                    .get(BoardingComponent)?.creditsAvailable;
                const hashes = [hashWorld(world).hash];
                for (let i = 0; i < 30; i++) {
                    world.step();
                    hashes.push(hashWorld(world).hash);
                }
                return { credits, hashes };
            };
            const first = run();
            expect(first.credits).toBeGreaterThanOrEqual(18_750);
            expect(first.credits).toBeLessThanOrEqual(35_750);
            expect((first.credits! - 18_750) % 1_000).toEqual(0);

            restoreWorld(world, beforeBoard, deriveEntityComponents);
            expect(world.entities.get(BOARDER)!.components
                .has(BoardingComponent)).toBeFalse();
            const second = run();
            expect(second.credits).toEqual(first.credits);
            expect(second.hashes).toEqual(first.hashes);

            const policies = world.resources.get(SnapshotPoliciesResource)!;
            expect([...policies.unhandled]).toEqual([]);
        });

        /**
         * The 2026-11-27 nova:479 desync. Opening a plunder session sizes
         * the Ammo booty (ammoPlunderInputs), which looks up each of the
         * victim's ammo weapons in the BOARDER's WeaponsState. A live
         * world held the derived DefaultMap there, so that lookup CREATED
         * a hashed {count: 0, firing: false} entry for every weapon the
         * boarder doesn't mount; a world that had restored since (every
         * rolling-back client, every replay) held the codec's plain Map
         * and created nothing. Only the never-restored server archive
         * kept the phantoms, and it was outvoted on the next checkpoint.
         */
        it('opens a session on a hulk carrying ammo for an unmounted '
            + 'weapon identically on a live and a restored world', async () => {
            const { world, boarder } = await boardingWorld({
                targetOutfits: [[SYNTHETIC.outfits.missileAmmo, 10]],
            });
            const missile = SYNTHETIC.weapons.missile;
            const before = snapshotWorld(world);
            const run = () => {
                press(world, BOARDER, 'board');
                const entity = world.entities.get(BOARDER)!;
                expect(entity.components.has(BoardingComponent)).toBeTrue();
                const hashes = [hashWorld(world).hash];
                for (let i = 0; i < 10; i++) {
                    world.step();
                    hashes.push(hashWorld(world).hash);
                }
                return hashes;
            };
            // The live boarder's WeaponsState is the one its deriver made.
            expect(boarder.components.get(WeaponsStateComponent)!.has(missile))
                .toBeFalse();
            const live = run();
            expect(world.entities.get(BOARDER)!.components
                .get(WeaponsStateComponent)!.has(missile)).toBeFalse();

            restoreWorld(world, before, deriveEntityComponents);
            const restored = run();
            expect(restored).toEqual(live);
        });
    });

    /**
     * Matthew's ruling (2026-11-24): "Upon boarding a ship, we should set
     * the player's velocity equal to that ship's." Applied in the sim on
     * the tick the board succeeds (matchBoardedVelocity); a refused board
     * changes nothing.
     */
    describe('a successful board matches the hulk\'s velocity', () => {
        /** Puts the boarder `dx` px behind the hulk on x, both moving:
         * the hulk at `hulkVelocity`, the boarder `relSpeed` px/s faster
         * along x. Returns the boarder's heading for the checks. */
        function drift(boarder: Entity, target: Entity, {
            dx = 2, hulkVelocity = new Vector(0, 0), relSpeed = 5,
        } = {}) {
            const hulk = target.components.get(MovementStateComponent)!;
            hulk.velocity = hulkVelocity;
            const movement = boarder.components.get(MovementStateComponent)!;
            movement.position = new Position(hulk.position.x - dx,
                hulk.position.y);
            movement.velocity = new Vector(hulkVelocity.x + relSpeed,
                hulkVelocity.y);
            return movement.rotation.angle;
        }

        function velocityOf(ship: Entity) {
            const { x, y } = ship.components.get(MovementStateComponent)!
                .velocity;
            return { x, y };
        }

        it('stops the boarder dead beside a hulk at rest, and the two '
            + 'stay together', async () => {
                const { world, boarder, target } = await boardingWorld();
                const heading = drift(boarder, target, { relSpeed: 7 });
                press(world, BOARDER, 'board');
                expect(boarder.components.get(BoardingComponent)?.target)
                    .toEqual(TARGET);
                expect(velocityOf(boarder)).toEqual({ x: 0, y: 0 });
                expect(velocityOf(target)).toEqual({ x: 0, y: 0 });
                // The heading is the boarder's own.
                expect(boarder.components.get(MovementStateComponent)!
                    .rotation.angle).toEqual(heading);
                // The dialog does not pause the sim: ten seconds later
                // the two hulls are exactly where the board left them.
                const gap = () => {
                    const a = boarder.components.get(MovementStateComponent)!
                        .position;
                    const b = target.components.get(MovementStateComponent)!
                        .position;
                    return { x: b.x - a.x, y: b.y - a.y };
                };
                const atBoard = gap();
                for (let i = 0; i < 600; i++) {
                    world.step();
                }
                expect(gap()).toEqual(atBoard);
            });

        it('takes a DRIFTING hulk\'s velocity on the board tick, as a new '
            + 'vector', async () => {
                const { world, boarder, target } = await boardingWorld();
                const hulkVelocity = new Vector(30, -4);
                drift(boarder, target, { hulkVelocity, relSpeed: -6 });
                press(world, BOARDER, 'board');
                expect(boarder.components.get(BoardingComponent)?.target)
                    .toEqual(TARGET);
                // The hulk's velocity AT the board (it has coasted a tick
                // since, disabledCoastSpeed); the boarder keeps it.
                expect(velocityOf(boarder)).toEqual({ x: 30, y: -4 });
                const boarderVelocity = boarder.components
                    .get(MovementStateComponent)!.velocity;
                expect(boarderVelocity).not.toBe(hulkVelocity);
            });

        it('matches on an own-escort repair too', async () => {
            const { world, boarder, target } = await boardingWorld();
            target.components.set(FormationComponent,
                { leader: BOARDER, slot: 0 });
            world.step();
            drift(boarder, target, { relSpeed: 6 });
            press(world, BOARDER, 'board');
            expect(target.components.has(DisabledComponent)).toBeFalse();
            expect(boarder.components.has(BoardingComponent)).toBeFalse();
            expect(velocityOf(boarder)).toEqual({ x: 0, y: 0 });
        });

        describe('a refused board changes nothing', () => {
            it('too slow a match ("not close enough" at 9 px/s)',
                async () => {
                    const { world, boarder, target } = await boardingWorld();
                    drift(boarder, target, { relSpeed: 9 });
                    press(world, BOARDER, 'board');
                    expect(boarder.components.has(BoardingComponent))
                        .toBeFalse();
                    expect(velocityOf(boarder)).toEqual({ x: 9, y: 0 });
                });

            it('misaligned (the silent refusal)', async () => {
                const { world, boarder, target } =
                    await boardingWorld({ aligned: false });
                drift(boarder, target, { relSpeed: 5 });
                press(world, BOARDER, 'board');
                expect(boarder.components.has(BoardingComponent))
                    .toBeFalse();
                expect(velocityOf(boarder)).toEqual({ x: 5, y: 0 });
            });

            it('a hulk already plundered ("You can\'t board this ship.")',
                async () => {
                    const { world, boarder, target } = await boardingWorld();
                    target.components.set(BoardedComponent, {
                        boarder: SECOND_BOARDER, active: false,
                        plundered: true,
                    });
                    drift(boarder, target, { relSpeed: 5 });
                    press(world, BOARDER, 'board');
                    expect(boarder.components.has(BoardingComponent))
                        .toBeFalse();
                    expect(velocityOf(boarder)).toEqual({ x: 5, y: 0 });
                });
        });

        it('replays identically after a rollback', async () => {
            const { world, boarder, target } = await boardingWorld();
            drift(boarder, target,
                { hulkVelocity: new Vector(-20, 12), relSpeed: 4 });
            world.step();
            const beforeBoard = snapshotWorld(world);
            const run = () => {
                press(world, BOARDER, 'board');
                const velocity = velocityOf(world.entities.get(BOARDER)!);
                const hashes = [hashWorld(world).hash];
                for (let i = 0; i < 30; i++) {
                    world.step();
                    hashes.push(hashWorld(world).hash);
                }
                return { velocity, hashes };
            };
            const first = run();
            expect(world.entities.get(BOARDER)!.components
                .get(BoardingComponent)?.target).toEqual(TARGET);
            // The board is what set it: the snapshot's boarder is still
            // 4 px/s off the hulk.
            const restored = () => {
                restoreWorld(world, beforeBoard, deriveEntityComponents);
                return velocityOf(world.entities.get(BOARDER)!);
            };
            expect(restored()).not.toEqual(first.velocity);
            const second = run();
            expect(second.velocity).toEqual(first.velocity);
            expect(second.hashes).toEqual(first.hashes);
        });
    });

    it('takes cargo, credits, and fuel and charges the board crime',
        async () => {
            const { world, boarder, target } = await boardingWorld();
            const price = target.components.get(ShipDataComponent)!.price;
            press(world, BOARDER, 'board');
            // No take trips the hulk's self-destruct (Cargo's is 0.85:
            // the seeded draws would end the session here).
            const random = new Random();
            random.next = () => 0.99;
            world.resources.set(RandomResource, random);

            press(world, BOARDER, 'plunderCargo');
            expect(boarder.components.get(CargoComponent)!.get('cargo:0'))
                .toEqual(2);
            expect(target.components.get(CargoComponent)!.get('cargo:0'))
                .toBeUndefined();

            press(world, BOARDER, 'plunderCredits');
            expect(boarder.components.get(CreditsComponent)!.credits)
                .toEqual(creditBooty(price, 0));

            press(world, BOARDER, 'plunderFuel');
            expect(boarder.components.get(FuelComponent)!.current)
                .toBeGreaterThanOrEqual(30);
            expect(target.components.get(FuelComponent)!.current).toEqual(0);

            // Pirating charged the BoardPenalty against the victim's govt.
            const record = boarder.components.get(LegalRecordsComponent)!
                .get(MERIDIAN);
            expect(record).toBeLessThan(0);
        });

    it('does not double-take cargo on a repeated press', async () => {
        const { world, boarder, target } = await boardingWorld({
            cargo: new Map([['cargo:0', 2]]),
        });
        press(world, BOARDER, 'board');
        press(world, BOARDER, 'plunderCargo');
        // Refill the victim; a repeat press must not take again.
        target.components.set(CargoComponent, new Map([['cargo:0', 5]]));
        press(world, BOARDER, 'plunderCargo');
        expect(boarder.components.get(CargoComponent)!.get('cargo:0'))
            .toEqual(2);
    });

    /** Runs the whole capture flow and takes the prize as an escort.
     * The single attempt a session gets is forced to land. */
    function captureAsEscort(world: World, boarder: Entity) {
        forceCaptureRoll(world, true);
        press(world, BOARDER, 'board');
        press(world, BOARDER, 'plunderCapture');
        expect(boarder.components.get(BoardingComponent)?.capture)
            .toEqual('succeeded');
        useAsEscort(world, BOARDER);
    }

    /**
     * Matthew's LAN playtest, bug 3: "I captured a ship that I didn't have
     * space for in my bay ... normal capture dialogue ... but then when I
     * commanded it, it became not my escort anymore. Says it is and hails
     * like it is, but I can't command it, and it targets like a normal
     * ship. Can't hit them with my weapons, though."
     *
     * The prize in that story was a ship of a class his bay launches — i.e.
     * an NPC carrier's WING — taken through the plunder dialog because the
     * bay had no room. convertToEscort stamped the escort set on top of the
     * hull's still-live bay identity, and the escort commands then acted on
     * the stale half: returnToBay believed the ship was bay-launched, so it
     * deleted the formation link and flew the prize home to its old
     * carrier. With the formation link gone, both one-hop parent lookups
     * fell through to the stale OwnerComponent (the old carrier), which is
     * simultaneously why the player could not command it (escortParent) and
     * why the target cycle stopped hiding it (flockParent — OwnerComponent
     * shadows the firing group) — while the firing group still named the
     * player, so the player's shots kept passing through.
     *
     * These specs pin all four "is this my escort" predicates together
     * after EVERY command, since the bug was precisely them disagreeing.
     */
    describe('a captured wing stays a whole escort under every command',
        () => {
            const OLD_CARRIER = 'old carrier';
            const VICTIM = 'some third party';

            /**
             * A disabled NPC ship wearing a bay fighter's full identity
             * (launch link, owner chain, return-home marker), captured
             * through the plunder dialog.
             */
            async function capturedWingWorld({ carrierAlive = true } = {}) {
                const ctx = await boardingWorld({ boarderCrew: 500,
                    targetCrew: 1 });
                const { world, boarder, target } = ctx;
                // A player-controlled captor, as any real boarding is.
                boarder.components.set(ControlledByComponent,
                    { peerId: 'test peer' });
                if (carrierAlive) {
                    const carrier = new Entity();
                    carrier.components.set(ShipComponent, { id: SYNTHETIC.ships.skiff });
                    world.entities.set(OLD_CARRIER, carrier);
                }
                // Something for an 'attack' order to be aimed at.
                const victim = new Entity();
                victim.components.set(ShipComponent, { id: SYNTHETIC.ships.skiff });
                victim.components.set(MovementStateComponent, {
                    position: new Position(3000, 0), velocity: new Vector(0, 0),
                    rotation: new Angle(0), turning: 0, turnBack: false,
                    accelerating: 0,
                });
                world.entities.set(VICTIM, victim);
                // The hull's bay identity, exactly as bay_plugin's launch
                // stamps it.
                target.components.set(OwnerComponent, { owner: OLD_CARRIER });
                target.components.set(SourceComponent, OLD_CARRIER);
                target.components.set(BayFighterComponent,
                    { bayWeaponId: 'nova:some bay' });
                target.components.set(ReturnWhenTargetRemovedComponent,
                    undefined);
                world.step();

                captureAsEscort(world, boarder);
                return ctx;
            }

            /** Every "is this my escort" predicate, read at once. */
            function escortPredicates(world: World, target: Entity) {
                const getEntity = (u: string) => world.entities.get(u);
                return {
                    // Commandable by the player (escort_command_plugin).
                    commandableBy: escortParent(target),
                    // Flock membership: the target-cycle exclusion, the
                    // escort cycle, and the friendly corners (flock.ts).
                    inFlock: isInFlock(TARGET, BOARDER, getEntity),
                    // Friendly fire passes through (firing_group.ts).
                    firingGroup:
                        target.components.get(FiringGroupComponent)?.group,
                    // The hail dialog's one-hop predicate.
                    hailsAsEscort:
                        (target.components.get(FormationComponent)?.leader
                            ?? target.components.get(OwnerComponent)?.owner)
                        === BOARDER,
                };
            }

            it('is a consistent escort the moment it is captured',
                async () => {
                    const { world, target } = await capturedWingWorld();
                    expect(escortPredicates(world, target)).toEqual({
                        commandableBy: BOARDER, inFlock: true,
                        firingGroup: BOARDER, hailsAsEscort: true,
                    });
                    // The old owner's identity is gone, not layered under
                    // the new one.
                    expect(target.components.has(OwnerComponent)).toBeFalse();
                    expect(target.components.has(SourceComponent)).toBeFalse();
                    expect(target.components.has(BayFighterComponent))
                        .toBeFalse();
                    expect(target.components
                        .has(ReturnWhenTargetRemovedComponent)).toBeFalse();
                    // Durable ownership is stamped at once, not a tick
                    // later, so nothing can retire it in between — and it
                    // carries the PROVENANCE that makes this hull sellable
                    // and wage-free (player_escort.ts).
                    expect(target.components.get(PlayerEscortComponent))
                        .toEqual({
                            player: BOARDER, parent: BOARDER,
                            provenance: 'captured',
                            deal: NO_DEAL,
                            // The skiff carries no ammunition.
                            ammoStock: [],
                        });
                });

            for (const command of ['attack', 'defend', 'formation',
                'holdPosition', 'returnToBay']) {
                it(`stays a consistent escort after '${command}'`,
                    async () => {
                        const { world, boarder, target } =
                            await capturedWingWorld();
                        boarder.components.get(TargetComponent)!.target =
                            VICTIM;

                        press(world, BOARDER, command);
                        world.step();
                        world.step();

                        expect(escortPredicates(world, target)).toEqual({
                            commandableBy: BOARDER, inFlock: true,
                            firingGroup: BOARDER, hailsAsEscort: true,
                        });
                    });
            }

            it('stays out of the normal target cycle after returnToBay',
                async () => {
                    // The symptom that made the divergence visible: the
                    // prize reappeared in the tab cycle.
                    const { world, boarder, target } =
                        await capturedWingWorld();
                    expect(target.components.has(DisabledComponent))
                        .toBeFalse();

                    press(world, BOARDER, 'returnToBay');
                    world.step();
                    boarder.components.get(TargetComponent)!.target =
                        undefined;
                    press(world, BOARDER, 'nearestTarget');

                    expect(boarder.components.get(TargetComponent)!.target)
                        .not.toEqual(TARGET);
                });

            it('is not retired by the orphan sweep when its old carrier is '
                + 'already dead', async () => {
                    // The other half of the stale identity: with no live
                    // carrier, OrphanedBayFighterSystem used to delete the
                    // prize's escort command and formation link and send it
                    // departing, in the tick before the durable marker
                    // landed.
                    const { world, target } =
                        await capturedWingWorld({ carrierAlive: false });
                    world.step();
                    world.step();

                    expect(escortPredicates(world, target)).toEqual({
                        commandableBy: BOARDER, inFlock: true,
                        firingGroup: BOARDER, hailsAsEscort: true,
                    });
                    expect(target.components.get(EscortCommandComponent)
                        ?.command).toEqual('formation');
                    expect(target.components.get(NpcComponent)?.mode)
                        .not.toEqual('depart');
                });
        });

    it('gives a captured prize a slot past the highest live one, not the'
        + ' sibling count (regression: a mid-formation death made two'
        + ' escorts share a station)', async () => {
            const { world, boarder, target } = await boardingWorld({
                boarderCrew: 500, targetCrew: 1,
            });
            // The boarder already leads slots 0, 1, 2 — then slot 1 dies.
            for (const slot of [0, 2]) {
                const escort = new Entity();
                escort.components.set(FormationComponent,
                    { leader: BOARDER, slot });
                world.entities.set(`escort${slot}`, escort);
            }
            world.step();

            captureAsEscort(world, boarder);

            const formation = target.components.get(FormationComponent)!;
            expect(formation.leader).toEqual(BOARDER);
            // Counting siblings would hand out 2, colliding with escort2.
            expect(formation.slot).toEqual(3);
        });

    it('captures and assigns the ship as an escort', async () => {
        const { world, boarder, target } = await boardingWorld({
            boarderCrew: 500, targetCrew: 1,
        });
        forceCaptureRoll(world, true);
        press(world, BOARDER, 'board');
        press(world, BOARDER, 'plunderCapture');
        expect(boarder.components.get(BoardingComponent)?.capture)
            .toEqual('succeeded');

        useAsEscort(world, BOARDER);
        // Now an escort of the boarder: formation flock, escort command,
        // shared firing group, no govt, no longer disabled.
        expect(target.components.get(FormationComponent)?.leader)
            .toEqual(BOARDER);
        expect(target.components.get(EscortCommandComponent)?.command)
            .toEqual('formation');
        expect(target.components.get(FiringGroupComponent)?.group)
            .toEqual(BOARDER);
        expect(target.components.has(GovtComponent)).toBeFalse();
        expect(target.components.has(DisabledComponent)).toBeFalse();
        // Session ended.
        expect(boarder.components.has(BoardingComponent)).toBeFalse();
    });

    /**
     * ========================================================================
     * THE ESCORT CAP (maintainer rulings #161 and #250)
     * ========================================================================
     * A captured prize the player keeps is an escort, so once the player
     * already has MAX_ESCORTS hired-or-captured escorts in the world the
     * capture ATTEMPT is unavailable: the plunder dialog greys Capture
     * (display/boarding_dialog_test) and the sim ignores the press — no
     * roll, no state change, no crime, the session open and the booty on
     * offer. Nothing is refused with a message any more. Mission escorts
     * and bay fighters do not count.
     */
    describe('the escort cap on a capture', () => {
        function flock(world: World, n: number,
            ...extra: ('fighter' | 'mission')[]) {
            for (let i = 0; i < n; i++) {
                const escort = new Entity();
                escort.components.set(PlayerEscortComponent,
                    { player: BOARDER, provenance: 'hired', deal: NO_DEAL });
                if (extra.includes('fighter')) {
                    escort.components.set(BayFighterComponent,
                        { bayWeaponId: 'nova:150', slot: i } as any);
                }
                if (extra.includes('mission')) {
                    escort.components.set(MissionShipComponent, {} as any);
                }
                world.entities.set(`flock ${extra.join('+')} ${i}`, escort);
            }
        }

        it('ignores a capture attempt at the cap: no roll, the session '
            + 'open, the booty on offer, Done releases the hulk', async () => {
                const { world, boarder, target } = await boardingWorld({
                    boarderCrew: 500, targetCrew: 1,
                });
                flock(world, MAX_ESCORTS);
                // A roll that would succeed — if one were made. It is not:
                // the attempt is unavailable, and the seeded stream is
                // untouched (a press that drew would desync a peer whose
                // dialog greyed the button off the same count).
                const random = new Random();
                let draws = 0;
                random.next = () => { draws++; return 0; };
                world.resources.set(RandomResource, random);
                press(world, BOARDER, 'board');
                // The board itself draws once, for the money booty's
                // random part (ruling #378); the capture press none.
                expect(draws).toBe(1);
                press(world, BOARDER, 'plunderCapture');
                expect(draws).toBe(1);
                expect(boarder.components.get(BoardingComponent)?.capture)
                    .toEqual('none');
                // Not converted: no escort link, still the hulk it was.
                expect(target.components.has(PlayerEscortComponent)).toBeFalse();
                expect(target.components.has(FormationComponent)).toBeFalse();
                expect(target.components.has(GovtComponent)).toBeTrue();
                expect(target.components.has(DisabledComponent)).toBeTrue();
                // The keep press has nothing to keep either.
                useAsEscort(world, BOARDER);
                expect(boarder.components.get(BoardingComponent)?.capture)
                    .toEqual('none');
                expect(target.components.has(PlayerEscortComponent)).toBeFalse();
                // The booty is still there for the taking (a draw that
                // does not trip the hulk's self-destruct)...
                random.next = () => { draws++; return 0.99; };
                press(world, BOARDER, 'plunderCargo');
                expect(boarder.components.get(BoardingComponent)?.cargoTaken)
                    .toBeTrue();
                // ...and Done releases the hulk as ever.
                press(world, BOARDER, 'plunderDone');
                expect(boarder.components.has(BoardingComponent)).toBeFalse();
                expect(target.components.has(PlayerEscortComponent)).toBeFalse();
            });

        /**
         * An unavailable attempt is not an attempt: the piracy charge is
         * for the capture ROLL ("either way"), and no roll was made. The
         * plunder itself still charges, as it always did.
         */
        it('charges no crime for an attempt that was unavailable', async () => {
            const { world, boarder } = await boardingWorld({
                boarderCrew: 500, targetCrew: 1,
            });
            flock(world, MAX_ESCORTS);
            forceCaptureRoll(world, true);
            const record = () =>
                boarder.components.get(LegalRecordsComponent)!
                    .get(MERIDIAN);
            press(world, BOARDER, 'board');
            expect(record()).toBeUndefined();
            press(world, BOARDER, 'plunderCapture');
            expect(record()).toBeUndefined();
            expect(boarder.components.get(BoardingComponent)?.crimeApplied)
                .toBeFalse();
            press(world, BOARDER, 'plunderCargo');
            expect(record()).toBeLessThan(0);
        });

        it('keeps the prize one under the cap, and it then fills the cap',
            async () => {
                const { world, boarder, target } = await boardingWorld({
                    boarderCrew: 500, targetCrew: 1,
                });
                // A player-flown captor, so the prize is stamped as the
                // player's captured escort on the spot.
                boarder.components.set(ControlledByComponent,
                    { peerId: 'me' } as any);
                flock(world, MAX_ESCORTS - 1);
                expect(cappedEscortCount(BOARDER, { world: world.entities }))
                    .toBe(MAX_ESCORTS - 1);
                captureAsEscort(world, boarder);
                expect(target.components.get(PlayerEscortComponent))
                    .toEqual(jasmine.objectContaining(
                        { player: BOARDER, provenance: 'captured' }));
                expect(boarder.components.has(BoardingComponent)).toBeFalse();
                // Captured escorts count: the cap is now full.
                expect(cappedEscortCount(BOARDER, { world: world.entities }))
                    .toBe(MAX_ESCORTS);
            });

        /**
         * Matthew's ruling (2026-11-24): a kept prize is the player's own
         * hull, so it rearms back up to the ammo it had at the capture,
         * not to capacity (player_escort.ts's OWNED ESCORT AMMO). The
         * snapshot is ammo outfits only.
         */
        it('snapshots the prize\'s ammo at the capture', async () => {
            const { world, boarder, target } = await boardingWorld({
                boarderCrew: 500, targetCrew: 1,
                targetOutfits: [
                    [SYNTHETIC.outfits.launcher, 1],
                    [SYNTHETIC.outfits.missileAmmo, 3],
                    [SYNTHETIC.outfits.blaster, 1],
                ],
            });
            boarder.components.set(ControlledByComponent,
                { peerId: 'me' } as any);
            captureAsEscort(world, boarder);
            expect(target.components.get(PlayerEscortComponent)?.ammoStock)
                .toEqual([[SYNTHETIC.outfits.missileAmmo, 3]]);
        });

        it('does not count mission escorts or bay fighters', async () => {
            const { world, boarder, target } = await boardingWorld({
                boarderCrew: 500, targetCrew: 1,
            });
            boarder.components.set(ControlledByComponent,
                { peerId: 'me' } as any);
            // Five hired, a mission's three, and a wing of eight: the
            // capped count is five, so the prize is kept.
            flock(world, MAX_ESCORTS - 1);
            flock(world, 3, 'mission');
            flock(world, 8, 'fighter');
            expect(cappedEscortCount(BOARDER, { world: world.entities }))
                .toBe(MAX_ESCORTS - 1);
            captureAsEscort(world, boarder);
            expect(target.components.get(PlayerEscortComponent)?.player)
                .toEqual(BOARDER);
            expect(boarder.components.has(BoardingComponent)).toBeFalse();
        });
    });

    /**
     * ========================================================================
     * CAPTURE RESETS HOSTILITY (Matthew's ruling)
     * ========================================================================
     *
     * A prize must come out of a capture standing exactly where a freshly
     * HIRED escort of the same player stands. Shedding the hull's
     * government was only half of it: every OTHER ship in the system was
     * still carrying its own memory of the hull — a live target lock, the
     * "who hit me last" aggressor slot, a player's behavioural aggression
     * entry — and those memories put the prize straight back under fire
     * from the fleet it had just left.
     *
     * See clearHostilityToward for the full audit, including what is
     * deliberately NOT touched and why.
     */
    it('a captured MISSION SHIP sheds its mission-special identity',
        async () => {
            // The Bible is silent on capturing a mission ship (its only
            // word on missions and plunder is gövt Flags 0x1000's
            // "non-mission" exclusion, which keeps NPC pirates off them),
            // so this is Matthew's ruling: the capture is allowed and the
            // prize stops being the mission's prop. Dropping the tag is
            // what keeps MissionShipCleanupSystem from deleting the
            // player's new escort when the mission ends, keeps the tracker
            // from crediting goal progress for a ship the player owns, and
            // leaves the respawn count where it was so the mission simply
            // sends a replacement.
            const { world, boarder, target } = await boardingWorld({
                boarderCrew: 500, targetCrew: 1,
            });
            // A live mission held by the boarder, whose special ship the
            // hulk is. The mission has to really exist on a live owner or
            // MissionShipCleanupSystem would delete the hulk before it
            // could be boarded at all.
            boarder.components.set(MissionsComponent, new Map([['nova:9999', {
                id: 'nova:9999', acceptedDay: 0, acceptedAt: SYNTHETIC.planets.port,
                travelPlanet: null, returnPlanet: SYNTHETIC.planets.port, cargoType: -1,
                cargoQty: 0, cargoLoaded: false, travelDone: false,
                deadlineDay: null,
            }]]));
            target.components.set(MissionShipComponent,
                { mission: 'nova:9999', owner: BOARDER });
            // ...and the in-system hold that pinned it here as a mission
            // target (system_hold.ts).
            target.components.set(SystemHoldComponent,
                { reason: 'missionGoal' });
            world.step();
            // Precondition: it survived as a mission ship.
            expect(target.components.has(MissionShipComponent)).toBeTrue();

            captureAsEscort(world, boarder);

            expect(target.components.has(MissionShipComponent)).toBeFalse();
            // The unfinished business goes with the identity: a prize that
            // could never leave the system it was taken in would be a
            // strange thing to own.
            expect(target.components.has(SystemHoldComponent)).toBeFalse();
            expect(target.components.get(FormationComponent)?.leader)
                .toEqual(BOARDER);
        });


    /**
     * ========================================================================
     * THE CAPTURED LEADER'S WING (Matthew's ruling)
     * ========================================================================
     *
     * An NPC fleet shares two links naming its leader — every escort holds
     * FormationComponent.leader on it AND FiringGroupComponent.group on it
     * (npc_spawn_plugin) — and flock.ts walks exactly those two edges. So
     * capturing the leader used to drag the whole wing into the player's
     * flock: friendly corners, hidden from tab/r, immune to the player's
     * shots, while keeping their own government and their own reasons to
     * kill the player.
     *
     * The ruling: the wing keeps its original government and allegiance
     * and elects one of its own. See reassignCapturedWing for the election
     * rule (most shïp Strength, ties to the smallest uuid).
     */
    describe('the captured leader\'s wing', () => {
        const WING = ['wing:a', 'wing:b', 'wing:c'];

        /**
         * A capture world where the victim leads a wing of three, linked
         * the way npc_spawn_plugin links a real NPC fleet. `strengths` are
         * the shïp Strength ratings, in WING order.
         */
        async function wingWorld(strengths = [10, 30, 20]) {
            const ctx = await boardingWorld({
                boarderCrew: 500, targetCrew: 1,
            });
            const { world, boarder } = ctx;
            boarder.components.set(ControlledByComponent,
                { peerId: 'test peer' });
            WING.forEach((uuid, i) => {
                const ship = new Entity(uuid);
                ship.components.set(NpcComponent,
                    { aiType: 3, aggressor: BOARDER, mode: 'attack' });
                ship.components.set(GovtComponent, { id: RAIDERS });
                ship.components.set(ShipDataComponent,
                    { ...getDefaultShipData(), strength: strengths[i] });
                ship.components.set(FormationComponent,
                    { leader: TARGET, slot: i });
                ship.components.set(FiringGroupComponent, { group: TARGET });
                world.entities.set(uuid, ship);
            });
            world.step();
            return ctx;
        }

        const flockOf = (world: World, uuid: string) =>
            isInFlock(uuid, BOARDER, u => world.entities.get(u));

        it('elects the strongest survivor and re-forms the rest on it',
            async () => {
                const { world, boarder } = await wingWorld([10, 30, 20]);
                // Precondition: capturing the leader really would have
                // swept them in.
                expect(flockOf(world, 'wing:a')).toBeFalse();

                captureAsEscort(world, boarder);

                // 'wing:b' has the most ship (30).
                const leader = world.entities.get('wing:b')!;
                expect(leader.components.has(FormationComponent)).toBeFalse();
                expect(leader.components.get(FiringGroupComponent)?.group)
                    .toEqual('wing:b');
                for (const uuid of ['wing:a', 'wing:c']) {
                    const ship = world.entities.get(uuid)!;
                    expect(ship.components.get(FormationComponent)?.leader)
                        .withContext(uuid).toEqual('wing:b');
                    expect(ship.components.get(FiringGroupComponent)?.group)
                        .withContext(uuid).toEqual('wing:b');
                }
                // Slots are handed out in uuid order, so the layout does
                // not depend on entity-map iteration order.
                expect(world.entities.get('wing:a')!.components
                    .get(FormationComponent)?.slot).toEqual(0);
                expect(world.entities.get('wing:c')!.components
                    .get(FormationComponent)?.slot).toEqual(1);
            });

        it('breaks a strength tie toward the smallest uuid', async () => {
            const { world, boarder } = await wingWorld([30, 30, 30]);
            captureAsEscort(world, boarder);
            expect(world.entities.get('wing:a')!.components
                .has(FormationComponent)).toBeFalse();
            expect(world.entities.get('wing:b')!.components
                .get(FormationComponent)?.leader).toEqual('wing:a');
        });

        it('keeps the wing hostile: original govt, grudges, and NOT in the '
            + 'player\'s flock', async () => {
                const { world, boarder } = await wingWorld();
                captureAsEscort(world, boarder);

                for (const uuid of WING) {
                    const ship = world.entities.get(uuid)!;
                    expect(ship.components.get(GovtComponent)?.id)
                        .withContext(uuid).toEqual(RAIDERS);
                    // Their quarrel with the player is untouched — only
                    // memories of the PRIZE are swept (clearHostilityToward).
                    expect(ship.components.get(NpcComponent)?.aggressor)
                        .withContext(uuid).toEqual(BOARDER);
                    // The whole point: the chain terminates at the new
                    // leader instead of climbing to the captor, so they
                    // are targetable and shootable again.
                    expect(flockOf(world, uuid))
                        .withContext(uuid).toBeFalse();
                    expect(ship.components.has(PlayerEscortComponent))
                        .withContext(uuid).toBeFalse();
                }
            });

        it('retires a captured CARRIER\'s fighters instead of electing them',
            async () => {
                // Matthew's carve-out: launched fighters are ordnance whose
                // hangar changed hands, not a fleet that can elect anybody.
                // They take the existing orphaned-fighter path — which
                // OrphanedBayFighterSystem cannot run itself here, since it
                // only fires when the carrier has LEFT the world and this
                // carrier is flying for the other side.
                const { world, boarder } = await boardingWorld({
                    boarderCrew: 500, targetCrew: 1,
                });
                boarder.components.set(ControlledByComponent,
                    { peerId: 'test peer' });
                const fighter = new Entity('wing:fighter');
                fighter.components.set(BayFighterComponent,
                    { bayWeaponId: 'nova:200' });
                fighter.components.set(SourceComponent, TARGET);
                fighter.components.set(OwnerComponent, { owner: TARGET });
                fighter.components.set(FormationComponent,
                    { leader: TARGET, slot: 0 });
                fighter.components.set(FiringGroupComponent,
                    { group: TARGET });
                fighter.components.set(EscortCommandComponent,
                    { command: 'attack' });
                world.entities.set('wing:fighter', fighter);
                world.step();

                captureAsEscort(world, boarder);

                expect(fighter.components.get(NpcComponent)?.mode)
                    .toEqual('depart');
                expect(fighter.components.get(NpcComponent)?.aiType)
                    .toEqual(3);
                // Every link back to the hull the player now owns is gone.
                expect(fighter.components.has(BayFighterComponent)).toBeFalse();
                expect(fighter.components.has(SourceComponent)).toBeFalse();
                expect(fighter.components.has(OwnerComponent)).toBeFalse();
                expect(fighter.components.has(FormationComponent)).toBeFalse();
                expect(fighter.components.has(EscortCommandComponent))
                    .toBeFalse();
                expect(flockOf(world, 'wing:fighter')).toBeFalse();
            });

        it('leaves the captor\'s own escorts alone', async () => {
            // A ship already marked as the player's is genuinely theirs,
            // whatever it happens to be flying next to.
            const { world, boarder } = await wingWorld();
            const mine = world.entities.get('wing:a')!;
            mine.components.set(PlayerEscortComponent,
                { player: BOARDER, parent: BOARDER, deal: NO_DEAL });
            world.step();

            captureAsEscort(world, boarder);

            expect(mine.components.get(FormationComponent)?.leader)
                .toEqual(TARGET);
            // And the election ran among the ships that were actually
            // swept: 'wing:c' (20) beats 'wing:b' (30)? No — b is stronger.
            expect(world.entities.get('wing:b')!.components
                .has(FormationComponent)).toBeFalse();
        });

        it('regroups the wing after a BAY capture too', async () => {
            // The prize leaves the world there, so FormationSystem's
            // leader-gone rule would eventually drop the links — but that
            // scatters the wing instead of regrouping it.
            const { world } = await wingWorld();
            world.entities.delete(TARGET);
            reassignCapturedWing(TARGET, world.entities);

            expect(world.entities.get('wing:b')!.components
                .has(FormationComponent)).toBeFalse();
            expect(world.entities.get('wing:a')!.components
                .get(FormationComponent)?.leader).toEqual('wing:b');
            expect(flockOf(world, 'wing:a')).toBeFalse();
        });
    });

    describe('capture resets everyone else\'s hostility to the prize', () => {
        const BYSTANDER = 'some warship';

        /**
         * A capture world with a third ship that hates the victim: an NPC
         * warship locked onto it and in attack posture, holding it as its
         * aggressor too, plus a rival player carrying a behavioural
         * aggression entry against it.
         */
        async function hostileWorld() {
            const ctx = await boardingWorld({
                boarderCrew: 500, targetCrew: 1,
            });
            const { world, boarder } = ctx;
            boarder.components.set(ControlledByComponent,
                { peerId: 'test peer' });

            const bystander = new Entity();
            bystander.components.set(NpcComponent, {
                aiType: 3, mode: 'attack', aggressor: TARGET,
                nextDecision: 1e12,
            });
            bystander.components.set(TargetComponent, { target: TARGET });
            bystander.components.set(GovtComponent, { id: RAIDERS });
            // A rival player who traded shots with the victim.
            bystander.components.set(AggressionComponent, new Map([
                [TARGET, { at: 0, damage: 100, hostile: true }],
                ['someone else', { at: 0, damage: 100, hostile: true }],
            ]));
            world.entities.set(BYSTANDER, bystander);
            world.step();
            return { ...ctx, bystander };
        }

        it('drops every NPC target lock and attack posture aimed at it',
            async () => {
                const { world, boarder, bystander } = await hostileWorld();
                // Precondition: it really is gunning for the victim.
                expect(bystander.components.get(TargetComponent)?.target)
                    .toEqual(TARGET);
                expect(bystander.components.get(NpcComponent)?.mode)
                    .toEqual('attack');

                captureAsEscort(world, boarder);

                expect(bystander.components.get(TargetComponent)?.target)
                    .toBeUndefined();
                expect(bystander.components.get(NpcComponent)?.mode)
                    .toBeUndefined();
            });

        it('forgets the aggressor slot, so it is not re-acquired next think',
            async () => {
                // The durable half. Clearing only the target slot would
                // leave the prize back in `engageable` on the very next
                // decision tick, because the aggressor is pushed in
                // unconditionally.
                const { world, boarder, bystander } = await hostileWorld();
                captureAsEscort(world, boarder);

                expect(bystander.components.get(NpcComponent)?.aggressor)
                    .toBeUndefined();
                // And it re-plans immediately rather than orbiting an
                // ex-enemy for the rest of its decision interval.
                expect(bystander.components.get(NpcComponent)?.nextDecision)
                    .toEqual(0);
            });

        it('clears behavioural aggression entries about the prize only',
            async () => {
                // This is the PvP half: without it a rival player goes on
                // seeing red corners on their fellow player's new escort,
                // and 'r' goes on picking it. Other entries are untouched.
                const { world, boarder, bystander } = await hostileWorld();
                captureAsEscort(world, boarder);

                const aggression =
                    bystander.components.get(AggressionComponent)!;
                expect(aggression.has(TARGET)).toBeFalse();
                expect(aggression.has('someone else')).toBeTrue();
            });

        it('leaves the prize standing exactly where a hired escort stands',
            async () => {
                // "Hostile only to whoever is hostile to the player": the
                // prize has no government of its own to be judged on, it
                // is in the player's flock, and it carries no outbound
                // hostility either.
                const { world, boarder, target } = await hostileWorld();
                captureAsEscort(world, boarder);

                expect(target.components.has(GovtComponent)).toBeFalse();
                expect(isInFlock(TARGET, BOARDER,
                    uuid => world.entities.get(uuid))).toBeTrue();
                expect(target.components.get(TargetComponent)?.target)
                    .toBeUndefined();
                expect(target.components.get(NpcComponent)?.aggressor)
                    .toBeUndefined();
                expect(target.components.get(NpcComponent)?.mode)
                    .toBeUndefined();
            });

        it('does the same sweep for the bay-capture shortcut', async () => {
            // The hull leaves the world there, so nothing can shoot it —
            // but no NPC may be left holding a lock or an aggressor slot
            // naming a uuid that no longer exists, and both capture routes
            // must leave the world in the same shape.
            const { world, target, bystander } = await hostileWorld();
            // Stand in for the shortcut's effect on the rest of the world:
            // the prize is gone and the sweep has run.
            world.entities.delete(TARGET);
            clearHostilityToward(TARGET, world.entities);
            expect(target).toBeDefined();

            expect(bystander.components.get(TargetComponent)?.target)
                .toBeUndefined();
            expect(bystander.components.get(NpcComponent)?.aggressor)
                .toBeUndefined();
            expect(bystander.components.get(AggressionComponent)!.has(TARGET))
                .toBeFalse();
        });

        it('does not disturb a bribe that names the prize', async () => {
            // pacifiedFrom is a bribe to LEAVE IT ALONE; clearing it would
            // restore hostility rather than remove it.
            const { world, boarder, bystander } = await hostileWorld();
            const npc = bystander.components.get(NpcComponent)!;
            npc.pacifiedFrom = TARGET;
            world.step();

            captureAsEscort(world, boarder);

            expect(bystander.components.get(NpcComponent)?.pacifiedFrom)
                .toEqual(TARGET);
        });
    });

    describe('boarding your OWN disabled flock member repairs it', () => {
        // Records EscortRepairedEvent so the sim-side status feedback is
        // observable (the event is targeted at the boarder).
        function recordRepairs(world: World): string[] {
            const seen: string[] = [];
            world.addSystem(new System({
                name: 'RepairRecorder',
                events: [EscortRepairedEvent],
                args: [UUID] as const,
                step(uuid) { seen.push(uuid); },
            }));
            return seen;
        }

        async function ownEscortWorld() {
            const ctx = await boardingWorld();
            // Make the disabled target the boarder's escort (flock member).
            ctx.target.components.set(FormationComponent,
                { leader: BOARDER, slot: 0 });
            ctx.world.step();
            return ctx;
        }

        it('repairs the escort and opens NO plunder session', async () => {
            const { world, boarder, target } = await ownEscortWorld();
            const repairs = recordRepairs(world);
            const shipData = target.components.get(ShipDataComponent)!;

            press(world, BOARDER, 'board');

            // No plunder session on either side.
            expect(boarder.components.has(BoardingComponent)).toBeFalse();
            expect(target.components.has(BoardedComponent)).toBeFalse();
            // Repaired: no longer disabled, armor lifted above threshold
            // (threshold + REPAIR_MARGIN_FRACTION), and the shield NOT
            // recharged: the original's repaired escort read "Shields
            // Down" (reference "Reviving a disabled ally, wave 11").
            expect(target.components.has(DisabledComponent)).toBeFalse();
            const armor = target.components.get(ArmorComponent)!;
            expect(isBelowDisableThreshold(armor, shipData.disableArmorFraction))
                .toBeFalse();
            expect(armor.current).toEqual(
                (shipData.disableArmorFraction + REPAIR_MARGIN_FRACTION) * armor.max);
            const shield = target.components.get(ShieldComponent)!;
            expect(shield.current).toBeLessThan(0.01 * shield.max);
            // Status feedback fired at the boarder.
            expect(repairs).toEqual([BOARDER]);
        });

        it('replays the repair identically after a rollback', async () => {
            const { world } = await ownEscortWorld();
            const beforeBoard = snapshotWorld(world);
            const run = () => {
                press(world, BOARDER, 'board');
                const hashes = [hashWorld(world).hash];
                for (let i = 0; i < 30; i++) {
                    world.step();
                    hashes.push(hashWorld(world).hash);
                }
                return hashes;
            };
            const first = run();
            expect(world.entities.get(TARGET)!.components
                .has(DisabledComponent)).toBeFalse();
            restoreWorld(world, beforeBoard, deriveEntityComponents);
            expect(world.entities.get(TARGET)!.components
                .has(DisabledComponent)).toBeTrue();
            expect(run()).toEqual(first);
        });

        it('keeps a live escort\'s existing formation slot', async () => {
            const { world, target } = await ownEscortWorld();
            press(world, BOARDER, 'board');
            // Re-attaching an escort whose link never lapsed must not
            // shuffle it to a new station. (Pulled alongside within the
            // board square, the escort is already at its station, so the
            // formation system may also have marked it `rcs`.)
            expect(target.components.get(FormationComponent))
                .toEqual(jasmine.objectContaining({ leader: BOARDER, slot: 0 }));
        });

        it('a HOSTILE disabled ship (not your flock) still opens plunder',
            async () => {
                // Contrast case: no flock link, so the normal plunder gate
                // runs and no repair happens.
                const { world, boarder, target } = await boardingWorld();
                const repairs = recordRepairs(world);
                press(world, BOARDER, 'board');
                expect(boarder.components.get(BoardingComponent)?.target)
                    .toEqual(TARGET);
                expect(target.components.has(BoardedComponent)).toBeTrue();
                expect(target.components.has(DisabledComponent)).toBeTrue();
                expect(repairs).toEqual([]);
            });

        it('a MISSION ally flying in your formation is plundered, not '
            + 'repaired (the original, reference wave 11)', async () => {
                // mïsn ShipBehav 1 / ShipGoal 3: formation on the owner
                // and the owner's firing group (mission_ship_spawn.ts), so
                // the live flock chain reaches the boarder.
                const { world, boarder, target } = await ownEscortWorld();
                boarder.components.set(MissionsComponent, new Map([['nova:9999', {
                    id: 'nova:9999', acceptedDay: 0,
                    acceptedAt: SYNTHETIC.planets.port, travelPlanet: null,
                    returnPlanet: SYNTHETIC.planets.port, cargoType: -1,
                    cargoQty: 0, cargoLoaded: false, travelDone: false,
                    deadlineDay: null,
                }]]));
                target.components.set(MissionShipComponent,
                    { mission: 'nova:9999', owner: BOARDER });
                target.components.set(FiringGroupComponent,
                    { group: BOARDER });
                world.step();
                expect(isInFlock(TARGET, BOARDER,
                    u => world.entities.get(u))).toBeTrue();
                const repairs = recordRepairs(world);

                press(world, BOARDER, 'board');

                expect(repairs).toEqual([]);
                expect(boarder.components.get(BoardingComponent)?.target)
                    .toEqual(TARGET);
                expect(target.components.has(BoardedComponent)).toBeTrue();
                expect(target.components.has(DisabledComponent)).toBeTrue();
            });

        /**
         * Item 5: a FORMER escort. Its live chain has lapsed (no
         * formation leader, no owner, no firing group pointing at the
         * player), so isInFlock says nothing — the durable
         * PlayerEscortComponent is what still names its owner. `detached`
         * is deliberately left unset, which is the case
         * EscortReattachSystem will NOT fix on its own (it only re-attaches
         * escorts whose player was out of the world): e.g. a fighter
         * orphaned when the carrier escort it flew from died.
         */
        async function formerEscortWorld(player = BOARDER) {
            const ctx = await boardingWorld();
            ctx.target.components.set(PlayerEscortComponent, { player, deal: NO_DEAL });
            ctx.world.step();
            return ctx;
        }

        it('repairs a FORMER escort with no live flock link, and puts it '
            + 'back to work', async () => {
                const { world, boarder, target } = await formerEscortWorld();
                const repairs = recordRepairs(world);
                const shipData = target.components.get(ShipDataComponent)!;
                // Precondition: nothing links it to the player any more.
                expect(target.components.has(FormationComponent)).toBeFalse();

                press(world, BOARDER, 'board');

                // No plunder session, and it is flying again.
                expect(boarder.components.has(BoardingComponent)).toBeFalse();
                expect(target.components.has(BoardedComponent)).toBeFalse();
                expect(target.components.has(DisabledComponent)).toBeFalse();
                const armor = target.components.get(ArmorComponent)!;
                expect(isBelowDisableThreshold(
                    armor, shipData.disableArmorFraction)).toBeFalse();
                expect(armor.current).toEqual(
                    (shipData.disableArmorFraction + REPAIR_MARGIN_FRACTION) * armor.max);
                // The shield is left down (see the spec above).
                const shield = target.components.get(ShieldComponent)!;
                expect(shield.current).toBeLessThan(0.01 * shield.max);
                // Re-attached as a working escort.
                expect(target.components.get(FormationComponent)?.leader)
                    .toEqual(BOARDER);
                expect(target.components.get(EscortCommandComponent)?.command)
                    .toEqual('formation');
                expect(target.components.get(FiringGroupComponent)?.group)
                    .toEqual(BOARDER);
                expect(repairs).toEqual([BOARDER]);
            });

        it('charges no crime for repairing your own former escort',
            async () => {
                const { world, boarder } = await formerEscortWorld();
                press(world, BOARDER, 'board');
                expect(boarder.components.get(LegalRecordsComponent)!
                    .get(MERIDIAN)).toBeUndefined();
            });

        it('still plunders a hulk marked as ANOTHER player\'s escort',
            async () => {
                const { world, boarder, target } =
                    await formerEscortWorld('some other player');
                const repairs = recordRepairs(world);
                press(world, BOARDER, 'board');
                expect(boarder.components.get(BoardingComponent)?.target)
                    .toEqual(TARGET);
                expect(target.components.has(DisabledComponent)).toBeTrue();
                expect(repairs).toEqual([]);
            });
    });

    /**
     * Matthew's LAN playtest, bug 1: "Can capture player ships. Player
     * still controls them but you can kinda tell them to fire weapons at
     * other ships." Capture of a ship somebody is FLYING is impossible by
     * either route; PLUNDER of it stays legal (PvP piracy).
     *
     * Pinned at the system level with ControlledByComponent on the victim,
     * which is exactly what a remote peer's ship looks like in every
     * peer's simulation: the component is serializer-registered and is not
     * in PEER_LOCAL_COMPONENTS, so it is part of the shared state each
     * peer hashes for desync detection and reads identically. A two-peer
     * harness would exercise the same predicate on the same state.
     */
    describe('a ship somebody is flying can be robbed but not taken', () => {
        async function pvpWorld() {
            // ControlledBy is stamped AFTER the setup disable, so the
            // victim's repair roll (which reads it) is unaffected and the
            // hulk stays disabled for the whole spec.
            const ctx = await boardingWorld({ boarderCrew: 500,
                targetCrew: 1 });
            ctx.target.components.set(ControlledByComponent,
                { peerId: 'the other peer' });
            ctx.world.step();
            return ctx;
        }

        it('opens the plunder session and lets the booty be taken',
            async () => {
                const { world, boarder, target } = await pvpWorld();
                press(world, BOARDER, 'board');
                expect(boarder.components.get(BoardingComponent)?.target)
                    .toEqual(TARGET);

                press(world, BOARDER, 'plunderCargo');
                press(world, BOARDER, 'plunderCredits');
                expect(boarder.components.get(CargoComponent)!.get('cargo:0'))
                    .toEqual(2);
                expect(boarder.components.get(CreditsComponent)!.credits)
                    .toBeGreaterThan(0);
                // Still theirs, still disabled, still flown by them.
                expect(target.components.has(ControlledByComponent)).toBeTrue();
            });

        it('never lets the capture roll succeed, and never draws for it',
            async () => {
                const { world, boarder } = await pvpWorld();
                press(world, BOARDER, 'board');
                const random = world.resources.get(RandomResource)!;
                const before = random.getState();

                for (let i = 0; i < 20; i++) {
                    press(world, BOARDER, 'plunderCapture');
                }

                // Capture stays at its opening value, and the seeded PRNG
                // is untouched: a skipped roll must not shift the draw
                // sequence, or peers replaying this press would diverge.
                expect(boarder.components.get(BoardingComponent)?.capture)
                    .toEqual('none');
                expect(random.getState()).toEqual(before);
            });

        it('refuses the escort conversion even if capture is forced',
            async () => {
                // Belt-and-braces: 'succeeded' is unreachable above, so
                // this hand-writes it to prove the second gate holds.
                const { world, boarder, target } = await pvpWorld();
                press(world, BOARDER, 'board');
                boarder.components.get(BoardingComponent)!.capture =
                    'succeeded';

                useAsEscort(world, BOARDER);

                expect(target.components.has(FormationComponent)).toBeFalse();
                expect(target.components.has(EscortCommandComponent))
                    .toBeFalse();
                expect(target.components.has(FiringGroupComponent)).toBeFalse();
                expect(target.components.has(PlayerEscortComponent))
                    .toBeFalse();
                // Its own government (and its own captain) intact.
                expect(target.components.has(GovtComponent)).toBeTrue();
            });
    });

    it('rolls the capture identically for the same seed', async () => {
        const a = await boardingWorld({ boarderCrew: 10, targetCrew: 10 });
        const b = await boardingWorld({ boarderCrew: 10, targetCrew: 10 });
        press(a.world, BOARDER, 'board');
        press(b.world, BOARDER, 'board');
        press(a.world, BOARDER, 'plunderCapture');
        press(b.world, BOARDER, 'plunderCapture');
        expect(a.boarder.components.get(BoardingComponent)?.capture)
            .toEqual(b.boarder.components.get(BoardingComponent)?.capture);
    });

    /**
     * Reference "Capture odds, wave 31": the original's odds are DRAWN per
     * board (one crew-50 hulk read 11, 17, 13, 10, 14%), so a board freezes
     * its own odds as the session opens, and the dialog's figure is the one
     * the capture is rolled against.
     */
    describe('capture odds drawn per board (reference "Capture odds, wave '
        + '31")', () => {
            /** Every draw returns `roll`, counted. */
            function pin(world: World, roll: number) {
                const counter = { draws: 0 };
                const random = new Random();
                random.next = () => { counter.draws++; return roll; };
                world.resources.set(RandomResource, random);
                return counter;
            }

            it('freezes the board\'s odds from its own draw, and nothing '
                + 'more from the PRNG', async () => {
                    const { world, boarder } = await boardingWorld({
                        boarderCrew: 10, targetCrew: 50,
                    });
                    const counter = pin(world, 0.3);
                    press(world, BOARDER, 'board');
                    // One draw a board: the money's, which the odds' hash
                    // is salted with.
                    expect(counter.draws).toBe(1);
                    const odds = boarder.components.get(BoardingComponent)
                        ?.captureOdds;
                    expect(odds).toEqual(boardCaptureOdds(10, 50,
                        captureOddsDraw(BOARDER, TARGET, 0.3)));
                    // Crew 50 against 10: the 12% mean, 5 points each way.
                    expect(odds).toBeGreaterThanOrEqual(7);
                    expect(odds).toBeLessThanOrEqual(17);
                });

            it('differs from board to board, around the table\'s mean',
                async () => {
                    const seen = new Set<number>();
                    let sum = 0;
                    const boards = 24;
                    for (let i = 0; i < boards; i++) {
                        const { world, boarder } = await boardingWorld({
                            boarderCrew: 10, targetCrew: 50,
                        });
                        pin(world, (i + 0.5) / boards);
                        press(world, BOARDER, 'board');
                        const odds = boarder.components
                            .get(BoardingComponent)!.captureOdds;
                        seen.add(odds);
                        sum += odds;
                    }
                    expect(seen.size).toBeGreaterThan(3);
                    expect(Math.abs(sum / boards - 12)).toBeLessThan(2.5);
                });

            it('rolls the capture against exactly the odds shown',
                async () => {
                    for (const won of [true, false]) {
                        const { world, boarder } = await boardingWorld({
                            boarderCrew: 10, targetCrew: 50,
                        });
                        pin(world, 0.5);
                        press(world, BOARDER, 'board');
                        const shown = boarder.components
                            .get(BoardingComponent)!.captureOdds;
                        // The capture's roll a hair inside or outside the
                        // shown figure, not the table's mean.
                        pin(world, won ? (shown - 0.5) / 100
                            : (shown + 0.001) / 100);
                        press(world, BOARDER, 'plunderCapture');
                        const capture = boarder.components
                            .get(BoardingComponent)?.capture;
                        if (won) {
                            expect(capture).toEqual('succeeded');
                        } else {
                            // Repelled: the session is over.
                            expect(capture).toBeUndefined();
                        }
                    }
                });

            it('reads the cap on every board at 75%', async () => {
                for (const roll of [0, 0.25, 0.5, 0.999]) {
                    const { world, boarder } = await boardingWorld({
                        boarderCrew: 10, targetCrew: 1,
                    });
                    pin(world, roll);
                    press(world, BOARDER, 'board');
                    expect(boarder.components.get(BoardingComponent)
                        ?.captureOdds).toEqual(75);
                }
                expect(captureChance(10, 1)).toEqual(0.75);
            });

            /**
             * Marines (oütf ModType 25, reference "Capture, wave 33",
             * finding 4): Kit Marines 10 put crew 10 v 10 into ratio 2's
             * band; Kit Marines 20 Pct added about 20 points.
             */
            it('counts the boarder\'s marines: positive ModVal as crew, '
                + 'negative as points', async () => {
                    const MARINES = 'test:marines10';
                    const PERCENT = 'test:marines20pct';
                    for (const [outfit, expected] of [
                        [undefined, (draw: number) =>
                            boardCaptureOdds(10, 10, draw)],
                        [MARINES, (draw: number) =>
                            boardCaptureOdds(20, 10, draw)],
                        [PERCENT, (draw: number) =>
                            boardCaptureOdds(10, 10, draw, 20)],
                    ] as const) {
                        const { world, boarder, gameData } =
                            await boardingWorld({
                                boarderCrew: 10, targetCrew: 10,
                            });
                        // Two kit outfits the synthetic data lacks, served
                        // beside the real ones for this spec only.
                        const outfitData = gameData.data.Outfit;
                        if (!jasmine.isSpy(outfitData.getCached)) {
                            const real = outfitData.getCached
                                .bind(outfitData);
                            spyOn(outfitData, 'getCached')
                                .and.callFake((id: string) =>
                                    id === MARINES ? {
                                        ...getDefaultOutfitData(), id,
                                        marines: 10,
                                    } : id === PERCENT ? {
                                        ...getDefaultOutfitData(), id,
                                        marines: -20,
                                    } : real(id));
                        }
                        if (outfit) {
                            const outfits = new Map(boarder.components
                                .get(OutfitsStateComponent) ?? []);
                            outfits.set(outfit, { count: 1 });
                            boarder.components.set(OutfitsStateComponent,
                                outfits);
                        }
                        pin(world, 0.4);
                        press(world, BOARDER, 'board');
                        const odds = boarder.components
                            .get(BoardingComponent)!.captureOdds;
                        expect(odds).withContext(String(outfit)).toEqual(
                            expected(captureOddsDraw(BOARDER, TARGET, 0.4)));
                        if (outfit === MARINES) {
                            // Ratio 2's band (32% +-5).
                            expect(odds).toBeGreaterThanOrEqual(27);
                            expect(odds).toBeLessThanOrEqual(37);
                        } else if (outfit === PERCENT) {
                            // Ratio 1's 20% +-5, plus 20.
                            expect(odds).toBeGreaterThanOrEqual(35);
                            expect(odds).toBeLessThanOrEqual(45);
                        }
                    }
                });
        });

    /**
     * The plunder self-destruct (reference "Disabled ships, wave 24" and
     * "Plunder self-destruct, wave 25"): one draw a take at that item's
     * odds, made after the take is delivered; nothing exempt by govt.
     */
    describe('a booty take can trip the hulk\'s security self-destruct '
        + '(reference "Plunder self-destruct, wave 25")', () => {
            /** The world's PRNG replaced: every draw returns `roll` and is
             * counted. */
            function pinDraws(world: World, roll: number) {
                const counter = { draws: 0 };
                const random = new Random();
                random.next = () => { counter.draws++; return roll; };
                world.resources.set(RandomResource, random);
                return counter;
            }

            /** A boarded hulk the BOARDER disabled (its attribution root),
             * with his combat rating, and the self-destruct lines
             * collected. */
            async function boarded() {
                const ctx = await boardingWorld();
                ctx.boarder.components.set(CombatRatingComponent,
                    { kills: 0 });
                ctx.target.components.set(DamageAttributionComponent,
                    { root: BOARDER, disabledAtHit: false });
                const lines: string[][] = [];
                ctx.world.addSystem(new System({
                    name: 'CollectSelfDestruct',
                    events: [PlunderSelfDestructEvent],
                    args: [UUID] as const,
                    step: (uuid) => { lines.push([uuid]); },
                }));
                pinDraws(ctx.world, 0.99);
                press(ctx.world, BOARDER, 'board');
                expect(ctx.boarder.components.has(BoardingComponent))
                    .toBeTrue();
                return { ...ctx, lines };
            }

            it('the odds differ by item: fits from small samples', () => {
                // Measured: Cargo 10 trips in 12 takes, Credits 4 in 15,
                // Energy 2 in 4, Ammo 7 in 8 (wave 31, a stock IR Missile
                // pair). Each the count's ratio to the nearest 0.05;
                // Ammo's 0.875 takes Cargo's 0.85 (GUESS: one rate).
                expect(PLUNDER_SELF_DESTRUCT_CHANCE).toEqual({
                    cargo: 0.85, credits: 0.25, fuel: 0.5, ammo: 0.85,
                });
                const measured = { cargo: [10, 12], credits: [4, 15],
                    fuel: [2, 4] } as const;
                for (const [item, [trips, takes]] of
                    Object.entries(measured)) {
                    const chance = PLUNDER_SELF_DESTRUCT_CHANCE[
                        item as keyof typeof measured];
                    expect(Math.abs(chance - trips / takes))
                        .withContext(item).toBeLessThanOrEqual(0.025);
                }
                // Ammo's 0.875 is a tie between 0.85 and 0.9; it takes
                // Cargo's.
                expect(PLUNDER_SELF_DESTRUCT_CHANCE.ammo)
                    .toEqual(PLUNDER_SELF_DESTRUCT_CHANCE.cargo);
                expect(Math.abs(PLUNDER_SELF_DESTRUCT_CHANCE.ammo - 7 / 8))
                    .toBeLessThan(0.03);
                expect(plunderTripsSelfDestruct('cargo', 0)).toBeTrue();
                expect(plunderTripsSelfDestruct('cargo', 0.8499)).toBeTrue();
                expect(plunderTripsSelfDestruct('cargo', 0.85)).toBeFalse();
                expect(plunderTripsSelfDestruct('credits', 0.2499))
                    .toBeTrue();
                expect(plunderTripsSelfDestruct('credits', 0.25)).toBeFalse();
                expect(plunderTripsSelfDestruct('fuel', 0.4999)).toBeTrue();
                expect(plunderTripsSelfDestruct('fuel', 0.5)).toBeFalse();
                expect(plunderTripsSelfDestruct('ammo', 0.8499)).toBeTrue();
                expect(plunderTripsSelfDestruct('ammo', 0.85)).toBeFalse();
                expect(plunderTripsSelfDestruct('ammo', 0.99)).toBeFalse();
            });

            it('each take draws at its own item\'s odds, in any order',
                async () => {
                    // 0.6 trips Cargo and Ammo (0.85) and nothing else.
                    const { world, boarder, target, lines } =
                        await boarded();
                    const counter = pinDraws(world, 0.6);
                    for (const action of ['plunderCredits', 'plunderFuel']) {
                        press(world, BOARDER, action);
                    }
                    expect(counter.draws).toBe(2);
                    expect(lines).toEqual([]);
                    expect(boarder.components.has(BoardingComponent))
                        .toBeTrue();
                    press(world, BOARDER, 'plunderCargo');
                    expect(counter.draws).toBe(3);
                    expect(lines).toEqual([[BOARDER]]);
                    expect(target.components.has(ExplodingComponent))
                        .toBeTrue();
                    // Cargo or Ammo first trips at the same draw.
                    for (const action of ['plunderCargo', 'plunderAmmo']) {
                        const first = await boarded();
                        pinDraws(first.world, 0.6);
                        press(first.world, BOARDER, action);
                        expect(first.lines).withContext(action)
                            .toEqual([[BOARDER]]);
                    }
                });

            it('the line is STR# 2002 index 112, verbatim', () => {
                expect(plunderSelfDestructMessage()).toEqual(
                    "Oops! You tripped this ship's security self-destruct "
                    + 'mechanism.');
            });

            for (const action of ['plunderCredits', 'plunderCargo',
                'plunderFuel', 'plunderAmmo']) {
                it(`a tripped ${action}: the take is delivered, the hulk `
                    + 'destroyed, the session over, the player told and '
                    + 'unharmed', async () => {
                        const { world, boarder, target, lines } =
                            await boarded();
                        const armor = boarder.components.get(ArmorComponent)!
                            .current;
                        const counter = pinDraws(world, 0);
                        press(world, BOARDER, action);
                        expect(counter.draws).toBe(1);
                        expect(lines).toEqual([[BOARDER]]);
                        expect(boarder.components.has(BoardingComponent))
                            .toBeFalse();
                        expect(target.components.has(ExplodingComponent))
                            .toBeTrue();
                        expect(target.components.get(ArmorComponent)!.current)
                            .toBe(0);
                        // The tripped take was delivered (measured for
                        // Cargo: the hold filled), and only that one.
                        expect(boarder.components.get(CreditsComponent)!
                            .credits > 0).toBe(action === 'plunderCredits');
                        expect(boarder.components.get(CargoComponent)!
                            .get('cargo:0') ?? 0).toBe(
                                action === 'plunderCargo' ? 2 : 0);
                        expect(boarder.components.get(FuelComponent)!
                            .current > 0).toBe(action === 'plunderFuel');
                        expect(boarder.components.get(ArmorComponent)!.current)
                            .toBe(armor);
                        // Not his kill (GUESS): no combat rating.
                        expect(boarder.components.get(CombatRatingComponent)!
                            .kills).toBe(0);
                        // It is in the ordinary death sequence (the
                        // breakup, the final explosion, DeathEvent).
                        world.step();
                        expect(target.components.has(ExplodingComponent))
                            .toBeTrue();
                    });
            }

            it('the piracy is charged as for any take, and the kill is not '
                + '(GUESS: wave 25 read neither)', async () => {
                    const kept = await boarded();
                    pinDraws(kept.world, 0.99);
                    press(kept.world, BOARDER, 'plunderCredits');
                    const tripped = await boarded();
                    pinDraws(tripped.world, 0);
                    press(tripped.world, BOARDER, 'plunderCredits');
                    const records = (ctx: typeof kept) => [...ctx.boarder
                        .components.get(LegalRecordsComponent)!.entries()];
                    expect(records(kept).length).toBeGreaterThan(0);
                    expect(records(tripped)).toEqual(records(kept));
                    for (let i = 0; i < 60; i++) {
                        tripped.world.step();
                    }
                    expect(records(tripped)).toEqual(records(kept));
                });

            it('a draw that does not trip moves every booty and leaves the '
                + 'dialog open, one draw a take', async () => {
                    const { world, boarder, target, lines } = await boarded();
                    const counter = pinDraws(world, 0.99);
                    for (const action of ['plunderCredits', 'plunderCargo',
                        'plunderFuel', 'plunderAmmo']) {
                        press(world, BOARDER, action);
                        // A replayed press draws nothing more.
                        press(world, BOARDER, action);
                    }
                    expect(counter.draws).toBe(4);
                    expect(lines).toEqual([]);
                    expect(boarder.components.get(CreditsComponent)!.credits)
                        .toBeGreaterThan(0);
                    expect(boarder.components.get(CargoComponent)!
                        .get('cargo:0')).toBe(2);
                    expect(boarder.components.get(FuelComponent)!.current)
                        .toBeGreaterThan(0);
                    expect(target.components.has(ExplodingComponent))
                        .toBeFalse();
                    expect(boarder.components.has(BoardingComponent))
                        .toBeTrue();
                });

            it('a capture attempt can trip it too, drawn BEFORE the capture '
                + 'roll (reference "Capture, wave 33", finding 5: 2 in 27 '
                + 'clicks)', async () => {
                    expect(CAPTURE_SELF_DESTRUCT_CHANCE).toBe(0.1);
                    const { world, boarder, target, lines } = await boarded();
                    const counter = pinDraws(world, 0.05);
                    press(world, BOARDER, 'plunderCapture');
                    // One draw: the trip; no capture roll after it.
                    expect(counter.draws).toBe(1);
                    expect(lines).toEqual([[BOARDER]]);
                    expect(target.components.has(ExplodingComponent))
                        .toBeTrue();
                    // Nothing captured: the session is over, the hulk
                    // never joins the boarder.
                    expect(boarder.components.has(BoardingComponent))
                        .toBeFalse();
                    expect(target.components.get(FormationComponent)?.leader)
                        .toBeUndefined();
                    // Not the boarder's kill (as a plunder trip).
                    expect(boarder.components.get(CombatRatingComponent)!
                        .kills).toBe(0);
                });

            it('an attempt that does not trip draws twice: the trip, then '
                + 'the capture roll', async () => {
                    const { world, boarder, target, lines } = await boarded();
                    const counter = pinDraws(world,
                        CAPTURE_SELF_DESTRUCT_CHANCE);
                    press(world, BOARDER, 'plunderCapture');
                    expect(counter.draws).toBe(2);
                    expect(boarder.components.get(BoardingComponent)?.capture)
                        .toEqual('succeeded');
                    expect(target.components.has(ExplodingComponent))
                        .toBeFalse();
                    expect(lines).toEqual([]);
                });

            it('a capture attempt on an exempt hulk draws only its roll',
                async () => {
                    const { world, boarder, lines } = await boarded();
                    const target = world.entities.get(TARGET)!;
                    target.components.set(MissionShipComponent,
                        { mission: 'nova:9999', owner: BOARDER });
                    const counter = pinDraws(world, 0);
                    press(world, BOARDER, 'plunderCapture');
                    expect(counter.draws).toBe(1);
                    expect(boarder.components.get(BoardingComponent)?.capture)
                        .toEqual('succeeded');
                    expect(lines).toEqual([]);
                });

            it('a DERELICT trips like any hulk (waves 6-7: 8 trips in 15 '
                + 'derelict takes)', async () => {
                    const { world, boarder, target, lines } = await boarded();
                    target.components.set(GovtComponent,
                        { id: SYNTHETIC.govts.wrecks });
                    const counter = pinDraws(world, 0);
                    press(world, BOARDER, 'plunderCredits');
                    expect(counter.draws).toBe(1);
                    expect(lines).toEqual([[BOARDER]]);
                    expect(target.components.has(ExplodingComponent))
                        .toBeTrue();
                    expect(boarder.components.get(CreditsComponent)!.credits)
                        .toBeGreaterThan(0);
                });

            it('never for a ship a player is flying, nor a mission ship: no '
                + 'draw (GUESS)', async () => {
                    for (const exempt of ['player', 'mission']) {
                        const { world, boarder, target, lines } =
                            await boarded();
                        if (exempt === 'player') {
                            target.components.set(ControlledByComponent,
                                { peerId: 'the other peer' });
                        } else {
                            target.components.set(MissionShipComponent,
                                { mission: 'nova:9999', owner: BOARDER });
                        }
                        const counter = pinDraws(world, 0);
                        press(world, BOARDER, 'plunderCredits');
                        expect(counter.draws).withContext(exempt).toBe(0);
                        expect(lines).withContext(exempt).toEqual([]);
                        expect(target.components.has(ExplodingComponent))
                            .withContext(exempt).toBeFalse();
                        expect(boarder.components.get(CreditsComponent)!
                            .credits).withContext(exempt).toBeGreaterThan(0);
                    }
                });
        });

    /**
     * ========================================================================
     * ONE PLUNDER PER LIFE SEGMENT, ONE CAPTURE ATTEMPT (Matthew's ruling)
     * ========================================================================
     *
     * A hulk may be boarded FOR PLUNDER exactly once, however many times
     * it is repaired and disabled again, and however many pirates come
     * calling. Inside that one session the player gets exactly ONE capture
     * attempt: if it is repelled the boarders are thrown off, the dialog
     * closes on the spot, and nothing further can be had from that ship.
     * The record resets only at a LIFE-SEGMENT boundary — the ship lands
     * and departs, or jumps to another system.
     *
     * This suite replaces the old "a hulk can be boarded again after a
     * session ends" block wholesale: that behaviour (re-board to retry a
     * 5%-odds capture until it lands) is exactly what the ruling removes.
     * Boarding for NON-plunder purposes is untouched, which the escort
     * repair spec at the end pins.
     */
    describe('a hulk gets one plunder and one capture attempt', () => {
        it('refuses a second plunder session after the first one closes',
            async () => {
                const { world, boarder, target } = await boardingWorld();
                press(world, BOARDER, 'board');
                expect(boarder.components.has(BoardingComponent)).toBeTrue();

                press(world, BOARDER, 'plunderDone');
                expect(boarder.components.has(BoardingComponent)).toBeFalse();
                // The durable record survives the session end: marked as
                // boarded (the mission-goal seam reads it) and spent.
                expect(target.components.get(BoardedComponent)?.plundered)
                    .toBeTrue();
                expect(target.components.get(BoardedComponent)?.active)
                    .toBeFalsy();

                press(world, BOARDER, 'board');
                expect(boarder.components.has(BoardingComponent)).toBeFalse();
            });

        it('spends the hulk even when the boarder takes nothing',
            async () => {
                // The record is stamped when the session OPENS, so looking
                // around and leaving still uses the ship's one boarding up.
                const { world, boarder, target } = await boardingWorld();
                press(world, BOARDER, 'board');
                press(world, BOARDER, 'plunderDone');
                expect(target.components.get(BoardedComponent)?.plundered)
                    .toBeTrue();
                expect(target.components.get(BoardedComponent)?.cargoTaken)
                    .toBeFalsy();
                press(world, BOARDER, 'board');
                expect(boarder.components.has(BoardingComponent)).toBeFalse();
            });

        it('tells the player the ship has already been boarded',
            async () => {
                const { world, boarder } = await boardingWorld();
                const reasons: string[] = [];
                world.addSystem(new System({
                    name: 'CollectBlocked',
                    events: [BoardingBlockedEvent],
                    args: [BoardingBlockedEvent] as const,
                    step: ({ reason }) => { reasons.push(reason); },
                }));
                press(world, BOARDER, 'board');
                press(world, BOARDER, 'plunderDone');
                press(world, BOARDER, 'board');
                expect(boarder.components.has(BoardingComponent)).toBeFalse();
                expect(reasons).toEqual(['alreadyBoarded']);
                // The stock line for it: STR# 2002 index 129.
                expect(boardingBlockedMessage('alreadyBoarded'))
                    .toEqual("You can't board this ship.");
            });

        it('hands the plunder BACK when the boarding only offered a '
            + 'mission (përs Flags 0x0200)', async () => {
                // Matthew's ruling: boarding a ship that offers a mission
                // shows the mission text and that is the whole boarding —
                // no plunder dialog — and that boarding does not consume
                // the hulk's one plunder, so the derelict is still
                // robbable later, once its offer has been taken.
                const { world, boarder, target } = await boardingWorld();
                // Only a PËRS can offer (presentShipOffer refuses
                // otherwise), and the sim checks that itself.
                target.components.set(PersComponent,
                    { id: SYNTHETIC.persons.wreck, name: 'Hollow Wreck', subtitle: '' });
                press(world, BOARDER, 'board');
                expect(target.components.get(BoardedComponent)?.plundered)
                    .toBeTrue();

                press(world, BOARDER, 'plunderOfferOnly');
                expect(boarder.components.has(BoardingComponent)).toBeFalse();
                // Session over, record handed back.
                expect(target.components.get(BoardedComponent)?.active)
                    .toBeFalsy();
                expect(target.components.get(BoardedComponent)?.plundered)
                    .toBeFalsy();

                // ...so the NEXT boarding (the offer is spent by then, so
                // the display shows the plunder dialog) opens normally.
                press(world, BOARDER, 'board');
                expect(boarder.components.get(BoardingComponent)?.target)
                    .toEqual(TARGET);
                // And that one DOES spend it, exactly once.
                press(world, BOARDER, 'plunderDone');
                expect(target.components.get(BoardedComponent)?.plundered)
                    .toBeTrue();
                press(world, BOARDER, 'board');
                expect(boarder.components.has(BoardingComponent)).toBeFalse();
            });

        it('takes no booty on the offer-only ending, and repeats harmlessly',
            async () => {
                // The plunder dialog never opened, so nothing can have
                // been taken; and the display sends the edge once, but a
                // replayed input must not do anything different.
                const { world, boarder, target } = await boardingWorld();
                target.components.set(PersComponent,
                    { id: SYNTHETIC.persons.wreck, name: 'Hollow Wreck', subtitle: '' });
                const credits =
                    boarder.components.get(CreditsComponent)!.credits;
                press(world, BOARDER, 'board');
                press(world, BOARDER, 'plunderOfferOnly');
                press(world, BOARDER, 'plunderOfferOnly');
                expect(boarder.components.get(CreditsComponent)!.credits)
                    .toEqual(credits);
                expect(target.components.get(CargoComponent)!.get('cargo:0'))
                    .toEqual(2);
                expect(boarder.components.has(BoardingComponent)).toBeFalse();
                expect(target.components.get(BoardedComponent)?.plundered)
                    .toBeFalsy();
            });

        it('does NOT hand the plunder back for a hulk that is not a përs',
            async () => {
                // A forged or stray 'plunderOfferOnly' for an ordinary
                // hulk (nothing there could have offered) ends the
                // session like any other ending and keeps the plunder
                // spent — otherwise it would be a credit farm, and for a
                // mission special ship it would un-credit a ShipGoal 2/5
                // boarding (review r13).
                const { world, boarder, target } = await boardingWorld();
                press(world, BOARDER, 'board');
                press(world, BOARDER, 'plunderOfferOnly');
                expect(boarder.components.has(BoardingComponent)).toBeFalse();
                expect(target.components.get(BoardedComponent)?.active)
                    .toBeFalsy();
                expect(target.components.get(BoardedComponent)?.plundered)
                    .toBeTrue();
                press(world, BOARDER, 'board');
                expect(boarder.components.has(BoardingComponent)).toBeFalse();
            });

        it('blocks a second boarding while a session is OPEN', async () => {
            const { world, boarder, target } = await boardingWorld();
            press(world, BOARDER, 'board');
            expect(target.components.get(BoardedComponent)?.active)
                .toBeTrue();
            // Pressing board again mid-session changes nothing.
            press(world, BOARDER, 'board');
            expect(boarder.components.get(BoardingComponent)?.target)
                .toEqual(TARGET);
        });

        it('does not hand the hulk back when the boarder leaves '
            + 'mid-session', async () => {
                // A boarder that is destroyed / jumps out / lands never
                // runs its session-end path. The stale `active` flag is
                // still self-healing (it is corroborated against the named
                // boarder), but the DURABLE record is not: the hulk's one
                // plunder was spent the moment the session opened.
                const { world, boarder, target } = await boardingWorld();
                press(world, BOARDER, 'board');
                expect(target.components.get(BoardedComponent)?.active)
                    .toBeTrue();

                boarder.components.delete(BoardingComponent);
                world.step();

                press(world, BOARDER, 'board');
                expect(boarder.components.has(BoardingComponent)).toBeFalse();
                expect(target.components.get(BoardedComponent)?.plundered)
                    .toBeTrue();
            });

        it('shuts the credit farm against a fresh boarder', async () => {
            // Credits are the one booty NOT physically removed from the
            // victim (creditBooty re-derives them from the ship price), so
            // "take credits, die, come back" used to be an unbounded money
            // supply. Now the hulk simply refuses the second boarding —
            // and it refuses a DIFFERENT pirate too, not just the first.
            const { world, boarder, target, gameData } = await boardingWorld();
            const price = target.components.get(ShipDataComponent)!.price;
            const booty = creditBooty(price, 0);
            expect(booty).toBeGreaterThan(0);

            press(world, BOARDER, 'board');
            press(world, BOARDER, 'plunderCredits');
            expect(boarder.components.get(CreditsComponent)!.credits)
                .toEqual(booty);

            // UNGRACEFUL end: the boarder is destroyed mid-session.
            world.entities.delete(BOARDER);
            world.step();
            expect(target.components.get(BoardedComponent)?.creditsTaken)
                .toBeTrue();

            // A brand-new boarder takes over the same hulk.
            const shipData =
                (await gameData.data.Ship.get(SYNTHETIC.ships.skiff))!;
            const second = makeShip(shipData);
            second.components.set(MovementStateComponent, {
                position: new Position(0, 0), velocity: new Vector(0, 0),
                rotation: new Angle(0), turning: 0, turnBack: false,
                accelerating: 0,
            });
            second.components.set(CreditsComponent, { credits: 0 });
            await completeEntity(world, second);
            world.entities.set(SECOND_BOARDER, second);
            world.step();
            second.components.set(ShipDataComponent, {
                ...second.components.get(ShipDataComponent)!, crew: 200,
            });
            second.components.set(CreditsComponent, { credits: 0 });
            second.components.get(TargetComponent)!.target = TARGET;
            world.step();

            press(world, SECOND_BOARDER, 'board');
            expect(second.components.has(BoardingComponent)).toBeFalse();
            expect(second.components.get(CreditsComponent)!.credits)
                .toEqual(0);
        });

        it('ends the session the moment a capture is repelled', async () => {
            const { world, boarder, target } = await boardingWorld();
            forceCaptureRoll(world, false);
            press(world, BOARDER, 'board');
            expect(boarder.components.has(BoardingComponent)).toBeTrue();

            press(world, BOARDER, 'plunderCapture');
            // REPELLED: the dialog's own state is gone, so the display
            // closes it, and the hulk is fully spent.
            expect(boarder.components.has(BoardingComponent)).toBeFalse();
            expect(target.components.get(BoardedComponent)?.plundered)
                .toBeTrue();
            expect(target.components.get(BoardedComponent)?.active)
                .toBeFalsy();
            // Nothing further can be had from her, ever.
            press(world, BOARDER, 'board');
            expect(boarder.components.has(BoardingComponent)).toBeFalse();
        });

        it('leaves the repelled boarder nothing else to take', async () => {
            // The cargo is still aboard the hulk; being thrown off means
            // the player cannot go back for it.
            const { world, boarder, target } = await boardingWorld({
                cargo: new Map([['cargo:0', 5]]),
            });
            forceCaptureRoll(world, false);
            press(world, BOARDER, 'board');
            press(world, BOARDER, 'plunderCapture');
            press(world, BOARDER, 'plunderCargo');
            expect(boarder.components.get(CargoComponent)!.get('cargo:0'))
                .toBeUndefined();
            expect(target.components.get(CargoComponent)!.get('cargo:0'))
                .toEqual(5);
        });

        it('charges the board crime for a repelled attempt', async () => {
            const { world, boarder } = await boardingWorld();
            forceCaptureRoll(world, false);
            press(world, BOARDER, 'board');
            press(world, BOARDER, 'plunderCapture');
            expect(boarder.components.get(LegalRecordsComponent)!
                .get(MERIDIAN)).toBeLessThan(0);
        });

        it('gives no second capture attempt inside one session', async () => {
            // The roll is forced to fail, but the session-ending path is
            // the point: even a hand-sent second control edge finds no
            // 'none' state to transition out of.
            const { world, boarder, target } = await boardingWorld();
            forceCaptureRoll(world, false);
            press(world, BOARDER, 'board');
            // Keep the session alive so the second press has something to
            // act on: re-open the component exactly as the sim left it,
            // minus the session end.
            boarder.components.set(BoardingComponent, {
                ...boarder.components.get(BoardingComponent)
                ?? { target: TARGET, creditsAvailable: 0, ammoAvailable: 0 },
                target: TARGET, creditsAvailable: 0, ammoAvailable: 0,
                captureOdds: 75,
                cargoTaken: false, creditsTaken: false, fuelTaken: false,
                ammoTaken: false, capture: 'failed', crimeApplied: true,
            });
            world.step();
            forceCaptureRoll(world, true);
            press(world, BOARDER, 'plunderCapture');
            // Still 'failed': a used attempt is used.
            expect(boarder.components.get(BoardingComponent)?.capture)
                .toEqual('failed');
            expect(target.components.has(DisabledComponent)).toBeTrue();
        });

        it('still repairs your own disabled escort after it was plundered',
            async () => {
                // Matthew: boarding for other purposes is NOT restricted.
                // A rival strips your escort; you can still fly over and
                // patch it up, as many times as it takes.
                const { world, boarder, target } = await boardingWorld();
                press(world, BOARDER, 'board');
                press(world, BOARDER, 'plunderDone');
                expect(target.components.get(BoardedComponent)?.plundered)
                    .toBeTrue();

                // The hulk is now the boarder's escort (durably marked).
                target.components.set(PlayerEscortComponent,
                    { player: BOARDER, parent: BOARDER, deal: NO_DEAL });
                world.step();

                press(world, BOARDER, 'board');
                expect(target.components.has(DisabledComponent)).toBeFalse();
                expect(target.components.get(FormationComponent)?.leader)
                    .toEqual(BOARDER);
                // A repair, not a plunder session.
                expect(boarder.components.has(BoardingComponent)).toBeFalse();
            });

        it('resets the record when the hulk lands', async () => {
            const { world, boarder, target } = await boardingWorld();
            press(world, BOARDER, 'board');
            press(world, BOARDER, 'plunderDone');
            expect(target.components.has(BoardedComponent)).toBeTrue();

            // Landing ends the life segment (BoardingLandingResetSystem).
            world.emit(LandEvent, { id: SYNTHETIC.planets.port, uuid: 'some stellar' },
                [TARGET]);
            world.step();
            expect(target.components.has(BoardedComponent)).toBeFalse();

            press(world, BOARDER, 'board');
            expect(boarder.components.get(BoardingComponent)?.target)
                .toEqual(TARGET);
        });

        it('resets the record when the hulk jumps to another system',
            async () => {
                const { world, boarder, target } = await boardingWorld();
                press(world, BOARDER, 'board');
                press(world, BOARDER, 'plunderDone');
                expect(target.components.has(BoardedComponent)).toBeTrue();

                // JumpFromSystem clears the record just before the entity
                // is serialized and carried to the destination, so it
                // arrives plunderable again.
                world.emit(InitiateJumpEvent, { to: SYNTHETIC.systems.kestrel }, [TARGET]);
                world.step();
                expect(target.components.has(BoardedComponent)).toBeFalse();
                expect(boarder.components.has(BoardingComponent)).toBeFalse();
            });
    });

    /**
     * "Use As My Ship" (the capture prompt's other answer, stock STR# 2002
     * 117: "...trade places with its captain and use it as your own
     * ship?"). MEASURED (reference "Capture \"Use As My Ship\" (the hub's
     * CU), wave 45"): the old hull stays as a captured escort, the new hull
     * carries the prize's own items plus the pilot's persistent outfits,
     * BOTH holds are lost, the rename prompt's name is the ship's name, and
     * the prize class's OnCapture and the old class's OnRetire run. The
     * answer arrives as a `captureShip` input record (boarding_plugin's
     * applyCaptureShip), driven here through the real input path.
     *
     * The boarder is a Wren Skiff (cargo 10 + a Cargo Pod) carrying the
     * persistent Courier Charter, two tons of Food and a ton of mission
     * cargo; the prize a disabled Gannet Corsair with three tons of
     * Industrial aboard.
     */
    describe('Use As My Ship', () => {
        const CHARTER = SYNTHETIC.outfits.charter;
        const POD = SYNTHETIC.outfits.cargoPod;
        const PEER = 'test peer';
        const MISSION_CARGO = 'mission:nova:999';

        async function swapWorld() {
            const ctx = await boardingWorld({
                boarderCrew: 500, targetCrew: 1,
                targetShip: SYNTHETIC.ships.corsair,
                boarderOutfits: [[SYNTHETIC.outfits.blaster, 1], [POD, 1],
                    [CHARTER, 1]],
                cargo: new Map([['cargo:1', 3]]),
            });
            const { world, boarder } = ctx;
            boarder.components.set(ControlledByComponent, { peerId: PEER });
            boarder.components.set(CargoComponent, new Map([['cargo:0', 2],
                [MISSION_CARGO, 1]]));
            boarder.components.set(CreditsComponent, { credits: 12_345 });
            boarder.components.set(LegalRecordsComponent,
                new Map([[MERIDIAN, 7]]));
            boarder.components.set(ControlBitsComponent, new Set([9292]));
            const events: { kept: string, oldShipRetained: boolean }[] = [];
            world.addSystem(new System({
                name: 'CollectCaptureAssigned',
                events: [CaptureAssignedEvent],
                args: [CaptureAssignedEvent] as const,
                step: e => { events.push({ ...e }); },
            }));
            return { ...ctx, events };
        }

        /** The `captureShip` record, as the owner's client sends it, through
         * the wire codec and the input apply; then one step. */
        function useAsMyShip(world: World,
            capture: CapturedShip = { name: 'Prize Taken' },
            peerId = PEER) {
            const input: SimulationInput = { kind: 'captureShip', capture };
            expect(SimulationInputType.is(input)).toBeTrue();
            applySimulationInputs(world, [input], peerId);
            world.step();
        }

        function capture(world: World, boarder: Entity) {
            forceCaptureRoll(world, true);
            press(world, BOARDER, 'board');
            press(world, BOARDER, 'plunderCapture');
            expect(boarder.components.get(BoardingComponent)?.capture)
                .toEqual('succeeded');
        }

        function captureAndSwap(world: World, boarder: Entity,
            record?: CapturedShip) {
            capture(world, boarder);
            useAsMyShip(world, record);
        }

        it('puts the pilot in the prize, where it lay, at the pilot\'s own '
            + 'uuid, and ends the session', async () => {
                const { world, boarder, target, events } = await swapWorld();
                const prizeAt = target.components.get(MovementStateComponent)!
                    .position;
                captureAndSwap(world, boarder);
                const hull = world.entities.get(BOARDER)!;
                expect(hull).not.toBe(boarder);
                expect(hull.components.get(ShipComponent)!.id)
                    .toEqual(SYNTHETIC.ships.corsair);
                expect(hull.components.get(ShipDataComponent)!.id)
                    .toEqual(SYNTHETIC.ships.corsair);
                expect(hull.components.get(ControlledByComponent))
                    .toEqual({ peerId: PEER });
                expect(hull.components.has(BoardingComponent)).toBeFalse();
                expect(hull.components.has(DisabledComponent)).toBeFalse();
                const at = hull.components.get(MovementStateComponent)!
                    .position;
                // The prize's place (it may have drifted a tick).
                expect(Math.hypot(at.x - prizeAt.x, at.y - prizeAt.y))
                    .toBeLessThan(2);
                // The pilot's state comes along.
                expect(hull.components.get(CreditsComponent)!.credits)
                    .toEqual(12_345);
                expect(hull.components.get(LegalRecordsComponent)!
                    .get(MERIDIAN)).toBeLessThan(7 + 1);
                expect(hull.components.get(TargetComponent)?.target)
                    .toBeUndefined();
                expect(events).toEqual([{ kept: 'ship', oldShipRetained: true }]);
            });

        it('leaves the old hull beside the pilot as a captured escort, '
            + 'under the prize\'s uuid', async () => {
                const { world, boarder } = await swapWorld();
                const oldAt = boarder.components.get(MovementStateComponent)!
                    .position;
                captureAndSwap(world, boarder);
                const escort = world.entities.get(TARGET)!;
                expect(escort.components.get(ShipComponent)!.id)
                    .toEqual(SYNTHETIC.ships.skiff);
                expect(escort.components.get(PlayerEscortComponent))
                    .toEqual(jasmine.objectContaining({
                        player: BOARDER, parent: BOARDER,
                        provenance: 'captured',
                    }));
                expect(escort.components.get(FormationComponent)?.leader)
                    .toEqual(BOARDER);
                expect(escort.components.get(FiringGroupComponent))
                    .toEqual({ group: BOARDER });
                expect(escort.components.has(GovtComponent)).toBeFalse();
                expect(escort.components.has(ControlledByComponent))
                    .toBeFalse();
                expect(escort.components.has(DisabledComponent)).toBeFalse();
                expect(escortParent(escort)).toEqual(BOARDER);
                expect(cappedEscortCount(BOARDER, { world: world.entities }))
                    .toEqual(1);
                const at = escort.components.get(MovementStateComponent)!
                    .position;
                expect(Math.hypot(at.x - oldAt.x, at.y - oldAt.y))
                    .toBeLessThan(2);
            });

        it('moves the persistent outfits with the pilot and leaves the '
            + 'rest on the old hull', async () => {
                const { world, boarder, target } = await swapWorld();
                const prizeOutfits = [...target.components
                    .get(OutfitsStateComponent)!].map(([id, { count }]) =>
                        [id, count]);
                captureAndSwap(world, boarder);
                const hull = world.entities.get(BOARDER)!;
                const escort = world.entities.get(TARGET)!;
                const counts = (e: Entity) => new Map([...e.components
                    .get(OutfitsStateComponent)!].map(([id, { count }]) =>
                        [id, count]));
                expect(counts(hull)).toEqual(new Map([...prizeOutfits,
                    [CHARTER, 1]] as [string, number][]));
                expect(counts(escort)).toEqual(new Map([
                    [SYNTHETIC.outfits.blaster, 1], [POD, 1]]));
            });

        it('loses BOTH holds, the pilot\'s and the prize\'s, keeping only '
            + 'the pilot\'s mission cargo (GUESS)', async () => {
                const { world, boarder } = await swapWorld();
                captureAndSwap(world, boarder);
                world.step();
                expect(world.entities.get(BOARDER)!.components
                    .get(CargoComponent)).toEqual(
                    new Map([[MISSION_CARGO, 1]]));
                expect(world.entities.get(TARGET)!.components
                    .get(CargoComponent)).toEqual(new Map());
            });

        it('names the new hull what the rename prompt gave it, cleaned '
            + 'and cut to 31 characters', async () => {
                const name = async (typed: string) => {
                    const { world, boarder } = await swapWorld();
                    captureAndSwap(world, boarder, { name: typed });
                    world.step();
                    return world.entities.get(BOARDER)!.components
                        .get(PlayerNamesComponent)?.ship;
                };
                expect(await name('Prize Taken')).toEqual('Prize Taken');
                expect(await name(' Prize\u0007 Taken‮ ')).toEqual(
                    'Prize Taken');
                expect(await name('x'.repeat(300))).toEqual('x'.repeat(31));
                // An emptied field: a blank name, as the shipyard's.
                expect(await name('')).toEqual('');
            });

        it('runs the set strings\' deltas on the new hull: the prize\'s '
            + 'OnCapture and the old hull\'s OnRetire (wave 45: b9288, '
            + 'b9290)', async () => {
                const { world, boarder } = await swapWorld();
                captureAndSwap(world, boarder,
                    { name: 'Prize Taken', bitsSet: [9288, 9290] });
                world.step();
                const hull = world.entities.get(BOARDER)!;
                expect([...hull.components.get(ControlBitsComponent)!].sort())
                    .toEqual([9288, 9290, 9292]);
                expect(world.entities.get(TARGET)!.components
                    .has(ControlBitsComponent)).toBeFalse();
            });

        it('end to end: the owner\'s client resolves OnRetire and OnCapture '
            + 'and the swap applies them', async () => {
                const { world, boarder, gameData } = await swapWorld();
                const skiff = (await gameData.data.Ship.get(
                    SYNTHETIC.ships.skiff))!;
                const corsair = (await gameData.data.Ship.get(
                    SYNTHETIC.ships.corsair))!;
                capture(world, boarder);
                // The kit's strings: the old class's OnRetire, the prize
                // class's OnCapture (and its own OnRetire, which must NOT
                // run).
                const effects = await buildCaptureSetStrings(boarder,
                    { ...skiff, onRetire: 'b9290' },
                    { ...corsair, onCapture: 'b9288', onRetire: 'b9289' },
                    gameData, MissionUniverse.shared(gameData));
                expect(effects).toEqual({ bitsSet: [9290, 9288] });
                // Resolved on a detached copy: the pilot is not written.
                expect([...boarder.components.get(ControlBitsComponent)!])
                    .toEqual([9292]);
                useAsMyShip(world, { name: 'Prize Taken', ...effects });
                world.step();
                const hull = world.entities.get(BOARDER)!;
                expect([...hull.components.get(ControlBitsComponent)!].sort())
                    .toEqual([9288, 9290, 9292]);
                expect(hull.components.get(PlayerNamesComponent)?.ship)
                    .toEqual('Prize Taken');
            });

        it('flies the prize in the condition it lay in, lifted over the '
            + 'disable line', async () => {
                const { world, boarder, target } = await swapWorld();
                // A plundered tank: the prize's fuel is the new hull's.
                press(world, BOARDER, 'board');
                // A take that does not trip the hulk's self-destruct...
                forceCaptureRoll(world, false);
                press(world, BOARDER, 'plunderFuel');
                expect(target.components.get(FuelComponent)!.current)
                    .toEqual(0);
                // ...then a capture that lands.
                forceCaptureRoll(world, true);
                press(world, BOARDER, 'plunderCapture');
                expect(world.entities.get(BOARDER)!.components
                    .get(BoardingComponent)?.capture).toEqual('succeeded');
                useAsMyShip(world);
                const hull = world.entities.get(BOARDER)!;
                const armor = hull.components.get(ArmorComponent)!;
                const fraction = hull.components.get(ShipDataComponent)!
                    .disableArmorFraction;
                expect(isBelowDisableThreshold(armor, fraction)).toBeFalse();
                expect(armor.current).toBeLessThan(armor.max);
                expect(hull.components.get(FuelComponent)!.current)
                    .toBeLessThan(1);
            });

        it('does nothing without a successful capture', async () => {
            const { world, boarder, events } = await swapWorld();
            press(world, BOARDER, 'board');
            useAsMyShip(world);
            expect(world.entities.get(BOARDER)).toBe(boarder);
            expect(boarder.components.get(BoardingComponent)?.capture)
                .toEqual('none');
            expect(world.entities.get(TARGET)!.components.get(ShipComponent)!
                .id).toEqual(SYNTHETIC.ships.corsair);
            expect(events).toEqual([]);
        });

        it('takes no record from another peer, and applies a duplicate '
            + 'once', async () => {
                const { world, boarder, events } = await swapWorld();
                capture(world, boarder);
                useAsMyShip(world, { name: 'Not Yours' }, 'other peer');
                expect(world.entities.get(BOARDER)).toBe(boarder);
                useAsMyShip(world, { name: 'Prize Taken', bitsSet: [1] });
                const hull = world.entities.get(BOARDER)!;
                useAsMyShip(world, { name: 'Again', bitsSet: [2] });
                expect(world.entities.get(BOARDER)).toBe(hull);
                expect(hull.components.get(PlayerNamesComponent)?.ship)
                    .toEqual('Prize Taken');
                expect(hull.components.get(ControlBitsComponent)!.has(2))
                    .toBeFalse();
                expect(events).toEqual([{ kept: 'ship', oldShipRetained: true }]);
            });

        it('says so when the prize is kept as an escort instead',
            async () => {
                const { world, boarder, events } = await swapWorld();
                captureAsEscort(world, boarder);
                expect(world.entities.get(BOARDER)).toBe(boarder);
                expect(events).toEqual(
                    [{ kept: 'escort', oldShipRetained: false }]);
            });

        it('Use As Escort runs the prize class\'s OnCapture on the pilot, '
            + 'who keeps his hull (GUESS)', async () => {
                const { world, boarder, target, gameData } = await swapWorld();
                const corsair = (await gameData.data.Ship.get(
                    SYNTHETIC.ships.corsair))!;
                capture(world, boarder);
                // The pilot's own class's OnRetire must NOT run: he keeps
                // the hull.
                const effects = await buildCaptureSetStrings(boarder,
                    undefined,
                    { ...corsair, onCapture: 'b9288', onRetire: 'b9289' },
                    gameData, MissionUniverse.shared(gameData));
                expect(effects).toEqual({ bitsSet: [9288] });
                useAsEscort(world, BOARDER,
                    { name: 'Ignored', escort: true, ...effects });
                expect(world.entities.get(BOARDER)).toBe(boarder);
                expect([...boarder.components.get(ControlBitsComponent)!]
                    .sort()).toEqual([9288, 9292]);
                expect(boarder.components.get(PlayerNamesComponent)?.ship)
                    .not.toEqual('Ignored');
                expect(target.components.has(PlayerEscortComponent))
                    .toBeTrue();
                // A duplicate finds the session gone.
                useAsEscort(world, BOARDER,
                    { name: '', escort: true, bitsSet: [2] });
                expect(boarder.components.get(ControlBitsComponent)!.has(2))
                    .toBeFalse();
            });

        it('Use As Escort takes no record from another peer', async () => {
            const { world, boarder, target } = await swapWorld();
            capture(world, boarder);
            const input: SimulationInput = {
                kind: 'captureShip',
                capture: { name: '', escort: true, bitsSet: [1] },
            };
            applySimulationInputs(world, [input], 'other peer');
            world.step();
            expect(boarder.components.get(BoardingComponent)?.capture)
                .toEqual('succeeded');
            expect(target.components.has(PlayerEscortComponent)).toBeFalse();
            expect(boarder.components.get(ControlBitsComponent)!.has(1))
                .toBeFalse();
        });

        it('replays the swap identically after a rollback', async () => {
            const { world, boarder } = await swapWorld();
            forceCaptureRoll(world, true);
            press(world, BOARDER, 'board');
            press(world, BOARDER, 'plunderCapture');
            const before = snapshotWorld(world);
            const run = () => {
                useAsMyShip(world,
                    { name: 'Prize Taken', bitsSet: [9288, 9290] });
                const hashes = [hashWorld(world).hash];
                for (let i = 0; i < 30; i++) {
                    world.step();
                    hashes.push(hashWorld(world).hash);
                }
                return hashes;
            };
            const first = run();
            expect(world.entities.get(BOARDER)).not.toBe(boarder);
            restoreWorld(world, before, deriveEntityComponents);
            expect(world.entities.get(BOARDER)!.components
                .get(ShipComponent)!.id).toEqual(SYNTHETIC.ships.skiff);
            expect(run()).toEqual(first);
            const policies = world.resources.get(SnapshotPoliciesResource)!;
            expect([...policies.unhandled]).toEqual([]);
        });
    });
});

/**
 * Matthew's item 6: boarding a disabled ship that FITS ONE OF YOUR BAYS
 * and has room captures it outright — no plunder session, no capture
 * contest, no dialog — STOWED straight into the magazine, exactly as the
 * status message has always claimed ("Captured the X into your fighter
 * bay"). The prize leaves the world; launching it again mints a fresh
 * fighter from the bay's ship class.
 *
 * Built on a MockGameData world (like bay_plugin_test) rather than a
 * parsed scenario, because the shortcut needs a carrier whose bay launches
 * exactly the class of the ship being boarded, in several capacity
 * configurations.
 */
describe('bay-capture shortcut', () => {
    const CARRIER_SHIP = 'test:carrier';
    const FIGHTER_SHIP = 'test:fighterShip';
    const OTHER_SHIP = 'test:otherShip';
    // Two bays that launch the SAME fighter class, so the lowest-sorted-id
    // preference is observable. 'test:bayA' sorts before 'test:bayB'.
    const BAY_A = 'test:bayA';
    const BAY_B = 'test:bayB';
    const BAY_A_OUTFIT = 'test:bayAOutfit';
    const BAY_B_OUTFIT = 'test:bayBOutfit';
    const ROUNDS_A = 'test:roundsA';
    const ROUNDS_B = 'test:roundsB';
    const GOVT = 'test:govt';

    async function stepWorld(world: World, steps: number) {
        for (let i = 0; i < steps; i++) {
            world.step();
            await new Promise(resolve => setImmediate(resolve));
        }
    }

    function press(world: World, uuid: string, action: string) {
        const entity = world.entities.get(uuid)!;
        entity.components.set(ShipControlStateComponent,
            new Map([[action, 'start']]) as any);
        world.emit(ShipControlEvent, undefined, [uuid]);
        world.step();
    }

    /**
     * A carrier (the boarder) alongside a disabled ship of `targetShip`.
     * `roundsA` is the carrier's magazine for bay A; `bays` how many of bay
     * A it mounts; `secondBay` mounts bay B (same fighter class) too.
     */
    async function bayWorld({
        maxAmmo = 2, bays = 1, roundsA = 0, roundsB = 0, secondBay = false,
        targetShip = FIGHTER_SHIP, bayShip = FIGHTER_SHIP,
    } = {}) {
        const gameData = new MockGameData();
        const makeBay = (id: string): BayWeaponData => ({
            ...getDefaultBayWeaponData(),
            id,
            shipID: bayShip,
            ammoType: ['weapon', id],
            maxAmmo,
            fireGroup: 'secondary',
            reload: 1,
        });
        gameData.data.Weapon.map.set(BAY_A, makeBay(BAY_A));
        gameData.data.Weapon.map.set(BAY_B, makeBay(BAY_B));
        gameData.data.Outfit.map.set(BAY_A_OUTFIT, {
            ...getDefaultOutfitData(), id: BAY_A_OUTFIT,
            weapons: { [BAY_A]: 1 },
        });
        gameData.data.Outfit.map.set(BAY_B_OUTFIT, {
            ...getDefaultOutfitData(), id: BAY_B_OUTFIT,
            weapons: { [BAY_B]: 1 },
        });
        gameData.data.Outfit.map.set(ROUNDS_A, {
            ...getDefaultOutfitData(), id: ROUNDS_A, ammoFor: BAY_A,
        });
        gameData.data.Outfit.map.set(ROUNDS_B, {
            ...getDefaultOutfitData(), id: ROUNDS_B, ammoFor: BAY_B,
        });
        // A real govt entry, not MockGettable's shared default: applyCrime
        // keys the record by the GovtData's own id, so the default's id
        // would be charged instead of this one. BoardPenalty 3: a zero
        // field is no penalty (R4, wave 39).
        gameData.data.Govt.map.set(GOVT, {
            ...getDefaultGovtData(), id: GOVT, boardPenalty: 3,
        });
        // The victim's govt owns the system, so the board is a crime here
        // (records are per system, ruling #380: in an unowned system a
        // board of 3 would fall to a zero quarter).
        gameData.data.System.map.set('test:system', {
            ...getDefaultSystemData(), id: 'test:system', govt: GOVT,
        });
        for (const id of [FIGHTER_SHIP, OTHER_SHIP]) {
            gameData.data.Ship.map.set(id, {
                ...getDefaultShipData(), id, crew: 4,
            });
        }
        const carrierData: ShipData = {
            ...getDefaultShipData(),
            id: CARRIER_SHIP,
            crew: 200,
            outfits: {
                [BAY_A_OUTFIT]: bays,
                [ROUNDS_A]: roundsA,
                ...(secondBay
                    ? { [BAY_B_OUTFIT]: 1, [ROUNDS_B]: roundsB } : {}),
            },
            physics: { ...getDefaultShipPhysics() },
        };
        gameData.data.Ship.map.set(CARRIER_SHIP, carrierData);

        const world = await makeSystem('test:system', gameData, undefined,
            { npcs: false });

        const boarder = makeShip(carrierData);
        boarder.components.set(MovementStateComponent, {
            accelerating: 0, position: new Position(0, 0),
            rotation: new Angle(0), turnBack: false, turning: 0,
            velocity: new Vector(0, 0),
        });
        // A player-controlled boarder, so the capture can stamp durable
        // ownership (PlayerEscortComponent) on its new fighter.
        boarder.components.set(ControlledByComponent, { peerId: 'test peer' });
        boarder.components.set(CreditsComponent, { credits: 0 });
        boarder.components.set(LegalRecordsComponent, new Map());

        const target = makeShip(
            gameData.data.Ship.map.get(targetShip)!);
        target.components.set(MovementStateComponent, {
            accelerating: 0, position: new Position(10, 0),
            rotation: new Angle(0), turnBack: false, turning: 0,
            velocity: new Vector(0, 0),
        });
        target.components.set(GovtComponent, { id: GOVT });

        await completeEntity(world, boarder);
        await completeEntity(world, target);
        world.entities.set(BOARDER, boarder);
        world.entities.set(TARGET, target);
        await stepWorld(world, 2);

        boarder.components.get(TargetComponent)!.target = TARGET;
        // Disable the target: armor below its 33% threshold, then a step so
        // ShipDisableSystem sets DisabledComponent.
        const armor = target.components.get(ArmorComponent)!;
        armor.current = 0.2 * armor.max;
        const shield = target.components.get(ShieldComponent);
        if (shield) {
            shield.current = 0;
        }
        await stepWorld(world, 1);
        expect(target.components.has(DisabledComponent)).toBeTrue();

        return { world, boarder, target, gameData };
    }

    /** Records BayCaptureEvent (targeted at the boarder). */
    function recordCaptures(world: World): { uuid: string, shipId: string }[] {
        const seen: { uuid: string, shipId: string }[] = [];
        world.addSystem(new System({
            name: 'BayCaptureRecorder',
            events: [BayCaptureEvent],
            args: [BayCaptureEvent, UUID] as const,
            step({ shipId }, uuid) { seen.push({ uuid, shipId }); },
        }));
        return seen;
    }

    function recordRepairs(world: World): string[] {
        const seen: string[] = [];
        world.addSystem(new System({
            name: 'RepairRecorder2',
            events: [EscortRepairedEvent],
            args: [UUID] as const,
            step(uuid) { seen.push(uuid); },
        }));
        return seen;
    }

    function rounds(boarder: Entity, id: string): number {
        return boarder.components.get(OutfitsStateComponent)?.get(id)?.count
            ?? 0;
    }

    /** A stub already-deployed fighter of `bayId` launched by the boarder. */
    function addDeployedFighter(world: World, bayId: string, uuid: string) {
        const fighter = new Entity();
        fighter.components.set(BayFighterComponent, { bayWeaponId: bayId });
        fighter.components.set(SourceComponent, BOARDER);
        world.entities.set(uuid, fighter);
        world.step();
    }

    it('stows the hulk in the bay — magazine credited, ship gone, with no '
        + 'session, dialog, or contest', async () => {
            const { world, boarder, target } = await bayWorld();
            const captures = recordCaptures(world);
            const repairs = recordRepairs(world);

            press(world, BOARDER, 'board');

            // No plunder session on either side, and the repair path did
            // not run (the shortcut overrides it).
            expect(boarder.components.has(BoardingComponent)).toBeFalse();
            expect(target.components.has(BoardedComponent)).toBeFalse();
            expect(repairs).toEqual([]);
            // The prize is IN the bay: one round credited, and the ship
            // itself is out of the world — no deployed fighter left flying
            // around to contradict the status message.
            expect(rounds(boarder, ROUNDS_A)).toEqual(1);
            expect(world.entities.has(TARGET)).toBeFalse();
            // Nothing was stamped on the hulk on the way out.
            expect(target.components.has(BayFighterComponent)).toBeFalse();
            expect(target.components.has(FormationComponent)).toBeFalse();
            expect(target.components.has(EscortCommandComponent)).toBeFalse();
            expect(target.components.has(PlayerEscortComponent)).toBeFalse();
            // The boarder is no longer pointed at a ship that is gone.
            expect(boarder.components.get(TargetComponent)?.target)
                .toBeUndefined();
            // The player gets the only feedback there is.
            expect(captures).toEqual([{ uuid: BOARDER,
                shipId: FIGHTER_SHIP }]);
        });

    it('credits exactly one round however many bays are mounted',
        async () => {
            const { world, boarder } = await bayWorld({ bays: 2, maxAmmo: 4 });
            press(world, BOARDER, 'board');
            expect(rounds(boarder, ROUNDS_A)).toEqual(1);
            expect(world.entities.has(TARGET)).toBeFalse();
        });

    it('re-launches the stowed prize as a fresh fighter of the bay\'s '
        + 'ship class', async () => {
            // The round banked by a capture is an ordinary round: firing
            // the bay spends it and puts a fighter back in the sky.
            const { world, boarder } = await bayWorld();
            press(world, BOARDER, 'board');
            expect(rounds(boarder, ROUNDS_A)).toEqual(1);

            const weapons = boarder.components.get(WeaponsStateComponent)!;
            weapons.get(BAY_A)!.firing = true;
            await stepWorld(world, 2);

            expect(rounds(boarder, ROUNDS_A)).toEqual(0);
            const launched = [...world.entities].filter(([, entity]) =>
                entity.components.get(BayFighterComponent)?.bayWeaponId
                === BAY_A);
            expect(launched.length).toEqual(1);
            expect(launched[0][1].components.get(ShipComponent)?.id)
                .toEqual(FIGHTER_SHIP);
        });

    it('falls through to normal boarding when the magazine is full',
        async () => {
            // 1 bay x MaxAmmo 1, already holding its fighter.
            const { world, boarder, target } = await bayWorld({
                maxAmmo: 1, roundsA: 1,
            });
            const captures = recordCaptures(world);
            press(world, BOARDER, 'board');
            expect(captures).toEqual([]);
            expect(target.components.has(BayFighterComponent)).toBeFalse();
            expect(boarder.components.get(BoardingComponent)?.target)
                .toEqual(TARGET);
        });

    it('counts already-deployed fighters against the room check',
        async () => {
            // Capacity 1, magazine empty — but one of this bay's fighters
            // is already out, so there is nowhere to put another.
            const { world, boarder, target } = await bayWorld({ maxAmmo: 1 });
            addDeployedFighter(world, BAY_A, 'deployed fighter');
            const captures = recordCaptures(world);
            press(world, BOARDER, 'board');
            expect(captures).toEqual([]);
            expect(target.components.has(BayFighterComponent)).toBeFalse();
            expect(boarder.components.get(BoardingComponent)?.target)
                .toEqual(TARGET);
        });

    it('ignores another bay\'s deployed fighters in the room check',
        async () => {
            const { world, boarder } = await bayWorld({ maxAmmo: 1 });
            addDeployedFighter(world, 'test:someOtherBay', 'other fighter');
            press(world, BOARDER, 'board');
            expect(rounds(boarder, ROUNDS_A)).toEqual(1);
            expect(world.entities.has(TARGET)).toBeFalse();
        });

    it('treats MaxAmmo 0 as unbounded room', async () => {
        const { world, boarder } = await bayWorld({ maxAmmo: 0, roundsA: 99 });
        press(world, BOARDER, 'board');
        expect(rounds(boarder, ROUNDS_A)).toEqual(100);
        expect(world.entities.has(TARGET)).toBeFalse();
    });

    it('captures into the lowest-sorted bay id when two bays fit',
        async () => {
            const { world, boarder } = await bayWorld({ secondBay: true });
            press(world, BOARDER, 'board');
            expect(rounds(boarder, ROUNDS_A)).toEqual(1);
            expect(rounds(boarder, ROUNDS_B)).toEqual(0);
            expect(world.entities.has(TARGET)).toBeFalse();
        });

    it('uses the other bay when the lowest-sorted one is full', async () => {
        const { world, boarder } = await bayWorld({
            maxAmmo: 1, roundsA: 1, secondBay: true, roundsB: 0,
        });
        press(world, BOARDER, 'board');
        expect(rounds(boarder, ROUNDS_A)).toEqual(1);
        expect(rounds(boarder, ROUNDS_B)).toEqual(1);
        expect(world.entities.has(TARGET)).toBeFalse();
    });

    it('never stows a ship somebody is flying, whatever class it is',
        async () => {
            // Bug 1's other route: the instant bay capture would have
            // swallowed a peer's disabled fighter whole. It falls through
            // to the ordinary plunder session instead.
            const { world, boarder, target } = await bayWorld();
            target.components.set(ControlledByComponent,
                { peerId: 'the other peer' });
            const captures = recordCaptures(world);

            press(world, BOARDER, 'board');

            expect(captures).toEqual([]);
            expect(world.entities.has(TARGET)).toBeTrue();
            expect(rounds(boarder, ROUNDS_A)).toEqual(0);
            expect(boarder.components.get(BoardingComponent)?.target)
                .toEqual(TARGET);
        });

    it('leaves the hulk alone when there is no magazine to credit',
        async () => {
            // The boarder mounts the bay but has never owned a round of
            // its ammo, so there is no supplying outfit to credit. Better
            // to fall through to a plunder session than to delete a ship
            // and bank nothing.
            const { world, boarder, target } = await bayWorld();
            boarder.components.get(OutfitsStateComponent)!.delete(ROUNDS_A);
            const captures = recordCaptures(world);

            press(world, BOARDER, 'board');

            expect(captures).toEqual([]);
            expect(world.entities.has(TARGET)).toBeTrue();
            expect(target.components.has(DisabledComponent)).toBeTrue();
            expect(boarder.components.get(BoardingComponent)?.target)
                .toEqual(TARGET);
        });

    it('leaves a ship class no bay launches to normal boarding', async () => {
        const { world, boarder, target } = await bayWorld({
            targetShip: OTHER_SHIP,
        });
        const captures = recordCaptures(world);
        press(world, BOARDER, 'board');
        expect(captures).toEqual([]);
        expect(target.components.has(BayFighterComponent)).toBeFalse();
        expect(boarder.components.get(BoardingComponent)?.target)
            .toEqual(TARGET);
    });

    it('charges the same board crime a plunder capture would', async () => {
        const { world, boarder } = await bayWorld();
        press(world, BOARDER, 'board');
        expect(boarder.components.get(LegalRecordsComponent)!
            .get('test:system')).toBeLessThan(0);
    });

    it('draws nothing from the seeded PRNG', async () => {
        // The shortcut must not shift the random sequence: with rollback
        // resimulation, a press that consumed a draw on some peers only
        // (or in some replays) would desync everything downstream of it.
        const { world } = await bayWorld();
        const random = world.resources.get(RandomResource)!;
        const before = random.getState();
        press(world, BOARDER, 'board');
        expect(world.entities.has(TARGET)).toBeFalse();
        expect(random.getState()).toEqual(before);
    });

    describe('precedence over the former-escort repair', () => {
        /** The hulk is durably marked as the boarder's (former) escort. */
        function markFormerEscort(world: World, target: Entity) {
            target.components.set(PlayerEscortComponent, { player: BOARDER, deal: NO_DEAL });
            world.step();
        }

        it('bay-captures a former escort that fits with room', async () => {
            const { world, boarder, target } = await bayWorld();
            markFormerEscort(world, target);
            const repairs = recordRepairs(world);
            const captures = recordCaptures(world);

            press(world, BOARDER, 'board');

            expect(rounds(boarder, ROUNDS_A)).toEqual(1);
            expect(world.entities.has(TARGET)).toBeFalse();
            expect(captures.length).toEqual(1);
            expect(repairs).toEqual([]);
        });

        it('falls back to repairing a former escort with no bay room',
            async () => {
                const { world, boarder, target } = await bayWorld({
                    maxAmmo: 1, roundsA: 1,
                });
                markFormerEscort(world, target);
                const repairs = recordRepairs(world);
                const captures = recordCaptures(world);

                press(world, BOARDER, 'board');

                expect(captures).toEqual([]);
                expect(target.components.has(BayFighterComponent)).toBeFalse();
                expect(repairs).toEqual([BOARDER]);
                expect(target.components.has(DisabledComponent)).toBeFalse();
                expect(target.components.get(FormationComponent)?.leader)
                    .toEqual(BOARDER);
                expect(boarder.components.has(BoardingComponent)).toBeFalse();
            });
    });

    /**
     * PLUNDER specs on the mock world. These were written as twins of the
     * live-world plunder specs back when that suite ran on Nova_Data and
     * so was skipped wholesale on a checkout without the game files
     * (data-less CI, review machines) — including the HIGH-severity
     * credit-farm regression. The live-world suite now runs on the
     * checked-in synthetic scenario and no longer skips; these stay
     * because they exercise the same rules against a carrier/bay
     * configuration built to order.
     *
     * OTHER_SHIP is deliberately a class no bay here launches, so the
     * bay-capture shortcut does not fire and boarding falls through to the
     * ordinary plunder session.
     */
    describe('plunder, on mock game data', () => {
        const PRICE = 10_000;

        /** A mock world whose hulk is worth plundering: not bay-capturable,
         * and priced, since the credit booty is a fraction of ship price
         * (the stock default price is 0, which would make it vacuous). */
        async function plunderWorld() {
            const ctx = await bayWorld({ targetShip: OTHER_SHIP });
            const { world, target } = ctx;
            // Applied after the provide step, as the crew overrides in the
            // live-world suite are, so ShipDataProvider does not undo it.
            target.components.set(ShipDataComponent, {
                ...target.components.get(ShipDataComponent)!, price: PRICE,
            });
            world.step();
            return ctx;
        }

        it('spends the hulk for good, against a SECOND pirate too',
            async () => {
                // The re-farm this pins shut: credits are the one booty
                // not physically removed from the victim (creditsAvailable
                // is re-derived from the ship price on every board), so
                // "take credits, die without pressing done, come back"
                // used to be an unbounded money supply. Under the
                // one-plunder ruling the hulk refuses the next boarding
                // outright — including by a DIFFERENT pirate, which is the
                // half a per-boarder flag could never cover.
                const { world, boarder, target, gameData } =
                    await plunderWorld();
                const booty = creditBooty(PRICE, 0);
                expect(booty).toBeGreaterThan(0);

                press(world, BOARDER, 'board');
                expect(boarder.components.get(BoardingComponent)?.target)
                    .toEqual(TARGET);
                press(world, BOARDER, 'plunderCredits');
                expect(boarder.components.get(CreditsComponent)!.credits)
                    .toEqual(booty);

                // UNGRACEFUL end: the boarder is destroyed mid-session, so
                // no session-end path ever runs on it.
                world.entities.delete(BOARDER);
                world.step();

                // The HULK is what has to remember, and it remembers both
                // halves straight away — not at a session end that never
                // comes.
                expect(target.components.get(BoardedComponent)?.creditsTaken)
                    .toBeTrue();
                expect(target.components.get(BoardedComponent)?.plundered)
                    .toBeTrue();

                // A brand-new boarder tries to take over the same hulk.
                const second = makeShip(
                    gameData.data.Ship.map.get(CARRIER_SHIP)!);
                second.components.set(MovementStateComponent, {
                    accelerating: 0, position: new Position(0, 0),
                    rotation: new Angle(0), turnBack: false, turning: 0,
                    velocity: new Vector(0, 0),
                });
                second.components.set(ControlledByComponent,
                    { peerId: 'second peer' });
                second.components.set(CreditsComponent, { credits: 0 });
                second.components.set(LegalRecordsComponent, new Map());
                await completeEntity(world, second);
                world.entities.set(SECOND_BOARDER, second);
                await stepWorld(world, 2);
                second.components.set(CreditsComponent, { credits: 0 });
                second.components.get(TargetComponent)!.target = TARGET;
                world.step();

                press(world, SECOND_BOARDER, 'board');
                expect(second.components.has(BoardingComponent)).toBeFalse();
                press(world, SECOND_BOARDER, 'plunderCredits');
                expect(second.components.get(CreditsComponent)!.credits)
                    .toEqual(0);
            });

        it('a captured prize sheds the bay DOCKING PLUMBING, not just the '
            + 'launch link', async () => {
                // startReturnHome makes a fighter physically hit its carrier
                // so the contact fires CollectableEscortAI and it is scooped
                // up: a CollisionHitter for `return_escorts` plus a Hurtbox
                // hull copied from its hitbox. Capture a wing that was
                // already on its way home and that plumbing used to survive
                // onto the player's new escort — inert only for as long as
                // its consumer stays gated on CollectableEscortComponent,
                // and stale bay identity on a prize is precisely what caused
                // the half-escort bug.
                const { world, boarder, target } = await plunderWorld();
                startReturnHome(target);
                world.step();
                // Precondition: the plumbing really is on the hull.
                expect(target.components.get(CollisionHitterComponent)
                    ?.hitTypes.has('return_escorts')).toBeTrue();
                expect(target.components.has(HurtboxHullComponent)).toBeTrue();

                captureAsEscort(world, boarder);

                expect(target.components.has(CollisionHitterComponent))
                    .toBeFalse();
                expect(target.components.has(HurtboxHullComponent))
                    .toBeFalse();
                // The rest of the return-home state goes too, as before.
                expect(target.components.has(ReturnComponent)).toBeFalse();
                expect(target.components.has(CollectableEscortComponent))
                    .toBeFalse();
                // And it is a real escort of the captor.
                expect(target.components.get(FormationComponent)?.leader)
                    .toEqual(BOARDER);
            });

        /** The capture flow, with the session's one roll forced to land. */
        function captureAsEscort(world: World, boarder: Entity) {
            forceCaptureRoll(world, true);
            press(world, BOARDER, 'board');
            press(world, BOARDER, 'plunderCapture');
            expect(boarder.components.get(BoardingComponent)?.capture)
                .toEqual('succeeded');
            useAsEscort(world, BOARDER);
        }
    });
});
