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
 *   v4 (this build)  each saved escort's PlayerEscort marker states its
 *                    queued deal as ONE field, `deal` (EscortDeal: none |
 *                    upgrade(toShip) | sale), in place of the
 *                    `pendingUpgrade` / `pendingSale` flag pair — the first
 *                    migration that reaches INSIDE the escort blobs (see
 *                    save_game.ts's WIRE COMPATIBILITY note).
 *
 * FORWARD COMPATIBILITY (a save written by this build, read by the
 * previous one). The previous build's decodeSave refuses any envelope
 * whose version exceeds its own SAVE_VERSION of 3, so it QUARANTINES every
 * save this build writes — that is the version bump itself. Unlike v3,
 * the v4 payload is NOT a superset of its predecessor: the flag pair is
 * gone from every escort marker, so a reader that ignored the version
 * would bring every escort back with its queued deal forgotten. Exported
 * pilot files carry the same envelope and are refused by the previous
 * build's importer for the same reason. The quarantine keeps the bytes;
 * nothing is destroyed.
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
];

/**
 * The version this build writes: the end of the migration list. Bumping
 * it by hand is impossible; append a migration instead.
 */
export const SAVE_VERSION = latestVersion(FIRST_SAVE_VERSION, SAVE_MIGRATIONS);
