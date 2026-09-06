import 'jasmine';
import * as fs from 'fs';
import * as path from 'path';
import { Entity } from 'nova_ecs/entity';
import { getDefaultGameDate } from 'novadatainterface/player_start_data';
import {
    PILOT_FILE_NO_ESCORT, PILOT_FILE_WITH_ESCORT,
} from '../title/fixtures/sample_pilot_files.js';
import { CargoComponent } from './cargo_plugin.js';
import {
    ActiveRanksComponent, ControlBitsComponent,
} from './ncb_plugin.js';
import {
    ActiveMission, CreditsComponent, CronState, CronStatesComponent,
    GameDateComponent, MissionsComponent, PendingAutoAbortShip,
    PendingAutoAbortShipsComponent,
} from './player_state_plugin.js';
import {
    CombatRatingComponent, LegalRecordsComponent,
} from './reputation_plugin.js';
import {
    decodeSave, decodeSaveDetailed, encodeSave, MIN_READABLE_SAVE_VERSION,
    restorePlayerState, SaveData, SavedEscort, SAVE_VERSION,
} from './save_game.js';
import {
    FIRST_SAVE_VERSION, RawSaveData, SAVE_MIGRATIONS, saveDefaults,
} from './save_migrations.js';

/**
 * ============================================================================
 * Every save shape ever written still loads
 * ============================================================================
 *
 * One fixture per historical shape of the save (see save_migrations.ts for
 * the dates), each written out as the JSON that build produced, fed in
 * under the version it carried. For each: it migrates, the strict codec
 * accepts the result, and restoring it onto a bare entity yields the
 * components the OLD path produced — the old restore skipped every absent
 * field and ensurePlayerStateComponents then filled the component with a
 * fixed default, so the expectation is the fixture's own values plus
 * those defaults, spelled out.
 */

/** The components the restore writes, as one comparable value. */
function restoredView(entity: Entity) {
    return {
        credits: entity.components.get(CreditsComponent),
        date: entity.components.get(GameDateComponent),
        missions: entity.components.get(MissionsComponent),
        cargo: entity.components.get(CargoComponent),
        cronStates: entity.components.get(CronStatesComponent),
        reputations: entity.components.get(LegalRecordsComponent),
        combatRating: entity.components.get(CombatRatingComponent),
        ranks: entity.components.get(ActiveRanksComponent),
        controlBits: entity.components.get(ControlBitsComponent),
        autoAbortShips: entity.components.get(PendingAutoAbortShipsComponent),
    };
}

type RestoredView = ReturnType<typeof restoredView>;

/** What restoring a save with nothing but an identity produces. */
const FRESH_VIEW: RestoredView = {
    credits: { credits: 0 },
    date: getDefaultGameDate(),
    missions: new Map(),
    cargo: new Map(),
    cronStates: new Map(),
    reputations: new Map(),
    combatRating: { kills: 0 },
    ranks: new Set(),
    controlBits: undefined,
    autoAbortShips: undefined,
};

const MISSION: ActiveMission = {
    id: 'nova:128', acceptedDay: 430064, acceptedAt: 'nova:172',
    travelPlanet: null, returnPlanet: 'nova:128', cargoType: 2,
    cargoQty: 10, cargoLoaded: true, travelDone: false, deadlineDay: null,
};
const MISSIONS: [string, ActiveMission][] = [['nova:128', MISSION]];
const CRON: CronState = { phase: 'active', phaseStart: 430064, nextEligible: 0 };
const CRONS: [string, CronState][] = [['nova:300', CRON]];
const ESCORT_BLOB: SavedEscort = {
    uuid: 'escort-1',
    entity: {
        components: [['PlayerEscort', { player: 'old-player', parent: 'old-player' }]],
        name: 'esc',
    },
};
const SQUAD_JSON = {
    missionId: 'nova:614',
    shipObjective: {
        goal: 0, systemId: null, shipStart: 0, behavior: 0,
        dudeId: 'nova:130', total: 4, satisfied: 0, complete: false,
        failed: false, shipDonePending: false, live: [],
    },
    travelPlanet: null, returnPlanet: 'nova:128', shipName: 'Secession TF',
};
const SQUAD: PendingAutoAbortShip = {
    ...SQUAD_JSON, shipObjective: { ...SQUAD_JSON.shipObjective, live: new Map() },
};
const pairs = (entries: [string, number][]) => entries;

interface HistoricalSave {
    readonly name: string;
    readonly version: number;
    /** Exactly the JSON that build wrote for `data`. */
    readonly data: Record<string, unknown>;
    /** What the current codec must decode it to. */
    readonly expected: SaveData;
    /** What restoring it must put on a bare entity. */
    readonly restored: RestoredView;
}

const V1_MINIMAL = {
    ship: 'nova:164', outfits: pairs([['nova:200', 1]]), system: 'nova:130',
};

/** The current shape of V1_MINIMAL, with `overrides` on top. */
function current(overrides: Partial<SaveData> = {}): SaveData {
    return { ...saveDefaults(), ...V1_MINIMAL, ...overrides };
}

/**
 * The fixtures, oldest first. Each is the FULL payload its build could
 * write (every field that era's extractSaveData had a component for), so
 * a field the migration must not touch is exercised alongside the ones it
 * must fill.
 */
const HISTORY: HistoricalSave[] = [
    {
        name: 'v1, 2026-07-07: identity only (no player state components yet)',
        version: 1,
        data: V1_MINIMAL,
        expected: current(),
        restored: FRESH_VIEW,
    },
    {
        name: 'v1, 2026-07-07: credits, missions, control bits, reputations, '
            + 'combat rating',
        version: 1,
        data: {
            ...V1_MINIMAL,
            credits: 40000,
            missions: MISSIONS,
            novaControlBits: pairs([['13', 1], ['342', 1]]),
            reputations: pairs([['nova:128', -15]]),
            combatRatings: pairs([['kills', 420]]),
        },
        expected: current({
            credits: 40000,
            missions: MISSIONS,
            novaControlBits: pairs([['13', 1], ['342', 1]]),
            reputations: pairs([['nova:128', -15]]),
            combatRatings: pairs([['kills', 420]]),
        }),
        restored: {
            ...FRESH_VIEW,
            credits: { credits: 40000 },
            missions: new Map(MISSIONS),
            reputations: new Map([['nova:128', -15]]),
            combatRating: { kills: 420 },
            controlBits: new Set([13, 342]),
        },
    },
    {
        name: 'v1, 2026-07-18: + date, cargo, cron states',
        version: 1,
        data: {
            ...V1_MINIMAL,
            credits: 40000,
            date: { day: 24, month: 6, year: 1177 },
            missions: [],
            novaControlBits: pairs([['342', 1]]),
            cargo: pairs([['cargo:2', 3]]),
            cronStates: CRONS,
            reputations: [],
            combatRatings: pairs([['kills', 0]]),
        },
        expected: current({
            credits: 40000,
            date: { day: 24, month: 6, year: 1177 },
            novaControlBits: pairs([['342', 1]]),
            cargo: pairs([['cargo:2', 3]]),
            cronStates: CRONS,
        }),
        restored: {
            ...FRESH_VIEW,
            credits: { credits: 40000 },
            date: { day: 24, month: 6, year: 1177 },
            cargo: new Map([['cargo:2', 3]]),
            cronStates: new Map(CRONS),
            controlBits: new Set([342]),
        },
    },
    {
        name: 'v2, 2026-08-09: + escorts (the version bump)',
        version: 2,
        data: { ...V1_MINIMAL, credits: 5, escorts: [ESCORT_BLOB] },
        expected: current({ credits: 5, escorts: [ESCORT_BLOB] }),
        restored: { ...FRESH_VIEW, credits: { credits: 5 } },
    },
    {
        name: 'v2, 2026-08-10: + playerUuid beside the escorts',
        version: 2,
        data: {
            ...V1_MINIMAL, escorts: [ESCORT_BLOB], playerUuid: 'old-player',
        },
        expected: current({ escorts: [ESCORT_BLOB], playerUuid: 'old-player' }),
        restored: FRESH_VIEW,
    },
    {
        name: 'v2, 2026-08-16: + ranks',
        version: 2,
        data: { ...V1_MINIMAL, ranks: ['nova:138', 'nova:147'] },
        expected: current({ ranks: ['nova:138', 'nova:147'] }),
        restored: { ...FRESH_VIEW, ranks: new Set(['nova:138', 'nova:147']) },
    },
    {
        name: 'v2, 2026-08-17: + namespaced controlBits and the plugins manifest',
        version: 2,
        data: {
            ...V1_MINIMAL,
            novaControlBits: pairs([['342', 1]]),
            controlBits: pairs([['nova', 342]]),
            plugins: [],
        },
        expected: current({
            novaControlBits: pairs([['342', 1]]),
            controlBits: pairs([['nova', 342]]),
            plugins: [],
        }),
        restored: { ...FRESH_VIEW, controlBits: new Set([342]) },
    },
    {
        name: 'v2, 2026-08-19: + discovery',
        version: 2,
        data: { ...V1_MINIMAL, discovery: pairs([['nova:130', 2]]) },
        expected: current({ discovery: pairs([['nova:130', 2]]) }),
        restored: FRESH_VIEW,
    },
    {
        name: 'v2, 2026-09-05: + autoAbortShips',
        version: 2,
        data: { ...V1_MINIMAL, autoAbortShips: [SQUAD_JSON] },
        expected: current({ autoAbortShips: [SQUAD] }),
        restored: { ...FRESH_VIEW, autoAbortShips: [SQUAD] },
    },
];

describe('save_migrations list', () => {
    it('is contiguous from the first version, and SAVE_VERSION is its end', () => {
        expect(FIRST_SAVE_VERSION).toBe(1);
        expect(MIN_READABLE_SAVE_VERSION).toBe(FIRST_SAVE_VERSION);
        SAVE_MIGRATIONS.forEach((migration, i) => {
            expect(migration.from).toBe(FIRST_SAVE_VERSION + i);
            expect(migration.to).toBe(migration.from + 1);
            expect(migration.summary.length).toBeGreaterThan(0);
        });
        expect(SAVE_VERSION).toBe(FIRST_SAVE_VERSION + SAVE_MIGRATIONS.length);
        expect(SAVE_VERSION).toBe(3);
    });

    it('every migration is idempotent on its own output', () => {
        // A rewound checkpoint or a re-imported export can present an
        // already-migrated payload under an older version number.
        for (const migration of SAVE_MIGRATIONS) {
            const once = migration.migrate(structuredClone(V1_MINIMAL));
            const twice = migration.migrate(structuredClone(once));
            expect(twice).toEqual(once);
        }
    });

    it('2 -> 3 fills only what is absent, and guarantees a kills entry', () => {
        const toV3 = SAVE_MIGRATIONS[1].migrate;
        const kept = toV3({ ...V1_MINIMAL, credits: 7, combatRatings: [] });
        expect(kept.credits).toBe(7);
        expect(kept.combatRatings).toEqual([['kills', 0]]);
        expect(kept.date).toEqual(getDefaultGameDate());
        // A present-but-wrong value is the codec's to refuse, not ours to fix.
        const wrong = toV3({ ...V1_MINIMAL, credits: 'lots' } as RawSaveData);
        expect(wrong.credits).toBe('lots');
        expect(decodeSaveDetailed(JSON.stringify({ version: 2, data: wrong })))
            .toEqual({ ok: false, reason: jasmine.stringContaining('credits') });
    });

    it('saveDefaults builds fresh arrays on every call', () => {
        // extractSaveData hands them straight into a save and the 2 -> 3
        // migration onto a raw payload; neither may alias the other's.
        const a = saveDefaults();
        const b = saveDefaults();
        expect(a).toEqual(b);
        for (const key of Object.keys(a) as (keyof typeof a)[]) {
            const value = a[key];
            if (Array.isArray(value)) {
                expect(b[key]).not.toBe(value);
            }
        }
        expect(a.date).not.toBe(b.date);
        expect(a.combatRatings[0]).not.toBe(b.combatRatings[0]);
    });

    it('a current-version list without a kills entry reads as zero kills', () => {
        // The codec requires [category, number] pairs, not a 'kills' entry:
        // only the 2 -> 3 migration adds one, so a v3 payload hand-edited
        // to lack it decodes and restores the way such a list always has.
        const decoded = decodeSave(JSON.stringify({
            version: SAVE_VERSION, data: current({ combatRatings: [] }),
        }));
        expect(decoded?.combatRatings).toEqual([]);
        const entity = new Entity('restored');
        restorePlayerState(entity, decoded!);
        expect(entity.components.get(CombatRatingComponent)).toEqual({ kills: 0 });
    });
});

describe('save_migrations historical fixtures', () => {
    for (const fixture of HISTORY) {
        it(`loads ${fixture.name}`, () => {
            const raw = JSON.stringify(
                { version: fixture.version, data: fixture.data });
            const result = decodeSaveDetailed(raw);
            expect(result.ok).toBeTrue();
            if (!result.ok) {
                return;
            }
            expect(result.version).toBe(fixture.version);
            expect(result.data).toEqual(fixture.expected);

            const entity = new Entity('restored');
            restorePlayerState(entity, result.data);
            expect(restoredView(entity)).toEqual(fixture.restored);

            // Written back by this build, it is a current save that needs
            // no migration and says the same thing.
            const again = decodeSaveDetailed(encodeSave(result.data));
            expect(again).toEqual(
                { ok: true, data: fixture.expected, version: SAVE_VERSION });
        });
    }
});

/**
 * REAL saves: the exported pilot files checked in as fixtures (all
 * SAVE_VERSION 2, at different points of its additive history — see the
 * key lists in save_migrations.ts). Never edited; they are what pilots
 * actually have in localStorage.
 */
describe('save_migrations real pilot files', () => {
    const files: Array<[string, unknown]> = [
        ['title/fixtures PILOT_FILE_NO_ESCORT', PILOT_FILE_NO_ESCORT],
        ['title/fixtures PILOT_FILE_WITH_ESCORT', PILOT_FILE_WITH_ESCORT],
    ];
    // Jasmine runs with cwd = packages/nova (see nova_data_gate.ts).
    for (const name of ['Shane_Merrol_cant_hire_officers.plt',
        'Shane_Merrol_misisons_bug.plt']) {
        files.push([`test_fixtures/pilots/${name}`, JSON.parse(fs.readFileSync(
            path.join(process.cwd(), 'test_fixtures', 'pilots', name), 'utf8'))]);
    }

    for (const [name, file] of files) {
        it(`migrates ${name} and keeps what it says`, () => {
            const envelope = (file as { save: { version: number, data: Record<string, unknown> } }).save;
            expect(envelope.version).toBe(2);
            const result = decodeSaveDetailed(JSON.stringify(envelope));
            expect(result.ok).toBeTrue();
            if (!result.ok) {
                return;
            }
            const before = envelope.data as Partial<SaveData>;
            const after = result.data;
            // Nothing the file had is changed; only defaults are added.
            expect(after.ship).toBe(before.ship!);
            expect(after.credits).toBe(before.credits!);
            expect(after.date).toEqual(before.date!);
            expect(after.outfits).toEqual(before.outfits!);
            expect(after.missions.map(([id]) => id))
                .toEqual(before.missions!.map(([id]) => id));
            expect(after.novaControlBits).toEqual(before.novaControlBits);
            expect(after.ranks).toEqual(before.ranks!);
            expect(after.escorts.length).toBe((before.escorts ?? []).length);
            expect(after.discovery).toEqual(before.discovery ?? []);
            expect(after.autoAbortShips).toEqual([]);
            // And it round-trips as a current save.
            expect(decodeSaveDetailed(encodeSave(after)))
                .toEqual({ ok: true, data: after, version: SAVE_VERSION });
        });
    }
});

describe('save_migrations refusals', () => {
    const CURRENT = current();

    it('refuses a newer version with a message naming both versions', () => {
        const result = decodeSaveDetailed(JSON.stringify(
            { version: SAVE_VERSION + 1, data: CURRENT }));
        expect(result).toEqual({
            ok: false,
            reason: `The save was written by a newer build (version `
                + `${SAVE_VERSION + 1}; this build reads up to ${SAVE_VERSION}).`,
        });
    });

    it('refuses a version older than the first, and a fractional one', () => {
        expect(decodeSaveDetailed(JSON.stringify({ version: 0, data: CURRENT })))
            .toEqual({ ok: false, reason: jasmine.stringContaining('older') });
        expect(decodeSaveDetailed(JSON.stringify({ version: 2.5, data: CURRENT })))
            .toEqual({ ok: false, reason: jasmine.stringContaining('whole number') });
    });

    it('refuses a current-version payload missing a required field', () => {
        // A hand-edited v3 save: the strict codec, not a default, answers.
        const { credits: _dropped, ...withoutCredits } = CURRENT;
        const result = decodeSaveDetailed(JSON.stringify(
            { version: SAVE_VERSION, data: withoutCredits }));
        expect(result).toEqual(
            { ok: false, reason: jasmine.stringContaining('\'credits\'') });
        expect(decodeSave(JSON.stringify(
            { version: SAVE_VERSION, data: withoutCredits }))).toBeUndefined();
    });

    it('refuses a payload that is not an object, and a bare payload', () => {
        expect(decodeSaveDetailed(JSON.stringify({ version: 2, data: [] })).ok)
            .toBeFalse();
        expect(decodeSaveDetailed(JSON.stringify(CURRENT)))
            .toEqual({ ok: false, reason: jasmine.stringContaining('envelope') });
    });
});
