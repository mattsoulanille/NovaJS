"use strict";
var rf = require("resourceforkjs").resourceFork;
var repl = require("repl");
var novaParse = require("./novaParse.js");
var pictParse = require("./parsers/pict.js");
var descParse = require("./parsers/desc.js");

var outfParse = require("./parsers/outf.js");
var spobParse = require("./parsers/spob.js");

/*
var ndat4 = new rf("./test/Nova\ Data\ 4.ndat", false);
var nships1 = new rf("./test/Nova\ Ships\ 1.ndat", false);
var weap = new rf("./test/files/weap.ndat", false);
var spin = new rf("./test/files/spin.ndat", false);
var rled = new rf("./test/files/rled.ndat");
var rez = new rf("./test/Nova\ Data\ 1.rez", false);
*/
//var pict = new rf("./test/files/pict.ndat", false);
var desc = new rf("./test/files/desc.ndat", false);
var outf = new rf("./test/files/outf.ndat", false);
var spob = new rf("./test/files/spob.ndat", false);
/*
ndat4.read();
weap.read();
spin.read();
rez.read();
*/


var local = repl.start();

var np;

//np = new novaParse("./test/testFilesystem/");
np = new novaParse("./test/testFilesystem/");
local.context.np = np;
np.read().then(function() {
    console.log("done reading np");
    //console.log(np.ids.resources.wëap['nova:128'].name);
});





local.context.rf = rf;
/*
local.context.ndat4 = ndat4;
local.context.rez = rez;
local.context.nships1 = nships1;
local.context.weap = weap;
*/
local.context.novaParse = novaParse;
//console.log(pict);

// desc.read().then(function() {
//     local.context.d1 = new descParse(desc.resources.dësc[128]);
// });
outf.read().then(function() {
    local.context.outf = outf;
    local.context.o1 = new outfParse(outf.resources.oütf[128]);
    local.context.o2 = new outfParse(outf.resources.oütf[129]);
    local.context.o3 = new outfParse(outf.resources.oütf[130]);
    local.context.o4 = new outfParse(outf.resources.oütf[131]);
    local.context.o5 = new outfParse(outf.resources.oütf[132]);
});
spob.read().then(function() {
    local.context.spob = spob;
    local.context.s1 = new spobParse(spob.resources.spöb[128]);
    local.context.s2 = new spobParse(spob.resources.spöb[129]);
});


//local.context.spin = spin;
