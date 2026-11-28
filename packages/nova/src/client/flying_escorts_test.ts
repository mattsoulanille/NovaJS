import 'jasmine';
import { right } from 'fp-ts/lib/Either.js';
import { Entity } from 'nova_ecs/entity';
import { MultiplayerData } from 'nova_ecs/plugins/multiplayer_plugin';
import { World } from 'nova_ecs/world';
import {
    EscortLandingComponent, MissionShipComponent, NO_DEAL,
    PlayerEscortComponent,
} from '../nova_plugin/player/index.js';
import { ShipComponent } from '../nova_plugin/ship/index.js';
import type { LiveSystem } from './client_state.js';
import { FleetLedger } from './fleet_ledger.js';
import { carryFlyingEscorts } from './flying_escorts.js';
import type { ClientRuntime } from './runtime.js';

/**
 * The flock still in the air when a docked player leaves for another system
 * (a landed `Mxxx` / `Nxxx`, a hypergate pick): carried as a gate would
 * carry it, removed from the simulation by an owned `removeEntity`.
 */
describe('carryFlyingEscorts', () => {
    const PLAYER = 'player';

    function escort(owner = PLAYER): Entity {
        return new Entity('escort')
            .addComponent(ShipComponent, { id: 'nova:128' })
            .addComponent(MultiplayerData, { owner: 'peer-1' })
            .addComponent(PlayerEscortComponent,
                { player: owner, deal: NO_DEAL })
            .addComponent(EscortLandingComponent, { planet: 'stellar' });
    }

    function setup(onRemove?: (uuid: string, world: World,
        fleet: FleetLedger) => void) {
        const world = new World();
        const fleet = new FleetLedger();
        const removed: string[] = [];
        const live = {
            world,
            bridge: {
                removeEntity: async (uuid: string) => {
                    removed.push(uuid);
                    onRemove?.(uuid, world, fleet);
                    world.entities.delete(uuid);
                },
            },
            // The display entities as a carry event would hand them over:
            // a round trip that keeps every component.
            serializer: {
                encode: (entity: Entity) => entity,
                decode: (entity: Entity) => {
                    const copy = new Entity(entity.name);
                    for (const [component, value] of entity.components) {
                        copy.components.set(component, value);
                    }
                    return right(copy);
                },
            },
        } as unknown as LiveSystem;
        const runtime = { fleet } as unknown as ClientRuntime;
        return { world, fleet, live, runtime, removed };
    }

    it('carries the player\'s escorts in flight onto the jump roster and '
        + 'removes them from the simulation; others stay', async () => {
            const { world, fleet, live, runtime, removed } = setup();
            world.entities.set('mine', escort());
            world.entities.set('theirs', escort('someone else'));
            const special = escort();
            special.components.set(MissionShipComponent,
                { mission: 'nova:500', owner: PLAYER });
            world.entities.set('special', special);

            expect(await carryFlyingEscorts(runtime, live, PLAYER)).toBe(1);
            expect(removed).toEqual(['mine']);
            expect(fleet.jumping.map(row => [row.player, row.uuid]))
                .toEqual([[PLAYER, 'mine']]);
            // Stripped as a jump sweep strips it: its landing order named
            // a stellar in the system being left.
            expect(fleet.jumping[0].entity.components
                .has(EscortLandingComponent)).toBeFalse();
            expect(world.entities.has('theirs')).toBeTrue();
            expect(world.entities.has('special')).toBeTrue();
        });

    it('leaves the landed row standing for an escort that touched down '
        + 'before its removal applied', async () => {
            const { world, fleet, live, runtime } = setup(
                (uuid, liveWorld, ledger) => {
                    // Its own EscortLandedEvent got there first.
                    ledger.landed.push({ player: PLAYER, uuid,
                        entity: liveWorld.entities.get(uuid)! });
                });
            world.entities.set('mine', escort());
            await carryFlyingEscorts(runtime, live, PLAYER);
            expect(fleet.jumping).toEqual([]);
            expect(fleet.landed.map(row => row.uuid)).toEqual(['mine']);
        });

    it('does nothing with no escort in the air', async () => {
        const { live, runtime, removed } = setup();
        expect(await carryFlyingEscorts(runtime, live, PLAYER)).toBe(0);
        expect(removed).toEqual([]);
    });
});
