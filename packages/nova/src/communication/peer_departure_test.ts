import 'jasmine';
import { Entity } from 'nova_ecs/entity';
import { MultiplayerData } from 'nova_ecs/plugins/multiplayer_plugin';
import { BayFighterComponent } from '../nova_plugin/escorts/index.js';
import { FormationComponent } from '../nova_plugin/npc/index.js';
import {
    ControlledByComponent, MissionShipComponent, NO_DEAL,
    PlayerEscortComponent,
} from '../nova_plugin/player/index.js';
import { applyPeerDeparture, classifyPeerDeparture } from './peer_departure.js';

/**
 * What `removePeer` does to a departed peer's entities (#354, the
 * maintainer's ruling of 2026-10-03): its player ship and its escorts
 * (hired, captured, and the fighters they or the player launched) leave
 * with it; every other ship it owned stays, DISOWNED; its mission ships
 * stay flagged `ownerDisconnected`, so the owner-absence despawn keeps
 * them. One entity per kind in peer_departure.ts's inventory.
 */
describe('a departed peer\'s entities (peer_departure.ts)', () => {
    const PLAYER = 'b player';

    function owned(name: string, owner = 'b') {
        return new Entity(name).addComponent(MultiplayerData, { owner });
    }

    function escortOf(entity: Entity, player: string, parent = player,
        provenance: 'hired' | 'captured' = 'hired') {
        return entity.addComponent(PlayerEscortComponent,
            { player, parent, provenance, deal: NO_DEAL });
    }

    function world() {
        const entities = new Map<string, Entity>();
        entities.set('singleton', new Entity('singleton'));
        // b's player ship.
        entities.set(PLAYER, owned('player')
            .addComponent(ControlledByComponent, { peerId: 'b' }));
        // A hired escort in formation on it, and a captured prize.
        entities.set('hired', escortOf(owned('hired'), PLAYER)
            .addComponent(FormationComponent, { leader: PLAYER, slot: 0 }));
        entities.set('captured', escortOf(owned('captured'), PLAYER,
            PLAYER, 'captured'));
        // The player's fighter, and the hired escort's (marked fighters).
        entities.set('player fighter', escortOf(owned('player fighter'), PLAYER)
            .addComponent(BayFighterComponent, { bayWeaponId: 'bay' }));
        entities.set('escort fighter', escortOf(owned('escort fighter'),
            PLAYER, 'hired')
            .addComponent(BayFighterComponent, { bayWeaponId: 'bay' }));
        // A fighter launched on the previous tick, not marked yet: its
        // chain (formation on the hired escort) still reaches the player.
        entities.set('fresh fighter', owned('fresh fighter')
            .addComponent(BayFighterComponent, { bayWeaponId: 'bay' })
            .addComponent(FormationComponent, { leader: 'hired', slot: 1 }));
        // An escort whose player is between worlds (landed, jumping).
        entities.set('stray escort', escortOf(owned('stray escort'), 'gone'));
        // A mission ship spawned at system entry: owned and tethered.
        entities.set('mission ship', owned('mission ship')
            .addComponent(MissionShipComponent,
                { mission: 'nova:500', owner: PLAYER })
            .addComponent(FormationComponent, { leader: PLAYER, slot: 2 }));
        // A ship-offered mission's ship: tethered, never owned.
        entities.set('offered ship', new Entity('offered ship')
            .addComponent(MissionShipComponent,
                { mission: 'nova:501', owner: PLAYER, untethered: true }));
        // The mission carrier's own wing (THE MISSION-SHIP BOUNDARY).
        entities.set('mission wing', owned('mission wing')
            .addComponent(BayFighterComponent, { bayWeaponId: 'bay' })
            .addComponent(FormationComponent,
                { leader: 'mission ship', slot: 0 }));
        // An NPC b spawned.
        entities.set('npc', owned('npc'));
        // Somebody else's ship, escort and mission ship.
        entities.set('a player', owned('a player', 'a')
            .addComponent(ControlledByComponent, { peerId: 'a' }));
        entities.set('a escort', escortOf(owned('a escort', 'a'), 'a player'));
        entities.set('a mission ship', owned('a mission ship', 'a')
            .addComponent(MissionShipComponent,
                { mission: 'nova:502', owner: 'a player' }));
        return entities;
    }

    it('removes the fleet, disowns the rest and strands the mission ships', () => {
        expect(classifyPeerDeparture(world(), peer => peer === 'b')).toEqual({
            fleet: ['b player', 'captured', 'escort fighter', 'fresh fighter',
                'hired', 'player fighter', 'stray escort'],
            disowned: ['mission ship', 'mission wing', 'npc'],
            stranded: ['mission ship', 'offered ship'],
        });
    });

    it('applies it: nothing of b\'s is left owned, and nobody else\'s is touched', () => {
        const entities = world();
        const others = new Map([...entities].filter(([uuid]) =>
            ['a player', 'a escort', 'a mission ship', 'singleton'].includes(uuid))
            .map(([uuid, entity]) => [uuid, structuredClone(
                [...entity.components].map(([c, data]) => [c.name, data]))]));
        applyPeerDeparture(entities, peer => peer === 'b');

        expect([...entities.keys()].sort()).toEqual(['a escort', 'a mission ship',
            'a player', 'mission ship', 'mission wing', 'npc', 'offered ship',
            'singleton']);
        for (const uuid of ['mission ship', 'mission wing', 'npc', 'offered ship']) {
            expect(entities.get(uuid)!.components.has(MultiplayerData))
                .withContext(uuid).toBeFalse();
        }
        expect(entities.get('mission ship')!.components.get(MissionShipComponent))
            .toEqual({ mission: 'nova:500', owner: PLAYER, ownerDisconnected: true });
        expect(entities.get('offered ship')!.components.get(MissionShipComponent))
            .toEqual({ mission: 'nova:501', owner: PLAYER, untethered: true,
                ownerDisconnected: true });
        for (const [uuid, before] of others) {
            expect([...entities.get(uuid)!.components].map(
                ([c, data]) => [c.name, data])).withContext(uuid).toEqual(before);
        }
    });

    it('replaces the components it changes rather than mutating them', () => {
        const entities = world();
        const tag = entities.get('mission ship')!.components.get(MissionShipComponent)!;
        applyPeerDeparture(entities, peer => peer === 'b');
        expect(tag.ownerDisconnected).toBeUndefined();
    });

    it('is a pure function of the entities, whatever their order', () => {
        const forward = world();
        const reversed = new Map([...world()].reverse());
        applyPeerDeparture(forward, peer => peer === 'b');
        applyPeerDeparture(reversed, peer => peer === 'b');
        const shape = (entities: Map<string, Entity>) => [...entities]
            .map(([uuid, entity]) => [uuid, [...entity.components]
                .map(([c, data]) => [c.name, data])])
            .sort(([a], [b]) => String(a) < String(b) ? -1 : 1);
        expect(shape(reversed)).toEqual(shape(forward));
    });
});
