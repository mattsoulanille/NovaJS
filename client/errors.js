// a bunch of different types of errors that things can throw


var AlliesError = class extends Error {};


if (typeof(module) !== 'undefined') {
    module.exports = {
	AlliesError
    };
}
