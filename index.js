"use strict";
var rf = require("resourceforkjs").resourceFork;
var repl = require("repl");
var novaParse = require("./novaParse.js");


var ndat4 = new rf("./test/Nova\ Data\ 4.ndat", false);
var nships1 = new rf("./test/Nova\ Ships\ 1.ndat", false);
var weap = new rf("./test/files/weap.ndat", false);
var spin = new rf("./test/files/spin.ndat", false);
var rled = new rf("./test/files/rled.ndat");
var rez = new rf("./test/Nova\ Data\ 1.rez", false);

ndat4.read();
weap.read();
spin.read();
rez.read();




var local = repl.start();

var np;

//np = new novaParse("./test/testFilesystem/");
np = new novaParse("./test/testFilesystem/");
local.context.np = np;
np.read().then(function() {
    console.log("done reading np");
    console.log(np.ids.resources.wëap['nova:128'].name);
});


local.context.rf = rf;
local.context.ndat4 = ndat4;
local.context.rez = rez;
local.context.nships1 = nships1;
local.context.weap = weap;
local.context.novaParse = novaParse;

local.context.spin = spin;
