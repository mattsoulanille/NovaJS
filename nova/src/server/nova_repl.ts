import repl from "repl";

export class NovaRepl {
    repl: repl.REPLServer;
    private prompt = "nova> ";

    constructor() {
        this.repl = repl.start(this.prompt);
    }
}
