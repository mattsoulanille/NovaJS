import { GameDataInterface } from "./GameDataInterface";
import { NovaDataInterface } from "./NovaDataInterface";
import { Gettable } from "../../common/gettable";
import { BaseResource, DefaultBaseResource } from "./BaseResource";
import { ShipResource } from "./ShipResource";




class GameDataAggregator implements GameDataInterface {
    public data: NovaDataInterface;
    private dataSources: Array<GameDataInterface>;
    private warningReporter: (w: string) => void;

    constructor(dataSources: Array<GameDataInterface>, warningReporter = console.log) {
        this.dataSources = dataSources;
        this.warningReporter = warningReporter;

        // Is there a better way?
        this.data = {
            Ship: this.makeAggregator<ShipResource>("Ship"),
            Outfit: this.makeAggregator("Outfit"),
            Weapon: this.makeAggregator("Weapon"),
            Pict: this.makeAggregator("Pict"),
            Planet: this.makeAggregator("Planet"),
            System: this.makeAggregator("System"),
            TargetCorner: this.makeAggregator("TargetCorner"),
            SpriteSheet: this.makeAggregator("SpriteSheet"),
            SpriteSheetImage: this.makeAggregator("SpriteSheetImage"),
            SpriteSheetFrames: this.makeAggregator("SpriteSheetFrames"),
            StatusBar: this.makeAggregator("StatusBar")
        };
    }


    getDataSources() {
        return this.dataSources;
    }

    private makeAggregator<T extends BaseResource>(dataType: string): Gettable<T> {
        // Arrow functions automatically bind this
        return new Gettable<T>(async (id: string): Promise<T> => {
            var errors: Array<string> = [];

            for (var i in this.getDataSources()) {
                var dataSource: GameDataInterface = this.dataSources[i];
                try {
                    return <T>await dataSource.data[dataType].get(id);
                }
                catch (e) {
                    if (e instanceof Error) {
                        if (e.stack) {
                            errors.push(e.stack);
                        }
                    }
                    else {
                        errors.push(e.toString());
                    }
                }
            }

            // this.warningReporter(id + " not found under " + name + ". Using default instead. "
            //     + "\nStacktraces:\n"
            //     + errors.join("\n"));

            return <T>DefaultBaseResource;
        });
    }
}

export { GameDataAggregator };