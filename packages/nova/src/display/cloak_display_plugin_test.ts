import 'jasmine';
import { Entity } from 'nova_ecs/entity';
import { World } from 'nova_ecs/world';
import { getIntegrationGameData } from '../communication/simulation_test_fixture.js';
import { CloakComponent, CloakScannerComponent } from '../nova_plugin/cloak_plugin.js';
import { SimulationGameDataResource } from '../nova_plugin/game_data_resource.js';
import { OutfitsStateComponent } from '../nova_plugin/outfit_plugin.js';
import { CloakDisplayPlugin } from './cloak_display_plugin.js';
import { radarHidesShip } from './status_bar.js';

/**
 * The display world derives CloakComponent / CloakScannerComponent from
 * a ship's delta-synced outfits, the way the sim does. Neither crosses
 * the bridge (snapshot policy `skip`), so before this plugin the radar's
 * `Optional(CloakComponent)` was always undefined and its `?? true`
 * default hid every cloaked ship — including the five stock cloaks that
 * set 0x0002 "Visible on radar".
 *
 * Pinned against the real stock outfits (base data only).
 */

/** Federation Cloaking Device: ModVal 14 = 0x2 | 0x4 | 0x8, visible on radar. */
const FED_CLOAK = 'nova:211';
/** Cloaking Organ v1.1: ModVal 1033 = 0x400 | 0x8 | 0x1, no 0x2 — hides. */
const ORGAN_V1_1 = 'nova:269';

describe('CloakDisplayPlugin (real stock cloaks)', () => {
    let world: World;

    beforeAll(async () => {
        const gameData = await getIntegrationGameData();
        // The providers read getCached; warm the outfits first, as the
        // entity data loader does for every ship it inserts.
        await gameData.data.Outfit.get(FED_CLOAK);
        await gameData.data.Outfit.get(ORGAN_V1_1);
        world = new World('cloak display test');
        world.resources.set(SimulationGameDataResource, gameData);
        await world.addPlugin(CloakDisplayPlugin);
    });

    function shipWith(uuid: string, outfits: [string, number][]): Entity {
        const ship = new Entity(uuid);
        ship.components.set(OutfitsStateComponent,
            new Map(outfits.map(([id, count]) => [id, { count }])));
        world.entities.set(uuid, ship);
        return ship;
    }

    it('derives a radar-visible cloak for the Federation Cloaking Device',
        () => {
            const ship = shipWith('fed', [[FED_CLOAK, 1]]);
            world.step();
            const cloak = ship.components.get(CloakComponent);
            expect(cloak?.canCloak).toBeTrue();
            expect(cloak?.hidesFromRadar).toBeFalse();
            // ...so an actively cloaked Fed-cloak ship stays a blip.
            expect(radarHidesShip({ active: true }, cloak)).toBeFalse();
        });

    it('derives a radar-hiding cloak for Cloaking Organ v1.1', () => {
        const ship = shipWith('organ', [[ORGAN_V1_1, 1]]);
        world.step();
        const cloak = ship.components.get(CloakComponent);
        expect(cloak?.hidesFromRadar).toBeTrue();
        expect(radarHidesShip({ active: true }, cloak)).toBeTrue();
        // Only while the cloak is actually on.
        expect(radarHidesShip({ active: false }, cloak)).toBeFalse();
        expect(radarHidesShip(undefined, cloak)).toBeFalse();
    });

    it('derives no cloak, and no scanner, for a ship without them', () => {
        const ship = shipWith('plain', []);
        world.step();
        expect(ship.components.get(CloakComponent)?.canCloak).toBeFalse();
        expect(ship.components.get(CloakScannerComponent)?.hasScanner)
            .toBeFalse();
    });

    it('keeps hiding a cloaked ship whose cloak data is unknown', () => {
        // The conservative default for a cloak not yet derived/cached.
        expect(radarHidesShip({ active: true }, undefined)).toBeTrue();
    });
});
