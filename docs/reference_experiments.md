# Reference experiments: questions the original EV Nova can answer

This is a running log of gameplay questions that come up while building
NovaJS, with answers measured on the original EV Nova 1.1.1. The game runs
on Matthew's reference Mac and is driven by `scripts/novaref` (see its
README for pilot-make, plugin-make, the test kit and the safety rules).

Each row says where the answer matters in our code, how the reference can
answer it, and a priority. When a question is answered, it gets a
**Finding** with the evidence path. Evidence (recordings, screenshots,
pilot diffs) lives outside the repo under
`~/.local/share/novaref/evidence/<YYYYMMDD>-<slug>/` on the MacBook.

**Experiment kinds**

- **CPl** custom pilot
- **CPg** custom plug-in (usually the test kit)
- **SS** screenshot
- **VID** recording measured frame by frame
- **PD** pilot diff before/after

**Paths:** `N/` = `packages/nova/src/`, `P/` = `packages/novaparse/src/`.

## Answered

### #316: ship and weapon unit constants (2026-11-23)

**Status:** answered for Speed, Accel, Turn and wëap Speed. GuidedTurn is
not measured yet. Confidence is high for speed and turn, and good for
accel (±3%).

**Method.** Kit Probes A/B/C were flown from rest in the sealed Kit Range
and recorded at 30 fps, cropped to the window. Their Accel/Speed/Turn are
300/300/10, 150/600/30 and 600/200/20.

- **Turn:** the period of the player's sprite sequence over one to three
  full turns, holding Left for 14 s.
- **Speed and accel:** the player is always drawn at screen centre, so
  ship velocity is minus the on-screen velocity of the static stellars.
  This was tracked two ways, by a planet template and by the median
  displacement of all stellar blobs.
- **wëap Speed:** two unguided Kit Speed Guns (Speed 300 and 600) fired
  from rest.
- **Video clock:** checked against an exact 20.140 s key interval (the
  map toggled by the remote helper). That gave 605 frames, so the
  recording runs at 30.04 fps and the video is real time.

**Findings** (real time on the reference iMac):

| quantity | 300 | 200 / 150 / 600 | per unit |
|---|---|---|---|
| shïp Turn (deg/s) | 10 → 29.11 | 20 → 58.38, 30 → 87.10 | 2.91 deg/s |
| wëap Speed (px/s) | 300 → 87.25 | 600 → 176.5 | 0.291 px/s |
| shïp Speed, top (px/s) | 300 → 130.65 | 200 → 88.25 | 0.436–0.441 px/s |
| shïp Accel (px/s²) | 300 → 51.9 | 150 → 25.9, 600 → 111 (short ramp) | 0.173 px/s² |

- **Tick rate.** Two documented units agree that the game's physics ticks
  at **29.1 Hz** on this machine, about 3% under 30. One is wëap Speed
  ("100 = 1 px/frame"); the other is shïp Turn ("10 ≈ 30°/s", i.e.
  1°/frame). The game renders at 56 fps (F12).
- **Per game frame.**
  - wëap Speed: S/100 px/frame.
  - shïp Turn: T/10 deg/frame.
  - **shïp Speed: 1.5 × S/100 px/frame.**
  - **shïp Accel: ≈ A/5000 px/frame²** (0.000204·A measured).
- A ship whose Speed equals its Accel therefore reaches top speed in about
  75 frames, i.e. **2.5 s, not 1 s**.

**What NovaJS does.**

- `P/parsers/constants.ts:9` `ShipSpeedConversionFactor = FPS/100` gives
  0.3·S px/s. The original is 0.45·S at a nominal 30 Hz (0.436·S
  measured), so **our ships are 1.5× too slow.**
- `P/parsers/constants.ts:14` `ShipAccelerationConversionFactor = FPS/100`
  gives 0.3·A px/s². The original is about 0.18·A at 30 Hz (0.173·A
  measured), so **our acceleration is about 1.67× too fast.**
- The same two factors scale outfit speed/accel mods at
  `P/parsers/outfit_parse.ts:172,177`.
- Turn (`constants.ts:17`, 3°/s per unit) and wëap Speed
  (`P/parsers/weapon_parse.ts:11`, `WEAP_SPEED_FACTOR = 3/10`) match the
  original at a nominal 30 Hz.

**Proposed fix (not applied).**

- `ShipSpeedConversionFactor = 1.5 * FPS / 100` (0.45).
- `ShipAccelerationConversionFactor = FPS * FPS / 5000` (0.18).
- Update the comments, which claim "equal values reach top speed in one
  second".
- Re-check NPC AI tuning that assumed the old speeds.

Ruling needed (needs/maintainer): should NovaJS target the nominal 30 Hz
(0.45/0.18) or this machine's 29.1 Hz wall clock (0.436/0.173)? The
nominal rate keeps the turn and weapon factors exactly where they are.

**Evidence:** `~/.local/share/novaref/evidence/20261123-unit-constants/`

- `FINDINGS.txt`
- `20261123-005332-unit_probe/` (Probe A)
- `probe-b/`, `probe-c/`
- `calib/` (map timing, fps shot, gun shots)

Each run directory holds `recording.mp4`, `motion.json`, `raw_disp.txt`
and the run's own log. Re-run with `scenarios/unit_probe.json --pilot
…/novaref-probe-<a|b|c>`, then analyse with `analysis/motion.mjs`,
`world_motion.mjs` and `shots.mjs`.

### Q1: does a protect-the-player special ship retaliate when the player shoots it? (2026-11-23, partial)

**Setup.**

- mïsn 960: ShipBehav 1, ShipGoal 3, one Kit Escort of govt 360, offered
  on landing.
- The player flies Kit Lancer Lite with a record of -500 in sÿst 2100,
  i.e. criminal with govt 360, whose CrimeTol is 0.
- The player targets the escort once with Tab, watches for 24 s, then
  holds fire for 4 s with the Kit Escort Gun (30 dmg) and the Tickler,
  then watches for 40 s more.

**Findings.**

1. **Unprovoked:** the escort flew formation beside the player for more
   than 60 s and never fired at them. Its target brackets were green and
   the player's shield stayed at 100%. This is despite the player's
   criminal record with the escort's own govt. 0e701c4b matches: a ship
   in the player's flock never counts the player as hostile.
2. **Provoked:** the player's turret shots **passed through the escort**.
   The recording shows the bolts travelling on past its brackets, and its
   shield stayed at 100%. The escort never turned on the player either.
   So in the original the player cannot damage a ShipBehav-1 special ship,
   like an escort. NovaJS: `N/nova_plugin/ship/firing_group.ts`
   friendly-fire rule (flock members are only hittable when disabled)
   plus the 0e701c4b aggressor guard (`N/nova_plugin/npc/npc_decision.ts:
   ~262-288`). That **matches**.

**Still open:** whether it would retaliate if damage could land, for
example from a beam, a blast radius or a disabled escort. This probably
can't happen in the original.

**Evidence:** `~/.local/share/novaref/evidence/20261123-protect-player/q1/20261123-010954-protect_q1/`
(`recording.mp4` at about 35-39 s, `08-…19-*.png`). The earlier run
`20261123-010655-protect_q1/` provoked with no target selected.

## Pending (set up, not yet run: the reference Mac was taken offline mid-session)

These are ready to run. Scenarios are in `scripts/novaref/scenarios/` and
pilots in `scripts/novaref/pilots/`.

| id | question | experiment | where it matters |
|---|---|---|---|
| Q2a | Does a protect-the-player ship engage ships that are **attacking** the player? | `protect_observe.json`, pilot `q2a.json`: mïsn 961 escort + 2 Kit Raiders (govt 362, AI 3, player criminal). Tab through targets, watch shield % of the raiders and the player. | `N/nova_plugin/npc/npc_decision.ts` `attackingProtectee` (~275, ~391) |
| Q2b | …or any ship merely **hostile** to the player and not attacking (wimpy traders)? | Pilot `q2b.json`: mïsn 962 escort + 2 Kit Traders (govt 361, AI 1). | Same. NovaJS: not engaged unless its own govt is an enemy. |
| Q3 | Does it fight its **own govt's** ships when they attack a criminal player? | Pilot `q3.json`: mïsn 963 escort + 2 own-govt raiders (govt 360). | Same. NovaJS: yes (isAttackingPlayer wins over govt). |
| Q4 | Do its bay fighters follow suit? | Pilot `q4.json`: mïsn 964 Kit Carrier (fighter bay 366) + raiders. | Bay fighters' flock membership (`N/nova_plugin/escorts/bay_plugin.ts`, `allegiance.ts`). |
| #321 | What sets the trade tier multiplier k (×1.25/×0.8 vs ×1.1)? Is it the pilot's priceFlux? | CPl: identical pilots that differ only in `priceFlux` (pilot-make supports it). Land at Kit Port / Kit Market (opposite tiers + jünk 200/201), SS the Trade Center, buy/sell, PD credits. | `N/nova_plugin/economy/trade_logic.ts:33` |
| #316b | Is wëap GuidedTurn on the ship Turn scale (1°/frame per 10)? | CPg: Kit Missile T10/T30/T60 (speed 600, i.e. 5.8 px/frame) fired 90° off a Kit Target (mïsn 965). The turning radius is v/ω: 1°/frame per 10 gives about 330 px for T10. | `P/parsers/weapon_parse.ts:313` |

## Catalogue

Sources: Forgejo open issues (all 116 skimmed; #321, #316, #320, #373,
#358, #297 and #140 read in full), code comments that mark Bible-silent or
guessed behaviour, the hub's protect-the-player questions, and Matthew's
categories (NPC AI state transitions, UI hotkeys, edge cases).

Priority: **H** affects common gameplay or blocks an issue; **M**; **L**
cosmetic or rare.

### Physics and units

| id | question | where it matters | how | prio |
|---|---|---|---|---|
| U1 | shïp Speed/Accel/Turn units | `P/parsers/constants.ts:9-21` | **answered above** | H |
| U2 | wëap GuidedTurn scale | `P/parsers/weapon_parse.ts:313` | CPg, VID (Kit Missile T10/30/60) | H |
| U3 | Outfit speed/accel/turn mods use the same scale? | `P/parsers/outfit_parse.ts:159,172,177` | CPg outfit with each ModType; VID with the Probe | M |
| U4 | Afterburner boost (×2?) and the coast back down | `N/nova_plugin/travel/afterburner_plugin.ts:14-40` | CPl + afterburner outfit, VID | M |
| U5 | Inertialess stop behaviour: does it stop instantly, decelerate at Accel, or turn the velocity? | inertialess physics in `ship_parse.ts:329` consumers | Kit Lancer, VID | M |
| U6 | How fast does a disabled ship drift to a stop? | `N/nova_plugin/ship/disabled_component.ts:63-68` | VID | L |
| U7 | spöb Gravity unit and falloff | not implemented | CPg stellar Gravity 100/500, VID drift | L |
| U8 | Hyperspace timings: spin-up, departure, arrival, when fuel is deducted | `N/nova_plugin/travel/jump_plugin.ts:36-60` | Test kit with two linked systems; VID | M |
| U9 | Landing gate: distance and speed | `N/nova_plugin/travel/planet_plugin.ts:160-162` | VID | L |
| U10 | Ship explosion damage/radius scaling | `N/nova_plugin/ship/ship_explosion.ts:85-124` | CPg heavy düde next to a known-shield ship | L |

### NPC AI and state transitions (Matthew's category)

| id | question | where it matters | how | prio |
|---|---|---|---|---|
| A1 | Q1: does a protect-the-player ship retaliate when shot? | `N/nova_plugin/npc/npc_decision.ts:247-288` | **answered above** (shots pass through; it never turns) | H |
| A2 | Q2: does it engage attackers only, or any hostile? | same, ~391 | pending (Q2a/Q2b) | H |
| A3 | Q3: does it fight its own govt's ships? | same | pending | H |
| A4 | Q4: do its bay fighters follow suit? | `N/nova_plugin/escorts/bay_plugin.ts` | pending | M |
| A5 | Do NPCs of the same govt pass through each other's shots? | `N/nova_plugin/ship/firing_group.ts:62-67` | CPg crossfire, VID | M |
| A6 | Warship (AI 3) vs interceptor (AI 4) engagement thresholds against a criminal player (MaxOdds, strength) | `npc_decision.ts` odds logic | CPg govt MaxOdds variants, CPl rating/strength | M |
| A7 | Brave/wimpy trader transitions: flee vs fight back, and when they calm down | `npc_decision.ts` cases 1/2 | CPg traders + tickler | M |
| A8 | How long a ship bribe lasts (NovaJS: 2 min) | `N/nova_plugin/encounters/hail_plugin.ts:228-233` | VID after bribing | M |
| A9 | Do pirates board a disabled player, and what do they take? | `N/nova_plugin/npc/npc_plunder.ts:45-108` | CPl weak ship, VID, PD | M |
| A10 | Does a disabled player ever recover unaided? | `N/nova_plugin/ship/disabled_component.ts:76-95` | VID 3 min | M |
| A11 | When do NPCs leave a system, and how often do they respawn? (AvgShips ±50%?) | `N/nova_plugin/spawn/npc_spawn_plugin.ts:138,833` | Stock busy system, VID 10 min | M |
| A12 | Do mission goal ships (other than chase-off) linger after the goal completes? | `N/nova_plugin/missions/mission_ship_spawn.ts:95-105` | CPg, VID | L |
| A13 | Does a hostile Flags 0x0020 AI use its afterburner? Is a Flags2 0x0004 ship skipped by NPC targeting? | `P/parsers/ship_parse.ts` | CPg, VID | L |
| A14 | Which legal record decides a ship's hostility: the player's record in the CURRENT system, or in the ship's govt's systems? (The original keeps records per system; NovaJS per govt.) | `N/nova_plugin/reputation/reputation.ts`, `hostility.ts` | CPl with records differing between Kit Range and the home systems; watch which kit ships attack | H |

### Reputation, missions and economy

| id | question | where it matters | how | prio |
|---|---|---|---|---|
| R1 | #321 trade tier multiplier k / priceFlux | `N/nova_plugin/economy/trade_logic.ts:33` | pending (above) | H |
| R2 | #320.1 ally/enemy record propagation size (NovaJS penalty/2) | `N/nova_plugin/reputation/reputation.ts:75,156` | CPg govt KillPenalty 100 + ally/enemy govt owning home systems; kill one; PD legalStatus | H |
| R3 | #320.2 negative gövt penalty = none? | `reputation.ts:127-139` | CPg govt KillPenalty -5, PD | H |
| R4 | Engine default when a penalty is 0 (NovaJS 5/2/3) | `reputation.ts:63-67` | CPg govt with zero penalties, PD | M |
| R5 | Combat-rating multiplier (NovaJS raw Strength sum) | `reputation.ts:46-50`, `reputation_plugin.ts:185-220` | Kill one known-Strength ship, PD rating | M |
| R6 | Who gets kill credit for an escort or fighter kill (NovaJS: group root) | `N/nova_plugin/reputation/reputation_plugin.ts:44-48` | CPl with escorts (pilot-make `escorts`), PD | M |
| R7 | Bribe price (NovaJS 10%/30% of cash, minimum 500) | `N/nova_plugin/reputation/hail.ts:83-93` | CPl with exact cash at 2-3 levels, SS | H |
| R8 | Planet bribe price, duration and persistence | `N/nova_plugin/travel/planet_plugin.ts:149-156` | CPl, SS | L |
| R9 | Outfit resale (NovaJS 50%), and same-visit buy+sell refund | `N/spaceport/outfitter_rules.ts:408-416`, `outfitter.ts:206` | CPl at Kit Port, PD credits | H |
| R10 | Ship trade-in (25%: are stock outfits double-counted? ammo? clamp?) | `N/spaceport/shipyard_rules.ts:88-121` | CPl buy a kit hull, PD | H |
| R11 | Cargo when the new hull's hold is smaller | `shipyard_rules.ts:327-340` | CPl full hold, PD | L |
| R12 | Escort daily wage formula | `N/spaceport/escort_fees.ts:62-80` | CPg hulls differing in one field, SS/PD | M |
| R13 | TravelStel -2 destination selection | `N/nova_plugin/missions/mission_offer.ts:119` | CPg, repeat offers | M |
| R14 | Is a mission with no offer dësc auto-accepted? | `mission_offer.ts:35-62` | CPg AvailLoc 3 mïsn without dësc | L |
| R15 | In-flight `S` starts: ShipSyst -6 spawn timing | `N/display/ship_mission_offer_plugin.ts:295-330` | CPg, VID | L |
| R16 | Auto-abort ships, DatePostInc on deferred auto-abort | `N/nova_plugin/missions/mission_ship_spawn.ts:479-492` | CPg, PD date | L |
| R17 | Mission destination always lands (bad record, MinStatus 32767)? | `N/nova_plugin/reputation/stellar_clearance.ts:53-75` | CPl + kit stellar with MinStatus 32767 | L |
| R18 | Tribute: rating threshold, defence-fleet waves, reset on jump-out (#353) | not implemented | CPl rating per Appendix I tier, VID | M |
| R19 | Reinforcements (MaxOdds trigger, delay, cooldown) | not implemented | CPg govt + syst ReinfFleet, VID, PD | L |
| R20 | Plunder money (NovaJS 10% of price) and capture odds | `N/nova_plugin/ship/boarding_component.ts:239-243,370-377` | CPl, board kit ships of known Cost/crew, PD | M |
| R21 | Scanning: what happens with illegal cargo (#308)? | not implemented | CPg illegal jünk + interceptor govt, VID, PD | M |
| R22 | BuyRandom roll period | `N/spaceport/day_roll.ts:39-62` | CPg BuyRandom 50 outfit, repeat landings | L |

### UI navigation and hotkeys (Matthew's category)

| id | question | where it matters | how | prio |
|---|---|---|---|---|
| K1 | Spaceport hotkeys (Bar/Mission BBS/Trade/Shipyard/Outfitter/Leave): which letters, and does Return = Leave? (Return = Leave **confirmed**; `o` = Outfitter confirmed) | `N/spaceport/spaceport.ts` key handling | SS after each key | H |
| K2 | Mission offer dialog keys: Return = Yes (**confirmed** for AvailLoc 3), Escape = No? | spaceport mission offer | SS | M |
| K3 | Tab with one ship toggles target ↔ none (**observed**). Does `r` skip friendly escorts? | `N/nova_plugin/hostility.ts` targeting | SS | M |
| K4 | Map (`m`) keys: zoom +/-, Find, Escape | map dialog | SS | L |
| K5 | Hail dialog (`y`) keys and buttons per govt flags (#297, Flags2 0x0001) | `N/nova_plugin/reputation/hail.ts:118-151,242` | CPg govts with each flag, SS | M |
| K6 | Venue buttons when a stellar lacks a venue: hidden or greyed? (#373) | `N/spaceport/spaceport.ts:1037-1050` | CPg Kit Market (no outfitter/shipyard): SS its spaceport | H |
| K7 | Escort command keys (escortCmd 0-3 = f/d/v/c, escort menu e), from the prefs | escort commands | CPl with escorts, SS | M |
| K8 | Radar centre arrow range and hypergate ring vs dot (#358) | `N/display/status_bar_radar.ts:209-225,646-668` | VID flying out from a kit stellar | L |

### Edge cases

| id | question | where it matters | how | prio |
|---|---|---|---|---|
| E1 | Negative shïp Shield (×5 "super shields"?) in combat | `P/parsers/ship_parse.ts:316` | CPg Shield -10000, VID | L |
| E2 | Fixed-angle (negative Inaccuracy) firing side | `N/nova_plugin/combat/fire_weapon_plugin.ts:211-231` | CPg, SS | L |
| E3 | Weapon readiness right after a spawn or jump (#135) | `fire_weapon_plugin.ts:85,510` | CPg slow-reload weapon, VID | L |
| E4 | planetType weapons vs normal ships (#136/#150) | wëap planetType | CPg, VID | L |
| E5 | Jamming odds and retargeting | `N/nova_plugin/combat/jamming_plugin.ts:96-166` | CPg, many shots | L |
| E6 | Ionization thresholds and slow factor (NovaJS 0.6) | `N/nova_plugin/ship/ionization_plugin.ts:25-59` | CPg ion weapon, VID | M |
| E7 | Auto-refuel rate (ModType 19) | `N/nova_plugin/ship/health_plugin.ts:40-48` | CPl fuel 0, timed PD | L |
| E8 | Bay fighter launch speed (#200) | `N/nova_plugin/escorts/bay_plugin.ts:245,313` | VID Kit Carrier | L |
| E9 | shïp AppearOn residuals (#140): which entities it gates, asteroid re-roll | `N/nova_plugin/spawn/spawn_bits.ts` | CPg, CPl bit on/off | L |
| E10 | Beam decay and projectile fade curves | `N/display/beam_display_plugin.ts:32-50` | CPg, VID | L |
| E11 | Ship-info Accel/Maneuver rating-word bands | `N/spaceport/ship_info.ts:63-92` | Kit shipyard with stepped hulls, SS | L |

### Not answerable here (or not needed)

- **NovaJS-only design:** netcode, determinism, rollback, multiplayer
  sharing rulings (#374, #354, #362, #361, #349, #350, #342, #338, #345,
  #346, #332, #344). The original can only supply single-player
  baselines.
- **Layout already pinned** from the 1920×1080 captures in
  `ui_screenshots/original_macos_screenshots`.
- **Deliberate non-fidelity rulings:** player self-repair, one plunder per
  hulk, the boarding alignment rule, murk distance, and the
  deployed-fighters trade block.

## Side findings

- The reference Mac's `Nova Data 4.ndat` differs from the repo's
  canonical copy in two places:
  - wëap 146 "Pulse Laser" byte 15 (the low byte of the Graphic field at offset 14).
  - An extra dsïg 128 resource.

  So the reference runs slightly different stock data than our tests.
- `Enter Ship` starts the pilot in space beside its last stellar. It does
  not start landed.
