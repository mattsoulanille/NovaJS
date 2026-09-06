import { StatusBarData } from "novadatainterface/status_bar_data";
import { RunQuery } from "nova_ecs/arg_types";
import { Optional } from "nova_ecs/optional";
import { MovementStateComponent } from "nova_ecs/plugins/movement_plugin";
import { Query } from "nova_ecs/query";
import { Resource } from "nova_ecs/resource";
import { System } from "nova_ecs/system";
import * as PIXI from "pixi.js";
import { DisabledComponent } from "../nova_plugin/ship/disabled_component.js";
import { DISCOVERY_ENTERED, DiscoveryLevel } from "../nova_plugin/player/discovery.js";
import { SimulationGameDataResource } from "../nova_plugin/core/game_data_resource.js";
import { FuelComponent, FUEL_PER_JUMP } from "../nova_plugin/ship/health_plugin.js";
import { JumpComponent, JumpRouteComponent, JUMP_DISTANCE } from "../nova_plugin/travel/jump_plugin.js";
import { canJump, jumpRadiusFor } from "../nova_plugin/travel/jump_readiness.js";
import { PlanetDataComponent, PlanetTargetComponent } from "../nova_plugin/travel/planet_plugin.js";
import { PlayerShipSelector } from "../nova_plugin/player/player_ship_plugin.js";
import { ShipPhysicsComponent } from "../nova_plugin/ship/ship_plugin.js";
import { navReadout, NavReadout } from "./status_bar_content.js";
import { NAV_HEADER_Y, NAV_VALUE_Y, StatusBarFonts } from "./status_bar_layout.js";
import { StatusBarResource } from "./status_bar_resource.js";

/**
 * How much the pilot knows about a system, for the navigation readout's
 * unexplored-destination gate. This is THE SAME display-side handle the
 * star map and the gate map are built with — `id => store.level(id)` over
 * the world's DiscoveryStoreResource (discovery_store.ts) — passed as a
 * resource because the readout lives in a System rather than in a constructed
 * object. REQUIRED, not Optional: a world that installs the readout without
 * a discovery record would silently name every system, which is the exact
 * leak this gate exists to close — better a loud "Missing resource" the
 * first step than a quiet one nobody notices. Declared here beside the
 * only system that reads it; StatusBarPlugin (status_bar.ts) sets it when
 * it installs the bar.
 *
 * Reading the store on every step is what makes the name appear LIVE on
 * arrival: entering a system calls markDiscovered, and the very next
 * display step sees level >= 1 and swaps the placeholder for the name.
 */
export const DiscoveryLevelResource =
    new Resource<(systemId: string) => DiscoveryLevel>('DiscoveryLevel');

/**
 * The "Stellar Navigation" pane: a dim header and the destination /
 * selected-stellar line beneath it, bright once a jump there would work.
 */
export class NavigationPane {
    /** Per-build; undefined between an ïntf reload's teardown and rebuild. */
    private texts?: { header: PIXI.Text, value: PIXI.Text };
    private fonts?: StatusBarFonts;
    private lastNav?: string;

    build(parent: PIXI.Container, data: StatusBarData, fonts: StatusBarFonts) {
        const nav = data.dataAreas.navigation;
        const container = new PIXI.Container();
        parent.addChild(container);
        container.position.set(nav.position[0], nav.position[1]);

        const header = new PIXI.Text("Stellar Navigation", fonts.dim);
        header.anchor.x = 0.5;
        header.anchor.y = 0;
        header.position.x = nav.size[0] / 2;
        header.position.y = NAV_HEADER_Y;
        container.addChild(header);

        const value = new PIXI.Text("No Destination", fonts.dim);
        value.anchor.x = 0.5;
        value.anchor.y = 0;
        value.position.x = nav.size[0] / 2;
        value.position.y = NAV_VALUE_Y;
        container.addChild(value);

        this.texts = { header, value };
        this.fonts = fonts;
    }

    /**
     * Destroys this build's texts (each owns a canvas texture) ahead of a
     * rebuild; the container they sat in is destroyed by StatusBar.reload
     * with the rest of the outgoing tree.
     */
    reset() {
        for (const text of Object.values(this.texts ?? {})) {
            text.destroy();
        }
        this.texts = undefined;
        this.lastNav = undefined;
    }

    destroy() {
        for (const text of Object.values(this.texts ?? {})) {
            if (!text.destroyed) {
                text.destroy();
            }
        }
        this.texts = undefined;
    }

    drawNavigation(readout: NavReadout) {
        if (!this.texts || !this.fonts) {
            return;
        }
        // `dim` belongs in the memo key, not just the text: becoming
        // able to jump changes ONLY the colour of an unchanged
        // destination name, so a header+value key would memoize the
        // restyle away and the readout would never brighten.
        // (The separator was a stray NUL byte, which made this whole
        // source file read as binary to grep and friends.)
        const key = `${readout.header}|${readout.value}|${readout.dim}`;
        if (key === this.lastNav) {
            return;
        }
        this.lastNav = key;
        this.texts.header.text = readout.header;
        this.texts.value.text = readout.value;
        this.texts.value.style = readout.dim ? this.fonts.dim : this.fonts.bright;
    }
}

const PlanetNavQuery = new Query([PlanetDataComponent] as const);
/** Exported for status_bar_navigation_test (the dim / in-flight rules). */
export const DrawStatusBarNavigation = new System({
    name: 'DrawStatusBarNavigation',
    args: [StatusBarResource, Optional(JumpRouteComponent),
        Optional(PlanetTargetComponent), Optional(JumpComponent),
        Optional(MovementStateComponent), Optional(ShipPhysicsComponent),
        Optional(FuelComponent), Optional(DisabledComponent), RunQuery,
        SimulationGameDataResource, DiscoveryLevelResource,
        PlayerShipSelector] as const,
    step(statusBar, jumpRoute, planetTarget, jump, movement, shipPhysics,
        fuel, disabled, runQuery, gameData, discoveryOf) {
        // WHERE THE SHIP IS ACTUALLY HEADED. A jump in progress shows ITS
        // destination, not the route's new head: beginJump (jump_plugin)
        // shifts the hop off the route the instant the sequence starts, so
        // reading route[0] mid-jump names the hop AFTER this one and the
        // readout jumps ahead of the ship. The simulation's ordering is
        // deliberate (multi-jump and rollback depend on it), so this is
        // fixed where it is a display question: prefer the in-flight jump's
        // own `to` and fall back to the route head.
        //
        // A vanishing jump's `to` is the empty-string sentinel
        // (VANISH_DESTINATION) and is falsy, so `??`-style truthiness keeps
        // the fallback correct — though a player ship never vanishes.
        const nextSystem = (jump?.to || undefined) ?? jumpRoute?.route[0];
        // getCached is undefined until the system data loads, then the name
        // appears.
        let destinationName: string | null = null;
        if (nextSystem) {
            destinationName =
                gameData.data.System.getCached(nextSystem)?.name ?? null;
        }

        // A DESTINATION THE PILOT HAS NEVER BEEN TO IS NOT NAMED. The star
        // map draws the ring of systems one jump out as unlabeled dim dots
        // and reads "<Unknown>" for their properties (discovery.ts), and a
        // route can be set to any of them — so printing the name here
        // would be a free lookup for exactly the systems the map hides.
        // Shows UNEXPLORED_SYSTEM instead, and the real name the step
        // after arrival marks the system discovered.
        const destinationExplored = nextSystem === undefined
            || discoveryOf(nextSystem) >= DISCOVERY_ENTERED;

        // Otherwise the selected stellar's name, read off the planet entity.
        let stellarName: string | null = null;
        if (planetTarget?.target) {
            const planet = runQuery(PlanetNavQuery, planetTarget.target)[0];
            stellarName = planet ? planet[0].name : null;
        }

        // DIM UNTIL JUMP-READY, off the shared readiness predicate
        // (nova_plugin/travel/jump_readiness.ts) that PlayerJumpControl gates on
        // and the nova:154 cue fires from — the destination brightens
        // exactly when pressing the jump key would work.
        //
        // A jump ALREADY UNDERWAY reads bright: `canJump` says no (the
        // 'jumping' blocker), but the ship is on its way to that very
        // destination, and dimming it for the length of the sequence would
        // be a lie in the other direction.
        //
        // Missing inputs (the components are Optional so this system keeps
        // drawing the panel in every state) fall back to `true`, i.e. the
        // pre-existing always-bright behavior.
        const jumpReady = jump !== undefined
            || (movement !== undefined && shipPhysics !== undefined
                && fuel !== undefined
                ? canJump({
                    hasRoute: nextSystem !== undefined,
                    distance: movement.position.length,
                    jumpRadius: jumpRadiusFor(JUMP_DISTANCE,
                        shipPhysics.jumpDistanceMod),
                    fuel: fuel.current,
                    fuelPerJump: FUEL_PER_JUMP,
                    disabled: disabled !== undefined,
                })
                : true);

        statusBar.navigation.drawNavigation(navReadout(
            destinationName, stellarName, jumpReady, destinationExplored));
    }
});
