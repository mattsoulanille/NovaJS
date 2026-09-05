import 'jasmine';
import { Entity } from 'nova_ecs/entity';
import { getIntegrationGameData } from '../communication/simulation_test_fixture.js';
import { completeEntity } from './entity_data_loader.js';
import { DamagedEvent } from './death_plugin.js';
import { DisabledComponent } from './disabled_component.js';
import { FiringGroupComponent } from './firing_group.js';
import { GovtComponent } from './govt_component.js';
import { makeShip } from './make_ship.js';
import { makeSystem } from './make_system.js';
import { NpcComponent } from './npc_ai_plugin.js';
import { CombatRatingComponent, DamageAttributionComponent, LegalRecordsComponent } from './reputation_plugin.js';
import { TargetComponent } from './target_component.js';
import { ArmorComponent, ShieldComponent } from './health_plugin.js';

/**
 * The victim throughout is a Federation (gövt nova:128) ship, so the
 * penalties charged are the stock Federation's OWN fields, not the
 * DEFAULT_* engine fallbacks: KillPenalty 5, DisabPenalty 1
 * (pinned in reputation_integration_test.ts).
 */
const FED_KILL_PENALTY = 5;
const FED_DISABLE_PENALTY = 1;

/**
 * The reputation pipeline in a LIVE world (real game data, the full
 * simulation stack): a shot attributed to a player zeroes a
 * Federation ship's armor -> the player's Fed record drops by the
 * kill penalty and their combat rating grows by the victim's
 * strength; and a Federation warship's NPC brain treats a player
 * with a criminal Fed record as an enemy.
 */
describe('reputation in a live world', () => {
    const PLAYER = 'player ship';
    const VICTIM = 'victim ship';
    const SHOT = 'weapon shot';

    async function makeWorld() {
        const gameData = await getIntegrationGameData();
        // nova:226 (Ver'ashan): stock system with Asteroids 0; NPCs
        // off for control.
        const world = await makeSystem('nova:226', gameData, 'worker',
            { npcs: false });
        return { gameData, world };
    }

    async function addPlayer(world: Awaited<ReturnType<typeof makeWorld>>['world'],
        gameData: Awaited<ReturnType<typeof makeWorld>>['gameData']) {
        const player = makeShip(await gameData.data.Ship.get('nova:128'));
        player.components.set(LegalRecordsComponent, new Map());
        player.components.set(CombatRatingComponent, { kills: 0 });
        await completeEntity(world, player);
        world.entities.set(PLAYER, player);
        return player;
    }

    it('credits a kill: record drop, propagation, and rating', async () => {
        const { gameData, world } = await makeWorld();
        const player = await addPlayer(world, gameData);

        // A Federation shuttle as the victim (strength 2).
        const victimData = await gameData.data.Ship.get('nova:128');
        const victim = makeShip(victimData);
        victim.components.set(GovtComponent, { id: 'nova:128' });
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
        expect(records.get('nova:128')).toBe(-FED_KILL_PENALTY);
        // Ally (Bureau) and enemy (Auroran) propagation, real map.
        expect(records.get('nova:153'))
            .toBe(-Math.trunc(FED_KILL_PENALTY / 2));
        expect(records.get('nova:129'))
            .toBe(Math.trunc(FED_KILL_PENALTY / 2));
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
        expect(records.get('nova:128')).toBe(-FED_KILL_PENALTY);
    });

    it('credits a disable: the disable penalty, once, and not on kill',
        async () => {
            const { gameData, world } = await makeWorld();
            const player = await addPlayer(world, gameData);

            const victimData = await gameData.data.Ship.get('nova:128');
            const victim = makeShip(victimData);
            victim.components.set(GovtComponent, { id: 'nova:128' });
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
            expect(records.get('nova:128')).toBe(-FED_DISABLE_PENALTY);
            // Steps while it stays disabled do not re-charge.
            world.step();
            expect(records.get('nova:128')).toBe(-FED_DISABLE_PENALTY);
        });

    it('does not credit a disable for a hit on a ship that was already ' +
        'a hulk', async () => {
            const { gameData, world } = await makeWorld();
            const player = await addPlayer(world, gameData);

            const victimData = await gameData.data.Ship.get('nova:128');
            const victim = makeShip(victimData);
            victim.components.set(GovtComponent, { id: 'nova:128' });
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
            expect(records.get('nova:128')).toBeUndefined();

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
            expect(records.get('nova:128')).toBeUndefined();

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
            expect(records.get('nova:128')).toBe(-FED_DISABLE_PENALTY);
        });

    it('a Federation warship hunts a player with a criminal Fed record',
        async () => {
            const { gameData, world } = await makeWorld();
            const player = await addPlayer(world, gameData);
            // Deep in criminal territory (Fed CrimeTol is 6).
            player.components.set(LegalRecordsComponent,
                new Map([['nova:128', -100]]));

            // A Federation warship with the NPC warship brain.
            const warship = makeShip(await gameData.data.Ship.get('nova:141'));
            warship.components.set(GovtComponent, { id: 'nova:128' });
            warship.components.set(NpcComponent, { aiType: 3 });
            warship.components.set(TargetComponent, { target: undefined });
            await completeEntity(world, warship);
            world.entities.set('fed warship', warship);

            // Let the decision system think.
            for (let i = 0; i < 5; i++) {
                world.step();
            }
            expect(warship.components.get(NpcComponent)!.mode)
                .toBe('attack');
            expect(warship.components.get(TargetComponent)!.target)
                .toBe(PLAYER);
        });

    it('a Federation warship ignores a player with a clean record',
        async () => {
            const { gameData, world } = await makeWorld();
            await addPlayer(world, gameData);

            const warship = makeShip(await gameData.data.Ship.get('nova:141'));
            warship.components.set(GovtComponent, { id: 'nova:128' });
            warship.components.set(NpcComponent, { aiType: 3 });
            warship.components.set(TargetComponent, { target: undefined });
            await completeEntity(world, warship);
            world.entities.set('fed warship', warship);

            for (let i = 0; i < 5; i++) {
                world.step();
            }
            expect(warship.components.get(NpcComponent)!.mode)
                .not.toBe('attack');
        });
});
