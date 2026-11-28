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
        if (strings && strings.length > 0) {
            return strings[Math.min(strings.length - 1,
                Math.floor(random() * strings.length))];
        }
    }
    return undefined;
}
