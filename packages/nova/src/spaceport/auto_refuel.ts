import { OutfitData } from 'novadatainterface/outfit_data';
import { Entity } from 'nova_ecs/entity';
import { OutfitsStateComponent, ShipPhysicsComponent } from '../nova_plugin/ship/index.js';

/**
 * ============================================================================
 * The auto-refueller (oütf ModType 19)
 * ============================================================================
 *
 * The EVN Bible lists ModType 19 "auto-refueller" and says nothing more.
 * MEASURED (reference "The Auto-recharger (E7), wave 39"): the stock
 * Auto-recharger (oütf 186) adds NO fuel in flight (95 s from empty:
 * nothing); on LANDING it fills the tank at the port's price (300 units
 * for 300 credits) and the spaceport shows no Refuel button. So it is the
 * Refuel button pressed for the player at touch-down, nothing in space.
 * (NovaJS used to regenerate 2.5 units a second in flight: a tuned guess,
 * not a deliberate departure.)
 *
 * GUESS (unmeasured): when the credits fall short of the fill nothing is
 * bought, and the Refuel button stays as it would without the outfit
 * (greyed). Only the landing fills; an Auto-recharger bought while docked
 * takes effect at the next landing.
 */

/**
 * Whether the docked ship carries an auto-refueller: its derived physics
 * say so (outfit_plugin ORs the outfit's physics.autoRefuel onto the
 * ship), or, when the physics are not on the entity (the outfitter and a
 * landing-pass hull change delete them; nothing re-derives them while
 * docked), one of its outfits is one.
 */
export async function hasAutoRefueller(entity: Entity,
    outfit: (id: string) => Promise<Pick<OutfitData, 'autoRefuel'>>):
    Promise<boolean> {
    const physics = entity.components.get(ShipPhysicsComponent);
    if (physics) {
        return physics.autoRefuel;
    }
    const outfits = entity.components.get(OutfitsStateComponent);
    for (const [id, { count }] of outfits ?? []) {
        if (count > 0 && (await outfit(id)).autoRefuel) {
            return true;
        }
    }
    return false;
}
