module.exports = movableServer;
var movable = require("../client/movable.js");

function movableServer(name, system) {
    movable.call(this, name, system);
}

movableServer.prototype = new movable;

//movable is fairly simple
