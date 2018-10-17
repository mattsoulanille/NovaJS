var chai = require("chai");
var expect = chai.expect;
var assert = chai.assert;

var novaParse = require("novaParse");
var novaData = require("../parsing/novaData");
var system = require("../server/systemServer.js");
var resourcesPrototypeHolder = require("../client/resourcesPrototypeHolder");
var ship = require("../server/shipServer.js");
// var http = require('http').Server();
// var io = require('socket.io')(http);
var socketStub = {on : function() {},
		  emit : function() {},
		  removeAllListeners : function() {}};

process.on('unhandledRejection', r => console.log(r));
// This line turns incomprehensable promise error garbage into actual stacktraces


describe("destroy", function() {

    var sol = new system();
    var shuttle;
    var shuttleB;
    var starbridge; // nova:332 mod starbridge
    var viper;
    var firebird;
    var thunderhead; // for beams
    var ships = [];
    this.timeout(10000);

    var makeShip = async function(id) {
	var s = new ship({id:id}, sol, socketStub);
	
	//s.meta = await s.novaData[s.type].get(s.buildInfo.id);	
	await s.build();
	ships.push(s);
	return s;
    };

    var callWeapons = function(f) {
	ships.forEach(function(ship) {
	    ship.weapons.all.forEach(function(weap) {
		f(weap);
	    });
	});
    };
    
    before(async function() {
	var np = new novaParse("./Nova\ Data");
	await np.read();
	var nd = new novaData(np);
	await nd.build();
	resourcesPrototypeHolder.prototype.data = nd;

	shuttle = await makeShip("nova:128");
	shuttleB = await makeShip("nova:188");
	starbridge = await makeShip("nova:332");
	viper = await makeShip("nova:144");
	firebird = await makeShip("nova:303");
	thunderhead = await makeShip("nova:157");

    });

    
    it("ship weapons' projectiles should be in the system's spaceObjects", function() {
	callWeapons(function(weap) {
	    if (typeof weap.projectiles !== "undefined") {
		expect([...sol.spaceObjects]).to.include.members(weap.projectiles);
	    }
	    else {
		// beam weapons (fix this nonsense. it's strange for weapons to sometimes be in spaceObjects)
		expect([...sol.spaceObjects]).to.include(weap);
	    }
	});

    });

    it("after destroying the ship, its weapons should no longer be in the system", function() {
	ships.forEach(function(ship) {
	    ship.destroy();
	});

	callWeapons(function(weap) {
	    if (typeof weap.projectiles !== "undefined") {
		expect([...sol.spaceObjects]).to.not.have.members(weap.projectiles);
	    }
	    else {
		expect([...sol.spaceObjects]).to.not.include(weap);
	    }
	    
	});
	
	expect(sol.spaceObjects.size).to.equal(0);
    });


});
