/**
 * ============================================================================
 * Building the player at session start
 * ============================================================================
 *
 * The ship the session starts with and the system it starts in, from
 * (in priority order) the URL's ?ship / ?system / ?char overrides, the
 * saved game, and the scenario's chär "player start". A fresh pilot
 * gets the chär's credits, date, OnStart control bits, legal statuses
 * and combat rating; a saved pilot gets its state restored
 * (nova_plugin/session/save_game.ts's restorePlayerState).
 *
 * Also stashes what the save carries that no component holds until a
 * world exists: the escorts (as encoded blobs, decoded at the first
 * system entry — see FleetLedger.restoredSave) and the control-bit
 * namespace context the save is written back through.
 */
import { Entity } from 'nova_ecs/entity';
import { MultiplayerData } from 'nova_ecs/plugins/multiplayer_plugin';
import {
    ControlBitResolver,
} from '../nova_plugin/ncb/control_bit_namespaces.js';
import { playerDiscovery } from '../nova_plugin/player/discovery_store.js';
import { makeShip } from '../nova_plugin/ship/make_ship.js';
import {
    resolveNumberedResource, setStringPrefix, systemDiscoveryOperators,
} from '../nova_plugin/missions/mission_logic.js';
import { makeControlBitHooks, NCBParseError, runNCBSet } from '../nova_plugin/ncb/ncb.js';
import {
    commitActiveRanks, ControlBitsComponent,
} from '../nova_plugin/ncb/ncb_plugin.js';
import { OutfitsStateComponent } from '../nova_plugin/ship/outfit_plugin.js';
import { PlayerShipSelector } from '../nova_plugin/player/player_ship_plugin.js';
import {
    CreditsComponent, GameDateComponent,
} from '../nova_plugin/player/player_state_plugin.js';
import { initialRecordsFromGovtStatuses } from '../nova_plugin/reputation/reputation.js';
import {
    CombatRatingComponent, LegalRecordsComponent,
} from '../nova_plugin/reputation/reputation_plugin.js';
import {
    loadSave, resetSave, restoreClientSaveState, restorePlayerState,
    savedFleetArmament,
} from '../nova_plugin/session/save_game.js';
import { ControlledByComponent } from '../nova_plugin/player/ship_control.js';
import { ensurePlayerStateComponents } from '../spaceport/mission_session.js';
import { clearPilotProfile } from '../title/client_prefs.js';
import type { ClientRuntime } from './runtime.js';

export interface PlayerStart {
    /** The player's ship, fully built, ready for its first system entry. */
    readonly ship: Entity;
    /** The system to enter first. */
    readonly systemId: string;
}

/**
 * Builds the player for a new session. Side effects, all of them
 * deliberate: `?reset` wipes the save and profile first; the save's
 * client-local state (the discovery record) is restored; the checkpoint
 * baseline is loaded and the recorder installed; the save's escorts and
 * control-bit context are stashed on the runtime for the session.
 */
export async function preparePlayerStart(runtime: ClientRuntime,
    query: URLSearchParams, ownerUuid: string): Promise<PlayerStart> {
    const { gameData, fleet, saves } = runtime;
    const ids = await gameData.ids;
    // How this server namespaced the plug-ins' control bits: needed to
    // read a save's (namespace, bit) pairs and to write them.
    const controlBitResolver = new ControlBitResolver(
        await gameData.controlBitNamespaces);
    saves.controlBits = { resolver: controlBitResolver, parked: [] };

    // ?reset wipes the save before we read it, so a bad session can be
    // recovered by adding &reset to the URL.
    if (query.has('reset')) {
        resetSave();
        clearPilotProfile();
        console.info('Cleared the saved game (?reset).');
    }

    // The saved game (if any) provides defaults; explicit URL params
    // override it. A corrupt or old-version save is quarantined by
    // loadSave and we fall back to defaults.
    const save = loadSave();
    if (save) {
        // Client-local state the save carries but no component holds:
        // the star-system discovery record (discovery_store.ts).
        restoreClientSaveState(save);
    }
    // The pilot's checkpoint history: baseline for the in-flight change
    // detector, and the recorder for the landed venues' requests.
    saves.loadCheckpointBaseline();
    saves.installCheckpointRecorder();
    // Hand the saved escorts to the first system entry, which is the
    // only place with a serializer to decode them. Deliberately NOT
    // gated on `usingSavedShip`: escorts are ships of their own and
    // belong to the pilot, not to the hull they were flying beside, so a
    // ?ship= override keeps them. What bays this pilot actually owns is
    // resolved once here (the escorts themselves decode at a system
    // entry later, where there is no chance to await game data), from
    // the SAVE's outfits rather than from the hull we are about to build,
    // because the question is what the pilot had when the fighters were
    // written down — a ?ship= override must not change the answer.
    fleet.restoredSave = save
        ? {
            escorts: save.escorts,
            playerUuid: save.playerUuid,
            armament: save.escorts.length > 0
                ? await savedFleetArmament(save.outfits,
                    id => gameData.data.Outfit.get(id))
                : undefined,
        }
        : undefined;

    // A fresh pilot starts from a chär "player start": ship, credits,
    // date, systems, and its OnStart control bits. ?char=nova:129 picks
    // one; otherwise the scenario's default.
    let playerStart;
    try {
        const requestedChar = query.get('char');
        if (ids.PlayerStart.length > 0) {
            const starts = await Promise.all(ids.PlayerStart.map(
                id => gameData.data.PlayerStart.get(id)));
            playerStart = (requestedChar
                && starts.find(s => s.id === requestedChar))
                || starts.find(s => s.isDefault)
                || starts[0];
        }
    } catch (e) {
        console.warn('Failed to load player starts:', e);
    }

    // ?ship=nova:164 picks the player's ship; otherwise the saved ship,
    // otherwise the chär's starting ship, otherwise a random one.
    const requestedShip = query.get('ship');
    const savedShipValid = save && ids.Ship.includes(save.ship);
    const startShipValid = playerStart && ids.Ship.includes(playerStart.ship);
    let shipId = savedShipValid
        ? save!.ship
        : startShipValid
            ? playerStart!.ship
            : ids.Ship[Math.floor(Math.random() * ids.Ship.length)];
    // Only restore outfits when we actually use the saved ship: outfits
    // belong to a specific ship type.
    let usingSavedShip = savedShipValid;
    if (requestedShip) {
        if (ids.Ship.includes(requestedShip)) {
            shipId = requestedShip;
            usingSavedShip = save?.ship === requestedShip;
        } else {
            console.warn(`Unknown ship id '${requestedShip}'. Using ${shipId}.`);
        }
    }
    const shipData = await gameData.data.Ship.get(shipId);
    const ship = makeShip(shipData);
    // Restore owned outfits onto the ship. The staging derivers skip a
    // component that is already present, so setting OutfitsStateComponent
    // here preserves the saved loadout instead of the ship's stock one.
    if (usingSavedShip && save && save.outfits.length > 0) {
        ship.components.set(OutfitsStateComponent,
            new Map(save.outfits.map(([id, count]) => [id, { count }])));
    }
    ship.components.set(MultiplayerData, { owner: ownerUuid });
    ship.components.set(PlayerShipSelector, undefined);
    ship.components.set(ControlledByComponent, { peerId: ownerUuid });

    // Player state: restore it from the save, or start a fresh pilot
    // from the chär (credits, date, OnStart control bits, starting legal
    // statuses and combat rating).
    // THE RÄNK TABLE, warmed before either branch. Both of them resolve
    // ränk data synchronously through `getCached` — the chär OnStart's
    // Kxxx cascades, and the 0x0100 suppression facts baked into synced
    // state for the simulation (rank_logic.ts) — and a cold read there
    // would silently skip a cascade or bake an empty privilege set. The
    // table is tiny (a few dozen resources, batched into one POST), and
    // this is the one place in a session that can afford to wait for it.
    try {
        await Promise.all(ids.Rank.map(id => gameData.data.Rank.get(id)));
    } catch (e) {
        console.warn('Failed to load the rank table:', e);
    }
    const getRank = (id: string) => gameData.data.Rank.getCached(id);
    if (save) {
        saves.controlBits.parked = restorePlayerState(ship, save,
            controlBitResolver, getRank).parkedControlBits;
    } else if (playerStart) {
        // chär Govt1-4/Status1-4: the status applies to the govt and its
        // allies, negated for its enemies (reputation.ts). The pilot-file
        // importer extracts the same shape, so a future pilot import
        // lands here too.
        try {
            const govtIds = [...ids.Govt].sort();
            const allGovts = await Promise.all(govtIds.map(async id =>
                [id, await gameData.data.Govt.get(id)] as const));
            ship.components.set(LegalRecordsComponent,
                initialRecordsFromGovtStatuses(
                    playerStart.govtStatuses, allGovts));
        } catch (e) {
            console.warn('Failed to set starting legal records:', e);
        }
        ship.components.set(CombatRatingComponent,
            { kills: Math.max(0, playerStart.combatRating) });
        ship.components.set(GameDateComponent, { ...playerStart.date });
        ship.components.set(CreditsComponent,
            { credits: playerStart.credits });
        const bits = new Set<number>();
        const startRanks = new Set<string>();
        try {
            // New-pilot setup is player-local; plain randomness is fine
            // for R(a b) here (see the outfitter's runSetString). A chär
            // OnStart may grant a rank (Kxxx); the cascades need rank
            // data, which is fetched on demand from the cache. It may
            // also hand the pilot a piece of the map (Xxxx). This branch
            // only runs when there is no save to restore — a BRAND NEW
            // pilot — and the store is already pointed at that pilot's
            // own key (discovery_store's setDiscoveryStorageKey, which
            // save_game drives), so writing straight through is the
            // whole of the effect and it lands on the right pilot.
            const startSystemIds = new Set(ids.System);
            const startRankIds = new Set(ids.Rank);
            // Bare numbers in the OnStart string are scoped to the
            // plug-in that WROTE the chär (setStringPrefix — its
            // writerPrefix, not its id's prefix) and resolve stock-first
            // like every other numeric reference
            // (resolveNumberedResource). The id lists stand in as the
            // exists lookups so the resolution cannot depend on cache
            // warmth.
            const charPrefix = setStringPrefix(playerStart);
            runNCBSet(playerStart.onStart,
                makeControlBitHooks(bits, undefined, {
                    active: startRanks,
                    resolveId: id => resolveNumberedResource(id, charPrefix,
                        globalId => startRankIds.has(globalId)),
                    getRank,
                }, systemDiscoveryOperators(playerDiscovery,
                    charPrefix, id => startSystemIds.has(id))),
                Math.random);
        } catch (e) {
            if (e instanceof NCBParseError) {
                console.warn('Bad chär OnStart string:', e);
            } else {
                throw e;
            }
        }
        ship.components.set(ControlBitsComponent, bits);
        commitActiveRanks(ship, startRanks, getRank);
    }
    ensurePlayerStateComponents(ship);

    // ?system=nova:131 picks the starting system; otherwise the saved
    // system, otherwise the chär's start system, otherwise the default.
    const requestedSystem = query.get('system');
    const startSystems = playerStart?.systems.filter(
        id => ids.System.includes(id)) ?? [];
    let systemId = (save && ids.System.includes(save.system))
        ? save.system
        : startSystems.length > 0
            ? startSystems[Math.floor(Math.random() * startSystems.length)]
            : 'nova:130';
    if (requestedSystem) {
        if (ids.System.includes(requestedSystem)) {
            systemId = requestedSystem;
        } else {
            console.warn(`Unknown system id '${requestedSystem}'. `
                + `Using ${systemId}.`);
        }
    }
    return { ship, systemId };
}
