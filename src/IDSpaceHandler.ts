import { BaseResource } from "novadatainterface/BaseResource";
import { NovaDataType, NovaDataInterface, NovaIDNotFoundError } from "novadatainterface/NovaDataInterface";
import { GameDataInterface } from "novadatainterface/GameDataInterface";
import { Gettable } from "novadatainterface/Gettable";
import { CachelessGettable } from "./CachelessGettable";
import { NovaResources, ResourceHolderBase, NovaResourceType } from "./ResourceHolderBase";
import * as fs from "fs";
import * as path from "path";
import { NovaResourceBase } from "./resourceParsers/NovaResourceBase";
import { readNovaFile } from "./readNovaFile";

// type IDSpace = {
//     [index: string]: { // ResourceType
//         [index: number]: BaseResource // Resource ID
//     }
// };


class IDSpaceHandler {
    private globalResources: Promise<NovaResources>;
    private tmpBuildingResources: NovaResources;

    constructor(novaFilesPath: string, novaPluginsPath: string) {
        this.tmpBuildingResources = {
            resources: {},
            prefix: null
        };

        // Initialize resources
        for (let i in NovaDataType) {
            var val = NovaDataType[i];
            this.tmpBuildingResources.resources[val] = {};
        }

        this.globalResources = this.build(novaFilesPath, novaPluginsPath);
    }

    private async build(novaFilesPath: string, novaPluginsPath: string) {
        await this.addNovaFilesDirectory(novaFilesPath);
        await this.addNovaPluginsDirectory(novaPluginsPath);
        return this.tmpBuildingResources;
    }

    // Returns the IDSpace of namespace 'prefix'
    public async getIDSpace(prefix: string | null = null): Promise<NovaResources> {
        await this.globalResources;
        return this.getIDSpaceUnsafe(prefix);
    }

    // Gets the ID Space without requiring that everything be parsed
    // Used in parsing.
    private getIDSpaceUnsafe(prefix: string | null = null): NovaResources {
        var globalResources = this.tmpBuildingResources;
        return {
            prefix,
            resources: new Proxy(globalResources.resources, {
                get: (target, dataType) => {
                    if (typeof dataType === "symbol") {
                        throw new Error("Can't access by symbol");
                    }

                    var idList = Reflect.get(target, dataType);
                    return new Proxy(idList, {

                        // Replace requests for 324 with prefix:324
                        get: (target, localID) => {
                            if (typeof localID === "symbol") {
                                throw new Error("Can't access by symbol");
                            }
                            var globalID = prefix + ":" + localID;
                            return Reflect.get(target, globalID);
                        },

                        // Replace setting 324 with setting prefix:324
                        set: (target, localID, value) => {
                            if (typeof localID === "symbol") {
                                throw new Error("Can't set by symbol");
                            }
                            var globalID = prefix + ":" + localID;
                            return Reflect.set(target, globalID, value);
                        }
                    });
                }
            })
        }
    }


    // Adds the Nova Plug-ins directory
    async addNovaPluginsDirectory(pluginsPath: string) {
        if (!isDirectory(pluginsPath)) {
            throw new Error("Plug-ins must be a directory. Got " + pluginsPath + " instead");
        }

        if (!(path.basename(pluginsPath) == "Plug-ins")) {
            console.warn("Plug-ins parser given a directory called " + path.basename(pluginsPath) + " instead of Plug-ins");
        }

        var fileNames = await readdir(pluginsPath);
        for (let i in fileNames) {
            var name = fileNames[i];
            var currentPath = path.join(pluginsPath, name);
            var prefix = name.split(".")[0]; // Cut off extensions

            if (isDirectory(currentPath)) {
                await this.addDirectory(currentPath, prefix);
            }
            else {
                await this.addPlugin(currentPath, prefix);
            }
        }
    }

    // Adds the Nova Files directory
    async addNovaFilesDirectory(filePath: string) {
        this.addDirectory(filePath, "nova");
    }

    // Adds a directory under a single ID prefix
    async addDirectory(dirPath: string, prefix: string) {
        if (!isDirectory(dirPath)) {
            throw new Error("Must be a directory. Got " + dirPath + " instead");
        }

        var fileNames = await readdir(dirPath);
        for (let i in fileNames) {
            var name = fileNames[i];
            var currentPath = path.join(dirPath, name);
            await this.addPlugin(currentPath, prefix);
        }
    }

    // Adds a Nova Plug-in 
    async addPlugin(filePath: string, prefix: string) {
        // Can't await this.getIDSpace because that causes an infinite loop
        // (getIDSpace awaits this.globalResources which depends on this function)
        await readNovaFile(filePath, this.getIDSpaceUnsafe(prefix));
    }
}

function isDirectory(path: string): Promise<boolean> {
    return new Promise(function(fulfill, reject) {
        fs.stat(path, function(err, stats): void {
            if (err) {
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




export { IDSpaceHandler, NovaIDNotFoundError };
