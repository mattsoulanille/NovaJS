module.exports = movableServer;
var movable = require("../client/movable.js");

function movableServer(buildInfo, system) {
    movable.call(this, buildInfo, system);
}

movableServer.prototype = new movable;

//movable is fairly simple
