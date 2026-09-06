import "jasmine";
import { PlanetData } from "novadatainterface/planet_data";
import { SystemData } from "novadatainterface/system_data";
import {
    getIntegrationGameData, getPluginGameData,
} from "../communication/simulation_test_fixture.js";
import { novaDataInstalled, requireNovaData } from "../test_support/nova_data_gate.js";
import { GameDataAggregator } from "../server/parsing/game_data_aggregator.js";
import { isPort, systemIsInhabited } from "../nova_plugin/core/landable.js";
import {
    SYSTEM_INHABITED_COLOR, SYSTEM_UNEXPLORED_COLOR,
    SYSTEM_UNINHABITED_COLOR, systemDotColor,
} from "./starmap_draw.js";

/**
 * The star map's blue-vs-grey system dots, against the real resource data.
 *
 * The rule (starmap.ts drawSystem, landable.ts isPort) is that a system is
 * INHABITED — blue — iff it holds at least one stellar that is landable
 * (spöb Flags 0x0001) and not flagged uninhabited (0x0020). It is measured
 * on ui_screenshots/original_macos_screenshots/map/govt_borders.png, where
 * every blue dot resolves to a system with >= 1 such stellar and the two
 * labeled grey ones (Procyon, HJG-1034) each hold a stellar that is landable
 * but uninhabited.
 */

/** A system by name, taking the copy that is visible with no control bits. */
async function loadUniverse(gameData: GameDataAggregator) {
    const ids = await gameData.ids;
    const systems = await Promise.all(
        [...ids.System].sort().map(id => gameData.data.System.get(id)));
    const planets = new Map<string, PlanetData>();
    await Promise.all([...ids.Planet].sort().map(async id => {
        planets.set(id, await gameData.data.Planet.get(id));
    }));
    return {
        systems,
        planets,
        system: (id: string) => systems.find(s => s.id === id)!,
        inhabited: (system: SystemData) =>
            systemIsInhabited(system.planets, id => planets.get(id)),
    };
}

describe('star map inhabited coloring (stock data)', () => {
    let universe: Awaited<ReturnType<typeof loadUniverse>>;
    beforeEach(requireNovaData);
    beforeAll(async () => {
        if (!novaDataInstalled()) return; // each spec pends instead
        universe = await loadUniverse(await getIntegrationGameData());
    }, 120_000);

    it('draws Sol blue — Earth, Mars and Europa are ports', () => {
        const sol = universe.system('nova:130');
        expect(sol.name).toBe('Sol');
        expect(universe.inhabited(sol)).toBeTrue();
        expect(systemDotColor(true, universe.inhabited(sol)))
            .toBe(SYSTEM_INHABITED_COLOR);
    });

    it('does NOT count Sol\'s wormhole or Jupiter as ports — the "Ports:" '
        + 'readout in the original reads exactly "Earth, Mars, Europa"',
        () => {
            const sol = universe.system('nova:130');
            const ports = sol.planets
                .map(id => universe.planets.get(id)!)
                .filter(p => isPort(p.flags))
                .map(p => p.name);
            expect(ports).toEqual(['Earth', 'Mars', 'Europa']);
        });

    it('draws a system whose only stellar is landable-but-UNINHABITED grey '
        + '(HJG-1034, hollow in the original screenshot)', () => {
            const hjg = universe.system('nova:145');
            expect(hjg.name).toBe('HJG-1034');
            // The one stellar: landable, so the old "has any spöb" rule
            // painted it blue; uninhabited, so the original does not.
            const stellars = hjg.planets.map(id => universe.planets.get(id)!);
            expect(stellars.length).toBe(1);
            expect(stellars[0].flags.canLand).toBeTrue();
            expect(stellars[0].flags.uninhabited).toBeTrue();
            expect(universe.inhabited(hjg)).toBeFalse();
            expect(systemDotColor(true, universe.inhabited(hjg)))
                .toBe(SYSTEM_UNINHABITED_COLOR);
        });

    it('draws Procyon grey, the map\'s other labeled hollow system', () => {
        // nova:147 is the copy visible to a pilot with no control bits.
        const procyon = universe.system('nova:147');
        expect(procyon.name).toBe('Procyon');
        expect(universe.inhabited(procyon)).toBeFalse();
    });

    it('draws a system with no stellars at all grey (Pollux)', () => {
        const pollux = universe.system('nova:139');
        expect(pollux.name).toBe('Pollux');
        expect(pollux.planets.length).toBe(0);
        expect(universe.inhabited(pollux)).toBeFalse();
    });

    it('dims an inhabited system the player has never entered — this is '
        + 'what keeps a secret installation off the map', () => {
            const sol = universe.system('nova:130');
            expect(systemDotColor(false, universe.inhabited(sol)))
                .toBe(SYSTEM_UNEXPLORED_COLOR);
        });

    /**
     * Heraan Hiro (Matthew, 2026-09-02: "why does it show up as uninhabited?
     * It has a station with a mission BBS"). Its lone stellar Mortosch is
     * landable, a station, and flagged uninhabited, with no service bits at
     * all — the same shape as the two systems MEASURED grey in the original
     * — so grey is faithful. See starmap.ts systemDotColor for the reference
     * measurement and for why a mission BBS is not evidence of habitation.
     */
    it('draws Heraan Hiro grey: Mortosch is a landable, serviceless, '
        + 'UNINHABITED station', () => {
            const hiro = universe.system('nova:340');
            expect(hiro.name).toBe('Heraan Hiro');
            expect(hiro.planets).toEqual(['nova:357']);
            const mortosch = universe.planets.get('nova:357')!;
            expect(mortosch.name).toBe('Mortosch');
            // spöb Flags 0x00000031 = 0x0001 land | 0x0010 station | 0x0020
            // uninhabited. Nothing else is set.
            expect(mortosch.flags.canLand).toBeTrue();
            expect(mortosch.flags.isStation).toBeTrue();
            expect(mortosch.flags.uninhabited).toBeTrue();
            expect(mortosch.flags.hasBar).toBeFalse();
            expect(mortosch.flags.hasCommodityExchange).toBeFalse();
            expect(mortosch.flags.hasOutfitter).toBeFalse();
            expect(mortosch.flags.hasShipyard).toBeFalse();
            expect(isPort(mortosch.flags)).toBeFalse();
            expect(universe.inhabited(hiro)).toBeFalse();
            expect(systemDotColor(true, universe.inhabited(hiro)))
                .toBe(SYSTEM_UNINHABITED_COLOR);
        });

    /**
     * The rival rule the reference screenshots cannot rule out — "a stellar
     * with a government counts as inhabited whatever 0x0020 says", which
     * would turn Heraan Hiro blue — is refuted by the stock data itself.
     * New Ireland's four NCB-swapped states keep gövt 144 throughout while
     * 0x0020 and the service bits move as the world is devastated and
     * rebuilt: under the rival rule the depopulated state would still draw
     * blue, and the whole arc would be invisible on the map.
     */
    it('refutes "a government overrides the uninhabited bit": New Ireland '
        + 'stays gövt 144 through its devastation, and only 0x0020 moves',
        () => {
            const states = [
                { system: 'nova:185', stellar: 'nova:139', uninhabited: false },
                { system: 'nova:762', stellar: 'nova:506', uninhabited: true },
                { system: 'nova:763', stellar: 'nova:507', uninhabited: false },
                { system: 'nova:764', stellar: 'nova:508', uninhabited: false },
            ];
            for (const state of states) {
                const tuatha = universe.system(state.system);
                expect(tuatha.name).toBe('Tuatha');
                expect(tuatha.planets).toEqual([state.stellar]);
                const newIreland = universe.planets.get(state.stellar)!;
                expect(newIreland.name).toBe('New Ireland');
                // The constant: the same government owns every state.
                expect(newIreland.govt).toBe('nova:144');
                expect(newIreland.flags.canLand).toBeTrue();
                // The variable: habitation, and with it the map dot.
                expect(newIreland.flags.uninhabited).toBe(state.uninhabited);
                expect(universe.inhabited(tuatha)).toBe(!state.uninhabited);
            }
        });

    it('has no stock stellar that is landable and uninhabited yet still '
        + 'offers a service — so no "services override 0x0020" rule is '
        + 'measurable, let alone needed', () => {
            const contradictions = [...universe.planets.values()].filter(p =>
                p.flags.canLand && p.flags.uninhabited
                && (p.flags.hasBar || p.flags.hasCommodityExchange
                    || p.flags.hasOutfitter || p.flags.hasShipyard));
            expect(contradictions.map(p => p.name)).toEqual([]);
        });

    it('is strictly narrower than the old "has any spöb" rule', () => {
        const withSpobs = universe.systems
            .filter(s => s.planets.length > 0);
        const withPorts = withSpobs.filter(s => universe.inhabited(s));
        // Sanity: the stock galaxy really does have a large body of
        // scenery-only systems the old rule painted blue.
        expect(withSpobs.length).toBeGreaterThan(withPorts.length);
        for (const s of withPorts) {
            expect(s.planets.length).toBeGreaterThan(0);
        }
    });
});

describe('star map inhabited coloring (Obatta / NGC-1317)', () => {
    it('draws Obatta grey in stock data — its only stellar is the '
        + 'uninhabited wormhole nova:468', async () => {
            const universe = await loadUniverse(await getIntegrationGameData());
            const obatta = universe.system('nova:155');
            expect(obatta.name).toBe('Obatta');
            expect(obatta.planets).toEqual(['nova:468']);
            const wormhole = universe.planets.get('nova:468')!;
            expect(wormhole.name).toBe('Wormhole');
            expect(wormhole.flags.canLand).toBeTrue();
            expect(wormhole.flags.uninhabited).toBeTrue();
            expect(universe.inhabited(obatta)).toBeFalse();
        }, 120_000);

    it('draws NGC-1317 grey in stock data — it has no stellars at all',
        async () => {
            const universe = await loadUniverse(await getIntegrationGameData());
            const ngc = universe.system('nova:500');
            expect(ngc.name).toBe('NGC-1317');
            expect(ngc.planets).toEqual([]);
            expect(universe.inhabited(ngc)).toBeFalse();
        }, 120_000);

    it('keeps NGC-1317 grey with ARPIA loaded: the wormhole it adds '
        + '(arpia:520) is landable but flagged uninhabited', async () => {
            const gameData = await getPluginGameData('arpia');
            if (!gameData) {
                pending('the arpia plug-in is not installed');
                return;
            }
            const universe = await loadUniverse(gameData);
            const ngc = universe.system('nova:500');
            expect(ngc.name).toBe('NGC-1317');
            expect(ngc.planets).toEqual(['arpia:520']);
            const wormhole = universe.planets.get('arpia:520')!;
            expect(wormhole.name).toBe('Wormhole');
            expect(wormhole.gate?.kind).toBe('wormhole');
            expect(wormhole.flags.canLand).toBeTrue();
            expect(wormhole.flags.uninhabited).toBeTrue();
            expect(universe.inhabited(ngc)).toBeFalse();
            expect(systemDotColor(true, universe.inhabited(ngc)))
                .toBe(SYSTEM_UNINHABITED_COLOR);
        }, 180_000);

    it('Obatta\'s Extra Outfits station IS a port by the data, so only the '
        + 'unexplored dimming keeps it off the map', async () => {
            const gameData = await getPluginGameData('extra-outfits');
            if (!gameData) {
                pending('the extra-outfits plug-in is not installed');
                return;
            }
            const universe = await loadUniverse(gameData);
            const obatta = universe.system('nova:155');
            expect(obatta.name).toBe('Obatta');
            expect(obatta.planets).toEqual(
                ['extra-outfits:800', 'extra-outfits:803', 'nova:468']);
            // Tektaara Station: landable, NOT flagged uninhabited, with an
            // outfitter and a bar. Nothing in the spöb data marks it secret.
            const station = universe.planets.get('extra-outfits:800')!;
            expect(station.name).toBe('Tektaara Station');
            expect(station.flags.canLand).toBeTrue();
            expect(station.flags.uninhabited).toBeFalse();
            expect(isPort(station.flags)).toBeTrue();
            expect(universe.inhabited(obatta)).toBeTrue();
            // ... so an explored Obatta is blue, and an unexplored one — the
            // state a player who has never been there is in — is dim.
            expect(systemDotColor(true, universe.inhabited(obatta)))
                .toBe(SYSTEM_INHABITED_COLOR);
            expect(systemDotColor(false, universe.inhabited(obatta)))
                .toBe(SYSTEM_UNEXPLORED_COLOR);
        }, 180_000);

    it('keeps a known inhabited system inhabited with both plug-ins loaded',
        async () => {
            const gameData = await getPluginGameData(
                ['extra-outfits', 'arpia']);
            if (!gameData) {
                pending('the extra-outfits / arpia plug-ins are not installed');
                return;
            }
            const universe = await loadUniverse(gameData);
            const sol = universe.system('nova:130');
            expect(sol.name).toBe('Sol');
            expect(universe.inhabited(sol)).toBeTrue();
            // And the two systems in question stay grey.
            expect(universe.inhabited(universe.system('nova:500'))).toBeFalse();
        }, 180_000);
});
