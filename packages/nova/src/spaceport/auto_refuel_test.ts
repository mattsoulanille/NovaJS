import 'jasmine';
import { getDefaultShipPhysics } from 'novadatainterface/ship_data';
import { Entity } from 'nova_ecs/entity';
import { OutfitsStateComponent, ShipPhysicsComponent } from '../nova_plugin/ship/index.js';
import { hasAutoRefueller } from './auto_refuel.js';

/**
 * The auto-refueller fills the tank on landing (reference "The
 * Auto-recharger (E7), wave 39"); the spaceport asks hasAutoRefueller at
 * touch-down. The fill itself is the Refuel button's purchase.
 */
describe('hasAutoRefueller', () => {
    const outfits: Record<string, { autoRefuel: boolean }> = {
        'test:recharger': { autoRefuel: true },
        'test:gun': { autoRefuel: false },
    };
    const outfit = async (id: string) => outfits[id]!;

    function docked(owned: Record<string, number>,
        physics?: { autoRefuel: boolean }) {
        const entity = new Entity();
        entity.components.set(OutfitsStateComponent, new Map(
            Object.entries(owned).map(([id, count]) => [id, { count }])) as never);
        if (physics) {
            entity.components.set(ShipPhysicsComponent,
                { ...getDefaultShipPhysics(), ...physics });
        }
        return entity;
    }

    it('reads the derived physics when the ship has them', async () => {
        expect(await hasAutoRefueller(docked({}, { autoRefuel: true }), outfit))
            .toBeTrue();
        expect(await hasAutoRefueller(
            docked({ 'test:recharger': 1 }, { autoRefuel: false }), outfit))
            .toBeFalse();
    });

    it('falls back to the outfits when the physics were deleted', async () => {
        expect(await hasAutoRefueller(docked({ 'test:recharger': 1 }), outfit))
            .toBeTrue();
        expect(await hasAutoRefueller(docked({ 'test:gun': 2 }), outfit))
            .toBeFalse();
        expect(await hasAutoRefueller(docked({ 'test:recharger': 0 }), outfit))
            .toBeFalse();
        expect(await hasAutoRefueller(new Entity(), outfit)).toBeFalse();
    });
});
