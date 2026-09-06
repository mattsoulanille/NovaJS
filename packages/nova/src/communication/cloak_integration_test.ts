import "jasmine";
import { Emit } from "nova_ecs/arg_types";
import { System } from "nova_ecs/system";
import { SingletonComponent } from "nova_ecs/world";
import { completeEntity } from "../nova_plugin/spawn/entity_data_loader.js";
import {
    CLOAK_OFF_SOUND,
    CLOAK_ON_SOUND,
    CloakActiveComponent,
    CloakComponent,
} from "../nova_plugin/ship/cloak_plugin.js";
import { PlayerSoundEvent } from "../nova_plugin/core/sound_plugin.js";
import { DamagedEvent } from "../nova_plugin/ship/death_plugin.js";
import { ShieldComponent } from "../nova_plugin/ship/health_plugin.js";
import { makeShip } from "../nova_plugin/ship/make_ship.js";
import { makeSystem } from "../nova_plugin/make_system.js";
import { PlayerShipSelector } from "../nova_plugin/player/player_ship_plugin.js";
import { applyControlEvents } from "../nova_plugin/player/ship_control.js";
import { ControlledByComponent } from "../nova_plugin/player/ship_control.js";
import { getIntegrationGameData } from "./simulation_test_fixture.js";

// A ship carrying the Polaris Cloaking Organ v1.1 (outfit nova:269) with
// count >= 1: ModVal 0x0409 = 4 shield/sec drain, deactivates-when-hit,
// faster fade, hides from radar. Found by scanning the real Nova data.
// (nova:406 lists the cloak with count 0, so it does not cloak.)
const CLOAK_SHIP_ID = "nova:272"; // "Raven;Cloaking+fast jump"

async function makeCloakWorld() {
    const gameData = await getIntegrationGameData();
    const ids = await gameData.ids;
    const systemId = [...ids.System].sort()[0]!;
    const world = await makeSystem(systemId, gameData, "worker", { npcs: false });

    const shipData = await gameData.data.Ship.get(CLOAK_SHIP_ID);
    const ship = makeShip(shipData);
    ship.components.set(PlayerShipSelector, undefined);
    ship.components.set(ControlledByComponent, { peerId: "test peer" });
    await completeEntity(world, ship);
    const uuid = "cloak ship";
    world.entities.set(uuid, ship);
    // Warm up so derivers run and data is loaded.
    world.step();
    return { world, ship, uuid };
}

/** Emits a DamagedEvent at a ship, as the DamageSystem consumers see it. */
function damage(world: Awaited<ReturnType<typeof makeCloakWorld>>["world"],
    uuid: string) {
    const emitSystem = new System({
        name: "TestEmitDamage",
        args: [Emit, SingletonComponent] as const,
        step(emit) {
            emit(DamagedEvent, {
                damage: {
                    shield: 1, armor: 0, ionization: 0, ionizationColor: 0,
                    passThroughShield: 0, knockback: 0,
                },
                damager: "attacker",
            }, [uuid]);
        },
    });
    world.addSystem(emitSystem);
    world.step();
    world.removeSystem(emitSystem);
}

describe("cloak integration (real Nova data)", () => {
    it("derives a cloak capability for a cloak-equipped ship", async () => {
        const { ship } = await makeCloakWorld();
        const cloak = ship.components.get(CloakComponent);
        expect(cloak?.canCloak)
            .withContext(`${CLOAK_SHIP_ID} should carry a cloaking device`)
            .toBe(true);
        // Polaris v1.1 (0x0409): drains shields, decloaks on hit, hides radar.
        expect(cloak?.shieldPerSecond).toBe(4);
        expect(cloak?.deactivatesWhenHit).toBe(true);
        expect(cloak?.hidesFromRadar).toBe(true);
    }, 60_000);

    it("toggles the cloak on the 'cloak' control edge and drains shields",
        async () => {
        const { world, ship, uuid } = await makeCloakWorld();
        expect(ship.components.get(CloakActiveComponent)?.active ?? false)
            .toBe(false);

        applyControlEvents(world, "test peer",
            [{ action: "cloak", state: "start" }]);
        world.step();

        expect(ship.components.get(CloakActiveComponent)?.active)
            .withContext("cloak should activate on the control edge")
            .toBe(true);

        const shield = ship.components.get(ShieldComponent)!;
        const before = shield.current;
        // Let the drain system run several ticks.
        for (let i = 0; i < 30; i++) {
            world.step();
        }
        expect(shield.current)
            .withContext("shields should drain while cloaked")
            .toBeLessThan(before);
    }, 60_000);

    it("decloaks when the ship takes damage (deactivates-when-hit)",
        async () => {
        const { world, ship, uuid } = await makeCloakWorld();
        applyControlEvents(world, "test peer",
            [{ action: "cloak", state: "start" }]);
        world.step();
        expect(ship.components.get(CloakActiveComponent)?.active).toBe(true);

        damage(world, uuid);

        expect(ship.components.get(CloakActiveComponent)?.active)
            .withContext("a hit should decloak this ship (ModVal 0x0008)")
            .toBe(false);
    }, 60_000);

    // The cloak sounds ride the PlayerSoundEvent channel: the sim emits
    // them targeted at the cloaking ship on every transition (any decloak
    // path), and the display's PlayerSoundSystem plays them only for the
    // local player's ship — same rule and machinery as the warp sounds.
    // The local-player display filtering itself is covered by
    // display/sound_plugin_test.ts.
    describe("cloak sounds", () => {
        function recordSounds(
            world: Awaited<ReturnType<typeof makeCloakWorld>>["world"]) {
            const sounds: { id: string, targets: string[] }[] = [];
            world.events.get(PlayerSoundEvent).subscribe(
                ({ data, entities }) => {
                    sounds.push({
                        id: data.id,
                        targets: (entities ?? []).map(
                            e => typeof e === "string" ? e : e.uuid),
                    });
                });
            return sounds;
        }

        it("emits cloak-on then cloak-off, targeted at the ship, on toggles",
            async () => {
            const { world, uuid } = await makeCloakWorld();
            const sounds = recordSounds(world);

            applyControlEvents(world, "test peer",
                [{ action: "cloak", state: "start" }]);
            world.step();
            expect(sounds).toEqual(
                [{ id: CLOAK_ON_SOUND, targets: [uuid] }]);

            // Steady cloaked ticks emit nothing (once per edge).
            world.step();
            world.step();
            expect(sounds.length).toBe(1);

            applyControlEvents(world, "test peer",
                [{ action: "cloak", state: "start" }]);
            world.step();
            expect(sounds).toEqual([
                { id: CLOAK_ON_SOUND, targets: [uuid] },
                { id: CLOAK_OFF_SOUND, targets: [uuid] },
            ]);
        }, 60_000);

        it("emits cloak-off when a hit drops the cloak", async () => {
            const { world, uuid } = await makeCloakWorld();
            applyControlEvents(world, "test peer",
                [{ action: "cloak", state: "start" }]);
            world.step();
            const sounds = recordSounds(world);

            damage(world, uuid);

            expect(sounds).toEqual(
                [{ id: CLOAK_OFF_SOUND, targets: [uuid] }]);
        }, 60_000);

        it("emits cloak-off when resource exhaustion drops the cloak",
            async () => {
            const { world, ship, uuid } = await makeCloakWorld();
            applyControlEvents(world, "test peer",
                [{ action: "cloak", state: "start" }]);
            world.step();
            const sounds = recordSounds(world);

            // Pin shields at the floor so the drain system decloaks on
            // its next tick (Polaris v1.1 drains shields while cloaked).
            const shield = ship.components.get(ShieldComponent)!;
            shield.current = shield.min;
            shield.recharge = 0;
            world.step();

            expect(ship.components.get(CloakActiveComponent)?.active)
                .toBe(false);
            expect(sounds).toEqual(
                [{ id: CLOAK_OFF_SOUND, targets: [uuid] }]);
        }, 60_000);
    });
});
