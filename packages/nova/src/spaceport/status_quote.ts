import type { DisplayAssetDataInterface } from '../client/gamedata/display_asset_data.js';

/**
 * One line of STR# `stringId` for a `Qxxx` message, picked at random as
 * the Bible says ("randomly selected from the STR# resource with ID
 * xxx"), the number resolved stock-first like every sibling operator,
 * then under the running plug-in's own prefix. Display-only, so the pick
 * needs no shared random. Undefined when neither table exists or it is
 * empty.
 */
export async function statusQuoteLine(
    displayAssets: DisplayAssetDataInterface,
    stringId: number, prefix: string,
    random: () => number = Math.random): Promise<string | undefined> {
    for (const id of [`nova:${stringId}`, `${prefix}:${stringId}`]) {
        let strings: readonly string[] | undefined;
        try {
            strings = (await displayAssets.data.StringTable.get(id))?.strings;
        } catch {
            continue;
        }
        // The pick is among the NON-EMPTY lines: an empty one shows
        // nothing (and renames nothing). The HypergatePass plug-in's STR#
        // 25077-25079 hold one message and a run of empty strings, so a
        // pick over all of them would almost never show its "Your Four Day
        // HyperGate Pass has Expired." (GUESS: unmeasured; the original
        // shows what the plug-in's author evidently meant either way).
        const lines = strings?.filter(line => line.trim() !== '') ?? [];
        if (lines.length > 0) {
            return lines[Math.min(lines.length - 1,
                Math.floor(random() * lines.length))];
        }
    }
    return undefined;
}
