
class baseParse {
    constructor(data) {
	this.data = data;
    }

    parse(resource) {
	var out = {};
	out.id = resource.globalID;
	out.name = resource.name;
	out.prefix = resource.prefix;
	return out;
    }
};

module.exports = baseParse;
