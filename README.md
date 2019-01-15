NovaJS
======

This is an experiment in making Escape Velocity Nova run in the browser. Escape Velocity Nova (EV Nova) is a game created by [Ambrosia Software](http://www.ambrosiasw.com/) in collaboration with [ATMOS](https://en.wikipedia.org/wiki/ATMOS_Software).

~[Here's a running example](http://165.82.246.25:8000/) (works in modern browsers).~ Down due to server costs.

### Project Goals
* Function as a Nova Engine that can, given Nova files, run EV Nova.
* Support Nova Plug-ins.
* Improve on some of the issues with EV Nova's engine (such as limited turning angles) as long as doing so does not negatively affect gameplay.
* Support multiplayer to an extent.

### Related Projects
* [NovaParse](https://github.com/mattsoulanille/NovaParse): The parser for NovaJS



## Wait, but isn't EV Nova Copyrighted?

Yes. Escape Velocity Nova is copyrighted by Ambrosia Software. I claim no rights to anything in the [objects](https://github.com/mattsoulanille/NovaJS/tree/master/Nova/objects) directory, nor do I claim any rights over pictures or Nova Data in this repository. The end goal of this project is to write a Nova engine that can interpret Nova files without including any Nova data itself, thereby avoiding these legal issues.

## Getting Started
### Prerequisites

[node.js](https://nodejs.org/),
[npm](https://www.npmjs.com/),
[A Mac copy of EV Nova](https://www.ambrosiasw.com/games/evn/)

### Installing

Clone the repository
```
git clone git@github.com:mattsoulanille/NovaJS.git
```
Move to the `NovaJS/` directory
```
cd NovaJS/
```

Move your Nova Files and Plug-ins to the ```Nova Data``` directory
###### Make sure you're using the Mac version of EV Nova. Windows EV Nova file formats are currently unsupported, so make sure your Nova files end with `.ndat`
```
cp -r /path/to/EV\ Nova.app/Contents/Resources/Nova\ Files/ ./Nova\ Data/
mkdir ./Nova\ Data/Plug-ins/
```
###### You can add any plug-ins you like in the Plug-ins directory. Just make sure they're in the Mac format or the Nova Data `.ndat` format if you're using Windows.

Install packages with `npm`
```
npm install
```
Build for release with 
```
npm run-script build
```
Alternatively, build for development with
```
npm run-script watch
```
At this point, you can run NovaJS with
```
npm run-script run
```
By default, Nova runs on port 8000. See [Deployment](Deployment) for instructions on changing this. Assuming you installed on the machine you would like to play from, navigate to [localhost:8000](http://localhost:8000).

## Running the Tests
The available tests are not comprehensive, and many are broken or inaccurate. They can be run with `mocha` but should not be trusted.

## Deployment
Deployment is the same as installation, however, the port used for the server can be changed by editing the `port` variable in `settings/server.json`

## Contributing

#### Note that NovaJS will soon be undergoing a much-needed major rewrite. It will be rewritten in TypeScript with a great deal of attention paid to separating game logic from the user interface. Details and progress can be see on on the [project page](https://github.com/mattsoulanille/NovaJS/projects/3) and on the [TypeScript branch](https://github.com/mattsoulanille/NovaJS/tree/typescript).

I welcome pull requests, however, I am often in school and unable to accept them immediately. Some easy places to contribute include:
* Parsing: [See the companion project NovaParse](https://github.com/mattsoulanille/NovaParse). This is probably the easiest and most helpful way to contribute and is a prerequisite for most of the following features.
* NPCs and AI: There are two approaches to this: Writing or training an AI to be as best as possible or trying to mimic Nova's AI's behavior, but for both of them, lots needs to be written in the way of API.

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





