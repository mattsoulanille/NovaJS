import { NovaParse } from "novaparse";

/**
 * The game server's parser over the Nova_Data root at `dataPath` (the
 * stock data plus every installed plug-in), or a REJECTION when two
 * installed plug-ins resolve to one namespace prefix — "Foo.rez" beside
 * "Foo.ndat", or names differing only in case (novaparse
 * id_space_handler.ts resolvePluginEntries, issue #310). The server
 * awaits this before it listens, so a conflict stops it from starting
 * (server.ts exits 1 with the error, which names both files) instead of
 * serving a data set in which one plug-in's ids silently overwrite the
 * other's and their private flag and control bits merge.
 *
 * Only the cheap Plug-ins directory check is awaited, not the full parse:
 * any other load failure surfaces through the parser's idSpace / ids
 * exactly as it did before.
 */
export async function loadServerNovaParse(dataPath: string): Promise<NovaParse> {
    const novaParse = new NovaParse(dataPath, false);
    await novaParse.pluginPrefixCheck;
    return novaParse;
}
