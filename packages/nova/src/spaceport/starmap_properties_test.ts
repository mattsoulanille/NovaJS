import 'jasmine';
import { getDefaultGovtData } from 'novadatainterface/govt_data';
import { getDefaultPlanetData, PlanetData } from 'novadatainterface/planet_data';
import { getDefaultSystemData, SystemData } from 'novadatainterface/system_data';
import {
    DISCOVERY_ENTERED, DISCOVERY_LANDED, DISCOVERY_UNKNOWN,
} from '../nova_plugin/player/index.js';
import {
    PropSlot,
    systemProperties, UNINHABITED_SYSTEM_TEXT,
} from './starmap_properties.js';

/**
 * The map's properties column for a system with NO STELLARS. Reference
 * "A14 wave 18" (docs/reference_experiments.md; the map in Kit Disab
 * Unowned with Kit Disab One clicked): "Kit Disab One" under the title,
 * then "Uninhabited System" in white where the Government group would
 * stand, and nothing else in the column (no Government, no Legal Status,
 * no Goods Traded / Services); Ports: None. Kit Disab One is OWNED (gövt
 * 312): the line is about the stellars, not the government.
 */
describe('the map\'s properties column: an uninhabited system', () => {
    const owner = { ...getDefaultGovtData(), id: 'test:owner', name: 'Owner' };
    const port: PlanetData = { ...getDefaultPlanetData(), id: 'test:port' };
    const universe = {
        getGovt: (id: string) => id === owner.id ? owner : undefined,
        getPlanet: (id: string) => id === port.id ? port : undefined,
    } as Parameters<typeof systemProperties>[3];

    function system(planets: string[]): SystemData {
        return {
            ...getDefaultSystemData(), id: 'test:system', name: 'Kit Disab One',
            govt: owner.id, planets,
        };
    }

    it('shows "Uninhabited System" alone in the Government slot, in white',
        () => {
            for (const level of [DISCOVERY_ENTERED, DISCOVERY_LANDED] as const) {
                const props = systemProperties(system([]), false, level,
                    universe, new Map([['test:system', -600]]));
                expect(props.lines).toEqual([
                    {
                        slot: PropSlot.System, label: 'Destination System:',
                        values: ['Kit Disab One'],
                    },
                    {
                        slot: PropSlot.Government,
                        label: UNINHABITED_SYSTEM_TEXT, values: [],
                        bright: true,
                    },
                ]);
                expect(props.ports).toBe('None');
                expect(props.hazards).toBe('None');
            }
            expect(UNINHABITED_SYSTEM_TEXT).toBe('Uninhabited System');
        });

    it('an inhabited system keeps its groups, and an undiscovered '
        + 'stellar-less one stays <Unknown>', () => {
            const inhabited = systemProperties(system([port.id]), true,
                DISCOVERY_ENTERED, universe, new Map());
            expect(inhabited.lines.map(line => line.label)).toEqual([
                'Current System:', 'Government:', 'Legal Status:',
                'Goods Traded:', 'Services:',
            ]);
            expect(inhabited.lines.some(line => line.bright)).toBeFalse();
            const unknown = systemProperties(system([]), false,
                DISCOVERY_UNKNOWN, universe, new Map());
            expect(unknown.lines.map(line => line.values))
                .toEqual([['<Unknown>']]);
        });

    // renderPropertyLines draws a `bright` label in PROP_VALUE_FONT; PIXI.Text
    // needs a canvas, so that is checked in the browser, not here.
});
