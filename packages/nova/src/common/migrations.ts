/**
 * Versioned migrations for persisted shapes.
 *
 * Every client-local record NovaJS keeps (the pilot save, the discovery
 * record, the pilot history) is a JSON value under a small integer
 * version. Until this module the versions were labels only: a shape
 * change had to be additive so that a single `t.partial` codec could
 * read every version ever written, and the restore code carried a
 * `?? default` for every field that had ever been added.
 *
 * A record's shape is now the END of an ordered list of migrations. Each
 * entry rewrites the RAW parsed JSON from one version to the next; the
 * list is walked from the version the record names up to the latest, and
 * only then does the current codec — which may be STRICT — decode it. The
 * defaults an older payload needs live in the migration for the version
 * that lacked them, once, instead of being re-derived at every reader.
 *
 * The rules every list follows:
 *
 *  - Contiguous: entry i takes version `first + i` to `first + i + 1`, so
 *    the latest version is `first + migrations.length` and cannot drift
 *    from the list (latestVersion asserts the chain).
 *  - Total on the raw value: a migration is given whatever JSON was
 *    stored and must not throw. Filling absent keys is the normal shape;
 *    it need not validate — the codec after it does.
 *  - Idempotent where possible: a payload that already carries a later
 *    field is left alone, so re-migrating an already-migrated value (a
 *    rewound checkpoint, an exported file re-imported) is harmless.
 *  - NEWER than the list, or older than `first`: refused with a reason
 *    that names both versions, never guessed at. The caller decides what
 *    refusal means (the save and history quarantine the bytes).
 */

export interface Migration<Raw> {
    /** The version this entry reads. */
    readonly from: number;
    /** The version it writes: always `from + 1`. */
    readonly to: number;
    /** What changed, for the reviewer and the console. */
    readonly summary: string;
    /** Rewrites `raw` (which it may mutate) into the `to` shape. */
    migrate(raw: Raw): Raw;
}

export type MigrationOutcome<Raw> =
    | {
        readonly ok: true;
        /** The value at the latest version. */
        readonly raw: Raw;
        /** How many migrations ran (0 when already current). */
        readonly applied: number;
    }
    | { readonly ok: false; readonly reason: string };

/**
 * The version a list reaches, checking that it is contiguous from
 * `first`. Throws on a malformed list: that is a programming error in the
 * list itself, caught the first time the module loads.
 */
export function latestVersion<Raw>(first: number,
    migrations: readonly Migration<Raw>[]): number {
    migrations.forEach((migration, i) => {
        const expected = first + i;
        if (migration.from !== expected || migration.to !== expected + 1) {
            throw new Error(`Migration list is not contiguous: entry ${i} `
                + `goes ${migration.from} -> ${migration.to}, expected `
                + `${expected} -> ${expected + 1}`);
        }
    });
    return first + migrations.length;
}

/**
 * Brings `raw`, stored under `version`, up to the latest version the
 * list reaches. `what` names the record in the refusal reason ("save",
 * "pilot history").
 */
export function migrateRaw<Raw>(what: string, first: number,
    migrations: readonly Migration<Raw>[], version: number, raw: Raw):
    MigrationOutcome<Raw> {
    const latest = latestVersion(first, migrations);
    if (!Number.isInteger(version)) {
        return { ok: false, reason: `The ${what} names a version that is `
            + `not a whole number (${String(version)}).` };
    }
    if (version > latest) {
        return {
            ok: false,
            reason: `The ${what} was written by a newer build (version `
                + `${version}; this build reads up to ${latest}).`,
        };
    }
    if (version < first) {
        return {
            ok: false,
            reason: `The ${what} is older than anything this build can `
                + `read (version ${version}; the oldest readable is ${first}).`,
        };
    }
    let current = raw;
    for (const migration of migrations.slice(version - first)) {
        current = migration.migrate(current);
    }
    return { ok: true, raw: current, applied: latest - version };
}
