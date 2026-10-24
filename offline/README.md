# Experimental single-file offline build

This optional build packages NovaJS and locally supplied EV Nova data into one HTML file. The existing server and multiplayer entry point is retained.

Requirements: Node.js 24 or newer, npm, Python 3, and your own EV Nova data. From the repository root:

```sh
npm --prefix offline ci --ignore-scripts --legacy-peer-deps
npm --prefix offline test
NOVA_DATA_PATH=/absolute/path/to/Nova_Data npm --prefix offline run build
```

The data directory must contain `Nova Files` and `Plug-ins` directories. Open `build/offline/NovaJS-Offline.html` in a modern browser. The HTML embeds your data, can be large, and should not be committed or publicly redistributed. Build diagnostics are written to `build/offline/warnings.txt`.

Arrow keys fly, Space fires, M opens the map, J jumps, L lands, and Escape departs/closes panels. Touch buttons cover the main controls; landscape orientation is recommended.

This uses NovaJS's existing experimental engine. It does not add a complete original campaign, persistent pilot saves, or offline multiplayer. The Windows REZ landscape offset is based on the tested data; the original Mac fixture retains its existing offset. Full Mac gameplay and live multiplayer regression testing have not been performed. The complete Bazel suite has not been run for this contribution.

The parser checks exercise the existing Mac fixture, a synthetic Windows stellar record, and REZ container metadata. Browser smoke testing covers flight, fire, map opening, jumping, landing, and departure.

Credit to Matthew Soulanille and all NovaJS contributors for the engine, parsers, and renderer. This offline adaptation was developed with ChatGPT assistance at the fork owner's request. The original MIT license is retained and embedded in the HTML's About dialog. No locally supplied game data is included in this contribution.
