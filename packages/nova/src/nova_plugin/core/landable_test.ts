import 'jasmine';
import { getDefaultPlanetData, PlanetData } from 'novadatainterface/planet_data';
import { getIntegrationGameData } from '../../communication/simulation_test_fixture.js';
import { novaDataInstalled, requireNovaData } from '../../test_support/nova_data_gate.js';
import {
    isInhabited, isPort, isSettledPort, landable, systemHasInhabitedStellar,
    systemIsInhabited, systemRefusesLanding,
} from './landable.js';

function planet(flags: Partial<PlanetData['flags']>): PlanetData {
    const base = getDefaultPlanetData();
    return { ...base, flags: { ...base.flags, ...flags } };
}

describe('landable', () => {
    it('is true for an ordinary port (spöb Flags 0x0001 set)', () => {
        expect(landable(planet({ canLand: true }))).toBeTrue();
    });

    it('is false without the can-land bit', () => {
        expect(landable(planet({ canLand: false }))).toBeFalse();
    });

    it('is false for a land-only-if-destroyed stellar, which nothing can '
        + 'destroy yet', () => {
            expect(landable(planet({
                canLand: true, landOnlyIfDestroyed: true,
            }))).toBeFalse();
        });
});

describe('isInhabited (spöb Flags 0x0020)', () => {
    it('is true when the uninhabited bit is CLEAR', () => {
        expect(isInhabited({ uninhabited: false })).toBeTrue();
    });

    it('is false when the uninhabited bit is SET', () => {
        expect(isInhabited({ uninhabited: true })).toBeFalse();
    });

    it('ignores landability entirely — the two bits are independent', () => {
        // Hel\'A\'Forius (nova:510) is exactly this shape in stock data.
        expect(isInhabited({ uninhabited: false })).toBeTrue();
    });
});

describe('isPort (landable AND inhabited)', () => {
    // The four flag combinations, each with a stock exemplar.
    it('admits a landable, inhabited stellar (Earth)', () => {
        expect(isPort({ canLand: true, uninhabited: false })).toBeTrue();
    });

    it('refuses a landable but UNINHABITED stellar (Pan, a wormhole)', () => {
        expect(isPort({ canLand: true, uninhabited: true })).toBeFalse();
    });

    it('refuses an inhabited but UNLANDABLE stellar (Hel\'A\'Forius)', () => {
        expect(isPort({ canLand: false, uninhabited: false })).toBeFalse();
    });

    it('refuses a stellar that is neither (Jupiter)', () => {
        expect(isPort({ canLand: false, uninhabited: true })).toBeFalse();
    });

    it('refuses a land-only-if-destroyed stellar', () => {
        expect(isPort({
            canLand: true, uninhabited: false, landOnlyIfDestroyed: true,
        })).toBeFalse();
    });

    it('treats an absent landOnlyIfDestroyed as clear, so mission_logic\'s '
        + 'already-resolved StellarInfo works unchanged', () => {
            expect(isPort({ canLand: true, uninhabited: false })).toBeTrue();
        });
});

describe('systemIsInhabited', () => {
    const port = planet({ canLand: true, uninhabited: false });
    const rock = planet({ canLand: true, uninhabited: true });
    const scenery = planet({ canLand: false, uninhabited: true });
    const lookup = (map: Record<string, PlanetData>) =>
        (id: string) => map[id];

    it('is false for a system with no stellars at all (Pollux)', () => {
        expect(systemIsInhabited([], lookup({}))).toBeFalse();
    });

    it('is false when every stellar is uninhabited (HJG-1034)', () => {
        expect(systemIsInhabited(['a', 'b'],
            lookup({ a: rock, b: scenery }))).toBeFalse();
    });

    it('is true as soon as ONE stellar is a port (Sol)', () => {
        expect(systemIsInhabited(['a', 'b', 'c'],
            lookup({ a: scenery, b: port, c: rock }))).toBeTrue();
    });

    it('skips stellars that do not resolve rather than counting them', () => {
        expect(systemIsInhabited(['missing'], lookup({}))).toBeFalse();
    });

    // Reference "Map dot colours, wave 23": VNP-001 (a working gate its
    // only stellar) and Vellos (gate + uninhabited planet) draw grey.
    const gate: PlanetData = {
        ...planet({ canLand: true, uninhabited: false, isStation: true }),
        gate: { kind: 'hypergate', destinations: ['x'], emergenceAngle: null },
    };
    const inhabitedWormhole: PlanetData = {
        ...planet({ canLand: true, uninhabited: false }),
        gate: { kind: 'wormhole', destinations: [], emergenceAngle: null },
    };

    it('does NOT count a working hypergate, which is still a port '
        + '(VNP-001, Vellos)', () => {
            expect(isPort(gate.flags)).toBeTrue();
            expect(isSettledPort(gate)).toBeFalse();
            expect(systemIsInhabited(['g'], lookup({ g: gate }))).toBeFalse();
            expect(systemIsInhabited(['g', 'r'],
                lookup({ g: gate, r: rock }))).toBeFalse();
        });

    it('a gate beside a settled port leaves the system inhabited (Kania)',
        () => {
            expect(systemIsInhabited(['g', 'p'],
                lookup({ g: gate, p: port }))).toBeTrue();
        });

    it('treats an inhabited wormhole like the gate (GUESS; no stock one)',
        () => {
            expect(isSettledPort(inhabitedWormhole)).toBeFalse();
        });
});

describe('systemRefusesLanding (the orange / red dot)', () => {
    const port = planet({ canLand: true, uninhabited: false });
    const rock = planet({ canLand: true, uninhabited: true });
    const gate: PlanetData = {
        ...planet({ canLand: true, uninhabited: false, isStation: true }),
        gate: { kind: 'hypergate', destinations: ['x'], emergenceAngle: null },
    };
    const lookup = (map: Record<string, PlanetData>) =>
        (id: string) => map[id];
    const refusing = (ids: string[]) => (id: string) => ids.includes(id);

    it('is true when the only port refuses (Kit Map Wanted, measured)', () => {
        expect(systemRefusesLanding(['a'], lookup({ a: port }),
            refusing(['a']))).toBeTrue();
    });

    it('is false when any settled port lets the player land (Kit Map Mixed, '
        + 'measured in wave 24)',
        () => {
            expect(systemRefusesLanding(['a', 'b'],
                lookup({ a: port, b: port }), refusing(['a']))).toBeFalse();
        });

    it('never asks a gate or an uninhabited stellar, and is false with no '
        + 'settled port to refuse', () => {
            const asked: string[] = [];
            const refuses = (id: string) => { asked.push(id); return true; };
            expect(systemRefusesLanding(['g', 'r'],
                lookup({ g: gate, r: rock }), refuses)).toBeFalse();
            expect(asked).toEqual([]);
            // A refusing port beside a (refusing) gate: red, the gate not asked.
            expect(systemRefusesLanding(['g', 'a'],
                lookup({ g: gate, a: port }), refuses)).toBeTrue();
            expect(asked).toEqual(['a']);
            expect(systemRefusesLanding([], lookup({}), refuses)).toBeFalse();
        });
});

describe('systemHasInhabitedStellar (the Show Borders rule)', () => {
    const port = planet({ canLand: true, uninhabited: false });
    // Reference experiments M5: sÿst 2156's stellar, Flags 0x0002.
    const unlandableInhabited = planet({ canLand: false, uninhabited: false });
    const rock = planet({ canLand: true, uninhabited: true });
    const scenery = planet({ canLand: false, uninhabited: true });
    const lookup = (map: Record<string, PlanetData>) =>
        (id: string) => map[id];

    it('is false for a system with no stellars (sÿst 2155 Map B Empty)', () => {
        expect(systemHasInhabitedStellar([], lookup({}))).toBeFalse();
    });

    it('is TRUE for an inhabited stellar that cannot be landed on (sÿst 2156 '
        + 'Map B Unland), where the blue-dot rule says no port', () => {
            const system = lookup({ a: unlandableInhabited });
            expect(systemHasInhabitedStellar(['a'], system)).toBeTrue();
            expect(systemIsInhabited(['a'], system)).toBeFalse();
        });

    it('is true for a port', () => {
        expect(systemHasInhabitedStellar(['a'], lookup({ a: port })))
            .toBeTrue();
    });

    it('is false when every stellar is uninhabited, landable or not', () => {
        expect(systemHasInhabitedStellar(['a', 'b'],
            lookup({ a: rock, b: scenery }))).toBeFalse();
    });

    it('skips stellars that do not resolve', () => {
        expect(systemHasInhabitedStellar(['missing'], lookup({}))).toBeFalse();
    });
});

describe('landable against real Nova data', () => {
    let planets: PlanetData[];
    beforeEach(requireNovaData);
    beforeAll(async () => {
        if (!novaDataInstalled()) return; // each spec pends instead
        const gameData = await getIntegrationGameData();
        const ids = await gameData.ids;
        planets = await Promise.all(
            ids.Planet.map(id => gameData.data.Planet.get(id)));
    }, 60_000);

    it('refuses Jupiter, which the original never lets you land on', () => {
        const jupiter = planets.find(p => p.id === 'nova:159')!;
        expect(jupiter.name).toBe('Jupiter');
        expect(landable(jupiter)).toBeFalse();
    });

    it('refuses every destroyed hypergate and admits every working one',
        () => {
            const gates = planets.filter(p => p.gate?.kind === 'hypergate');
            // The stock network: 16 destroyed gates (no HyperLinks at all)
            // and the working ones, which all have destinations.
            const dead = gates.filter(g => !landable(g));
            const alive = gates.filter(g => landable(g));
            expect(dead.length).toBe(16);
            expect(alive.length).toBeGreaterThan(0);
            for (const gate of dead) {
                expect(gate.gate!.destinations.length)
                    .withContext(`${gate.id} ${gate.name}`).toBe(0);
            }
            for (const gate of alive) {
                expect(gate.gate!.destinations.length)
                    .withContext(`${gate.id} ${gate.name}`)
                    .toBeGreaterThan(0);
            }
            // The named ones from the collapsed network.
            expect(dead.map(g => g.id)).toContain('nova:130'); // HG-Aldebaran
            expect(dead.map(g => g.id)).toContain('nova:131'); // HG-Vega
            expect(alive.map(g => g.id)).toContain('nova:1400'); // HG-V01
        });

    it('counts a working hypergate as a PORT, as the original\'s Kania '
        + 'readout ("Ports: Port Kane, HG-Kania") does', () => {
            const hgKania = planets.find(p => p.id === 'nova:1404')!;
            expect(hgKania.name).toBe('HG-Kania');
            expect(hgKania.gate?.kind).toBe('hypergate');
            expect(isPort(hgKania.flags)).toBeTrue();
            // Every working gate carries the same flags, so the readout
            // lists them all (landable.ts isPort) — though none of them
            // makes its system inhabited (isSettledPort, wave 23).
            // (Stock ids only: the fixture may carry plug-ins.)
            const stock = planets.filter(p => p.id.startsWith('nova:'));
            const working = stock.filter(p =>
                p.gate?.kind === 'hypergate' && landable(p));
            expect(working.length).toBe(19);
            for (const gate of working) {
                expect(isPort(gate.flags))
                    .withContext(`${gate.id} ${gate.name}`).toBeTrue();
                expect(isSettledPort(gate))
                    .withContext(`${gate.id} ${gate.name}`).toBeFalse();
            }
            // And no stock wormhole is a port: each sets 0x0020.
            for (const worm of stock.filter(p =>
                p.gate?.kind === 'wormhole')) {
                expect(isPort(worm.flags))
                    .withContext(`${worm.id} ${worm.name}`).toBeFalse();
            }
        });

    it('admits an ordinary port', () => {
        const earth = planets.find(p => p.id === 'nova:128')!;
        expect(earth.name).toBe('Earth');
        expect(landable(earth)).toBeTrue();
    });
});
