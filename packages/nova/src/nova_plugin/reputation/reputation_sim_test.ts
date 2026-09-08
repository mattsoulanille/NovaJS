import 'jasmine';
import { Entity } from 'nova_ecs/entity';
import { SYNTHETIC } from 'novaparse/synthetic/universe';
import { getSyntheticGameData } from '../../communication/simulation_test_fixture.js';
import { completeEntity } from '../spawn/entity_data_loader.js';
import { DamagedEvent } from '../ship/death_plugin.js';
import { DisabledComponent } from '../ship/disabled_component.js';
import { FiringGroupComponent } from '../ship/firing_group.js';
import { GovtComponent } from '../core/govt_component.js';
import { makeShip } from '../ship/make_ship.js';
import { makeSystem } from '../make_system.js';
import { NpcComponent } from '../npc/npc_ai_plugin.js';
import { CombatRatingComponent, DamageAttributionComponent, LegalRecordsComponent } from './reputation_plugin.js';
import { TargetComponent } from '../ship/target_component.js';
import { ArmorComponent, ShieldComponent } from '../ship/health_plugin.js';
import { ActiveRanksComponent, AggressionSuppressGovtsComponent } from '../ncb/ncb_plugin.js';

/**
 * The victim throughout is a Concord of Meridian ship, so the penalties
 * charged are Meridian's OWN gövt fields, not the DEFAULT_* engine
 * fallbacks: KillPenalty 20, DisabPenalty 5.
 */
const MERIDIAN = SYNTHETIC.govts.meridian;
/** Meridian's allies list names its class (1), so it takes half. */
const ALLY = SYNTHETIC.govts.compact;
/** The Verge Raiders' enemies list names Meridian's class: they credit half. */
const ENEMY = SYNTHETIC.govts.raiders;
/** The Raiders' gövt InitialRec: every record with them starts here. */
const RAIDER_INITIAL_RECORD = -10;
const MERIDIAN_KILL_PENALTY = 20;
const MERIDIAN_DISABLE_PENALTY = 5;

/**
 * The reputation pipeline in a LIVE world (parsed game data, the full
 * simulation stack): a shot attributed to a player zeroes a Meridian
 * ship's armor -> the player's Meridian record drops by the kill penalty
 * and their combat rating grows by the victim's strength; and a Meridian
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

    it('credits a kill: record drop, propagation, and rating', async () => {
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
        expect(records.get(MERIDIAN)).toBe(-MERIDIAN_KILL_PENALTY);
        // Ally (Amber Compact) and enemy (Verge Raiders) propagation,
        // over the scenario's real relation map. A propagated record is
        // applied on top of the govt's InitialRec: the Compact's is 0,
        // the Raiders' is -10 (they think ill of everyone to begin
        // with), so approving the kill lifts theirs from -10 to 0.
        expect(records.get(ALLY))
            .toBe(-Math.trunc(MERIDIAN_KILL_PENALTY / 2));
        expect(records.get(ENEMY))
            .toBe(RAIDER_INITIAL_RECORD
                + Math.trunc(MERIDIAN_KILL_PENALTY / 2));
        expect(player.components.get(CombatRatingComponent)!.kills)
            .toBe(victimData.strength);

        // Repeat hits on the exploding hulk do not double-credit.
        world.emit(DamagedEvent, {
            damage: {
                shield: 0, armor: 1e9, ionization: 0, ionizationColor: 0,
                knockback: 0, passThroughShield: 1,
            },
            damager: SHOT,
        }, [VICTIM]);
        world.step();
        expect(records.get(MERIDIAN)).toBe(-MERIDIAN_KILL_PENALTY);
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

            // The record still drops as before...
            expect(player.components.get(LegalRecordsComponent)!
                .get(ENEMY)).toBeLessThan(0);
            // ...the cover is gone, the Meridian warrant (permanent,
            // another govt) untouched...
            expect(player.components.get(ActiveRanksComponent))
                .toEqual(new Set([SYNTHETIC.ranks.warrant]));
            // ...and the Verge's ships may attack again.
            expect(player.components.get(AggressionSuppressGovtsComponent))
                .toEqual(new Set());
        });

    it('credits a disable: the disable penalty, once, and not on kill',
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
            expect(records.get(MERIDIAN)).toBe(-MERIDIAN_DISABLE_PENALTY);
            // Steps while it stays disabled do not re-charge.
            world.step();
            expect(records.get(MERIDIAN)).toBe(-MERIDIAN_DISABLE_PENALTY);
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
            expect(records.get(MERIDIAN)).toBeUndefined();

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
            expect(records.get(MERIDIAN)).toBeUndefined();

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
            expect(records.get(MERIDIAN)).toBe(-MERIDIAN_DISABLE_PENALTY);
        });

    it('a Meridian warship hunts a player with a criminal Meridian record',
        async () => {
            const { gameData, world } = await makeWorld();
            const player = await addPlayer(world, gameData);
            // Deep in criminal territory (Meridian's CrimeTol is 20).
            player.components.set(LegalRecordsComponent,
                new Map([[MERIDIAN, -100]]));

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
