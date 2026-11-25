import 'jasmine';
import { parsePilotBytes, parsePilotResources } from 'novaparse/pilot/pilot_parse';
import {
    buildMacPilotBlobs, buildPltPilotFile, SYNTHETIC,
} from 'novaparse/pilot/synthetic_pilot';
import { simpleCrypt } from 'novaparse/pilot/simple_crypt';
import { getIntegrationGameData } from '../communication/simulation_test_fixture.js';
import { dayNumber } from '../nova_plugin/player/index.js';
import { novaDataInstalled, requireNovaData } from '../test_support/nova_data_gate.js';
import { decodeSave, SAVE_VERSION } from '../nova_plugin/pilot/index.js';
import { PrefsStorage } from './client_prefs.js';
import {
    convertOriginalPilot, convertOriginalPilotBytes, loadOriginalPilotWeaponry,
    looksLikeOriginalPilot, OriginalPilotContext, OriginalPilotWeaponry,
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

    it('maps legal status per system, leaving out what an absent entry '
        + 'reads anyway and the systems this data set lacks', () => {
            // nova:135 starts at InitialRec -20 here (so its -20 needs no
            // entry), nova:136 at -5 (so its 0 does); nova:137 is unknown.
            const { save } = convertOriginalPilotBytes(
                buildPltPilotFile('Ring of Glory'), 'Cade.plt', {
                    ...CTX,
                    govtOfSystem: id => id === 'nova:137' ? undefined
                        : CTX.govtOfSystem(id),
                    initialRecordIn: id => id === 'nova:135' ? -20
                        : id === 'nova:136' ? -5 : 0,
                });
            expect(save.legalRecords).toEqual([['nova:136', 0]]);
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
        // legalStatus[7] = -20 -> system nova:135, straight across (both
        // keep the record per system, ruling #380).
        expect(save.legalRecords).toEqual([['nova:135', -20]]);
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
        expect(decodeSave(JSON.stringify({ version: SAVE_VERSION, data: save })))
            .toBeDefined();
    });

    it('clamps out-of-range credits, kills and dates from a crafted file',
        () => {
            // The fields are raw int16/int32 reads: a corrupt or crafted
            // file lands them in the save unvalidated otherwise. EV Nova
            // has no debt (every in-game credit change clamps at 0), and
            // a month of 13 cannot index the calendar's month table.
            const pilot = parsePilotBytes(buildPltPilotFile('Ring of Glory'));
            pilot.player.cash = -5;
            pilot.player.rating = -1;
            pilot.player.date = { year: 1183, month: 13, day: 40 };
            const { save, notes } = convertOriginalPilot(pilot, 'x.plt', CTX);
            expect(save.credits).toBe(0);
            expect(save.combatRatings).toEqual([['kills', 0]]);
            expect(save.date).toEqual({ year: 1183, month: 12, day: 31 });
            expect(notes.some(n => /credits.*out of range/.test(n))).toBeTrue();
            expect(notes.some(n => /date.*clamped/.test(n))).toBeTrue();
            expect(decodeSave(JSON.stringify({ version: SAVE_VERSION, data: save })))
                .toBeDefined();

            // In-range values pass through untouched, with no note.
            const clean = parsePilotBytes(buildPltPilotFile('Ring of Glory'));
            const converted = convertOriginalPilot(clean, 'x.plt', CTX);
            expect(converted.save.credits).toBe(S.cash);
            expect(converted.notes.some(n => /clamped|out of range/.test(n)))
                .toBeFalse();
        });

    it('imports the ship\'s name, cleaned like a typed one', () => {
        const pilot = parsePilotBytes(buildPltPilotFile('Ring of Glory'));
        expect(convertOriginalPilot(pilot, 'x.plt', CTX).save.shipName)
            .toBe(pilot.shipName.trim());
        pilot.shipName = 'Ring\u0007 of\nGlory';
        expect(convertOriginalPilot(pilot, 'x.plt', CTX).save.shipName)
            .toBe('Ring ofGlory');
        // A blank name stays blank, as the original shows it.
        pilot.shipName = '';
        expect(convertOriginalPilot(pilot, 'x.plt', CTX).save.shipName)
            .toBe('');
        // The file's 64-byte field: the first 31 characters are the name.
        pilot.shipName = 'A123456789B123456789C123456789D' + 'junkjunk';
        expect(convertOriginalPilot(pilot, 'x.plt', CTX).save.shipName)
            .toBe('A123456789B123456789C123456789D');
    });

    it('imports the exploration map at its original three levels', () => {
        // The file's `exploration` array is indexed by sÿst id - 128 and
        // holds "<= 0 unexplored, 1 visited, 2 visited and landed within"
        // — the same three levels NovaJS's discovery record uses, so it
        // crosses over unchanged. The synthetic pilot sets exactly one
        // entry: exploration[5] = 2, i.e. sÿst nova:133, landed in.
        const { save } = convertOriginalPilotBytes(
            buildPltPilotFile('Ring of Glory'), 'Cade Connelly.plt', CTX);
        expect(save.discovery)
            .toEqual([[`nova:${S.exploredSystem + 128}`, 2]]);
        // And it is still a save this build accepts (additive field).
        expect(decodeSave(JSON.stringify({ version: SAVE_VERSION, data: save })))
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

    it('resolves the last stellar\'s system under the pilot\'s own bits',
        () => {
            // Stellar 138 stacked in two systems under exclusive Visibility
            // bits: the copy this pilot (bit 42 set) can see is nova:130.
            const seen: ReadonlySet<number>[] = [];
            const ctx: OriginalPilotContext = {
                ...CTX,
                systemOfPlanet: (id, bits) => {
                    seen.push(bits);
                    if (id !== 'nova:138') {
                        return undefined;
                    }
                    return bits.has(S.missionBit) ? 'nova:130' : 'nova:131';
                },
            };
            const { save, lastStellar } = convertOriginalPilotBytes(
                buildPltPilotFile('x'), 'p.plt', ctx);
            expect(save.system).toBe('nova:130');
            expect(lastStellar).toBe('nova:138');
            expect(seen.length).toBeGreaterThan(0);
            for (const bits of seen) {
                expect([...bits]).toEqual([S.missionBit]);
            }
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

    it('notes the counts it could not read without the weapon data', () => {
        const { save, notes } = convertOriginalPilot(pilot({
            outfits: { 128: 1 },
            weapons: { 128: 1 },
        }), 'Ring.plt', { ...CTX, knownOutfit: () => true });
        expect(save.outfits).toEqual([['nova:128', 1]]);
        expect(notes).toContain(
            'Weapon and ammunition counts were not imported.');
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

/** A synthetic pilot flying a Shuttle with exactly these counts. */
function pilot(counts: {
    outfits?: { [id: number]: number },
    weapons?: { [id: number]: number },
    ammo?: { [id: number]: number },
}) {
    const p = parsePilotBytes(buildPltPilotFile('Ring'));
    p.player.shipClass = 0;  // shïp 128, the Shuttle
    p.player.outfitCount = p.player.outfitCount.map(() => 0);
    p.player.weaponCount = p.player.weaponCount.map(() => 0);
    p.player.ammo = p.player.ammo.map(() => 0);
    for (const [id, n] of Object.entries(counts.outfits ?? {})) {
        p.player.outfitCount[Number(id) - 128] = n;
    }
    for (const [id, n] of Object.entries(counts.weapons ?? {})) {
        p.player.weaponCount[Number(id) - 128] = n;
    }
    for (const [id, n] of Object.entries(counts.ammo ?? {})) {
        p.player.ammo[Number(id) - 128] = n;
    }
    return p;
}

/**
 * The file's weapCount[256] and ammo[256] (wëap id = index + 128), on the
 * stock data. In a pilot the original wrote both mirror outfitCount — a
 * new Shuttle stores oütf 128 and wëap 128 once each, and the stock Fed
 * scenario pilot's Pirate Thunderhead Bays (wëap 176, oütf 284) carry
 * their six fighters in ammo[48] and in oütf 285 alike — so only what the
 * oütfs leave out is added.
 */
describe('original pilot import: weapons and ammunition (stock data)', () => {
    let weaponry: OriginalPilotWeaponry;

    beforeAll(async () => {
        if (!novaDataInstalled()) {
            return;
        }
        weaponry = await loadOriginalPilotWeaponry(
            await getIntegrationGameData());
    }, 120_000);
    beforeEach(() => requireNovaData());

    function convert(p: ReturnType<typeof pilot>) {
        return convertOriginalPilot(p, 'Ring.plt', {
            ...CTX,
            knownShip: () => true,
            knownOutfit: id => weaponry.getOutfit(id) !== undefined,
            weaponry,
        });
    }

    it('adds nothing when the oütfs already account for every weapon and '
        + 'round, as the original writes them', () => {
            const { save, notes } = convert(pilot({
                outfits: { 128: 1, 284: 2, 285: 6 },
                weapons: { 128: 1, 176: 2 },
                ammo: { 176: 6 },
            }));
            expect(save.outfits).toEqual([
                ['nova:128', 1], ['nova:284', 2], ['nova:285', 6],
            ]);
            expect(notes.filter(n => /weapon|ammunition/i.test(n)))
                .toEqual([]);
        });

    it('mounts a weapon no owned item grants through the built-in outfit, '
        + 'and loads its rounds capped by MaxAmmo per launcher', () => {
            // Two Thunderhead Bays with no oütf 284: a bay's MaxAmmo is 3,
            // so the file's 10 fighters fit as 6.
            const { save, notes } = convert(pilot({
                weapons: { 176: 2 },
                ammo: { 176: 10 },
            }));
            expect(save.outfits).toEqual([
                ['nova:176:builtInWeapon', 2], ['nova:285', 6],
            ]);
            expect(notes).toContain(
                '4 rounds of ammunition did not fit this ship and were dropped.');
        });

    it('loads rounds onto the oütf feeding the weapon\'s AmmoType supply',
        () => {
            // The Raven Rocket Turret (wëap 139, oütf 144) draws on the
            // Raven Rocket's supply (wëap 138), fed by oütf 143.
            const { save } = convert(pilot({
                outfits: { 144: 1 },
                weapons: { 139: 1 },
                ammo: { 139: 20 },
            }));
            expect(save.outfits).toEqual([['nova:144', 1], ['nova:143', 20]]);
        });

    it('tops up the rounds the owned ammo oütfs hold, capped by the oütf Max',
        () => {
            const topped = convert(pilot({
                outfits: { 142: 1, 143: 5 },
                weapons: { 138: 1 },
                ammo: { 138: 20 },
            }));
            expect(topped.save.outfits)
                .toEqual([['nova:142', 1], ['nova:143', 20]]);

            // oütf 143 "Raven Rocket" is Max 300 (wëap 138's MaxAmmo is 0).
            const capped = convert(pilot({
                outfits: { 142: 1 },
                weapons: { 138: 1 },
                ammo: { 138: 500 },
            }));
            expect(capped.save.outfits)
                .toEqual([['nova:142', 1], ['nova:143', 300]]);
            expect(capped.notes).toContain(
                '200 rounds of ammunition did not fit this ship and were '
                + 'dropped.');
        });

    it('removes nothing when the oütfs mount more than weapCount', () => {
        const { save } = convert(pilot({
            outfits: { 128: 2 },
            weapons: { 128: 1 },
        }));
        expect(save.outfits).toEqual([['nova:128', 2]]);
    });
});
