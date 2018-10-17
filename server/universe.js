// Handles systems and when they render


class universe {
    constructor() {
	this.systems = new Set();
	this.players = new Set();
	this.activeSystems = new Set();
    }

    render(delta, time) {
	this.activeSystems.forEach(function(system) {
	    system.render(delta, time);
	});
	
    }

    

}



module.exports = universe;
