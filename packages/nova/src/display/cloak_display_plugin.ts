import { Plugin } from 'nova_ecs/plugin';
import {
    CloakComponent, CloakScannerComponent, deriveCloak, deriveCloakScanner,
} from '../nova_plugin/cloak_plugin.js';
import { SimulationGameDataResource } from '../nova_plugin/game_data_resource.js';
import { OutfitsStateComponent } from '../nova_plugin/outfit_plugin.js';
import { ProvideFromCache } from '../nova_plugin/provide_from_cache.js';

/**
 * Derives CloakComponent and CloakScannerComponent in the DISPLAY world.
 *
 * Both are the sim's ProvideFromCache outputs over a ship's outfits
 * (cloak_plugin.ts), deliberately NOT serializer-registered: cheap to
 * recompute, wasteful to send, and re-derived on snapshot restore
 * (snapshot policy `skip`). Only registered components cross the bridge
 * into this world, so nothing here ever had them — the same failure
 * ShipPhysicsDisplayPlugin fixes for ShipPhysicsComponent — and two
 * readers were silently dead:
 *
 *  - the radar's `Optional(CloakComponent)` (status_bar.ts DrawRadar)
 *    always came back undefined, and its `hidesFromRadar ?? true`
 *    default hid EVERY actively cloaked ship. Five of the six stock
 *    cloaks — Fed nova:211, Rebel nova:234/347, Wraith nova:266,
 *    Cloaking Organ v1.0 nova:268 — set ModVal 0x0002 "Visible on
 *    radar" (EVN Bible, oütf ModType 17), so those ships should stay
 *    blips; only Cloaking Organ v1.1 nova:269 hides;
 *  - ShipAnimationSystem's PlayerScannerQuery on CloakScannerComponent
 *    matched nothing, so a scanner's on-screen reveal (ModVal 0x0002,
 *    CLOAKED_ALPHA_REVEALED) was unreachable. No stock outfit is a
 *    scanner; plug-ins adding ModType 30 got a no-op.
 *
 * OutfitsStateComponent is delta-synced and the display shares the
 * sim's game data, so the sim's own derive functions work here
 * unchanged. Additive: the wire format and the snapshot policies are
 * untouched (registering the components would have sent redundant
 * state to every peer).
 */
const CloakDisplayProvider = ProvideFromCache({
    name: 'CloakDisplayProvider',
    provided: CloakComponent,
    update: [OutfitsStateComponent],
    args: [OutfitsStateComponent, SimulationGameDataResource] as const,
    factory: deriveCloak,
});

const CloakScannerDisplayProvider = ProvideFromCache({
    name: 'CloakScannerDisplayProvider',
    provided: CloakScannerComponent,
    update: [OutfitsStateComponent],
    args: [OutfitsStateComponent, SimulationGameDataResource] as const,
    factory: deriveCloakScanner,
});

export const CloakDisplayPlugin: Plugin = {
    name: 'CloakDisplay',
    build(world) {
        world.addComponent(CloakComponent);
        world.addComponent(CloakScannerComponent);
        world.addSystem(CloakDisplayProvider);
        world.addSystem(CloakScannerDisplayProvider);
    },
    remove(world) {
        world.removeSystem(CloakScannerDisplayProvider);
        world.removeSystem(CloakDisplayProvider);
    },
};
