# Design: Splitting GameData for the Engine Worker

This document describes how browser-side game data loading should be split to support an engine Web Worker.

The current `GameData` class mixes two responsibilities:
- structured gameplay data access needed by simulation,
- and browser/display asset loading needed by PIXI and sound playback.

For the worker architecture, these concerns should be separated.

## Goals

1. Let the engine worker load the gameplay data it needs without depending on PIXI or browser display APIs.
2. Keep texture, sprite, and sound loading on the main thread.
3. Minimize churn by preserving the current resource model where practical.
4. Avoid proxying arbitrary `GameData` calls from the worker to the main thread.

## Non-Goals

1. Making `NovaParse` browser-worker-ready. It remains server-side.
2. Designing a completely new asset pipeline in the same change.
3. Sharing live `GameData` objects between threads.

## Why Split GameData

The engine worker should not depend on display-side loading concerns such as:
- `PIXI.Assets`,
- `PIXI.Texture` and `PIXI.Sprite`,
- `@pixi/sound`,
- or any main-thread display cache.

If the worker reaches those APIs indirectly through `GameData`, the split between simulation and presentation is weakened immediately.

A separate `SimulationGameData` keeps worker startup, caching, and simulation dependencies explicit.

## Proposed Layers

### 1. SimulationGameData

`SimulationGameData` is the worker-safe data layer.

Properties:
- no PIXI imports,
- no sound imports,
- no DOM assumptions,
- loads structured gameplay resources only,
- safe to construct inside the engine worker.

Resources it should provide:
- `Ship`
- `Outfit`
- `Weapon`
- `Planet`
- `System`
- `SpriteSheet`
- `SpriteSheetFrames` if simulation needs rotation-to-hull or related collision metadata

Resources it should not provide:
- `Pict`
- `PictImage`
- `Cicn`
- `CicnImage`
- `SpriteSheetImage`
- `StatusBar`
- `TargetCorners`
- `Explosion`
- `SoundFile`
- `Sound`
- any texture/sprite helper methods

### 2. DisplayAssetData

`DisplayAssetData` is the main-thread display/UI data layer.

Properties:
- may depend on PIXI and `@pixi/sound`,
- owns texture/sprite/sound creation,
- may cache display assets aggressively,
- exists only on the main thread.

Resources it should provide:
- `Pict`
- `PictImage`
- `Cicn`
- `CicnImage`
- `SpriteSheetImage`
- `StatusBar`
- `TargetCorners`
- `Explosion`
- `SoundFile`
- `Sound`
- texture/sprite helper methods such as `textureFromPict`

`SpriteSheetFrames` may also be available here if display animation needs it.

## Resource Ownership

The practical split is by runtime responsibility, not by whether something happens to be JSON.

### Worker-Owned Structured Data

The engine worker should own and load:
- `Ship`
- `Outfit`
- `Weapon`
- `Planet`
- `System`
- `SpriteSheet`
- `SpriteSheetFrames` if required for collision or simulation-relevant hull selection

### Main-Thread Display Data

The main thread should own and load:
- `Pict`
- `PictImage`
- `Cicn`
- `CicnImage`
- `SpriteSheetImage`
- `StatusBar`
- `TargetCorners`
- `Explosion`
- `SoundFile`
- `Sound`

### Potentially Shared Structured Data

`SpriteSheetFrames` may need to be loaded on both sides:
- by the worker for collision/hull selection,
- by the display side for animation frame metadata.

That is acceptable. Both threads can fetch/cache the same resource independently.

## Avoid RPC-Based GameData Access

The worker should not make arbitrary RPC calls into a main-thread `GameData` instance for normal simulation data access.

That approach is undesirable because:
- it inserts thread hops into data access,
- it makes simulation behavior depend on RPC timing and cache behavior,
- it keeps simulation coupled to a display-oriented abstraction,
- and it makes testing and deterministic reasoning harder.

Instead:
- the worker constructs its own `SimulationGameData`,
- the main thread constructs its own `DisplayAssetData`,
- both fetch from the same HTTP/server endpoints as needed.

## Suggested Interface Shape

### SimulationGameDataInterface

> **Superseded by code.** The shipped `SimulationGameData`
> (`packages/nova/src/client/gamedata/simulation_game_data.ts`) exposes
> seventeen gettables, not the seven sketched below: Ship, Outfit, Weapon,
> Planet, System, Govt, Dude, Fleet, Junk, Oops, SpriteSheet, Asteroid,
> Mission, Pers, Cron, PlayerStart and Rank (everything the simulation
> plug-ins read — NPC spawning, missions, cröns, ranks — and no
> `SpriteSheetFrames`, which is display-only). The sketch is kept for the
> reasoning; the file is the contract.

```ts
interface SimulationGameDataInterface {
    ids: Promise<NovaIDs>;
    data: {
        Ship: Gettable<ShipData>;
        Outfit: Gettable<OutfitData>;
        Weapon: Gettable<WeaponData>;
        Planet: Gettable<PlanetData>;
        System: Gettable<SystemData>;
        SpriteSheet: Gettable<SpriteSheetData>;
        SpriteSheetFrames: Gettable<SpriteSheetFramesData>;
    };
}
```

### DisplayAssetDataInterface

```ts
interface DisplayAssetDataInterface {
    data: {
        Pict: Gettable<PictData>;
        PictImage: Gettable<ArrayBuffer>;
        Cicn: Gettable<CicnData>;
        CicnImage: Gettable<ArrayBuffer>;
        SpriteSheetImage: Gettable<ArrayBuffer>;
        SpriteSheetFrames: Gettable<SpriteSheetFramesData>;
        StatusBar: Gettable<StatusBarData>;
        TargetCorners: Gettable<TargetCornersData>;
        Explosion: Gettable<ExplosionData>;
        SoundFile: Gettable<ArrayBuffer>;
        Sound: Gettable<sound.Sound>;
    };

    textureFromPict(id: string): PIXI.Texture;
    spriteFromPict(id: string): PIXI.Sprite;
    textureFromPictAsync(id: string, priority?: number): Promise<PIXI.Texture>;
}
```

The exact interface names are less important than the boundary:
- simulation code must not reach display assets,
- display code may use its own asset helpers freely.

## Migration Strategy

### Option A: Extract New Classes and Keep GameData as a Facade

This is the lowest-risk path.

1. Create `SimulationGameData` with only worker-safe resources.
2. Create `DisplayAssetData` with display-only resources and helpers.
3. Keep the current `GameData` name on the main thread as a facade that delegates internally to those two layers where helpful.
4. Make the worker depend only on `SimulationGameData`.

This allows incremental migration without rewriting every main-thread call site immediately.

### Option B: Replace GameData Entirely

This is cleaner eventually, but likely creates more churn up front.

1. Replace current `GameData` references with `SimulationGameData` or `DisplayAssetData` explicitly.
2. Update plugins/resources to depend on the narrower interface they actually need.

## Plugin Dependency Direction

As a rule:
- simulation plugins under `nova_plugin` should depend on `SimulationGameData`,
- display plugins under `display/` should depend on `DisplayAssetData` or a main-thread facade,
- shared code should depend on the narrowest interface it actually needs.

## Open Questions

1. Whether `SpriteSheetFrames` is truly required by simulation, or whether the collision-relevant mapping should be folded into `SpriteSheet`.
2. Whether display-only structured resources such as `StatusBar` and `TargetCorners` should stay inside `DisplayAssetData` or be fetched more directly by specific display plugins.
3. Whether preloaded structured data should be duplicated across threads or loaded lazily and independently.
4. Whether there should be one HTTP/data cache shared at the browser level, or separate caches per thread.

## Recommended First Milestone

1. Extract `SimulationGameData` from the current browser `GameData` implementation.
2. Ensure it has no PIXI or sound imports.
3. Point one simulation-world construction path at `SimulationGameData`.
4. Leave the current display code using the existing `GameData` facade until the worker refactor needs a cleaner `DisplayAssetData` API.

That gets the critical boundary in place with minimal disruption.
