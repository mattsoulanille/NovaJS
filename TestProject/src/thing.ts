import { PNG } from "pngjs";
//debugger;
import { DefaultAnimation } from "../../novadatainterface/Animation";

import { Resource } from "resourceforkjs";
import { DefaultBaseData } from "../../novadatainterface/BaseData";
//import * as UUID from "uuid/v4";
import UUID from "uuid/v4";
import * as fs from 'fs';


type Test = string;

export function stuff() {
    console.log("Hello, world!, " + UUID());
    console.log(UUID());
    let p = new PNG();
    console.log(p);
    console.log(DefaultBaseData);
    console.log(Resource);
    console.log(fs);
    console.log(fs);
    console.log(DefaultAnimation);
}




