# NovaParse
An EV Nova data file and plug-in parser built for [NovaJS](https://github.com/mattsoulanille/NovaJS), this project aims to parse entire nova data / plug-in files and does little post-processing of the retrieved data. It also tries to resolve the notorious id conflict issues Nova had by putting each plug-in in its own id space, letting it change Nova files but not other plug-ins. 

## Prerequisites
git, npm

## Installing
For deployment, [get it from npm](https://www.npmjs.com/package/novaparse) with
```
npm install novaparse
```

For development, download the repository and run 
```
npm install
```

## Usage

#### Reading Nova data and Nova plug-ins

```
var novaParse = require("novaParse");

// should contain "Plug-ins" and "Nova Files" subdirectories
var nova = new novaParse("/nova/source/folder");

nova.read();
```
This loads all nova files contained in ```/nova/source/folder/Nova\ Files/``` and then loads all nova plugins in
```/nova/source/folder/Plug-ins/```. 

NovaParse keeps plugins separated so that they can't overwrite each others' ids. If you have a plugin pack or want certain plugins to share an id space, put them in a subdirectory within plug-ins. For example,
if you want plugins from ARPIA to share the same id space ```ARPIA```, put them all in ```/nova/source/folder/Plug-ins/ARPIA/```.

#### Getting stuff out
Continued from above, ```nova.ids.resources``` contains all parsed nova resources organized by type (like oütf, spïn, etc). These types have ids for each resource paresd of the type. For example, Nova's light blaster weapon can be seen at ```nova.ids.resources.wëap['nova:128']```. Note that it is located at ```'nova:128'``` rather than just ```128```. This is due to the sectioning off of ids mentioned before.

Suppose a plug-in called ```foo``` added a weapon at id 300 and modified the weapon at id 129. Since nova data contains an entry for 129, this plug-in would overwrite ```nova.ids.resources.wëap['nova:129']``` and the id would remain ```nova:129``` in ```nova.ids.resources.wëap```. Since nova data does not have an entry for 300, it would add a new weapon at ```nova.ids.resources.wëap['foo:300']```.

#### ID Spaces
ID spaces provide an easy way for plug-ins to reference their ids. ID spaces are found at 
```
nova.ids.spaces
```

In the above example with the plug-in named ```foo```, the ID space ```fooSpace = nova.ids.spaces['foo']``` can be used to access the resources in ```foo``` as if ```foo``` were the only plug-in installed. 
* ```fooSpace.wëap[128]``` would be equivalant to ```nova.ids.resources.wëap['nova:128']```
* ```fooSpace.wëap[300]``` would be equivalant to ```nova.ids.resources.wëap['foo:300']```

This means ```foo``` always gets its own ids even if there is another plug-in that adds a weapon of id 300.

Plug-ins contained in the same subdirectory stored in ```Plug-ins``` share the same ID space, so they can reference each others' ids.


## Running Tests
In the root directory of the repository, run ```mocha```. There should be plenty of failed tests as plenty of the parsing is not yet written.

## Contributing
Feel free to look at the parsers in ```parsers/``` and write your own or add to the existing ones. If you run out of tests, you can write your own, but don't be suprised if I change how data is stored after accepting your pull request.
