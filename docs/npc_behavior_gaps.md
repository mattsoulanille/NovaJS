# NPC behaviour: what the original has that NovaJS lacks

Matthew (2026-11-23): "Can we implement more NPC behavior, like scanning for
contraband, mining asteroids, 'trading' between planets in the same system,
etc?"

This document lists every NPC behaviour the original EV Nova documents or
has been measured doing. For each one it says what NovaJS does today, what is
still unknown and has to be measured on the reference Mac, and roughly how
big the work is. It ends with a recommended order and a reference-Mac brief
for each step. No game code was changed.

## Sources and conventions

- **B:n** is a line of `packages/nova/EVN_Bible.txt` (the 2006 text
  revision).
- **R:** is a section of `docs/reference_experiments.md`, the log of
  measurements on the original.
- **N/** is `packages/nova/src/`, **P/** is `packages/novaparse/src/`, and
  **D/** is `packages/novadatainterface/src/`. Line numbers are at main
  69e8a400.
- **Stock** counts come from the base "Nova Files" (no plug-ins), read
  through novaparse's resource parsers by a throwaway census script (not
  committed). Resource ids are stock ids.
- Text marked **guess** is my reading and has not been measured.
- **Sizes:** **S** is a day or less in one module. **M** needs new synced
  state, several modules and new specs. **L** is a new subsystem touching
  sim, display, data plumbing and multiplayer rules.

## Matthew's three examples

**Contraband scanning.** The original has it. AI 4 interceptors "buzz
incoming ships to scan them for illegal cargo" (B:867-868). Contraband is
anything whose ScanMask matches the scanning government's ScanMask: jünk
(B:1168), oütf (B:2027) or mission cargo (B:1364). The game's own strings
spell out the flow (stock STR# 2002 indices 373-382 and 389): "prepare to be
scanned", "hold position for a cargo inspection", "your attempt to smuggle
... illegal cargo ... through this system ... has been detected", "You have
been fined", "Have a nice day." In the stock data **every gövt has ScanFine
0** ("no fine, just a warning", B:983), so stock consequences are:

- SmugPenalty on the legal record (B:987; 1-25 in 40 stock govts);
- failure of the 75 stock missions with mïsn Flags 0x0020 (B:1550), with
  "Your ship has been scanned - mission failed." (STR# 2002 #285);
- an attack instead of a scan, if the player's record is already below
  CrimeTol (B:977-980).

AI 4 düdes are 50 of 147 and appear as traffic in 483 of 545 systems, so
scanning would be everywhere. NovaJS had **none of it** when this was
written (no scan event, no fine, SmugPenalty unused, mission flag 0x0020
inert). **Since 2026-11-24 it has** (see the inventory row below and
"Contraband scan: guesses to measure"). Size **L**.

**Mining.** The original documents it, as hull flags rather than an AI type:

- shïp Flags3 0x0001 "Ship destroys asteroids";
- shïp Flags3 0x0002 "Ship scoops asteroid debris", which needs a mining
  scoop (oütf ModType 31) in DefaultItems (B:2645-2651).

In stock, the only real miner is **shïp 379 Asteroid Miner**: both flags plus
the Asteroid Scoop (oütf 271) as a default item. It flies in four Civvies
trader düdes (129, 132, 148, 175; AI 1 or 2, 5-17% of each) across 83
systems. Two Mu'Hari Zephyr hulls (375, 376, AI 4 düdes 200/201) carry 0x0001
alone. The Bible says nothing about **how** a miner behaves: whether it hunts
rocks, how long it mines, whether it lands its haul. NovaJS has the pieces
(asteroids, debris boxes, and a ScoopSystem that works for any ship carrying
a scoop: N/nova_plugin/combat/asteroid_plugin.ts:144-170, 658), but Flags3
0x0001/0x0002 are not parsed and no AI seeks asteroids. Size **M**, after a
measurement. **Since 2026-11-24 miners mine** (R: "N1 wave 13"; see the
inventory row and "Shuttles and miners: guesses to measure").

**Trading between planets in the same system.** Also documented, as the
other half of Flags3 0x0002: without a mining scoop, "the ship will instead
shuttle back and forth between friendly stellars in the system" (B:2648-2650,
an Appendix V addition).

- **Stock shuttles:** shïp 391 Shuttle, 392 Heavy Shuttle, 393 Cargo Drone
  (all named "economy at work") and 394 Sprite.
- **Their düdes:** 247-250 (AI 1; govts Pyrogenesis Skymining, Sigma
  Shipyards, Civvies, Polaris).
- **Where they fly:** Sol, Nesre Primus and Secundus, Fomalhaut, Arcturus,
  Rautherion, South Manchester, and ten Polaris systems (Tri'lipra, Kel'ariy
  and others).

Ordinary AI 1 traffic also visits stellars, lands, lingers about 20 s and
jumps out (R: "A-series wave 5"). NovaJS already flies AI 1/2 traders
planet to planet with a 12 s "dwell" standing in for a landing, then sends
them out after 120-300 s (N/nova_plugin/npc/npc_decision.ts:508-557,
N/nova_plugin/npc/npc_steering.ts:31-33). So traffic looks like trading
today, but:

- shuttle hulls are not told apart: they leave like any trader, and
  "friendly" stellars are not checked;
- nobody lands for real: the ship never vanishes and never takes off again.

Neither game moves goods. Nothing in the Bible says NPC trading changes
prices; düde Flags 0x0001-0x0040 only decide what a plundered ship yields
(B:840-847). Size **S** for the shuttles; **M** for real landing and
take-off. **Since 2026-11-24 shuttles shuttle** (R: "N2 wave 13"; see the
inventory row); real landing for ordinary traffic is still open.

## Inventory

### Law and policing

| behaviour | Bible | NovaJS status | unknown, to measure | size |
|---|---|---|---|---|
| **Contraband scan by AI 4** ("buzzes incoming ships to scan them for illegal cargo") | B:867-868 (AI 4); gövt ScanFine B:977-986, SmugPenalty B:987-988, ScanMask B:1116-1119; jünk ScanMask B:1168-1173; oütf ScanMask B:2027-2032; mïsn ScanMask B:1364-1367; status strings STR# 2002 374-379, 392-393, 285 | **Done (2026-11-24),** to the S1/S2 measurements and wave 14 (R: "S1 / I1 wave 11", "S1 and S2 wave 12", "Contraband wave 14"). Rules: N/nova_plugin/npc/contraband.ts; who is buzzed and the scanned marker: contraband_target.ts; the scan: contraband_scan.ts (ContrabandScanSystem); AI 4 decision case 4 in npc_decision.ts, mode 'scan' steered in npc_steering.ts; the status line: N/display/status_bar_content.ts `contrabandScanMessage`. An AI 4 of a govt with a ScanMask that enforces here (local_law.ts) flies at an unscanned, non-criminal PLAYER ship within 3000 px that carries something illegal to it, and scans it within 150 px. Illegal outfit: "…your posession of a <LCName> has been detected. You have been fined N credits.", ScanFine, SmugPenalty. Illegal jünk: "…your attempt to smuggle <LCName> through this system…", ScanFine, SmugPenalty. Plain mission cargo: "…your attempt to smuggle illegal cargo through this system…", ScanFine, no SmugPenalty. ScanFine 0 and below: no fine, no fine sentence (not the Bible's percent). SmugPenalty by the A14 rule: the owner or its ally scanning costs the scanner's SmugPenalty, anyone else (nosy) raises the record by half the owner's; no spread. A detection turns the scanning govt's hunters on the pilot until he lands or leaves, whatever its CrimeTol. One scan per stay between arrivals by jump: a landing does not reset it. A 0x0020 mission fails only on a scan that finds its cargo illegal. A clean ship is never approached. Per player: each pilot is scanned, charged and told separately. | Guesses left below ("Contraband scan: guesses to measure"): an owner's ALLY as the scanner, several finds in one scan, a clean scan's message. | (done) |
| **Mission fails if scanned** (mïsn Flags 0x0020) | B:1550; STR# 2002 #285 | **Done:** a scan that finds the mission's cargo illegal fails it ("Your ship has been scanned - mission failed."), no fine, no record (R: "S1 and S2 wave 12"). ScanMask and the flag are frozen onto the ActiveMission at accept (mission_accept_offer.ts). | Does ANY scan fail it, or only a matching one? (S3.) **51 stock 0x0020 missions have ScanMask 0**, so they can never fail by scan under the current reading. | (done) |
| **SmugPenalty** (record loss when detected smuggling) | B:987-988 | **Done** for an illegal OUTFIT only, as measured: the record of the system the scan happened in (its status govt), not the scanner's own. Not for mission cargo (measured) or jünk (guess). | Jünk; a scanner that is not the system's owner (whose record moves?). | (done) |
| **Piracy police** (AI 4 attacks "any ship that fires on or attempts to board another, non-enemy ship while the interceptor is watching") | B:868-871 | **Done (2026-11-24),** to "P1 wave 13" and "P1 wave 14" (R). N/nova_plugin/npc/piracy_police.ts (`policeDefendVictim`, `piracyWitnesses`), called from NpcAggressionSystem (N/nova_plugin/npc/npc_targeting.ts) through the same `provoke` / `provokeFleet` path a hit uses. When a PLAYER-side ship attacks an NPC, every AI 4 within 1800 px of the victim or the attacker records the attacker as its aggressor if its govt defends the victim: a NOSY govt (gövt 0x0002) for any non-enemy victim without 0x0020; any govt for its own or an ally's ship (local_law.ts's `alliedEitherWay`). The record lasts until the attacker leaves the world (lands, jumps, dies). Non-nosy police ignore an unrelated victim (wave 13). No record change. | The **guesses** below ("Piracy police and distress calls: guesses to measure"). | (done) |
| **Nosy-ignore** (gövt 0x0020: "Nosy ships of other non-allied governments ignore ships of this govt that are under attack") | B:1063-1064 | **Done (2026-11-24)** with the piracy police: nosy police ignore an attack on a ship whose govt sets 0x0020 (R: "P1 wave 14", finding 2). "Nosy" is gövt 0x0002 (measured). It does not shield a victim from its own or an allied govt's police (the Bible's "non-allied"; GUESS). | The ally case with 0x0020 (untested). | (done) |
| **Nosy enforcement** (gövt 0x0002: attacks a criminal player in non-allied systems) | B:1055-1058 | **Not read in the sim** (`attacksPlayerIfCriminal` is parsed: P/parsers/govt_parse.ts:62). R: "A14" found the rule (current system's record; owner, allies and nosy govts enforce) and called NovaJS a mismatch: N/nova_plugin/reputation/govt_disposition.ts:99-104 tests the record kept per govt. | Answered by A14. Reputation work is in progress in parallel; scanning should reuse the same "who enforces here" rule. | (reputation backlog) |
| **Distress calls** (ships "send distress messages" unless gövt Flags2 0x0008) | B:1095-1098; stock STR# 5003 "Ship Help Messages" ("Mayday, Mayday! We're under attack! ...", 20 lines) | **Done (2026-11-24)** for the message, to "P1 wave 14" (R): a trader (AI 1/2) hit in an attack by an NPC that is not on a player's side sends "<ship name>: <random STR# 5003 line>" to the status line of every player in the system, at most once per 20 s per ship, never when its govt sets Flags2 0x0008 or its hull inherits it. N/nova_plugin/npc/distress.ts (rules, DistressCallEvent), NpcAggressionSystem (the trigger and the PRNG draw), N/display/status_message_plugin.ts `ShowDistressCallMessage` (the line). **Nobody answers** (not measured). | Who answers; the real rate; whether the player's victims ever call; warships calling. Guesses below. | M if it summons help |
| **Reinforcement fleets** (sÿst ReinfFleet, called in when allied ships are losing past MaxOdds) | B:3050-3060; ränk 0x0400 "call in reinforcements on the player's behalf" B:2257-2260 | **Parsed only:** D/system_data.ts:34-45. 344 of 545 stock systems have one. | R19 in the catalogue: trigger, delay (ReinfTime), cooldown (ReinfIntrval), the "Sensors detect xxx reinforcement fleet approaching." line. | M |
| **Planet defence fleets and tribute** (spöb DefenseDude/DefCount, in waves) | B:2823-2836 | **Parsed only:** D/planet_data.ts:34-40 (tracker #353). 289 of 411 stock stellars have one; their düdes are mostly AI 3 (16), some AI 4 (4). | R18 in the catalogue. | L |

### Traffic, trading, landing

| behaviour | Bible | NovaJS status | unknown, to measure | size |
|---|---|---|---|---|
| **Traders visit stellars** (AI 1 "visits planets and runs away when attacked"; AI 2 fights back) | B:861-864 | **Done in shape.** The planet-to-planet loop is N/nova_plugin/npc/npc_decision.ts:508-557; destinations are landable non-wormhole stellars (`landingDestinations`, :158-161). Flee and fight-back are :440-506 (R: A7, A wave 7; applied). | The landed stay; how long a trader spends in the system; whether it only lands where its govt is welcome. NovaJS departs 120-300 s after spawning (:79-80, marked unmeasured). Brief **T1**. R: "T1 wave 13" (first pass): the shape matches (jump in, park beside a friendly port about 45 s including the approach, jump out from beside it; NovaJS parks 12 s); no change on one run. | — |
| **Real landing and take-off** (traffic vanishes on a stellar and later takes off from one) | Not in the Bible; seen in R: "A-series wave 5" (ships converge on Traffic Port and vanish; one appears beside the Port and flies off) | **Stand-in:** a 12 s "dwell" parked beside the stellar (N/nova_plugin/npc/npc_steering.ts:31-33, 171-200). NPCs never take off; they spawn scattered at genesis or jump in at the edge (N/nova_plugin/spawn/npc_spawn_plugin.ts:984-1000). | Landed duration; whether a landed ship takes off again or a fresh one does; the share of arrivals by take-off vs jump-in; the "lingers about 20 s beside" stops seen at Traffic Market (wave 5) vs real landings. Brief **T1**. | M |
| **In-system shuttles** (Flags3 0x0002 without a scoop: "shuttle back and forth between friendly stellars in the system") | B:2646-2650 | **Done (2026-11-24),** to R: "N2 wave 13" (never jumps; visits the friendly stellars, the uninhabited marker included; never an enemy's). N/nova_plugin/npc/npc_shuttle.ts; the AI 1/2 trader loop in npc_decision.ts picks a shuttle's stops with `shuttleStops` (every non-gate stellar not owned by an enemy govt, landable or not); when its stay is up it LANDS at the end of a stop (removed beside the stellar) instead of jumping out, and a respawned shuttle takes off from a stop (npc_spawn_plugin.ts `takeOffState`) instead of jumping in. Stock: shïp 391-394 in düdes 247-250. | The **guesses** below ("Shuttles and miners: guesses to measure"), the landing above all. | (done) |
| **Freighter cargo** (düde Flags 0x0001-0x0040 "carries food / industrial / ... / money"; flët 0x0001 random cargo) | B:840-847, B:924-925 | **Not plumbed:** D/dude_data.ts:23-24; D/fleet_data.ts:41-42. A boarded NPC yields its CargoComponent (N/nova_plugin/ship/boarding_component.ts:27-36), but spawned traders carry nothing. 29 stock düdes set carry flags; no stock flët sets 0x0001. | Amounts per flag (R20 covers money). | S |

### Asteroids

| behaviour | Bible | NovaJS status | unknown, to measure | size |
|---|---|---|---|---|
| **NPC mining** (Flags3 0x0001 destroys asteroids, 0x0002 scoops debris, with oütf ModType 31) | B:2645-2651, B:1900; röid YieldType/YieldQty B:2303-2315 | **Done (2026-11-24),** to R: "N1 wave 13" (closes on a rock, shoots it apart, flies over the debris, later jumps out). N/nova_plugin/npc/npc_mining.ts: an AI 1/2 hull with Flags3 0x0001 and a weapon with a reach shoots the nearest rock (mode 'mine', fired by npc_fire_control.ts: its asteroid-miner weapons if it has any, held until the rock is within reach and, for a fixed gun, under the nose); with 0x0002 and a scoop aboard it first flies over debris boxes (mode 'scoop'; ScoopSystem does the scooping); it departs at its ordinary time straight from mining; with nothing to mine (or a full hold) it flies the trader loop. Nothing was missing underneath: rocks take weapon damage and break into debris, and debris scoops into the hold (N/nova_plugin/combat/asteroid_plugin.ts). The Asteroid/Debris components moved to N/nova_plugin/core/asteroid_components.ts so the NPC brain can read them. | The **guesses** below; the AI 4 Zephyr variant (Flags3 0x0001 alone) was not run, so AI 3/4 hulls do not mine. | (done) |

### Combat AI

| behaviour | Bible | NovaJS status | unknown, to measure | size |
|---|---|---|---|---|
| **Warship hunting and MaxOdds** (AI 3) | B:865-866, B:1005-1023 | **Done, simplified.** N/nova_plugin/npc/npc_decision.ts:558-662 compares strength per pair; the Bible sums friends against enemies. | A6 in the catalogue. | — |
| **gövt 0x0010 retreat** | B:1061-1062 | **Done, fitted** (N/nova_plugin/npc/npc_retreat.ts:138; R: A waves 4-7). | The exact rule (A leftovers). | — |
| **Interceptor patrol** ("parks in orbit around a planet if he can't find any" enemies) | B:867-868 | **Approximation:** AI 4 circles its nearest landable stellar at 400 px in 45° steps and engages within 1800 px of itself or that stellar (N/nova_plugin/npc/npc_decision.ts:66-72, 663-738). | Does it really "park" (sit still) or circle? At what distance? Does an AI 4 ever leave the system? (NovaJS sends it out after 120-300 s like any NPC.) Brief **I1**; cheap to add to S1. | S |
| **Out of ammo: run away or dock** (shïp Flags2 0x0080) | B:2576-2577 | **Missing** (Flags2 not parsed apart from 0x0008/0x0020/0x0040: P/parsers/ship_parse.ts:344-397). 278 of 288 stock hulls set it. | "Dock" means land? Which ammo counts (all ammo weapons empty)? Brief **W1**. | S |
| **Swarming** (Flags2 0x0001) and **prefers standoff** (Flags2 0x0002) | B:2569-2570 | **Missing.** Every attacker uses one approach (`ATTACK_STANDOFF` 250 px, N/nova_plugin/npc/npc_steering.ts:42). Stock: 155 hulls swarm, 142 prefer standoff. | The geometry of each (range, orbiting, passes). Brief **W1**. | M |
| **AI afterburner** (shïp Flags 0x0040 "always has afterburner (for AIs only)"; përs 0x0002 "uses escape pod & has afterburner") | B:2521, B:2156 | **Missing:** neither flag is parsed for ships; NPCs never press afterburner. | When an AI uses it (pursuit, flight, always?). Brief **W1**. | S |
| **NPC cloaking** (Flags2 0x0100-0x4000: cloak on burst reload, when running, when hyperspacing, when flying around, stay cloaked until close, when docking, when preemptively attacked; mïsn ShipStart 2 "appear randomly, cloaked") | B:2578-2585, B:1445 | **Missing.** Cloak control is player input only (N/nova_plugin/ship/cloak_plugin.ts:293-306); ShipStart 2 is a documented gap (N/nova_plugin/missions/mission_ship_spawn.ts:47-48). 45 stock hulls carry cloak bits (Wraiths, Zephyrs, the Rebel "Cloaking" variants); 6 missions use ShipStart 2. R: "J wave 6" saw a stock-Wraith-flagged target cloak within 5 s of being fired on (0x4000). | Timing and reveal distance for each bit; whether "docking" is landing. Brief **C1**. | M |
| **përs traits:** grudge (0x0001), Aggress 1-3 (how close before attacking), Coward (flee % of shield), ShieldMod, extra weapons, escape pod (0x0002 / gövt 0x0100) | B:2094-2102, B:2129-2134, B:2153-2156; gövt 0x0100 B:1069 | **Spawning only.** N/nova_plugin/spawn/pers_plugin.ts:21-40 lists them as gaps (its "hailing and boarding do not exist" line is stale: both exist now). 148 of 516 stock përs hold grudges. | Aggress's ranges; whether Coward replaces gövt 0x0010; a grudge's memory across systems and saves (a per-player question in multiplayer). | M |
| **Escape pods** (shïp PodCount, decorative) | B:2535-2539 | **Missing** (not parsed). | Cosmetic only. | S |

### Boarding, assistance, hails

| behaviour | Bible | NovaJS status | unknown, to measure | size |
|---|---|---|---|---|
| **NPC plunder** (gövt 0x1000: warships plunder trader-type enemies, the player included, before destroying them) | B:1078-1079 | **Done**, with ruled guesses: N/nova_plugin/npc/npc_plunder.ts (rules; credits taken from a player :109), N/nova_plugin/npc/npc_plunder_board.ts:74. mïsn 0x8000 "fails if boarded by pirates" is wired (N/nova_plugin/encounters/boarding_plugin.ts:1479). | A9: do pirates board a disabled player, and what do they take? | — |
| **Bribes** (gövt 0x0200 / 0x2000 / 0x4000 / 0x8000) | B:1071-1086 | **Done**, numbers guessed: N/nova_plugin/reputation/hail.ts:64-104 (10% / 30% of cash, minimum 500), N/nova_plugin/encounters/hail_plugin.ts:233 (2 min reprieve). | R7 (price) and A8 (duration). | — |
| **Greetings and hail answers** (gövt CommName, greetings STR#, Flags 0x0400, Flags2 0x0001/0x0008) | B:1072, B:1088-1098, Appendix III | **Done** (ruling #297): N/nova_plugin/reputation/hail.ts. | — | — |
| **Request assistance: repair / refuel** (and Roadside Assistance, Flags2 0x0010; ränk 0x0800) | B:1099-1100, B:2261-2262 | **Done:** the helper flies over and restores armor, shield and fuel to full (N/nova_plugin/encounters/hail_plugin.ts:596-660; willingness N/nova_plugin/reputation/hail.ts:242-296). | How much the original restores (full, or one jump of fuel?). | — |
| **Battle assistance** (ränk 0x0400 "request battle assistance ... who will also call in reinforcements"; STR# 3000 "Help is on the way.", "I'm busy.") | B:2257-2260 | **Missing:** assistance is repair/refuel only; a willing warship does not fight the player's attackers. | Does a willing ship asked for help while the player is under attack engage the attackers? Brief **H1**. | S-M |
| **Hail info** (düde InfoTypes: good prices, disaster info, specific advice STR# 7500+, generic hails; përs 0x8000 disaster info) | B:832-839, B:2184 | **Not plumbed** (D/dude_data.ts:23-24). 130 of 147 stock düdes and 76 përs set it. | Where the text appears (the comm dialog's greeting?). One look at a stock trader's hail settles it. | S |
| **përs HailQuote / CommQuote / LinkMission** | B:2139-2185 | **Done:** N/display/ship_mission_offer_plugin.ts:418-570, N/spaceport/ship_mission_offer.ts:140-180. | — | — |
| **Fleet arrival quote** (flët Quote) | B:919-922 | **Not plumbed** (D/fleet_data.ts:41-42). No stock flët uses it (0 of 128). | — | S |
| **Rescue / refuel-a-ship missions** (ShipGoal 5, përs Flags2 0x0001 zero fuel) | B:1423-1427, B:2202 | **Done** for missions (N/nova_plugin/missions/mission_ship_spawn.ts, system holds). NPCs never help other NPCs. The Bible documents no NPC-to-NPC rescue. | (none documented) | — |

### Fleets, movement, misc

| behaviour | Bible | NovaJS status | unknown, to measure | size |
|---|---|---|---|---|
| **Fleets in formation** (flët lead + escorts) | B:885-925 | **Done and measured:** R: "F1n" waves 3 and 5 match (N/nova_plugin/npc/npc_formation.ts:44, N/nova_plugin/spawn/npc_spawn_plugin.ts:1105-1135). | Escorts defending their leader: measured in R: "P1 wave 13" (the guards attacked the player within about 4 s of its first hit on the lead) and applied (N/nova_plugin/npc/npc_targeting.ts `provokeFleet`: an aggressor recorded on a ship is recorded on its formation followers). Still unmeasured: whether a hit on an ESCORT draws the leader and the other escorts (NovaJS: no). | — |
| **Mission ship behaviour** (ShipBehav 0 attack player, 1 protect, 2 attack enemy stellars) | B:1431-1435 | **0 and 1 done** (R: Q1-Q4). **2 missing** (N/nova_plugin/missions/mission_ship_spawn.ts:62-63); no stock mission uses it (0 of 791). | — | M, low value |
| **Nav-default starts** (ShipStart -1..-16) | B:1441-1449 | **Missing:** ships are scattered instead (N/nova_plugin/missions/mission_ship_spawn.ts:50-51). 11 stock missions use it. | — | S |
| **Hypergate / wormhole preference** (gövt Flags2 0x0020 never, 0x0040 prefer gates, 0x0080 prefer wormholes) | B:1101-1106 | **Missing:** NPCs only leave by jumping; wormholes are excluded from destinations (N/nova_plugin/npc/npc_decision.ts:145-161). Most stock govts set 0x0020; Pirate and others 0x0080; Rebellion 0x0040. | How an NPC uses a gate (flies in and vanishes?). | M |
| **Derelicts** (gövt 0x0800) | B:1075-1077 | **Done** (N/nova_plugin/spawn/npc_spawn_plugin.ts:930). | — | — |
| **Defensive perimeter** (Speed 0 + Accel 0 warship rings the first stellar) | B:2357-2360 | **Missing**; no stock hull has Speed 0, so plug-ins only. | — | S, low value |
| **Surrender / NPC begging** | Not in the Bible. Beg For Mercy is the player begging a hostile. STR# 3000 165-179 ("Here, take it and go!") read like an NPC paying the player off. | — | **Guess:** an unused or EV-legacy group. Nothing in the Bible or the comm dialog triggers it. | — |

## Recommended order

The order weighs Matthew's ask, how often the behaviour shows in stock play,
and how much NovaJS already has to build on. Each step names the
reference-Mac experiments to run first. Briefs follow.

1. **Contraband scanning**, including mission 0x0020 and SmugPenalty
   (S1, S2, S3, and I1 as a free control). This is Matthew's first example,
   and AI 4 traffic is in nearly every system.
   - **Data first:** carry ScanMask on jünk and oütf (D/junk_data.ts,
     D/outfit_data.ts and their parsers) and SmugPenalty into the reputation
     plugin.
   - **Dependency:** the consequences should share the A14 "who enforces
     here" rule now being reworked in reputation/.
   - **Multiplayer:** a scan is per player (cargo, outfits, credits and
     records are each player's own), so it is an NPC decision against one
     player ship plus a per-player event.
2. **Shuttles, and real landing and take-off for traffic** (T1, N2).
   **Shuttles done 2026-11-24** (see the inventory row); real landing for
   ordinary traffic is still open.
   - The shuttle is small: parse Flags3, give shuttle hulls a trader loop
     that never departs and only picks friendly stellars.
   - Real landing (vanish, later take off) replaces the dwell stand-in, and
     needs a respawn-from-stellar path beside `jumpInState`.
3. **Mining** (N1), **done 2026-11-24** (see the inventory row): an AI 1/2 mode, chosen by Flags3 0x0001/0x0002 plus a
   scoop. It targets the nearest AsteroidComponent, fires until it breaks,
   then steers over DebrisComponents.
   - Shared state: rock health and debris are already shared-sim state.
   - Sequence: build it after the measurement and after step 2, because
     what a miner does when full is probably "land".
4. **Piracy police, distress calls and 0x0020 nosy-ignore** (P1), **done
   2026-11-24** (P1 waves 13-14; see the inventory rows). Still open: who
   answers a distress call. (Fleet escorts defending their leader is done:
   P1 wave 13.)
5. **Hull AI flags** (W1, C1):
   - **cheap, common:** out-of-ammo flee (278 hulls), AI afterburner;
   - **bigger:** swarm (155) and standoff (142);
   - **NPC cloaking** (45 hulls, 6 missions), with its own runtime rules.
6. **Battle assistance and hail info** (H1, plus one look at a stock
   trader's hail for InfoTypes). Both extend the existing hail dialog.
7. **Reinforcements and planet defence fleets / tribute** (R19, R18 in the
   catalogue; #353). These are large, already catalogued, and mostly about
   attacking planets. They come after the traffic behaviours above.
8. **përs traits** (grudge, Aggress, Coward, ShieldMod, weapons, pods).
   Grudges need a per-player ruling for multiplayer.
9. **Last:** hypergate/wormhole preferences, nav-default ShipStart,
   ShipBehav 2, fleet Quote and the zero-speed perimeter. Stock data barely
   uses them.

### Contraband scan: guesses to measure

The scan (N/nova_plugin/npc/contraband*.ts) follows S1/S2 and wave 14
where they measured something. Everything below not marked MEASURED is a
sensible default, marked GUESS in the code, and wants a reference run:

1. **Who scans:** any AI 4 of a govt with a non-zero ScanMask, only where
   that govt ENFORCES (owns the system, is allied with the owner, or is
   nosy: local_law.ts's enforcesHere). Measured for the owner and (wave
   14) a nosy govt in another govt's system; an ally not yet.
2. **Who is scanned:** player ships only; NPCs and the player's escorts
   are never scanned. A pilot who is already a criminal here is attacked,
   not scanned (B:977-980).
3. **Seek range 3000 px, scan range 150 px,** the approach at top speed,
   the scan instant. Measured: "within about 3 s", "a cutter beside the
   player".
4. **Rescans:** MEASURED (wave 14, applied): once per stay between two
   arrivals by jump, by anyone; a landing does not start a new visit.
   Still a guess: a hull bought at the port keeps the marker.
5. **ScanFine 0 and -N:** MEASURED (wave 14, applied): both are the
   detection line without its fine sentence and no money; SmugPenalty is
   still charged. The Bible's "N% of cash" is not what 1.1.1 does. Still
   guesses: a fine never takes more than the pilot has; the fine is
   printed without a thousands separator.
6. **Jünk:** MEASURED (wave 14, applied): "your attempt to smuggle
   <LCName> through this system", ScanFine AND SmugPenalty.
7. **S3:** MEASURED for ScanMask 0 (wave 14): a 0x0020 mission fails
   only on a scan that finds its cargo illegal. Still guesses: a mission
   with no cargo at all is illegal while active, one with cargo only once
   it is aboard.
8. **Several finds in one scan:** every flagged mission fails, one fine is
   charged, one record change (outfit or jünk), the line names the outfit
   (else the jünk, else "illegal cargo"; the mission line only when
   nothing else was found).
8a. **After a detection** (wave 14, applied: the scanning govt's hunters
   attack until a landing, whatever its CrimeTol): a scan that only fails
   a 0x0020 mission is no detection; never-attacks and a ränk 0x0100
   suppress the hostility as they do a criminal record.
8b. **SmugPenalty by the A14 rule** (wave 14, applied): an ALLY of the
   owner as the scanner charges its own SmugPenalty; a nosy scanner in an
   independent system changes no record.
9. **A clean scan** (the hold emptied en route) marks the ship and says
   nothing; STR# 2002 #389 "Have a nice day." may belong there.
10. **The scanner's name** on the line is the target pane's (a përs's or
    mission ship's own name, else the ship class); the pilot's is the
    profile name.

### Shuttles and miners: guesses to measure

The shuttles (N/nova_plugin/npc/npc_shuttle.ts) and miners
(N/nova_plugin/npc/npc_mining.ts) follow N2 and N1 where they measured
something. Everything below is marked GUESS in the code and wants a
reference run:

1. **A shuttle lands.** When its ordinary stay (120-300 s) is up it is
   removed at the end of a stop, and a respawn takes off from a stop. N2
   saw no jump in 584 s and could not tell a landing from discs
   overlapping over the port. The landing is there because a shuttle that
   never leaves would, in mixed traffic (stock Sol: 30% shuttles), slowly
   take every traffic slot. To measure: a long watch (20+ min) of a
   mixed-traffic system, counting shuttles; or a lone shuttle in a
   system whose stellars are all on screen.
2. **Which stellars are stops:** every stellar not owned by an enemy of
   the shuttle's govt, uninhabited and non-landable ones included
   (measured: the marker, medium confidence), but no hypergate or
   wormhole (the rig had none). An allied or neutral govt's port counts.
3. **A shuttle with one stop** goes back to it; **with none** (every
   stellar an enemy's) it jumps out like a trader, and a respawn jumps in.
4. **A shuttle that is attacked** flees like any AI 1 trader, which can
   end in a jump out at the rim. N2 had no attacks.
5. **Only düde respawns** take off from a stop; a përs or a fleet with a
   shuttle hull still jumps in. Genesis shuttles are scattered like other
   traffic.
6. **Who mines:** AI 1 and AI 2 hulls with Flags3 0x0001 (the stock
   Asteroid Miner). An AI 4 Zephyr (Flags3 0x0001, AI 4 düdes 200/201)
   keeps the interceptor brain: N1's AI 2/3/4 variants were not run.
7. **The miner's numbers:** rocks within 3000 px, debris within 800 px,
   debris before rocks, a standoff of 0.6 of its shortest weapon reach,
   firing a fixed gun only within 0.25 rad of the rock. Which weapons
   fire: its asteroid-miner weapons (wëap Flags2 0x8000) if it has any,
   otherwise guns, beams and turrets, never guided weapons or bays.
8. **How long a miner mines:** until its ordinary departure time, then it
   jumps out straight from mining (N1: 39 jump-outs; how long each stayed
   was not separated). Whether it lands its haul instead was not seen.
9. **A full hold:** a scooping miner whose hold is full stops mining and
   flies the trader loop until it departs.
10. **T1:** traders park about 45 s on the original (including the
    approach) against NovaJS's 12 s dwell; left alone after one run.

### Piracy police and distress calls: guesses to measure

The piracy police (N/nova_plugin/npc/piracy_police.ts) and distress calls
(N/nova_plugin/npc/distress.ts) follow P1 waves 13-14 where they measured
something. Everything below is marked GUESS in the code and wants a
reference run:

1. **Watching range:** 1800 px (the interceptor's engagement range) from
   the victim OR the attacker. The reference police sat a few hundred px
   from both. To measure: run 1 of the P1 brief with the police at 300 /
   1000 / 2500 px.
2. **Only player-side attackers are policed.** The wave-14 raid watch could
   not tell whether police reacted to raiders attacking traders. To
   measure: raiders of a govt neutral to the police attacking a trader
   beside a nosy police ship, with the player far off.
3. **Only firing counts, not boarding.** Wave 13's board drew nothing from
   non-nosy police; nosy police were not tested with a board.
4. **Every hit that provokes the victim provokes the witnesses,** stray
   player hits included.
5. **Self-defence is not piracy:** no witness reacts to hits on a victim
   that is attacking the player (in attack posture on him, or it shot him
   within 30 s). To measure: a ship of a govt hostile to the player
   attacks him beside nosy police, and he fires back.
6. **Alliances:** a one-way alliance counts (the A14 enforcement rule;
   only a two-way one was measured), and 0x0020 does not shield a victim
   from its own or an allied govt's police.
7. **The police never defend against an attacker of their own or an
   allied govt** (a player's escort of that govt).
8. **Distress rate:** at most one call per ship per 20 s, the first at the
   first hit. Measured: lines lasted about 21-25 s, several a minute in a
   melee.
9. **Who calls:** AI 1 and AI 2 traders (only AI 1 was measured), under
   NPC attack only (none seen in four runs with the player attacking: low
   confidence). Warships never call.
10. **Nobody answers** a distress call. NovaJS's status line holds a line
    8 s and fades it over 4 s, not the original's 21-25 s.

## Reference-Mac briefs

All of these use the existing tool chain: `kits/testkit.mjs` (a new
`wave9Resources` block), `pilot-make`, scenario JSON, and the
`analysis/` helpers (`radar_blips.mjs --tracks`, `discs.mjs`, `planet_track.mjs`
message crops, pilot diffs).

Kit constraints that shape these briefs (from `scripts/novaref/README.md`):

- `pilot-make` can write the six standard commodities but **not jünk**. A
  pilot gets contraband one of three ways: an illegal **outfit** (pilot
  `outfits`); buying a kit jünk at Kit Port inside the scenario; or extending
  `pilot_write.ts` with jünk quantities (novaparse already reads them for the
  pilot import).
- Mission cargo comes from an AvailLoc 3 mïsn offered on landing, unlocked
  by a mission bit.

Ids below are suggestions; check them against the kit's free ranges.

### S1: who gets scanned, when, and what it says

**Kit:**
- **Govt:** gövt "Kit Customs" with ScanMask 0x0001, ScanFine 500, SmugPenalty
  50, CrimeTol 10, MaxOdds 1000, no classes.
- **Interceptors:** a düde of AI 4 Kit Disc Red (trackable) of that govt.
- **Systems:** two linked systems, "Kit Scan Gate" (empty) and "Kit Scan
  Range" (owned by Kit Customs, Kit Port clone at (0,0), traffic: that düde,
  avgShips 2). Linked so the player can **arrive by jump** ("incoming
  ships").
- **Contraband:** oütf "Kit Contraband Pod" (ScanMask 0x0001, no ModType
  effect, mass 0) and jünk "Kit Contraband" (ScanMask 0x0001) sold at the
  Kit Port clone.

**Pilots:**
- clean;
- with the pod;
- record -500 in Kit Scan Range (the "already criminal" case).

**Runs** (record 120 s each; shots every 2 s; status-line crops):
1. The clean pilot jumps in from Kit Scan Gate and sits still.
2. The pod pilot does the same.
3. The pod pilot starts in Kit Scan Range beside the port (Enter Ship, no
   jump).
4. The pod pilot lands, buys nothing, takes off.
5. The pod pilot flies away at full speed as soon as an interceptor turns
   towards it.
6. The criminal pod pilot jumps in.
7. The pod pilot sits in the system for 5 minutes: does it get rescanned?

**Watch:**
- the interceptor's track relative to the player (`discs.mjs`): range, a
  pass or a hold alongside, the time from arrival to scan;
- every status line, in order (match against STR# 2002 373-389);
- credits and the Kit Scan Range record (pilot diff);
- whether the interceptor's brackets turn red, and whether it fires;
- whether the clean pilot is scanned at all, and what it is told.

### S2: what a scan does to mission cargo and SmugPenalty

**Kit:** on top of S1, two AvailLoc 3 mïsn at the Kit Port clone, unlocked
by bits. Both carry 1 ton of cargo to Kit Market with ScanMask 0x0001.
- Mission A has Flags 0x0020.
- Mission B does not.
- Give both a CompGovt/CompReward, so a failure's record hit shows.

**Runs:** accept each, take off, wait for a scan.

**Watch:**
- the failure message (STR# 2002 #285);
- the mission state after landing;
- every govt's record in the pilot diff (SmugPenalty: which govt, which
  system);
- whether ScanFine 500 is charged on top.

**Repeat with ScanFine 0** (the stock value): warning only?

### S3: does any scan fail a 0x0020 mission?

**Kit:** S2's mission A, with the scanner govt's ScanMask set to 0x0002, so
it does not match the cargo's 0x0001.

**Watch:** whether the interceptor still buzzes the player, and whether the
mission fails.

**Also:** run once with the illegal pod and a matching jünk. Does the
message name the item ("your possession of" vs "your attempt to smuggle")?

### I1: what an idle interceptor does

**Run:** with no contraband and no enemies, track the S1 interceptors for
300 s.

**Watch:**
- whether they sit still near the stellar ("parks in orbit") or circle;
- the distance from the stellar;
- whether they ever land or jump out.

This is the S1 clean run, extended. NovaJS today circles at 400 px and
departs after 120-300 s.

### T1: the life cycle of ordinary traffic

**Kit:** Kit Traffic Range (sÿst 2000, AI 1 disc traffic, Traffic Port and
Traffic Market) with avgShips raised to 6. Add one uninhabited marker and
one stellar of a govt hostile to the traders.

**Runs:** two of 600 s each, the player parked between the stellars (the
radar covers both).

**Watch** (`radar_blips.mjs --tracks`):
- per ship: does it arrive by jump-in or by take-off from a stellar?
- the landed duration (from the blip vanishing on a stellar to one
  appearing there);
- the stops alongside without landing (wave 5's ~20 s);
- whether the hostile or uninhabited stellar is ever visited;
- the total time in the system, and how it leaves.

### N2: in-system shuttles

**Kit:** T1's system, with traffic of an AI 1 trackable disc hull that has
Flags3 0x0002 and no scoop. **Control:** the same düde without the flag.

**Run:** 600 s, twice.

**Watch:**
- whether shuttles ever jump out;
- which stellars they use: own govt, the hostile stellar, the uninhabited
  marker;
- whether they land or only stop alongside.

**Optionally:** a stock check in Nesre Secundus (sÿst 133: Pyrogenesis and
Sigma shuttles, 20% + 10% of 5 ships) with a stock pilot sitting there.

### N1: does the Asteroid Miner mine?

**Kit:** "Kit Mine Range" (Kit Rock Range clone, Asteroids 16, AstTypes
metal only) with traffic of a trackable copy of shïp 379:
- Flags3 0x0003;
- DefaultItems the stock Asteroid Scoop (oütf 271) and its stock gun;
- one düde for each of AI 1, AI 2 and AI 3.

Add a variant hull with Flags3 0x0001 only, in an AI 4 düde (the Zephyr
case).

**Runs:** 300 s per variant, the player parked and passive.

**Watch:**
- whether the miner turns towards rocks and fires at them (trail pictures,
  the rock count);
- whether it steers over the resource boxes;
- how long it stays, and whether it lands, jumps, or keeps mining;
- whether the 0x0001-only interceptor shoots rocks while idle.

**Optionally:** a stock look, with a pilot parked in a system that lists
düde 132 (Archenar, sÿst 142: 32% of 2 ships).

### P1: piracy police, distress calls, nosy-ignore, escorts defending a leader

**Kit:**
- **Police:** an AI 4 trackable disc of a neutral govt A.
- **Victims:** AI 1 traders of govt B, no relations with A. A variant B'
  sets gövt 0x0020; another variant sets Flags2 0x0008.
- **Raiders:** AI 3 of govt C, an enemy of B only (B and C share an enemy
  class).
- **A fleet:** a flët lead with two escorts, of govt B.

**Runs:**
1. **The player shoots a trader** with the Kit Tickler, the interceptor at
   300 / 1000 / 2500 px.
2. **The player disables and boards a trader** (a disableable hull) while
   the interceptor watches.
3. **Raiders attack traders** while the player only watches.
4. Run 1 with **B'** (0x0020).
5. Run 1 with **0x0008** (no distress).
6. **The player tickles the fleet lead** and watches its escorts.

**Watch:**
- the interceptor's reaction: red brackets, attack, distance;
- the player's records with A and B (pilot diff);
- any distress line (STR# 5003), who sends it and how often;
- whether any other ship (B warships, A interceptors) comes to help;
- the escorts' reaction to an attack on their lead.

### W1: hull AI flags

**Kit:** hostile (gövt 0x0004) AI 3 trackable discs, each with one flag.

**Variants:**
- **(a)** Flags2 0x0080 with only an ammo-limited missile (5 rounds);
- **(b)** Flags2 0x0001, a group of four (swarm);
- **(c)** Flags2 0x0002 (standoff), against a control without it;
- **(d)** shïp Flags 0x0040 plus an afterburner outfit.

**The player:** Kit Lancer Heavy, passive.

**Watch:**
- **(a):** what happens when the ammo is gone: flee, jump, or fly to the
  stellar and land ("dock")?
- **(b, c):** the attack geometry (`discs.mjs`: range distribution, passes
  vs circling);
- **(d):** speed spikes and when they happen.

### C1: NPC cloaking

**Kit:** the working stock-cloak target from J wave 6 (Cloak Target W,
shïp 798: stock Wraith Cloaking Device oütf 266). Make one copy per Flags2
cloak bit: 0x0100, 0x0200, 0x0400, 0x0800, 0x1000, 0x2000, 0x4000. Put the
0x1000 copy on an AI 3 hostile, so it has a target to close on. Add one
mïsn with ShipStart 2.

**Watch:**
- the target panel and radar for when each copy cloaks and uncloaks;
- for 0x1000, the distance at which it uncloaks;
- for ShipStart 2, whether the ship is cloaked from the first frame.

### H1: battle assistance

**Kit:** gövt 362 raiders attacking the player beside a neutral AI 3 warship
and a neutral AI 1 trader (Kit Range).

**Runs:** hail each and press Request Assistance.

**Watch:**
- the answer line (STR# 3000 75-89 / 145-149 / 180-184);
- whether the warship then attacks the raiders or only comes alongside;
- what it restores.

**Repeat** with a ränk 0x0400 for the warship's govt, granted by a mission
bit: does it call reinforcements?

## Notes for whoever implements these

- Everything in the Bible's NPC model is per government and per AI type.
  Scanning, police and distress all need to know **who is near whom**, so
  they can share one per-tick spatial pass (in sim, deterministic, uuid
  tie-breaks), not one query each.
- Consequences land on a **player** (fine, record, mission failure). In
  multiplayer they must go to the scanned player's own components and
  records, the same way NPC plunder takes credits from the plundered player
  only (N/nova_plugin/npc/npc_plunder_board.ts:51-62).
- Every number the measurements leave open should be a named constant
  marked as a guess, as npc_retreat.ts does.
