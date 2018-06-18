// a bunch of different types of errors that things can throw

var AlliesError = class extends Error {};
var NoSystemError = class extends Error{};
var NotBuiltError = class extends Error{};
var NoCollisionShapeError = class extends Error{};
var UnsupportedWeaponTypeError = class extends Error{};
var AlreadyRenderedError = class extends Error{};

if (typeof(module) !== 'undefined') {
    module.exports = {
	AlliesError,
	NoSystemError,
	NotBuiltError,
	NoCollisionShapeError,
	UnsupportedWeaponTypeError,
	AlreadyRenderedError
    };
}
