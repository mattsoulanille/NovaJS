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
N/nova_plugin/npc/npc_steering.ts:31-33). (Since 2026-11-24, to R: "Shuttles
and T1 traders, wave 15": one 15 s park at one non-enemy port, then out;
the original's traffic never lands.) So traffic looks like trading
today, but:

- shuttle hulls are not told apart: they leave like any trader, and
  "friendly" stellars are not checked;
- nobody lands for real: the ship never vanishes and never takes off again.

Neither game moves goods. Nothing in the Bible says NPC trading changes
prices; düde Flags 0x0001-0x0040 only decide what a plundered ship yields
(B:840-847). Size **S** for the shuttles; **M** for real landing and
take-off. **Since 2026-11-24 shuttles shuttle** (R: "N2 wave 13"; see the
inventory row). Real landing is not wanted after all: wave 15 saw no
trader or shuttle land in 32 minutes of watching (R: "Shuttles and T1
traders, wave 15").

## Inventory

### Law and policing

| behaviour | Bible | NovaJS status | unknown, to measure | size |
|---|---|---|---|---|
| **Contraband scan by AI 4** ("buzzes incoming ships to scan them for illegal cargo") | B:867-868 (AI 4); gövt ScanFine B:977-986, SmugPenalty B:987-988, ScanMask B:1116-1119; jünk ScanMask B:1168-1173; oütf ScanMask B:2027-2032; mïsn ScanMask B:1364-1367; status strings STR# 2002 374-379, 392-393, 285 | **Done (2026-11-24),** to the S1/S2 measurements and waves 14-15 (R: "S1 / I1 wave 11", "S1 and S2 wave 12", "Contraband wave 14", "A14 / contraband wave 15"). Rules: N/nova_plugin/npc/contraband.ts; who is buzzed and the scanned marker: contraband_target.ts; the scan: contraband_scan.ts (ContrabandScanSystem); AI 4 decision case 4 in npc_decision.ts, mode 'scan' steered in npc_steering.ts; the status line: N/display/status_bar_content.ts `contrabandScanMessage`. An AI 4 of a govt with a ScanMask that enforces here (local_law.ts) flies at an unscanned, non-criminal PLAYER ship within 3000 px that carries something illegal to it, and scans it within 150 px. Illegal outfit: "…your posession of a <LCName> has been detected. You have been fined N credits.", ScanFine, SmugPenalty. Illegal jünk: "…your attempt to smuggle <LCName> through this system…", ScanFine, SmugPenalty. Plain mission cargo: "…your attempt to smuggle illegal cargo through this system…", ScanFine, no SmugPenalty. ScanFine 0 and below: no fine, no fine sentence (not the Bible's percent of cash; Matthew 2026-11-24: match the original). SmugPenalty by the A14 rule: the owner or its ally scanning costs the scanner's SmugPenalty, anyone else (nosy) raises the record by half the owner's; no spread. A detection turns the scanning govt's hunters on the pilot until he lands or leaves, whatever its CrimeTol. One scan per stay between arrivals by jump, unless the ship carries contraband its last scan did not find (the marker remembers what it found): a landing does not reset it, but taking off with new illegal cargo brings a rescan (wave 15). Several finds: one line naming the hold's cargo before an outfit (the jünk over the pod, measured), one fine, one record change; a 0x0020 mission among them fails silently. An ally of the owner scanning charges its own SmugPenalty (measured, wave 15). A 0x0020 mission fails only on a scan that finds its cargo illegal. A CLEAN ship is approached and scanned too, once a visit, in silence, and the interceptor sits on any ship it has scanned for 30 s (wave 16; the 30 s is a GUESS). A fine above the pilot's cash takes all the cash and no more, and the line names the whole ScanFine with a thousands separator ("fined 5,000 credits", wave 16). Per player: each pilot is scanned, charged and told separately. Status bar: jünk shows on the "Special:" line by its Abbrev when no mission cargo is aboard, never as a commodity row (wave 15). | Guesses left below ("Contraband scan: guesses to measure"): plain mission cargo vs an outfit on the line, contraband gained in space, how long the interceptor sits on a scanned ship, the unimplemented "prepare to be scanned" line. | (done) |
| **Mission fails if scanned** (mïsn Flags 0x0020) | B:1550; STR# 2002 #285 | **Done:** a scan that finds the mission's cargo illegal fails it ("Your ship has been scanned - mission failed."), no fine, no record (R: "S1 and S2 wave 12"), not even the CompGovt's -R/2 of CompReward (6b38f9bf: the sim marks the failure `failCause` 'scan', and compRewardDelta's 'scanned' outcome is 0). ScanMask and the flag are frozen onto the ActiveMission at accept (mission_accept_offer.ts). | Does ANY scan fail it, or only a matching one? (S3.) **51 stock 0x0020 missions have ScanMask 0**, so they can never fail by scan under the current reading. | (done) |
| **SmugPenalty** (record loss when detected smuggling) | B:987-988 | **Done** for an illegal OUTFIT and illegal JÜNK, as measured (waves 11-15): the record of the system the scan happened in (records are per system since ruling #380; no spread), by the A14 rule (the owner or its ally scanning: minus the scanner's SmugPenalty; a nosy scanner elsewhere: plus half the owner's). Not for mission cargo (measured). | A nosy scanner in an independent system (guess: no change). | (done) |
| **Piracy police** (AI 4 attacks "any ship that fires on or attempts to board another, non-enemy ship while the interceptor is watching") | B:868-871 | **Done (2026-11-24),** to "P1 wave 13" and "P1 wave 14" (R). N/nova_plugin/npc/piracy_police.ts (`policeDefendVictim`, `piracyWitnesses`), called from NpcAggressionSystem (N/nova_plugin/npc/npc_targeting.ts) through the same `provoke` / `provokeFleet` path a hit uses. When a PLAYER-side ship attacks an NPC, every AI 4 within 2500 px (wave 16: the measured lower bound) of the victim or the attacker records the attacker as its aggressor if its govt defends the victim: a NOSY govt (gövt 0x0002) for any non-enemy victim without 0x0020; any govt for its own or an ally's ship (local_law.ts's `alliedEitherWay`). The record lasts until the attacker leaves the world (lands, jumps, dies): measured in "P1 wave 15" (still hostile after 60 s, gone after a jump out and back; pinned in 9e56b637). Non-nosy police ignore an unrelated victim (wave 13). No record change. A hostile's posture is no excuse (wave 16: a non-firing 0x0004 raider shot by the player still drew nosy police); only a victim that has SHOT the attacker is exempt (GUESS). NPC raiders are not policed (MEASURED, wave 16); the victim's own and allied WARSHIPS defend it instead (N/nova_plugin/npc/allied_defenders.ts, see the distress row). | The **guesses** below ("Piracy police and distress calls: guesses to measure"). | (done) |
| **Nosy-ignore** (gövt 0x0020: "Nosy ships of other non-allied governments ignore ships of this govt that are under attack") | B:1063-1064 | **Done (2026-11-24)** with the piracy police: nosy police ignore an attack on a ship whose govt sets 0x0020 (R: "P1 wave 14", finding 2). "Nosy" is gövt 0x0002 (measured). It does not shield a victim from an ALLIED govt's police (measured: R "P1 wave 15", finding 2, pinned in 9e56b637), nor, by the Bible's "non-allied", from its own govt's (GUESS). | The own-govt case with 0x0020 (untested). | (done) |
| **Nosy enforcement** (gövt 0x0002: attacks a criminal player in non-allied systems) | B:1055-1058 | **Done** (13567336, ruling #376; per-system records since ruling #380): N/nova_plugin/reputation/local_law.ts. A govt enforces where it owns the system, is allied with the owner either way, or is nosy; it attacks when the player's record IN THE CURRENT SYSTEM is below its own CrimeTol (R: "A14", "A14 wave 5": all 21 cells, c2 included). | — | (done) |
| **Legal records per system, the crime spread, the Good Citizen reward** (B: "your legal status in a system", Appendix II; gövt Disab/Board/KillPenalty, InitialRec) | B:977-1004, 3473-3500; chär Status1-4 B:519-524 | **Done (2026-11-24, rulings #380 and #379):** N/nova_plugin/reputation/system_records.ts. The record is kept per sÿst; an absent entry reads as the system's status govt's InitialRec (gövt 128 when independent). A kill (Disab + Kill), disable or boarding in system S changes every system T S reaches over hyperlinks, n jumps out: each penalty field scaled by 0.65^n and truncated; the victim's scaled fields off T's record when the victim is T's owner's or an ally's ship, else half T's OWNER's scaled fields ON (the #379 reward). The walk goes by map position (stacked systems are one place). CompReward is govt-wide (every system of the CompGovt; +R/2 allies', -R/2 enemies' and xenophobes'); failure / abort hits every CompGovt system. Smuggling stays in its system. Saves v6 (old per-govt records seed each system by its status govt); the original-pilot importer maps the file's per-system values straight across. | Guesses below ("Legal records per system: guesses to measure"). An unowned neighbour takes minus a quarter of the victim's scaled fields (R: "A14 / contraband wave 16": -76 / -49 / -20, applied). | (done) |
| **Distress calls** (ships "send distress messages" unless gövt Flags2 0x0008) | B:1095-1098; stock STR# 5003 "Ship Help Messages" ("Mayday, Mayday! We're under attack! ...", 20 lines) | **Done (2026-11-24)**, to "P1 waves 14-16" (R): a NON-MISSION trader (AI 1/2) hit in an attack by an NPC that is not on a player's side sends "<ship name>: <random STR# 5003 line>" to the status line of every player in the system, at most once per 8 s per ship (the life of one line), never when its govt sets Flags2 0x0008 or its hull inherits it. Mission ships never call (wave 16: seven silent mission victims). N/nova_plugin/npc/distress.ts (rules, DistressCallEvent), NpcAggressionSystem (the trigger and the PRNG draw), N/display/status_message_plugin.ts `ShowDistressCallMessage` (the line; 8 s, then cleared at once, no fade). **Nobody answers a call** (MEASURED, wave 16): the help comes from the alliance, call or no call: the victim's own govt's warships join against its NPC attacker at once, an allied govt's after 20 s (N/nova_plugin/npc/allied_defenders.ts; unrelated warships and police, nosy or not, ignore it). The player's own victims never call: measured in five runs (R "P1 wave 15", finding 1; pinned in 9e56b637). | Whether AI 4s of the own or an allied govt defend (GUESS: yes); the defenders' range (none) and the ally's delay (one run). Guesses below. | (done) |
| **Reinforcement fleets** (sÿst ReinfFleet, called in when allied ships are losing past MaxOdds) | B:3050-3060; ränk 0x0400 "call in reinforcements on the player's behalf" B:2257-2260 | **Parsed only:** D/system_data.ts:34-45. 344 of 545 stock systems have one. | R19 in the catalogue: trigger, delay (ReinfTime), cooldown (ReinfIntrval), the "Sensors detect xxx reinforcement fleet approaching." line. | M |
| **Planet defence fleets and tribute** (spöb DefenseDude/DefCount, in waves) | B:2823-2836 | **Parsed only:** D/planet_data.ts:34-40 (tracker #353). 289 of 411 stock stellars have one; their düdes are mostly AI 3 (16), some AI 4 (4). | R18 in the catalogue. | L |

### Traffic, trading, landing

| behaviour | Bible | NovaJS status | unknown, to measure | size |
|---|---|---|---|---|
| **Traders visit stellars** (AI 1 "visits planets and runs away when attacked"; AI 2 fights back) | B:861-864 | **Done (2026-11-24),** to R: "T1 wave 13", "T1 / N1 wave 14" and "Shuttles and T1 traders, wave 15". An AI 1/2 trader jumps in, flies to ONE port and parks beside it for 15 s (`TRADER_DWELL_MS`, N/nova_plugin/npc/npc_steering.ts; measured median 15.2 s over 70 parks), then jumps out (npc_decision.ts trader loop; its 120-300 s departure roll no longer applies). Its destinations (`traderDestinations`, npc_decision.ts) are the landable non-wormhole ports not owned by an enemy of its govt, one uniform draw: own and neutral govts' ports alike (measured 21 / 25 / 24), never the enemy's, never an uninhabited marker. A held ship (system_hold.ts) goes on to another port instead of leaving. Flee and fight-back: R: A7, A wave 7 (applied). | The **guesses** below ("Shuttles and miners: guesses to measure", 10-12): AI 2 makes one stop like AI 1; a fixed 15 s park; wave 14's unvisited Market (1000 px out). | (done) |
| **Real landing and take-off** (traffic vanishes on a stellar and later takes off from one) | Not in the Bible; seen in R: "A-series wave 5" (ships converge on Traffic Port and vanish; one appears beside the Port and flies off) | **Not what the original does** (R: "T1 wave 13", "T1 / N1 wave 14", "Shuttles and T1 traders, wave 15": in 32 minutes of colour-tracked traffic no trader or shuttle vanished on a stellar or appeared from one; every ship arrived by jump-in). NovaJS's park beside the stellar (`dwell`) is the measured behaviour, not a stand-in. NPCs spawn scattered at genesis or jump in at the edge (N/nova_plugin/spawn/npc_spawn_plugin.ts `jumpInState`). Wave 5's "vanish" was ships hidden in the stellar's radar square. | — | (done) |
| **In-system shuttles** (Flags3 0x0002 without a scoop: "shuttle back and forth between friendly stellars in the system") | B:2646-2650 | **Done (2026-11-24),** to R: "N2 wave 13" and "Shuttles and T1 traders, wave 15". N/nova_plugin/npc/npc_shuttle.ts; the AI 1/2 trader loop in npc_decision.ts. A shuttle arrives like any traffic (genesis scatter, or a respawn's jump-in) and then NEVER LEAVES: no jump out, no landing, whatever its departure roll. It keeps ONE LANE between two of its stops (`shuttleStops`: every non-gate stellar not owned by an enemy govt, landable or not, the uninhabited marker included): the first stop is one draw, the other end the stop nearest to it (`shuttleLaneEnd`; measured in R: "Shuttles wave 16", a tie one more draw), and it flies back and forth, turning 70 px short of each centre towards the other end (`shuttleTurnPoint`) after a 4 s pause (`SHUTTLE_DWELL_MS`; measured median 3.7 s). On a lane too short for two turn points (under about 170 px here, about 150 px measured) it stands still between the stellars: a pausing shuttle brakes to a standstill (`SHUTTLE_REST_SPEED`). With ONE stop it visits it once (6 s, `SHUTTLE_ONE_STOP_DWELL_MS`) and jumps out; with none it jumps out at once (wave 16). The lane is NpcState `laneEnd`. So the shuttles a system's respawns draw hold their slots for good and, as the other traffic leaves, fill the system (as measured: avgShips 6, half shuttles, no trader after 2 minutes). Stock: shïp 391-394 in düdes 247-250 (17 systems). | The **guesses** below ("Shuttles and miners: guesses to measure"). | (done) |
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
| **Interceptor patrol** ("parks in orbit around a planet if he can't find any" enemies) | B:867-868 | **Approximation:** AI 4 circles its nearest landable stellar at 400 px (npc_steering.ts `steerOrbit`) and engages within 1800 px of itself or that stellar (N/nova_plugin/npc/npc_decision.ts, case 4). **Stays (2026-11-24):** an AI 4 of ordinary traffic never leaves on its departure roll (R: "Stock Sol, wave 16": three Fed interceptors stayed 21+ minutes while an AI 3 destroyer left within 5; applied in 4e5a888e); only a `passingThrough` one (a released mission ship, a përs sent on its way) leaves on its clock. So a system's slots end up with interceptors as well as shuttles and the traffic freezes, as in the original (NovaJS's stock Sol: six or seven AI 4 and none or one shuttle by 4-16 minutes; the original's: three AI 4, two shuttles and a miner by 5). | Does it really "park" (sit still) or circle? At what distance? "AI 4 never leaves" rests on one run (three ships); do mission-spawned goal-less AI 4 ships stay too (here they do, like their düde)? Brief **I1**; cheap to add to S1. | S |
| **Out of ammo: run away or dock** (shïp Flags2 0x0080) | B:2576-2577 | **Done, first pass (2026-11-24),** to R: "W1 / C1 / H1 wave 15" (a missile-only hull left after its five rounds; gun hulls stayed). N/nova_plugin/npc/npc_out_of_ammo.ts `outOfAmmo`, read in npc_decision.ts before the AI-type switch: a ship of such a hull whose EVERY mounted weapon draws from an outfit magazine and finds it empty departs (the ordinary jump-out) on its next think, whatever its AI type; not while held, already fleeing, or protecting a player. 278 of 288 stock hulls set it. | The **guesses** below ("Hull AI flags and NPC cloaking: guesses to measure"): the literal Bible reading (all missiles spent, guns or not), "dock", bays. | (done) |
| **Swarming** (Flags2 0x0001) and **prefers standoff** (Flags2 0x0002) | B:2569-2570 | **Missing.** Every attacker uses one approach (`ATTACK_STANDOFF` 250 px, N/nova_plugin/npc/npc_steering.ts). Stock: 155 hulls swarm, 142 prefer standoff. R: "W1 / C1 / H1 wave 15" (first pass): the 0x0001 hull sat a little closer than the control (median 147 vs 175 px from the player; 35% vs 27% of the time under 100 px, one run); no 0x0002 ship was ever on screen in 6 minutes. Too weak to build on: no change. | The geometry of each (range, orbiting, passes); a second W1 run with more swarmers and a visible 0x0002 ship. | M |
| **AI afterburner** (shïp Flags 0x0040 "always has afterburner (for AIs only)"; përs 0x0002 "uses escape pod & has afterburner") | B:2521, B:2156 | **Done for shïp 0x0040, first pass (2026-11-24),** to R: "W1 / C1 / H1 wave 15" (the frame track of the flagged hull: strafing runs at 1.6x the control's top speed, never over it while hanging close). N/nova_plugin/npc/npc_afterburner.ts: an NPC of such a hull burns while ATTACKING and thrusting at its target (beyond the 250 px stand-off), at `AI_AFTERBURNER_FACTOR` 1.6 on top speed and acceleration, no fuel; `NpcAfterburnerSystem` applies it after travel's EffectiveMovementPhysicsSystem. 67 stock hulls. përs 0x0002 and shïp 0x0020 (advanced rating) are not read. | The **guesses** below: fleeing and travelling burns, fuel, the acceleration boost, the player's own afterburner factor (U4: still the unmeasured 2x). | (done) |
| **NPC cloaking** (Flags2 0x0100-0x4000: cloak on burst reload, when running, when hyperspacing, when flying around, stay cloaked until close, when docking, when preemptively attacked; mïsn ShipStart 2 "appear randomly, cloaked") | B:2578-2585, B:1445 | **0x0800 for traders done, first pass (2026-11-24);** the other bits missing. R: "W1 / C1 / H1 wave 15": the 0x0800 trader was seen only pulling away from the port (4-5 s each time), never parked or arriving; hostile 0x0800 + 0x1000 warships were VISIBLE the whole time they attacked; 0x0400 / 0x2000 / 0x4000 ships were never seen cloaked. N/nova_plugin/npc/npc_cloak.ts `updateNpcCloak` (run by NpcSteeringSystem every tick): an AI 1/2 ship of a 0x0800 hull with a working cloak is cloaked while travelling, parked ('dwell') and departing, visible for 4 s after each stay ends, and uncloaked while fleeing, fighting, mining, under attack or disabled. Warships are never cloaked by it (they fight visible, which NovaJS already did). Stock 0x0800 hulls are only the Wraith (Adult) and (Youth), shïp 168/169 (with the Wraith Cloaking Device): as AI 2 in the "Wraith (nice)" düdes 143 and 187 they now travel cloaked; as AI 4 in "Wraith (nasty)" 144 they are unchanged. ShipStart 2 is still a gap (N/nova_plugin/missions/mission_ship_spawn.ts). 45 stock hulls carry cloak bits; 6 missions use ShipStart 2. R: "J wave 6" saw a stock-Wraith-flagged target cloak within 5 s of being fired on (0x4000 or 0x0200). | The **guesses** below; the 0x4000 / 0x0200 cloak when attacked (J wave 6), 0x1000's reveal distance, 0x0400 / 0x2000 at a jump / landing. | M |
| **përs traits:** grudge (0x0001), Aggress 1-3 (how close before attacking), Coward (flee % of shield), ShieldMod, extra weapons, escape pod (0x0002 / gövt 0x0100) | B:2094-2102, B:2129-2134, B:2153-2156; gövt 0x0100 B:1069 | **Spawning only.** N/nova_plugin/spawn/pers_plugin.ts:21-40 lists them as gaps (its "hailing and boarding do not exist" line is stale: both exist now). 148 of 516 stock përs hold grudges. | Aggress's ranges; whether Coward replaces gövt 0x0010; a grudge's memory across systems and saves (a per-player question in multiplayer). | M |
| **Escape pods** (shïp PodCount, decorative) | B:2535-2539 | **Missing** (not parsed). | Cosmetic only. | S |

### Boarding, assistance, hails

| behaviour | Bible | NovaJS status | unknown, to measure | size |
|---|---|---|---|---|
| **NPC plunder** (gövt 0x1000: warships plunder trader-type enemies, the player included, before destroying them) | B:1078-1079 | **Done**, with ruled guesses: N/nova_plugin/npc/npc_plunder.ts (rules; credits taken from a player :109), N/nova_plugin/npc/npc_plunder_board.ts:74. mïsn 0x8000 "fails if boarded by pirates" is wired (N/nova_plugin/encounters/boarding_plugin.ts:1479). | A9: do pirates board a disabled player, and what do they take? | — |
| **Bribes** (gövt 0x0200 / 0x2000 / 0x4000 / 0x8000) | B:1071-1086 | **Done**, numbers guessed: N/nova_plugin/reputation/hail.ts:64-104 (10% / 30% of cash, minimum 500), N/nova_plugin/encounters/hail_plugin.ts:233 (2 min reprieve). | R7 (price) and A8 (duration). | — |
| **Greetings and hail answers** (gövt CommName, greetings STR#, Flags 0x0400, Flags2 0x0001/0x0008) | B:1072, B:1088-1098, Appendix III | **Done** (ruling #297): N/nova_plugin/reputation/hail.ts. | — | — |
| **Request assistance: repair / refuel** (and Roadside Assistance, Flags2 0x0010; ränk 0x0800) | B:1099-1100, B:2261-2262 | **Done:** the helper flies over and restores armor, shield and fuel to full (N/nova_plugin/encounters/hail_plugin.ts:596-660; willingness N/nova_plugin/reputation/hail.ts:242-296). | How much the original restores (full, or one jump of fuel?). | — |
| **Battle assistance** (ränk 0x0400 "request battle assistance ... who will also call in reinforcements"; STR# 3000 "Help is on the way.", "I'm busy.") | B:2257-2260 | **Missing** with a ränk 0x0400: assistance is repair/refuel only; a willing warship does not fight the player's attackers. **Without the ränk, measured and applied** (R "W1 / C1 / H1 wave 15", H1; 13c164af): a healthy player under attack who asks a neutral ship for help is turned down from STR# 3000 95-99 ("Yeah, right!", "No way."), whatever his record, and nothing happens (N/display/hail_dialog_plugin.ts `assistAnswer`, hail.ts `underFireRefusalText`); with nobody attacking him the answer stays 70-74. | A ränk 0x0400 holder's request (keeps 70-74 for now); a disabled or fuelless pilot under attack (unchanged: busy / willingness / granted). Brief **H1**. | S-M |
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
   **Done 2026-11-24** (see the inventory rows): shuttles keep a lane and
   never leave; traders make one stop. Real landing is dropped: the
   original's traffic never lands (R: "Shuttles and T1 traders, wave 15").
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
   2026-11-24** (P1 waves 13-14; wave 15's own-victims, 0x0020-ally and
   visit-long hostility already matched and are pinned; see the inventory
   rows). Who answers a distress call: nobody; the victim's own and
   allied warships defend it, call or no call (P1 wave 16, applied).
   (Fleet escorts defending their leader is done: P1 wave 13.)
5. **Hull AI flags** (W1, C1), **first pass done 2026-11-24** (see the
   inventory rows and "Hull AI flags and NPC cloaking: guesses to
   measure"):
   - **cheap, common:** out-of-ammo flee (278 hulls), AI afterburner:
     done;
   - **bigger:** swarm (155) and standoff (142): still open (one weak
     swarm measurement, no standoff one);
   - **NPC cloaking** (45 hulls, 6 missions): 0x0800 for traders done; the
     other bits and ShipStart 2 open.
6. **Battle assistance and hail info** (H1, plus one look at a stock
   trader's hail for InfoTypes). Both extend the existing hail dialog.
   H1's first pass is applied (a healthy player under attack is refused
   from 95-99); the ränk 0x0400 case and a disabled pilot's request are
   still to measure.
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
   nosy: local_law.ts's enforcesHere). Measured for the owner, (wave
   14) a nosy govt in another govt's system and (wave 15) the owner's
   ally.
2. **Who is scanned:** player ships only; NPCs and the player's escorts
   are never scanned. A pilot who is already a criminal here is attacked,
   not scanned (B:977-980).
3. **Seek range 3000 px, scan range 150 px,** the approach at top speed,
   the scan instant. Measured: "within about 3 s", "a cutter beside the
   player".
4. **Rescans:** MEASURED (waves 14-15, applied): the marker remembers
   what its scan found; a ship is scanned again on the same visit only
   when it carries contraband that scan did not find (wave 15: rescanned
   at takeoff with newly bought jünk and an illegal 0x0020 mission; wave
   14: not rescanned with nothing new), and a new arrival by jump starts
   afresh. Still guesses: a hull bought at the port keeps the marker;
   contraband gained in space (plunder) counts as new too; a second
   scanning govt with another ScanMask scans for what the first did not
   find. Wave 15 saw no scan in 33 s after a jump out and back where wave
   14 saw one within 10 s; NovaJS keeps the crossing reset.
5. **ScanFine 0 and -N:** MEASURED (wave 14, applied): both are the
   detection line without its fine sentence and no money; SmugPenalty is
   still charged. The Bible's "N% of cash" is not what 1.1.1 does.
   MEASURED (wave 16, applied): a fine above the pilot's cash takes all of
   it and no more, and the line names the whole ScanFine with a thousands
   separator ("fined 5,000 credits"). Still a guess: a pilot with no cash
   at all hears the same line.
6. **Jünk:** MEASURED (wave 14, applied): "your attempt to smuggle
   <LCName> through this system", ScanFine AND SmugPenalty.
7. **S3:** MEASURED for ScanMask 0 (wave 14): a 0x0020 mission fails
   only on a scan that finds its cargo illegal. Still guesses: a mission
   with no cargo at all is illegal while active, one with cargo only once
   it is aboard.
8. **Several finds in one scan:** MEASURED (wave 15, applied): one line,
   one fine; the line named the jünk, not the pod; a 0x0020 mission among
   the finds failed with no line of its own. Still guesses: a plain
   mission's "illegal cargo" is named over an outfit too (the line takes
   the jünk, else "illegal cargo", else the outfit); one record change;
   whether the line named the jünk because cargo outranks an outfit or
   because the pod was already found this visit (the run cannot tell);
   the "<scanner>: <pilot>, prepare to be scanned." line the original
   printed (twice) before the rescan is not implemented.
8a. **After a detection** (wave 14, applied: the scanning govt's hunters
   attack until a landing, whatever its CrimeTol): a scan that only fails
   a 0x0020 mission is no detection; never-attacks and a ränk 0x0100
   suppress the hostility as they do a criminal record.
8b. **SmugPenalty by the A14 rule** (wave 14, applied): an ALLY of the
   owner as the scanner charges its own SmugPenalty (MEASURED, wave 15:
   -50, not the owner's 70; pinned by a spec). Still a guess: a nosy
   scanner in an independent system changes no record.
9. **A clean ship** MEASURED (wave 16, applied): a cutter came to a
   clean pilot and sat on it (0-10 px) for 30+ s, and nothing was said;
   NovaJS scans every ship once a visit, clean or not, silently when
   nothing is found. Still guesses: the interceptor sits on a scanned ship
   30 s from the scan (CONTRABAND_SCAN_HOLD_MS; the end was not seen),
   and a second interceptor that arrives after the scan sits too. (Wave
   14's w14_s3_clean also had both cutters parked beside a clean pilot;
   wave 11's "never approached" pilot sat 1000 px from the port.)
10. **The scanner's name** on the line is the target pane's (a përs's or
    mission ship's own name, else the ship class); the pilot's is the
    profile name.

### Legal records per system: guesses to measure

The per-system records (N/nova_plugin/reputation/system_records.ts, ruling
#380) follow the A14 sections of waves 2-15 where they measured something.
Everything below is a choice the measurements did not make, marked as a
guess in the code:

1. **An independent system's share of a crime:** MEASURED for neighbours
   (R: "A14 / contraband wave 16", finding 1; applied): minus a quarter of
   the VICTIM's scaled fields, each halved twice and truncated (-76 / -49
   / -20). Still a guess: a crime IN an independent system is charged
   there by the same quarter at 0 jumps. Gövt 128 still gives an
   independent system its InitialRec and CrimeTol (Bible, Appendix II).
2. **"The owner's or an ally's ship"** counts an alliance in either
   direction (local_law.ts's alliedEitherWay); only the owner listing the
   victim's class was measured (wave 12's 340 / 341).
3. **A zero penalty field** takes the engine default (DEFAULT_*_PENALTY)
   in the owner's reward halves as well as in a victim's penalty.
4. **A negative field** scales truncated toward zero (C integer
   arithmetic); only the crime system's own +200 was measured.
5. **The spread's walk** follows the parsed sÿst links (including the
   backlinks the parser adds) and ignores sÿst Visibility: a hidden story
   variant of a system is walked like any other, and every system stacked
   on one map position (270 of 545 in stock) is that place's jump count
   away, 0 for the crime system's own twins.
6. **A disable alone and a boarding spread like a kill** (only their own
   system's -30 / +50 were measured).
7. **A CompReward never touches an independent system**, even with
   CompGovt 128; a PayVal or oütf ModType 21 cleaning of a govt cleans the
   systems that govt (and its allies / classmates) OWNS, never an
   independent one; ModType 21 with -1 cleans every system.
8. **chär Status1-4** set the systems a govt and its allies own, negated
   in its enemies' (the Bible's wording); independent systems keep gövt
   128's InitialRec.
9. **mïsn AvailRecord** reads the record in the system of the stellar the
   mission is offered at (Bible: "your legal record in this system").
10. **spöb MinStatus** reads the current system's record whoever owns the
    stellar (Bible: "the point on your record in the current system"); the
    stellar's own govt still decides the travel permit and the ränk 0x0200
    override.
11. **The map's Legal Status** shows the record of the system the panel
    describes: the current one (measured, wave 13) or a selected
    destination (its own record; not measured). The `p` screen shows the
    current system's (measured).
12. **Hails and the comm dialog** judge hostility by the current system's
    record (local_law.ts), as the AI does; the ränk and outfit / ship
    requirements read no record.
13. **A nosy scanner in an independent system** changes no record (kept
    from the contraband work; unlike a crime's spread, which does reach
    independent systems by gövt 128).
14. **Old saves** (v5 and before) seed each system from the per-govt record
    of its status govt; **imported original pilots** keep every per-system
    value that differs from what an absent entry would read.

### Shuttles and miners: guesses to measure

The shuttles (N/nova_plugin/npc/npc_shuttle.ts) and miners
(N/nova_plugin/npc/npc_mining.ts) follow N2 and N1 where they measured
something. Everything below is marked GUESS in the code and wants a
reference run:

1. ~~**A shuttle lands.**~~ **Measured (R: "Shuttles and T1 traders,
   wave 15"): it never does, and none takes off.** Shuttles now never
   leave and respawns jump in, so shuttles fill a system's traffic as on
   the original. On stock data (shïp 391-394, düdes 247-250) that takes
   minutes: see the wave-15 entry's "Applied" note for the measured fill
   times. Genesis shuttles are scattered like other traffic (GUESS).
2. **Which stellars are stops:** every stellar not owned by an enemy of
   the shuttle's govt, uninhabited and non-landable ones included
   (measured: the marker and a NEUTRAL govt's port, wave 15), but no
   hypergate or wormhole (the rigs had none). An allied govt's port counts
   (unmeasured).
3. ~~**A shuttle with one stop** goes back to it.~~ **Measured (R:
   "Shuttles wave 16"): it visits it once, about 6 s, and jumps out**
   (applied: `SHUTTLE_ONE_STOP_DWELL_MS`). **With none** (every stellar an
   enemy's) it jumps out like a trader (radar only in the original: it
   never came on screen), and a respawn jumps in. A HELD one-stop shuttle
   (system_hold.ts) goes back to its stop (GUESS).
4. **A shuttle that is attacked** flees like any AI 1 trader, which can
   end in a jump out at the rim. Neither rig had attacks. Back from a
   flight it resumes its lane.
5. ~~**The lane's two stops.**~~ **Measured (R: "Shuttles wave 16"): a
   stellar and its NEAREST neighbour**, whatever the list order or the
   player's stellar (an uneven rig, the player off the centre: every lane
   ran through the stellar nearest the others). NovaJS's guess was this
   rule: the first stop is one draw among the stops, the other end the
   stop nearest to it. Still a guess: a TIE is one more draw (the rigs'
   ties were not followed ship by ship). A lane under about 150 px stands
   still at its midpoint (measured, two of four shuttles for 10-19
   minutes); NovaJS's turn points close up within the arrival radius from
   about 170 px down and the pausing shuttle brakes to a standstill.
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
   flies the trader loop: since wave 15, one stop and out.
10. **T1, measured (wave 15):** traders park 15.2 s (median of 70; NovaJS
    15 s fixed, not drawn from the measured 12.2-17.9 s spread) at ONE port
    per visit, then jump out.
11. **AI 2 traders make one stop too** (the trader loop is shared; the
    rigs only flew AI 1). A HELD trader (system_hold.ts) goes on to another
    port instead of leaving, as before.
12. **Wave 14's Market** (1000 px out, no visit in 526 s) is unexplained:
    the uniform draw over the non-enemy ports (Port and Market there)
    would have sent about half of the traffic to it. Wants a rig with the ports at unequal
    distances.

### Hull AI flags and NPC cloaking: guesses to measure

W1 and C1 were first passes on the reference (one run each). What they
measured is applied (N/nova_plugin/npc/npc_out_of_ammo.ts,
npc_afterburner.ts, npc_cloak.ts); everything below is marked GUESS in the
code and wants a second run:

1. **0x0080, which ammo counts:** a ship leaves only when EVERY weapon it
   mounts draws from an empty outfit magazine. The Bible ("out of ammo for
   all ammo-using weapons") could also mean "all its missiles are spent,
   whatever guns it has", which would send most stock warships home after
   their last missile. To measure: the red W1 hull with a gun added.
2. **0x0080, where it goes:** it departs by the ordinary jump-out (flies
   out from the system centre and jumps). The reference ship flew
   straight off screen; whether it jumped or landed ("dock") was not seen.
3. **0x0080, when:** on its next think after the last round (about 1 s);
   the reference ship circled the player once more first. Bays never
   count as spent (a carrier's fighters are out, not gone); a ship
   protecting a player never leaves for it.
4. **0x0040, when it burns:** only while attacking and thrusting at the
   target (beyond NovaJS's 250 px attack stand-off). Fleeing, travelling
   and patrolling never burn (not measured).
5. **0x0040, how much:** 1.6x top speed (measured: 5.6 vs 3.5 px a
   frame), and 1.6x acceleration (guess, as the player's afterburner
   boosts both). No fuel is burned. The player's afterburner keeps its
   unmeasured 2x (U4).
6. **0x0800, who:** AI 1/2 traders only. Warships and interceptors with
   0x0800 are never cloaked by it: the C1 hostiles fought visible, and J
   wave 6's idle neutral AI 3 Wraith-flagged target was targetable until
   fired on. Whether an idle, moving warship cloaks was not seen.
7. **0x0800, when:** cloaked while travelling, parked at a stellar and
   departing; visible for 4 s after each stay ends (fitted to the two
   sightings of 4-5 s from the port to the screen edge), and whenever it
   flees, fights, mines, has an aggressor or is disabled. A device that
   drains fuel or shield is engaged only above half of that resource.
8. **The other bits** (0x0100 burst reload, 0x0200 running away, 0x0400
   hyperspacing, 0x1000 until close, 0x2000 docking, 0x4000 when attacked)
   are not implemented: none was seen cloaking in C1 (0x4000 was not
   provoked), and J wave 6's target with all of them cloaked within 5 s of
   being fired on.

### Piracy police and distress calls: guesses to measure

The piracy police (N/nova_plugin/npc/piracy_police.ts) and distress calls
(N/nova_plugin/npc/distress.ts) follow P1 waves 13-15 where they measured
something. Everything below is marked GUESS in the code and wants a
reference run:

1. **Watching range:** MEASURED at least 2500 px (wave 16, applied: a
   nosy police anchored 2500 px away turned hostile at once). Still a
   guess: nothing beyond 2500 (it may be the whole system).
2. **Only player-side attackers are policed:** MEASURED (wave 16: a nosy
   police in its own system flew round a raider attacking a non-enemy
   trader and never fired).
3. **Only firing counts, not boarding.** Wave 13's board drew nothing from
   non-nosy police; nosy police were not tested with a board.
4. **Every hit that provokes the victim provokes the witnesses,** stray
   player hits included.
5. **Self-defence is not piracy:** a hostile's POSTURE is no excuse
   (MEASURED, wave 16: the player beamed a 0x0004 raider standing off 500
   px that had not fired, and the nosy police turned hostile; applied).
   Still a GUESS: no witness reacts to hits on a victim that has SHOT the
   player within 30 s (or, for an escort as the attacker, that it has
   recorded as its own aggressor). To measure: a hostile that fires first
   beside nosy police, and the player fires back.
6. **Alliances:** a one-way alliance counts (the A14 enforcement rule;
   only a two-way one was measured), and 0x0020 does not shield a victim
   from its own govt's police (the ALLY's police: measured in P1 wave 15).
7. **The police never defend against an attacker of their own or an
   allied govt** (a player's escort of that govt).
8. **Distress rate:** at most one call per ship per 8 s, the first at the
   first hit. MEASURED (wave 16, applied): a line lasts 8.0-8.2 s and the
   calls came in bursts 8.0 s apart, the next the moment the line
   cleared (wave 14's "21-25 s" was two or three lines back to back).
   Still a guess: that one ship calls every 8 s (the callers could not be
   told apart).
9. **Who calls:** AI 1 and AI 2 traders (only AI 1 was measured), under
   NPC attack only (MEASURED: none in five runs with the player attacking,
   P1 wave 15), never a MISSION ship (MEASURED, wave 16, applied).
   Warships never call.
10. **Nobody answers** a distress call (MEASURED, wave 16). The status
    line holds every line 8 s and clears it at once (MEASURED, wave 16,
    applied; the original's take-off line, which NovaJS does not print,
    lasted about 4.5 s).
11. **Allied defenders** (wave 16, applied: an own-govt AI 3 fought the
    raider at once, an allied AI 3 joined about 20-25 s in). GUESSES:
    AI 4s of the own or an allied govt defend too; no range limit (the
    candidates sat 160-300 px off); the ally's 20 s delay is a rule and
    not chance (one run each); a PLAYER attacking an own-govt ship draws
    only the police and the record, not the govt's AI 3s (unmeasured).

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

This is the S1 clean run, extended. NovaJS today circles at 400 px and,
since wave 16's stock Sol (three AI 4 for 21+ minutes), never leaves.

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
