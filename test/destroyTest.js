var chai = require("chai");
var expect = chai.expect;
var assert = chai.assert;

var novaParse = require("novaParse");
var novaData = require("../parsing/novaData");
var system = require("../server/systemServer.js");
var inSystem = require("../client/inSystem");
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
    var ships = [];
    this.timeout(10000);

    var makeShip = async function(id) {
	var s = new ship({id:id}, sol, socketStub);
	s.meta = s.novaData[s.type].getSync(s.buildInfo.id);	
	s.parseDefaultWeaponsSync();
	await s.build();
	ships.push(s);
	return s;
    };
    
    before(async function() {
	var np = new novaParse("./Nova\ Data");
	await np.read();
	var nd = new novaData(np);
	inSystem.prototype.novaData = nd;

	shuttle = await makeShip("nova:128");
	shuttleB = await makeShip("nova:188");
	starbridge = await makeShip("nova:332");
	viper = await makeShip("nova:144");
	firebird = await makeShip("nova:303");

    });

    it("ship weapons' projectiles should be in the system's spaceObjects", function() {
	ships.forEach(function(ship) {
	    expect([...sol.spaceObjects]).to.include.members(ship.weapons.all[0].projectiles);
	});
    });

    it("after destroying the ship, its weapons should no longer be in the system", function() {
	ships.forEach(function(ship) {
	ship.destroy();
	    expect([...sol.spaceObjects]).to.not.have.members(ship.weapons.all[0].projectiles);
	});
	
	expect(sol.spaceObjects.size).to.equal(0);
    });









});
