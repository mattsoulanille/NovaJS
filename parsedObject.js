// Only loads the object created by calling getFunction
// when asked for properties that are not
// globalID, idSpace, or prefix

// See https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Proxy/handler/construct
// and https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Proxy/handler/get

class parsedObject {
    constructor(getFunction) {
	this._get = getFunction;
    }

}

const getProxy = {
    get: function(target, prop, receiver) {
	if (prop === "globalID" ||
	    prop === "idSpace" ||
	    prop === "prefix" ||
	    prop === "id") {
	    return Reflect.get(...arguments);
	}
	else {
	    if (! target._cached) {
		target._cached = target._get();
		target._cached.idSpace = Reflect.get(target, "idSpace", receiver);
	    }
	    return Reflect.get(target._cached, prop, receiver);
	}
	
    }
};


const constructProxy = {
    construct(target, args) {
	var t = new target(...args);
	return new Proxy(t, getProxy);
    }
};

module.exports = new Proxy(parsedObject, constructProxy);
