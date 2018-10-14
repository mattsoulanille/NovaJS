
class baseParse {
    constructor() {}

    parse(resource) {
	var out = {};
	out.id = resource.globalID;
	out.name = resource.name;
	out.prefix = resource.prefix;
	return out;
    }
};

module.exports = baseParse;
