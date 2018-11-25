import { BaseResource } from "novadatainterface/BaseResource";
import { Gettable } from "novadatainterface/Gettable";
import { NovaDataInterface, NovaDataType } from "novadatainterface/NovaDataInterface";
import { readResourceFork, Resource, ResourceMap } from "resourceforkjs"; // TODO: Add a declaration file

import { ShipParse } from "./parsers/ShipParse";
import { ResourceHolderBase, NovaResourceType, NovaResources } from "./ResourceHolderBase";
import { NovaResourceBase } from "./resourceParsers/NovaResourceBase";



// Reads a single plugin or nova file
// Puts results in localIDSpace.
async function readNovaFile(filePath: string, localIDSpace: NovaResources) {
    var rf = await read(filePath);

    //console.log(localIDSpace);

    for (let resourceType in NovaResourceType) {
        var parser = getParser(<NovaResourceType>resourceType);

        if (!localIDSpace.resources[resourceType]) {
            localIDSpace.resources[resourceType] = {};
        }

        for (let id in rf[resourceType]) {
            localIDSpace.resources[resourceType][id] =
                new parser(rf[resourceType][id], localIDSpace);
        }
    }
}

function read(path: string) {
    // Whether or not to use resource fork
    var useRF = (path.slice(-5) !== ".ndat");
    return readResourceFork(path, useRF);
}



function getParser(resourceType: NovaResourceType) {
    switch (resourceType) {
        default:
            //Temporary
            return NovaResourceBase;
        //throw new Error("Unknown data type " + dataType);
    }
}

export { readNovaFile };
