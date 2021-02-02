var _ = require("underscore");
var Promise = require("bluebird");
var sprite = require("../client/sprite.js");
var path = require("path");
var appDir = path.dirname(require.main.filename);

// may do something eventually, but not yet.
var spriteServer = sprite;

module.exports = spriteServer;
