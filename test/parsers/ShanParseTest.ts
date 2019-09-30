// global.Promise = require("bluebird"); // For stacktraces

// import * as chai from "chai";
// import * as chaiAsPromised from "chai-as-promised";
// import "mocha";
// import { assert } from "chai";
// import { ShanResource } from "../../src/resourceParsers/ShanResource";
// import { defaultIDSpace } from "../resourceParsers/DefaultIDSpace";
// import { readResourceFork, ResourceMap } from "resourceforkjs";
// import { Animation } from "novadatainterface/Animation";
// import { ShanParse } from "../../src/parsers/ShanParse";


// before(function() {
//     chai.should();
//     chai.use(chaiAsPromised);
// });

// const expect = chai.expect;


// describe("ShanParse", function() {

//     var idSpace = defaultIDSpace;

//     var rf: ResourceMap;
//     var minerResource: ShanResource;
//     var thunderforgeResource: ShanResource;
//     var shuttleResource: ShanResource;

//     var miner: Animation;
//     var thunderforge: Animation;
//     var shuttle: Animation;

//     before(async function() {
//         rf = await readResourceFork("./test/resourceParsers/files/shan.ndat", false);
//         var shans = rf.shän;
//         shuttleResource = new ShanResource(shans[128], idSpace);
//         thunderforgeResource = new ShanResource(shans[380], idSpace);
//         minerResource = new ShanResource(shans[379], idSpace);

//         miner = await ShanParse(shuttleResource);
//         thunderforge = await ShanParse(thunderforgeResource);
//         shuttle = await ShanParse(minerResource);




//     });

//     it("Should parse ShanResources into Animations ", function() {
//         console.log(miner);
//         //	expect(miner).to.deep.equal(}



//     });





// });

