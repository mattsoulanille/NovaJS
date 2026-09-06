import { Plugin } from "nova_ecs/plugin";
import { CLOAK_OFF_SOUND, CLOAK_ON_SOUND } from "../nova_plugin/ship/cloak_plugin.js";
import { DisplayAssetDataResource } from "../nova_plugin/core/game_data_resource.js";

/**
 * Pre-warms the cloak sounds. The sounds themselves are emitted by the
 * sim's cloak systems on the PlayerSoundEvent channel, targeted at the
 * cloaking ship (see cloak_plugin.ts) — the display's PlayerSoundSystem
 * plays them only for the local player's ship, same as the warp sounds.
 * This plugin just makes sure the assets are cached so the first cloak
 * edge isn't silent while the sound loads.
 */
export const CloakSoundPlugin: Plugin = {
    name: 'CloakSoundPlugin',
    build(world) {
        const displayAssets = world.resources.get(DisplayAssetDataResource);
        displayAssets?.data.Sound.get(CLOAK_ON_SOUND);
        displayAssets?.data.Sound.get(CLOAK_OFF_SOUND);
    },
};
