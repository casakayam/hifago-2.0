// Règles de lint partagées par apps/web et apps/admin.
//
// Fichier à la racine de hifago/ plutôt que dans un package : ces règles ne sont consommées que par
// deux fichiers de configuration ESLint, qui sont eux-mêmes chargés comme des modules ES par le
// binaire eslint — un import relatif suffit, et ça évite d'ajouter un workspace (donc une entrée de
// package-lock) pour vingt lignes.

// ------------------------------------------------------------------------------------------------
// FUSEAU HORAIRE — le critère de fin du lot du 2026-08-28.
//
// Ce projet documentait la règle « toutes les dates sont en heure de Colombie » depuis des mois sans
// jamais l'outiller. Résultat : la chaîne "America/Bogota" n'existait NULLE PART dans le code (trois
// commentaires, et rien d'autre), et dix sites calculaient « aujourd'hui » en UTC ou dans le fuseau
// du navigateur. Une règle documentée que rien ne vérifie n'est pas une règle : c'est un souhait.
//
// Les deux formes interdites ci-dessous sont EXACTEMENT celles par lesquelles les dix sites étaient
// passés. L'unique échappatoire est packages/domain/src/time/ (todayInBogota, startOfTodayInBogota,
// addDaysIso, nowIsoInstant) — qui n'est pas linté par ces configs, donc jamais à exempter ici.
// Couverture au-delà des deux apps (packages/, supabase/, tests/, et le SQL) :
// scripts/check-timezone.sh, lancé par le job `lint` de la CI.
// ------------------------------------------------------------------------------------------------
const ECHAPPATOIRE =
  'Utiliser packages/domain/src/time/ : todayInBogota() pour la date du jour à Guatapé, ' +
  "startOfTodayInBogota() pour un objet Date de calendrier, addDaysIso() pour décaler une date " +
  "civile, nowIsoInstant() pour un instant complet.";

export const reglesFuseau = {
  "no-restricted-syntax": [
    "error",
    {
      // `X.toISOString().slice(0, 10)` — tronquer un INSTANT pour en tirer un jour rend la date
      // d'UTC. Guatapé est à UTC−5 : passé 19 h heure locale, cette expression rend DÉJÀ demain.
      // `.slice`, mais aussi `.substring`, `.substr` et `.split("T")[0]` : toute TRONCATURE d'un
      // `toISOString()` est le même geste. Ne pas se limiter à `.slice` — c'est la première
      // réécriture qu'on trouve quand la règle gêne, et elle réintroduirait le bug en silence.
      selector:
        'CallExpression[callee.object.callee.property.name="toISOString"]:matches([callee.property.name="slice"], [callee.property.name="substring"], [callee.property.name="substr"], [callee.property.name="split"])',
      message: `Date UTC déguisée en date civile : .toISOString().slice(0, 10) rend le lendemain passé 19 h à Guatapé. ${ECHAPPATOIRE}`,
    },
    {
      // `new Date()` nu — « maintenant » dans le fuseau du processus (UTC sur Vercel) ou du
      // navigateur (celui du visiteur). C'est la source des quatre sites de calendrier du lot :
      // `{ before: new Date() }` et le mois d'ouverture qui pilote la clé du fetch PMS.
      selector: 'NewExpression[callee.name="Date"][arguments.length=0]',
      message: `new Date() nu prend le fuseau du processus ou du navigateur, jamais celui de Guatapé. ${ECHAPPATOIRE}`,
    },
    {
      // `new Date(Date.now())` — même chose, écrite autrement. Fermé explicitement pour que la
      // règle ci-dessus ne se contourne pas par accident.
      selector:
        'NewExpression[callee.name="Date"][arguments.0.callee.object.name="Date"][arguments.0.callee.property.name="now"]',
      message: `new Date(Date.now()) est un new Date() nu écrit autrement. ${ECHAPPATOIRE}`,
    },
    {
      // `new Date(instant).toLocaleDateString(…)` — le MÊME défaut écrit avec Intl, et le plus
      // insidieux : il ne ressemble pas au bug. Dix-sept sites l'écrivaient encore après le premier
      // passage du lot du 2026-08-28, dont cinq Server Components où le résultat n'est le bon
      // fuseau de PERSONNE (le serveur Vercel est en UTC). Le motif ne vise QUE le receveur
      // `new Date(…)` : formater une date déjà résolue (un jour de grille de calendrier, par
      // exemple) reste libre, parce que ce n'est pas une projection d'instant.
      selector:
        'CallExpression[callee.object.type="NewExpression"][callee.object.callee.name="Date"]:matches([callee.property.name="toLocaleDateString"], [callee.property.name="toLocaleString"], [callee.property.name="toLocaleTimeString"])',
      message:
        "Projection d'un instant en date civile sans fuseau : sur Vercel (serveur UTC) cette date est fausse 5 h par jour. Utiliser formatDateInBogota()/formatDateTimeInBogota() (packages/domain/src/time/).",
    },
  ],
};
