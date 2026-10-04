import { getDefaultGameDate } from 'novadatainterface/player_start_data';
import { latestVersion, Migration } from '../../common/migrations.js';

/**
 * ============================================================================
 * The pilot save's migration list
 * ============================================================================
 *
 * The save's history, as the ordered list `SAVE_MIGRATIONS`: entry i takes
 * the RAW `data` payload of a version-(1+i) envelope to version 2+i.
 * `SAVE_VERSION` is derived from the list (FIRST_SAVE_VERSION plus its
 * length), so adding a shape change means appending a migration, and the
 * strict codec in save_game.ts describes only the LATEST shape.
 *
 * WHAT EACH VERSION LOOKED LIKE, so a reviewer can check the list against
 * the saves in the wild (pilots_debug/*.plt, test_fixtures/pilots/*.plt
 * and title/fixtures/sample_pilot_files.ts are all version 2, at various
 * points of its additive history):
 *
 *   v1 (2026-07-07)  ship, outfits, system; optional credits, missions,
 *                    novaControlBits, reputations, combatRatings.
 *   v1 (2026-07-18)  + optional date, cargo, cronStates.
 *   v2 (2026-08-09)  + optional escorts (the version bump), then, still
 *                    under v2 because each was additive: playerUuid
 *                    (08-10), ranks (08-16), controlBits + plugins
 *                    (08-17), discovery (08-19), autoAbortShips (09-05).
 *   v3 (2026-09-06)  the fields whose absence always meant one thing are
 *                    REQUIRED; the migration writes that one thing.
 *   v4 (2026-10-03)  each saved escort's PlayerEscort marker states its
 *                    queued deal as ONE field, `deal` (EscortDeal: none |
 *                    upgrade(toShip) | sale), in place of the
 *                    `pendingUpgrade` / `pendingSale` flag pair — the first
 *                    migration that reaches INSIDE the escort blobs (see
 *                    save_game.ts's WIRE COMPATIBILITY note).
 *   v5 (this build)  ids and namespaces of a plug-in whose id-space prefix
 *                    changed with issue #310 (the prefix was the text
 *                    before its name's FIRST dot; it is now the whole base
 *                    name minus one known extension) are re-keyed from the
 *                    old prefix to the new one, by the static table
 *                    PLUGIN_PREFIX_RENAMES — a TEMPORARY transition (see
 *                    the table for what removing it entails).
 *
 * FORWARD COMPATIBILITY (a save written by this build, read by the
 * previous one). The previous build's decodeSave refuses any envelope
 * whose version exceeds its own SAVE_VERSION, so it QUARANTINES every
 * save this build writes — that is the version bump itself. The v4
 * payload was NOT a superset of v3 (the deal flag pair is gone from every
 * escort marker), and a v5 payload names a renamed plug-in's content
 * under prefixes the v4 build's own quarantine check would refuse anyway.
 * Exported pilot files carry the same envelope and are refused by the
 * previous build's importer for the same reason. The quarantine keeps the
 * bytes; nothing is destroyed.
 */

/** The oldest save version this build reads (there was never a v0). */
export const FIRST_SAVE_VERSION = 1;

/**
 * A save's `data` payload as JSON, before the codec has seen it. The
 * migrations fill keys on it and nothing more; the strict codec after
 * them is what says whether the result is a save.
 */
export type RawSaveData = Record<string, unknown>;

/**
 * The value each v3-required field takes when a v2 payload lacks it —
 * exactly what the absence meant to the previous build, which left the
 * matching component off the entity for ensurePlayerStateComponents
 * (spaceport/mission_session.ts) to fill with the same value:
 *
 *   credits 0, the default game date, no missions, no cargo, no cron
 *   progress, no legal records (every gövt at its InitialRec), no kills,
 *   no ranks, no escorts, nothing discovered, no auto-abort squad queued.
 *
 * Also what extractSaveData writes for an entity that lacks the component
 * (a bare entity in a spec), so the two meanings of "nothing there" stay
 * one value.
 *
 * Every call builds fresh arrays: a caller may hand them straight into a
 * save (extractSaveData does) or onto a raw payload (materialiseDefaults
 * does) without two payloads ever sharing one, whatever a later writer
 * does to them in place.
 */
export function saveDefaults() {
    return {
        credits: 0,
        date: getDefaultGameDate(),
        missions: [] as never[],
        cargo: [] as never[],
        cronStates: [] as never[],
        reputations: [] as never[],
        combatRatings: [['kills', 0]] as [string, number][],
        ranks: [] as string[],
        escorts: [] as never[],
        discovery: [] as never[],
        autoAbortShips: [] as never[],
    };
}

/**
 * v2 -> v3: materialise the defaults. Fills only ABSENT keys, so an
 * already-v3 payload (a rewound checkpoint, a re-imported export) passes
 * through unchanged, and a v2 field that is present keeps its value — the
 * codec decides whether that value is valid.
 *
 * `combatRatings` is a keyed list, so "present" is not enough: the
 * 'kills' entry is what the restore reads, and a list without one meant
 * zero kills to the previous build.
 */
function materialiseDefaults(raw: RawSaveData): RawSaveData {
    const defaults: Record<string, unknown> = saveDefaults();
    for (const [key, value] of Object.entries(defaults)) {
        if (raw[key] === undefined) {
            raw[key] = value;
        }
    }
    const ratings = raw.combatRatings;
    if (Array.isArray(ratings)
        && !ratings.some(entry => Array.isArray(entry) && entry[0] === 'kills')) {
        raw.combatRatings = [...ratings, ['kills', 0]];
    }
    return raw;
}

/**
 * The name PlayerEscortComponent is registered under, which is the first
 * element of its `[name, data]` entry in a saved escort's component list
 * (nova_ecs serializer's EncodedComponentList). Spelled out rather than
 * imported: a migration describes the shape a save HAD, which must not
 * move if the live component is ever renamed.
 */
const PLAYER_ESCORT_COMPONENT = 'PlayerEscort';

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * A v3 PlayerEscort marker, rewritten to v4: the `pendingUpgrade` /
 * `pendingSale` flags replaced by the `deal` they encoded, read exactly as
 * the v3 build's escortDeal read them —
 *
 *   pendingSale: true             { kind: 'sale' }  (a sale won over an
 *                                 upgrade when, through a hand-edited save,
 *                                 both were set: it is what the settlement
 *                                 did, settling sales first)
 *   pendingUpgrade: toShip        { kind: 'upgrade', toShip }
 *   neither (or pendingSale false) { kind: 'none' }
 *
 * A marker that already has a `deal` is v4 and passes through untouched
 * (idempotence). One whose flags have the WRONG TYPE is also left as it
 * is, with no `deal`: the v3 codec refused such a blob, and the v4 codec,
 * which requires `deal`, refuses it the same way — the escort is skipped
 * at restore (save_game.ts's restoreSavedEscorts), exactly as before. A
 * migration fills keys; it is not the place to make a bad blob good.
 */
function markerWithDeal(marker: Record<string, unknown>): Record<string, unknown> {
    if (marker.deal !== undefined) {
        return marker;
    }
    const { pendingUpgrade, pendingSale, ...rest } = marker;
    if ((pendingSale !== undefined && typeof pendingSale !== 'boolean')
        || (pendingUpgrade !== undefined && typeof pendingUpgrade !== 'string')) {
        return marker;
    }
    const deal = pendingSale === true ? { kind: 'sale' }
        : pendingUpgrade !== undefined
            ? { kind: 'upgrade', toShip: pendingUpgrade }
            : { kind: 'none' };
    return { ...rest, deal };
}

/**
 * v3 -> v4: every saved escort's PlayerEscort marker states its deal (see
 * markerWithDeal). Total on any JSON: an `escorts` that is not a list, an
 * entry without an entity, a component entry that is not a `[name, data]`
 * pair — each is left for the codec to judge.
 */
function escortDealsAsState(raw: RawSaveData): RawSaveData {
    if (!Array.isArray(raw.escorts)) {
        return raw;
    }
    for (const escort of raw.escorts) {
        const components = isRecord(escort) && isRecord(escort.entity)
            ? escort.entity.components : undefined;
        if (!Array.isArray(components)) {
            continue;
        }
        components.forEach((entry: unknown, i) => {
            if (Array.isArray(entry) && entry.length === 2
                && entry[0] === PLAYER_ESCORT_COMPONENT && isRecord(entry[1])) {
                components[i] = [entry[0], markerWithDeal(entry[1])];
            }
        });
    }
    return raw;
}

/**
 * ----------------------------------------------------------------------------
 * v4 -> v5: plug-ins whose id-space prefix changed with issue #310
 * ----------------------------------------------------------------------------
 *
 * Old prefix -> new prefix, for each INSTALLED plug-in whose prefix the
 * #310 rule changed. Before #310 a plug-in's prefix was the text before
 * the first dot of its file name; it is now the base name minus one known
 * extension (novaparse's pluginBaseName / PLUGIN_FILE_EXTENSIONS). Of the
 * 26 plug-ins in the maintainer's Plug-ins directory exactly one changed:
 * the extensionless `HypergatePassv1.0`, which was keyed `HypergatePassv1`.
 *
 * A STATIC TABLE, deliberately (maintainer's ruling on #310, 2026-10-03):
 * a migration is a pure function of the save's JSON and cannot see the
 * Plug-ins directory, and the only affected saves are the maintainer's own
 * pilots. Each entry is unambiguous by construction — exactly one
 * installed plug-in cut at its first dot gives the old prefix — which is
 * the ambiguity guard: an old prefix that stood for two plug-ins (`X 1`
 * for both `X 1.0` and `X 1.1`, the collision #310 exists to fix) is not
 * in the table, so its ids are left as they are and the #131 check
 * (save_content.ts) quarantines the pilot, naming the plug-ins it is
 * probably an older name of. The same goes for any plug-in not listed.
 *
 * TEMPORARY. Once the maintainer's pilots have been loaded and re-saved by
 * a v5 build, this transition has done its job. Removing it means: empty
 * the table (or make the v4 -> v5 entry `raw => raw`, keeping the version
 * numbering), or, when the older transitions go too, raise
 * FIRST_SAVE_VERSION to 5 and drop entries 1-4 of SAVE_MIGRATIONS (saves
 * older than v5 are then refused as too old and quarantined), and delete
 * this section and its specs (save_migrations_test.ts, "4 -> 5").
 */
export const PLUGIN_PREFIX_RENAMES: ReadonlyMap<string, string> = new Map([
    ['HypergatePassv1', 'HypergatePassv1.0'],
]);

/**
 * The commodity-key tags a cargo key puts in front of a global id
 * (`junk:<id>`, trade_logic.ts; `mission:<id>`, mission_cargo.ts).
 * Spelled out, like PLAYER_ESCORT_COMPONENT: the shape a save HAD.
 */
const ID_KEY_TAGS = ['junk:', 'mission:'];

/**
 * `value` with an old prefix re-keyed, when it is a global id of a renamed
 * plug-in (`HypergatePassv1:447`) or a tagged cargo key around one
 * (`junk:HypergatePassv1:12`); otherwise `value` itself. Only a WHOLE
 * string of that form matches, so free text is never touched.
 */
function renamedId(value: string): string {
    for (const tag of ID_KEY_TAGS) {
        if (value.startsWith(tag)) {
            const inner = renamedId(value.slice(tag.length));
            if (inner !== value.slice(tag.length)) {
                return tag + inner;
            }
        }
    }
    const colon = value.lastIndexOf(':');
    if (colon <= 0 || !/^-?\d+$/.test(value.slice(colon + 1))) {
        return value;
    }
    const renamed = PLUGIN_PREFIX_RENAMES.get(value.slice(0, colon));
    return renamed === undefined ? value : `${renamed}${value.slice(colon)}`;
}

/**
 * `value` with every renamed id re-keyed, wherever it sits: a string, an
 * array element, an object's value OR key (an encoded component may key a
 * record by id, e.g. a weapons table). Walks the whole JSON, which is
 * what reaches inside the missions' frozen objectives, the auto-abort
 * squads and every saved escort blob without listing their shapes.
 */
function renameIdsDeep(value: unknown): unknown {
    if (typeof value === 'string') {
        return renamedId(value);
    }
    if (Array.isArray(value)) {
        return value.map(renameIdsDeep);
    }
    if (isRecord(value)) {
        const out: Record<string, unknown> = {};
        for (const [key, inner] of Object.entries(value)) {
            out[renamedId(key)] = renameIdsDeep(inner);
        }
        return out;
    }
    return value;
}

/**
 * The top-level `[id, value]` lists of the save, by field. An entry the
 * rename would put on a key the list ALREADY has is dropped: the entry
 * already under the new prefix was written by a build that knew it (a
 * cron state the #310 build kept progressing), so it is the current one.
 */
const KEYED_ID_FIELDS = ['outfits', 'missions', 'cargo', 'cronStates',
    'reputations', 'discovery'];

function renameKeyedList(list: unknown): unknown {
    if (!Array.isArray(list)) {
        return renameIdsDeep(list);
    }
    const present = new Set(list.flatMap(entry =>
        Array.isArray(entry) && typeof entry[0] === 'string' ? [entry[0]] : []));
    return list.flatMap(entry => {
        if (Array.isArray(entry) && typeof entry[0] === 'string') {
            const key = renamedId(entry[0]);
            if (key !== entry[0] && present.has(key)) {
                return [];
            }
        }
        return [renameIdsDeep(entry)];
    });
}

/** A bare plug-in prefix (a namespace), re-keyed when it was renamed. */
function renamedPrefix(value: unknown): unknown {
    return typeof value === 'string'
        ? PLUGIN_PREFIX_RENAMES.get(value) ?? value : value;
}

/** `list` without later repeats (by JSON value), order kept. */
function withoutRepeats(list: unknown[]): unknown[] {
    const seen = new Set<string>();
    return list.filter(entry => {
        const key = JSON.stringify(entry);
        if (seen.has(key)) {
            return false;
        }
        seen.add(key);
        return true;
    });
}

/**
 * v4 -> v5: re-key every id and namespace of a plug-in in
 * PLUGIN_PREFIX_RENAMES. Where a save holds them:
 *
 *   ids (`P:n`)      ship, system, outfits, missions (key, and the
 *                    record's mission / planet / düde / system / gövt ids
 *                    incl. its frozen shipObjective), cargo keys (`junk:`,
 *                    `mission:`), cronStates, reputations (gövt ids),
 *                    ranks, discovery (system ids), autoAbortShips, and
 *                    anything inside a saved escort's entity blob — by the
 *                    deep walk, renameIdsDeep.
 *   namespaces (`P`) controlBits pairs ([namespace, raw bit], parked bits
 *                    of an unloaded plug-in included) and the `plugins`
 *                    manifest. The legacy `novaControlBits` are physical
 *                    numbers (no prefix; the #310 rename moved no plug-in
 *                    in the load order, which sorts the unchanged entry
 *                    names), playerUuid / escort uuids are uuids.
 *
 * Set-like lists (ranks, controlBits, plugins) drop a repeat the rename
 * creates; keyed lists keep the entry already under the new key (see
 * KEYED_ID_FIELDS). Idempotent (nothing old is left to rename) and total
 * on any JSON: a field of the wrong shape is walked or left for the codec.
 */
function renamePluginPrefixes(raw: RawSaveData): RawSaveData {
    const out: RawSaveData = {};
    for (const [field, value] of Object.entries(raw)) {
        if (KEYED_ID_FIELDS.includes(field)) {
            out[field] = renameKeyedList(value);
        } else if (field === 'controlBits' && Array.isArray(value)) {
            out[field] = withoutRepeats(value.map(pair =>
                Array.isArray(pair) && pair.length === 2
                    ? [renamedPrefix(pair[0]), pair[1]] : pair));
        } else if (field === 'plugins' && Array.isArray(value)) {
            out[field] = withoutRepeats(value.map(renamedPrefix));
        } else if (field === 'ranks' && Array.isArray(value)) {
            out[field] = withoutRepeats(value.map(renameIdsDeep));
        } else {
            out[field] = renameIdsDeep(value);
        }
    }
    return out;
}

export const SAVE_MIGRATIONS: readonly Migration<RawSaveData>[] = [
    {
        from: 1, to: 2,
        summary: 'escorts are persisted as serialized entities (optional '
            + 'field; a v1 payload is a v2 payload without it)',
        migrate: raw => raw,
    },
    {
        from: 2, to: 3,
        summary: 'credits, date, missions, cargo, cronStates, reputations, '
            + 'combatRatings, ranks, escorts, discovery and autoAbortShips '
            + 'are required; absence becomes the default it always meant',
        migrate: materialiseDefaults,
    },
    {
        from: 3, to: 4,
        summary: 'each saved escort\'s PlayerEscort marker carries its queued '
            + 'deal as `deal` (none / upgrade / sale) in place of the '
            + 'pendingUpgrade / pendingSale flag pair',
        migrate: escortDealsAsState,
    },
    {
        from: 4, to: 5,
        summary: 'ids and namespaces of plug-ins whose prefix changed with '
            + '#310 (first dot -> full base name) are re-keyed to the new '
            + 'prefix (temporary transition: PLUGIN_PREFIX_RENAMES)',
        migrate: renamePluginPrefixes,
    },
];

/**
 * The version this build writes: the end of the migration list. Bumping
 * it by hand is impossible; append a migration instead.
 */
export const SAVE_VERSION = latestVersion(FIRST_SAVE_VERSION, SAVE_MIGRATIONS);
