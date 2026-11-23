import 'jasmine';
import { getIntegrationGameData } from '../communication/simulation_test_fixture.js';
import { novaDataInstalled, requireNovaData } from '../test_support/nova_data_gate.js';
import {
    MINOR_TERRITORY_SCALE, TERRITORY_FLAT_RADIUS, TERRITORY_OUTER_RADIUS,
    territoryColorAt, territoryDiscs, territoryShade, TerritorySite,
} from './starmap_borders.js';
import { BASE_SCALE } from './starmap_viewport.js';

/** gövt 128 Federation's Color, and what the original shades it to. */
const FEDERATION = 0x2c2caf;
const FEDERATION_FULL = 0x101052;
const AURORAN = 0xcf0c0c;

/** A site at map position (x, y) in map units. */
function site(x: number, y: number, color = FEDERATION,
    minor = false): TerritorySite {
    return { x: x * BASE_SCALE, y: y * BASE_SCALE, color, minor };
}

/** The painted colour at map position (x, y) in map units. */
function colorAt(sites: TerritorySite[], x: number, y: number): number {
    return territoryColorAt(territoryDiscs(sites), x * BASE_SCALE,
        y * BASE_SCALE);
}

const blue = (color: number) => color & 0xff;

describe('government territory (Show Borders)', () => {
    it('shades a gövt Color to half strength on a 5-bit screen', () => {
        // govt_borders.png: the Federation's #2c2caf fills as #101052.
        expect(territoryShade(FEDERATION, 1)).toBe(FEDERATION_FULL);
        expect(territoryShade(FEDERATION, 0)).toBe(0);
    });

    it('is flat out to the inner radius and gone at the outer one', () => {
        const fed = [site(0, 0)];
        expect(colorAt(fed, 0, 0)).toBe(FEDERATION_FULL);
        expect(colorAt(fed, TERRITORY_FLAT_RADIUS - 0.1, 0))
            .toBe(FEDERATION_FULL);
        expect(colorAt(fed, 0, TERRITORY_OUTER_RADIUS + 0.1)).toBe(0);
        // In between, the blue channel walks down one 5-bit step at a time.
        let previous = blue(FEDERATION_FULL);
        const seen = new Set<number>();
        for (let d = TERRITORY_FLAT_RADIUS; d <= TERRITORY_OUTER_RADIUS;
            d += 0.25) {
            const value = blue(colorAt(fed, d, 0));
            expect(value).toBeLessThanOrEqual(previous);
            previous = value;
            seen.add(value);
        }
        // #52 #4a #42 #39 #31 #29 #21 #18 #10 #08 #00: every level shows.
        expect([...seen].sort((a, b) => b - a)).toEqual(
            [0x52, 0x4a, 0x42, 0x39, 0x31, 0x29, 0x21, 0x18, 0x10, 0x08, 0]);
    });

    it('takes the strongest claim where territory overlaps, not the sum',
        () => {
            // Two systems 90 units apart: midway, each is 45 units off and
            // the channel between them is just that falloff (the dark
            // channel between Journey's End and Archenar).
            const pair = [site(0, 0), site(90, 0)];
            expect(colorAt(pair, 45, 0)).toBe(colorAt([site(0, 0)], 45, 0));
            expect(colorAt(pair, 45, 0)).not.toBe(FEDERATION_FULL);
        });

    it('splits two major governments where their strengths meet', () => {
        const sites = [site(0, 0), site(80, 0, AURORAN)];
        expect(colorAt(sites, 30, 0)).toBe(FEDERATION_FULL);
        expect(colorAt(sites, 50, 0)).toBe(territoryShade(AURORAN, 1));
    });

    it('draws a minor government smaller, and under every major one', () => {
        // Wild Geese (gövt 144, minor, #003300) at Tuatha.
        const geese = 0x003300;
        const alone = [site(0, 0, geese, true)];
        expect(colorAt(alone, 0, 0)).toBe(territoryShade(geese, 1));
        expect(colorAt(alone,
            TERRITORY_OUTER_RADIUS * MINOR_TERRITORY_SCALE + 0.1, 0)).toBe(0);
        // Inside Federation space it does not show at all: the capture has
        // no green anywhere, Tuatha included.
        const beside = [site(0, 0, geese, true), site(40, 0)];
        expect(colorAt(beside, 0, 0)).toBe(colorAt([site(40, 0)], 0, 0));
        // Whatever order the sites come in: every minor disc is painted
        // before the first major one.
        const discs = territoryDiscs([site(40, 0), site(0, 0, geese, true)]);
        const firstMajor = discs.findIndex(d => !d.minor);
        expect(firstMajor).toBeGreaterThan(0);
        expect(discs.slice(firstMajor).every(d => !d.minor)).toBeTrue();
    });
});

/**
 * The same model against the reference capture itself:
 * ui_screenshots/original_macos_screenshots/map/govt_borders.png, the star
 * map at Sol, 1920x1080, drawn at ~1.778 px per map unit with Sol at
 * (898, 502). The territory comes from the explored, INHABITED systems of
 * that pilot (every blue dot in view) plus the two explored minor-gövt
 * systems; the light-grey HJG-1034 and Procyon are explored but have no
 * port and claim nothing. Each reference pixel below sits where only the
 * shading is drawn (black in borders_off.png).
 */
describe('government territory against govt_borders.png', () => {
    const SCALE = 1.778;
    const SOL_PX = { x: 898, y: 502 };
    // Stock sÿst ids. The stacked NCB copies at Sol / Nesre Secundus /
    // Tuatha share their position with these.
    const MAJOR = [
        'nova:134' /* Kerella */, 'nova:187' /* Journey's End */,
        'nova:142' /* Archenar */, 'nova:177' /* Hannaford */,
        'nova:130' /* Sol */, 'nova:170' /* Porto Rillia */,
        'nova:132' /* Nesre Primus */, 'nova:138' /* Arcturus */,
        'nova:151' /* Galvan */, 'nova:184' /* Moonrise */,
        'nova:143' /* Tau Ceti */, 'nova:179' /* Merrynne */,
        'nova:129' /* Tichel */,
    ];
    const MINOR = ['nova:133' /* Nesre Secundus */, 'nova:185' /* Tuatha */];
    // [x, y, reference RGB]
    const REFERENCE: [number, number, number][] = [
        [898, 520, 0x101052], // between Sol and Tau Ceti: full strength
        [797, 486, 0x000018], // the channel by unexplored HJG-0637
        [715, 538, 0x080829], // west of Nesre Secundus (minor: no claim)
        [740, 538, 0x10104a],
        [898, 621, 0x10104a], // the fade south of Merrynne
        [898, 657, 0x000018],
        [898, 690, 0x000000], // beyond every system's reach
        [1000, 480, 0x101052],
        [690, 560, 0x000010], // where uninhabited HJG-1034 would reach
        [774, 655, 0x080839], // just south of Tuatha (minor): no green
        [760, 330, 0x000010],
        [1040, 600, 0x10104a],
    ];
    let sites: TerritorySite[];

    beforeEach(requireNovaData);
    beforeAll(async () => {
        if (!novaDataInstalled()) return; // each spec pends instead
        const gameData = await getIntegrationGameData();
        const load = async (id: string, minor: boolean) => {
            const system = await gameData.data.System.get(id);
            const govt = await gameData.data.Govt.get(system.govt!);
            // The capture's assumption, checked against the data.
            expect(govt.flags2.minorMapBoundaries).withContext(id).toBe(minor);
            return {
                x: system.position[0] * BASE_SCALE,
                y: system.position[1] * BASE_SCALE,
                color: govt.color & 0xffffff,
                minor,
            };
        };
        sites = await Promise.all([
            ...MAJOR.map(id => load(id, false)),
            ...MINOR.map(id => load(id, true)),
        ]);
    });

    it('matches every sampled pixel to within one 5-bit step', () => {
        const discs = territoryDiscs(sites);
        for (const [px, py, expected] of REFERENCE) {
            const x = (px - SOL_PX.x) / SCALE * BASE_SCALE;
            const y = (py - SOL_PX.y) / SCALE * BASE_SCALE;
            const actual = territoryColorAt(discs, x, y);
            for (const shift of [16, 8, 0]) {
                expect(Math.abs(((actual >> shift) & 0xff)
                    - ((expected >> shift) & 0xff)))
                    .withContext(`(${px},${py}) channel ${shift}: `
                        + `${actual.toString(16)} vs ${expected.toString(16)}`)
                    .toBeLessThanOrEqual(9);
            }
        }
    });
});
