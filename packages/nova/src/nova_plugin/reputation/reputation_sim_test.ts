import 'jasmine';
import { Entity } from 'nova_ecs/entity';
import { SYNTHETIC } from 'novaparse/synthetic/universe';
import { getSyntheticGameData } from '../../communication/simulation_test_fixture.js';
import { completeEntity } from '../spawn/index.js';
import { DamagedEvent } from '../ship/index.js';
import { DisabledComponent } from '../ship/index.js';
import { FiringGroupComponent } from '../ship/index.js';
import { GovtComponent } from '../core/index.js';
import { makeShip } from '../ship/index.js';
import { makeSystem } from '../make_system.js';
import { NpcComponent } from '../npc/index.js';
import { CombatRatingComponent, DamageAttributionComponent, LegalRecordsComponent } from './reputation_plugin.js';
import { TargetComponent } from '../ship/index.js';
import { ArmorComponent, ShieldComponent } from '../ship/index.js';
import { ActiveRanksComponent, AggressionSuppressGovtsComponent } from '../ncb/index.js';
import { hashWorld } from 'nova_ecs/plugins/world_hash';
import { restoreWorld, snapshotWorld } from 'nova_ecs/plugins/snapshot_plugin';
import { deriveEntityComponents } from '../core/index.js';

/**
 * The victim throughout is a Concord of Meridian ship, so the penalties
 * charged are Meridian's OWN gövt fields, not the DEFAULT_* engine
 * fallbacks: KillPenalty 20, DisabPenalty 5.
 */
const MERIDIAN = SYNTHETIC.govts.meridian;
/** The Verge Raiders' enemies list names Meridian's class. */
const ENEMY = SYNTHETIC.govts.raiders;
const MERIDIAN_KILL_PENALTY = 20;
const MERIDIAN_DISABLE_PENALTY = 5;
/**
 * Records are per SYSTEM (ruling #380). The world is Thessaly Reach
 * (Meridian), linked to Kestrel Drift (the Verge Raiders, Meridian's
 * enemy: Disab 5, Kill 15) and Ossory Shoal (independent: its InitialRec
 * is gövt 128's, which in this scenario IS Meridian); Vael Hollow (Meridian) is two
 * jumps out, through Kestrel.
 */
const THESSALY = SYNTHETIC.systems.thessaly;
const KESTREL = SYNTHETIC.systems.kestrel;
const OSSORY = SYNTHETIC.systems.ossory;
const VAEL = SYNTHETIC.systems.vael;

/**
 * The reputation pipeline in a LIVE world (parsed game data, the full
 * simulation stack): a shot attributed to a player zeroes a Meridian
 * ship's armor -> the player's Meridian record drops by the kill penalty
 * and their combat rating grows by a fifth of the victim's strength; and a Meridian
 * warship's NPC brain treats a player with a criminal Meridian record as
 * an enemy.
 */
describe('reputation in a live world', () => {
    const PLAYER = 'player ship';
    const VICTIM = 'victim ship';
    const SHOT = 'weapon shot';

    async function makeWorld() {
        const gameData = await getSyntheticGameData();
        // Thessaly Reach: Asteroids 0; NPCs off for control.
        const world = await makeSystem(SYNTHETIC.systems.thessaly, gameData,
            'worker', { npcs: false });
        return { gameData, world };
    }

    async function addPlayer(world: Awaited<ReturnType<typeof makeWorld>>['world'],
        gameData: Awaited<ReturnType<typeof makeWorld>>['gameData']) {
        const player = makeShip(
            await gameData.data.Ship.get(SYNTHETIC.ships.skiff));
        player.components.set(LegalRecordsComponent, new Map());
        player.components.set(CombatRatingComponent, { kills: 0 });
        await completeEntity(world, player);
        world.entities.set(PLAYER, player);
        return player;
    }

    it('credits a kill: record drop of Disab + Kill (Meridian only) and '
        + 'rating', async () => {
        const { gameData, world } = await makeWorld();
        const player = await addPlayer(world, gameData);

        // A Meridian skiff as the victim (strength 8).
        const victimData = await gameData.data.Ship.get(SYNTHETIC.ships.skiff);
        const victim = makeShip(victimData);
        victim.components.set(GovtComponent, { id: MERIDIAN });
        await completeEntity(world, victim);
        world.entities.set(VICTIM, victim);

        // The killing shot: a weapon entity whose firing group root is
        // the player (what fireFromEntity stamps).
        const shot = new Entity(SHOT);
        shot.components.set(FiringGroupComponent, { group: PLAYER });
        world.entities.set(SHOT, shot);
        world.step();

        // One massive hit: shields collapse and armor reaches zero.
        victim.components.get(ShieldComponent)!.current = 0;
        world.emit(DamagedEvent, {
            damage: {
                shield: 0, armor: 1e9, ionization: 0, ionizationColor: 0,
                knockback: 0, passThroughShield: 1,
            },
            damager: SHOT,
        }, [VICTIM]);
        world.step();

        expect(victim.components.get(ArmorComponent)!.current).toBe(0);
        // Attribution recorded and credited exactly once.
        expect(victim.components.get(DamageAttributionComponent))
            .toEqual({ root: PLAYER, killCredited: true, disabledAtHit: false });
        const records = player.components.get(LegalRecordsComponent)!;
        // A one-hit kill costs the Disab too (reference "A14 with system
        // traffic as the victims, wave 12": -(30 + 100) for one hit).
        const killCost = MERIDIAN_DISABLE_PENALTY + MERIDIAN_KILL_PENALTY;
        expect(records.get(THESSALY)).toBe(-killCost);
        // The spread (reference "A14 spread, wave 14"), each system by its
        // own owner's view of a Meridian victim, 0.65 per jump:
        //  - Kestrel, the Raiders' (one jump): not their ship, so half
        //    their own scaled fields, floor(3 / 2) + floor(9 / 2) = +5,
        //    over the Raiders' InitialRec of -10 (the absent entry): -5;
        //  - Ossory, independent (one jump): minus a quarter of the
        //    victim's scaled fields, -(floor(3/4) + floor(13/4)) = -3
        //    (reference "A14 / contraband wave 16");
        //  - Vael, Meridian's (two jumps): -(floor(2.1) + floor(8.4)) = -10.
        expect(Object.fromEntries(records)).toEqual({
            [THESSALY]: -killCost, [KESTREL]: -10 + 5, [OSSORY]: -3,
            [VAEL]: -10,
        });
        // A fifth of the skiff's Strength 8, rounded down (reference
        // "... (R6), wave 37": the combat rating adds Strength / 5).
        expect(victimData.strength).toBe(8);
        expect(player.components.get(CombatRatingComponent)!.kills)
            .toBe(1);

        // Repeat hits on the exploding hulk do not double-credit.
        world.emit(DamagedEvent, {
            damage: {
                shield: 0, armor: 1e9, ionization: 0, ionizationColor: 0,
                knockback: 0, passThroughShield: 1,
            },
            damager: SHOT,
        }, [VICTIM]);
        world.step();
        expect(records.get(THESSALY)).toBe(-killCost);
    });

    /**
     * ränk "Verge Cover" (AffilGovt the Verge Raiders, Flags 0x144): the
     * cover grants — 0x0100 their ships won't attack you, 0x0004 / 0x0040
     * blown the moment you turn on them. Until #56 the sim never revoked
     * it, so an infiltrator could destroy raider ships forever with the
     * Verge never fighting back.
     */
    it('revokes a 0x0004/0x0040 cover rank when its holder kills a ship '
        + 'of the affiliated govt, and un-bakes its 0x0100 (#56)',
        async () => {
            const { gameData, world } = await makeWorld();
            const player = await addPlayer(world, gameData);
            player.components.set(ActiveRanksComponent,
                new Set([SYNTHETIC.ranks.cover, SYNTHETIC.ranks.warrant]));
            player.components.set(AggressionSuppressGovtsComponent,
                new Set([ENEMY]));

            const victimData = await gameData.data.Ship.get(SYNTHETIC.ships.skiff);
            const victim = makeShip(victimData);
            victim.components.set(GovtComponent, { id: ENEMY });
            await completeEntity(world, victim);
            world.entities.set(VICTIM, victim);
            const shot = new Entity(SHOT);
            shot.components.set(FiringGroupComponent, { group: PLAYER });
            world.entities.set(SHOT, shot);
            world.step();

            victim.components.get(ShieldComponent)!.current = 0;
            world.emit(DamagedEvent, {
                damage: {
                    shield: 0, armor: 1e9, ionization: 0, ionizationColor: 0,
                    knockback: 0, passThroughShield: 1,
                },
                damager: SHOT,
            }, [VICTIM]);
            world.step();

            // The record: a Raider killed in Meridian space is the Good
            // Citizen reward there (half Meridian's 5 / 20: +12), and a
            // crime in the Raiders' own Kestrel next door (-(3 + 9), over
            // their InitialRec of -10)...
            const records = player.components.get(LegalRecordsComponent)!;
            expect(records.get(THESSALY)).toBe(2 + 10);
            expect(records.get(KESTREL)).toBe(-10 - 12);
            // ...the cover is gone, the Meridian warrant (permanent,
            // another govt) untouched...
            expect(player.components.get(ActiveRanksComponent))
                .toEqual(new Set([SYNTHETIC.ranks.warrant]));
            // ...and the Verge's ships may attack again.
            expect(player.components.get(AggressionSuppressGovtsComponent))
                .toEqual(new Set());
        });

    it('credits a disable: the disable penalty, once',
        async () => {
            const { gameData, world } = await makeWorld();
            const player = await addPlayer(world, gameData);

            const victimData = await gameData.data.Ship.get(SYNTHETIC.ships.skiff);
            const victim = makeShip(victimData);
            victim.components.set(GovtComponent, { id: MERIDIAN });
            await completeEntity(world, victim);
            world.entities.set(VICTIM, victim);
            const shot = new Entity(SHOT);
            shot.components.set(FiringGroupComponent, { group: PLAYER });
            world.entities.set(SHOT, shot);
            world.step();

            // Damage to 30% armor: below the 33% disable threshold but
            // alive.
            const armor = victim.components.get(ArmorComponent)!;
            victim.components.get(ShieldComponent)!.current = 0;
            world.emit(DamagedEvent, {
                damage: {
                    shield: 0, armor: armor.max * 0.7, ionization: 0,
                    ionizationColor: 0, knockback: 0, passThroughShield: 1,
                },
                damager: SHOT,
            }, [VICTIM]);
            for (let i = 0; i < 3; i++) {
                world.step();
            }
            expect(victim.components.has(DisabledComponent)).toBeTrue();
            const records = player.components.get(LegalRecordsComponent)!;
            expect(records.get(THESSALY)).toBe(-MERIDIAN_DISABLE_PENALTY);
            // Steps while it stays disabled do not re-charge.
            world.step();
            expect(records.get(THESSALY)).toBe(-MERIDIAN_DISABLE_PENALTY);
        });

    it('a kill after the same player\'s disable charges the Disab once, '
        + 'not twice (reference A14 wave 12: -130, not -160)', async () => {
            const { gameData, world } = await makeWorld();
            const player = await addPlayer(world, gameData);

            const victimData = await gameData.data.Ship.get(SYNTHETIC.ships.skiff);
            const victim = makeShip(victimData);
            victim.components.set(GovtComponent, { id: MERIDIAN });
            await completeEntity(world, victim);
            world.entities.set(VICTIM, victim);
            const shot = new Entity(SHOT);
            shot.components.set(FiringGroupComponent, { group: PLAYER });
            world.entities.set(SHOT, shot);
            world.step();

            const hit = (armorDamage: number) => world.emit(DamagedEvent, {
                damage: {
                    shield: 0, armor: armorDamage, ionization: 0,
                    ionizationColor: 0, knockback: 0, passThroughShield: 1,
                },
                damager: SHOT,
            }, [VICTIM]);
            const armor = victim.components.get(ArmorComponent)!;
            victim.components.get(ShieldComponent)!.current = 0;
            hit(armor.max * 0.7);
            for (let i = 0; i < 3; i++) {
                world.step();
            }
            expect(victim.components.has(DisabledComponent)).toBeTrue();
            const records = player.components.get(LegalRecordsComponent)!;
            expect(records.get(THESSALY)).toBe(-MERIDIAN_DISABLE_PENALTY);

            // Then finished off.
            hit(1e9);
            world.step();
            expect(armor.current).toBe(0);
            expect(records.get(THESSALY)).toBe(
                -(MERIDIAN_DISABLE_PENALTY + MERIDIAN_KILL_PENALTY));
        });

    it('a kill of a ship somebody else disabled charges the killer Disab + '
        + 'Kill', async () => {
            const { gameData, world } = await makeWorld();
            const player = await addPlayer(world, gameData);

            const victimData = await gameData.data.Ship.get(SYNTHETIC.ships.skiff);
            const victim = makeShip(victimData);
            victim.components.set(GovtComponent, { id: MERIDIAN });
            await completeEntity(world, victim);
            world.entities.set(VICTIM, victim);
            const shot = new Entity(SHOT);
            shot.components.set(FiringGroupComponent, { group: PLAYER });
            world.entities.set(SHOT, shot);
            world.step();

            // Disabled by an unattributed cause (no records charged).
            const armor = victim.components.get(ArmorComponent)!;
            victim.components.get(ShieldComponent)!.current = 0;
            armor.current = 0.3 * armor.max;
            world.step();
            world.step();
            expect(victim.components.has(DisabledComponent)).toBeTrue();

            world.emit(DamagedEvent, {
                damage: {
                    shield: 0, armor: 1e9, ionization: 0,
                    ionizationColor: 0, knockback: 0, passThroughShield: 1,
                },
                damager: SHOT,
            }, [VICTIM]);
            world.step();
            expect(player.components.get(LegalRecordsComponent)!
                .get(THESSALY)).toBe(
                    -(MERIDIAN_DISABLE_PENALTY + MERIDIAN_KILL_PENALTY));
        });

    it('does not credit a disable for a hit on a ship that was already ' +
        'a hulk', async () => {
            const { gameData, world } = await makeWorld();
            const player = await addPlayer(world, gameData);

            const victimData = await gameData.data.Ship.get(SYNTHETIC.ships.skiff);
            const victim = makeShip(victimData);
            victim.components.set(GovtComponent, { id: MERIDIAN });
            await completeEntity(world, victim);
            world.entities.set(VICTIM, victim);
            const shot = new Entity(SHOT);
            shot.components.set(FiringGroupComponent, { group: PLAYER });
            world.entities.set(SHOT, shot);
            world.step();

            // Disabled by nobody the player can be blamed for: an
            // unattributed cause takes it below the threshold (the same
            // state a spawn-disabled derelict or a mïsn rescue hulk is
            // in when the player first finds it).
            const armor = victim.components.get(ArmorComponent)!;
            victim.components.get(ShieldComponent)!.current = 0;
            armor.current = 0.3 * armor.max;
            world.step();
            world.step();
            expect(victim.components.has(DisabledComponent)).toBeTrue();
            const records = player.components.get(LegalRecordsComponent)!;
            expect(records.get(THESSALY)).toBeUndefined();

            // A stray player shot at the hulk: it did not disable it.
            world.emit(DamagedEvent, {
                damage: {
                    shield: 0, armor: 1, ionization: 0,
                    ionizationColor: 0, knockback: 0, passThroughShield: 1,
                },
                damager: SHOT,
            }, [VICTIM]);
            for (let i = 0; i < 3; i++) {
                world.step();
            }
            expect(victim.components.get(DamageAttributionComponent)!.root)
                .toBe(PLAYER);
            expect(records.get(THESSALY)).toBeUndefined();

            // Repaired and then genuinely disabled by the player: charged.
            armor.current = armor.max;
            world.step();
            expect(victim.components.has(DisabledComponent)).toBeFalse();
            world.emit(DamagedEvent, {
                damage: {
                    shield: 0, armor: armor.max * 0.7, ionization: 0,
                    ionizationColor: 0, knockback: 0, passThroughShield: 1,
                },
                damager: SHOT,
            }, [VICTIM]);
            for (let i = 0; i < 3; i++) {
                world.step();
            }
            expect(victim.components.has(DisabledComponent)).toBeTrue();
            expect(records.get(THESSALY)).toBe(-MERIDIAN_DISABLE_PENALTY);
        });

    it('a Meridian warship hunts a player with a criminal Meridian record',
        async () => {
            const { gameData, world } = await makeWorld();
            const player = await addPlayer(world, gameData);
            // Deep in criminal territory (Meridian's CrimeTol is 20).
            player.components.set(LegalRecordsComponent,
                new Map([[THESSALY, -100]]));

            // A Meridian warship with the NPC warship brain.
            const warship = makeShip(
                await gameData.data.Ship.get(SYNTHETIC.ships.warden));
            warship.components.set(GovtComponent, { id: MERIDIAN });
            warship.components.set(NpcComponent, { aiType: 3 });
            warship.components.set(TargetComponent, { target: undefined });
            await completeEntity(world, warship);
            world.entities.set('meridian warship', warship);

            // Let the decision system think.
            for (let i = 0; i < 5; i++) {
                world.step();
            }
            expect(warship.components.get(NpcComponent)!.mode)
                .toBe('attack');
            expect(warship.components.get(TargetComponent)!.target)
                .toBe(PLAYER);
        });

    it('a criminal record in ANOTHER Meridian system does not make him a '
        + 'criminal here (c2: per-system records)', async () => {
            const { gameData, world } = await makeWorld();
            const player = await addPlayer(world, gameData);
            player.components.set(LegalRecordsComponent,
                new Map([[VAEL, -100]]));
            const warship = makeShip(
                await gameData.data.Ship.get(SYNTHETIC.ships.warden));
            warship.components.set(GovtComponent, { id: MERIDIAN });
            warship.components.set(NpcComponent, { aiType: 3 });
            warship.components.set(TargetComponent, { target: undefined });
            await completeEntity(world, warship);
            world.entities.set('meridian warship', warship);
            for (let i = 0; i < 5; i++) {
                world.step();
            }
            expect(warship.components.get(NpcComponent)!.mode)
                .not.toBe('attack');
        });

    it('replays a spreading kill identically after a rollback', async () => {
        const { gameData, world } = await makeWorld();
        const player = await addPlayer(world, gameData);
        const victim = makeShip(
            await gameData.data.Ship.get(SYNTHETIC.ships.skiff));
        victim.components.set(GovtComponent, { id: MERIDIAN });
        await completeEntity(world, victim);
        world.entities.set(VICTIM, victim);
        const shot = new Entity(SHOT);
        shot.components.set(FiringGroupComponent, { group: PLAYER });
        world.entities.set(SHOT, shot);
        world.step();
        const before = snapshotWorld(world);
        const run = () => {
            const victimNow = world.entities.get(VICTIM)!;
            victimNow.components.get(ShieldComponent)!.current = 0;
            world.emit(DamagedEvent, {
                damage: {
                    shield: 0, armor: 1e9, ionization: 0, ionizationColor: 0,
                    knockback: 0, passThroughShield: 1,
                },
                damager: SHOT,
            }, [VICTIM]);
            const hashes: string[] = [];
            for (let i = 0; i < 30; i++) {
                world.step();
                hashes.push(hashWorld(world).hash);
            }
            return {
                hashes,
                records: [...world.entities.get(PLAYER)!.components
                    .get(LegalRecordsComponent)!],
            };
        };
        const first = run();
        expect(first.records.length).toBe(4);
        restoreWorld(world, before, deriveEntityComponents);
        expect(world.entities.get(PLAYER)!.components
            .get(LegalRecordsComponent)!.size).toBe(0);
        expect(run()).toEqual(first);
        void player;
    });

    it('a Meridian warship ignores a player with a clean record',
        async () => {
            const { gameData, world } = await makeWorld();
            await addPlayer(world, gameData);

            const warship = makeShip(
                await gameData.data.Ship.get(SYNTHETIC.ships.warden));
            warship.components.set(GovtComponent, { id: MERIDIAN });
            warship.components.set(NpcComponent, { aiType: 3 });
            warship.components.set(TargetComponent, { target: undefined });
            await completeEntity(world, warship);
            world.entities.set('meridian warship', warship);

            for (let i = 0; i < 5; i++) {
                world.step();
            }
            expect(warship.components.get(NpcComponent)!.mode)
                .not.toBe('attack');
        });
});
