NovaJS
======

This is an experiment in making Escape Velocity Nova run in the browser. Escape Velocity Nova (EV Nova) is a game created by [Ambrosia Software](http://www.ambrosiasw.com/) in collaboration with [ATMOS](https://en.wikipedia.org/wiki/ATMOS_Software).
### Project Goals
* Funcion as a Nova Engine that can, given Nova files, run EV Nova.
* Improve on some of the issues with EV Nova's engine (such as limited turning angles) as long as doing so does not greatly affect gameplay.
* Support multiplayer to an extent.

## Wait, but isn't EV Nova Copyrighted?

Yes. Escape Velocity Nova is copyrighted by Ambrosia Software. I claim no rights to anything in the [objects](https://github.com/mattsoulanille/NovaJS/tree/master/Nova/objects) directory, nor do I claim any rights over pictures or Nova Data in this repository. The end goal of this project is to write a Nova engine that can interpret Nova files without including any Nova data itself, thereby avoiding these legal issues.

## Getting Started

### Prerequisites

[node.js](https://nodejs.org/),
[npm](https://www.npmjs.com/)

### Installing

Clone the repository
```
git clone git@github.com:mattsoulanille/NovaJS.git
```
Move to the `NovaJS/Nova` directory
```
cd NovaJS/Nova
```

Install packages with `npm`
```
npm install
```
At this point, you can run NovaJS with
```
node index.js
```
By default, Nova runs on port 8000. See [Deployment](Deployment) for instructions on changing this. Assuming you installed on the machine you would like to play from, navigate to
```
http://localhost:8000
```

## Running the Tests
Haha. Wouldn't it be nice if I had written tests. TODO.

## Deployment
Deployment is the same as installation, however, the port used for the server can be changed by editing the `port` variable in [index.js](https://github.com/mattsoulanille/NovaJS/blob/master/Nova/index.js).

## Contributing

I welcome pull requests, however, I am often in school and unable to accept them immediately.








