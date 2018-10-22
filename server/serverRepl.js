const repl = require("repl");

class serverRepl {
    constructor(universe) {
	this.commands = {
	    help : [this.help, "prints this help"],
	    list: [this.list.bind(this), "lists players"]
	};
	this.universe = universe;
    }

    start() {
	this.local = repl.start();
    }

    bindCommands() {
	Object.keys(this.commands).forEach(function(name) {
	    Object.defineProperty(this.local.context,
				  name,
				  {set: function(x) {}, get: this.commands[name][0]});
	}.bind(this));
    }

    help() {
	var out = "Available commands:\n";
	for (let command in this.commands) {
	    out += command;
	    out += "\t";
	    out += this.commands[command][1];
	    out += "\n";
	}
	return out;
    }

    list() {
	return this.universe.players;
    }
    

}
