import { getDefaultPictData } from 'novadatainterface/pict_data';

/**
 * Whether a PICT id is the parser's "no picture" placeholder: an oütf or
 * shïp with no PICT of its own (common in plug-ins) carries
 * getDefaultPictData().id, "default", as its pict. The server answers 404
 * for that id (it serves no placeholder image), so loading it only
 * produced a 404 and, from PIXI's image loader, an unhandled rejection
 * whose reason is the bare error Event ("Event: Event" in headless logs,
 * Forgejo #372). DisplayAssetData draws such a pict as nothing instead.
 *
 * Its own module so a node spec can check it: display_asset_data.ts pulls
 * in @pixi/sound, which touches `document` at import.
 */
export function isNoPict(id: string): boolean {
    return id === getDefaultPictData().id;
}
