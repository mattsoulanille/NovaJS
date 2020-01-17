import { Keybindings, KeyboardController } from "./KeyboardController";
import { PathReporter } from "io-ts/lib/PathReporter";
import { GameData } from "./gamedata/GameData";
import { isRight } from "fp-ts/lib/Either";

async function setupControls(gameData: GameData) {
    const unparsed = await gameData.getSettings("controls.json");
    const keybindings = Keybindings.decode(unparsed);
    if (isRight(keybindings)) {
        return new KeyboardController(keybindings.right);
    }
    else {
        throw new Error("Keybindings failed to parse: "
            + PathReporter.report(keybindings).join("\n"));
    }
}

export { setupControls }
