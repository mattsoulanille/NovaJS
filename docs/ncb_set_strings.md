# NCB set strings: where each one runs

Every resource field that holds a control-bit **set** expression
(novaparse's `ncb_namespace.ts` `NCB_FIELDS`, the exhaustive list from the
ResForge TMPLs), and where NovaJS evaluates it. Paths are under
`packages/nova/src/`; line numbers are as of the commit that added this file.
"Stock" counts are the stock data's non-blank fields.

A set string is player-local machinery (`nova_plugin/ncb/ncb.ts`): no ECS
system runs one. Docked, the landed session runs it on the pilot's hull. In
flight, the owner's client runs it against a detached copy of the pilot
(`spaceport/ship_mission_accept.ts` `detachedSession`) and sends the deltas
(`SetStringEffects`) on an input record that every peer applies.

| Resource | Field | Stock | Where it runs | When |
|---|---|---|---|---|
| chär | OnStart | 0 | `client/player_start.ts:326` | a brand-new pilot |
| crön | OnStart | 87 | `nova_plugin/missions/cron_logic.ts:296`, `:306` via `spaceport/mission_session.ts:899` (`settleDateAdvance`) | every date advance: a landing (`spaceport/landed_transaction.ts:467`) or a jump (`client/transit.ts:113`) |
| crön | OnEnd | 75 | `nova_plugin/missions/cron_logic.ts:273`, `:312` (same path) | as OnStart |
| mïsn | OnAccept | 186 | `nova_plugin/missions/mission_accept_offer.ts:121`, `:301` | docked (`spaceport/mission_board.ts:576`, `spaceport/offer_popup.ts:722`, `spaceport/mission_offers.ts:114`); in flight (`spaceport/ship_mission_accept.ts:473`, `acceptMission` record) |
| mïsn | OnRefuse | 102 | `nova_plugin/missions/mission_accept_offer.ts:315` | docked (`spaceport/offer_popup.ts:730`); in flight (`spaceport/ship_mission_accept.ts:560`, `refuseMission` record) |
| mïsn | OnSuccess | 407 | `nova_plugin/missions/mission_transitions.ts:160` | at the landing that completes it (`spaceport/mission_session.ts:530` `processLanding`) |
| mïsn | OnFailure | 74 | `nova_plugin/missions/mission_transitions.ts:113` | at the next date advance or landing (`spaceport/mission_session.ts:1013`, `:530`); a failure the sim flags in flight waits for it |
| mïsn | OnAbort | 189 | `nova_plugin/missions/mission_transitions.ts:78`; auto-aborts `mission_accept_offer.ts:155`, `mission_landing.ts:212` | docked 'i' (`spaceport/spaceport.ts:712`); in flight (`spaceport/ship_mission_accept.ts:611`, `abortMission` record); the deferred përs auto-abort at the board (`:647`) |
| mïsn | OnShipDone | 76 | `nova_plugin/missions/mission_landing.ts:46` | at the next date advance or landing (`spaceport/mission_session.ts:1009`); the ShipDoneText itself shows at once |
| nëbu | OnExplore | (not parsed) | **NOT RUN** | — |
| oütf | OnPurchase | 11 | `spaceport/outfitter.ts:843` | an outfitter purchase |
| oütf | OnSell | 3 | `spaceport/outfitter.ts:921` | an outfitter sale |
| shïp | OnPurchase | 171 | `spaceport/shipyard_rules.ts:558` via `spaceport/shipyard.ts:753` | a shipyard purchase, Buy And Keep included |
| shïp | OnCapture | 171 | `spaceport/ship_mission_accept.ts:699` (`buildCaptureSetStrings`), applied by `nova_plugin/encounters/boarding_plugin.ts:1714` / `:1699` | the capture prompt's Use As My Ship (MEASURED, wave 45) and Use As Escort (GUESS), `captureShip` record |
| shïp | OnRetire | 1 | `spaceport/shipyard_rules.ts:556`; `spaceport/ship_mission_accept.ts:696` | a shipyard trade-in (not Buy And Keep); Use As My Ship (MEASURED, wave 45) |
| spöb | OnDominate | 272 (b6100-b6106) | `spaceport/ship_mission_accept.ts:738` (`buildStellarSetString`) from `display/stellar_set_string_plugin.ts:58`, applied by `nova_plugin/encounters/tribute.ts:367` | owed by the sim when a demand is given in to (`tribute.ts:264`) or a defence fleet falls (`nova_plugin/spawn/defense_fleet_system.ts:263`); paid by a `stellarSetString` record |
| spöb | OnRelease | 0 | as OnDominate | owed at a Release (`tribute.ts:335`) |
| spöb | OnDestroy | 272 (b6200-b6206) | **NOT RUN** | — |
| spöb | OnRegen | 0 | **NOT RUN** | — |

Flags2 0x0020 ("Stellar is always dominated", no stock stellar): a brand-new
pilot starts dominating every such stellar (`client/player_start.ts:295`,
`nova_plugin/player/dominated.ts` `alwaysDominatedStellars`, a GUESS); its
OnDominate does not run.

No other resource (dësc, përs, flët, ränk, öops, jünk, sÿst ...) has a set
string: their NCB fields are tests.

## Still not run, with estimates

- **spöb OnDestroy / OnRegen.** Nothing destroys or regenerates a stellar
  yet (no planetary weapons, no `Yxxx` / `Uxxx`; `PlanetDestructionData` is
  parsed only). Once stellar destruction exists, the strings are an hour's
  work on the OnDominate pattern (queue on the pilots it concerns, pay by
  record). The destruction itself is the large part (#353 section 2).
- **nëbu OnExplore.** nëbu is parsed by novaparse's resource parser but has
  no NovaDataInterface type. Needs a NebulaData type, a parser, and a
  "visible" test on the explored-systems set (the Bible: re-evaluated every
  time, bits-only). About half a day.
- **Timing gaps (run, but late):** mïsn OnShipDone and an in-flight
  OnFailure run at the next date advance or landing rather than the moment
  the goal completes or fails. Moving them onto the pending-and-record
  pattern used for OnDominate is about half a day each (the in-flight
  failure paths are several).
- **Unmeasured acquisition paths:** an escort UPGRADE (a new hull for an
  escort) and an escort SALE run no shïp OnPurchase / OnRetire; whether the
  original does is unknown. Each is small to add once measured.
