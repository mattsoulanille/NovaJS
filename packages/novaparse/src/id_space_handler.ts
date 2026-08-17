import * as fs from "fs";
import * as path from "path";
import { readNovaFile } from "./read_nova_file.js";
import { NovaResources, NovaResourceType, getEmptyNovaResources } from "./resource_parsers/resource_holder_base.js";
import { buildFlagNamespaceMap, FlagNamespaceMap, scanBaseFlagSet } from "./flag_namespace.js";
import {
    applyControlBitNamespaces, buildControlBitNamespaceMap, ControlBitNamespaceMap,
    scanBaseControlBitSet,
} from "./ncb_namespace.js";

class BadDirectoryStructureError extends Error { };

//const log = console.log;
const log = (_m: string) => { };

// Where the core data and (optionally) the plug-ins live, relative to the
// Nova_Data root. `novaPlugins: null` means "load no plug-ins at all" — used
// by tests so that results don't depend on which plug-ins happen to be
// installed in the developer's Nova_Data/Plug-ins directory.
export interface NovaSubPaths {
    novaFiles: string;
    novaPlugins: string | null;
}

export const DEFAULT_SUB_PATHS: NovaSubPaths = {
    novaFiles: "Nova\ Files",
    novaPlugins: "Plug-ins",
};

// Parses Nova Files and Plug-ins into resources
// without dealing with the interactions that resources might
// have with one another. A resource that references another resource
// will not use a globalID to do so. Also, ships, which, if they don't have
// a PICT available, will instead use the pict of the last ship to
// have the same baseImage, are not linked to the correct PICT at this stage.
// All interactions are handled by NovaParse.ts
/**
 * Names a plug-in's id/flag/control-bit namespace may not use: "nova" is
 * the stock namespace and "physical" is the save format's marker for a
 * bare physical control bit (nova/save_game). A plug-in file or directory
 * literally called one of these would collide (mis-homing or dropping its
 * bits on restore — review r12 M-2), so its prefix is suffixed and the
 * collision logged.
 */
export const RESERVED_PLUGIN_PREFIXES: ReadonlySet<string> =
    new Set(["nova", "physical"]);

/** The namespace prefix for a Plug-ins entry: its name minus extensions,
 * re-keyed away from the reserved names. */
export function pluginPrefixFor(fileName: string): string {
    const prefix = fileName.split(".")[0]; // Cut off extensions
    if (RESERVED_PLUGIN_PREFIXES.has(prefix)) {
        const rekeyed = prefix + "-plugin";
        console.warn(`Plug-in "${fileName}" uses the reserved namespace `
            + `"${prefix}"; it is loaded as "${rekeyed}".`);
        return rekeyed;
    }
    return prefix;
}

class IDSpaceHandler {
    private globalResources: Promise<NovaResources | Error>;
    private tmpBuildingResources: NovaResources;
    private novaFilesPath: string;
    // null when plug-in loading is explicitly disabled.
    private novaPluginsPath: string | null;
    // Plug-in id prefixes in the order they were first loaded. This is the
    // order the Require/Contribute flag namespaces are allocated in (see
    // flag_namespace.ts), so it must be — and is — a pure function of the
    // Plug-ins directory's contents (see addNovaPluginsDirectory).
    private pluginPrefixOrder: string[] = [];
    // The stock flag bits, snapshotted after the base "Nova Files" load and
    // before any plug-in does; and the finished mapping. Both are set by
    // build(); read the map through getFlagMap().
    private baseFlagSet: Set<number> | null = null;
    private flagMap: FlagNamespaceMap | null = null;
    // Likewise for the control bits (ncb_namespace.ts): the stock base set
    // and the finished mapping. Unlike the flag map, which parsers consult
    // on demand, this one is APPLIED to the raw resources once in build().
    private baseControlBitSet: Set<number> | null = null;
    private controlBitMap: ControlBitNamespaceMap | null = null;

    constructor(novaPath: string,
        { novaFiles, novaPlugins }: NovaSubPaths = DEFAULT_SUB_PATHS) {

        this.novaFilesPath = path.join(novaPath, novaFiles);
        this.novaPluginsPath = novaPlugins === null
            ? null : path.join(novaPath, novaPlugins);
        this.tmpBuildingResources = getEmptyNovaResources();
        this.globalResources = this.build().catch((e: Error) => {
            // Catch all promise rejections. They are instead handled when getting ID spaces.
            return e;
        });
    }

    private async build() {
        await this.addNovaFilesDirectory(this.novaFilesPath);
        // The base set of the flag space is defined by the stock data alone,
        // so it is taken now, before a plug-in can override anything.
        this.baseFlagSet = scanBaseFlagSet(this.tmpBuildingResources);
        this.baseControlBitSet = scanBaseControlBitSet(this.tmpBuildingResources);
        // A null plug-ins path is an explicit opt-out, not an error: the
        // caller wants base "Nova Files" data only.
        if (this.novaPluginsPath !== null) {
            await this.addNovaPluginsDirectory(this.novaPluginsPath);
        }
        // Allocate every plug-in-private flag bit up front, from the whole
        // loaded data set, so the mapping never depends on the order in
        // which resources later happen to be parsed (which is on demand).
        this.flagMap = buildFlagNamespaceMap(this.tmpBuildingResources,
            this.baseFlagSet, this.pluginPrefixOrder);
        // Same for the control bits, and then rewrite every NCB expression
        // in the raw resources to physical bit numbers, so no parser (and
        // nothing in the game) ever sees a raw plug-in bit number.
        this.controlBitMap = buildControlBitNamespaceMap(
            this.tmpBuildingResources, this.baseControlBitSet,
            this.pluginPrefixOrder);
        applyControlBitNamespaces(this.tmpBuildingResources, this.controlBitMap);
        return this.tmpBuildingResources;
    }

    /**
     * The Require/Contribute flag namespace mapping for the loaded data.
     * Rejects like getIDSpace when the core data failed to load.
     */
    public async getFlagMap(): Promise<FlagNamespaceMap> {
        var result = await this.globalResources;
        if (result instanceof Error) {
            throw result;
        }
        if (this.flagMap === null) {
            throw new Error("Flag namespace map was not built");
        }
        return this.flagMap;
    }

    /**
     * The control-bit namespace mapping for the loaded data (already
     * applied to the raw resources). Rejects like getIDSpace when the core
     * data failed to load.
     */
    public async getControlBitMap(): Promise<ControlBitNamespaceMap> {
        var result = await this.globalResources;
        if (result instanceof Error) {
            throw result;
        }
        if (this.controlBitMap === null) {
            throw new Error("Control bit namespace map was not built");
        }
        return this.controlBitMap;
    }

    /** Plug-in prefixes in load (= flag namespace allocation) order. */
    public async getPluginPrefixOrder(): Promise<string[]> {
        var result = await this.globalResources;
        if (result instanceof Error) {
            throw result;
        }
        return [...this.pluginPrefixOrder];
    }

    // Returns the IDSpace of namespace 'prefix'
    public async getIDSpace(prefix: string | null = null): Promise<NovaResources> {
        var result = await this.globalResources; // May be an error
        if (result instanceof Error) {
            throw result;
        }
        return this.getIDSpaceUnsafe(prefix);
    }

    // Gets the ID Space without requiring that everything be parsed
    // An ID space is a NovaResource that is constrained to a specific namespace, such as "plugin 1."
    // When it's asked for resources, it prepends all IDs given to it with
    // either "plugin 1:" or "nova:" depending on whether or not the ID already exists in the "nova"
    // namespace. It is used by nova resource parsers to reference other nova resources because those
    // references must occur in the correct namespace.
    private getIDSpaceUnsafe(prefix: string | null = null): NovaResources {
        var globalResources = this.tmpBuildingResources;

        if (prefix == null) {
            return globalResources;
        }

        return new Proxy(globalResources, {
            get: (target, resourceType) => {
                if (typeof resourceType === "symbol") {
                    console.warn("accessing resources by symbol");
                    return Reflect.get(target, resourceType);
                }

                var idList = Reflect.get(target, resourceType);
                if (!idList) {
                    Reflect.set(target, resourceType, {});
                    var idList = Reflect.get(target, resourceType);
                }

                return new Proxy(idList, {

                    // Replace requests for 324 with prefix:324
                    // or nova:324 if nova:324 exists
                    get: (target, localID) => {
                        if (typeof localID === "symbol") {
                            console.warn("accessing ids by symbol");
                            return Reflect.get(target, localID);
                        }
                        var novaScopeValue = Reflect.get(target, "nova:" + localID);
                        if (novaScopeValue) {
                            return novaScopeValue;
                        }
                        else {
                            var globalID = prefix + ":" + localID;
                            return Reflect.get(target, globalID);
                        }
                    },

                    // Replace setting 324 with setting prefix:324
                    // or nova:324 if nova:324 exists
                    set: (target, localID, value) => {
                        if (typeof localID === "symbol") {
                            throw new Error("Can't set by symbol");
                        }

                        // Assume it exists in the nova prefix
                        var usedPrefix = "nova";
                        var globalID = usedPrefix + ":" + localID;
                        if (!Reflect.get(target, globalID)) {
                            // It doesn't, so use its own prefix.
                            usedPrefix = prefix;
                            globalID = usedPrefix + ":" + localID;
                        }

                        // Setting the globalID here is necessary because
                        // this is the only place where it is known whether the prefix
                        // is "nova" or prefix. It's not the best practice...
                        value.globalID = globalID;
                        value.prefix = usedPrefix;
                        // Also the only place the WRITING plug-in is known:
                        // for an override usedPrefix is "nova", and which
                        // plug-in actually wrote it would otherwise be lost.
                        value.writerPrefix = prefix;


                        return Reflect.set(target, globalID, value);
                    }
                });
            }
        });
    }

    // Adds the Nova Plug-ins directory.
    //
    // Failure policy: a single broken third-party plug-in must NOT brick the
    // whole game. Each plug-in is parsed in isolation; if one fails to read or
    // parse (e.g. a missing/stripped resource fork throwing ENOENT), we log a
    // prominent error naming the exact file and the underlying exception, then
    // skip it and continue with the rest. Contrast with the core "Nova Files"
    // data, where any failure is fatal (see addNovaFilesDirectory).
    async addNovaPluginsDirectory(pluginsPath: string) {
        if (!(await isDirectory(pluginsPath))) {
            throw new BadDirectoryStructureError("Plug-ins must be a directory. Got " + pluginsPath + " instead");
        }

        if (!(path.basename(pluginsPath) == "Plug-ins")) {
            console.warn("Plug-ins parser given a directory called " + path.basename(pluginsPath) + " instead of Plug-ins");
        }

        // Plug-ins load in REVERSE NAME ORDER (a later-named plug-in's
        // stock override is overwritten by an earlier-named one's). The sort
        // is explicit rather than trusting readdir: on macOS readdir happens
        // to come back sorted, but that is not guaranteed on every
        // filesystem, and both which override wins and the allocation of
        // namespaced Require/Contribute flag bits (which follows this
        // order) must be identical on every peer of a networked game.
        var fileNames = (await readdir(pluginsPath)).sort().reverse();
        for (let i in fileNames) {
            var name = fileNames[i];
            var currentPath = path.join(pluginsPath, name);
            var prefix = pluginPrefixFor(name);
            if (!this.pluginPrefixOrder.includes(prefix)) {
                this.pluginPrefixOrder.push(prefix);
            }


            if (await isDirectory(currentPath)) {
                log(currentPath + " is a directory");
                await this.addDirectory(currentPath, prefix, /* fatalOnError */ false);
            }
            else {
                await this.addPluginSafe(currentPath, prefix);
            }
        }
    }

    // Adds the Nova Files directory.
    //
    // Failure policy: the core data is required for anything to work, so any
    // failure here propagates (is fatal) rather than being swallowed.
    async addNovaFilesDirectory(filePath: string) {
        if (!(await isDirectory(filePath))) {
            throw new BadDirectoryStructureError("Nova Files must be a directory. Got " + filePath + " instead");
        }

        await this.addDirectory(filePath, "nova", /* fatalOnError */ true);
    }

    // Adds a directory under a single ID prefix.
    // When fatalOnError is false (plug-in directories), a failure to read/parse
    // an individual file is logged and skipped rather than aborting everything.
    async addDirectory(dirPath: string, prefix: string, fatalOnError: boolean) {
        if (!(await isDirectory(dirPath))) {
            throw new BadDirectoryStructureError("Must be a directory. Got " + dirPath + " instead");
        }

        log("Adding Directory of plugins " + dirPath);

        // Sorted for the same reason as in addNovaPluginsDirectory: which
        // file's copy of a shared id wins must not depend on the filesystem.
        var fileNames = (await readdir(dirPath)).sort();
        for (let i in fileNames) {
            var name = fileNames[i];
            var currentPath = path.join(dirPath, name);
            if (fatalOnError) {
                await this.addPlugin(currentPath, prefix);
            } else {
                await this.addPluginSafe(currentPath, prefix);
            }
        }
    }

    // Wraps addPlugin so that a single unreadable/corrupt plug-in doesn't take
    // down the entire id space. Loudly logs the offending file and the
    // underlying error, then continues.
    async addPluginSafe(filePath: string, prefix: string): Promise<boolean> {
        try {
            return await this.addPlugin(filePath, prefix);
        } catch (e) {
            console.error(
                "\n" +
                "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!\n" +
                "NovaParse: FAILED to load plug-in file and SKIPPED it:\n" +
                "    " + filePath + "\n" +
                "Underlying error: " + errorDetail(e) + "\n" +
                "This plug-in's resources will be missing from the game. If it is a\n" +
                "macOS resource-fork file, check that its resource fork survived any\n" +
                "copy/transfer (see the xattr gotcha noted in addPlugin).\n" +
                "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!\n",
                e,
            );
            return false;
        }
    }

    // Adds a Nova Plug-in
    async addPlugin(filePath: string, prefix: string) {
        // Can't await this.getIDSpace because that causes an infinite loop
        // (getIDSpace awaits this.globalResources which depends on this function)

        var disallowedExtensions = new Set([".mp3", ".mov"]);
        if (disallowedExtensions.has(path.extname(filePath))) {
            return false;
        }

        log("Parsing " + filePath + " under prefix " + prefix);

        // This is the correct ID space because even though a plugin named,
        // for example, "cats", might have a resource that overwrites a nova resource,
        // that resource should still have access to all the other stuff in "cats"
        const resourceCount = await readNovaFile(filePath, this.getIDSpaceUnsafe(prefix));

        // A .plug / .ndat / .rez that parsed to zero resources almost always
        // means its resource fork is present-but-empty. On macOS the resource
        // fork lives in an extended attribute (com.apple.ResourceFork); copying
        // through a filesystem/tool that drops xattrs (zip, some cp, cloud sync,
        // git) silently strips it, leaving a forkless file that reads clean but
        // empty. Warn loudly so this doesn't manifest as mysteriously missing
        // ships/systems/planets down the line.
        if (resourceCount === 0 && likelyHasResources(filePath)) {
            console.warn(
                "\n" +
                "********************************************************************\n" +
                "NovaParse: plug-in parsed to ZERO resources:\n" +
                "    " + filePath + "\n" +
                "Its resource fork is likely empty. On macOS the resource fork is an\n" +
                "extended attribute; copying via a tool that drops xattrs (zip, some\n" +
                "cp invocations, cloud sync, git) silently strips it. Re-copy the\n" +
                "file preserving its resource fork (e.g. `cp -p`, `ditto`, or a DMG).\n" +
                "********************************************************************\n",
            );
        }

        return true;
    }
}

// Files that are expected to carry Nova resources. A zero-resource read from
// one of these is suspicious (empty/stripped resource fork).
function likelyHasResources(filePath: string): boolean {
    const resourceExtensions = new Set([".plug", ".ndat", ".rez", ".npif"]);
    const ext = path.extname(filePath).toLowerCase();
    // Classic Mac resource-fork plug-ins often have no extension at all.
    return resourceExtensions.has(ext) || ext === "";
}

// Renders an unknown thrown value into a readable, information-preserving
// string (name, message, code, and stack when available).
function errorDetail(e: unknown): string {
    if (e instanceof Error) {
        const code = (e as NodeJS.ErrnoException).code;
        const codePart = code ? " [" + code + "]" : "";
        return e.name + codePart + ": " + e.message + (e.stack ? "\n" + e.stack : "");
    }
    return String(e);
}

function isDirectory(path: string): Promise<boolean> {
    return new Promise(function(fulfill, reject) {
        fs.stat(path, (err, stats): void => {
            if (err) {
                if (err.code == "ENOENT") {
                    fulfill(false);
                }
                reject(err);
            }
            else {
                fulfill(stats.isDirectory());
            }
        });
    });
}


// Returns a list of files or directories in a directory.
function readdir(path: string): Promise<Array<string>> {
    return new Promise(function(fulfill, reject) {
        fs.readdir(path, function(err, files) {
            if (err) {
                reject(err);
            }
            else {
                fulfill(files.filter(function(p) {
                    return p[0] !== '.';
                }));
            }
        });
    });
}




export { IDSpaceHandler, BadDirectoryStructureError };
