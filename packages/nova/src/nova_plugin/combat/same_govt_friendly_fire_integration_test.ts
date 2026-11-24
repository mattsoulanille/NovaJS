import 'jasmine';
import { UUID } from 'nova_ecs/arg_types';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { Entity } from 'nova_ecs/entity';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { MultiplayerData } from 'nova_ecs/plugins/multiplayer_plugin';
import { TimeResource } from 'nova_ecs/plugins/time_plugin';
import { System } from 'nova_ecs/system';
import { World } from 'nova_ecs/world';
import { SYNTHETIC } from 'novaparse/synthetic/universe';
import { getSyntheticGameData } from '../../communication/simulation_test_fixture.js';
import { GovtComponent } from '../core/index.js';
import { makeSystem } from '../make_system.js';
import { FormationComponent, NpcComponent } from '../npc/index.js';
import { ControlledByComponent } from '../player/index.js';
import {
    DamagedEvent, DisabledComponent, FiringGroupComponent, makeShip,
    SAME_GOVT_FIRING_IMMUNITY, TargetComponent,
} from '../ship/index.js';
import { completeEntity, loadWeaponsGameData } from '../spawn/index.js';
import { WeaponEntries } from './fire_weapon_plugin.js';
import { styleForTarget } from './hostility.js';

/**
 * ============================================================================
 * NPC friendly fire between ships of one government (or allies):
 * TODAY'S BEHAVIOUR, pinned while reference experiment A5 is open
 * ============================================================================
 *
 * Matthew (2026-11-23): "if one [NPC] accidentally hits an ally (via same
 * govt), it'll become hostile. Can we check if that's even possible (can
 * they hit allies) and whether they should become hostile?" Also reported
 * in play: same-govt NPCs fighting each other in Residio (an arpia plug-in
 * system whose traffic is all one government).
 *
 * This spec does NOT say what is right. It pins what NovaJS does TODAY so
 * a fix, whichever answer the original gives, has to flip these
 * expectations on purpose:
 *
 *  1. CAN THEY HIT? Yes. Friendly-fire immunity is per FIRING GROUP (one
 *     fleet, one carrier and its fighters; ship/firing_group.ts), not per
 *     government: the same-govt clause is wired but switched off
 *     (SAME_GOVT_FIRING_IMMUNITY), and nothing at all checks alliances. An
 *     unguided shot or a beam at the player connects with any other ship
 *     of the shooter's government (or an ally's) in the way. A GUIDED
 *     missile is the exception: it only hits its own target (proxHitAll).
 *  2. DO THEY TURN? Yes. NpcAggressionSystem (npc/npc_targeting.ts)
 *     records the firing ship as `npc.aggressor` on ANY damage from
 *     outside the victim's flock, with no government check, no damage
 *     threshold and no "was it aiming at me" test; NpcDecisionSystem
 *     (npc/npc_decision.ts) then adds the aggressor to a warship's
 *     engageable list at any range (nearest of {hostiles, aggressor}
 *     wins), and the memory never lapses on time: only the aggressor
 *     leaving the world, a bribe, a capture or the victim's death clear
 *     it. A DISABLED aggressor is dropped as a target but stays
 *     remembered, so one stray bolt ends with the shooter shot to a hulk
 *     by its own government's ship.
 *  3. Once the victim shoots back, its shots land on the shooter, which
 *     records it in turn: the two fight each other.
 *  4. It does not SPREAD by itself: the victim's own fleet escorts have no
 *     shared memory of the victim's aggressor and keep their own targets.
 *
 * Built on the synthetic data set: two Verge Raiders warships (xenophobic,
 * so both hunt the governmentless player on sight but never each other),
 * a Concord of Meridian shooter with an Amber Compact victim (the Compact
 * lists Meridian's class as an ally), Pulse Blaster / Lance Beam / Harrier
 * Missile fired through the real weapon entries.
 */

const CORSAIR = SYNTHETIC.ships.corsair;
const SKIFF = SYNTHETIC.ships.skiff;
const BLASTER = SYNTHETIC.weapons.blaster;
const BEAM = SYNTHETIC.weapons.beam;
const MISSILE = SYNTHETIC.weapons.missile;
const RAIDERS = SYNTHETIC.govts.raiders;
const MERIDIAN = SYNTHETIC.govts.meridian;
const COMPACT = SYNTHETIC.govts.compact;

type GameData = Awaited<ReturnType<typeof getSyntheticGameData>>;

describe('NPC friendly fire between same-govt / allied ships '
    + '(TODAY\'S BEHAVIOUR, reference A5 pending)', () => {
    let gameData: GameData;
    let world: World;
    let damaged: Array<{ uuid: string, damager: string }>;

    beforeEach(async () => {
        gameData = await getSyntheticGameData();
        // Thessaly Reach with npcs off: nothing in the world but the
        // ships each spec places.
        world = await makeSystem(SYNTHETIC.systems.thessaly, gameData,
            undefined, { npcs: false });
        damaged = [];
        world.addSystem(new System({
            name: 'DamageRecorder',
            events: [DamagedEvent],
            args: [DamagedEvent, UUID] as const,
            step({ damager }, uuid) {
                damaged.push({ uuid, damager });
            },
        }));
    });

    function pin(ship: Entity, x: number, y: number) {
        ship.components.set(MovementStateComponent, {
            position: new Position(x, y),
            velocity: new Vector(0, 0),
            rotation: new Angle(0), // Facing -y.
            accelerating: 0,
            turning: 0,
            turnBack: false,
        });
    }

    async function addShip(uuid: string, shipId: string, x: number, y: number,
        setup: (ship: Entity) => void = () => { }) {
        const ship = makeShip(await gameData.data.Ship.get(shipId));
        ship.components.set(MultiplayerData, { owner: 'server' });
        setup(ship);
        await completeEntity(world, ship);
        pin(ship, x, y);
        world.entities.set(uuid, ship);
        return ship;
    }

    /** A warship brain (AI 3, the type that hunts its aggressor), born
     * ASLEEP: it does not think (so it neither steers nor fires) until a
     * spec wakes it, so nothing but the spec's own shot is in the air. */
    function warship(govt: string) {
        return (ship: Entity) => {
            ship.components.set(NpcComponent,
                { aiType: 3, nextDecision: Number.MAX_SAFE_INTEGER });
            ship.components.set(GovtComponent, { id: govt });
        };
    }

    /** Lets a brain think from the next tick on. */
    function wake(ship: Entity) {
        npcOf(ship).nextDecision = 0;
    }

    function step(ticks: number) {
        for (let i = 0; i < ticks; i++) {
            world.step();
        }
    }

    async function fire(weaponId: string, from: string) {
        await loadWeaponsGameData(world, [weaponId]);
        const weapon = world.resources.get(WeaponEntries)!.getCached(weaponId);
        expect(weapon).withContext(`${weaponId} staged`).toBeDefined();
        const shot = weapon!.fireFromEntity(from, false);
        expect(shot).withContext(`${from} fired ${weaponId}`).toBeDefined();
        return shot!;
    }

    function hitsOn(uuid: string) {
        return damaged.filter(hit => hit.uuid === uuid);
    }

    function npcOf(ship: Entity) {
        return ship.components.get(NpcComponent)!;
    }

    function targetOf(ship: Entity) {
        return ship.components.get(TargetComponent)?.target;
    }

    /** Points a sleeping brain's guns at `target` for a hand-fired shot. */
    function aim(ship: Entity, target?: string) {
        ship.components.set(TargetComponent, { target });
    }

    /**
     * The scene: the player at the top, a shooter at the bottom facing it
     * (-y), and the victim on the line between them, nearer the shooter
     * (150 px) than the player (300 px). Two Corsairs and a player Skiff,
     * so every MaxOdds check comes out favorable and the brains act on
     * what they see.
     */
    async function scene(shooterGovt: string, victimGovt: string) {
        const player = await addShip('player', SKIFF, 1000, 550,
            ship => ship.components.set(ControlledByComponent,
                { peerId: 'peer' }));
        const shooter = await addShip('shooter', CORSAIR, 1000, 1000,
            warship(shooterGovt));
        const victim = await addShip('victim', CORSAIR, 1000, 850,
            warship(victimGovt));
        step(20); // Providers attach hulls, weapon state, the rest.
        return { player, shooter, victim };
    }

    function pinScene(ships: { player: Entity, shooter: Entity,
        victim: Entity }) {
        pin(ships.player, 1000, 550);
        pin(ships.shooter, 1000, 1000);
        pin(ships.victim, 1000, 850);
    }

    it('runs with same-govt firing immunity switched off', () => {
        // The one-line switch a "can't hit allies" answer would flip
        // (and extend to allies). Everything below assumes it is off.
        expect(SAME_GOVT_FIRING_IMMUNITY).toBeFalse();
    });

    it('both raiders hunt the player on sight, never each other', async () => {
        const { shooter, victim } = await scene(RAIDERS, RAIDERS);
        wake(shooter);
        wake(victim);
        step(10);
        expect(targetOf(shooter)).toBe('player');
        expect(targetOf(victim)).toBe('player');
        expect(npcOf(victim).aggressor).toBeUndefined();
        expect(npcOf(shooter).aggressor).toBeUndefined();
    });

    /** The shooter fires one blaster bolt at the player, through the
     * victim; returns once it has landed (the bolt covers 6 px a tick,
     * so the 150 px to the victim take about 20 ticks; the player, 450
     * px off, is beyond the bolt's reach anyway). */
    async function strayBolt(ships: { player: Entity, shooter: Entity,
        victim: Entity }) {
        aim(ships.shooter, 'player');
        pinScene(ships);
        damaged = [];
        await fire(BLASTER, 'shooter');
        step(40);
    }

    it('a blaster shot at the player hits the same-govt ship in the way, '
        + 'which takes the shooter as its aggressor', async () => {
        const ships = await scene(RAIDERS, RAIDERS);
        await strayBolt(ships);

        // (1) The shot connects: different firing groups, and the govt
        // clause is off.
        expect(hitsOn('victim').length)
            .withContext('the blaster bolt hits the raider in the way')
            .toBe(1);
        expect(hitsOn('player'))
            .withContext('the bolt ended in the victim').toEqual([]);
        // (2) The victim records its own government's ship as aggressor,
        // though the shooter's lock was on the player.
        expect(npcOf(ships.victim).aggressor).toBe('shooter');
    });

    it('the victim engages the shooter when it is the nearest of its '
        + 'enemies (the player 300 px ahead, the shooter 150 px behind)',
    async () => {
        const ships = await scene(RAIDERS, RAIDERS);
        const { victim } = ships;
        await strayBolt(ships);
        pinScene(ships);
        wake(victim);
        step(1);
        expect(targetOf(victim)).toBe('shooter');
        expect(npcOf(victim).mode).toBe('attack');
    });

    it('and engages it outright once the player has gone', async () => {
        const ships = await scene(RAIDERS, RAIDERS);
        const { victim } = ships;
        await strayBolt(ships);
        world.entities.delete('player');
        wake(victim);
        step(10);
        expect(targetOf(victim)).toBe('shooter');
        expect(npcOf(victim).mode).toBe('attack');
    });

    it('one stray bolt is enough: the victim fights a shooter that never '
        + 'fires again until it is DISABLED, and still remembers it 45 s on',
    async () => {
        const ships = await scene(RAIDERS, RAIDERS);
        const { shooter, victim } = ships;
        await strayBolt(ships);
        world.entities.delete('player');
        aim(shooter, undefined);
        wake(victim);
        // The shooter sleeps (no think, no fire) throughout, so nothing
        // provokes the victim again after the one bolt.
        let disabledAfter: number | undefined;
        for (let second = 1; second <= 45; second++) {
            step(60);
            if (disabledAfter === undefined
                && shooter.components.has(DisabledComponent)) {
                disabledAfter = second;
            }
        }
        expect(disabledAfter)
            .withContext('the victim shot its own govt\'s ship to a hulk')
            .toBeDefined();
        expect(hitsOn('shooter').length).toBeGreaterThan(10);
        // A warship drops a disabled target (npc_decision.ts), and the
        // raiders' disposition to their own is not 'enemy', so it does not
        // plunder it either: it goes back to patrolling...
        expect(targetOf(victim)).toBeUndefined();
        expect(npcOf(victim).mode).toBe('patrol');
        // ...but the memory itself never lapsed: past the player-side
        // AGGRESSION_WINDOW_MS (30 s), which NPC memory does not use, it
        // still names the shooter, ready to resume if it is repaired.
        expect(npcOf(victim).aggressor).toBe('shooter');
    });

    it('the shooter turns on the victim when its return fire lands: the '
        + 'two raiders fight each other', async () => {
        const ships = await scene(RAIDERS, RAIDERS);
        const { shooter, victim } = ships;
        await strayBolt(ships);
        world.entities.delete('player');
        wake(victim);
        wake(shooter);
        let mutual = false;
        for (let second = 0; second < 30 && !mutual; second++) {
            step(60);
            mutual = npcOf(shooter).aggressor === 'victim'
                && targetOf(shooter) === 'victim'
                && targetOf(victim) === 'shooter';
        }
        expect(npcOf(shooter).aggressor)
            .withContext('the victim\'s return fire lands on the shooter')
            .toBe('victim');
        expect(mutual)
            .withContext('each is targeting the other').toBeTrue();
    });

    it('an ALLIED victim (Compact, ally of Meridian) turns on a Meridian '
        + 'shooter just the same', async () => {
        const ships = await scene(MERIDIAN, COMPACT);
        const { victim } = ships;
        await strayBolt(ships);
        expect(hitsOn('victim').length).toBe(1);
        expect(npcOf(victim).aggressor).toBe('shooter');
        world.entities.delete('player');
        wake(victim);
        step(10);
        expect(targetOf(victim)).toBe('shooter');
        expect(npcOf(victim).mode).toBe('attack');
    });

    it('a beam swept through a same-govt ship does the same', async () => {
        const ships = await scene(RAIDERS, RAIDERS);
        aim(ships.shooter, 'player');
        pinScene(ships);
        damaged = [];
        await fire(BEAM, 'shooter');
        step(15);
        expect(hitsOn('victim').length)
            .withContext('the Lance Beam (220 px) reaches the victim')
            .toBeGreaterThan(0);
        expect(npcOf(ships.victim).aggressor).toBe('shooter');
    });

    it('a GUIDED missile at the player flies through the same-govt ship '
        + '(only its target is hittable)', async () => {
        const ships = await scene(RAIDERS, RAIDERS);
        aim(ships.shooter, 'player');
        pinScene(ships);
        damaged = [];
        await fire(MISSILE, 'shooter');
        // The 450 px flight, with the victim held on the missile's line.
        for (let i = 0; i < 240 && hitsOn('player').length === 0; i++) {
            pinScene(ships);
            step(1);
        }
        expect(hitsOn('victim')).toEqual([]);
        expect(hitsOn('player').length)
            .withContext('it reaches the player').toBeGreaterThan(0);
        expect(npcOf(ships.victim).aggressor).toBeUndefined();
    });

    it('it does not spread: the victim\'s fleet escort keeps its own target',
        async () => {
            const ships = await scene(RAIDERS, RAIDERS);
            const { victim } = ships;
            victim.components.set(FiringGroupComponent, { group: 'victim' });
            const escort = await addShip('escort', SKIFF, 1060, 880, ship => {
                warship(RAIDERS)(ship);
                ship.components.set(FormationComponent,
                    { leader: 'victim', slot: 0 });
                ship.components.set(FiringGroupComponent, { group: 'victim' });
            });
            step(20);
            pin(escort, 1060, 880);
            await strayBolt(ships);
            expect(npcOf(victim).aggressor).toBe('shooter');
            pinScene(ships);
            wake(victim);
            wake(escort);
            step(1);
            expect(targetOf(victim)).toBe('shooter');
            expect(npcOf(escort).aggressor).toBeUndefined();
            expect(targetOf(escort))
                .withContext('the escort is still after the player')
                .toBe('player');
        });

    /**
     * Matthew, from play (2026-11-23): "This npc became hostile to another
     * NPC in the system and that triggered my iff. Then, it killed the
     * other NPC and did not try to attack me." Its brackets were red while
     * it fought somebody else.
     *
     * No tier paints a ship red for being in 'attack' mode at someone else:
     * tier 3a (npc/allegiance.ts isAttackingPlayer) needs its TargetComponent
     * on the PLAYER. What does it is tier 3b, RECENT AGGRESSION: its stray
     * shots in that fight land on the player, AggressionDamageSystem
     * (aggression_plugin.ts) feeds them to the stray-damage accumulator
     * (deliberate: false, since it is not targeting the player), and at
     * AGGRESSION_DAMAGE_THRESHOLD (50 points within 30 s) the pair flips
     * hostile for AGGRESSION_WINDOW_MS. That record lives only on the
     * PLAYER's ship; the NPC's brain never hears of it (npc.aggressor is
     * about who hit the NPC), so it finishes its fight and leaves the
     * player alone while the brackets stay red.
     */
    describe('the player\'s IFF while an NPC fights another NPC '
        + '(TODAY\'S BEHAVIOUR)', () => {
        function style(ship: Entity) {
            const player = world.entities.get('player')!;
            return styleForTarget('shooter', ship, 'player', player,
                gameData, id => world.entities.get(id),
                world.resources.get(TimeResource)!.time);
        }

        it('stray hits past the threshold paint a neutral warship red, '
            + 'though it never targets the player', async () => {
            // A Concord warship (neutral to a clean, governmentless
            // player) at war with the Verge Raiders; the player strays
            // into the line of fire between it and its raider target.
            const player = await addShip('player', CORSAIR, 1000, 850,
                ship => ship.components.set(ControlledByComponent,
                    { peerId: 'peer' }));
            const shooter = await addShip('shooter', CORSAIR, 1000, 1000,
                warship(MERIDIAN));
            const raider = await addShip('raider', CORSAIR, 1000, 700,
                warship(RAIDERS));
            step(20);
            expect(player).toBeDefined();
            expect(raider).toBeDefined();
            aim(shooter, 'raider');
            expect(style(shooter)).withContext('before').toBe('neutral');

            // Pulse Blaster: 8 shield + 6 armor = 14 a bolt. Three
            // strays (42) are forgiven; the fourth (56) crosses 50.
            const verdicts: string[] = [];
            for (let bolt = 0; bolt < 4; bolt++) {
                pin(world.entities.get('player')!, 1000, 850);
                pin(shooter, 1000, 1000);
                damaged = [];
                await fire(BLASTER, 'shooter');
                step(40);
                expect(hitsOn('player').length)
                    .withContext(`bolt ${bolt} strays into the player`)
                    .toBe(1);
                verdicts.push(style(shooter));
            }
            expect(verdicts)
                .toEqual(['neutral', 'neutral', 'neutral', 'hostile']);
            expect(targetOf(shooter)).toBe('raider');

            // Its brain is unaware of the player: with the raider gone it
            // does not turn on the player (no aggressor, not an on-sight
            // enemy), yet the brackets stay red...
            world.entities.delete('raider');
            wake(shooter);
            step(60);
            expect(npcOf(shooter).aggressor).toBeUndefined();
            expect(targetOf(shooter)).not.toBe('player');
            expect(style(shooter)).toBe('hostile');
            // ...until the 30 s window lapses.
            step(30 * 60);
            expect(style(shooter)).toBe('neutral');
        });
    });
});
