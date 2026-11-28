import * as PIXI from 'pixi.js';
import { firstValueFrom, Observable, Subject } from 'rxjs';
import { DisplayAssetDataInterface } from '../client/gamedata/display_asset_data.js';
import { SimulationGameDataInterface } from '../client/gamedata/simulation_game_data.js';
import { ControlEvent } from '../nova_plugin/core/index.js';
import { Button } from './button.js';
import { MenuControls } from './menu_controls.js';
import { makeVenueShield } from './modal_shield.js';

type Buttons = {
    [index: string]: Button,
};

export abstract class Menu<T> {
    container = new PIXI.Container();
    readonly buildPromise: Promise<void>;
    built = false;
    /** Guards {@link build} against being run a second time. */
    private buildEntered = false;
    protected controls: MenuControls;
    /**
     * The map key ('m') over this menu. The original opens the star map
     * over the outfitter, shipyard, trade center and bar, and 'm' closes it
     * back to the venue (docs/reference_experiments.md, "The UI screen x
     * key matrix, wave 11"). The owning spaceport sets it, since the map
     * needs the docked ship's state; a venue binds it as its 'map' control
     * and a menu without one ignores the key. The starmap binds its own
     * controls on top of the focus stack while open, so the venue's keys
     * stay quiet under it.
     */
    onMapKey?: () => void;
    private results = new Subject<T>();
    private shownSubject = new Subject<void>();
    /**
     * Emits each time {@link show} puts the menu on screen: the container
     * made visible and the menu's keys bound, in the same synchronous step.
     * A subclass whose show() awaits its data first (the trade center, the
     * outfitter) reaches that step a few awaits after the call, so a caller
     * that has to act the moment the menu is up (the spaceport's venue
     * offers, which go up over the venue — see Spaceport.openVenue) waits
     * on this rather than on the call. A show() that gives up before it
     * gets there (a failed load, a teardown) never emits.
     */
    readonly shown: Observable<void> = this.shownSubject.asObservable();
    protected input!: T;

    constructor(protected displayAssets: DisplayAssetDataInterface,
        protected simulationData: SimulationGameDataInterface,
        private background: string,
        controlEvents: Observable<ControlEvent>,
        /**
         * A spaceport venue (outfitter, shipyard, trade center, bar,
         * Mission BBS): modal, as in the original, so a full-screen shield
         * under its frame keeps the pointer off everything behind it — the
         * spaceport's own buttons included (modal_shield.ts). Without it
         * only the frame below caught clicks. The spaceport itself and the
         * maps leave it off.
         */
        modal = false) {
        this.controls = new MenuControls(controlEvents);

        if (modal) {
            this.container.addChild(
                makeVenueShield(`${this.constructor.name}Shield`));
        }
        const backgroundSprite = this.displayAssets.spriteFromPict(this.background);
        // So you can't press things behind this menu:
        backgroundSprite.interactive = true;
        backgroundSprite.anchor.x = 0.5;
        backgroundSprite.anchor.y = 0.5;
        this.container.visible = false;
        this.container.addChild(backgroundSprite);
        this.buildPromise = this.doBuild();
    }

    private async doBuild() {
        await this.build();
        this.built = true;
    }

    addButtons(buttons: Buttons) {
        for (const button of Object.values(buttons)) {
            this.container.addChild(button.container);
        }
    }

    /**
     * Subclass hook for filling in the menu's contents. Menu's constructor
     * already runs it exactly once, through {@link buildPromise} — a
     * subclass must NEVER call build() itself.
     *
     * Overrides start with `await super.build()`, both because the first
     * await is what lets the subclass's field initialisers run before the
     * body sees `this` (see the class doc) and because that is what arms
     * this guard. The shipyard's constructor used to end with an extra
     * `this.build()`, which added a second ItemGrid on top of the first and
     * left half the menu's state pointing at a grid nobody could see; a
     * duplicate build is always a bug, so say so loudly rather than
     * silently double up whatever the subclass adds.
     */
    protected async build() {
        if (this.buildEntered) {
            throw new Error(`${this.constructor.name}.build() ran twice. `
                + 'Menu builds itself once from its constructor; do not '
                + 'call build() again.');
        }
        this.buildEntered = true;
    }

    protected setInput(input: T) {
        this.input = input;
    }

    /**
     * Whether this menu may still open (or draw) after an await inside
     * its show(): the owning display world can be torn down while a
     * venue is loading its data, destroying the container. A menu that
     * carried on would bind a keyboard nobody gives back and draw into
     * destroyed graphics (the spaceport's stillDocked, for the venues).
     */
    protected get alive(): boolean {
        return !this.container.destroyed;
    }

    async show(input: T): Promise<T> {
        this.container.visible = true;
        this.controls.bind();
        this.setInput(input);
        this.shownSubject.next();
        const result = await firstValueFrom(this.results);
        this.container.visible = false;
        this.controls.unbind();
        return result;
    }

    protected done() {
        this.results.next(this.input);
    }

    /**
     * Closes the menu from OUTSIDE (the owning display world is being torn
     * down — a jump or gate transit while the map is open — or the player
     * docked with it up: display/flight_overlays.ts). Resolves the
     * pending show() with the current input so the MenuControls binding is
     * released; a menu left bound after its world died kept the keyboard
     * for good, and the ship could not be flown in the next system.
     * No-op when not shown, except that an open still on its way up (see
     * {@link takeOpenTicket}) is called off.
     */
    dismiss() {
        this.openTicket++;
        if (this.container.visible) {
            this.done();
        }
    }

    /**
     * Bumped by every {@link dismiss}. A subclass whose show() awaits its
     * data before calling `super.show` takes a ticket first
     * ({@link takeOpenTicket}) and gives up if a dismissal came in the
     * meantime ({@link openCancelled}): dismissed while still on its way
     * up, it must not then bind its keys over whatever took the screen
     * (a landing with the map opening: client display/flight_overlays.ts).
     */
    private openTicket = 0;

    protected takeOpenTicket(): number {
        return this.openTicket;
    }

    protected openCancelled(ticket: number): boolean {
        return ticket !== this.openTicket || !this.alive;
    }
}
