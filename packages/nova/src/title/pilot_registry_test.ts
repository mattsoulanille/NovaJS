import 'jasmine';
import { discoveryKeyFor } from '../nova_plugin/player/discovery_store.js';
import {
    encodeSave, getActiveSaveKey, quarantineKeyFor, resetSave, SAVE_KEY,
    SaveData, setActiveSaveKey,
} from '../nova_plugin/session/save_game.js';
import { saveDefaults } from '../nova_plugin/session/save_migrations.js';
import {
    CONTROLS_OVERRIDE_KEY, PILOT_PROFILE_KEY, PilotProfile, PrefsStorage,
} from './client_prefs.js';
import {
    checkpointState, historyKeyFor, historyQuarantineKeyFor, loadHistory,
    recordCheckpoint,
} from './pilot_history.js';
import {
    applyActivePilot, createPilot, deletePilot, exportCheckpointFile,
    exportFileName, exportPilot, getActivePilot, importPilot, listPilots,
    loadPilotControls, loadRegistry, PILOT_REGISTRY_KEY,
    PILOT_REGISTRY_QUARANTINE_KEY, PILOT_SAVE_KEY_PREFIX, savePilotControls,
    selectPilot, uniquePilotName,
} from './pilot_registry.js';

/** An in-memory PrefsStorage for testing without a browser. */
class MemoryStorage implements PrefsStorage {
    private map = new Map<string, string>();
    getItem(key: string) { return this.map.get(key) ?? null; }
    setItem(key: string, value: string) { this.map.set(key, value); }
    removeItem(key: string) { this.map.delete(key); }
    raw(key: string) { return this.map.get(key); }
    has(key: string) { return this.map.has(key); }
    keys() { return [...this.map.keys()]; }
}

const SAMPLE_SAVE: SaveData = {
    ...saveDefaults(),
    ship: 'nova:128',
    outfits: [['nova:200', 2]],
    system: 'nova:130',
    credits: 12345,
};

/** A second, distinguishable save payload. */
const OTHER_SAVE: SaveData = {
    ...saveDefaults(),
    ship: 'nova:129',
    outfits: [],
    system: 'nova:131',
    credits: 999,
};

function profile(name: string): PilotProfile {
    return { name, nickname: 'Ace', gender: 'male', strict: false };
}

describe('pilot registry', () => {
    // The active save key is module-level state in save_game; keep each
    // spec independent of the order jasmine happens to run them in.
    afterEach(() => setActiveSaveKey(SAVE_KEY));

    describe('creation and selection', () => {
        it('starts empty when there is nothing to migrate', () => {
            const store = new MemoryStorage();
            expect(listPilots(store)).toEqual([]);
            expect(getActivePilot(store)).toBeUndefined();
        });

        it('creates a pilot, makes it active, and gives it its own key', () => {
            const store = new MemoryStorage();
            const pilot = createPilot(profile('Shane Merrol'), store);
            expect(pilot.name).toBe('Shane Merrol');
            expect(pilot.saveKey).toBe(`${PILOT_SAVE_KEY_PREFIX}${pilot.id}`);
            expect(getActivePilot(store)?.id).toBe(pilot.id);
            expect(getActiveSaveKey()).toBe(pilot.saveKey);
        });

        it('never mints a save key whose slot already holds a save', () => {
            // A quarantined (or never-written) registry leaves saves behind
            // that no record points at. Minting that id again would hand
            // the new pilot a stranger's game — and the new-pilot path
            // clears the slot it is given.
            jasmine.clock().install();
            try {
                const now = 1_700_000_000_000;
                jasmine.clock().mockDate(new Date(now));
                const store = new MemoryStorage();
                const orphanKey =
                    `${PILOT_SAVE_KEY_PREFIX}${now.toString(36)}`;
                store.setItem(orphanKey, encodeSave(SAMPLE_SAVE));

                const pilot = createPilot(profile('New Guy'), store);

                expect(pilot.saveKey).not.toBe(orphanKey);
                expect(store.raw(orphanKey)).toBe(encodeSave(SAMPLE_SAVE));
            } finally {
                jasmine.clock().uninstall();
            }
        });

        it('does not import a pilot onto an occupied save slot', () => {
            jasmine.clock().install();
            try {
                const now = 1_700_000_000_001;
                jasmine.clock().mockDate(new Date(now));
                const store = new MemoryStorage();
                const orphanKey =
                    `${PILOT_SAVE_KEY_PREFIX}${now.toString(36)}`;
                store.setItem(orphanKey, encodeSave(SAMPLE_SAVE));

                const source = new MemoryStorage();
                const other = createPilot(profile('Imported'), source);
                source.setItem(other.saveKey, encodeSave(OTHER_SAVE));
                const text = exportPilot(other.id, source)!;
                const result = importPilot(text, store);

                expect(result.ok).toBe(true);
                expect(store.raw(orphanKey)).toBe(encodeSave(SAMPLE_SAVE));
            } finally {
                jasmine.clock().uninstall();
            }
        });

        it('keeps each pilot on a separate save key', () => {
            const store = new MemoryStorage();
            const a = createPilot(profile('Alpha'), store);
            const b = createPilot(profile('Beta'), store);
            expect(a.saveKey).not.toBe(b.saveKey);
            expect(listPilots(store).length).toBe(2);
        });

        it('switches the active save key when a pilot is selected', () => {
            const store = new MemoryStorage();
            const a = createPilot(profile('Alpha'), store);
            const b = createPilot(profile('Beta'), store);
            expect(getActiveSaveKey()).toBe(b.saveKey);
            selectPilot(a.id, store);
            expect(getActiveSaveKey()).toBe(a.saveKey);
            expect(getActivePilot(store)?.name).toBe('Alpha');
        });

        it('returns undefined when selecting an unknown pilot', () => {
            const store = new MemoryStorage();
            expect(selectPilot('nope', store)).toBeUndefined();
        });

        it('deletes a pilot and its save data', () => {
            const store = new MemoryStorage();
            const a = createPilot(profile('Alpha'), store);
            const b = createPilot(profile('Beta'), store);
            store.setItem(a.saveKey, encodeSave(SAMPLE_SAVE));
            recordCheckpoint(a.saveKey, JSON.parse(encodeSave(SAMPLE_SAVE)),
                { label: 'x' }, store);
            // The pilot's other per-save keys: the discovery record and a
            // quarantined unreadable save. Both used to be orphaned
            // (review finding #77).
            store.setItem(discoveryKeyFor(a.saveKey),
                JSON.stringify([['nova:130', 2]]));
            store.setItem(quarantineKeyFor(a.saveKey), 'not a save');
            // Another pilot's keys are not touched.
            store.setItem(discoveryKeyFor(b.saveKey),
                JSON.stringify([['nova:131', 1]]));
            deletePilot(a.id, store);
            expect(listPilots(store).map(p => p.name)).toEqual(['Beta']);
            expect(store.has(a.saveKey)).toBeFalse();
            expect(store.has(historyKeyFor(a.saveKey))).toBeFalse();
            expect(store.has(discoveryKeyFor(a.saveKey))).toBeFalse();
            expect(store.has(quarantineKeyFor(a.saveKey))).toBeFalse();
            expect(store.has(discoveryKeyFor(b.saveKey))).toBeTrue();
            // Deleting the active pilot falls back to a remaining one.
            expect(getActivePilot(store)?.id).toBe(b.id);
        });

        it('deletes a pilot\'s quarantined history too', () => {
            // loadHistory parks an unreadable history at
            // <saveKey>:history:quarantine; a deleted pilot's bytes must
            // not survive there (PR #239 review finding F2).
            const store = new MemoryStorage();
            const a = createPilot(profile('Alpha'), store);
            store.setItem(historyKeyFor(a.saveKey), '{not json');
            spyOn(console, 'warn');
            expect(loadHistory(a.saveKey, store)).toBeUndefined();
            expect(store.has(historyQuarantineKeyFor(a.saveKey))).toBeTrue();
            deletePilot(a.id, store);
            expect(store.has(historyQuarantineKeyFor(a.saveKey))).toBeFalse();
            expect(store.keys().filter(k => k.startsWith(a.saveKey))).toEqual([]);
        });

        it('disambiguates duplicate names', () => {
            expect(uniquePilotName('Ace', [])).toBe('Ace');
            const store = new MemoryStorage();
            createPilot(profile('Ace'), store);
            const second = createPilot(profile('Ace'), store);
            expect(second.name).toBe('Ace (2)');
        });
    });

    describe('legacy migration', () => {
        it('adopts an existing single save as the first pilot', () => {
            const store = new MemoryStorage();
            store.setItem(SAVE_KEY, encodeSave(SAMPLE_SAVE));
            store.setItem(PILOT_PROFILE_KEY,
                JSON.stringify(profile('Old Timer')));
            const pilots = listPilots(store);
            expect(pilots.length).toBe(1);
            expect(pilots[0].name).toBe('Old Timer');
            // The whole point: the legacy save is adopted IN PLACE.
            expect(pilots[0].saveKey).toBe(SAVE_KEY);
            expect(store.raw(SAVE_KEY)).toBe(encodeSave(SAMPLE_SAVE));
        });

        it('carries the legacy control overrides onto that pilot', () => {
            const store = new MemoryStorage();
            store.setItem(SAVE_KEY, encodeSave(SAMPLE_SAVE));
            store.setItem(CONTROLS_OVERRIDE_KEY,
                JSON.stringify({ accelerate: 'KeyW' }));
            const pilots = listPilots(store);
            expect(pilots[0].controls).toEqual({ accelerate: 'KeyW' });
        });

        it('migrates a profile even with no save yet', () => {
            const store = new MemoryStorage();
            store.setItem(PILOT_PROFILE_KEY, JSON.stringify(profile('Rookie')));
            expect(listPilots(store).map(p => p.name)).toEqual(['Rookie']);
        });

        it('migrates only once', () => {
            const store = new MemoryStorage();
            store.setItem(SAVE_KEY, encodeSave(SAMPLE_SAVE));
            listPilots(store);
            const second = createPilot(profile('New One'), store);
            expect(listPilots(store).length).toBe(2);
            expect(second.saveKey).not.toBe(SAVE_KEY);
        });

        it('names the migrated pilot when no profile exists', () => {
            const store = new MemoryStorage();
            store.setItem(SAVE_KEY, encodeSave(SAMPLE_SAVE));
            expect(listPilots(store)[0].name).toBe('Pilot');
        });

        it('leaves the adopted legacy save alone on the new-pilot path',
            () => {
                // The browser's "New Pilot" button runs createPilot and
                // then clears the fresh pilot's slot. That clear must never
                // reach the legacy save the migration just adopted in
                // place, so pin what makes it safe: the new pilot is a
                // SEPARATE record on its own key, and it — not the legacy
                // pilot — is what the save layer is pointed at.
                const store = new MemoryStorage();
                store.setItem(SAVE_KEY, encodeSave(SAMPLE_SAVE));
                store.setItem(PILOT_PROFILE_KEY,
                    JSON.stringify(profile('Old Timer')));

                const created = createPilot(profile('New Guy'), store);

                expect(created.saveKey).not.toBe(SAVE_KEY);
                expect(getActiveSaveKey()).toBe(created.saveKey);
                expect(listPilots(store).map(p => p.saveKey))
                    .toEqual([SAVE_KEY, created.saveKey]);
                // Clearing the active (new) pilot's save is a no-op here,
                // and Old Timer's game is still on disk.
                resetSave(store);
                expect(store.raw(SAVE_KEY)).toBe(encodeSave(SAMPLE_SAVE));
            });

        it('applyActivePilot points the save layer at the legacy key', () => {
            const store = new MemoryStorage();
            store.setItem(SAVE_KEY, encodeSave(SAMPLE_SAVE));
            const active = applyActivePilot(store);
            expect(active?.saveKey).toBe(SAVE_KEY);
            expect(getActiveSaveKey()).toBe(SAVE_KEY);
        });
    });

    describe('unreadable registry', () => {
        it('quarantines rather than dropping it, then re-migrates', () => {
            const store = new MemoryStorage();
            store.setItem(SAVE_KEY, encodeSave(SAMPLE_SAVE));
            store.setItem(PILOT_REGISTRY_KEY, '{not json');
            const pilots = listPilots(store);
            expect(store.raw(PILOT_REGISTRY_QUARANTINE_KEY)).toBe('{not json');
            // The legacy save is still reachable afterwards.
            expect(pilots.length).toBe(1);
            expect(pilots[0].saveKey).toBe(SAVE_KEY);
        });

        it('quarantines a registry from a future version', () => {
            const store = new MemoryStorage();
            const future = JSON.stringify(
                { version: 99, activeId: null, pilots: [] });
            store.setItem(PILOT_REGISTRY_KEY, future);
            loadRegistry(store);
            expect(store.raw(PILOT_REGISTRY_QUARANTINE_KEY)).toBe(future);
        });
    });

    describe('per-pilot controls', () => {
        it('a fresh pilot has no overrides (controls.json defaults)', () => {
            const store = new MemoryStorage();
            createPilot(profile('Fresh'), store);
            expect(loadPilotControls(store)).toEqual({});
        });

        it('persists overrides onto the active pilot only', () => {
            const store = new MemoryStorage();
            const a = createPilot(profile('Alpha'), store);
            savePilotControls({ accelerate: 'KeyW' }, store);
            const b = createPilot(profile('Beta'), store);
            expect(loadPilotControls(store)).toEqual({});
            selectPilot(a.id, store);
            expect(loadPilotControls(store)).toEqual({ accelerate: 'KeyW' });
            selectPilot(b.id, store);
            expect(loadPilotControls(store)).toEqual({});
        });

        it('switching pilots switches bindings', () => {
            const store = new MemoryStorage();
            const a = createPilot(profile('Alpha'), store);
            savePilotControls({ turnLeft: 'KeyA' }, store);
            const b = createPilot(profile('Beta'), store);
            savePilotControls({ turnLeft: 'KeyZ' }, store);
            selectPilot(a.id, store);
            expect(loadPilotControls(store).turnLeft).toBe('KeyA');
            selectPilot(b.id, store);
            expect(loadPilotControls(store).turnLeft).toBe('KeyZ');
        });

        it('falls back to the legacy slot when no pilot exists', () => {
            const store = new MemoryStorage();
            savePilotControls({ land: 'KeyL' }, store);
            expect(store.raw(CONTROLS_OVERRIDE_KEY))
                .toBe(JSON.stringify({ land: 'KeyL' }));
            expect(loadPilotControls(store)).toEqual({ land: 'KeyL' });
        });
    });

    describe('export / import', () => {
        it('imports a pilot whose save carries a Map-coded field (a mission '
            + 'with special ships) — the shipped regression', () => {
            // ActiveMission.shipObjective.live is a `map(...)` codec: the
            // io-ts DECODED file.save held a live Map, and JSON.stringify of
            // a Map is "{}", so re-validating the decoded object rejected
            // every pilot who had ever taken a special-ship mission.
            const store = new MemoryStorage();
            const a = createPilot(profile('Hunter'), store);
            const withMission: SaveData = {
                ...SAMPLE_SAVE,
                missions: [['nova:257', {
                    id: 'nova:257', acceptedDay: 1, acceptedAt: 'nova:134',
                    travelPlanet: null, returnPlanet: 'nova:128',
                    cargoType: -1, cargoQty: 0, cargoLoaded: false,
                    travelDone: false, deadlineDay: null,
                    shipObjective: {
                        goal: 0, systemId: 'nova:532', shipStart: 1,
                        behavior: 0, dudeId: 'nova:251', total: 1,
                        satisfied: 0, complete: false, failed: false,
                        shipDonePending: false, live: new Map(),
                    },
                }]],
            };
            store.setItem(a.saveKey, encodeSave(withMission));
            const text = exportPilot(a.id, store)!;

            const fresh = new MemoryStorage();
            const result = importPilot(text, fresh);
            expect(result.ok).withContext(JSON.stringify(result)).toBeTrue();
            if (!result.ok) { return; }
            expect(fresh.raw(result.pilot.saveKey))
                .toBe(JSON.stringify(JSON.parse(encodeSave(withMission))));
        });

        it('round-trips a pilot with its save intact', () => {
            const store = new MemoryStorage();
            const a = createPilot(profile('Traveller'), store);
            savePilotControls({ accelerate: 'KeyW' }, store);
            store.setItem(a.saveKey, encodeSave(SAMPLE_SAVE));

            const text = exportPilot(a.id, store)!;
            expect(text).toBeDefined();

            const fresh = new MemoryStorage();
            const result = importPilot(text, fresh);
            expect(result.ok).toBeTrue();
            if (!result.ok) { return; }
            expect(result.pilot.name).toBe('Traveller');
            expect(result.pilot.controls).toEqual({ accelerate: 'KeyW' });
            expect(result.pilot.profile?.nickname).toBe('Ace');
            // The save payload rides along verbatim.
            expect(fresh.raw(result.pilot.saveKey))
                .toBe(JSON.stringify(JSON.parse(encodeSave(SAMPLE_SAVE))));
        });

        it('carries the checkpoint history through export and import', () => {
            const store = new MemoryStorage();
            const a = createPilot(profile('Historian'), store);
            store.setItem(a.saveKey, encodeSave(SAMPLE_SAVE));
            recordCheckpoint(a.saveKey, JSON.parse(encodeSave(SAMPLE_SAVE)),
                { label: 'Departed Earth', kind: 'depart' }, store);
            store.setItem(a.saveKey, encodeSave(OTHER_SAVE));
            recordCheckpoint(a.saveKey, JSON.parse(encodeSave(OTHER_SAVE)),
                { label: 'Bought Blaster ×1', kind: 'purchase' }, store);

            const text = exportPilot(a.id, store)!;
            expect(JSON.parse(text).history.checkpoints.length).toBe(2);

            const fresh = new MemoryStorage();
            const result = importPilot(text, fresh);
            expect(result.ok).toBeTrue();
            if (!result.ok) { return; }
            const history = loadHistory(result.pilot.saveKey, fresh)!;
            expect(history.checkpoints.map(c => c.label))
                .toEqual(['Departed Earth', 'Bought Blaster ×1']);
            expect(JSON.stringify(checkpointState(history, 0)))
                .toBe(JSON.stringify(JSON.parse(encodeSave(SAMPLE_SAVE))));
        });

        it('imports a pilot whose history is unreadable, without it', () => {
            const store = new MemoryStorage();
            const a = createPilot(profile('Amnesiac'), store);
            store.setItem(a.saveKey, encodeSave(SAMPLE_SAVE));
            const file = JSON.parse(exportPilot(a.id, store)!);
            file.history = { version: 99, nonsense: true };
            const fresh = new MemoryStorage();
            const result = importPilot(JSON.stringify(file), fresh);
            expect(result.ok).toBeTrue();
            if (!result.ok) { return; }
            expect(fresh.has(historyKeyFor(result.pilot.saveKey))).toBeFalse();
            expect(fresh.has(result.pilot.saveKey)).toBeTrue();
        });

        it('exports one checkpoint as its own pilot file, history truncated '
            + 'at that point', () => {
                const store = new MemoryStorage();
                const a = createPilot(profile('Forker'), store);
                for (const [save, label] of [[SAMPLE_SAVE, 'one'],
                [OTHER_SAVE, 'two'], [SAMPLE_SAVE, 'three']] as const) {
                    store.setItem(a.saveKey, encodeSave(save));
                    recordCheckpoint(a.saveKey, JSON.parse(encodeSave(save)),
                        { label }, store);
                }
                const copy = exportCheckpointFile(a.id, 1, store)!;
                expect(copy.name).toBe('Forker (two)');
                const parsed = JSON.parse(copy.text);
                expect(parsed.name).toBe('Forker (two)');
                expect(parsed.save.data.credits).toBe(OTHER_SAVE.credits);
                expect(parsed.history.checkpoints.map((c: { label: string }) =>
                    c.label)).toEqual(['one', 'two']);
                // And it imports as a separate pilot.
                const result = importPilot(copy.text, store);
                expect(result.ok).toBeTrue();
                if (!result.ok) { return; }
                expect(result.pilot.name).toBe('Forker (two)');
                expect(loadHistory(result.pilot.saveKey, store)!.checkpoints
                    .length).toBe(2);
                expect(exportCheckpointFile(a.id, 7, store)).toBeUndefined();
            });

        it('exports a pilot that has never played (no save)', () => {
            const store = new MemoryStorage();
            const a = createPilot(profile('Greenhorn'), store);
            const text = exportPilot(a.id, store)!;
            const fresh = new MemoryStorage();
            const result = importPilot(text, fresh);
            expect(result.ok).toBeTrue();
            if (!result.ok) { return; }
            expect(fresh.has(result.pilot.saveKey)).toBeFalse();
        });

        it('returns undefined exporting an unknown pilot', () => {
            expect(exportPilot('nope', new MemoryStorage())).toBeUndefined();
        });

        it('refuses a file that is not JSON', () => {
            const store = new MemoryStorage();
            const result = importPilot('<<not json>>', store);
            expect(result.ok).toBeFalse();
            expect(listPilots(store)).toEqual([]);
        });

        it('refuses a JSON file that is not a pilot file', () => {
            const store = new MemoryStorage();
            const result = importPilot('{"hello":"world"}', store);
            expect(result.ok).toBeFalse();
            expect(listPilots(store)).toEqual([]);
        });

        it('REFUSES an undecodable save and writes nothing', () => {
            const store = new MemoryStorage();
            // A well-formed pilot file whose save envelope names a version
            // this build cannot read.
            const bad = JSON.stringify({
                format: 'novajs-pilot', version: 1, name: 'Corrupt',
                save: { version: 9999, data: SAMPLE_SAVE },
            });
            const result = importPilot(bad, store);
            expect(result.ok).toBeFalse();
            if (result.ok) { return; }
            expect(result.reason).toContain('could not be read');
            // Nothing was written: not the registry, not a save key.
            expect(listPilots(store)).toEqual([]);
            expect(store.keys().some(k => k.startsWith(PILOT_SAVE_KEY_PREFIX)))
                .toBeFalse();
        });

        it('refuses a save whose payload does not match the codec', () => {
            const store = new MemoryStorage();
            const bad = JSON.stringify({
                format: 'novajs-pilot', version: 1, name: 'Broken',
                save: { version: 2, data: { ship: 42 } },
            });
            expect(importPilot(bad, store).ok).toBeFalse();
            expect(listPilots(store)).toEqual([]);
        });

        it('refuses a pilot file from a future format version', () => {
            const store = new MemoryStorage();
            const future = JSON.stringify({
                format: 'novajs-pilot', version: 99, name: 'Future',
            });
            expect(importPilot(future, store).ok).toBeFalse();
        });

        it('disambiguates a colliding name instead of overwriting', () => {
            const store = new MemoryStorage();
            const a = createPilot(profile('Twin'), store);
            store.setItem(a.saveKey, encodeSave(SAMPLE_SAVE));
            const text = exportPilot(a.id, store)!;

            const result = importPilot(text, store);
            expect(result.ok).toBeTrue();
            if (!result.ok) { return; }
            expect(result.renamed).toBeTrue();
            expect(result.pilot.name).toBe('Twin (2)');
            // The original is untouched and both now exist.
            expect(listPilots(store).map(p => p.name))
                .toEqual(['Twin', 'Twin (2)']);
            expect(store.raw(a.saveKey)).toBe(encodeSave(SAMPLE_SAVE));
        });

        it('does not make an imported pilot active', () => {
            const store = new MemoryStorage();
            const a = createPilot(profile('Alpha'), store);
            const text = exportPilot(a.id, store)!;
            importPilot(text, store);
            expect(getActivePilot(store)?.id).toBe(a.id);
        });
    });

    describe('export filenames', () => {
        it('builds a safe filename from the pilot name', () => {
            expect(exportFileName('Shane Merrol'))
                .toBe('Shane_Merrol.plt');
        });

        it('strips path separators and other unsafe characters', () => {
            expect(exportFileName('../../etc/passwd'))
                .toBe('etcpasswd.plt');
        });

        it('falls back when the name has nothing usable', () => {
            expect(exportFileName('///')).toBe('pilot.plt');
        });
    });
});
