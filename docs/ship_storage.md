# Ship storage

An optional NovaJS enhancement (Matthew, 2026-11-23): the pilot can own more
than one customized ship. At any shipyard they can put the ship they are
flying into storage and take a stored one out, swap ships with a captured
escort, send a stored ship along as an escort, and put a captured escort into
storage. The original had nothing like it (the one plug-in that tried only
remembered the class of ship you sold).

## Where the stored ships live

`StoredShipsComponent` (`nova_plugin/player/stored_ships.ts`) on the pilot's
own entity: a list of records `{ship, name, outfits, cargo, fuel, storedAt}`.

- It is **player state**, like the credits. It is in
  `PLAYER_STATE_COMPONENTS`, so every change of hull carries it (shipyard
  purchase, a mission's `Cxxx`/`Exxx`/`Hxxx`, the hangar's own swaps, the
  in-flight change of ship). It rides the lift-off's `addEntity` record, so
  every peer holds the same pilot. It is in rollback snapshots and the desync
  hash. Nothing in the simulation reads it.
- It is **absent when empty**, so a pilot who never stores a ship has the same
  components, hash input and insertion record as before.
- It is a **record, not a serialized entity**. A stored ship is in no world.
  The record's codec is ours to version, and a change to an unrelated
  component's codec cannot break it (escort blobs in the save can break that
  way).
- **The pilot save** has a required `storedShips` field (save v7; the v6 -> v7
  migration writes `[]`). History checkpoints are save envelopes, so they
  carry it too.
- The list has **no ids**. The hangar addresses entries by index, and
  swapping puts the outgoing hull in the incoming one's slot, so the order the
  player sees stays put.
- `storedAt` is the stellar the ship was put away at. Global storage does not
  read it yet; it is there so a location-specific mode needs no migration.

## What a snapshot keeps

| Kept | Not kept |
|---|---|
| hull class, its name (the class name: hulls have no names of their own) | shield, armor, ionization: a stored ship comes back fully repaired, like a hull from the shipyard (the player's hull is repaired at lift-off anyway, and escorts at the port) |
| every outfit aboard at its count, ammunition and mass-scaled outfits included | the pilot's **persistent** outfits (oütf 0x0004): they follow the pilot |
| the hold | an escort's queued upgrade or sale (dropped when the escort is stored or swapped) |
| fuel | an escort's damage, AI memory, formation slot |

**Persistent outfits follow the pilot.** 0x0004 means "stays with you when you
trade ships", and licences, the Vell-os powers and the like are the pilot's.
Putting a hull away (into storage or the escort roster) takes them off it and
puts them on the hull taken out, ignoring that hull's hardpoint and mass
limits. That is the shipyard's judgment call 6 (`shipyard_rules.ts`); a limit
check would destroy plot items.

**Cargo: each hull has its own hold, and nothing is destroyed.** On a swap the
pilot's hold and the incoming hull's hold are pooled. The incoming hold takes
all mission cargo (it never leaves the pilot, even over capacity, as in a
trade-in) and as many commodities as fit. Commodities are dropped in
descending key order, the same order `cargoForNewShip` uses. Whatever does not
fit stays aboard the hull being put away. That always fits, because it is at
most what that hull was already carrying. So swapping into a smaller ship
leaves the overflow in the bigger one instead of jettisoning it.

**Fuel** stays with its hull: a stored ship comes out with the fuel it went in
with (the pilot pays for their own refuel). Escorts are refuelled free at
lift-off anyway (`escort_restock.ts`).

**No `OnPurchase` / `OnRetire`.** The Bible ties those to buying, selling and
capturing. Storing or swapping a hull is none of these: the pilot still owns
both ships. (Seam: a bit that means "is flying an X" stays set while the X is
stored. Running OnRetire on store and OnPurchase on take-out would be a small
change in `ship_storage.ts` if that turns out to be wanted.)

## The operations

All of them are in `spaceport/ship_storage.ts`, as pure functions over the docked
hull and the client's landed-escort roster. The hangar dialog (opened by the
shipyard's **Your Ships** button) calls the first four; the shipyard's Buy
Ship calls the fifth.

1. **Swap with a stored ship.** The current hull is snapshotted into the
   stored ship's slot, and a new hull is built from the stored one (class,
   outfits, the pilot's persistent outfits, pooled cargo, fuel) carrying the
   pilot's state, exactly like `buildPurchasedShip`. No credits move.
2. **Swap with a captured escort.** The same, with the escort's ship as the
   incoming hull. The old player hull becomes a new escort entity in the
   escort's roster slot (same roster uuid), so the escort cap does not change.
3. **Stored ship to escort.** The record leaves storage and joins the landed
   roster as a new escort. The escort cap applies (`cappedEscortCount` over
   the display world, the roster and this landing's hires, `MAX_ESCORTS` 6).
4. **Escort to storage.** The escort leaves the roster and is snapshotted onto
   the end of the list.

5. **Buy and keep** (Option-click *Buy Ship*, only while ship storage is
   on). Without this the pilot could only get a second ship by capturing
   one. The new hull costs its full asking price, with no trade-in, and the
   hull being flown goes to the end of the stored list. The shipyard's status
   line says how to do it whenever a buyable ship is selected. The bought
   class's `OnPurchase` runs as in any purchase; the kept class's `OnRetire`
   does not, because it was not sold. The keyboard's buy is always the
   ordinary trade-in.

**Which escorts.** Only captured escorts that have landed with the player (on
the landed roster). A hired escort was never the pilot's ship. Bay fighters
and mission ships are not escorts in this sense (`countsTowardEscortCap`). An
escort still flying down to the pad is not listed until it lands.

**What an escort built from a record is.** It is built like a hired escort
(`makeNpcShip`, its class's inherent AI, no government), with the record's
outfits, hold and fuel, and with `PlayerEscort {provenance: 'captured', deal:
none}`. Formation, firing group and ownership are stamped when the lift-off
puts the roster back down (`prepareCarriedEscorts`), and it is restocked like
any landed escort.

**Refusals.**
- The player's own bay fighters are out: nothing can take the player's hull
  away (no swap), the same rule as a trade-in (`shipyard_rules` judgment
  call 8).
- A carrier escort's own wing is out: that escort cannot be swapped or
  stored.
- The escort cap is full: a stored ship cannot become an escort.

## Gates and scope

- **Shipyard only, landed only.** The hangar opens from the shipyard, so only
  a stellar with a shipyard has it. Swapping in flight is not offered. It
  would need a new simulation input kind, and the escort's entity is live in
  the world rather than held by the client, so it is not the landed
  transaction any more.
- **Global for now.** Any shipyard reaches every stored ship, wherever it was
  stored.
- **Free.** No price and no fee.

## Multiplayer and determinism

Every operation is a landed transaction and goes the same way as the shipyard
purchase:

- A new hull goes to `LandedTransaction.adoptPurchasedShip`, which re-seeds
  the working copy, and `Spaceport.adoptPurchasedShip` publishes it to the
  docked handle and the save writer, records a checkpoint and rebuilds the
  stats. `commit()` hands it to the lift-off's insertion record.
- Escort changes edit the client's landed roster, the same array the
  lift-off settlement of escort deals edits. Its entries are put back into
  the world by the lift-off's insertion records (`insertPlayerAndFleet`).
- Nothing is applied in a world while docked. Peers see the new hull, the
  stored list and the escorts when the lift-off's records apply, on every
  peer at the same tick. Specs:
  `spaceport/ship_storage_liftoff_test.ts` (a lift-off round trip through the
  real insertion sequence) and
  `communication/ship_storage_rollback_test.ts` (a rollback replay and a late
  joiner).

## Settings

The **Ship storage** NovaJS Enhancement (`enhShipStorage` in
`packages/nova/src/enhancements.ts`, default on; listed in
`docs/novajs_enhancements.md`) only shows or hides the shipyard's Your Ships
button and the Option-click buy-and-keep. Turning it off changes nothing
else: the stored ships stay stored and every simulation path stays the same.

## Follow-ups (out of scope)

- Location-specific retrieval: only ships stored at this stellar (`storedAt`)
  can be taken out here, and a stored ship has to be ferried (as an escort) to
  where it is wanted.
- Storage fees.
- The economy exploit Matthew accepted: capture, swap into the prize, trade it
  in at the shipyard's 25% instead of selling it as an escort.
