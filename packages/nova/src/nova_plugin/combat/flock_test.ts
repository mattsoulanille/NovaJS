import 'jasmine';
import { Entity } from 'nova_ecs/entity';
import { OwnerComponent } from './fire_weapon_plugin.js';
import { FiringGroupComponent } from '../ship/firing_group.js';
import { isInFlock, provokeGuidedLock } from './flock.js';
import { FormationComponent, NpcComponent } from '../npc/npc_ai_plugin.js';

const PLAYER = 'player';

describe('isInFlock (transitive own-escort predicate)', () => {
    function lookup(entities: { [uuid: string]: Entity }) {
        return (uuid: string) => entities[uuid];
    }

    it('a hired escort following the player is in the flock', () => {
        const escort = new Entity('escort')
            .addComponent(FormationComponent, { leader: PLAYER, slot: 0 });
        expect(isInFlock('escort', PLAYER, lookup({ escort }))).toBeTrue();
    });

    it("the escort's own bay fighter is in the flock transitively " +
        '(formation chain)', () => {
            const escort = new Entity('escort')
                .addComponent(FormationComponent, { leader: PLAYER, slot: 0 });
            const fighter = new Entity('fighter')
                .addComponent(FormationComponent, { leader: 'escort', slot: 0 });
            expect(isInFlock('fighter', PLAYER,
                lookup({ escort, fighter }))).toBeTrue();
        });

    it("an engaged bay fighter (no formation, only the bay owner " +
        'chain) is in the flock transitively', () => {
            const escort = new Entity('escort')
                .addComponent(FormationComponent, { leader: PLAYER, slot: 0 });
            const fighter = new Entity('fighter')
                .addComponent(OwnerComponent, { owner: 'escort' });
            expect(isInFlock('fighter', PLAYER,
                lookup({ escort, fighter }))).toBeTrue();
        });

    it('the firing-group root counts as a parent link (the same root ' +
        'friendly-fire immunity uses)', () => {
            const fighter = new Entity('fighter')
                .addComponent(FiringGroupComponent, { group: PLAYER });
            expect(isInFlock('fighter', PLAYER, lookup({ fighter })))
                .toBeTrue();
        });

    it("an NPC fleet escort following its own leader is NOT in the " +
        "player's flock", () => {
            const npcLeader = new Entity('npc leader');
            const npcEscort = new Entity('npc escort')
                .addComponent(FormationComponent,
                    { leader: 'npc leader', slot: 0 })
                .addComponent(FiringGroupComponent, { group: 'npc leader' });
            expect(isInFlock('npc escort', PLAYER,
                lookup({ 'npc leader': npcLeader, 'npc escort': npcEscort })))
                .toBeFalse();
        });

    it('a lone enemy ship is not in the flock', () => {
        const enemy = new Entity('enemy');
        expect(isInFlock('enemy', PLAYER, lookup({ enemy }))).toBeFalse();
    });

    it('the player is not in their own flock', () => {
        expect(isInFlock(PLAYER, PLAYER, lookup({}))).toBeFalse();
    });

    it('survives leader cycles without looping forever', () => {
        const a = new Entity('a')
            .addComponent(FormationComponent, { leader: 'b', slot: 0 });
        const b = new Entity('b')
            .addComponent(FormationComponent, { leader: 'a', slot: 0 });
        expect(isInFlock('a', PLAYER, lookup({ a, b }))).toBeFalse();
        expect(isInFlock('b', PLAYER, lookup({ a, b }))).toBeFalse();
    });

    it('a self-referential leader terminates', () => {
        const weird = new Entity('weird')
            .addComponent(FormationComponent, { leader: 'weird', slot: 0 });
        expect(isInFlock('weird', PLAYER, lookup({ weird }))).toBeFalse();
    });

    it('a dangling parent (despawned mid-chain) is not in the flock', () => {
        const fighter = new Entity('fighter')
            .addComponent(OwnerComponent, { owner: 'gone' });
        expect(isInFlock('fighter', PLAYER, lookup({ fighter }))).toBeFalse();
    });
});

describe('provokeGuidedLock (guided-missile provocation)', () => {
    function lookup(entities: { [uuid: string]: Entity }) {
        return (uuid: string) => entities[uuid];
    }

    it('locking on flips a neutral NPC hostile to the shooter, ' +
        'reacting immediately', () => {
            const trader = new Entity('trader')
                .addComponent(NpcComponent,
                    { aiType: 2, mode: 'travel', nextDecision: 99999 });
            const shooter = new Entity('shooter');
            provokeGuidedLock('trader', 'shooter', 'shooter',
                lookup({ trader, shooter }), 0);
            const npc = trader.components.get(NpcComponent)!;
            expect(npc.aggressor).toBe('shooter');
            // The think timer is zeroed: no waiting out the interval.
            expect(npc.nextDecision).toBe(0);
        });

    it("the shooter's own flock is exempt (a stray lock on your " +
        'wing is not a betrayal)', () => {
            const escort = new Entity('escort')
                .addComponent(NpcComponent, { aiType: 3 })
                .addComponent(FormationComponent,
                    { leader: 'shooter', slot: 0 });
            const shooter = new Entity('shooter');
            provokeGuidedLock('escort', 'shooter', 'shooter',
                lookup({ escort, shooter }), 0);
            expect(escort.components.get(NpcComponent)!.aggressor)
                .toBeUndefined();
        });

    it('the same firing group (fleetmates) is exempt', () => {
        const wingman = new Entity('wingman')
            .addComponent(NpcComponent, { aiType: 3 })
            .addComponent(FiringGroupComponent, { group: 'fleet leader' });
        const shooter = new Entity('shooter')
            .addComponent(FiringGroupComponent, { group: 'fleet leader' });
        provokeGuidedLock('wingman', 'shooter', 'shooter',
            lookup({ wingman, shooter }), 0);
        expect(wingman.components.get(NpcComponent)!.aggressor)
            .toBeUndefined();
    });

    it('a target with neither an NPC brain nor a pilot is a no-op', () => {
        // Nobody to provoke: no NpcComponent to set an aggressor on and
        // no ControlledByComponent to record player aggression against.
        // (A PILOTED ship is provoked — see aggression_test.)
        const hulk = new Entity('hulk');
        const shooter = new Entity('shooter');
        expect(() => provokeGuidedLock('hulk', 'shooter', 'shooter',
            lookup({ hulk, shooter }), 0)).not.toThrow();
    });
});
