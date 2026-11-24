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
import { GovtComponent, SystemIdResource } from '../core/index.js';
import { makeSystem } from '../make_system.js';
import {
    AggressionComponent, FormationComponent, NpcComponent,
} from '../npc/index.js';
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
 *  2. DO THEY TURN? No, not over a STRAY: reference "NPC friendly fire
 *     wave 10" (docs/reference_experiments.md) saw a ship of the
 *     shooter's own, an allied or a neutral government take bolts, a beam
 *     or a blast aimed at the player for about 45 s and never fire back.
 *     NpcAggressionSystem (npc/npc_targeting.ts) records an aggressor
 *     only for a hit AIMED at the victim (the shot, its firer or the
 *     firer's flock root targets it), a hit from a player's side, or a
 *     hit from a government the victim's counts as an enemy. Before that,
 *     any hit from outside the flock was recorded, and one stray bolt
 *     ended with the shooter shot to a hulk by its own government's ship.
 *  3. So the two do not fight each other over it.
 *  4. A DELIBERATE hit is still an attack, whatever the government, and it
 *     does not SPREAD by itself: the victim's own fleet escorts have no
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
        + 'which does not take the shooter as its aggressor', async () => {
        const ships = await scene(RAIDERS, RAIDERS);
        await strayBolt(ships);

        // (1) The shot connects: different firing groups, and the govt
        // clause is off.
        expect(hitsOn('victim').length)
            .withContext('the blaster bolt hits the raider in the way')
            .toBe(1);
        expect(hitsOn('player'))
            .withContext('the bolt ended in the victim').toEqual([]);
        // (2) A stray: the shooter's lock was on the player, so the victim
        // records nothing (reference wave 10: no retaliation).
        expect(npcOf(ships.victim).aggressor).toBeUndefined();
    });

    it('the victim keeps after the player, not the shooter 150 px behind '
        + 'it', async () => {
        const ships = await scene(RAIDERS, RAIDERS);
        const { victim } = ships;
        await strayBolt(ships);
        pinScene(ships);
        wake(victim);
        step(1);
        expect(targetOf(victim)).toBe('player');
        expect(npcOf(victim).mode).toBe('attack');
    });

    it('and does not engage it once the player has gone', async () => {
        const ships = await scene(RAIDERS, RAIDERS);
        const { victim } = ships;
        await strayBolt(ships);
        world.entities.delete('player');
        wake(victim);
        step(10);
        expect(targetOf(victim)).not.toBe('shooter');
        expect(npcOf(victim).mode).not.toBe('attack');
    });

    it('one stray bolt provokes nothing: 45 s on, the victim has not fired '
        + 'at the shooter and does not remember it', async () => {
        // Before reference wave 10 this was "one stray bolt is enough": the
        // victim shot its own government's ship to a hulk.
        const ships = await scene(RAIDERS, RAIDERS);
        const { shooter, victim } = ships;
        await strayBolt(ships);
        world.entities.delete('player');
        aim(shooter, undefined);
        wake(victim);
        for (let second = 1; second <= 45; second++) {
            step(60);
        }
        expect(shooter.components.has(DisabledComponent)).toBeFalse();
        expect(hitsOn('shooter')).toEqual([]);
        expect(targetOf(victim)).not.toBe('shooter');
        expect(npcOf(victim).aggressor).toBeUndefined();
    });

    it('the two raiders do not fight each other over it', async () => {
        const ships = await scene(RAIDERS, RAIDERS);
        const { shooter, victim } = ships;
        await strayBolt(ships);
        world.entities.delete('player');
        wake(victim);
        wake(shooter);
        for (let second = 0; second < 30; second++) {
            step(60);
            expect(targetOf(shooter)).not.toBe('victim');
            expect(targetOf(victim)).not.toBe('shooter');
        }
        expect(npcOf(shooter).aggressor).toBeUndefined();
        expect(npcOf(victim).aggressor).toBeUndefined();
    });

    it('an ALLIED victim (Compact, ally of Meridian) ignores a Meridian '
        + 'shooter\'s stray just the same', async () => {
        const ships = await scene(MERIDIAN, COMPACT);
        const { victim } = ships;
        await strayBolt(ships);
        expect(hitsOn('victim').length).toBe(1);
        expect(npcOf(victim).aggressor).toBeUndefined();
        world.entities.delete('player');
        wake(victim);
        step(10);
        expect(targetOf(victim)).not.toBe('shooter');
        expect(npcOf(victim).mode).not.toBe('attack');
    });

    it('an ENEMY government\'s stray still counts: a raider hit by a '
        + 'Meridian bolt meant for the player takes the shooter', async () => {
        // Not measured on the original (no reference run had a hostile
        // bystander): a ship at war with the shooter treats its fire as
        // an enemy's, aimed or not (npc_targeting.ts).
        const ships = await scene(MERIDIAN, RAIDERS);
        await strayBolt(ships);
        expect(hitsOn('victim').length).toBe(1);
        expect(npcOf(ships.victim).aggressor).toBe('shooter');
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
        expect(npcOf(ships.victim).aggressor).toBeUndefined();
    });

    it('a beam AIMED at a same-govt ship is an attack: it takes the '
        + 'shooter as its aggressor', async () => {
        const ships = await scene(RAIDERS, RAIDERS);
        aim(ships.shooter, 'victim');
        pinScene(ships);
        damaged = [];
        await fire(BEAM, 'shooter');
        step(15);
        expect(hitsOn('victim').length).toBeGreaterThan(0);
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

    it('a deliberate hit does not spread: the victim\'s fleet escort keeps '
        + 'its own target', async () => {
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
            // A beam aimed at the victim: deliberate, so the victim takes
            // the shooter (a stray would provoke nothing at all).
            aim(ships.shooter, 'victim');
            pinScene(ships);
            await fire(BEAM, 'shooter');
            step(15);
            pin(escort, 1060, 880);
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
     * The cause was tier 3b, RECENT AGGRESSION: its stray shots in that
     * fight landed on the player, AggressionDamageSystem
     * (aggression_plugin.ts) fed them to the stray-damage accumulator
     * (deliberate: false, since it was not targeting the player), and at
     * AGGRESSION_DAMAGE_THRESHOLD the pair flipped hostile for
     * AGGRESSION_WINDOW_MS: a record that lives only on the PLAYER's ship
     * and that the NPC's brain never hears of.
     *
     * The fix, per Matthew's K9 ruling ("IFF bracket colors correspond to
     * hostility regardless of govt's stance": red means hostile TO THE
     * PLAYER): the stray-damage trigger (c) counts only against player-side
     * shooters, the case it was written for. An NPC is red when it really
     * is: targeting the player in 'attack' mode, its politics, or a
     * DELIBERATE hit (one landed while it targets the player).
     */
    describe('the player\'s IFF while an NPC fights another NPC', () => {
        function style(ship: Entity) {
            const player = world.entities.get('player')!;
            return styleForTarget('shooter', ship, 'player', player,
                gameData, id => world.entities.get(id),
                world.resources.get(TimeResource)!.time,
                world.resources.get(SystemIdResource));
        }

        function aggressionOn(uuid: string) {
            return world.entities.get('player')!.components
                .get(AggressionComponent)?.get(uuid);
        }

        /** The player in the middle, the shooter below it facing it (-y),
         * and a raider beyond the player: a bolt the shooter fires at the
         * raider meets the player first. */
        async function crossfire(shooterSetup: (ship: Entity) => void) {
            const player = await addShip('player', CORSAIR, 1000, 850,
                ship => ship.components.set(ControlledByComponent,
                    { peerId: 'peer' }));
            const shooter = await addShip('shooter', CORSAIR, 1000, 1000,
                shooterSetup);
            const raider = await addShip('raider', CORSAIR, 1000, 700,
                warship(RAIDERS));
            step(20);
            expect(player).toBeDefined();
            expect(raider).toBeDefined();
            return shooter;
        }

        /** Fires `count` blaster bolts from the shooter, each of which must
         * land on the player; returns the shooter's style after each. */
        async function bolts(shooter: Entity, count: number) {
            const verdicts: string[] = [];
            for (let bolt = 0; bolt < count; bolt++) {
                pin(world.entities.get('player')!, 1000, 850);
                pin(shooter, 1000, 1000);
                damaged = [];
                await fire(BLASTER, 'shooter');
                step(40);
                expect(hitsOn('player').length)
                    .withContext(`bolt ${bolt} lands on the player`)
                    .toBe(1);
                verdicts.push(style(shooter));
            }
            return verdicts;
        }

        it('an NPC whose strays hit the player while it fights another NPC '
            + 'stays neutral', async () => {
            // A Concord warship (neutral to a clean, governmentless
            // player) at war with the Verge Raiders; the player strays
            // into the line of fire between it and its raider target.
            const shooter = await crossfire(warship(MERIDIAN));
            aim(shooter, 'raider');
            expect(style(shooter)).withContext('before').toBe('neutral');

            // Pulse Blaster: 8 shield + 6 armor = 14 a bolt. Six strays
            // (84) are well past AGGRESSION_DAMAGE_THRESHOLD (50), which
            // used to flip it red at the fourth.
            expect(await bolts(shooter, 6)).toEqual(['neutral', 'neutral',
                'neutral', 'neutral', 'neutral', 'neutral']);
            expect(targetOf(shooter)).toBe('raider');
            // Nothing recorded at all: no state riding in snapshots for it.
            expect(aggressionOn('shooter')).toBeUndefined();

            // And its brain agrees: with the raider gone it does not turn
            // on the player.
            world.entities.delete('raider');
            wake(shooter);
            step(60);
            expect(npcOf(shooter).aggressor).toBeUndefined();
            expect(targetOf(shooter)).not.toBe('player');
            expect(style(shooter)).toBe('neutral');
        });

        it('another PLAYER whose strays pass the threshold still turns red',
            async () => {
                // Trigger (c) as Matthew wrote it ("enough damage to us
                // while not targeting us"), for other players' ships.
                const shooter = await crossfire(ship => ship.components
                    .set(ControlledByComponent, { peerId: 'peer b' }));
                aim(shooter, 'raider');
                expect(style(shooter)).withContext('before')
                    .toBe('neutral');
                // 14 a bolt: three (42) are forgiven, the fourth (56)
                // crosses 50.
                expect(await bolts(shooter, 4))
                    .toEqual(['neutral', 'neutral', 'neutral', 'hostile']);
                expect(aggressionOn('shooter')?.hostile).toBeTrue();
                // ...until the 30 s window lapses.
                step(30 * 60);
                expect(style(shooter)).toBe('neutral');
            });

        it('another player\'s ESCORT whose strays pass the threshold turns '
            + 'red', async () => {
            // In formation on its player but with no shared firing group,
            // so its shots root at the escort itself: the flock walk is
            // what makes it player-side.
            await addShip('other player', CORSAIR, 3000, 3000,
                ship => ship.components.set(ControlledByComponent,
                    { peerId: 'peer b' }));
            const shooter = await crossfire(ship => {
                warship(MERIDIAN)(ship);
                ship.components.set(FormationComponent,
                    { leader: 'other player', slot: 0 });
            });
            aim(shooter, 'raider');
            expect(await bolts(shooter, 4))
                .toEqual(['neutral', 'neutral', 'neutral', 'hostile']);
        });

        it('an NPC that deliberately attacks the player is red at once',
            async () => {
                // Targeting the player but asleep, so not in 'attack'
                // mode: tier 3a is silent and only the hit itself (a
                // damaging hit while targeting us, trigger (b)) can
                // paint it.
                const shooter = await crossfire(warship(MERIDIAN));
                aim(shooter, 'player');
                expect(npcOf(shooter).mode).not.toBe('attack');
                expect(style(shooter)).withContext('before')
                    .toBe('neutral');
                expect(await bolts(shooter, 1)).toEqual(['hostile']);
                expect(aggressionOn('shooter')?.hostile).toBeTrue();
            });
    });
});
