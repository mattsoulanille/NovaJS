NovaJS
======

This is an experiment in making Escape Velocity Nova run in the browser. Escape Velocity Nova (EV Nova) is a game created by [Ambrosia Software](http://www.ambrosiasw.com/) in collaboration with [ATMOS](https://en.wikipedia.org/wiki/ATMOS_Software).

[Here's a running example that supports multiplayer](http://54.173.49.38/) (works in modern browsers). This version is running release [0.1-alpha-js](https://github.com/mattsoulanille/NovaJS/releases/tag/v0.1-alpha-js), an earlier version written in JavaScript. The main branch's version is undergoing a rewrite / redesign, and is not at feature parity with the JS version yet. [Here's a running example of the main branch](https://nova-x2e2pof5ua-uc.a.run.app).

#### Controls (mostly standard EV Nova):
* Arrow keys to move
* Spacebar to fire
* **There is a button on the right side of the screen to add enemy ships.**
* L while moving slowly over a planet to land
* Tab to select a target
* W to choose a secondary weapon
* **Left Shift to fire secondary weapon** (not Ctrl since that's used by Windows)
* R to choose nearest target
* Hold A to point towards target.
* Z for afterburner (if installed)
* **Scroll down in the outfitter and shipyard with the arrow keys to see more items**

### Project Goals
* Function as a Nova Engine that can, given Nova files, run EV Nova.
* Support Nova Plug-ins.
* Improve on some of the issues with EV Nova's engine (such as limited turning angles) as long as doing so does not negatively affect gameplay.
* **Support multiplayer to an extent.**

### Related Projects
* [NovaParse](https://github.com/mattsoulanille/NovaParse): The parser for NovaJS



## Wait, but isn't EV Nova Copyrighted?

Yes. Escape Velocity Nova is copyrighted by Ambrosia Software. I claim no rights to anything in the [objects](https://github.com/mattsoulanille/NovaJS/tree/master/Nova/objects) directory. The end goal of this project is to write a Nova engine that can interpret Nova files without including any Nova data itself.
## Getting Started
### Prerequisites

[node.js](https://nodejs.org/),
[npm](https://www.npmjs.com/),
[A Mac copy of EV Nova](https://www.reddit.com/r/evnova/comments/cwwjnf/ambrosia_software_mediafire_archive_mirror/) ([Direct Link](http://www.tuxedojack.com/hosted/ambrosia-archive/mac/Action-Adventure/EVNova%201.1.1.dmg))

### Installing
#### For the main branch
##### Clone the main branch
```
git clone https://github.com/mattsoulanille/NovaJS.git
```
##### Install dependencies with Yarn
```
cd NovaJS/
yarn
```
If you are using Ubuntu and see `00h00m00s 0/0: : ERROR: There are no scenarios; must have at least one.` after running `yarn`, you may need to `apt install yarnpkg` instead (and substitue `yarnpkg` wherever you see `yarn` in this readme).

##### (Optional) Read from the Bazel Remote Cache
To speed up compilation and test time, you can configure Bazel to use cached build and test results created by the project's continouous integration runs. To enable this, add `build --config=remote_cache` to `.bazelrc.user` at the root of the project. You may need to create `.bazelrc.user`.

##### (Optional) Run the tests
Tests can be run with `yarn test`. This will take a while the first time it's run since it tests all targets in the project. This includes building docker images for NovaJS. Subsequent runs should be much faster.

##### Add Nova Files and Plug-ins
Copy your `Nova Files` and `Plug-ins` directories to the `nova/Nova_Data/` directory. Make sure files are in `.ndat` or Mac resource fork format. Windows `.res` is not yet supported (PRs welcome though). Since resource fork is Mac-specific, Plug-ins can be saved as `.ndat` for use on Windows and Linux. Ideally, this won't matter once `.res` is supported, but that's a lower priority at the moment. If this proves annoying for users or developers, I can try to fix it.

##### Run NovaJS
To start NovaJS, run 
```
yarn start
```

To watch for changes and automatically restart, run
```
yarn watch
```

To run with docker, run
```
yarn bazel run //nova:nova_image
```
This of course requires docker to be installed (and I've only gotten it to work on Linux. I've tried on Mac, but not Windows yet).

#### For the [alpha js relase](https://github.com/mattsoulanille/NovaJS/releases):

Download the release with your browser or with the following command
```
curl -L https://github.com/mattsoulanille/NovaJS/archive/v0.1-alpha-js.tar.gz | tar xzf -
```

Move your Nova Files and Plug-ins to the ```Nova Data``` directory in the unzipped release.
###### Make sure you're using the Mac version of EV Nova. Windows EV Nova file formats are currently unsupported, so make sure your Nova files end with `.ndat`
```
cd NovaJS-0.1-alpha-js/
cp -r /path/to/EV\ Nova.app/Contents/Resources/Nova\ Files/ ./Nova\ Data/
mkdir ./Nova\ Data/Plug-ins/
```
###### You can add any plug-ins you like in the Plug-ins directory. Just make sure they're in the Mac format or the Nova Data `.ndat` format if you're using Windows / Linux.

Install packages with `npm` (note that this is different from the main branch, which uses `yarn`)
```
npm install
```
Build for release with 
```
npm run build
```
Alternatively, build for development and debugging with
```
npm run build-debug
```
At this point, you can run NovaJS with
```
npm run run
```
You can also use
```
npm run watch
```
to compile incremental changed made to the browser's code, but you will still need to do a full `npm run build-server` and restart the server for changes to be applied to the server.

By default the JS release runs on port 8000 but can be changed by editing the `port` variable in `settings/server.json`. Assuming you installed on the machine you would like to play from, navigate to [localhost:8000](http://localhost:8000).

## Running the Tests
The available tests can be run with `yarn test`.

## Deployment
Deployment for the js release is the same as installation, however, the port used for the server can be changed by editing the `port` variable in `settings/server.json`. The main branch does not support deployment yet.

## Contributing

TBD once the rewrite has feature parity with the js version.


## Known Bugs
* Ship velocity scaling is wrong in that ships are far too fast. I think the scale should be 3/10 of what it currently is, but Nova gives a speed boost to the player when they're not playing in strict mode, so I don't know what the actual scale is. Perhaps the coordinate system needs to be redone so that no scaling is needed for non-player ships?
* Beam weapons do not clip after colliding with a target and instead pass through as if they did not collide (more of a feature that hasn't been implemented yet).
* Beam weapons seem to do too much damage.

## Unsolved Multiplayer Questions
* How will mission strings that significantly change the universe work?
  * Put people in their respective system for every changed system? But then it's not multiplayer.
  * Put everyone in the same system, but make the planets different based on the state of the universe? But there are fleets...
  * Choose a system randomly and put everyone in it?
    * How do you detect which systems are actually just different instances of the same system?
  * This is probably the biggest proplem with multiplayer support, and I welcome any suggestions.
* How will dates work? Realtime is definitely a bad idea for timing missions since it takes time to read the dialogue. Maybe everyone just has a different date that changes normally (when you jump / land)?
* Will there be some form of chat, and if so, where will it be? Perhaps you need to hail other ships to talk to them? Perhaps it's just in the bottom left info area?
* How will hailing other ships be managed when the game can't just pause at any time?
* How will 2x speed work on a client basis? (It probably just won't and will be a server-configured option).
* How should pilot files be saved? How should deaths be handled?





