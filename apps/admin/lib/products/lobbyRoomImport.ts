import type { LocalizedValue } from "@/components/localized-text-field";
import type { LobbyRoomOption } from "@/lib/pms/lobbyOptions";

// Politique d'import « Lobby PROPOSE, hifago fait foi » (arbitrage Jérôme du 2026-08-26), extraite
// de product-form.tsx le 2026-08-27. C'est une RÈGLE MÉTIER, pas du câblage de formulaire : elle
// encode quatre décisions dont la violation coûte cher, et elle vivait dans une closure non
// exportée d'un fichier de 738 lignes — donc intestable autrement qu'en montant tout le formulaire
// avec sa session Supabase, son router et ses toasts. Même patron que hotelRooms.ts / slotRules.ts
// / stayRates.ts, qui ont chacun leur fichier de test à côté.
//
// Les quatre règles, et pourquoi :
//
//   1. Un champ que Lobby NE renseigne PAS n'écrase jamais rien. Sans ça, un compte Lobby sans
//      description effacerait une description saisie à la main.
//   2. Le NOM n'est rempli que s'il est encore vide. C'est l'identité publique du produit — elle
//      porte le slug de la fiche — donc jamais quelque chose qu'on écrase derrière l'utilisateur.
//   3. Les descriptions sont FUSIONNÉES par langue, pas remplacées en bloc : Lobby peut n'avoir
//      que l'espagnol alors que l'anglais a été écrit ici.
//   4. Capacité et nombre d'unités sont écrasés quand Lobby les fournit — ce sont des faits
//      physiques sur la chambre, et c'est précisément ce qu'on vient chercher chez eux.
//
// Les photos ne passent PAS par ici : elles exigent un aller-retour serveur (téléchargement chez
// Lobby, décodage, écriture Storage) qu'une fonction pure ne peut pas faire. Elles restent dans
// product-form.tsx, qui orchestre l'appel réseau.

/** Les seuls champs que l'import peut toucher. */
export type LobbyImportableFields = {
  name: LocalizedValue;
  description: LocalizedValue;
  /** Chaîne, parce que c'est la forme de l'état de formulaire (Input type="number"). */
  capacity: string;
  unitCount: string;
};

/**
 * Renvoie les champs après import. Chaque valeur inchangée est renvoyée PAR RÉFÉRENCE : appliquer
 * le résultat avec des setters React ne déclenche donc aucun re-rendu pour les champs que Lobby ne
 * renseigne pas. C'est ce qui rend l'appel inconditionnel des setters sûr côté composant, et ça
 * évite d'y remettre les `if` qu'on vient d'en sortir.
 */
export function mergeLobbyRoom(
  current: LobbyImportableFields,
  data: LobbyRoomOption,
): LobbyImportableFields {
  return {
    name: mergeName(current.name, data.name),
    description: mergeDescription(current.description, data.descriptions),
    capacity: data.capacity !== null ? String(data.capacity) : current.capacity,
    unitCount: data.quantity !== null ? String(data.quantity) : current.unitCount,
  };
}

// Règle 2. `es` est la langue de contenu par défaut du projet (hifago/CLAUDE.md §5.1) et la seule
// que Lobby permette d'identifier de façon fiable pour un nom — l'anglais du nom n'est jamais
// touché, ni ici ni ailleurs.
function mergeName(current: LocalizedValue, lobbyName: string): LocalizedValue {
  if (current.es?.trim()) return current;
  return { ...current, es: lobbyName };
}

// Règle 3. Une langue absente ou vide côté Lobby laisse la valeur locale intacte. Les langues que
// Lobby renvoie mais que l'éditeur hifago ne sait pas afficher (pt, fr — observées le 2026-08-26)
// n'arrivent même pas jusqu'ici : parseLobbyRooms les range dans unsupportedLangs sans les écrire.
function mergeDescription(
  current: LocalizedValue,
  descriptions: LobbyRoomOption["descriptions"],
): LocalizedValue {
  const imported: Record<string, string> = {};
  if (descriptions.es) imported.es = descriptions.es;
  if (descriptions.en) imported.en = descriptions.en;
  if (Object.keys(imported).length === 0) return current;
  return { ...current, ...imported };
}
