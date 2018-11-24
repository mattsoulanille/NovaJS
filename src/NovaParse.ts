import * as fs from "fs";
import * as path from "path";
import { GameDataInterface } from "novadatainterface/GameDataInterface";
import { NovaDataInterface } from "novadatainterface/NovaDataInterface";
import { IDSpaceHandler } from "./IDSpaceHandler";



class NovaParse implements GameDataInterface {
    public data: NovaDataInterface;
    path: string
    private ids: IDSpaceHandler;
    constructor(dataPath: string) {
        this.path = path.join(dataPath);
        this.data = {};
        this.ids = new IDSpaceHandler();
    }

    // Returns a list of files or directories in a directory.
    readdir(path: string): Promise<Array<string>> {
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

    isDirectory(path: string): Promise<boolean> {
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

    async read() {

        // Nova files must be shallowly placed in Nova Files
        var novaFiles = await this.readdir(path.join(this.path, "Nova Files"));

        // Each file / directory in Plug-ins gets its own id space (tied to nova files id space)
        // see idSpace.js for more info
        var novaPlugins = await this.readdir(path.join(this.path, "Plug-ins"));
        await this.readNovaFiles(novaFiles);
        await this.readPlugins(novaPlugins);
        this.makeShipBaseImagePictMap();

    }

    async readNovaFiles(novaFiles: Array<string>) {
        // some total conversions may expect that later files will
        // overwrite earlier ones, so novaFiles must be read in order
        for (var fileIndex in novaFiles) {
            var novaFileName = novaFiles[fileIndex];
            var pathTo = path.join(this.path, "Nova Files", novaFileName);
            if (pathTo.slice(-5) !== ".ndat") {
                continue; // don't read the nova music or the quicktime movies
            }

            var novaFile = this.readRF(pathTo);
            await novaFile.read();
            var parsed = this.parse(novaFile.resources);
            this.ids.addNovaData(parsed);
        }
    }


    async readPlugins(novaPlugins: Array<string>) {
        // these may overwrite the same data in nova files
        // so they must be read in order
        for (var pluginIndex in novaPlugins) {
            var idPrefix = novaPlugins[pluginIndex];
            var pathTo = path.join(this.path, "Plug-ins", idPrefix);
            var idSpace = this.ids.getSpace(idPrefix);

            var isDirectory = await this.isDirectory(pathTo);

            if (isDirectory) {
                var files = await this.readdir(pathTo);

                // these share id space so they must be read in order
                // so they can overwrite one another

                for (var fileIndex in files) {
                    var f = files[fileIndex];
                    var plugIn = this.readRF(path.join(pathTo, f));
                    await plugIn.read();
                    var parsed = this.parse(plugIn.resources);
                    this.ids.addPlugin(parsed, idPrefix);
                }

            }

            else {
                var plugIn = this.readRF(pathTo);
                await plugIn.read();
                var parsed = this.parse(plugIn.resources);
                this.ids.addPlugin(parsed, idPrefix);
            }
        }
    }



}


export { NovaParse };
