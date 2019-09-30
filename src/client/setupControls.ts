import { Keybindings, KeyboardController } from "./KeyboardController";
import { PathReporter } from "io-ts/lib/PathReporter";
import { GameData } from "./GameData";

async function setupControls(gameData: GameData) {
    const unparsed = await gameData.getSettings("controls.json");
    const keybindings = Keybindings.decode(unparsed);
    if (keybindings.isRight()) {
        return new KeyboardController(keybindings.value);
    }
    else {
        throw new Error("Keybindings failed to parse: "
            + PathReporter.report(keybindings).join("\n"));
    }
}

export { setupControls }
