import 'jasmine';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { Entity } from 'nova_ecs/entity';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { MultiplayerData } from 'nova_ecs/plugins/multiplayer_plugin';
import { World } from 'nova_ecs/world';
import { SYNTHETIC } from 'novaparse/synthetic/universe';
import { getSyntheticGameData } from '../../communication/simulation_test_fixture.js';
import { GovtComponent } from '../core/index.js';
import { makeSystem } from '../make_system.js';
import { FormationComponent, NpcComponent } from '../npc/index.js';
import {
    ControlledByComponent, EscortCommandComponent, NO_DEAL,
    PlayerEscortComponent,
} from '../player/index.js';
import {
    DisabledComponent, FiringGroupComponent, makeShip, OutfitsStateComponent,
    TargetComponent, WeaponsStateComponent,
} from '../ship/index.js';
import { completeEntity } from '../spawn/index.js';
import { BayFighterComponent, ReturnComponent } from './bay_plugin.js';
import { sweepableEscorts } from './player_escort_plugin.js';

/**
 * ============================================================================
 * The player's CARRIER ESCORT on real (synthetic) data: launch, fight, recall
 * ============================================================================
 *
 * Matthew (2026-11-26): "Escorts never launch their fighters in novajs."
 * A hired Heron Warden (Skiff Bay, two skiffs aboard) flies with the
 * player. Unordered it keeps its hangar shut (reference R6: the player's
 * own launched fighters fly formation until ordered, and nothing
 * measured has an escort launch on its own). Ordered to attack it
 * launches one skiff per reload at the victim, like an NPC carrier of the
 * same hull fighting the same ship (npc_carrier_integration_test); the
 * skiffs are the player's (escort-owned) fighters: they take the
 * carrier's order, follow the player out of the system, dock on the
 * returnToBay order, and dock ON THEIR OWN once the carrier's fight is over
 * (reference "The escort carrier's `d` with an intruder, and its fighters'
 * return (EC leftover), wave 46").
 */

const WARDEN = SYNTHETIC.ships.warden;
const CORSAIR = SYNTHETIC.ships.corsair;
const SKIFF = SYNTHETIC.ships.skiff;
const SKIFF_BAY = SYNTHETIC.weapons.skiffBay;
const RAIDERS = SYNTHETIC.govts.raiders;

type GameData = Awaited<ReturnType<typeof getSyntheticGameData>>;

describe('A carrier escort (synthetic data)', () => {
    let gameData: GameData;
    let world: World;

    beforeEach(async () => {
        gameData = await getSyntheticGameData();
        // Thessaly Reach: no asteroids; npcs off, so only these ships.
        world = await makeSystem(SYNTHETIC.systems.thessaly, gameData,
            undefined, { npcs: false });
    });

    async function addShip(uuid: string, shipId: string, x: number, y: number,
        setup: (ship: Entity) => void = () => { }) {
        const ship = makeShip(await gameData.data.Ship.get(shipId));
        ship.components.set(MultiplayerData, { owner: 'server' });
        setup(ship);
        await completeEntity(world, ship);
        ship.components.set(MovementStateComponent, {
            position: new Position(x, y),
            velocity: new Vector(0, 0),
            rotation: new Angle(0),
            accelerating: 0,
            turning: 0,
            turnBack: false,
        });
        world.entities.set(uuid, ship);
        return ship;
    }

    /** The player, a parked raider 600 px off, and a Warden hired at the
     * bar flying formation on the player (fleet_insertion's
     * buildHiredEscort: an NPC hull under the default escort command, in
     * the player's firing group, marked hired). */
    async function setUp(raiderSetup: (ship: Entity) => void = () => { }) {
        await addShip('player', SKIFF, 0, 300, ship => {
            ship.components.set(ControlledByComponent, { peerId: 'p' });
        });
        await addShip('raider', CORSAIR, 600, 0, ship => {
            ship.components.set(GovtComponent, { id: RAIDERS });
            raiderSetup(ship);
        });
        return addShip('carrier', WARDEN, 0, 0, ship => {
            ship.components.set(NpcComponent, { aiType: 3 });
            ship.components.set(TargetComponent, { target: undefined });
            ship.components.set(FormationComponent,
                { leader: 'player', slot: 0 });
            ship.components.set(EscortCommandComponent,
                { command: 'formation' });
            ship.components.set(FiringGroupComponent, { group: 'player' });
            ship.components.set(PlayerEscortComponent, {
                player: 'player', parent: 'player', provenance: 'hired',
                deal: NO_DEAL,
            });
        });
    }

    function step(ticks: number) {
        for (let i = 0; i < ticks; i++) {
            world.step();
        }
    }

    function wings(): [string, Entity][] {
        return [...world.entities].filter(([, entity]) =>
            entity.components.has(BayFighterComponent));
    }

    /** Skiffs left in the carrier's magazine. */
    function magazine(carrier: Entity): number {
        let total = 0;
        for (const [id, outfit] of carrier.components
            .get(OutfitsStateComponent) ?? []) {
            if (gameData.data.Outfit.getCached(id)?.ammoFor === SKIFF_BAY) {
                total += outfit.count;
            }
        }
        return total;
    }

    /** Steps until both skiffs are out; returns the launch ticks. */
    function launchBoth(): number[] {
        const launches: number[] = [];
        for (let tick = 0; tick < 60 * 10 && launches.length < 2; tick++) {
            step(1);
            if (wings().length > launches.length) {
                launches.push(tick);
            }
        }
        return launches;
    }

    it('keeps its hangar shut in formation', async () => {
        const carrier = await setUp();
        step(180);
        expect(carrier.components.get(WeaponsStateComponent)!
            .get(SKIFF_BAY)!.firing).toBeFalse();
        expect(wings().length).toBe(0);
        expect(magazine(carrier)).toBe(2);
    });

    it('launches its skiffs one per reload when ordered to attack, and the '
        + 'skiffs are the player\'s, attacking the same ship', async () => {
            const carrier = await setUp();
            expect(magazine(carrier)).withContext('skiffs aboard').toBe(2);
            // What EscortCommandInputSystem writes for `f` with the raider
            // targeted.
            carrier.components.set(EscortCommandComponent,
                { command: 'attack', target: 'raider' });

            const launches = launchBoth();
            expect(launches.length).withContext('both skiffs out').toBe(2);
            // One per reload: the Skiff Bay's Reload is 60 frames of the
            // original's 30 fps, two seconds.
            expect(launches[1] - launches[0]).toBeGreaterThanOrEqual(110);
            expect(magazine(carrier)).toBe(0);

            step(2);
            for (const [, wing] of wings()) {
                // Escort-owned: the player's, through the carrier.
                expect(wing.components.get(PlayerEscortComponent))
                    .toEqual(jasmine.objectContaining(
                        { player: 'player', parent: 'carrier' }));
                // Mirrored from the carrier (EscortCommandPropagation).
                expect(wing.components.get(EscortCommandComponent))
                    .toEqual({ command: 'attack', target: 'raider' });
                expect(wing.components.get(TargetComponent)?.target)
                    .toBe('raider');
            }
            // The skiffs fight: within a few seconds one of them has its
            // guns on the raider.
            let wingFired = false;
            for (let i = 0; i < 60 * 5 && !wingFired; i++) {
                step(1);
                wingFired = wings().some(([, wing]) =>
                    [...wing.components.get(WeaponsStateComponent) ?? []]
                        .some(([, weapon]) => weapon.firing));
            }
            expect(wingFired).withContext('a skiff fired').toBeTrue();
        });

    it('launches when defending against an intruder, and not on an attack '
        + 'order with no target', async () => {
            // A raider warship (AI 3 of an always-attacks-player gövt):
            // hostile on sight, so an intruder for 'defend'.
            const carrier = await setUp(ship => {
                ship.components.set(NpcComponent, { aiType: 3 });
                ship.components.set(TargetComponent, { target: undefined });
            });
            // `f` with nothing targeted: the order stands, the carrier
            // keeps formation and its hangar shut.
            carrier.components.set(EscortCommandComponent,
                { command: 'attack' });
            step(180);
            expect(wings().length).toBe(0);

            // `d`: the raider (an always-attacks-player gövt) is inside
            // the defend bubble, so the carrier engages it and launches.
            carrier.components.set(EscortCommandComponent,
                { command: 'defend' });
            expect(launchBoth().length).withContext('both skiffs out')
                .toBe(2);
            expect(carrier.components.get(EscortCommandComponent)?.target)
                .toBe('raider');
        });

    /** Steps until no skiff is left out; returns whether they all docked
     * within `seconds`. */
    function stepUntilDocked(seconds = 30): boolean {
        for (let i = 0; i < 60 * seconds; i++) {
            step(1);
            if (wings().length === 0) {
                return true;
            }
        }
        return false;
    }

    it('docks its skiffs on its own once the victim is gone (reference EC '
        + 'wave 46; GUESS for `f`)', async () => {
            const carrier = await setUp();
            carrier.components.set(EscortCommandComponent,
                { command: 'attack', target: 'raider' });
            expect(launchBoth().length).toBe(2);

            world.entities.delete('raider');
            step(2);
            expect(carrier.components.get(EscortCommandComponent))
                .toEqual({ command: 'formation' });
            // No `c`, no Alt+C: the fight is over, so the wings fly home.
            for (const [, wing] of wings()) {
                expect(wing.components.get(EscortCommandComponent)?.command)
                    .toBe('returnToBay');
                expect(wing.components.has(ReturnComponent)).toBeTrue();
            }
            expect(stepUntilDocked()).withContext('both skiffs docked')
                .toBeTrue();
            expect(magazine(carrier)).toBe(2);
            // Formation does not re-open the hangar.
            step(180);
            expect(wings().length).toBe(0);
        });

    it('after `d`, docks its skiffs on its own once the intruder is '
        + 'DISABLED, and keeps formation itself (reference EC wave 46)',
        async () => {
            const carrier = await setUp(ship => {
                ship.components.set(NpcComponent, { aiType: 3 });
                ship.components.set(TargetComponent, { target: undefined });
            });
            carrier.components.set(EscortCommandComponent,
                { command: 'defend' });
            expect(launchBoth().length).withContext('both skiffs out')
                .toBe(2);
            step(2);
            for (const [, wing] of wings()) {
                expect(wing.components.get(EscortCommandComponent))
                    .toEqual({ command: 'defend', target: 'raider' });
            }

            // The intruder goes Disabled (a hulk, so nothing repairs it).
            world.entities.get('raider')!.components.set(DisabledComponent,
                { repairAt: null, hulk: true });
            step(3);
            // The carrier's defend order stands, with no intruder.
            expect(carrier.components.get(EscortCommandComponent)?.command)
                .toBe('defend');
            expect(carrier.components.get(EscortCommandComponent)?.target)
                .toBeUndefined();
            for (const [, wing] of wings()) {
                expect(wing.components.has(ReturnComponent))
                    .withContext('flying home').toBeTrue();
            }
            expect(stepUntilDocked()).withContext('both skiffs docked')
                .toBeTrue();
            expect(magazine(carrier)).toBe(2);
            // Nothing left to defend against: the hangar stays shut.
            step(180);
            expect(wings().length).toBe(0);
        });

    it('after `f`, recalls its skiffs once the victim is disabled and does '
        + 'not launch again at the hulk (GUESS)', async () => {
            const carrier = await setUp();
            carrier.components.set(EscortCommandComponent,
                { command: 'attack', target: 'raider' });
            expect(launchBoth().length).toBe(2);
            world.entities.get('raider')!.components.set(DisabledComponent,
                { repairAt: null, hulk: true });
            step(2);
            // The attack order outlives the disable (the carrier's guns
            // stay on the hulk), but the wings are recalled.
            expect(carrier.components.get(EscortCommandComponent))
                .toEqual({ command: 'attack', target: 'raider' });
            for (const [, wing] of wings()) {
                expect(wing.components.has(ReturnComponent)).toBeTrue();
            }
            expect(stepUntilDocked()).withContext('both skiffs docked')
                .toBeTrue();
            step(300);
            expect(carrier.components.get(WeaponsStateComponent)!
                .get(SKIFF_BAY)!.firing).toBeFalse();
            expect(wings().length).toBe(0);
            expect(magazine(carrier)).toBe(2);
        });

    it('docks its skiffs on Alt+C mid-fight, and a recall is final',
        async () => {
            const carrier = await setUp();
            carrier.components.set(EscortCommandComponent,
                { command: 'attack', target: 'raider' });
            expect(launchBoth().length).toBe(2);
            // Alt+C reaches the carrier (a direct escort), which mirrors
            // it to its wings: they fly home and dock, restocking the bay.
            carrier.components.set(EscortCommandComponent,
                { command: 'returnToBay' });
            step(1);
            for (const [, wing] of wings()) {
                expect(wing.components.has(ReturnComponent)).toBeTrue();
            }
            // `f` again before they are home: the ones flying home keep
            // going (a recall is final).
            carrier.components.set(EscortCommandComponent,
                { command: 'attack', target: 'raider' });
            step(2);
            for (const [, wing] of wings()) {
                expect(wing.components.get(EscortCommandComponent)?.command)
                    .toBe('returnToBay');
                expect(wing.components.has(ReturnComponent)).toBeTrue();
            }
        });

    it('takes its launched skiffs along when the player jumps out',
        async () => {
            const carrier = await setUp();
            carrier.components.set(EscortCommandComponent,
                { command: 'attack', target: 'raider' });
            expect(launchBoth().length).toBe(2);
            step(2);
            const swept = sweepableEscorts(world.entities, 'player', 'jump');
            expect(swept).toContain('carrier');
            for (const [uuid] of wings()) {
                expect(swept).withContext(uuid).toContain(uuid);
            }
        });
});
