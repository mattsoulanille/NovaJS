import { OutfitData } from 'novadatainterface/outfit_data';
import { WeaponData } from 'novadatainterface/weapon_data';
import { OutfitsState, WeaponsState } from '../ship/index.js';

/**
 * ============================================================================
 * Out of ammo: leave (shïp Flags2 0x0080)
 * ============================================================================
 *
 * EVN Bible, shïp Flags2 0x0080: "AI ships of this type will run away/dock
 * if out of ammo for all ammo-using weapons". 278 of the 288 stock hulls
 * set it.
 *
 * Reference "W1 / C1 / H1 wave 15" (docs/reference_experiments.md): a
 * hostile AI 3 hull with the flag whose ONLY weapon was a 5-round guided
 * missile attacked the player for about 20 s (its five shots), then flew
 * straight off screen and was never seen again in 330 s, while the same
 * hull with a gun stayed the whole run. Whether it jumped or landed was
 * not seen.
 *
 * Here (npc_decision.ts): a ship of such a hull that is OUT OF AMMO by the
 * rule below DEPARTS — the ordinary jump-out — on its next think.
 *
 * OUT OF AMMO is read narrowly, as the measured case was: the ship mounts
 * at least one weapon, EVERY weapon it mounts draws ammo from a magazine
 * (wëap AmmoType 0-255, an oütf `ammoFor` supply), and every one of those
 * magazines is empty. A ship that still has a gun, a beam, a fuel-powered
 * weapon (AmmoType -1000 and below) or a bay keeps fighting with it. The
 * Bible's sentence could also be read as "all its missiles are spent,
 * whatever else it carries", which would send most stock warships home
 * after their last missile; that reading was not measured (GUESS, see
 * docs/npc_behavior_gaps.md W1). Bays are left out on purpose: a carrier's
 * "ammo" is its fighters, which are out flying rather than spent.
 *
 * Reads the synced weapon states, the synced outfit counts and the staged
 * weapon / outfit caches (the same reads WeaponsSystem makes when it
 * fires); no PRNG.
 */
export function outOfAmmo(weapons: WeaponsState,
    outfits: OutfitsState | undefined,
    weaponData: (id: string) => WeaponData | undefined,
    outfitData: (id: string) => OutfitData | undefined): boolean {
    if (!outfits) {
        return false;
    }
    let mounted = false;
    for (const [id, state] of weapons) {
        if (state.count <= 0) {
            continue;
        }
        const data = weaponData(id);
        if (!data) {
            // Not staged: no verdict (the ship keeps its business).
            return false;
        }
        mounted = true;
        if (data.type === 'BayWeaponData') {
            return false;
        }
        const ammoType = data.ammoType;
        if (ammoType === 'unlimited' || ammoType[0] !== 'weapon') {
            return false;
        }
        const supply = ammoType[1];
        for (const [outfitId, outfitState] of outfits) {
            if (outfitState.count > 0
                && outfitData(outfitId)?.ammoFor === supply) {
                return false;
            }
        }
    }
    return mounted;
}
