NovaJS
======

This is an experiment in making Escape Velocity Nova run in the browser. Escape Velocity Nova (EV Nova) is a game created by [Ambrosia Software](http://www.ambrosiasw.com/) in collaboration with [ATMOS](https://en.wikipedia.org/wiki/ATMOS_Software).

[Here's a live demo of the main branch](https://novajs.net) (supports multiplayer, works in modern browsers). There's also a [demo of the alpha js release](http://54.173.49.38/), which is an earlier version written in JavaScript ([0.1-alpha-js](https://github.com/mattsoulanille/NovaJS/releases/tag/v0.1-alpha-js)).

#### Controls (mostly standard EV Nova):
* Arrow keys to move
* Spacebar to fire
* **There is a button on the right side of the screen to add enemy ships.**
* L while moving slowly over a planet to land
* Tab to select a target
* W to choose a secondary weapon
* **Left Shift to fire secondary weapon** (not only Ctrl since that's used by Windows)
* R to choose nearest target
* Hold A to point towards target.
* M to open the map and select a system to jump to.
* J to jump.
* **Scroll down in the outfitter and shipyard with the arrow keys to see more items**

### Project Goals
* Function as a Nova Engine that can, given Nova files, run EV Nova.
* Support Nova Plug-ins.
* Improve on some of the issues with EV Nova's engine (such as limited turning angles) as long as doing so does not negatively affect gameplay.
* **Support multiplayer to an extent.**

## Wait, but isn't EV Nova Copyrighted?

Yes. Escape Velocity Nova is copyrighted by Ambrosia Software. I claim no rights to anything in the [objects](./packages/nova/objects) directory. The end goal of this project is to write a Nova engine that can interpret Nova files without including any Nova data itself.
## Getting Started

### Prerequisites

* [node.js](https://nodejs.org/) 22 or newer (what `engines` declares and what the Docker image and CI run), with the npm it ships.
* A Mac copy of EV Nova ([mirror](https://www.reddit.com/r/evnova/comments/cwwjnf/ambrosia_software_mediafire_archive_mirror/), [direct link](http://www.tuxedojack.com/hosted/ambrosia-archive/mac/Action-Adventure/EVNova%201.1.1.dmg)). The repo contains no game data.

### Building

The project is an npm-workspaces monorepo built with [turborepo](https://turbo.build/); the `turbo` binary is a devDependency, so nothing needs installing globally.

```
git clone https://github.com/mattsoulanille/NovaJS.git
cd NovaJS
npm ci          # never `npm install`: the lockfile is the build
npm run build   # turbo run build — every package, in dependency order
```

### Game data

Put (or symlink) your `Nova Files` and `Plug-ins` directories in `packages/nova/Nova_Data/`, so that `packages/nova/Nova_Data/Nova Files/Nova Data 1.ndat` exists. Files must be `.ndat` or Mac resource-fork format; Windows `.res` is not supported. On macOS a symlink is better than a copy, because the resource forks live in extended attributes that some copies drop. `NOVA_DATA_PATH=/some/dir` overrides the location.

For a git worktree, `scripts/setup_worktree.sh [<commit>]` does the linking, `npm ci` and the build in one go (set `NOVA_DATA_CANONICAL` to where your data lives).

### Running

```
npm start                  # serves on port 8000 (settings/server.json)
PORT=8080 npm start        # the PORT env var overrides it
npm run dev                # rebuild and restart on change (turbo watch)
```

Then open [localhost:8000](http://localhost:8000).

### Testing

```
npm test                   # turbo run test — every package
```

Specs that read the real game data mark themselves *pending* when `packages/nova/Nova_Data/Nova Files` is absent, so the suite is green (with several hundred pending specs) on a checkout without data; install it to run them. To run one package with a fixed spec order: `cd packages/nova && npx jasmine --config=jasmine.json --seed=22715`.

#### The synthetic data set

`packages/nova/test_fixtures/synthetic/` is a small, entirely original Nova scenario in the game's own file format — four systems, five stellars (a port, a moon, a hypergate pair, a hidden station), three ship classes with hand-drawn sprites, a blaster / missile / beam / turret / point defence / fighter bay / cloak, two governments, NPC tables, missions, ranks and a default pilot — that loads through the same parser as the real files and needs no copyrighted data. Specs that are about the engine rather than about stock content run on it through `getSyntheticGameData()` (`packages/nova/src/communication/simulation_test_fixture.ts`, whose header has the conversion recipe); `SYNTHETIC` in `packages/novaparse/src/synthetic/universe.ts` names its ids.

The `.ndat` is generated, checked in, and pinned by a spec: after editing the scenario (`packages/novaparse/src/synthetic/`), run `cd packages/novaparse && npm run synthetic-data` and commit the result.

## Deployment

`docker/Dockerfile` builds a production image of the `nova` package (`turbo prune` keeps only what it needs); `docker/docker-compose.yml` runs it on port 8000 with your `packages/nova/Nova_Data` mounted in:

```
docker compose -f docker/docker-compose.yml up --build
```

`deploy_demo.yaml` is the Cloud Build pipeline for the public demo: test, build the image, push it, and deploy it to Cloud Run with the game data mounted from a GCS bucket at `NOVA_DATA_PATH`.

### Build version and client force-reload
Multiplayer assumes every peer runs the **same build** of NovaJS, and the server enforces it. `npm run build` stamps the build (the commit sha, or `<sha>-dirty-<timestamp>` from a dirty tree) into both the server and the browser bundle. A client announces its stamp when it opens its websocket; if it does not match, the server closes the socket before admitting it to any room and the page shows "Game updated — reloading…" and reloads once to pick up the new bundle. So **redeploying force-reloads connected players** — that is intended, and it is what keeps a stale cached bundle from desyncing against updated peers.

Two consequences while developing:
- The server and the bundle are stamped by the *same* `npm run build`. If you rebuild the client but do not restart the server (or vice versa), connected clients will mismatch. Reloading will not fix it, so after one automatic reload the page shows a persistent "hard-refresh" message instead of looping. Rebuild and restart both, then hard-refresh.
- Rebuilding a dirty tree always produces a new stamp, so every rebuild disconnects and reloads any client that is connected.
- The stamp lives in `packages/nova/src/common/generated_build_version.ts`, which is generated by the build and **gitignored**. On a fresh clone that file does not exist yet, so a bare `npx tsc` (or your editor's TypeScript server) will report it as a missing module until you have run `npm run build` once. `npm test` is unaffected — the test task depends on the build.

See Phase 3 item 7 of [docs/rollback_multiplayer.md](./docs/rollback_multiplayer.md) for the design.
## Contributing

Accepting PRs, but this project is still in early stages. Documentation is poor at best. See the issues tab for good first issues (although there might not be any at the moment).


## Project Structure
The project is organized as a monorepo (npm workspaces under `packages/`, built with turborepo) and has several subpackages:
* `nova`: The server, client, and engine for NovaJS.
* `novaparse`: Parses Nova Files and Plug-ins.
* `resource_fork`: Parses Mac resource forks (what `.ndat` files and Plug-ins are made of).
* `novadatainterface`: The interface implemented by `novaparse` and used by `nova`. It's a separate package because it made development easier while the project was using lerna to manage its monorepo, but it could perhaps be merged into `nova` (but this is low priority).
* `nova_ecs`: The Entity Component System used by NovaJS.

(Why does `nova_ecs` use snake case while the others don't? I don't actually know. I should change `novaparse` and `novadatainterface` into `nova_parse` and `nova_data_interface`)

## Known Bugs
* Ship velocity scaling is wrong in that ships are far too fast. I think the scale should be 3/10 of what it currently is, but Nova gives a speed boost to the player when they're not playing in strict mode, so I don't know what the actual scale is. Perhaps the coordinate system needs to be redone so that no scaling is needed for non-player ships?
* Beam weapons do not clip after colliding with a target and instead pass through as if they did not collide (more of a feature that hasn't been implemented yet).
* Beam weapons seem to do too much damage.

## Unsolved Multiplayer Questions
* How will mission strings that significantly change the universe work?
  * Put people in their respective system for every changed system? But then it's not multiplayer.
  * Put everyone in the same system, but make the planets different based on the state of the universe? But there are fleets...
  * Choose a system randomly and put everyone in it?
    * How do you detect which systems are actually just different instances of the same system (e.g. when you complete a certain storyline, certain systems of a specific government get annexed, but they'd need to remain not-taken-over for other players)?
  * This is probably the biggest proplem with multiplayer support, and I welcome any suggestions.
* How will dates work? Realtime is definitely a bad idea for timing missions since it takes time to read the dialogue. Maybe everyone just has a different date that changes normally (when you jump / land)?
* Will there be some form of chat, and if so, where will it be? Perhaps you need to hail other ships to talk to them? Perhaps it's just in the bottom left info area?
* How will hailing other ships be managed when the game can't just pause at any time?
* How will 2x speed work on a client basis? (It probably just won't and will be a server-configured option).
* How should pilot files be saved? How should deaths be handled?





