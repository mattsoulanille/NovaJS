import 'jasmine';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { Entity } from 'nova_ecs/entity';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { World } from 'nova_ecs/world';
import { SYNTHETIC } from 'novaparse/synthetic/universe';
import {
    getSyntheticGameData,
} from '../../communication/simulation_test_fixture.js';
import { MissionUniverse } from '../../spaceport/mission_universe.js';
import { styleForTarget } from '../combat/index.js';
import { GovtComponent } from '../core/index.js';
import { ControlBitsComponent } from '../ncb/index.js';
import { NpcComponent } from '../npc/index.js';
import {
    ActiveMission, ControlledByComponent, GOAL_ESCORT, MissionsComponent,
    MissionShipComponent, ShipObjective,
} from '../player/index.js';
import { LegalRecordsComponent } from '../reputation/index.js';
import { completeEntity } from '../spawn/index.js';
import {
    makeShip, OwnerComponent, ShipComponent, TargetComponent,
    WeaponsStateComponent,
} from '../ship/index.js';
import { makeSystem } from '../make_system.js';
import { buildMissionShipSpawns } from './mission_ship_spawn.js';

/**
 * ============================================================================
 * A ShipBehav 1 special ship protects the player — it never hunts them
 * ============================================================================
 *
 * Matthew's playtest report against stock mïsn 668, "Escort Moash
 * Dignitary": the dignitary's Aurora Cruiser (düde 221, govt Family Moash,
 * AI type 3, ShipGoal 3 / ShipBehav 1) opened fire on the player it was
 * supposed to be protecting, while the target display showed it with
 * FRIENDLY (green) brackets.
 *
 * Both readings were "right" by their own rule, which was the bug:
 *
 *  - the brackets (hostility.ts's styleForTarget) put the player's own
 *    FLOCK ahead of politics, and a ShipBehav 1 ship is in the flock — it
 *    flies formation on the player and shares their firing group;
 *  - the ship's own brain (NpcDecisionSystem) knew nothing of the flock. It
 *    collected hostiles by its GOVERNMENT's view of every ship, and the
 *    player's legal record with the Moash was criminal (-40 against a
 *    CrimeTol of 10 in the Auroran-string pilot — the player had just
 *    destroyed a Moash fleet for mïsn 737). So the player was a hostile,
 *    and, flying in formation right beside it, the NEAREST hostile, which
 *    is the one an AI-type-3 warship engages.
 *
 * The same scenario on the checked-in synthetic data: a Concord of Meridian
 * patrol cruiser (düde "Meridian Patrol", AI type 3, CrimeTol 20) spawned as
 * a ShipBehav 1 escort-goal special ship for a player whose Meridian record
 * is criminal.
 */

const PLAYER = 'player-uuid';
const ATTACKER = 'attacker-uuid';
/** Far below Meridian's CrimeTol of 20: its warships hunt this player. */
const CRIMINAL_RECORD = -100;
/** Long enough for several think intervals and a launched bay wing. */
const STEPS = 600;

function objective(behavior: number): ShipObjective {
    return {
        goal: GOAL_ESCORT,
        systemId: null,
        shipStart: 0,
        behavior,
        dudeId: SYNTHETIC.dudes.patrol,
        total: 1,
        satisfied: 0,
        complete: false,
        failed: false,
        shipDonePending: false,
        live: new Map(),
    };
}

function activeMission(shipObjective: ShipObjective): ActiveMission {
    return {
        id: 'test:escort',
        acceptedDay: 0,
        acceptedAt: SYNTHETIC.planets.port,
        travelPlanet: null,
        returnPlanet: null,
        cargoType: -1,
        cargoQty: 0,
        cargoLoaded: false,
        travelDone: false,
        deadlineDay: null,
        shipObjective,
    };
}

function at(x: number, y: number) {
    return {
        accelerating: 0,
        position: new Position(x, y),
        rotation: new Angle(0),
        turnBack: false,
        turning: 0,
        velocity: new Vector(0, 0),
    };
}

interface Scenario {
    world: World;
    protector: string;
}

/**
 * Thessaly Reach with no ambient traffic: the player (criminal with
 * Meridian unless `record` says otherwise), and the mission's special ship
 * built by the real spawn path, parked a formation slot's distance away.
 */
async function scenario(options: { record?: number } = {}):
    Promise<Scenario> {
    const gameData = await getSyntheticGameData();
    const universe = MissionUniverse.shared(gameData);
    await universe.load();
    const world = await makeSystem(SYNTHETIC.systems.thessaly, gameData,
        undefined, { npcs: false });

    const player = makeShip(await gameData.data.Ship.get(
        SYNTHETIC.ships.skiff));
    player.components.set(ControlledByComponent, { peerId: 'peer' });
    player.components.set(ControlBitsComponent, new Set());
    player.components.set(LegalRecordsComponent, new Map([
        [SYNTHETIC.govts.meridian, options.record ?? CRIMINAL_RECORD]]));
    player.components.set(MissionsComponent,
        new Map([['test:escort', activeMission(objective(1))]]));
    player.components.set(MovementStateComponent, at(0, 0));

    const ships = await buildMissionShipSpawns(player, PLAYER,
        SYNTHETIC.systems.thessaly, gameData, universe, 0, () => 0.5);
    expect(ships.length).toBe(1);
    await completeEntity(world, player);
    world.entities.set(PLAYER, player);
    const protector = 'protector-uuid';
    const ship = ships[0];
    ship.components.set(MovementStateComponent, at(0, 150));
    await completeEntity(world, ship);
    world.entities.set(protector, ship);
    return { world, protector };
}

/**
 * An independent (govt-less) raider hull that is attacking the player: the
 * Meridian cruiser's government has no quarrel with it, so only the
 * protect-the-player rule can make the cruiser engage it.
 */
async function addAttacker(world: World, govt?: string) {
    const gameData = await getSyntheticGameData();
    const attacker = makeShip(await gameData.data.Ship.get(
        SYNTHETIC.ships.corsair));
    if (govt !== undefined) {
        attacker.components.set(GovtComponent, { id: govt });
    }
    attacker.components.set(NpcComponent, { aiType: 3, aggressor: PLAYER });
    attacker.components.set(MovementStateComponent, at(700, 0));
    await completeEntity(world, attacker);
    world.entities.set(ATTACKER, attacker);
}

/**
 * Runs the scenario for STEPS and reports whether the protector engaged
 * ATTACKER of its own accord — before a stray shot made the attacker its
 * own aggressor (any warship fights back against that) — and whether the
 * attacker was ever attacking the player at all (else the run proves
 * nothing).
 */
async function watchProtector(world: World, protector: string) {
    let engagedUnprovoked = false;
    let provoked = false;
    let attackerAttacked = false;
    for (let i = 0; i < STEPS; i++) {
        world.step();
        const ship = world.entities.get(protector)!;
        const npc = ship.components.get(NpcComponent)!;
        provoked ||= npc.aggressor === ATTACKER;
        const attacker = world.entities.get(ATTACKER);
        attackerAttacked ||= attacker !== undefined
            && attacker.components.get(TargetComponent)?.target === PLAYER
            && attacker.components.get(NpcComponent)?.mode === 'attack';
        engagedUnprovoked ||= !provoked && npc.mode === 'attack'
            && ship.components.get(TargetComponent)!.target === ATTACKER;
    }
    return { engagedUnprovoked, attackerAttacked };
}

/** Every SHIP that is the protector or flies off it (its bay wing). */
function protectorFlock(world: World, protector: string): [string, Entity][] {
    return [...world.entities].filter(([uuid, entity]) =>
        entity.components.has(ShipComponent) && (uuid === protector
            || entity.components.get(OwnerComponent)?.owner === protector));
}

/** Whether `entity` has the player as its target or any weapon's. */
function aimsAtPlayer(entity: Entity): boolean {
    if (entity.components.get(TargetComponent)?.target === PLAYER) {
        return true;
    }
    for (const [, weapon] of entity.components.get(WeaponsStateComponent)
        ?? new Map()) {
        if (weapon.firing && weapon.target === PLAYER) {
            return true;
        }
    }
    return false;
}

describe('a ShipBehav 1 ("protect the player") special ship', () => {
    it('is in the player\'s flock (the brackets say friendly) and is '
        + 'tagged as the mission\'s special ship', async () => {
            const { world, protector } = await scenario();
            const ship = world.entities.get(protector)!;
            const tag = ship.components.get(MissionShipComponent);
            expect(tag?.owner).toBe(PLAYER);
            expect(tag?.aux).toBeFalsy();
            world.step();
            const gameData = await getSyntheticGameData();
            expect(styleForTarget(protector, ship, PLAYER,
                world.entities.get(PLAYER)!, gameData,
                uuid => world.entities.get(uuid), 0)).toBe('friendly');
        });

    it('never targets or fires on the player, even when its government '
        + 'would (a criminal record)', async () => {
            const { world, protector } = await scenario();
            const offenders = new Set<string>();
            for (let i = 0; i < STEPS; i++) {
                world.step();
                for (const [uuid, entity] of protectorFlock(world,
                    protector)) {
                    if (aimsAtPlayer(entity)) {
                        offenders.add(uuid);
                    }
                }
            }
            expect([...offenders]).toEqual([]);
            // Nothing to fight: it is not in an attack posture at all.
            expect(world.entities.get(protector)!.components
                .get(NpcComponent)!.mode).not.toBe('attack');
        });

    it('engages a ship that is attacking the player, even one its '
        + 'government has no quarrel with', async () => {
            const { world, protector } = await scenario({ record: 0 });
            await addAttacker(world);
            let engaged = false;
            let provoked = false;
            for (let i = 0; i < STEPS && !engaged; i++) {
                world.step();
                const ship = world.entities.get(protector)!;
                const npc = ship.components.get(NpcComponent)!;
                // A stray shot that lands on the protector makes the
                // attacker ITS aggressor, and any warship fights back
                // against that; the point here is engaging on the
                // player's behalf, so it must happen before that.
                provoked ||= npc.aggressor === ATTACKER;
                engaged = npc.mode === 'attack'
                    && ship.components.get(TargetComponent)!.target
                    === ATTACKER;
            }
            expect(engaged).toBeTrue();
            expect(provoked).withContext('engaged only once shot at itself')
                .toBeFalse();
        });

    it('protects a criminal player from their attacker instead of '
        + 'joining in', async () => {
            const { world, protector } = await scenario();
            await addAttacker(world);
            let engaged = false;
            let turned = false;
            for (let i = 0; i < STEPS; i++) {
                world.step();
                const ship = world.entities.get(protector)!;
                turned ||= aimsAtPlayer(ship);
                engaged ||= ship.components.get(NpcComponent)!.mode
                    === 'attack'
                    && ship.components.get(TargetComponent)!.target
                    === ATTACKER;
            }
            expect(turned).toBeFalse();
            expect(engaged).toBeTrue();
        });

    it('does not retaliate against the player it protects', async () => {
        // Friendly fire can only land on a flock member that is DISABLED
        // (firing_group.ts's carve-out), and a guided lock on one is
        // exempt from provocation; but however the player came to be
        // recorded as its aggressor, a protector does not turn on them.
        const { world, protector } = await scenario({ record: 0 });
        world.entities.get(protector)!.components.get(NpcComponent)!
            .aggressor = PLAYER;
        let turned = false;
        for (let i = 0; i < STEPS; i++) {
            world.step();
            turned ||= aimsAtPlayer(world.entities.get(protector)!);
        }
        expect(turned).toBeFalse();
    });

    // Reference Q3 (docs/reference_experiments.md, "Q2/Q3: whom does a
    // protect-the-player ship fight?"): on the original EV Nova, two raiders
    // of the escort's OWN government attacked the criminal player for 70 s
    // and the escort never engaged them — their shields read 100% at every
    // sample and its brackets stayed green. It protects the player, but not
    // against its own government's law.
    it('does not defend a criminal player against its OWN government\'s '
        + 'ships (reference Q3)', async () => {
            const { world, protector } = await scenario();
            await addAttacker(world, SYNTHETIC.govts.meridian);
            const { engagedUnprovoked, attackerAttacked } =
                await watchProtector(world, protector);
            expect(attackerAttacked).withContext(
                'the own-govt raider attacks the criminal player').toBeTrue();
            expect(engagedUnprovoked).toBeFalse();
            expect(aimsAtPlayer(world.entities.get(protector)!)).toBeFalse();
        });

    // NOT measured on the original (Q3 tested the own govt only). Chosen
    // reading: an ALLY of the protector's government — by the protector's
    // own view, govtDisposition 'ally', the same test its own target
    // selection uses — is treated like its own government. The Bible: allied
    // governments "communicate your actions", and a protector never counts
    // an ally as a hostile on any other path.
    it('does not defend the player against its government\'s ALLIES '
        + '(unmeasured; treated like its own government)', async () => {
            const { world, protector } = await scenario();
            // The Amber Compact names Meridian's class among its allies, so
            // a Compact protector regards a Meridian raider as an ally.
            world.entities.get(protector)!.components.set(GovtComponent,
                { id: SYNTHETIC.govts.compact });
            await addAttacker(world, SYNTHETIC.govts.meridian);
            const { engagedUnprovoked, attackerAttacked } =
                await watchProtector(world, protector);
            expect(attackerAttacked).toBeTrue();
            expect(engagedUnprovoked).toBeFalse();
        });

    it('still defends the player against a non-allied government\'s '
        + 'attacker (reference Q2a)', async () => {
            const { world, protector } = await scenario();
            await addAttacker(world, SYNTHETIC.govts.raiders);
            const { engagedUnprovoked } =
                await watchProtector(world, protector);
            expect(engagedUnprovoked).toBeTrue();
        });
});
