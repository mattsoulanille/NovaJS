import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { v4 } from "uuid";
import { multiplayer, MultiplayerData } from "nova_ecs/plugins/multiplayer_plugin";
import { MockCommunicator } from "nova_ecs/plugins/mock_communicator";
import { GameDataAggregator } from "../server/parsing/game_data_aggregator.js";
import { FilesystemData } from "../server/parsing/filesystem_data.js";
import { NovaParse } from "novaparse";
import { ControlBitResolver } from "../nova_plugin/control_bit_namespaces.js";
import { completeEntity } from "../nova_plugin/entity_data_loader.js";
import { makeShip } from "../nova_plugin/make_ship.js";
import { makeSystem } from "../nova_plugin/make_system.js";
import { PlayerShipSelector } from "../nova_plugin/player_ship_plugin.js";
import {
    SimulationBridgeClient,
    SimulationBridgeHost,
} from "./simulation_bridge.js";
import { SerializerResource } from "nova_ecs/plugins/serializer_plugin";

const packageRoot = process.cwd();

let gameDataPromise: Promise<GameDataAggregator> | undefined;

export async function getIntegrationGameData() {
    if (!gameDataPromise) {
        // Base "Nova Files" data ONLY (novaPlugins: null). Tests must not
        // depend on which plug-ins happen to be installed in the developer's
        // Nova_Data/Plug-ins directory — otherwise ids, ship/system/outfit
        // stats and even sorted-first ids change from machine to machine.
        // The dev server (server.ts / nova_parse_worker.ts) still loads
        // plug-ins as usual; only tests opt out.
        const novaParse = new NovaParse(path.join(packageRoot, "Nova_Data"), false,
            { novaFiles: "Nova Files", novaPlugins: null });
        novaParse.resourceNotFoundFunction = () => { };
        const aggregator = new GameDataAggregator([
            new FilesystemData(path.join(packageRoot, "objects")),
            novaParse,
        ], () => { });
        // The browser fetches settings over HTTP; in node, read them
        // from disk so worlds can build with the 'worker' platform
        // (which includes the control systems).
        (aggregator as { getSettings?(file: string): Promise<unknown> }).getSettings =
            async (file: string) => JSON.parse(await fs.promises.readFile(
                path.join(packageRoot, 'settings', file), 'utf8'));
        gameDataPromise = Promise.resolve(aggregator);
    }
    return gameDataPromise;
}

const pluginDataPromises = new Map<string, Promise<GameDataAggregator | undefined>>();

/**
 * Base "Nova Files" data PLUS exactly one named plug-in directory from
 * Nova_Data/Plug-ins — for specs that pin behaviour against real
 * third-party scenario data (the compatibility rules in nova_plugin/ncb.ts,
 * say). Resolves to undefined when that plug-in is not installed, so such a
 * spec can skip itself instead of failing on a machine (or CI) without it.
 *
 * Only the ONE plug-in is loaded, and it is loaded through a scratch
 * Nova_Data root of symlinks rather than the real Plug-ins directory. That
 * matters for the same reason getIntegrationGameData loads no plug-ins at
 * all: whatever else a developer happens to have installed must not shift
 * ids or stats underneath the spec. Symlinking (never copying) also keeps
 * the canonical data read-only and preserves the macOS resource forks the
 * parser reads.
 *
 * The plug-in's id prefix is its DIRECTORY name, which is why the directory
 * itself is the thing linked: pointing novaPlugins at it directly would
 * give each file inside its own prefix instead.
 */
export async function getPluginGameData(
    pluginDirectory: string | string[]):
    Promise<GameDataAggregator | undefined> {
    // Several plug-ins may be loaded together (for the specs about how
    // plug-ins interact, e.g. Require/Contribute flag namespacing). The
    // set is what matters, not the order given: NovaParse loads plug-ins
    // in a sorted order of its own regardless.
    const directories = [...new Set(
        typeof pluginDirectory === "string"
            ? [pluginDirectory] : pluginDirectory)].sort();
    const key = directories.join("+");
    let promise = pluginDataPromises.get(key);
    if (!promise) {
        promise = buildPluginGameData(directories);
        pluginDataPromises.set(key, promise);
    }
    return promise;
}

/**
 * The PHYSICAL control bit that plug-in `namespace`'s raw bit `bit` was
 * given under `gameData`'s plug-in set (see
 * nova_plugin/control_bit_namespaces.ts). Specs that drive a plug-in's
 * gates by its own bit numbers (`b9009` in Extra Outfits, say) must go
 * through this, because NovaParse renumbers plug-in-private bits.
 */
export async function pluginControlBit(gameData: GameDataAggregator,
    namespace: string, bit: number): Promise<number> {
    const resolver = new ControlBitResolver(await gameData.controlBitNamespaces);
    const physical = resolver.physicalBit([namespace, bit]);
    if (physical === undefined) {
        throw new Error(`Plug-in '${namespace}' has no control bit b${bit}`);
    }
    return physical;
}

async function buildPluginGameData(pluginDirectories: string[]):
    Promise<GameDataAggregator | undefined> {
    const novaParse = makePluginNovaParse(pluginDirectories);
    if (!novaParse) {
        return undefined;
    }
    return new GameDataAggregator([
        new FilesystemData(path.join(packageRoot, "objects")),
        novaParse,
    ], () => { });
}

/**
 * A FRESH, uncached NovaParse over base data plus the named plug-in
 * directories (see getPluginGameData for the scratch-root arrangement),
 * or undefined if any of them is not installed. For specs that need to
 * parse the same plug-in set more than once — the determinism of the
 * Require/Contribute flag namespacing, say. Prefer getPluginGameData
 * (cached, wrapped in the aggregator) for everything else.
 */
export function makePluginNovaParse(pluginDirectories: string[]):
    NovaParse | undefined {
    const novaData = path.join(packageRoot, "Nova_Data");
    const pluginPaths = pluginDirectories.map(
        dir => path.join(novaData, "Plug-ins", dir));
    if (!pluginPaths.every(p => fs.existsSync(p))) {
        return undefined;
    }
    // A fixed scratch root, reused across runs rather than a fresh mkdtemp
    // each time, so repeated test runs don't litter the temp directory.
    // Keyed by this checkout too: worktrees run these specs concurrently,
    // and a root shared between them would flip the links under a
    // running parse (and go stale when the worktree that made it is
    // removed).
    const checkoutKey = crypto.createHash("sha1").update(packageRoot)
        .digest("hex").slice(0, 8);
    const root = path.join(os.tmpdir(),
        `novajs-plugin-fixture-${checkoutKey}-${pluginDirectories.join("+")}`);
    fs.mkdirSync(path.join(root, "Plug-ins"), { recursive: true });
    linkOnce(path.join(novaData, "Nova Files"), path.join(root, "Nova Files"));
    for (let i = 0; i < pluginDirectories.length; i++) {
        linkOnce(pluginPaths[i],
            path.join(root, "Plug-ins", pluginDirectories[i]));
    }

    const novaParse = new NovaParse(root, false,
        { novaFiles: "Nova Files", novaPlugins: "Plug-ins" });
    novaParse.resourceNotFoundFunction = () => { };
    // The one-time flag namespacing diagnostics are for people loading a
    // real Plug-ins folder, not for the test log.
    novaParse.flagNamespaceWarn = () => { };
    novaParse.controlBitNamespaceWarn = () => { };
    return novaParse;
}

function linkOnce(target: string, link: string) {
    // lstat, not existsSync: a DANGLING link (its worktree was removed)
    // reports as absent and the symlink then fails with EEXIST. Re-point
    // anything that is not already the wanted link.
    try {
        if (fs.readlinkSync(link) === target) {
            return;
        }
        fs.unlinkSync(link);
    } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
            throw e;
        }
    }
    fs.symlinkSync(target, link);
}

export async function makeSimulationBridgeHarness() {
    const gameData = await getIntegrationGameData();
    const ids = await gameData.ids;
    const systemId = [...ids.System].sort()[0];
    const shipId = [...ids.Ship].sort()[0];

    if (!systemId) {
        throw new Error("Expected at least one system id");
    }
    if (!shipId) {
        throw new Error("Expected at least one ship id");
    }

    // No NPC traffic: this harness is a controlled battlefield. With
    // base data only, the sorted-first ids are the stock sÿst nova:1124
    // (Procyon, AvgShips 1) and shïp nova:128 (the Shuttle); ambient
    // spawns would still make the battlefield nondeterministic to
    // reason about, so they stay off.
    const world = await makeSystem(systemId, gameData, undefined,
        { npcs: false });
    const communicator = new MockCommunicator("server");
    await world.addPlugin(multiplayer(communicator));

    const shipData = await gameData.data.Ship.get(shipId);
    const ship = makeShip(shipData);
    const shipUuid = v4();
    ship.components.set(MultiplayerData, { owner: "server" });
    ship.components.set(PlayerShipSelector, undefined);
    await completeEntity(world, ship);
    world.entities.set(shipUuid, ship);

    for (let i = 0; i < 10; i++) {
        world.step();
    }

    const serializer = world.resources.get(SerializerResource);
    if (!serializer) {
        throw new Error("Expected simulation serializer resource");
    }

    const host = new SimulationBridgeHost(world, gameData);
    const client = new SimulationBridgeClient(host, serializer);

    return {
        client,
        gameData,
        shipId,
        shipUuid,
        systemId,
        world,
    };
}
