function addCommas(p) {
    return p.toLocaleString();
}

module.exports.formatPrice = function(p) {
    var mil = 1000000;
    if (p >= mil) {
	var modmil = String(p % mil).substring(0,3);
	modmil += "0".repeat(3 - modmil.length);
	return addCommas(Math.floor(p / mil)) + "." + modmil + "M cr";
    }
    else {
	return addCommas(p) + " cr";
    }
};
