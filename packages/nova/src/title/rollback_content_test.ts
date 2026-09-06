import 'jasmine';
import {
    PILOT_FILE_NO_ESCORT, PILOT_FILE_WITH_ESCORT,
} from './fixtures/sample_pilot_files.js';
import { cloneJson, JsonValue } from './json_patch.js';
import { appendCheckpoint, PilotHistory } from './pilot_history.js';
import {
    checkpointBits, checkpointDetails, checkpointPath, checkpointSystem,
    controlBitsText, detailLines, RAW_NAMES, rollbackRows, RollbackNames,
} from './rollback_content.js';

const SAVE_A = (PILOT_FILE_WITH_ESCORT as { save: JsonValue }).save;
const SAVE_B = (PILOT_FILE_NO_ESCORT as { save: JsonValue }).save;

const NAMES: RollbackNames = {
    planetName: id => ({ 'nova:128': 'Earth', 'nova:129': 'Luna' } as
        Record<string, string>)[id],
    systemName: id => ({ 'nova:130': 'Sol', 'nova:131': 'Sirius',
        'nova:132': 'Vega' } as Record<string, string>)[id],
    systemOfPlanet: id => id === 'nova:128' || id === 'nova:129'
        ? 'nova:130' : undefined,
    outfitName: id => id === 'nova:137' ? 'Battery Pack' : undefined,
    shipName: id => id === 'nova:239' ? 'Fed Carrier' : undefined,
    missionName: id => `Mission ${id.split(':')[1]}`,
};

/** A four-checkpoint history: A@Sol, B@Sirius (mission), B@Vega, A@Sol. */
function sampleHistory(): PilotHistory {
    let h = appendCheckpoint(undefined, SAVE_A, {
        label: 'Departed Earth', kind: 'depart', system: 'nova:130',
        stellar: 'nova:128', date: { day: 1, month: 2, year: 1177 },
    });
    h = appendCheckpoint(h, SAVE_B, {
        label: 'Accepted: Mission 500', kind: 'mission', system: 'nova:131',
        date: { day: 3, month: 2, year: 1177 },
    });
    h = appendCheckpoint(h, SAVE_B, {
        label: 'Departed somewhere', kind: 'depart', system: 'nova:132',
    });
    h = appendCheckpoint(h, SAVE_A, {
        label: 'Bought Battery Pack ×1', kind: 'purchase', stellar: 'nova:129',
    });
    return h;
}

describe('rollback content', () => {
    it('lists checkpoints newest first with day, place and label', () => {
        const rows = rollbackRows(sampleHistory(), NAMES);
        expect(rows.map(r => r.index)).toEqual([3, 2, 1, 0]);
        expect(rows[3]).toEqual({
            index: 0, id: '1', day: '1 Feb 1177', place: 'Earth',
            label: 'Departed Earth', kind: 'depart',
        });
        // No stellar: the system names the place; no date: a dash.
        expect(rows[2].place).toBe('Sirius');
        expect(rows[1].day).toBe('—');
        // A stellar-only checkpoint still gets its place from the planet.
        expect(rows[0].place).toBe('Luna');
        expect(rollbackRows(undefined, NAMES)).toEqual([]);
    });

    it('falls back to raw ids without name data', () => {
        const rows = rollbackRows(sampleHistory(), RAW_NAMES);
        expect(rows[3].place).toBe('nova:128');
        expect(rows[2].place).toBe('nova:131');
    });

    it('resolves the map system: own system, else via stellar, else the save',
        () => {
            const h = sampleHistory();
            expect(checkpointSystem(h, 0, NAMES)).toBe('nova:130');
            expect(checkpointSystem(h, 3, NAMES)).toBe('nova:130');
            const bare = appendCheckpoint(undefined, SAVE_A, { label: 'x' });
            expect(checkpointSystem(bare, 0, NAMES))
                .toBe((SAVE_A as { data: { system: string } }).data.system);
        });

    it('resolves a stellar-only checkpoint\'s system under that checkpoint\'s '
        + 'bits, so a stacked stellar lands on the copy the map shows', () => {
            const h = sampleHistory();
            const seen: ReadonlySet<number>[] = [];
            const names: RollbackNames = {
                ...NAMES,
                systemOfPlanet: (id, bits) => {
                    seen.push(bits);
                    return NAMES.systemOfPlanet(id, bits);
                },
            };
            expect(checkpointSystem(h, 3, names)).toBe('nova:130');
            expect(seen.length).toBe(1);
            const expected = checkpointBits(h, 3);
            expect(expected.size).toBeGreaterThan(0);
            expect([...seen[0]].sort()).toEqual([...expected].sort());
        });

    it('builds the path of the previous checkpoints, nearest first, '
        + 'collapsing repeats and dropping the current system', () => {
            const h = sampleHistory();
            // From #3 (Sol): back through Vega, Sirius; #0 is Sol again but
            // Sol != Sirius so it is kept.
            expect(checkpointPath(h, 3, NAMES)).toEqual(
                ['nova:132', 'nova:131', 'nova:130']);
            expect(checkpointPath(h, 2, NAMES)).toEqual(['nova:131', 'nova:130']);
            expect(checkpointPath(h, 0, NAMES)).toEqual([]);
            expect(checkpointPath(h, 3, NAMES, 1)).toEqual(['nova:132']);
        });

    it('details a checkpoint from its save state', () => {
        const h = sampleHistory();
        const d = checkpointDetails(h, 0, NAMES);
        const data = (SAVE_A as { data: {
            credits: number, novaControlBits: [string, number][],
            escorts: unknown[], missions: [string, unknown][],
        } }).data;
        expect(d.label).toBe('Departed Earth');
        expect(d.day).toBe('1 Feb 1177');
        expect(d.place).toBe('Earth');
        expect(d.system).toBe('Sol');
        expect(d.ship).toBe('Fed Carrier');
        expect(d.credits).toBe(`${data.credits.toLocaleString()} cr`);
        expect(d.escortCount).toBe(data.escorts.length);
        expect(d.controlBits.length).toBe(data.novaControlBits.length);
        expect(d.controlBits).toEqual([...d.controlBits].sort((a, b) => a - b));
        expect(d.missions.length).toBe(data.missions.length);
        expect(d.missions.every(m => m.startsWith('Mission '))).toBeTrue();
        // Named outfits show their name; the rest their id; sorted by name.
        const battery = d.outfits.find(o => o.name === 'Battery Pack');
        expect(battery?.count).toBe(145);
        expect(d.outfits.map(o => o.name))
            .toEqual([...d.outfits.map(o => o.name)].sort(
                (a, b) => a.localeCompare(b)));
        // The first checkpoint has no previous one to diff missions against.
        expect(d.missionEvents).toEqual([]);
        expect(checkpointBits(h, 0).size).toBe(data.novaControlBits.length);
    });

    it('renders a checkpoint whose patch chain cannot be applied as an '
        + 'empty save rather than throwing out of the view (issue #91)', () => {
            const h = sampleHistory();
            // An imported history is validated for shape only, so a patch
            // can point into a container that does not exist.
            h.checkpoints[1].patch = [
                { op: 'replace', path: '/data/nowhere/deep/credits', value: 1 },
            ];
            const warn = spyOn(console, 'warn');
            expect(() => checkpointDetails(h, 1, NAMES)).not.toThrow();
            expect(() => checkpointDetails(h, 2, NAMES)).not.toThrow();
            expect(() => checkpointSystem(h, 2, NAMES)).not.toThrow();
            expect(() => rollbackRows(h, NAMES)).not.toThrow();
            expect(warn).toHaveBeenCalled();
            // The checkpoint before the break is untouched.
            expect(checkpointDetails(h, 0, NAMES).system).toBe('Sol');
            // The broken one falls back to its own metadata for the map.
            expect(checkpointSystem(h, 1, NAMES)).toBe('nova:131');
        });

    it('derives mission events from the checkpoint label and mission diff', () => {
        const h = sampleHistory();
        const d = checkpointDetails(h, 1, NAMES);
        expect(d.missionEvents[0]).toBe('Accepted: Mission 500');
        // SAVE_A -> SAVE_B changes the mission set; every change is listed
        // with a +/− prefix and a resolved name.
        const diffs = d.missionEvents.slice(1);
        expect(diffs.length).toBeGreaterThan(0);
        expect(diffs.every(e => /^[+−] Mission \d+$/.test(e))).toBeTrue();
        // An unchanged mission set (#2 = #1) yields nothing.
        expect(checkpointDetails(h, 2, NAMES).missionEvents).toEqual([]);
    });

    it('formats the detail lines and the collapsed bits line', () => {
        const d = checkpointDetails(sampleHistory(), 0, NAMES);
        const lines = detailLines(d);
        expect(lines[0]).toBe('Departed Earth');
        expect(lines[1]).toBe('1 Feb 1177 · Earth (Sol)');
        expect(lines[2]).toBe('Ship: Fed Carrier');
        expect(lines[3]).toMatch(/^Credits: .* cr$/);
        expect(lines.some(l => l.startsWith('Escorts: 1'))).toBeTrue();
        expect(lines.some(l => l.startsWith('Outfits (')
            && l.includes('Battery Pack ×145'))).toBeTrue();
        expect(lines.some(l => l.startsWith('Missions: '))).toBeTrue();
        expect(controlBitsText(d)).toMatch(/^Control bits \(\d+\): \d+( \d+)*$/);

        const empty = cloneJson(SAVE_A) as { data: Record<string, unknown> };
        empty.data.outfits = [];
        empty.data.missions = [];
        empty.data.novaControlBits = [];
        delete empty.data.escorts;
        const bare = checkpointDetails(
            appendCheckpoint(undefined, empty as JsonValue, { label: 'e' }),
            0, RAW_NAMES);
        expect(detailLines(bare)).toContain('Outfits: none');
        expect(detailLines(bare)).toContain('Missions: none');
        expect(controlBitsText(bare)).toBe('Control bits: none set');
    });
});
