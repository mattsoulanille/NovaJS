# Ship storage

An optional NovaJS enhancement (Matthew, 2026-11-23): the pilot can own more
than one customized ship. At any shipyard they can put the ship they are
flying into storage and take a stored one out, swap ships with a captured
escort, send a stored ship along as an escort, and put a captured escort into
storage. The original had nothing like it (the one plug-in that tried only
remembered the class of ship you sold).

## Where the stored ships live

`StoredShipsComponent` (`nova_plugin/player/stored_ships.ts`) on the pilot's
own entity: a list of records `{ship, name, shipName?, outfits, cargo, fuel,
storedAt}`.

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
| hull class, its class name (`name`, so the hangar can list a ship whose class no longer loads), and the ship's own name (`shipName`, see Names below) | shield, armor, ionization: a stored ship comes back fully repaired, like a hull from the shipyard (the player's hull is repaired at lift-off anyway, and escorts at the port) |
| every outfit aboard at its count, ammunition and mass-scaled outfits included, and **persistent outfits with Mass** (they are hardware: see the mass rule below) | the pilot's **weightless persistent** outfits (oütf 0x0004, Mass 0) and the ammo of their launchers: they follow the pilot |
| the hold | an escort's queued upgrade or sale (dropped when the escort is stored or swapped) |
| fuel | an escort's damage, AI memory, formation slot |

**The mass rule: weightless persistent outfits follow the pilot, heavy ones
stay on their hull** (Matthew, 2026-11-27: "Let's go with the mass rule for
outfits that stay across ship purchases"). 0x0004 means "stays with you when
you trade ships". Licences, the Vell-os powers, bank accounts, hired
officers and the like weigh nothing and are the pilot's; a cloaking device or
a gun that weighs 15 t is part of the ship. So on every swap
(`outfitsFollowingPilot` in `ship_storage.ts`):

- A **persistent outfit with Mass 0** comes off the hull being put away (into
  storage or the escort roster) and onto the hull taken out, ignoring that
  hull's hardpoint limits (a limit check would destroy plot items, as in the
  shipyard's judgment call 6).
- A **persistent outfit with any other Mass** stays installed on its hull: it
  is stored with it, goes out with it as an escort, and comes back when the
  pilot swaps back. "Any other" includes negative Mass, so a persistent mass
  expansion would keep its room on the hull it expands (no such outfit
  exists in the stock data or the plug-ins seen).
- **Everything else** stays with its hull, as before.
- **Ammunition goes with its launcher.** When every outfit aboard that mounts
  an ammo's weapon is on one side, the ammo is on that side too. So a
  weightless Vell-os bay's fighters follow it, and the stock Dart (oütf 226,
  NOT persistent) follows the persistent, weightless Create Dart (225) rather
  than being left in a hull with no launcher. That pair is the only ammo in
  the stock data and the plug-ins seen whose own flags and its launcher's
  disagree. Ammo with Mass never moves. Ammo with no launcher aboard, or with
  launchers on both sides, goes by its own flags.

**A swap never leaves a hull over-full.** Nothing that weighs anything
moves, so each hull keeps exactly the tonnage it had: the hull taken out has
the free mass it was stored with, and the hull put away keeps its own. The
stock case that prompted the rule: the Fed Cloaking Device (oütf 211, 15 t,
granted by mïsn 466 and never sold) used to follow the pilot from a
Starbridge into a Shuttle with 8 t free, leaving -7 t
(`spaceport/ship_storage_mass_rule_stock_test.ts`).

What the rule gives up: in the original every persistent outfit follows the
pilot to a new hull, and a few heavy ones cannot be bought again (the Fed
Cloaking Device; plug-in rewards such as arpia's Hogun Beam or Extra
Outfits' Self-Made Energon Cannon). Under the rule they stay on the hull
they were installed on, and the pilot flies that hull to use them.
Plug-in data the rule reads oddly is left as it is (Matthew): the Starbridge
Bay plug-in's weightless bay and fighters (a plug-in bug) follow the pilot,
and Extra Outfits' weightless Loaded Bremesol follows the pilot even though
its 10 t Bremesol Storage tank stays on the hull.

**A shipyard purchase is not a swap.** Trading the old hull in keeps the
original's rule: every persistent outfit moves, whatever it weighs, and the
new hull can be left with negative free mass. The original does exactly
that, with no warning, and its outfitter then reads "Available: 0 tons"
(`docs/reference_experiments.md`, "Persistent heavy outfits across a ship
purchase"). Buy and keep (below) puts the old hull away instead of trading it
in, so it follows the mass rule: a heavy persistent outfit stays on the
kept hull.

**Pilots saved under the old rule.** Nothing is migrated, and every saved
stored ship still loads. Under the old rule a heavy persistent outfit always
ended up on the hull being flown (a stored record never held the pilot's
persistent outfits), so after the update it is on that hull and stays there
at the next swap. If an old swap left that hull over-full, it stays over-full
until the pilot sells something from it (as after a purchase in the
original). Stored records that do hold persistent outfits (a captured escort
put away with its own) come out with them as before.

**Cargo: each hull has its own hold, and nothing is destroyed.** On a swap the
pilot's hold and the incoming hull's hold are pooled. The incoming hold takes
all mission cargo (it never leaves the pilot, even over capacity, as in a
trade-in) and as many commodities as fit. Commodities are dropped in
descending key order (not the trade-in's proportional cut, `cargoForNewShip`:
a swap destroys nothing, so the incoming hold is filled to the brim). Whatever
does not fit stays aboard the hull being put away. So swapping into a smaller ship
leaves the overflow in the bigger one instead of jettisoning it.

Usually that overflow is at most what the outgoing hull was already carrying,
but mission cargo can break that: a 10 t Shuttle carrying 20 t of mission
cargo, swapped for a Freighter full of 100 t of commodities, would leave 20 t
of commodities in a 10 t hold. Each hull keeps its own capacity, so the hangar
**refuses** such a swap ("Your old ship has no room for the cargo that would be
left aboard it", `swapHoldRefusal`); the pilot sells some first. (Review
finding 6. Buy and keep cannot hit it: the new hull brings no cargo.)

**Fuel** stays with its hull: a stored ship comes out with the fuel it went in
with (the pilot pays for their own refuel). Its fuel stat's maximum is the
real tank, the class's energy plus its outfits' (`fuelCapacity`), not the
fuel aboard. That matters for escorts, which are refuelled free at lift-off
(`escort_restock.ts`) to their stat's maximum before any provider has run on
them: a ship stored dry and sent out as an escort lifts off full (review
finding 2).

**Names** (`player/player_names.ts`). The ship being flown has the name the
player gave it at the shipyard's "Please name your new <ship>:" prompt.

- Putting it away keeps that name with it (`shipName`). Taking a stored ship
  out makes its name the ship's name again, and the outgoing hull goes into
  storage under its own.
- A ship that never had a name (a captured escort put away) comes out with
  none, so the `p` screen shows the derived "<class> <number>" until the
  player buys and names another ship.
- **Escorts carry no names**, as in the original. A hull that becomes an
  escort (a swap with an escort, or a stored ship sent along) loses its name.
  Keeping it would mean a name component on escort entities, which the
  escort save blobs and the wire would then have to carry.
- The hangar lists a ship by its own name: on the tile's first line when it
  fits (`HANGAR_CAPTION_NAME_CHARS`, 14 characters), otherwise the class's
  short name; the description pane always shows the name and the class.
- The description pane is a scrolling text field (`spaceport/scroll_text_pane.ts`):
  the ship sheet is clipped to the pane, and a long one (a plug-in loadout of
  forty-odd outfits ran over Done and the spaceport underneath, Matthew
  2026-11-27) scrolls by the wheel, a slim scroll bar at the pane's right edge
  (drag the thumb, click the track to page) and PageUp / PageDown / Home /
  End. Each ship's sheet starts at its top; while a message shows under the
  sheet, the sheet stops above it.

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
   outfits, the outfits that follow the pilot by the mass rule, pooled cargo,
   fuel) carrying the pilot's state, like `buildPurchasedShip`. No credits
   move.
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
   one. It goes through the same "Please name your new <ship>:" prompt as
   any purchase (`ship_name_prompt.ts`): OK buys it under the typed name, and
   Cancel buys and stores nothing. The new hull costs its full asking price,
   with no trade-in, and the hull being flown goes to the end of the stored
   list under its own name, with every outfit the mass rule leaves on it
   (a heavy persistent one included; the new hull gets its stock loadout plus
   what follows the pilot). The shipyard's hint line says how to do it
   whenever a buyable ship is selected. The bought class's `OnPurchase` runs
   as in any purchase; the kept class's `OnRetire` does not, because it was
   not sold. The keyboard's buy is always the ordinary trade-in. Matthew
   (2026-11-24): buy-and-keep stays for now.

**Which escorts.** Only captured escorts that have landed with the player (on
the landed roster). A hired escort was never the pilot's ship. Bay fighters
and mission ships are not escorts in this sense (`countsTowardEscortCap`). An
escort still flying down to the pad is not listed until it lands.

**What an escort built from a record is.** It is built like a hired escort
(`makeNpcShip`, its class's inherent AI, no government), with the record's
outfits, hold and fuel, and with `PlayerEscort {provenance: 'captured', deal:
none, ammoStock}`. Formation, firing group and ownership are stamped when the
lift-off puts the roster back down (`prepareCarriedEscorts`), and it is
restocked like any landed escort, except for its ammo: `ammoStock` is the
record's ammo counts, and an owned escort is rearmed back up to those, not
to its class's stock loadout (a hired escort's target) nor to capacity
(Matthew 2026-11-24 and 2026-11-27; `player_escort.ts`'s OWNED ESCORT AMMO).
Storing it again or swapping into it drops the snapshot with the marker; the
next time it goes out as an escort it takes a new one.

**Refusals.**
- The player's own bay fighters are out: nothing can take the player's hull
  away (no swap), the same rule as a trade-in (`shipyard_rules` judgment
  call 8).
- A carrier escort's own wing is out: that escort cannot be swapped or
  stored.
- The escort cap is full: a stored ship cannot become an escort.
- The ship's class or **any outfit aboard it** is not loaded (a plug-in was
  removed): it cannot be taken out or sent along. Taking it out would leave a
  hull whose physics and weapons are never derived, and a save that
  quarantines (review finding 1). It stays listed, by its stored names.
- The outgoing hull's hold could not take what the swap leaves aboard it
  (see Cargo above).

**The dialog.** `y` in the shipyard presses Your Ships (only while the
shipyard itself holds the keyboard, and not while ship storage is off). In
the hangar, `e` presses the Escort pill (which reads Store on an escort, so
the key stores it), `s` presses Swap, and a greyed pill ignores its key
(Matthew 2026-11-27). Return presses Done, as in the shipyard under it. While the
hangar (or the shipyard's ship info or name prompt) is open, the shop
search's Cmd/Ctrl+F stands down, so it cannot take the dialog's keys. Before
the first grid is drawn the hangar loads every class and outfit it may need,
the flown hull's own outfits included: a swap decides by their oütf flags,
Mass and launchers which of them follow the pilot, and an uncached one would
be put away with the hull (review finding 3). A teardown while it is open or still
loading releases its keys for good and redraws nothing (review finding 4).
Closing it repopulates the shipyard's grid, since a swap can change what the
shipyard stocks (the hull's Contribute bits).

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

**Bay fighters and escorts.** A swap and a buy-and-keep are refused while
the player's own fighters are out, using the same deployed-fighter count as
the outfitter's bay caps (`deployedUnitCount` over the shipyard's
`deployedOutfitCounts`), so no fighter is ever left without its carrier and a
bay can never be refilled past its ceiling through storage. Escorts built
from storage are ordinary captured escorts on the landed roster, so the
escort, traffic and fleet code treats them as such: the wave-19 "a fleet
leaves whole" rule never applies to them (their leader is a player's ship,
and their own fighters' leader carries an escort command).

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
