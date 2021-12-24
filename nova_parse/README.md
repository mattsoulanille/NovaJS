# NovaParse
An EV Nova data file and plug-in parser built for [NovaJS](https://github.com/mattsoulanille/NovaJS), this project parses a directory containing `Nova Data` and `Plug-ins` subdirectories according to the [NovaDataInterface](https://github.com/mattsoulanille/NovaDataInterface). 

In contrast to how EV Nova parsed files, NovaParse separates Plug-ins into their own namespaces to prevent ID conflicts. Each plug-in placed directly in the `Plug-ins` directory has access to its own IDs and to the global `Nova Files` IDs, but does not have access to IDs defined in other plug-ins. Creating a subdirectory inside the `Plug-ins` directory creates a shared namespace, and any plug-ins placed into that directory will have access to each other's IDs (in addition to the `Nova Files` ids), allowing plug-in packs like Extra Outfits and ARPIA2 to work correctly.


## Prerequisites
git, npm

## Installing
For deployment, [get it from npm](https://www.npmjs.com/package/nova_parse) with
```
npm install --save nova_parse
```

## Usage
#### Reading Nova data and Nova plug-ins

```
// TypeScript
import { NovaParse } from "nova_parse";

// Determines whether NovaParse should throw errors when a parse fails
// or should provide a default value for each failed resource parse.
var strict = false;

// should contain "Plug-ins" and "Nova Files" subdirectories
var parser = new NovaParse("/nova/source/folder", strict);

```
This loads all Nova Files contained in ```/nova/source/folder/Nova\ Files/``` and then loads all Nova Plug-ins in
```/nova/source/folder/Plug-ins/```, possibly overwriting IDs in `Nova Files`. Plug-ins are loaded in reverse alphabetical order, so a plug-in of earlier alphabetical order may overwrite a resource in `Nova Files` that was previously overwritten by a plug-in of later alphabetical order.

#### Getting data out of the parser
NovaParse implements `GameDataInterface` of [NovaDataInterface](https://github.com/mattsoulanille/NovaDataInterface), which defines how data can be accessed from it. In short, 
* `(await NovaDataInterface.ids)["ResourceType"]` gets the list of available IDs for resources of "ResourceType"
* `await NovaDataInterface.data["ResourceType"].get("GlobalID")` gets the `"ResourceType"` resource of id `"GlobalID"`.

The global IDs of `Nova Files` all start with `nova:` and end with their corresponding ID. Global IDs of things in the `Plug-ins` directory start with the name of the Plug-in or directory and end with a colon and their ID.


## Development
To set up development, download the repository and run 
```
npm install
```
to install dependencies.

To build the project for deployment, use
```
npm run build
```
This command must be run prior to publishing to npm.

### Running Tests
Tests can be run with
```npm run test```

To run an individual test, run ```npm run test-only ./test/path/to/test.ts```

### Contributing
Feel free to write types, parsers, and tests for Nova resources that are not yet parsed by NovaParse. Try to represent anything that happens every `n` frames or happens `n` times per millisecond in terms of `times / second` assuming 60fps. If there is demand for it, I will write a proper design doc with details on the internal structure of NovaParse. 
