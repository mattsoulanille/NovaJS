import 'jasmine';
import * as fs from 'fs';
import * as path from 'path';
import { Entity } from 'nova_ecs/entity';
import { getDefaultGameDate } from 'novadatainterface/player_start_data';
import {
    PILOT_FILE_NO_ESCORT, PILOT_FILE_WITH_ESCORT,
} from '../../title/fixtures/sample_pilot_files.js';
import { CargoComponent } from '../ship/index.js';
import {
    ActiveRanksComponent, ControlBitsComponent,
} from '../ncb/index.js';
import {
    ActiveMission, CreditsComponent, CronState, CronStatesComponent,
    GameDateComponent, MissionsComponent, PendingAutoAbortShip,
    PendingAutoAbortShipsComponent,
} from '../player/index.js';
import {
    CombatRatingComponent, LegalRecordsComponent,
} from '../reputation/index.js';
import {
    decodeSave, decodeSaveDetailed, encodeSave, MIN_READABLE_SAVE_VERSION,
    restorePlayerState, SaveData, SavedEscort, SAVE_VERSION,
} from './save_game.js';
import {
    FIRST_SAVE_VERSION, PLUGIN_PREFIX_RENAMES, RawSaveData, SAVE_MIGRATIONS,
    saveDefaults,
} from './save_migrations.js';
import { migrateRaw } from '../../common/migrations.js';
import {
    describeMissingSaveContent, missingSaveContent,
} from './save_content.js';

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
/** An escort exactly as v2 / v3 builds wrote it: no deal queued. */
const ESCORT_BLOB: SavedEscort = {
    uuid: 'escort-1',
    entity: {
        components: [['PlayerEscort', { player: 'old-player', parent: 'old-player' }]],
        name: 'esc',
    },
};
/** The same escort at v4: its marker states the (empty) deal. */
const ESCORT_BLOB_V4: SavedEscort = {
    uuid: 'escort-1',
    entity: {
        components: [['PlayerEscort', {
            player: 'old-player', parent: 'old-player', deal: { kind: 'none' },
        }]],
        name: 'esc',
    },
};

/** A saved escort whose PlayerEscort entry is `marker`, beside another component. */
function escortWithMarker(uuid: string, marker: unknown): SavedEscort {
    return {
        uuid,
        entity: {
            components: [
                ['Armor', { current: 100, recharge: 0, max: 100, min: 0 }],
                ['PlayerEscort', marker],
            ],
        },
    };
}
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
        expected: current({ credits: 5, escorts: [ESCORT_BLOB_V4] }),
        restored: { ...FRESH_VIEW, credits: { credits: 5 } },
    },
    {
        name: 'v2, 2026-08-10: + playerUuid beside the escorts',
        version: 2,
        data: {
            ...V1_MINIMAL, escorts: [ESCORT_BLOB], playerUuid: 'old-player',
        },
        expected: current({ escorts: [ESCORT_BLOB_V4], playerUuid: 'old-player' }),
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
    {
        name: 'v3, 2026-09-06: escorts with each queued deal as the flag pair',
        version: 3,
        data: {
            ...current(),
            escorts: [
                escortWithMarker('idle', { player: 'p', parent: 'p' }),
                escortWithMarker('selling',
                    { player: 'p', parent: 'p', provenance: 'captured', pendingSale: true }),
                escortWithMarker('upgrading',
                    { player: 'p', parent: 'p', pendingUpgrade: 'nova:137' }),
            ],
        },
        expected: current({
            escorts: [
                escortWithMarker('idle',
                    { player: 'p', parent: 'p', deal: { kind: 'none' } }),
                escortWithMarker('selling', {
                    player: 'p', parent: 'p', provenance: 'captured',
                    deal: { kind: 'sale' },
                }),
                escortWithMarker('upgrading', {
                    player: 'p', parent: 'p',
                    deal: { kind: 'upgrade', toShip: 'nova:137' },
                }),
            ],
        }),
        restored: FRESH_VIEW,
    },
    {
        name: 'v4, 2026-10-03: escorts with each queued deal as `deal`',
        version: 4,
        data: {
            ...current(),
            credits: 1234,
            ranks: ['nova:147'],
            cronStates: CRONS,
            controlBits: pairs([['nova', 342]]),
            plugins: ['arpia'],
            escorts: [
                escortWithMarker('selling', {
                    player: 'p', parent: 'p', deal: { kind: 'sale' },
                }),
            ],
        },
        expected: current({
            credits: 1234,
            ranks: ['nova:147'],
            cronStates: CRONS,
            controlBits: pairs([['nova', 342]]),
            plugins: ['arpia'],
            escorts: [
                escortWithMarker('selling', {
                    player: 'p', parent: 'p', deal: { kind: 'sale' },
                }),
            ],
        }),
        restored: {
            ...FRESH_VIEW,
            credits: { credits: 1234 },
            ranks: new Set(['nova:147']),
            cronStates: new Map(CRONS),
            controlBits: new Set([342]),
        },
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
        expect(SAVE_VERSION).toBe(5);
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

    describe('3 -> 4: the escort marker\'s deal flags become the deal', () => {
        const toV4 = (marker: unknown) => {
            const migrated = SAVE_MIGRATIONS[2].migrate(
                { ...current(), escorts: [escortWithMarker('e', marker)] });
            const [escort] = migrated.escorts as SavedEscort[];
            return escort!.entity.components;
        };
        const base = { player: 'p', parent: 'p', provenance: 'captured' };

        it('neither flag: none', () => {
            expect(toV4(base)[1]).toEqual(
                ['PlayerEscort', { ...base, deal: { kind: 'none' } }]);
            // A false sale flag was "not queued" to the v3 reader too.
            expect(toV4({ ...base, pendingSale: false })[1]).toEqual(
                ['PlayerEscort', { ...base, deal: { kind: 'none' } }]);
        });

        it('pendingUpgrade: an upgrade to the stored target', () => {
            expect(toV4({ ...base, pendingUpgrade: 'nova:137' })[1]).toEqual(
                ['PlayerEscort',
                    { ...base, deal: { kind: 'upgrade', toShip: 'nova:137' } }]);
        });

        it('pendingSale: a sale', () => {
            expect(toV4({ ...base, pendingSale: true })[1]).toEqual(
                ['PlayerEscort', { ...base, deal: { kind: 'sale' } }]);
        });

        it('BOTH flags (a hand-edited save): the sale, as v3 settled it', () => {
            expect(toV4({ ...base, pendingUpgrade: 'nova:137', pendingSale: true })[1])
                .toEqual(['PlayerEscort', { ...base, deal: { kind: 'sale' } }]);
        });

        it('leaves every other component, and an already-v4 marker, alone', () => {
            const v4 = { ...base, deal: { kind: 'upgrade', toShip: 'nova:137' } };
            const components = toV4(v4);
            expect(components[0]).toEqual(
                ['Armor', { current: 100, recharge: 0, max: 100, min: 0 }]);
            expect(components[1]).toEqual(['PlayerEscort', v4]);
        });

        it('leaves a mistyped flag for the codec to refuse, as v3\'s did', () => {
            const rotten = { ...base, pendingUpgrade: 137 };
            expect(toV4(rotten)[1]).toEqual(['PlayerEscort', rotten]);
        });

        it('is total on JSON that is not a save\'s escorts', () => {
            const toV4Raw = SAVE_MIGRATIONS[2].migrate;
            for (const escorts of [undefined, 'none', [null], [{ uuid: 'x' }],
                [{ entity: { components: 'none' } }],
                [{ entity: { components: [null, ['PlayerEscort'], ['PlayerEscort', 3]] } }]]) {
                const raw = { ...V1_MINIMAL, escorts } as RawSaveData;
                expect(() => toV4Raw(structuredClone(raw))).not.toThrow();
                expect(toV4Raw(structuredClone(raw))).toEqual(raw);
            }
        });
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

/**
 * ============================================================================
 * 4 -> 5: the #310 plug-in prefix transition
 * ============================================================================
 *
 * Synthetic: the plug-in names and ids below are made up around the
 * table's one entry (`HypergatePassv1` -> `HypergatePassv1.0`, keyed
 * exactly as the maintainer's installed plug-in is) and an ambiguous pair
 * (`X 1.0` and `X 1.1`, both `X 1` under the old rule). No game data.
 */
describe('save_migrations 4 -> 5: plug-in prefixes renamed by #310', () => {
    const OLD = 'HypergatePassv1';
    const NEW = 'HypergatePassv1.0';
    const toV5 = SAVE_MIGRATIONS[3].migrate;

    /** A saved escort whose blob names the plug-in `prefix`'s content. */
    function escortNaming(prefix: string): SavedEscort {
        return {
            uuid: 'escort-hg',
            entity: {
                components: [
                    ['Ship', { id: `${prefix}:128` }],
                    ['OutfitsState', [[`${prefix}:447`, { count: 1 }],
                        ['nova:200', { count: 2 }]]],
                    ['WeaponsState', { [`${prefix}:130`]: { count: 1 } }],
                    ['Cargo', [[`junk:${prefix}:12`, 3]]],
                    ['PlayerEscort', {
                        player: 'p', parent: 'p', deal: { kind: 'none' },
                    }],
                ],
                name: `${prefix}:447`,
            },
        };
    }

    /** A v4 pilot owning `prefix`'s outfit, ranks, crons and bit b918. */
    function v4Pilot(prefix: string): Record<string, unknown> {
        return {
            ...current(),
            ship: `${prefix}:128`,
            outfits: pairs([['nova:200', 1], [`${prefix}:447`, 1]]),
            missions: [[`${prefix}:200`, {
                ...MISSION, id: `${prefix}:200`, acceptedAt: `${prefix}:128`,
            }]],
            cargo: pairs([['cargo:2', 3], [`junk:${prefix}:12`, 4],
                [`mission:${prefix}:200`, 10]]),
            ranks: [`${prefix}:159`, `${prefix}:160`, `${prefix}:161`,
                `${prefix}:162`, 'nova:147'],
            cronStates: [[`${prefix}:386`, CRON], [`${prefix}:387`, CRON],
                [`${prefix}:388`, CRON], ['nova:300', CRON]],
            reputations: pairs([[`${prefix}:128`, 5], ['nova:128', -15]]),
            discovery: pairs([[`${prefix}:130`, 2], ['nova:130', 1]]),
            novaControlBits: pairs([['342', 1], ['10000', 1]]),
            controlBits: pairs([['nova', 342], [prefix, 918]]),
            plugins: ['arpia', prefix, 'singularity'],
            escorts: [escortNaming(prefix)],
            autoAbortShips: [{
                ...SQUAD_JSON, missionId: `${prefix}:614`,
                shipObjective: {
                    ...SQUAD_JSON.shipObjective, dudeId: `${prefix}:130`,
                },
            }],
        };
    }

    it('names only prefixes that are unambiguous by construction', () => {
        // One entry, the one #310 changed among the installed plug-ins:
        // the old prefix is the new one cut at its first dot.
        expect([...PLUGIN_PREFIX_RENAMES]).toEqual([[OLD, NEW]]);
        for (const [old, renamed] of PLUGIN_PREFIX_RENAMES) {
            expect(old).not.toContain('.');
            expect(renamed.slice(0, renamed.indexOf('.'))).toBe(old);
        }
    });

    it('loads a v4 save owning the renamed plug-in\'s content as v5, every '
        + 'id and namespace re-keyed, and does not quarantine it', () => {
            const result = decodeSaveDetailed(JSON.stringify(
                { version: 4, data: v4Pilot(OLD) }));
            expect(result.ok).toBeTrue();
            if (!result.ok) {
                return;
            }
            expect(result.version).toBe(4);
            // Exactly what this build reads for the same pilot written
            // under the new prefix.
            const expected = decodeSaveDetailed(JSON.stringify(
                { version: SAVE_VERSION, data: v4Pilot(NEW) }));
            expect(expected.ok).toBeTrue();
            expect(result.data).toEqual(expected.ok ? expected.data : undefined!);
            const save = result.data;
            expect(save.ship).toBe(`${NEW}:128`);
            expect(save.outfits).toEqual([['nova:200', 1], [`${NEW}:447`, 1]]);
            expect(save.ranks).toEqual([`${NEW}:159`, `${NEW}:160`,
                `${NEW}:161`, `${NEW}:162`, 'nova:147']);
            expect(save.cronStates.map(([id]) => id)).toEqual([`${NEW}:386`,
                `${NEW}:387`, `${NEW}:388`, 'nova:300']);
            expect(save.controlBits).toEqual([['nova', 342], [NEW, 918]]);
            expect(save.plugins).toEqual(['arpia', NEW, 'singularity']);
            expect(save.cargo).toEqual([['cargo:2', 3], [`junk:${NEW}:12`, 4],
                [`mission:${NEW}:200`, 10]]);
            expect(save.missions[0][0]).toBe(`${NEW}:200`);
            expect(save.missions[0][1].id).toBe(`${NEW}:200`);
            expect(save.missions[0][1].acceptedAt).toBe(`${NEW}:128`);
            expect(save.reputations).toEqual(
                [[`${NEW}:128`, 5], ['nova:128', -15]]);
            expect(save.discovery).toEqual([[`${NEW}:130`, 2], ['nova:130', 1]]);
            expect(save.autoAbortShips[0].missionId).toBe(`${NEW}:614`);
            expect(save.autoAbortShips[0].shipObjective.dudeId)
                .toBe(`${NEW}:130`);
            expect(save.escorts).toEqual([escortNaming(NEW)]);
            // Physical bit numbers carry no prefix.
            expect(save.novaControlBits).toEqual([['342', 1], ['10000', 1]]);
            const text = encodeSave(save);
            expect(text).not.toContain(`"${OLD}:`);
            expect(text).not.toContain(`"${OLD}"`);

            // The #131 check against a data set serving the NEW prefix.
            expect(missingSaveContent(save, {
                Ship: ['nova:128', `${NEW}:128`],
                Outfit: ['nova:200', `${NEW}:447`],
            })).toEqual([]);
        });

    it('re-keys inside a saved escort\'s entity blob, keys included', () => {
        const migrated = toV5(structuredClone({
            ...current(), escorts: [escortNaming(OLD)],
        }));
        expect(migrated.escorts).toEqual([escortNaming(NEW)]);
    });

    it('leaves an AMBIGUOUS old prefix alone, so the #131 quarantine names '
        + 'both candidates', () => {
            // `X 1` was the old prefix of BOTH "X 1.0" and "X 1.1": no
            // table entry can say which one a save meant.
            const result = decodeSaveDetailed(JSON.stringify(
                { version: 4, data: v4Pilot('X 1') }));
            const asWritten = decodeSaveDetailed(JSON.stringify(
                { version: SAVE_VERSION, data: v4Pilot('X 1') }));
            expect(result.ok).toBeTrue();
            if (!result.ok || !asWritten.ok) {
                return;
            }
            expect(result.data).toEqual(asWritten.data);
            expect(result.data.outfits)
                .toEqual([['nova:200', 1], ['X 1:447', 1]]);
            expect(result.data.controlBits)
                .toEqual([['nova', 342], ['X 1', 918]]);

            const missing = missingSaveContent(result.data, {
                Ship: ['nova:128', 'X 1.0:128', 'X 1.1:129'],
                Outfit: ['nova:200', 'X 1.0:447', 'X 1.1:447'],
            });
            expect(missing).toEqual([
                { kind: 'ship', id: 'X 1:128', renamedAs: ['X 1.0', 'X 1.1'] },
                { kind: 'outfit', id: 'X 1:447', renamedAs: ['X 1.0', 'X 1.1'] },
            ]);
            expect(describeMissingSaveContent(missing)).toContain(
                'the plug-in "X 1" (ship X 1:128, outfit X 1:447), which is '
                + 'probably the installed "X 1.0" or "X 1.1"');
        });

    it('changes nothing but the version of a save with no affected ids', () => {
        const data = {
            ...current(),
            ranks: ['nova:147'],
            controlBits: pairs([['nova', 342], ['arpia', 2050]]),
            plugins: ['arpia', NEW, 'Starbridge Bay'],
            // Not ids: the bare prefix as a name, a non-numeric suffix,
            // the old id inside free text, and a trailing extra field.
            escorts: [{
                uuid: 'escort-1',
                entity: {
                    components: [['Note', {
                        a: OLD, b: `${OLD}:abc`, c: `see ${OLD}:447`,
                        d: `${OLD}:447:2`, e: `${NEW}:447`,
                    }]],
                },
            }],
        };
        expect(toV5(structuredClone(data))).toEqual(data);
        expect(decodeSaveDetailed(JSON.stringify({ version: 4, data })))
            .toEqual({ ok: true, data: data as SaveData, version: 4 });
    });

    it('keeps the entry already under the new key when the rename collides, '
        + 'and drops repeats from the set-like lists', () => {
            const newer: CronState = { phase: 'pre', phaseStart: 9, nextEligible: 10 };
            const migrated = toV5({
                ...current(),
                cronStates: [[`${OLD}:386`, CRON], [`${NEW}:386`, newer]],
                ranks: [`${OLD}:159`, `${NEW}:159`],
                controlBits: [[OLD, 918], [NEW, 918], ['nova', 342]],
                plugins: [OLD, NEW],
            });
            expect(migrated.cronStates).toEqual([[`${NEW}:386`, newer]]);
            expect(migrated.ranks).toEqual([`${NEW}:159`]);
            expect(migrated.controlBits).toEqual([[NEW, 918], ['nova', 342]]);
            expect(migrated.plugins).toEqual([NEW]);
        });

    it('is total on JSON that is not a save', () => {
        const odd = {
            outfits: 'x', controlBits: [1, [OLD]], plugins: [7], ranks: [null],
            cronStates: [[3, CRON], `${OLD}:1`],
            escorts: { [`${OLD}:1`]: [`${OLD}:2`, null, 3] },
        };
        expect(() => toV5(structuredClone({}))).not.toThrow();
        expect(toV5(structuredClone(odd) as RawSaveData)).toEqual({
            outfits: 'x', controlBits: [1, [OLD]], plugins: [7], ranks: [null],
            cronStates: [[3, CRON], `${NEW}:1`],
            escorts: { [`${NEW}:1`]: [`${NEW}:2`, null, 3] },
        });
    });

    it('migrates a v3 save through v4 to v5', () => {
        const data = {
            ...current(),
            outfits: pairs([[`${OLD}:447`, 1]]),
            controlBits: pairs([[OLD, 918]]),
            escorts: [escortWithMarker('upgrading',
                { player: 'p', parent: 'p', pendingUpgrade: `${OLD}:128` })],
        };
        const result = decodeSaveDetailed(JSON.stringify({ version: 3, data }));
        expect(result).toEqual({
            ok: true, version: 3,
            data: current({
                outfits: pairs([[`${NEW}:447`, 1]]),
                controlBits: pairs([[NEW, 918]]),
                escorts: [escortWithMarker('upgrading', {
                    player: 'p', parent: 'p',
                    deal: { kind: 'upgrade', toShip: `${NEW}:128` },
                })],
            }),
        });
    });

    it('a v5 save is refused by a v4 build\'s version gate (quarantined, '
        + 'not misread)', () => {
            // The previous build is this list without its last entry.
            const v4Build = SAVE_MIGRATIONS.slice(0, 3);
            const written = JSON.parse(encodeSave(current({
                outfits: pairs([[`${NEW}:447`, 1]]),
            })));
            expect(written.version).toBe(5);
            expect(migrateRaw('save', FIRST_SAVE_VERSION, v4Build,
                written.version, written.data)).toEqual({
                ok: false,
                reason: 'The save was written by a newer build (version 5; '
                    + 'this build reads up to 4).',
            });
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
    for (const name of ['PilotFirstname_PilotLastname_cant_hire_officers.plt',
        'PilotFirstname_PilotLastname_misisons_bug.plt']) {
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
            // Nothing the file had is changed but the #310 re-keying (all
            // four pilots own the Hypergate Pass: oütf 447, ränk 162, crön
            // 386-388, and b918 under its namespace); only defaults are
            // added.
            const v5Id = (id: string) => {
                const colon = id.lastIndexOf(':');
                const renamed = PLUGIN_PREFIX_RENAMES.get(id.slice(0, colon));
                return renamed === undefined ? id : renamed + id.slice(colon);
            };
            expect(after.ship).toBe(before.ship!);
            expect(after.credits).toBe(before.credits!);
            expect(after.date).toEqual(before.date!);
            expect(after.outfits).toEqual(before.outfits!
                .map(([id, count]) => [v5Id(id), count]));
            expect(after.outfits.map(([id]) => id))
                .toContain('HypergatePassv1.0:447');
            expect(after.missions.map(([id]) => id))
                .toEqual(before.missions!.map(([id]) => v5Id(id)));
            expect(after.novaControlBits).toEqual(before.novaControlBits);
            expect(after.ranks).toEqual(before.ranks!.map(v5Id));
            expect(after.cronStates.map(([id]) => id))
                .toEqual(before.cronStates!.map(([id]) => v5Id(id)));
            expect(encodeSave(after)).not.toContain('"HypergatePassv1:');
            expect(encodeSave(after)).not.toContain('"HypergatePassv1"');
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
