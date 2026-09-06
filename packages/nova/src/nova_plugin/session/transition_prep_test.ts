import 'jasmine';
import { Entity } from 'nova_ecs/entity';
import { AggressionComponent } from '../combat/aggression.js';
import { BoardedComponent } from '../ship/boarding_component.js';
import { NpcComponent } from '../npc/npc_ai_plugin.js';
import { PlanetTargetComponent } from '../travel/planet_plugin.js';
import { TargetComponent } from '../ship/target_component.js';
import {
    clearPlayerTargetsForTransition, clearStaleReferences,
    prepareCarriedEntitiesForFreshWorld,
} from './transition_prep.js';

/**
 * Issue #32: a uuid carried across a system transition names nothing in
 * the destination world (or, before the id prefix, the wrong thing), so
 * the references are dropped at the carry seam.
 */
describe('carried-entity preparation for a fresh world', () => {
    describe('the player', () => {
        it('arrives with no ship target and no stellar selected, like the '
            + 'original', () => {
                const player = new Entity('player');
                player.components.set(TargetComponent, { target: 'npc:7' });
                player.components.set(PlanetTargetComponent,
                    { target: 'planet nova:128' });
                clearPlayerTargetsForTransition(player);
                expect(player.components.get(TargetComponent))
                    .toEqual({ target: undefined });
                expect(player.components.get(PlanetTargetComponent))
                    .toEqual({ target: undefined });
            });

        it('gains no target component it did not have', () => {
            const player = new Entity('player');
            clearPlayerTargetsForTransition(player);
            expect(player.components.has(TargetComponent)).toBeFalse();
            expect(player.components.has(PlanetTargetComponent)).toBeFalse();
        });
    });

    describe('an escort', () => {
        function npcEscort() {
            const escort = new Entity('escort');
            escort.components.set(NpcComponent, {
                aiType: 2, mode: 'attack', aggressor: 'npc:3',
                boardTarget: 'npc:4', pacifiedFrom: 'npc:5', destination: 'planet x',
            });
            escort.components.set(TargetComponent, { target: 'npc:9' });
            return escort;
        }

        it('forgets a target and an aggressor that are not crossing with '
            + 'it', () => {
                const escort = npcEscort();
                clearStaleReferences(escort, new Set(['player']));
                expect(escort.components.get(TargetComponent))
                    .toEqual({ target: undefined });
                const npc = escort.components.get(NpcComponent)!;
                expect(npc.aggressor).toBeUndefined();
                expect(npc.boardTarget).toBeUndefined();
                expect(npc.pacifiedFrom).toBeUndefined();
                // Everything that is not a stale reference is untouched.
                expect(npc.aiType).toBe(2);
                expect(npc.mode).toBe('attack');
                expect(npc.destination).toBe('planet x');
            });

        it('keeps a reference INTO the batch for the remap to rewrite',
            () => {
                const escort = npcEscort();
                clearStaleReferences(escort,
                    new Set(['player', 'npc:9', 'npc:3']));
                expect(escort.components.get(TargetComponent))
                    .toEqual({ target: 'npc:9' });
                const npc = escort.components.get(NpcComponent)!;
                expect(npc.aggressor).toBe('npc:3');
                expect(npc.boardTarget).toBeUndefined();
            });

        it('does not rewrite an NPC brain that named nothing stale', () => {
            const escort = new Entity('escort');
            const brain = { aiType: 1, aggressor: 'player' };
            escort.components.set(NpcComponent, brain);
            clearStaleReferences(escort, new Set(['player']));
            expect(escort.components.get(NpcComponent)).toBe(brain);
        });

        it('resets the plunder record: a jump is a life-segment boundary, '
            + 'and a stale boarder would otherwise ride a restored prize '
            + 'forever', () => {
                const escort = new Entity('prize');
                escort.components.set(BoardedComponent,
                    { boarder: 'old-player', plundered: true });
                clearStaleReferences(escort, new Set(['player']));
                expect(escort.components.has(BoardedComponent)).toBeFalse();
            });
    });

    describe('the whole batch', () => {
        it('clears the aggression tables, the player reticles and every '
            + 'out-of-batch reference in one pass', () => {
                const player = new Entity('player');
                player.components.set(AggressionComponent, new Map([
                    ['npc:1', { at: 0, damage: 0, hostile: true }]]));
                player.components.set(TargetComponent, { target: 'npc:1' });
                const carrier = new Entity('carrier');
                carrier.components.set(TargetComponent, { target: 'npc:2' });
                const fighter = new Entity('fighter');
                fighter.components.set(NpcComponent,
                    { aiType: 1, aggressor: 'carrier-uuid' });
                fighter.components.set(AggressionComponent, new Map([
                    ['npc:1', { at: 0, damage: 0, hostile: true }]]));
                prepareCarriedEntitiesForFreshWorld(player, 'player-uuid', [
                    { uuid: 'carrier-uuid', entity: carrier },
                    { uuid: 'fighter-uuid', entity: fighter },
                ]);
                expect(player.components.has(AggressionComponent)).toBeFalse();
                expect(player.components.get(TargetComponent))
                    .toEqual({ target: undefined });
                expect(carrier.components.get(TargetComponent))
                    .toEqual({ target: undefined });
                expect(fighter.components.has(AggressionComponent)).toBeFalse();
                // The fighter's grudge against its own carrier crosses with
                // both of them (and is remapped later).
                expect(fighter.components.get(NpcComponent)?.aggressor)
                    .toBe('carrier-uuid');
            });
    });
});
