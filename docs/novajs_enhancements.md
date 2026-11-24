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
  no toggle. Making one switchable would need a **room rule**: a setting
  the room's host picks and every peer runs.

"Reference" means `docs/reference_experiments.md`.

| Departure | Ruling / source | Client or sim | Toggle |
|---|---|---|---|
| One shift-click on the map plots a whole route, through drawn (incl. unexplored) systems. The original only pins a neighbour of the route's end. | Matthew 2026-11-23, "Map auto routing" (list of UI departures); reference "Route planning through unexplored systems, wave 10" and "Multi-jump routes and the `j` key, wave 11" | client (the route is the player's own input) | `enhMapAutoRoute` "Map auto-routing" |
| The target display shows the live ship, turning with it. The original shows a fixed picture of the class (PICT 3000 + id - 128). | Matthew 2026-11-23, "Live target render vs the ship's target image"; `space/in_space.png`, `p_properties/general.png` | client | `enhLiveTargetView` "Live target view" |
| Player Info prints shield/armor totals, "100% (150)". The original prints "100%". | Matthew: "let's put the total shields / armor next to Shield Status and Armor Status like we do for energy" (`spaceport/player_info.ts` healthStatus) | client | `enhShieldArmorTotals` "Shield and armor totals" |
| The scroll wheel / two-finger scroll moves the outfitter, shipyard and hire grids by rows. The original's wheel does nothing there. | Matthew 2026-11-23, "Scroll wheel to navigate outfitter / shipyard" | client | `enhShopScrollWheel` "Scroll wheel in shops" |
| The scroll wheel / two-finger scroll moves a long mission offer or briefing text (three lines a wheel notch). The original's wheel does nothing over text; there it scrolls only by the arrows (a 60 px/s glide while held, 5 px a click) and the keys (Up / Down 10 px, PageUp / PageDown 250 px, Home / End). | Added with the wave-12 scrolling fixes (the brief allowed a wheel for text under a toggle; kept: Matthew 2026-11-24); reference "Scrolling: long mission text and the shop scroll arrows, wave 12" | client | `enhTextScrollWheel` "Scroll wheel in mission text" |
| A search field filters the outfitter and shipyard by name. The original has none. | Matthew 2026-11-23, "Search bar (or maybe filter) for outfitter + shipyard" | client | `enhShopSearch` "Shop search" |
| The `h` minimap takes no clicks once it has faded. The original's hidden area still picks systems for about 8 s from the show. | Matthew 2026-11-23: "`h` map preview is clickable even when hidden. bug."; reference "M1 wave 10" | client | `enhMiniMapHiddenNoClicks` "Hidden h-map ignores clicks" |
| Trackpad two-finger scroll pans the galaxy map; pinch zooms about the cursor. | aaf38494 (2026-11-23), a NovaJS input addition (`spaceport/starmap_gestures.ts`) | client | none: the original's map wheel behaviour was never measured, so there is no original to restore |
| Murk hides objects within 120 px at murk 100 (12535fb8, "stronger murk"). | Playtest tuning, 2026-07-08 ("Playtesting judged the original 300 too weak by 2-3x"; that 300 was NovaJS's own first guess) | client (display only) | none: the original's falloff is unmeasured, so there is no original value to restore |
| The 2x-speed badge sits flush in the top-left corner, with a "x2 waiting for N of M" line while peers vote. | Matthew 2026-11-23: "shove the 2x indicator flush to the top left"; R3 #371 | client | none: the badge is the original's (cicn 20000); the voting line is multiplayer-only |
| UI scale and global scale (Preferences > Display). | NovaJS-only; machine-local by design (`title/client_prefs.ts`) | client | already its own setting |
| Every capture the odds table allows is at least 1%. The original reads 0% against overwhelming crews. | Matthew 2026-11-23: "There should always be at least a 1% chance to capture a ship" (`ship/boarding_component.ts` CAPTURE_CHANCE_MIN) | sim | room rule |
| A direct hit by a shot with ProxRadius > 0 fires its submunitions. On the original a small fuse loses the race to the body and no subs appear. | Matthew 2026-11-23: "Prox radius > 0 can serve as the flag that forces subs to fire" (`combat/submunition_rule.ts`); reference "Submunitions wave 10" | sim | room rule |
| Beams fire submunitions at the end of their ray when they end. The original has no beam subs (reference "Submunitions wave 11": none on a hit, none when the beam ends). | Matthew's rule, restored in 1a62e1c9 ("Beam subs ... are a NovaJS extension") | sim | room rule |
| A disabled player ship repairs itself after 20-45 s (an inherent repair droid), so it is never soft-locked. | "Deliberate non-fidelity rulings: player self-repair" (reference, "Not answerable here"); `ship/disabled_component.ts` PLAYER_REPAIR_DELAY | sim | room rule |
| Bay fighters still in flight count against the bay's capacity when buying, and block selling the bay ("You can't sell this while its fighters are deployed."). | Matthew 2026-08-09 (`spaceport/deployed_outfits.ts`), 2026-08-17 launcher sell rule (`spaceport/outfitter_rules.ts`); listed as "the deployed-fighters trade block" in the reference | sim (it decides what the ship carries at lift-off) | room rule |
| The per-day BuyRandom / HireRandom roll is off: anything with a nonzero chance is offered every day. | Matthew 2026-08-14: "disabled for now" (`spaceport/day_roll.ts` BUY_RANDOM_DAY_ROLL_ENABLED) | sim (a shop's stock is shared by everyone docked there) | room rule |

No longer departures (they were listed as deliberate non-fidelity, but now
match the original): **one plunder per hulk** (the original does the same,
reference wave 8) and **the boarding alignment rule** (29° and no message
since ruling #378, ef61904a).
