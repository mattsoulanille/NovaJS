import { PlanetData } from 'novadatainterface/planet_data';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { Entity } from 'nova_ecs/entity';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import * as PIXI from 'pixi.js';
import { Observable } from 'rxjs';
import { makeDescTextContext, playerGender, resolveConditionalBlocks }
    from '../nova_plugin/desc_text.js';
import { DisplayAssetDataInterface } from '../client/gamedata/display_asset_data.js';
import { SimulationGameDataInterface } from '../client/gamedata/simulation_game_data.js';
import { ControlEvent } from '../nova_plugin/controls_plugin.js';
import { ArmorComponent, FUEL_PER_JUMP, FuelComponent, IonizationComponent, ShieldComponent } from '../nova_plugin/health_plugin.js';
import { ShipComponent, ShipPhysicsComponent } from '../nova_plugin/ship_plugin.js';
import { WeaponsStateComponent } from '../nova_plugin/weapons_state.js';
import { OutfitsStateComponent } from '../nova_plugin/outfit_plugin.js';
import { LOCATION_MAIN_SPACEPORT, LOCATION_MISSION_COMPUTER, MissionEvent, MissionMapMark, missionMapMarks } from '../nova_plugin/mission_logic.js';
import { expandMissionText } from '../nova_plugin/mission_text.js';
import {
    ActiveRanksComponent, ControlBitsComponent,
} from '../nova_plugin/ncb_plugin.js';
import { CreditsComponent, GameDateComponent, MissionsComponent } from '../nova_plugin/player_state_plugin.js';
import { DockedLiveStatus, DockedShip } from '../display/docked_ship.js';
import { Bar } from './bar.js';
import { Button } from './button.js';
import { describeOutfitChanges, requestCheckpoint } from './checkpoint_requests.js';
import { DeployedOutfitCounts } from './deployed_outfits.js';
import { Menu } from './menu.js';
import { MenuControls } from './menu_controls.js';
import { MissionBoard } from './mission_board.js';
import { OfferPopup, presentOffers } from './offer_popup.js';
import { MissionSession, processEntityLanding } from './mission_session.js';
import { rollOffers } from './mission_offers.js';
import { MissionUniverse } from './mission_universe.js';
import { Outfitter } from './outfitter.js';
import { playerIdentitySubs } from './player_identity.js';
import { runShipBuildWorld } from './ship_build_world.js';
import { Shipyard } from './shipyard.js';
import { OpenStarmapOptions } from './starmap.js';
import { TradeCenter } from './trade_center.js';

// The 618x517 spaceport frame (PICT 8500): the landing image fills the
// top, the stellar name and description sit in the center panel, and
// the venue buttons run down the left and right metal panels — Bar /
// Mission BBS / Trade Center on the left, Shipyard / Outfitter and
// (after a one-slot gap) Leave on the right, per the original's
// arrangement. Measured against the 1920x1080 reference screenshots
// (spaceport/earth.png): the first button row's center sits 88px below
// the frame's center, rows are 41px apart, and Leave occupies the
// fourth slot.
// Left/right column x, measured against spaceport/earth.png: the left
// column's red pill spans screen x 661-787 and the right column's 1129-1255.
// With the frame centered on x=960 these offsets land our pills on the same
// rectangles (the left column was previously 10px too far right).
const LEFT_BUTTON_X = -306;
const RIGHT_BUTTON_X = 162;
const BUTTON_TOP = 75;
const BUTTON_SPACING = 41;
const BUTTON_WIDTH = 120;

// Refueling is paid: 100 credits per jump's worth of fuel
// (FUEL_PER_JUMP units), prorated for partial jumps and rounded up.
const REFUEL_COST_PER_JUMP = 100;

/** Cost in credits to fill the tank from `current` to `max`. */
export function refuelCost(fuel: { current: number, max: number }): number {
    return Math.ceil(
        (fuel.max - fuel.current) / FUEL_PER_JUMP * REFUEL_COST_PER_JUMP);
}

/** The entity's owned outfits as [id, count] pairs (empty when none). */
function outfitCounts(entity: Entity | undefined): [string, number][] {
    const outfits = entity?.components.get(OutfitsStateComponent);
    return outfits ? [...outfits].map(([id, { count }]) => [id, count]) : [];
}

export class Spaceport extends Menu<Entity> {
    private outfitter: Outfitter;
    private shipyard: Shipyard;
    private missionComputer: MissionBoard;
    private bar: Bar;
    private tradeCenter: TradeCenter;
    private universe: MissionUniverse;
    /** Landing mission-offer / completion popups, shown over the
     * spaceport before it becomes interactive. */
    private offerPopup: OfferPopup;
    /** Holds keyboard focus (and mutes the global map key) while the
     * pointer-only landing popups are up. */
    private popupBlocker: MenuControls;
    private buttons: {
        bar: Button, missions: Button, tradeCenter: Button,
        shipyard: Button, outfitter: Button, refuel: Button,
        leave: Button,
    };
    private data?: PlanetData;
    /**
     * The docked-ship handle the status bar reads while docked. The spaceport
     * points its `liveStatus` at whichever venue is open so the bar tracks a
     * transaction's working credits/cargo before it commits to the entity.
     */
    private dockedShip?: DockedShip;

    private font = {
        title: {
            fontFamily: "Geneva", fontSize: 18, fill: 0xffffff,
            align: 'center'
        } as const,
        desc: {
            fontFamily: "Geneva", fontSize: 9, fill: 0xffffff,
            align: 'left', wordWrap: true, wordWrapWidth: 301
        } as const,
    };

    constructor(displayAssets: DisplayAssetDataInterface,
        simulationData: SimulationGameDataInterface, private id: string,
        controlEvents: Observable<ControlEvent>,
        /** Opens the starmap over the spaceport (the 'm' key), so the
         * player can check mission destinations while docked. */
        private openStarmap?: (options?: OpenStarmapOptions)
            => Promise<unknown>,
        /** Opens the player-info dialog over the spaceport (the 'p'
         * key) — it works both in flight and docked. The docked ship
         * entity is passed explicitly: while docked it is out of the
         * world, held by this menu. */
        private openPlayerInfo?: (entity: Entity) => Promise<unknown>,
        /** Opens the mission-info dialog over the spaceport (the 'i'
         * key). Like the player-info dialog, the docked ship entity is
         * passed explicitly (it is out of the world while docked). */
        private openMissionInfo?: (entity: Entity, planetId?: string)
            => Promise<unknown>) {
        super(displayAssets, simulationData, "nova:8500", controlEvents);
        this.container.name = 'Spaceport';

        const buttonY = (slot: number) =>
            BUTTON_TOP + slot * BUTTON_SPACING;
        this.buttons = {
            bar: new Button(displayAssets, "Bar", BUTTON_WIDTH,
                { x: LEFT_BUTTON_X, y: buttonY(0) }),
            missions: new Button(displayAssets, "Mission BBS", BUTTON_WIDTH,
                { x: LEFT_BUTTON_X, y: buttonY(1) }),
            tradeCenter: new Button(displayAssets, "Trade Center", BUTTON_WIDTH,
                { x: LEFT_BUTTON_X, y: buttonY(2) }),
            shipyard: new Button(displayAssets, "Shipyard", BUTTON_WIDTH,
                { x: RIGHT_BUTTON_X, y: buttonY(0) }),
            outfitter: new Button(displayAssets, "Outfitter", BUTTON_WIDTH,
                { x: RIGHT_BUTTON_X, y: buttonY(1) }),
            // The Refuel button occupies the right column's third slot,
            // but only exists while the player's fuel isn't full — it
            // disappears when full (e.g. an auto-refueller outfit) and
            // greys out when the player can't afford the fill. The
            // reference screenshot (spaceport/earth.png) shows the gap
            // because that capture's player had full fuel.
            refuel: new Button(displayAssets, "Refuel", BUTTON_WIDTH,
                { x: RIGHT_BUTTON_X, y: buttonY(2) }),
            leave: new Button(displayAssets, "Leave", BUTTON_WIDTH,
                { x: RIGHT_BUTTON_X, y: buttonY(3) }),
        };
        const buttons = this.buttons;

        buttons.leave.click.subscribe(this.done.bind(this));
        buttons.refuel.click.subscribe(this.refuel.bind(this));

        this.outfitter = new Outfitter(displayAssets, simulationData, controlEvents);
        const showOutfitter = async () => {
            if (this.data && !this.data.flags.hasOutfitter) {
                return;
            }
            this.controls.unbind();
            // The outfitter mutates the ship's outfits and the
            // player's control bits.
            this.setLiveStatus(() => this.outfitter.dockedStatus());
            const outfitsBefore = outfitCounts(this.input);
            this.input = await this.outfitter.show(this.input);
            this.setLiveStatus(undefined);
            this.announcePurchases(outfitsBefore);
            // Delete these so they are re-created with the new outfits.
            // Nothing re-derives them while docked (the entity is out of
            // the world, so no ChangeEvent can fire — see the note in
            // nova_plugin/ship_plugin.ts): the relaunch rebuilds both.
            // Anything that must show outfitted physics WHILE STILL
            // LANDED therefore has to re-derive it for display rather
            // than read the component — see player_info.ts's
            // dialogShipPhysics.
            // TODO: Find a better way to do this.
            this.input.components.delete(WeaponsStateComponent);
            this.input.components.delete(ShipPhysicsComponent);
            // Outfits can change fuel capacity (fuel tanks), which
            // affects the Refuel button.
            this.refreshRefuelButton();
            this.controls.bind();
        };
        buttons.outfitter.click.subscribe(showOutfitter);

        this.universe = MissionUniverse.shared(simulationData);
        this.offerPopup = new OfferPopup(displayAssets, controlEvents);
        this.popupBlocker = new MenuControls(controlEvents);
        this.missionComputer = new MissionBoard(displayAssets, simulationData,
            controlEvents, this.universe, id, LOCATION_MISSION_COMPUTER,
            "nova:8505", "Mission BBS", this.openStarmap);
        const showMissionComputer = async () => {
            this.controls.unbind();
            // The board mutates missions, cargo, credits, control
            // bits, and (through Gxxx grants) outfits.
            this.input = await this.missionComputer.show(this.input);
            this.refreshRefuelButton();
            this.controls.bind();
        };
        buttons.missions.click.subscribe(showMissionComputer);

        this.bar = new Bar(displayAssets, simulationData, controlEvents,
            this.universe, id);
        const showBar = async () => {
            if (this.data && !this.data.flags.hasBar) {
                return;
            }
            this.controls.unbind();
            // The bar mutates missions, credits (gambling, hire fees),
            // cargo, bits, and records hired escorts.
            this.setLiveStatus(() => this.bar.dockedStatus());
            this.input = await this.bar.show(this.input);
            this.setLiveStatus(undefined);
            this.refreshRefuelButton();
            this.controls.bind();
        };
        buttons.bar.click.subscribe(showBar);

        this.tradeCenter = new TradeCenter(displayAssets, simulationData,
            controlEvents, id);
        const showTradeCenter = async () => {
            if (this.data && !this.data.flags.hasCommodityExchange) {
                return;
            }
            this.controls.unbind();
            // The trade center mutates cargo and credits.
            this.setLiveStatus(() => this.tradeCenter.dockedStatus());
            this.input = await this.tradeCenter.show(this.input);
            this.setLiveStatus(undefined);
            this.refreshRefuelButton();
            this.controls.bind();
        };
        buttons.tradeCenter.click.subscribe(showTradeCenter);

        this.shipyard = new Shipyard(displayAssets, simulationData, controlEvents);

        const showShipyard = async () => {
            if (this.data && !this.data.flags.hasShipyard) {
                return;
            }
            this.controls.unbind();
            const newInput = await this.shipyard.show(this.input);
            if (newInput !== this.input) {
                // Construct a fake system and run providers so that outfits
                // of the new ship are provided (see ship_build_world.ts —
                // extracted so a spec pins that the scratch world's resource
                // set stays sufficient for SystemPlugin).
                await runShipBuildWorld(newInput, simulationData,
                    displayAssets);
            }
            const boughtShip = newInput !== this.input;
            this.input = newInput;
            if (boughtShip) {
                // A ship purchase is a checkpoint (pilot_history.ts). The
                // NEW entity is passed explicitly: the client's docked
                // handle still points at the traded-in one until depart.
                const shipId = newInput.components.get(ShipComponent)?.id;
                const name = shipId
                    ? simulationData.data.Ship.getCached(shipId)?.name
                        ?.split(';')[0].trim() ?? shipId
                    : 'a ship';
                requestCheckpoint({
                    label: `Bought ${name}`, kind: 'purchase',
                    entity: newInput, stellar: this.id,
                });
            }

            this.controls.bind();
        };
        buttons.shipyard.click.subscribe(showShipyard);
        this.addButtons(buttons);

        this.controls = new MenuControls(controlEvents, {
            outfitter: showOutfitter,
            shipyard: showShipyard,
            missionBBS: showMissionComputer,
            bar: showBar,
            tradeCenter: showTradeCenter,
            recharge: this.refuel.bind(this),
            // The starmap and player info bind their own controls on
            // top of the focus stack while open, so the spaceport keys
            // stay quiet under them and 'd' backs out of just the
            // overlay. The docked entity is out of the display world,
            // so its date and mission marks ride along to the map.
            map: () => void this.openStarmap?.({
                date: this.input?.components.get(GameDateComponent),
                missionMarks: this.activeMissionMarks(),
            }),
            properties: () => void this.openPlayerInfo?.(this.input),
            // The planetId enables the dialog's docked-only Abort.
            missions: () => void this.openMissionInfo?.(this.input, this.id),
            depart: this.done.bind(this),
        });
    }

    /**
     * True while the player is on the spaceport's own main screen — i.e.
     * docked here AND no venue (outfitter/shipyard/trade/bar/BBS) or overlay
     * (starmap/player-info/mission-info/landing popup) is on top. Each venue
     * unbinds the spaceport's controls and binds its own on top of the
     * MenuControls focus stack (and overlays do the same), so the spaceport's
     * controls are only the focused ones on the bare main screen. Used by the
     * display's spaceport-ambient-sound system to play the ambient only on the
     * main screen and pause it inside a venue.
     */
    get onMainScreen(): boolean {
        return this.container.visible && MenuControls.focused === this.controls;
    }

    /**
     * The orange active-mission map marks for the docked ship (the
     * entity is out of the display world while docked, so the starmap
     * plugin can't derive these itself).
     */
    private activeMissionMarks(): MissionMapMark[] {
        const missions = this.input?.components.get(MissionsComponent);
        if (!missions) {
            return [];
        }
        const bits = this.input?.components.get(ControlBitsComponent);
        return missionMapMarks(missions.values(),
            missionId => this.universe.getMission(missionId),
            planetId => this.universe.systemIdOfPlanet(planetId, bits));
    }

    /**
     * Landing bookkeeping happens before the spaceport is shown: the
     * player's date advances one day, and every active mission is
     * checked against this stellar (completion + payment, deadline
     * failures, travel-leg cargo transfer). The entity is out of the
     * simulation while docked, so mutating its components here is the
     * standard spaceport commit pattern.
     */
    override async show(input: Entity): Promise<Entity> {
        // Own the keyboard immediately, before the landing processing below.
        // That processing awaits the mission universe, which on the very
        // first landing can still be loading (~thousands of resources); until
        // super.show() runs, the spaceport isn't the focused MenuControls
        // layer, so the first docked 'p' (player info) / mission keypress
        // falls through to the in-flight handlers — which can't serve the
        // docked entity (it's out of the world while docked). Binding here
        // makes MenuControls.focused the spaceport from the moment it opens;
        // super.show() re-binds (idempotent) and unbinds on depart. The
        // input is set first so handlers that read it (e.g. 'p' passing the
        // docked entity to player info) work during the gap too.
        this.setInput(input);
        this.controls.bind();
        let events: MissionEvent[] = [];
        try {
            events = await processEntityLanding(input,
                this.simulationData, this.universe, this.id);
        } catch (e) {
            console.warn('Mission landing processing failed:', e);
        }
        this.refreshRefuelButton(input);

        // The spaceport is shown (super.show binds controls + reveals the
        // frame); its returned promise resolves only when the player
        // departs. Before it becomes interactive, the original presents —
        // over the spaceport — any mission completion/failure text and
        // then any main-spaceport (AvailLoc 3) offers, exactly as the
        // bar presents its offers on entry. The blocker holds keyboard
        // focus (and mutes the global map key) while the pointer-only
        // popups are up.
        const result = super.show(input);
        try {
            await this.buildPromise;
            this.controls.unbind();
            this.popupBlocker.bind();
            try {
                await this.presentLandingPopups(input, events);
            } finally {
                this.popupBlocker.unbind();
                this.controls.bind();
            }
        } catch (e) {
            console.warn('Spaceport landing popups failed:', e);
        }
        return result;
    }

    /**
     * The on-landing popup sequence, over the already-visible spaceport:
     * first each mission completion/failure text (the completion dësc,
     * per the "_succeed" references; nothing is repeated on the spaceport
     * itself afterwards — the popups ARE the notice), then the
     * main-spaceport (AvailLoc 3) mission
     * offers, each with its custom accept/refuse buttons and continuation
     * pages for long text (the kont-probe reference).
     */
    private async presentLandingPopups(entity: Entity,
        events: MissionEvent[]) {
        // Completion / failure text as popups (the completion dësc),
        // expanded like any other mission text: dësc conditionals against
        // the player's real bits/gender, then wildcards. The event carries
        // no resolved mission shape, so only the identity tags, <PAY>, and
        // the return-stellar tags get real values — and since these popups
        // fire at the planet the player just landed on (the mission's
        // return stop), <RST>/<RSY> resolve to "here".
        const ctx = makeDescTextContext(
            entity.components.get(ControlBitsComponent) ?? new Set(),
            playerGender());
        const identity = await playerIdentitySubs(this.universe,
            entity.components.get(ShipComponent)?.id, undefined,
            entity.components.get(ActiveRanksComponent));
        for (const event of events) {
            if (!event.text) {
                continue;
            }
            if (event.type === 'completed' || event.type === 'failed'
                || event.type === 'autoAborted' || event.type === 'shipDone'
                || event.type === 'cargoLoaded'
                || event.type === 'cargoDropped') {
                // Where "here" fits in the mission's shape depends on the
                // event: completion/failure text fires at the mission's
                // RETURN stop, so <RST>/<RSY> mean "here" — but the cargo
                // texts fire at the TRAVEL stop, where "here" is
                // <DST>/<DSY> and the return tags must name the mission's
                // actual return planet (still in the player's active
                // state, since a cargo transfer doesn't end the mission).
                // (A DropOffMode 1 drop fires at the RETURN stop, right
                // before completion, and reads like a completion.)
                const cargoEvent = (event.type === 'cargoLoaded'
                    || event.type === 'cargoDropped')
                    && event.stop !== 'return';
                const active = entity.components.get(MissionsComponent)
                    ?.get(event.missionId);
                const here = {
                    stellar: this.universe.planetName(this.id),
                    system: this.universe.systemNameOfPlanet(this.id),
                };
                const text = expandMissionText(event.text, {
                    ...identity,
                    ...(cargoEvent ? {
                        destinationStellar: here.stellar,
                        destinationSystem: here.system,
                        ...(active?.returnPlanet ? {
                            returnStellar: this.universe.planetName(
                                active.returnPlanet),
                            returnSystem: this.universe.systemNameOfPlanet(
                                active.returnPlanet),
                        } : {}),
                    } : {
                        returnStellar: here.stellar,
                        returnSystem: here.system,
                    }),
                    payment: event.payment,
                    // <SN>: carried on the event, since the mission is
                    // already gone from the player's state by the time
                    // its completion/failure text is shown.
                    specialShipName: event.specialShipName,
                }, ctx);
                // Show the result dësc's graphic beside the text when the
                // mission set one (completion/fail/shipDone/brief pict);
                // OfferPopup falls back to the plain briefing frame when
                // pict is absent.
                await this.offerPopup.show(text, { accept: 'Okay' },
                    { pict: event.pict, style: 'briefing' });
            }
        }

        // Main-spaceport mission offers. A fresh session over the
        // (post-landing) entity rolls and, on accept, commits the mission
        // back — the standard docked commit pattern.
        let session: MissionSession;
        try {
            session = await MissionSession.create(entity,
                this.simulationData, this.universe, this.id);
        } catch (e) {
            console.warn('Spaceport offer session failed to load:', e);
            return;
        }
        const offers = rollOffers(session, this.universe,
            LOCATION_MAIN_SPACEPORT).filter(offer => offer.acceptable);
        if (offers.length === 0) {
            return;
        }
        await presentOffers(this.offerPopup, session, this.universe, offers);
        session.commit();
    }

    /**
     * Announces an outfitter visit's net purchases/sales as a pilot-history
     * checkpoint ("Bought Battery Pack ×3; Sold Blaster ×1"), comparing
     * the docked ship's outfits before and after the visit. Nothing is
     * announced for a browse that bought nothing. Outfit names come from
     * the warm cache (the outfitter just displayed them); an unloaded one
     * falls back to its id.
     */
    private announcePurchases(before: [string, number][]) {
        const label = describeOutfitChanges(before, outfitCounts(this.input),
            id => this.simulationData.data.Outfit.getCached(id)?.name);
        if (label) {
            requestCheckpoint({
                label, kind: 'purchase', entity: this.input, stellar: this.id,
            });
        }
    }

    /** Points the status bar at the docked ship for this landing. */
    setDockedShip(dockedShip: DockedShip) {
        this.dockedShip = dockedShip;
    }

    /**
     * Tells the outfit-trading venues which owned outfits are NOT aboard
     * for this landing — bay fighters still in flight or landed as escorts
     * (see spaceport/deployed_outfits.ts). Set per-landing, like
     * setDockedShip, because it closes over the docked ship's uuid.
     * Left unset, both venues assume everything owned is aboard.
     *
     * The SHIPYARD needs it too: a trade-in hands over the hull with its
     * bays, so it refuses to sell while a fighter is out (shipyard_rules
     * judgment call 8) exactly as the outfitter refuses to sell the bay.
     */
    setDeployedOutfitCounts(counts?: DeployedOutfitCounts) {
        this.outfitter.setDeployedOutfitCounts(counts);
        this.shipyard.setDeployedOutfitCounts(counts);
    }

    /**
     * Routes an open venue's live working state to the status bar (or clears
     * it, so the bar falls back to the docked entity's own components). A
     * venue's `dockedStatus()` reads its working copy, so the credits/cargo
     * readouts follow each transaction before Done commits it.
     */
    private setLiveStatus(source?: () => DockedLiveStatus) {
        if (this.dockedShip) {
            this.dockedShip.liveStatus = source;
        }
    }

    /**
     * Re-evaluates the Refuel button's visibility (hidden when the tank
     * is full) and greyed state (when the fill is unaffordable). The
     * original's spaceport shows no persistent credits/date line here, so
     * this no longer draws any text — it only drives the button.
     */
    private refreshRefuelButton(input?: Entity) {
        const entity = input ?? this.input;
        if (!entity) {
            return;
        }
        this.updateRefuelButton(entity);
    }

    /** Hidden when fuel is full; greyed when unaffordable. */
    private updateRefuelButton(entity: Entity) {
        const button = this.buttons.refuel;
        const fuel = entity.components.get(FuelComponent);
        if (!fuel || fuel.current >= fuel.max) {
            button.container.visible = false;
            return;
        }
        button.container.visible = true;
        const credits = entity.components.get(CreditsComponent);
        button.state = credits && credits.credits >= refuelCost(fuel)
            ? 'normal' : 'grey';
    }

    private refuel() {
        const entity = this.input;
        if (!entity) {
            return;
        }
        const fuel = entity.components.get(FuelComponent);
        const credits = entity.components.get(CreditsComponent);
        // Re-check rather than trusting button state: clicking flips a
        // Button to 'clicked'/'normal' regardless of greying.
        if (!fuel || fuel.current >= fuel.max || !credits) {
            this.refreshRefuelButton();
            return;
        }
        const cost = refuelCost(fuel);
        if (credits.credits < cost) {
            this.refreshRefuelButton();
            return;
        }
        // Mutating the docked entity's components is the standard
        // spaceport commit pattern (the entity is out of the world).
        credits.credits -= cost;
        fuel.current = fuel.max;
        this.refreshRefuelButton();
    }

    override async build() {
        await super.build();
        const data = await this.simulationData.data.Planet.get(this.id);
        this.data = data;
        // The outfitter stocks by this stellar's tech level / SpecialTech
        // and honours its "buys anything" flag (see outfitter_rules.ts).
        this.outfitter.setPlanet(data);
        // The shipyard stocks ships by the same tech level / SpecialTech
        // (see shipyard_stock_rules.ts) and rolls the per-day BuyRandom
        // pool against this stellar's id.
        // govt is not a stock gate; it is what a ränk PriceMod is matched
        // against (price_mod.ts).
        this.shipyard.setPlanet(
            {
                techLevel: data.techLevel, specialTech: data.specialTech,
                govt: data.govt,
            },
            this.id);
        const title = new PIXI.Text(data.name, this.font.title);
        title.anchor.x = 0.5;
        title.position.x = -2;
        title.position.y = 39;
        this.container.addChild(title);

        // Landing descriptions may carry dësc conditionals (e.g. the {G}
        // gender text in stellar 472). They are rendered once at build time,
        // before the docked entity is known, so only the pilot profile's gender
        // drives them (no control bits are read here).
        const desc = new PIXI.Text(
            resolveConditionalBlocks(data.landingDesc,
                makeDescTextContext(new Set(), playerGender())),
            this.font.desc);
        desc.position.x = -149;
        desc.position.y = 70;
        this.container.addChild(desc);


        // Venue buttons only appear where the stellar offers the
        // service (spöb flags).
        if (!data.flags.hasBar) {
            this.buttons.bar.container.visible = false;
        }
        if (!data.flags.hasCommodityExchange) {
            this.buttons.tradeCenter.container.visible = false;
        }
        if (!data.flags.hasOutfitter) {
            this.buttons.outfitter.container.visible = false;
        }
        if (!data.flags.hasShipyard) {
            this.buttons.shipyard.container.visible = false;
        }

        const spaceportPict = this.displayAssets.spriteFromPict(data.landingPict)
        spaceportPict.position.x = -306;
        spaceportPict.position.y = -256;
        this.container.addChild(spaceportPict)
        this.container.addChild(this.outfitter.container);
        this.container.addChild(this.shipyard.container);
        this.container.addChild(this.tradeCenter.container);
        this.container.addChild(this.missionComputer.container);
        this.container.addChild(this.bar.container);
        // The landing popups render over everything else on the spaceport.
        this.container.addChild(this.offerPopup.container);
    }

    protected override done() {
        if (this.data) {
            const movement = this.input.components.get(MovementStateComponent);
            if (movement) {
                movement.position = new Position(...this.data.position);
                movement.velocity = new Vector(0, 0);
            }
            const shield = this.input.components.get(ShieldComponent);
            if (shield) {
                shield.current = shield.max;
            }
            const armor = this.input.components.get(ArmorComponent);
            if (armor) {
                armor.current = armor.max;
            }
            const ionization = this.input.components.get(IonizationComponent);
            if (ionization) {
                ionization.current = 0;
            }
        }
        super.done();
    }
}
