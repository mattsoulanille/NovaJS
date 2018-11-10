import { GameDataInterface } from "./GameDataInterface";
import { NovaDataInterface } from "./NovaDataInterface";
import * as fs from "fs";
import * as path from "path";
import { Gettable } from "../../common/gettable";
import { ShipResource } from "./ShipResource";
import { BaseResource } from "./BaseResource";

class FilesystemData implements GameDataInterface {
    public data: NovaDataInterface;


    constructor(private rootPath: string) {
        this.data = {
            Ship: this.getFunction<ShipResource>("Ship", "json")
        }
    }

    getFunction<T extends BaseResource>(appendPath: string, extension: string): Gettable<T> {
        // Returns a gettable that loads the resource from a file
        return new Gettable<T>((id: string) => {
            return new Promise<T>((fulfill, reject) => {
                fs.readFile(path.join(this.rootPath, appendPath, id + "." + extension),
                    function(err, contents) {
                        if (err) {
                            reject(err);
                        }
                        else {
                            if (extension == "json") {
                                fulfill(<T>JSON.parse(contents.toString('utf8')))
                            }
                            else {
                                reject("Unsupported");
                            }
                        }
                    });
            });
        });
    }




    /*
    async build() {
        await this.buildIDs();
    }

    async buildIDs() {
        this.ids = {};
        for (let i in novaDataTypes) {
            var dataType = novaDataTypes[i];
            var dataTypePath = path.join(this.rootPath, dataType);
            try {
                this.ids[dataType] = await this.readIDsFromDir(dataTypePath);
            }
            catch (e) {
                this.ids[dataType] = [];
            }
        }
    }

    readIDsFromDir(path) {
        return new Promise(function(fulfill, reject) {
            fs.readdir(path, function(err, items) {
                if (err) {
                    reject(err);
                }
                else {
                    // Remove anything with a . in front of it                                                                                          
                    // Cut off all extensions                                                                                                           
                    fulfill(items.filter(x => x[0] != ".").map(x => x.slice(0, x.lastIndexOf("."))));
                }
            });
        });
    }
    */

}
export { FilesystemData };
