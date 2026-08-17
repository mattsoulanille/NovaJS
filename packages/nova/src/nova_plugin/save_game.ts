import { isLeft } from 'fp-ts/lib/Either.js';
import * as t from 'io-ts';
import { Entity } from 'nova_ecs/entity';
import {
    EncodedEntity, Serializer,
} from 'nova_ecs/plugins/serializer_plugin';
import { CargoComponent } from './cargo_plugin.js';
import {
    ControlBitPair, ControlBitResolver, sortControlBitPairs,
} from './control_bit_namespaces.js';
import { ActiveRanksComponent, ControlBitsComponent } from './ncb_plugin.js';
import { OutfitsStateComponent } from './outfit_plugin.js';
import {
    ActiveMissionType,
    CreditsComponent,
    CronStatesComponent,
    CronStateType,
    GameDateComponent,
    GameDateType,
    MissionsComponent,
} from './player_state_plugin.js';
import { PlayerEscortComponent } from './player_escort.js';
import { CombatRatingComponent, LegalRecordsComponent } from './reputation_plugin.js';
import { ShipComponent } from './ship_plugin.js';
import { FIRST_PRIVATE_PHYSICAL_CONTROL_BIT } from 'novadatainterface/control_bit_namespaces';

/**
 * Persistent save game for the local player.
 *
 * The save is a read-only observer of the simulation: it serializes the
 * components that already live on the player's ship entity (ship type and
 * outfits) plus the id of the system the player is currently in. Restoring
 * happens through the same path that spawns the player's ship at game start,
 * so nothing here mutates sim state mid-game.
 *
 * The schema is versioned: a top-level `version` plus a `data` payload. When
 * a stored save can't be decoded (corrupt, or written by a newer/older
 * version whose shape we don't understand), it is moved to a quarantine key
 * rather than deleted, and the game falls back to its defaults.
 *
 * ESCORTS are persisted, as whole ENTITIES rather than component fields:
 * an escort's value is its damage, outfits, cargo, and bay identity, all of
 * which a ship-id list would throw away. Each saved escort is one
 * serializer-`EncodedEntity` blob plus the uuid it had when the save was
 * written; see `SavedEscort` for why the uuid is the only thing kept
 * alongside the blob. Restoring re-inserts them through the very same
 * prepareCarriedEscorts/insertCarriedEscorts path a liftoff or a jump uses
 * (browser.ts), so there is exactly one insertion pipeline.
 *
 * WIRE COMPATIBILITY. Because the blobs are produced by the entity
 * serializer, this schema's versioning is now downstream of the ENTITY
 * CODECS: changing how any registered component encodes can invalidate the
 * escorts inside an existing save even though `SAVE_VERSION` did not move.
 * That is a deliberate trade for keeping every component the serializer
 * knows about, including ones this module has never heard of. The failure
 * is contained: a blob whose shape no longer decodes is skipped (see
 * `restoreSavedEscorts`) or, if the array itself no longer matches, the
 * whole save is quarantined rather than deleted. A pilot can lose escorts
 * across such a change; they never lose the save.
 *
 * WHAT IS NOT SAVED. Only escorts that are WITH the player are: the ones
 * in the player's own system, the landed roster held while docked, and a
 * batch riding a jump. An escort deliberately left behind in another
 * system — the zero-energy hyperspace-jump exclusion (escortFollows in
 * player_escort_plugin.ts) leaves such ships where they are — is in no
 * system this client is holding state for, so it is not written and does
 * not come back. That loss is intended and matches what a jump already
 * does within a session.
 */

/**
 * Bump when the shape of `SaveData` changes incompatibly.
 *
 * 1 -> 2 added `escorts`. That was a purely additive, optional field, so a
 * v1 payload still satisfies the v2 codec; see MIN_READABLE_SAVE_VERSION.
 */
export const SAVE_VERSION = 2;

/**
 * The oldest schema version this build can still read.
 *
 * Every version from here to `SAVE_VERSION` decodes with the current codec
 * because the changes between them only ADDED optional (`t.partial`)
 * fields — an older payload is simply one with those fields absent, which
 * is exactly what a pilot who never had escorts writes today. Bump this to
 * `SAVE_VERSION` on the first change that is not additive; anything outside
 * the range (including a NEWER save this build cannot understand) is
 * treated as unreadable and quarantined.
 */
export const MIN_READABLE_SAVE_VERSION = 1;

/** Stable localStorage key holding the current save. */
export const SAVE_KEY = 'novajs:save';

/**
 * Where an unreadable save in the legacy slot is parked instead of being
 * deleted. Per-pilot saves derive theirs the same way (quarantineKeyFor).
 */
export const SAVE_QUARANTINE_KEY = 'novajs:save:quarantine';

/**
 * An owned outfit and how many of it the player has. Encoded as a
 * `[outfitId, count]` tuple to mirror how `OutfitsStateComponent` is
 * serialized (a JSON-safe array of entries).
 */
export const SavedOutfit = t.tuple([
    t.string, // Outfit nova id.
    t.number, // Count.
]);
export type SavedOutfit = t.TypeOf<typeof SavedOutfit>;

/**
 * One escort, as a whole serialized entity.
 *
 * `entity` is exactly what the entity serializer produces for a live
 * escort, so it carries every component the serializer knows about —
 * damage, outfits, cargo, ionization, and a launched fighter's bay
 * identity (OwnerComponent / SourceComponent /
 * ReturnWhenTargetRemovedComponent / BayFighterComponent) — including
 * components this module has never heard of.
 *
 * `uuid` is the ONLY thing kept beside the blob, and it is not
 * redundant: it is the escort's uuid from before the save, which is the
 * key prepareCarriedEscorts remaps carrier references through. Without it
 * a fighter's SourceComponent could not be matched to the carrier it was
 * launched from when both come back under fresh uuids, and the wing would
 * return orphaned from its bay.
 *
 * Note what is deliberately NOT stored alongside: the PlayerEscort marker
 * itself. PlayerEscortComponent is serializer-registered (see
 * player_escort.ts), so it already rides inside `entity`; storing it twice
 * would create two sources of truth that could disagree.
 */
export const SavedEscort = t.type({
    /** The uuid this escort had when the save was written. */
    uuid: t.string,
    /** The escort's whole entity, as the entity serializer encodes it. */
    entity: EncodedEntity,
});
export type SavedEscort = t.TypeOf<typeof SavedEscort>;

/**
 * The player state we persist.
 *
 * `ship`, `outfits`, and `system` exist in the simulation today and are
 * always written. The optional fields cover gameplay state that may be
 * absent (older saves keep loading because they are `t.partial`):
 * credits, the game date, active missions with their runtime state,
 * mission/scooped cargo, control bits, cron progress, legal records
 * (reputations), and the combat rating.
 */
export const SaveData = t.intersection([
    t.type({
        // Nova id of the player's ship type (e.g. 'nova:164').
        ship: t.string,
        // Owned outfits with counts.
        outfits: t.array(SavedOutfit),
        // Nova id of the system the player is in (e.g. 'nova:130').
        system: t.string,
    }),
    t.partial({
        credits: t.number,
        // The player's calendar date.
        date: GameDateType,
        // Active missions and their runtime state, keyed by mission id.
        missions: t.array(t.tuple([t.string, ActiveMissionType])),
        // Set Nova control bits as PHYSICAL bit numbers, keyed by decimal
        // bit id ("342"). The number is unused (always 1); the shape
        // predates this field being written and stays for compatibility.
        //
        // LEGACY since `controlBits` below: still written (so an older
        // build reads a sensible stock bit set) and read only when
        // `controlBits` is absent, through the best-effort migration in
        // control_bit_namespaces.ts.
        novaControlBits: t.array(t.tuple([t.string, t.number])),
        // Set Nova control bits as [namespace, raw bit] pairs — the form
        // that survives a change of plug-in set (see
        // control_bit_namespaces.ts): ["nova", 212] is stock b212,
        // ["arpia", 2050] is ARPIA's own b2050. Includes bits PARKED from
        // a plug-in that is not currently loaded, so they come back when
        // it is. Preferred over `novaControlBits` on load.
        //
        // ADDITIVE and optional, like `ranks`: an older build ignores it,
        // and a save without it reads through the legacy field.
        controlBits: t.array(t.tuple([t.string, t.number])),
        // The plug-in set the save was written under: every loaded plug-in
        // prefix in load order (IDSpaceHandler's sorted order). Purely a
        // manifest for diagnostics and future migrations — nothing is
        // refused for it. Additive and optional.
        plugins: t.array(t.string),
        // The player's active ränks, as global ränk ids ('nova:147').
        // Set and cleared by the same set strings the control bits are
        // (the Kxxx/Lxxx operators; see rank_logic.ts), and persisted
        // alongside them for the same reason.
        //
        // ADDITIVE and optional: a save written before ranks existed
        // simply has no entry and decodes to "no active ranks", which is
        // exactly the state a pre-ranks pilot was in. SAVE_VERSION does
        // NOT move — bumping it would make older builds quarantine saves
        // written by this one, whereas an unknown field is ignored by the
        // non-exact codec.
        ranks: t.array(t.string),
        // Cargo aboard: commodity key ('mission:<id>', 'cargo:<n>',
        // 'junk:<id>') -> tons.
        cargo: t.array(t.tuple([t.string, t.number])),
        // Per-cron progress, keyed by cron id.
        cronStates: t.array(t.tuple([t.string, CronStateType])),
        // Legal records, keyed by gövt id ('nova:128'). A govt absent
        // here reads as its InitialRec (see reputation.ts).
        reputations: t.array(t.tuple([t.string, t.number])),
        // Combat ratings, keyed by category; 'kills' holds the
        // Appendix I kill points.
        combatRatings: t.array(t.tuple([t.string, t.number])),
        // The escorts that were with the player when the save was
        // written — in the system with them, held on the landed roster
        // while docked, or riding a jump. Absent in a v1 save and in any
        // save written by a pilot with no escorts; both read as "none".
        escorts: t.array(SavedEscort),
        // The uuid the PLAYER SHIP itself had when the save was written,
        // written only when `escorts` is.
        //
        // Restoring re-mints the player under a fresh uuid, so an escort
        // blob's references to its player are stale on the way back in.
        // For a fighter the player launched from its OWN bays that is not
        // cosmetic: OwnerComponent/SourceComponent name the carrier, and
        // they are what ReturnAI steers at and what CollectableEscortAI
        // matches the docking collision against. Left stale, the fighter
        // flies at a ghost and can never dock or refund its round.
        // prepareCarriedEscorts already rewrites intra-batch references
        // through its uuid remap; this is the entry that lets the PLAYER
        // be remapped the same way (browser.ts threads it in as
        // CarriedEscort.priorPlayer).
        //
        // Additive and optional, so this is not a schema break: a save
        // without it (v1, v2-before-this-field, or an escortless pilot)
        // decodes exactly as before and simply carries no remap entry.
        // SAVE_VERSION deliberately does NOT move — bumping it would make
        // every OLDER build quarantine saves written by this one, whereas
        // an unknown field is ignored by the non-exact codec.
        playerUuid: t.string,
    }),
]);
export type SaveData = t.TypeOf<typeof SaveData>;

/** The versioned envelope actually stored in localStorage. */
export const SaveEnvelope = t.type({
    version: t.number,
    data: SaveData,
});
export type SaveEnvelope = t.TypeOf<typeof SaveEnvelope>;

/**
 * How control bits are translated for a save (see
 * control_bit_namespaces.ts): the resolver for the CURRENT plug-in set,
 * and the pairs parked at load that must ride along unchanged.
 */
export interface ControlBitSaveOptions {
    resolver: ControlBitResolver;
    parked?: readonly ControlBitPair[];
}

/**
 * Builds a save payload from the player's ship entity and the id of the
 * system it is in. Reads existing components; does not mutate the entity.
 * Returns undefined if the entity is missing the ship type, in which case
 * there is nothing meaningful to persist.
 *
 * `controlBits` supplies the namespace resolver; without one only the
 * legacy physical-number field is written (tests, and callers with no
 * game data to hand).
 */
export function extractSaveData(entity: Entity, systemId: string,
    controlBits?: ControlBitSaveOptions): SaveData | undefined {
    const ship = entity.components.get(ShipComponent);
    if (!ship) {
        return undefined;
    }
    const outfitsState = entity.components.get(OutfitsStateComponent);
    const outfits: SavedOutfit[] = outfitsState
        ? [...outfitsState].map(([id, { count }]) => [id, count])
        : [];
    const save: SaveData = {
        ship: ship.id,
        outfits,
        system: systemId,
    };

    const credits = entity.components.get(CreditsComponent);
    if (credits) {
        save.credits = credits.credits;
    }
    const date = entity.components.get(GameDateComponent);
    if (date) {
        save.date = date;
    }
    const missions = entity.components.get(MissionsComponent);
    if (missions) {
        save.missions = [...missions];
    }
    const bits = entity.components.get(ControlBitsComponent);
    if (bits) {
        // Sorted so the same bit set always writes the same bytes.
        save.novaControlBits = [...bits].sort((a, b) => a - b)
            .map(bit => [String(bit), 1]);
        if (controlBits) {
            save.controlBits = sortControlBitPairs([
                ...controlBits.resolver.toPairs(bits),
                ...(controlBits.parked ?? []),
            ]);
        }
    }
    if (controlBits) {
        save.plugins = [...controlBits.resolver.pluginOrder];
    }
    const ranks = entity.components.get(ActiveRanksComponent);
    if (ranks) {
        // Sorted so the same active set always writes the same bytes.
        save.ranks = [...ranks].sort();
    }
    const cargo = entity.components.get(CargoComponent);
    if (cargo) {
        save.cargo = [...cargo];
    }
    const cronStates = entity.components.get(CronStatesComponent);
    if (cronStates) {
        save.cronStates = [...cronStates];
    }
    const records = entity.components.get(LegalRecordsComponent);
    if (records) {
        save.reputations = [...records];
    }
    const rating = entity.components.get(CombatRatingComponent);
    if (rating) {
        save.combatRatings = [['kills', rating.kills]];
    }
    return save;
}

/** What restorePlayerState could not put on the entity. */
export interface RestoredPlayerState {
    /**
     * Saved control bits no loaded plug-in can represent (see
     * control_bit_namespaces.ts). Hand them back to extractSaveData so
     * they survive until their plug-in is installed again.
     */
    parkedControlBits: ControlBitPair[];
}

/**
 * Applies the optional player-state fields of a save onto the player
 * entity's components. The required fields (ship/outfits/system) are
 * consumed by the spawn path in browser.ts; this handles the rest.
 *
 * Control bits: the namespaced `controlBits` pairs are preferred, mapped
 * to physical bits under `resolver` (a default resolver, knowing no
 * plug-ins, when none is given — stock bits still map, plug-in bits park).
 * A save with only the legacy `novaControlBits` numbers goes through the
 * best-effort migration.
 */
export function restorePlayerState(entity: Entity, save: SaveData,
    resolver: ControlBitResolver = new ControlBitResolver()):
    RestoredPlayerState {
    const restored: RestoredPlayerState = { parkedControlBits: [] };
    if (save.credits !== undefined) {
        entity.components.set(CreditsComponent, { credits: save.credits });
    }
    if (save.date) {
        entity.components.set(GameDateComponent, { ...save.date });
    }
    if (save.missions) {
        entity.components.set(MissionsComponent, new Map(
            save.missions.map(([id, mission]) => [id, { ...mission }])));
    }
    if (save.controlBits) {
        const { physical, parked } = resolver.fromPairs(save.controlBits);
        // Belt and braces: a save written by this build has the same bit
        // set in both fields, but the legacy list may have been updated
        // by an OLDER build in between (which does not know the pairs),
        // and a bit is only ever lost by mistake — so any legacy number
        // the pairs do not account for is unioned in through the legacy
        // migration rather than dropped.
        const legacy = legacyNumbers(save);
        const covered = new Set(physical);
        // A stock-range number that a loaded plug-in claims privately is
        // represented by the plug-in's physical bit, not by itself.
        for (const bit of physical) {
            const [, raw] = resolver.pair(bit);
            covered.add(raw);
        }
        // A private-range physical number is only meaningful under the
        // plug-in set that wrote it, so those are unioned only when the
        // save's manifest matches the current set.
        const samePluginSet = samePlugins(save.plugins ?? [], resolver.pluginOrder);
        const missing = legacy.filter(bit => !covered.has(bit)
            && (bit < FIRST_PRIVATE_PHYSICAL_CONTROL_BIT || samePluginSet));
        if (missing.length > 0) {
            const extra = resolver.migrateLegacy(missing);
            for (const bit of extra.physical) {
                physical.add(bit);
            }
            parked.push(...extra.parked);
            console.warn('The save\'s legacy control bit list has bits its '
                + 'namespaced list lacks; keeping them: '
                + missing.map(bit => `b${bit}`).join(', '));
        }
        entity.components.set(ControlBitsComponent, physical);
        restored.parkedControlBits = sortControlBitPairs(parked);
    } else if (save.novaControlBits) {
        const { physical, parked } = resolver.migrateLegacy(legacyNumbers(save));
        entity.components.set(ControlBitsComponent, physical);
        restored.parkedControlBits = parked;
    }
    if (save.plugins && !samePlugins(save.plugins, resolver.pluginOrder)) {
        console.info('The save was written under a different plug-in set '
            + `(${describePlugins(save.plugins)}); now `
            + `${describePlugins(resolver.pluginOrder)}. Control bits of `
            + 'plug-ins that are no longer loaded are kept for when they are.');
    }
    if (save.ranks) {
        entity.components.set(ActiveRanksComponent, new Set(save.ranks));
    }
    if (save.cargo) {
        entity.components.set(CargoComponent, new Map(save.cargo));
    }
    if (save.cronStates) {
        entity.components.set(CronStatesComponent, new Map(
            save.cronStates.map(([id, state]) => [id, { ...state }])));
    }
    if (save.reputations) {
        entity.components.set(LegalRecordsComponent,
            new Map(save.reputations));
    }
    if (save.combatRatings) {
        const kills = save.combatRatings
            .find(([category]) => category === 'kills')?.[1];
        if (kills !== undefined) {
            entity.components.set(CombatRatingComponent, { kills });
        }
    }
    return restored;
}

/** The legacy `novaControlBits` field as numbers (garbage skipped). */
function legacyNumbers(save: SaveData): number[] {
    return (save.novaControlBits ?? [])
        .map(([bit]) => parseInt(bit, 10))
        .filter(bit => !Number.isNaN(bit));
}

function samePlugins(a: readonly string[], b: readonly string[]): boolean {
    return a.length === b.length && a.every((p, i) => p === b[i]);
}

function describePlugins(plugins: readonly string[]): string {
    return plugins.length === 0 ? 'no plug-ins' : plugins.join(', ');
}

/**
 * An escort as the client's rosters and the display world hold it: the
 * uuid it is filed under, and its entity. Structurally the part of
 * spaceport/landed_escorts.ts's CarriedEscort that a save needs — the
 * owning player is implicit, because a save only ever holds the local
 * player's escorts.
 */
export interface EscortToSave {
    readonly uuid: string;
    readonly entity: Entity;
}

/**
 * A client roster entry, structurally. Matches
 * spaceport/landed_escorts.ts's CarriedEscort without importing it, so the
 * save schema stays independent of the spaceport.
 */
export interface RosterEscort extends EscortToSave {
    readonly player: string;
}

/**
 * Every escort belonging to `player` that a client can account for, from
 * the two places one can be: live in the system (the player is IN FLIGHT)
 * and held on a client roster (the player is DOCKED, or a batch is riding
 * a jump). Callers pass both, because the two overlap during a landing —
 * an escort still flying down to the planet is in the world while its
 * already-landed wingmates are on the roster — and an escort must be
 * written exactly once either way.
 *
 * Unioned by uuid, then sorted by uuid, so the saved order depends on
 * neither entity-map iteration order nor which roster an escort was in.
 * Entries for other players are ignored: in multiplayer the rosters hold
 * peers' escorts too, and those are not this pilot's to save.
 */
export function collectEscortsToSave(player: string,
    inWorld: Iterable<[string, Entity]>,
    rosters: Iterable<readonly RosterEscort[]>): EscortToSave[] {
    const found = new Map<string, Entity>();
    for (const [uuid, entity] of inWorld) {
        if (entity.components.get(PlayerEscortComponent)?.player === player) {
            found.set(uuid, entity);
        }
    }
    for (const roster of rosters) {
        for (const carried of roster) {
            if (carried.player === player) {
                found.set(carried.uuid, carried.entity);
            }
        }
    }
    return [...found]
        .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
        .map(([uuid, entity]) => ({ uuid, entity }));
}

/**
 * Encodes escorts for the save. One blob per escort, in the order given
 * (the caller's order is already deterministic — uuid-sorted rosters and
 * entity-map iteration; see prepareCarriedEscorts).
 *
 * An escort the serializer cannot encode is skipped with a warning rather
 * than failing the whole save: losing one escort is a far better outcome
 * than losing the pilot's credits, missions, and reputation because of it.
 */
export function extractSavedEscorts(escorts: Iterable<EscortToSave>,
    serializer: Serializer): SavedEscort[] {
    const saved: SavedEscort[] = [];
    for (const { uuid, entity } of escorts) {
        try {
            saved.push({ uuid, entity: serializer.encode(entity) });
        } catch (e) {
            console.warn(`Skipping escort ${uuid} in the save; `
                + `it could not be serialized:`, e);
        }
    }
    return saved;
}

/**
 * Decodes a save's escorts back into entities, ready to be handed to
 * prepareCarriedEscorts under their OLD uuids (which is what makes the
 * intra-batch carrier remapping work — see SavedEscort).
 *
 * A blob that no longer decodes is skipped with a warning, not thrown:
 * this is the containment for the entity-codec wire-compatibility risk in
 * the module comment. The rest of the batch, and the whole of the rest of
 * the save, still load. A save whose `escorts` field is structurally wrong
 * never reaches here at all — `decodeSave` rejects it and `loadSave`
 * quarantines the file.
 */
export function restoreSavedEscorts(
    escorts: readonly SavedEscort[] | undefined, serializer: Serializer):
    Array<{ uuid: string, entity: Entity }> {
    const restored: Array<{ uuid: string, entity: Entity }> = [];
    for (const { uuid, entity } of escorts ?? []) {
        const decoded = serializer.decode(entity);
        if (isLeft(decoded)) {
            console.warn(`Dropping saved escort ${uuid}; its entity no `
                + `longer decodes: `
                + serializer.describeDecodeFailure(entity, decoded.left));
            continue;
        }
        restored.push({ uuid, entity: decoded.right });
    }
    return restored;
}

/** Wraps a payload in the current versioned envelope. */
export function makeEnvelope(data: SaveData): SaveEnvelope {
    return { version: SAVE_VERSION, data };
}

/** Serializes an envelope to the JSON string stored in localStorage. */
export function encodeSave(data: SaveData): string {
    return JSON.stringify(SaveEnvelope.encode(makeEnvelope(data)));
}

/**
 * Parses and validates a stored save string.
 *
 * Returns the decoded `SaveData` on success. Returns undefined for any
 * unreadable input — malformed JSON, wrong shape, or a version this build
 * doesn't understand — so callers can fall back to defaults. Never throws.
 */
export function decodeSave(raw: string | null | undefined):
    SaveData | undefined {
    if (raw == null) {
        return undefined;
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return undefined;
    }
    const envelope = SaveEnvelope.decode(parsed);
    if (isLeft(envelope)) {
        return undefined;
    }
    const { version } = envelope.right;
    if (version < MIN_READABLE_SAVE_VERSION || version > SAVE_VERSION) {
        // A save this build cannot read: either older than the oldest
        // shape we still understand, or newer than anything we know
        // about. Treat it as unreadable so it gets quarantined rather
        // than misinterpreted.
        return undefined;
    }
    // Versions inside the range decode with the current codec because
    // every step between them only added optional fields; the envelope
    // above has already validated that. Nothing to migrate.
    return envelope.right.data;
}

/**
 * A minimal storage surface so this module is testable without a browser.
 * `localStorage` satisfies it.
 */
export interface SaveStorage {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
}

/**
 * Which storage key the load/write/reset functions below act on.
 *
 * Multi-pilot support (title/pilot_registry.ts) gives every pilot its own
 * save key and points this at the active one; the default is the legacy
 * single slot, which is also the migrated first pilot's key, so nothing
 * that has not opted in sees a change.
 */
let activeSaveKey: string = SAVE_KEY;

/** Points the save functions at `key` (falsy resets to the legacy slot). */
export function setActiveSaveKey(key: string | null | undefined): void {
    activeSaveKey = key || SAVE_KEY;
}

/** The save key currently in use. */
export function getActiveSaveKey(): string {
    return activeSaveKey;
}

/** Where an unreadable save under `key` is parked. */
export function quarantineKeyFor(key: string): string {
    return `${key}:quarantine`;
}

function getStorage(storage?: SaveStorage): SaveStorage | undefined {
    if (storage) {
        return storage;
    }
    try {
        return typeof localStorage !== 'undefined' ? localStorage : undefined;
    } catch {
        // Accessing localStorage can throw (e.g. disabled cookies).
        return undefined;
    }
}

/**
 * Loads the save from storage. If a save is present but unreadable, it is
 * moved to the quarantine key (preserving the bad data for inspection) and
 * undefined is returned so the game starts from defaults.
 */
export function loadSave(storage?: SaveStorage): SaveData | undefined {
    const store = getStorage(storage);
    if (!store) {
        return undefined;
    }
    const key = activeSaveKey;
    let raw: string | null;
    try {
        raw = store.getItem(key);
    } catch {
        return undefined;
    }
    if (raw == null) {
        return undefined;
    }
    const data = decodeSave(raw);
    if (data === undefined) {
        // Park the unreadable save instead of dropping it silently.
        const quarantine = quarantineKeyFor(key);
        try {
            store.setItem(quarantine, raw);
            store.removeItem(key);
        } catch {
            // Best effort; ignore storage failures.
        }
        console.warn(
            `Ignoring an unreadable save (moved to '${quarantine}').`);
        return undefined;
    }
    return data;
}

/** Writes a save payload to storage. Never throws. */
export function writeSave(data: SaveData, storage?: SaveStorage): void {
    const store = getStorage(storage);
    if (!store) {
        return;
    }
    try {
        store.setItem(activeSaveKey, encodeSave(data));
    } catch (e) {
        console.warn('Failed to write save', e);
    }
}

/** Clears the current save (leaves any quarantined save alone). */
export function resetSave(storage?: SaveStorage): void {
    const store = getStorage(storage);
    if (!store) {
        return;
    }
    try {
        store.removeItem(activeSaveKey);
    } catch {
        // Ignore.
    }
    // A new pilot starts with nothing explored. The exploration record is
    // client-local UI state kept beside the save (explored_store.ts); a
    // dynamic import avoids a static save_game <-> explored_store cycle.
    void import('./explored_store.js').then(
        ({ resetExplored }) => resetExplored(storage),
        () => { /* ignore */ });
}
