"use strict";
var rf = require("resourceforkjs").resourceFork;
var repl = require("repl");
var novaParse = require("./novaParse.js").novaParse;


var ndat4 = new rf("./test/Nova\ Data\ 4.ndat", false);
var weapon = new rf("./test/weapon.ndat", false);

ndat4.read();
weapon.read();

var np = new novaParse();

var local = repl.start();
local.context.rf = rf;
local.context.ndat4 = ndat4;
local.context.weapon = weapon;
local.context.novaParse = novaParse;
local.context.np = np;
