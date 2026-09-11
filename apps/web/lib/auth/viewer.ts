import { createClient } from "@hifago/supabase/server";
import { isRealAccount } from "@hifago/supabase/identity";

// Spec 33 — « qui regarde », résolu côté SERVEUR, en un seul endroit.
//
// Existe pour une raison mécanique : `scripts/check-data-layer.sh` interdit de construire un client
// Supabase dans un fichier de route, et sa liste d'exemptions doit RÉTRÉCIR à chaque lot, jamais
// grandir. Un Server Component qui a besoin de savoir qui regarde passe donc par ici.
//
// Le prédicat, lui, vit dans `@hifago/supabase/identity` : il est aussi consommé par du code client
// (`CoquillaVitrine`), qui ne peut pas importer ce module-ci (dépendance serveur).
//
// ⚠️ Ne rend QUE ce que ses appelants lisent. Une première version rendait aussi `userId`,
// `isAnonymous` et `email` — trois champs qu'aucun appelant ne consommait, et qui laissaient croire
// à un contrat plus large qu'il n'était. Les rajouter le jour où quelqu'un en a besoin coûte une
// ligne ; les porter sans lecteur coûte à chaque relecture.

/** Un compte avec une identité propre, jamais une session anonyme (spec 33 invariant 8). */
export async function viewerIsRealAccount(): Promise<boolean> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return isRealAccount(user);
}
