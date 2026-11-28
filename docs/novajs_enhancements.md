# NovaJS enhancements: deliberate departures from the original

Every place NovaJS knowingly behaves differently from EV Nova, and whether
a player can turn it off.

- **Client**: the departure changes only what this player sees or which
  inputs their UI lets them make. It can be a per-player toggle: Preferences
  > "NovaJS Enhancements..." (`packages/nova/src/enhancements.ts`). Toggles
  persist with the pilot, default ON (the NovaJS behaviour), and OFF
  restores the original.
- **Sim**: the departure changes a simulation rule, which every peer in a
  room must share. A per-player toggle would desync the room, so these have
  no toggle. Making one switchable needs a **room rule**: a setting the
  server picks and every peer runs (see "Room rules" below).

"Reference" means `docs/reference_experiments.md`.

| Departure | Ruling / source | Client or sim | Toggle |
|---|---|---|---|
| One shift-click on the map plots a whole route, through drawn (incl. unexplored) systems. The original only pins a neighbour of the route's end. | Matthew 2026-11-23, "Map auto routing" (list of UI departures); reference "Route planning through unexplored systems, wave 10" and "Multi-jump routes and the `j` key, wave 11" | client (the route is the player's own input) | `enhMapAutoRoute` "Map auto-routing" |
| The target display shows the live ship, turning with it. The original shows a fixed picture of the class (PICT 3000 + id - 128). | Matthew 2026-11-23, "Live target render vs the ship's target image"; `space/in_space.png`, `p_properties/general.png` | client | `enhLiveTargetView` "Live target view" |
| Player Info prints shield/armor totals, "100% (150)". The original prints "100%". | Matthew: "let's put the total shields / armor next to Shield Status and Armor Status like we do for energy" (`spaceport/player_info.ts` healthStatus) | client | `enhShieldArmorTotals` "Shield and armor totals" |
| A landed map (the spaceport's `m`, a venue's, the Mission BBS's) shows the galaxy as it stands NOW: a mission accepted in this visit at once reveals or hides the systems its bits gate and marks its destination. The original keeps the map's system visibility stale until the next landing or jump (its Legal Status updates at once). | Matthew 2026-11-27 on #324: "Show the live state" (no setting); reference "#324 mission BBS after an accept, wave 21", finding 4 (`spaceport/mission_board.ts` openMap, `display/starmap_plugin.ts` playerComponent) | client (display only: the bits themselves change at the accept for everyone) | none: ruled live with no setting |
| The scroll wheel / two-finger scroll moves the outfitter, shipyard and hire grids by rows. The original's wheel does nothing there. | Matthew 2026-11-23, "Scroll wheel to navigate outfitter / shipyard" | client | `enhShopScrollWheel` "Scroll wheel in shops" |
| The scroll wheel / two-finger scroll moves a long mission offer or briefing text (three lines a wheel notch). The original's wheel does nothing over text; there it scrolls only by the arrows (a 60 px/s glide while held, 5 px a click) and the keys (Up / Down 10 px, PageUp / PageDown 250 px, Home / End). The same toggle lets a shop description too long for its pane (shipyard, outfitter, hire escort) scroll there, with a slim scroll bar at the pane's right edge (drag the thumb, click the track to page); off, it is cut off at the pane's bottom as the original's text box cuts it. Either way it no longer runs onto the button rail (the Polaron Multi-Torpedo Tube and the Fed Destroyer variants wrap to a 23rd line, the TripHammer to a 29th). | Added with the wave-12 scrolling fixes (the brief allowed a wheel for text under a toggle; kept: Matthew 2026-11-24); shop descriptions added with the hangar scroll fix (Matthew 2026-11-27, "Maybe this should be a scrollable text field"; `spaceport/scroll_text_pane.ts`); reference "Scrolling: long mission text and the shop scroll arrows, wave 12" | client | `enhTextScrollWheel` "Scroll wheel in text" |
| A search field filters the outfitter and shipyard by name. The original has none. | Matthew 2026-11-23, "Search bar (or maybe filter) for outfitter + shipyard" | client | `enhShopSearch` "Shop search" |
| The `h` minimap takes no clicks once it has faded. The original's hidden area still picks systems for about 8 s from the show. | Matthew 2026-11-23: "`h` map preview is clickable even when hidden. bug."; reference "M1 wave 10" | client | `enhMiniMapHiddenNoClicks` "Hidden h-map ignores clicks" |
| The hypergate map draws the ordinary hyperspace lanes in the star map's grey (#4a4a4a), under the cyan gate arrows. The original draws them nearly black (#080808). | Matthew 2026-11-26 playtest: "it looks like we're not showing regular jump routes, which I suspect the original game also doesn't do, but I think we should do it since it makes it easier to see"; reference "Gate map, wave 27" (`spaceport/gate_map.ts` gateMapLaneColor) | client | `enhGateMapLanes` "Jump lanes on the hypergate map" |
| Ship storage: the shipyard's Your Ships hangar (swap with a stored ship or a captured escort, send a stored ship along as an escort, store an escort) and Option-click Buy Ship to keep the old ship (through the ship name prompt). The original has no ship storage: you fly one ship and trade it in. | Matthew 2026-11-23, "store your customized ships and then load them again" (`docs/ship_storage.md`); buy-and-keep stays for now (Matthew 2026-11-24) | client, toggled: the toggle only hides the UI; the landed transactions themselves (the pilot's `StoredShips` list, the hull and escorts at lift-off) are the same for every peer | `enhShipStorage` "Ship storage" |
| The player's own ship's projectile turrets (wëap Guidance 4) aim at the exact intercept. The original's turrets lead to first order (the target's place plus its relative velocity times distance / shot speed) and miss fast crossing targets; NPC turrets, escorts' and bay fighters' included, always do. | Matthew 2026-11-27: "the original game's turrets are rather inaccurate. We can have a toggle for the player ship to use one or the other."; reference "A turret's lead, and a lead into a blind sector (the T leftover), wave 50" (`nova_plugin/player/turret_aim.ts`) | sim, per player: it changes only that player's own ship, carried as synced state on the ship (stamped at every insertion, a `setTurretAim` input record when it changes), so every peer runs the same simulation | `enhAccurateTurretAim` "Accurate turret aim" |
| `d` closes the hail window (the comm box for a ship, a stellar or an escort, from any of its pages, the price popup included), as Esc does; `t` still demands tribute. The original's `d` is a second Demand Tribute key and does nothing on a ship. | Matthew 2026-11-27: "make `d` close the open hail window since `esc` always exits fullscreen"; reference "Hail dialog keys and Flags2 0x0001 (K5), wave 39" (`spaceport/hail_dialog.ts`) | client | `enhHailDCloses` "d closes the hail window" |
| `y` presses the accept / affirmative button and `n` the refuse / negative one of the choice dialog on top, whatever their captions: every mission offer (on landing, in the bar, over the outfitter and shipyard, and a ship's in flight; renamed buttons such as "Go after them" / "Let it go" too; a can't-refuse offer's lone Okay takes `y`, and `n` does nothing, as on any one-button notice the same popup shows: a briefing, the BBS's "no missions", the bar's "no ships for hire"), the jettison confirm (OK / Cancel) and a hail price popup (`y` Accept Price or Pay; `n` Never Mind where there is one: Lower Price is a counter-offer, so `n` presses nothing beside it). Never under a text field, never a held key's repeat, and only on a dialog: in flight `y` still hails, the shipyard's `y` still opens Your Ships, the hail dialog's comm page keeps the original's do-nothing `y`. Whether the original's offer dialog takes `y` / `n` is not yet measured (reference "y / n in a mission offer (K11)"). | Matthew 2026-11-28: "`y` and `n` should apply to choice dialog boxes (including when choices are renamed)" (`spaceport/menu_controls.ts` answerButtons) | client | `enhYesNoKeys` "y and n answer dialogs" |
| The galaxy map (and the hypergate map) zooms continuously: x 1.3225 a - / + button or `-` / `=` press, a wheel notch x 1.15 and a pinch smoothly, both about the pointer; an arrow press pans 40 screen px; the pan is clamped near the galaxy. The original has seven fixed levels (42.1, 56.2, 75, 100, 133.3, 177.7, 237 %; the - / + button greys out at the ends), keeps the view's centre when it zooms, pans 10 map units an arrow press at every zoom, and never limits the pan. Both open at 177.7 %. With the toggle off, a wheel notch steps one level and a pinch a level for each x 4/3 it gathers, about the view's centre. | Matthew 2026-11-27: "Keep smooth zoom. We could add the original behavior as an option if you toggle off the enhancement we made."; reference "Star-map nebulae (nëbu), wave 53", items 1 and 4 (`spaceport/system_graph.ts` smoothMapControls, `spaceport/starmap_viewport.ts` ORIGINAL_MAP_SCALES) | client | `enhSmoothMapZoom` "Smooth map zoom" |
| Trackpad two-finger scroll and a mouse drag pan the galaxy map. The original's plain left-drag does not pan (it selects the system under the press, wave 53); its trackpad behaviour was never measured. | aaf38494 (2026-11-23), a NovaJS input addition (`spaceport/starmap_gestures.ts`, `spaceport/starmap_input.ts`) | client | none: kept with "Smooth map zoom" off too (the ruling covered zoom and the arrows) |
| Murk hides objects within 120 px at murk 100 (12535fb8, "stronger murk"). | Playtest tuning, 2026-07-08 ("Playtesting judged the original 300 too weak by 2-3x"; that 300 was NovaJS's own first guess) | client (display only) | none: the original's falloff is unmeasured, so there is no original value to restore |
| The 2x-speed badge sits flush in the top-left corner, with a "x2 waiting for N of M" line while peers vote. | Matthew 2026-11-23: "shove the 2x indicator flush to the top left"; R3 #371 | client | none: the badge is the original's (cicn 20000); the voting line is multiplayer-only |
| UI scale and global scale (Preferences > Display). | NovaJS-only; machine-local by design (`title/client_prefs.ts`) | client | already its own setting |
| Option+Return (Alt+Enter) toggles browser fullscreen on every screen, and Preferences > Display has a "Fullscreen" button. In Chromium, Escape reaches the game while it is fullscreen (Keyboard Lock, `navigator.keyboard.lock(['Escape'])`, Matthew 2026-11-27), so it does what it does windowed and in the original (quits to the title from flight, leaves the spaceport, closes a venue, the map or the hail window); holding Escape still leaves fullscreen, and a held Escape's repeats never quit to the title. Safari and Firefox have no Keyboard Lock: there Escape still only leaves fullscreen. The original picks full screen or a window with its "Run in a window" pref and uses plain Return for the default button (Leave in the spaceport, closing the outfitter and the BBS). | Matthew 2026-11-24 (fullscreen moves off plain Return; `client/fullscreen.ts`); reference "The UI screen x key matrix, wave 11" | client | none: a browser page cannot take the screen without a key or a click, so there is no original to restore. Plain Return presses the landed screens' default button as the original's does (Leave in the spaceport, Done / Leave in the venues: b70d4d51) and does nothing in flight |
| Every capture the odds table allows is at least 1%. The original reads 0% against overwhelming crews. | Matthew 2026-11-23: "There should always be at least a 1% chance to capture a ship" (`ship/boarding_component.ts` CAPTURE_CHANCE_MIN) | sim | room rule |
| A direct hit by a shot with ProxRadius > 0 fires its submunitions. On the original a small fuse loses the race to the body and no subs appear. | Matthew 2026-11-23: "Prox radius > 0 can serve as the flag that forces subs to fire" (`combat/submunition_rule.ts`); reference "Submunitions wave 10" | sim | room rule |
| Beams fire submunitions at the end of their ray when they end. The original has no beam subs (reference "Submunitions wave 11": none on a hit, none when the beam ends). | Matthew's rule, restored in 1a62e1c9 ("Beam subs ... are a NovaJS extension") | sim | room rule |
| A board that succeeds sets the boarder's velocity to the boarded ship's (heading kept), so the two hulls don't drift apart behind the plunder dialog, which does not pause the sim. Refused boards change nothing. The original's velocity after a board is unmeasured (the gate already holds the relative speed under 7.5 px/s, so any difference is small). | Matthew 2026-11-24: "Upon boarding a ship, we should set the player's velocity equal to that ship's" (`ship/boarding_component.ts` matchBoardedVelocity); reference Pending "U9 velocity" | sim | room rule |
| Bay fighters still in flight count against the bay's capacity when buying, and block selling the bay ("You can't sell this while its fighters are deployed."). | Matthew 2026-08-09 (`spaceport/deployed_outfits.ts`), 2026-08-17 launcher sell rule (`spaceport/outfitter_rules.ts`); listed as "the deployed-fighters trade block" in the reference | sim (it decides what the ship carries at lift-off) | room rule |
| An OWNED escort (provenance "captured": a prize kept with "Use As Escort", the hull the pilot left for a prize with "Use As My Ship", a stored ship sent along from the hangar, or the pilot's old hull left behind in a hangar swap) that lands with the player is rearmed back up to the ammo it had aboard when it became an escort, never past it (and, like every restock, only as far as the hull's free mass allows), at the same lift-offs where a hired escort is rearmed to its ship class's stock loadout (Matthew 2026-11-27). Fuel and hull repair are the same for both. Ammo outfits the snapshot does not name are left alone, and an upgrade swaps in the new class's stock loadout as the new target. Escorts made from the player's own ships, and ship storage itself, are NovaJS additions, so this is a rule for a NovaJS feature. Escorts saved before the rule take their counts at load as the target. | Matthew 2026-11-24: "refill their ammo stores to whatever the player left the ship with when they swapped it to an escort", "at the same events as we refill normal hired escorts" (`spaceport/escort_restock.ts`, `player/player_escort.ts` OWNED ESCORT AMMO) | sim (it decides what the escort carries at lift-off) | room rule |
| The per-day BuyRandom / HireRandom roll is off: anything with a nonzero chance is offered every day. | Matthew 2026-08-14: "disabled for now" (`spaceport/day_roll.ts` BUY_RANDOM_DAY_ROLL_ENABLED) | sim (a shop's stock is shared by everyone docked there) | room rule |
| Higher engine limits: a system holds up to 256 submunitions and 512 projectiles in all (a ship's own shots get the top 256), 128 beam submunitions and 256 beams, and 110 ships besides the pilots' (128 in all for a planet's defenders); every descendant of one directly fired shot shares a budget of 256 spawns, and a refused beam keeps its weapon ready. The original holds 128 projectiles and 64 beams, whatever fired them, a refused beam costing its weapon's reload, and 55 ships besides the player (64 in all for defenders) (Max Shots / Beams On Screen, Max Ships In System; measured, waves 58 and 60). | Matthew 2026-11-27: "I'd like to raise this limit if possible ... (firing a weapon and having the projectiles never appear...)", with a guard against cheat weapons that "sub into 5 copies of self" (`core/engine_limits.ts`, `ship/ship_cap.ts`); reference "The shot cap, wave 58" and the beam and ship cap sections after it | sim | room rule `limits`: `novajs` (default) or `original` (see "Room rules") |

No longer departures (they were listed as deliberate non-fidelity, but now
match the original): **one plunder per hulk** (the original does the same,
reference wave 8), **the boarding alignment rule** (29° and no message
since ruling #378, ef61904a) and **player self-repair** (the inherent 20-45 s
repair droid is gone, Matthew's ruling "Remove player auto-repair", #383 on 2026-11-27: a disabled player without a
ModType 49 repair outfit stays disabled, as the original's does, reference
"A disabled player (A10), wave 37").

## Room rules

A room rule is a simulation departure that every peer of a room runs
(`packages/nova/src/nova_plugin/core/room_rules.ts`). The server picks the
rules: `settings/server.json` `"roomRules"` (a missing or malformed value
means the default), overridden by an environment variable where one exists.
When the relay opens a room it logs them as a server-authored `roomRules`
input in the room's first record, beside the room seed, so the archive,
every peer and a late joiner (through the log or a baseline) apply the same
rules at the same tick; a peer that sends one is dropped. A world no record
reached (local play, specs, benchmarks) runs the defaults. The rules are
per server today: every room of a server runs the same ones.

| Rule | Values | Override |
|---|---|---|
| `limits`: the engine's population limits (`core/engine_limits.ts` ENGINE_LIMITS, `ship/ship_cap.ts`) | `novajs` (default), `original` | `NOVA_ROOM_LIMITS` |

### `limits`

|  | original | novajs |
|---|---|---|
| projectiles alive: a submunition is refused at | 128 | 256 (soft) |
| projectiles alive: a directly fired shot (a ship's gun, turret, point defense, launched missile) is refused at | 128 | 512 (hard) |
| beams alive: a beam submunition / a ship's beam is refused at | 64 / 64 | 128 / 256 |
| spawns shared by every descendant of one directly fired shot | no limit | 256 |
| a beam refused by a full table costs its weapon's reload | yes (measured) | no |
| ships besides the pilots' own: an NPC arrival (traffic, a fleet, reinforcements, a person) or a bay launch is refused at | 55 | 110 |
| ships in all: a planet's defender (and anything else the sim adds) is refused at | 64 (GUESS: the Bible's number; defenders got past 55) | 128 |

Under both, a full table refuses the NEW shot and never removes one that
is alive, and a refused shot takes no ammo (a refused bay launch keeps its
fighter in the bay). A pilot's own ship (and the escorts it brings in) is
never refused. The family budget is split evenly among each shot's
children, so it bounds a family of any shape: one DVrger missile (109
projectiles) fits, the synthetic "5 copies of itself, SubLimit 9999" cheat
weapon stops at 256 descendants.

The numbers come from these measurements (2026-11-28, the MacBook under
heavy load from other agents (load average 12-30 on 10 cores), so absolute
times run 2-3x high; compare the columns):

| scene (`packages/nova/scripts/`) | original | novajs | uncapped / other caps |
|---|---|---|---|
| DVrger flood: 300 "DVrger missile"s, one every 2 steps (`submunition_benchmark.mjs --weapon 'Alternate Missles:298' --steps 600 --fire-every 2 --shots 300`), sim ms a step at the plateau | 1.8 ms, 126 alive | 3.2 ms, 253 alive | soft 384: 9.0 ms (378); 512: 12-14 ms (504); 768: 21.6 ms (750); none (before wave 58): 17.5 ms, peak 1,012 |
| Self-replicator (`--weapon replicator`: 5 copies of itself, fire at nearest, SubLimit 9999; 20 shots, one every 30 steps) | 0.6 ms, 127 alive (the table full) | 1.0 ms, 220 alive (each family stops at 256) | no limits: killed after 6 min at 3.6 GB, still growing |
| Big fight, real data (`big_fight_benchmark.mjs --data real`: 84 warships, 260 missiles kept in flight, PD), ms a tick (step + snapshot) | 9.2 ms, 128 projectiles | 24.6 ms, 512 | hard 256: 16.7 ms; 384: 21.1 ms |
| Big fight, synthetic data | 6.5 ms, 128 | 17.7 ms, 512 | |
| Beams: Thunderhead Lances fired straight at a target (`--weapon nova:166 --fire-every 1 --volley K --beam-caps inf,inf`), sim ms a step | | | 66 beams 0.4 ms; 132 1.0 ms; 264 2.9 ms; 528 3.8 ms |
| Browser (`submunition_flood_browser.mjs`, headless Chrome on SwiftShader): 16 DVrger launchers held 60 s | 128 projectiles; frame p50 18-60 ms | 511; frame p50 16-68 ms | the frame time follows the machine's load, not the count: no difference visible; heap after GC +2.4 / +3.8 MB, no page errors |
| Browser: 100 Vell-os Javelins (a bay of fighters, 3 beams each) | 150 s: ships held at 64, the bay kept the rest | 50 s: 53 ships (one launch every 1.5 s) | |

Reading: a projectile costs the simulation about 20-30 µs a step (a beam
about 7), on top of a tick budget of 16.7 ms that rollback resimulation
must also fit into. Submunitions are capped at 2x the original's table, so
the worst flood a plug-in weapon makes stays near 3 ms a step; directly
fired shots get 4x, so a ship's shot appears unless the system holds 512
projectiles, which only an extreme brawl reaches (the big fight above, at
2.5x the original's cost). Ships get 2x the original's counts.

The planet-domination tactic Matthew remembered (fill the system with
escorts and launched fighters so the defence fleet cannot launch) does not
work on the original as measured: with 55 fighters out, all six defenders
of a demand still launched (reference "The ship cap, beamcap (wave 60)").
Both rules keep that: defenders are held only by the whole system's count,
and a fleet must still be beaten to dominate. Not measured, and not
implemented: whether a fleet that cannot launch at all (a system of 64)
counts as beaten; the original's 55-ship refusal of MISSION ships (NovaJS
places every mission ship: they arrive through their owner's addEntity
record); whether hired / captured escorts and traffic arrivals are held at
55 (NovaJS: escorts are never refused, traffic is).
