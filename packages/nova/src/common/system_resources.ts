/**
 * A system's resource list (#370): what a client entering the system
 * will need, split into DATA (game-data ids, the types the simulation
 * reads through SimulationGameData) and ASSETS (the art and sound the
 * display draws and plays there). Served per system by the server
 * (server/system_resources.ts) at `systemResourcesPath/<id>.json`; the
 * client warms it one jump ahead (client/next_hop_prefetch.ts).
 *
 * Shared by the server and the client, so it carries types only.
 */

/** The game-data types a system's DATA can name. */
export const SYSTEM_DATA_TYPES = [
    'Ship', 'Outfit', 'Weapon', 'Planet', 'System', 'Govt', 'Dude', 'Fleet',
    'Junk', 'Oops', 'SpriteSheet', 'Asteroid', 'Mission', 'Pers', 'Cron',
    'PlayerStart', 'Rank',
] as const;
export type SystemDataType = typeof SYSTEM_DATA_TYPES[number];

export interface SystemResourceAssets {
    /** Sprite sheets (frames + image): stellars, ships, shots, rocks,
     * explosions. Planets first, then the rest, sorted. */
    SpriteSheet: string[];
    /** bööms the system's ships, shots and rocks can set off. */
    Explosion: string[];
    /** snds: weapon fire and explosions. */
    Sound: string[];
    /** PICTs: the landable stellars' landscapes and bar pictures. */
    Pict: string[];
}

export interface SystemResourceList {
    systemId: string;
    /** Every id the system's genesis stages, by type, sorted. */
    data: { [T in SystemDataType]?: string[] };
    assets: SystemResourceAssets;
}
