import { RunQuery } from "nova_ecs/arg_types";
import { Optional } from "nova_ecs/optional";
import { MovementStateComponent } from "nova_ecs/plugins/movement_plugin";
import { Query } from "nova_ecs/query";
import { Resource } from "nova_ecs/resource";
import { System } from "nova_ecs/system";
import { DisabledComponent } from "../nova_plugin/disabled_component.js";
import { DISCOVERY_ENTERED, DiscoveryLevel } from "../nova_plugin/discovery.js";
import { SimulationGameDataResource } from "../nova_plugin/game_data_resource.js";
import { FuelComponent, FUEL_PER_JUMP } from "../nova_plugin/health_plugin.js";
import { JumpComponent, JumpRouteComponent, JUMP_DISTANCE } from "../nova_plugin/jump_plugin.js";
import { canJump, jumpRadiusFor } from "../nova_plugin/jump_readiness.js";
import { PlanetDataComponent, PlanetTargetComponent } from "../nova_plugin/planet_plugin.js";
import { PlayerShipSelector } from "../nova_plugin/player_ship_plugin.js";
import { ShipPhysicsComponent } from "../nova_plugin/ship_plugin.js";
import { navReadout } from "./status_bar_content.js";
import { StatusBarResource } from "./status_bar_resource.js";

/**
 * How much the pilot knows about a system, for the navigation readout's
 * unexplored-destination gate. This is THE SAME display-side handle the
 * star map and the gate map are built with — `id => discoveryLevel(id)`
 * over the per-pilot record in discovery_store.ts — passed as a resource
 * because the readout lives in a System rather than in a constructed
 * object. REQUIRED, not Optional: a world that installs the readout without
 * a discovery record would silently name every system, which is the exact
 * leak this gate exists to close — better a loud "Missing resource" the
 * first step than a quiet one nobody notices. StatusBarPlugin sets it.
 *
 * Reading the store on every step is what makes the name appear LIVE on
 * arrival: entering a system calls markDiscovered, and the very next
 * display step sees level >= 1 and swaps the placeholder for the name.
 */
export const DiscoveryLevelResource =
    new Resource<(systemId: string) => DiscoveryLevel>('DiscoveryLevel');

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
        // (nova_plugin/jump_readiness.ts) that PlayerJumpControl gates on
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

        statusBar.drawNavigation(navReadout(
            destinationName, stellarName, jumpReady, destinationExplored));
    }
});
