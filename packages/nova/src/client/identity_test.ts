import 'jasmine';
import { BehaviorSubject } from 'rxjs';
import { Entity } from 'nova_ecs/entity';
import { MultiplayerData } from 'nova_ecs/plugins/multiplayer_plugin';
import { EncodedEntity } from 'nova_ecs/plugins/serializer_plugin';
import { encodedEntityStamps, restampEncodedEntity } from '../communication/peer_identity.js';
import { ControlledByComponent } from '../nova_plugin/player/index.js';
import { ClientState, LiveSystem } from './client_state.js';
import { FleetLedger } from './fleet_ledger.js';
import { followIdentity, heldFleetEntities, restampHeldFleet } from './identity.js';

/**
 * #354: what the client holds out of the simulation follows the CURRENT
 * connection's uuid; a reconnect changes it mid-game.
 */
describe('the held fleet follows the connection (#354)', () => {
    const player = (peer: string) => new Entity('player')
        .addComponent(ControlledByComponent, { peerId: peer })
        .addComponent(MultiplayerData, { owner: peer });
    const escort = (peer: string) => new Entity('escort')
        .addComponent(MultiplayerData, { owner: peer });

    function landedWith(hull: Entity, launching?: Entity): ClientState {
        return {
            kind: 'landed', system: {} as LiveSystem,
            ship: { uuid: 'ship', entity: hull, planetId: 'nova:128' },
            ...(launching ? { launching } : {}),
        } as ClientState;
    }

    it('re-stamps the docked hull, the lift-off entity and every roster', () => {
        const hull = player('old');
        const launching = player('old');
        const fleet = new FleetLedger();
        const landed = escort('old');
        const jumping = escort('old');
        const lost = escort('old');
        const foreign = escort('someone else');
        fleet.landed.push({ player: 'ship', uuid: 'e1', entity: landed });
        fleet.jumping.push({ player: 'ship', uuid: 'e2', entity: jumping });
        fleet.lost.push({ player: 'ship', uuid: 'e3', entity: lost });
        fleet.landed.push({ player: 'ship', uuid: 'e4', entity: foreign });
        const state = landedWith(hull, launching);
        expect(heldFleetEntities(state, fleet).length).toBe(6);

        expect(restampHeldFleet(state, fleet, 'old', 'new')).toBe(5);
        for (const entity of [hull, launching]) {
            expect(entity.components.get(ControlledByComponent)).toEqual({ peerId: 'new' });
            expect(entity.components.get(MultiplayerData)).toEqual({ owner: 'new' });
        }
        for (const entity of [landed, jumping, lost]) {
            expect(entity.components.get(MultiplayerData)).toEqual({ owner: 'new' });
            expect(entity.components.has(ControlledByComponent)).toBeFalse();
        }
        // Somebody else's stamp is not this client's to move.
        expect(foreign.components.get(MultiplayerData)).toEqual({ owner: 'someone else' });
        // Idempotent.
        expect(restampHeldFleet(state, fleet, 'old', 'new')).toBe(0);
    });

    it('re-stamps a transit\'s carried player', () => {
        const carried = player('old');
        const state = {
            kind: 'transit', transit: { kind: 'hyper', from: 'a', to: 'b',
                uuid: 'ship', entity: carried },
        } as unknown as ClientState;
        expect(restampHeldFleet(state, new FleetLedger(), 'old', 'new')).toBe(1);
        expect(carried.components.get(ControlledByComponent)).toEqual({ peerId: 'new' });
    });

    it('follows every change of the identity stream, and only changes', () => {
        const identity = new BehaviorSubject<string | undefined>(undefined);
        const hull = player('first');
        const state = landedWith(hull);
        const info = spyOn(console, 'info');
        const subscription = followIdentity(identity, () => state, new FleetLedger());
        identity.next('first');
        expect(hull.components.get(MultiplayerData)).toEqual({ owner: 'first' });
        identity.next('second');
        expect(hull.components.get(MultiplayerData)).toEqual({ owner: 'second' });
        identity.next('second');
        identity.next('third');
        expect(hull.components.get(ControlledByComponent)).toEqual({ peerId: 'third' });
        expect(info).toHaveBeenCalledTimes(2);
        subscription.unsubscribe();
        identity.next('fourth');
        expect(hull.components.get(MultiplayerData)).toEqual({ owner: 'third' });
    });

    it('re-stamps an encoded insertion, keeping everything else', () => {
        const encoded: EncodedEntity = {
            name: 'ship',
            components: [
                ['Foo', { x: 1 }],
                ['ControlledBy', { peerId: 'old' }],
                ['MultiplayerData', { owner: 'old' }],
            ],
        };
        const stale = (id: string) => id === 'old';
        const restamped = restampEncodedEntity(encoded, stale, 'new');
        expect(encodedEntityStamps(restamped)).toEqual(['new', 'new']);
        expect(restamped.components[0]).toBe(encoded.components[0]!);
        expect(restamped.name).toBe('ship');
        // The original is untouched (it may be a record already sent).
        expect(encodedEntityStamps(encoded)).toEqual(['old', 'old']);
        // Nothing stale: the very same object.
        expect(restampEncodedEntity(restamped, stale, 'new')).toBe(restamped);
    });
});
