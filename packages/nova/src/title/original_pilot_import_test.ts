import 'jasmine';
import { parsePilotResources } from 'novaparse/pilot/pilot_parse';
import {
    buildMacPilotBlobs, buildPltPilotFile, SYNTHETIC,
} from 'novaparse/pilot/synthetic_pilot';
import { simpleCrypt } from 'novaparse/pilot/simple_crypt';
import { dayNumber } from '../nova_plugin/calendar.js';
import { decodeSave } from '../nova_plugin/save_game.js';
import { PrefsStorage } from './client_prefs.js';
import {
    convertOriginalPilot, convertOriginalPilotBytes, looksLikeOriginalPilot,
    OriginalPilotContext,
} from './original_pilot_import.js';
import { checkpointState, loadHistory } from './pilot_history.js';
import { importOriginalPilot, listPilots } from './pilot_registry.js';

class MemoryStorage implements PrefsStorage {
    private map = new Map<string, string>();
    getItem(key: string) { return this.map.get(key) ?? null; }
    setItem(key: string, value: string) { this.map.set(key, value); }
    removeItem(key: string) { this.map.delete(key); }
}

/**
 * A context that knows the synthetic pilot's resources: its ship (shïp
 * 128 + 204 = 332), outfit 164, mission 474, rank 131, and puts stellar
 * 138 in system 'nova:130' (Federation).
 */
const CTX: OriginalPilotContext = {
    knownShip: id => id === 'nova:332',
    knownOutfit: id => id === 'nova:164',
    knownMission: id => id === 'nova:474',
    knownRank: id => id === 'nova:131',
    knownJunk: () => false,
    systemOfPlanet: id => id === 'nova:138' ? 'nova:130' : undefined,
    govtOfSystem: id => id === 'nova:135' ? 'nova:128' : null,
    fallbackSystem: 'nova:999',
};

const S = SYNTHETIC;

describe('original pilot import', () => {
    it('sniffs JSON pilot files apart from binary ones', () => {
        const enc = new TextEncoder();
        expect(looksLikeOriginalPilot(enc.encode('{"format":"novajs-pilot"}')))
            .toBeFalse();
        expect(looksLikeOriginalPilot(enc.encode('  \n{}'))).toBeFalse();
        expect(looksLikeOriginalPilot(new Uint8Array([0xef, 0xbb, 0xbf, 0x7b])))
            .toBeFalse();
        expect(looksLikeOriginalPilot(buildPltPilotFile('Ring'))).toBeTrue();
        expect(looksLikeOriginalPilot(new Uint8Array(0))).toBeTrue();
    });

    it('round-trips the SimpleCrypt scramble', () => {
        const plain = new Uint8Array(1002).map((_, i) => (i * 7) & 0xff);
        const scrambled = simpleCrypt(plain);
        expect(scrambled).not.toEqual(plain);
        expect(simpleCrypt(scrambled)).toEqual(plain);
    });

    it('converts a synthetic Windows .plt pilot', () => {
        const { save, profile, notes } = convertOriginalPilotBytes(
            buildPltPilotFile('Ring of Glory'), 'Cade Connelly.plt', CTX);
        expect(save.ship).toBe('nova:332');
        expect(save.outfits).toEqual([['nova:164', 3]]);
        expect(save.system).toBe('nova:130');
        expect(save.credits).toBe(S.cash);
        expect(save.date).toEqual({ year: S.year, month: S.month, day: S.day });
        // Control bits as bare numbers into the legacy field.
        expect(save.novaControlBits).toEqual([[String(S.missionBit), 1]]);
        expect(save.ranks).toEqual(['nova:131']);
        expect(save.combatRatings).toEqual([['kills', S.rating]]);
        expect(save.cargo).toEqual([
            ['cargo:0', 1], ['cargo:1', 2], ['cargo:2', 3],
            ['cargo:3', 4], ['cargo:4', 5], ['cargo:5', 6],
        ]);
        // legalStatus[7] = -20 -> system nova:135 -> gövt nova:128.
        expect(save.reputations).toEqual([['nova:128', -20]]);
        // The .plt builder leaves mission slot 0 active but blank
        // (missionId -1): unknown mission -> skipped with a note.
        expect(save.missions).toEqual([]);
        expect(notes.some(n => /1 active mission could not/.test(n))).toBeTrue();
        expect(notes.some(n => /1 escort/.test(n))).toBeTrue();
        // Profile: the file's name stands in for the pilot's; the rest is
        // the globals blob.
        expect(profile).toEqual({
            name: 'Cade Connelly', nickname: S.nickname, gender: 'male',
            strict: false,
        });
        // And it is a save this build accepts.
        expect(decodeSave(JSON.stringify({ version: 2, data: save })))
            .toBeDefined();
    });

    it('imports an active mission without special ships from a Mac pilot',
        () => {
            // The Mac builder fills mission slot 0 (mïsn 474, no special
            // ships); present its blobs the way a resource map does.
            const { player, globals } = buildMacPilotBlobs();
            const parsed = parsePilotResources({
                'NpïL': {
                    128: { data: new DataView(player.buffer), name: 'Pilot Data' },
                    129: { data: new DataView(globals.buffer), name: 'Ring' },
                },
            } as unknown as Parameters<typeof parsePilotResources>[0]);
            const { save, notes } = convertOriginalPilot(parsed, 'Fed', CTX);
            expect(save.missions!.length).toBe(1);
            const [id, mission] = save.missions![0];
            expect(id).toBe('nova:474');
            expect(mission.travelPlanet).toBe('nova:140');   // 12 + 128
            expect(mission.returnPlanet).toBe('nova:162');   // 34 + 128
            expect(mission.travelDone).toBeTrue();
            expect(mission.cargoLoaded).toBeFalse();
            const today = dayNumber({ year: S.year, month: S.month, day: S.day });
            expect(mission.acceptedDay).toBe(today);
            expect(mission.acceptedAt).toBe('nova:138');
            expect(mission.deadlineDay).toBe(today + 27);
            expect(notes.some(n => /mission/.test(n) && /could not/.test(n)))
                .toBeFalse();
        });

    it('falls back to the default system for an unknown last stellar', () => {
        const ctx = { ...CTX, systemOfPlanet: () => undefined };
        const { save, notes } = convertOriginalPilotBytes(
            buildPltPilotFile('x'), 'p.plt', ctx);
        expect(save.system).toBe('nova:999');
        expect(notes.some(n => /Last stellar/.test(n))).toBeTrue();
    });

    it('registers the pilot with an "Imported from EV Nova pilot" checkpoint',
        () => {
            const store = new MemoryStorage();
            const result = importOriginalPilot(buildPltPilotFile('Ring'),
                'Goroth Obarskyr.plt', CTX, store);
            expect(result.ok).toBeTrue();
            if (!result.ok) { return; }
            expect(result.pilot.name).toBe('Goroth Obarskyr');
            expect(result.pilot.profile?.nickname).toBe(S.nickname);
            expect(listPilots(store).length).toBe(1);
            const save = decodeSave(store.getItem(result.pilot.saveKey))!;
            expect(save.ship).toBe('nova:332');
            const history = loadHistory(result.pilot.saveKey, store)!;
            expect(history.checkpoints.map(c => c.label))
                .toEqual(['Imported from EV Nova pilot']);
            expect(history.checkpoints[0].kind).toBe('import');
            expect(history.checkpoints[0].system).toBe('nova:130');
            expect(history.checkpoints[0].stellar).toBe('nova:138');
            expect(JSON.stringify(checkpointState(history, 0)))
                .toBe(store.getItem(result.pilot.saveKey)!);
        });

    it('refuses garbage and explains an empty (Mac data-fork) file', () => {
        const store = new MemoryStorage();
        const bad = importOriginalPilot(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]),
            'x.plt', CTX, store);
        expect(bad.ok).toBeFalse();
        if (bad.ok) { return; }
        expect(bad.reason).toMatch(/Not an EV Nova pilot/);
        const empty = importOriginalPilot(new Uint8Array(0), 'Fed', CTX, store);
        expect(empty.ok).toBeFalse();
        if (empty.ok) { return; }
        expect(empty.reason).toMatch(/resource fork/);
        expect(listPilots(store)).toEqual([]);
    });
});
