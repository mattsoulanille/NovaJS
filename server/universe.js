// Handles systems and when they render


class universe {
    constructor(gameData) {
	this.data = gameData;
	this.systems = new Set();
	this.players = new Set();
	this.activeSystems = new Set();
    }

    build() {

    }
    
    render(delta, time) {
	this.activeSystems.forEach(function(system) {
	    system.render(delta, time);
	});
	
    }

    

}



module.exports = universe;
