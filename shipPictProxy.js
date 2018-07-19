const ship = require("./parsers/ship.js");

// Ships with the same baseImage are given the same pict id
// if they don't have their own.
// This is a rather ugly solution. See 
function shipParseMaker(novaParse) {
    
    var getProxy = {
	
	get: function(target, prop, receiver) {
	    if (prop === "pictID") {
		// Intercept requests for the ship's pictID
		// First, check if the pictID exists
		var ownPict = Reflect.get(...arguments);
		if (target.idSpace.PICT[ownPict]) {
		    // Then the pict exists. Set the default graphic
		    return ownPict;
		}
		else {
		    // Then the pict does not exist, so check the
		    // pict map
		    var shan = target.idSpace.shän[target.id];
		    var baseImageLocalID = shan.baseImage.ID;
		    var baseImageGlobalID = shan.idSpace.rlëD[baseImageLocalID].globalID;
		    return novaParse._shipBaseImagePictMap[baseImageGlobalID];
		}
	    }
	    else {
		return Reflect.get(...arguments);
	    }
	}
    };

    var constructProxy = {
	construct(target, args) {
	    var t = new target(...args);
	    return new Proxy(t, getProxy);
	}
    };
    
    return new Proxy(ship, constructProxy);
}


module.exports = shipParseMaker;
