
var movable = require("../client/movable.js");

let movableServer = (superclass) => class extends movable(superclass) {};

module.exports = movableServer;
//movable is fairly simple
