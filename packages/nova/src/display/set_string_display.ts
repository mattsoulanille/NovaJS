import { Entity } from 'nova_ecs/entity';
import { World } from 'nova_ecs/world';
import type { DisplayAssetDataInterface } from '../client/gamedata/display_asset_data.js';
import type { SimulationGameDataInterface } from '../client/gamedata/simulation_game_data.js';
import {
    DisplayAssetDataResource, SimulationGameDataResource,
} from '../nova_plugin/core/index.js';
import { expandMissionText } from '../nova_plugin/missions/index.js';
import { ActiveRanksComponent } from '../nova_plugin/ncb/index.js';
import { PlayerNamesComponent } from '../nova_plugin/player/index.js';
import { ShipComponent } from '../nova_plugin/ship/index.js';
import { MissionUniverse } from '../spaceport/mission_universe.js';
import { playerIdentitySubs } from '../spaceport/player_identity.js';
import {
    resolveSetStringSound, SetStringRequests,
} from '../spaceport/set_string_requests.js';
import { statusQuoteLine } from '../spaceport/status_quote.js';
import { showStatusMessage } from './status_message_plugin.js';
import { playUiSound } from './ui_sound.js';

/**
 * A `Qxxx` line expanded as the Bible says: "parsed for mission text tags
 * (e.g. <PSN> and <PRK>) but not text-selection tags" — the player's
 * identity tags over `player` (the display's mirror of the pilot, or the
 * held hull), and no dësc conditional resolved. The same expansion the
 * landed departure gives its lines (spaceport.ts buildLiftOffDeparture).
 */
export async function expandQuoteLine(line: string, player: Entity,
    universe: MissionUniverse): Promise<string> {
    const identity = await playerIdentitySubs(universe,
        player.components.get(ShipComponent)?.id, undefined,
        player.components.get(ActiveRanksComponent),
        player.components.get(PlayerNamesComponent));
    return expandMissionText(line, identity).trim();
}

/**
 * The status-line lines of `requests`' `Qxxx`s, picked and expanded (empty
 * picks dropped), in the order they ran.
 */
export async function quoteLines(displayAssets: DisplayAssetDataInterface,
    requests: Pick<SetStringRequests, 'statusQuotes'>,
    expand: (line: string) => Promise<string>): Promise<string[]> {
    const lines: string[] = [];
    for (const { stringId, prefix } of requests.statusQuotes) {
        const line = await statusQuoteLine(displayAssets, stringId, prefix);
        const text = line === undefined ? '' : (await expand(line)).trim();
        if (text) {
            lines.push(text);
        }
    }
    return lines;
}

/**
 * Plays `requests`' `Pxxx` sounds on `world`'s local UI channel (a set
 * string's sound is the player's own: it is never bridged to peers).
 */
export async function playSetStringSounds(world: World,
    displayAssets: DisplayAssetDataInterface,
    requests: Pick<SetStringRequests, 'sounds'>): Promise<void> {
    for (const sound of requests.sounds) {
        const id = await resolveSetStringSound(displayAssets, sound);
        if (id) {
            playUiSound(world, { id });
        } else {
            console.warn(`Set string P${sound.soundId}: no such sound.`);
        }
    }
}

/**
 * What an in-flight set string asked of the owning client's display
 * (spaceport/set_string_requests.ts): every `Qxxx`'s line on the status
 * line — in flight there is no stellar to leave, so the message is all of
 * it — and every `Pxxx`'s sound. A `Txxx`'s name already rode the record
 * (`shipName`). `player` is the mirror the lines' identity tags read;
 * `expand` overrides that expansion (the ship offers expand theirs with
 * the offering ship's tags too). A no-op on a world without display data.
 */
export async function presentSetStringRequests(world: World,
    requests: SetStringRequests, player: Entity,
    expand?: (line: string) => Promise<string>): Promise<void> {
    const displayAssets = world.resources.get(DisplayAssetDataResource);
    const gameData: SimulationGameDataInterface | undefined =
        world.resources.get(SimulationGameDataResource);
    if (!displayAssets || !gameData) {
        return;
    }
    await playSetStringSounds(world, displayAssets, requests);
    const universe = MissionUniverse.shared(gameData);
    for (const line of await quoteLines(displayAssets, requests,
        expand ?? (text => expandQuoteLine(text, player, universe)))) {
        showStatusMessage(world, line);
    }
}
