// LA définition de « compte réel », et le seul endroit où elle vit côté TypeScript.
//
// ⚠️ POURQUOI ELLE EXISTE. Depuis la spec 31, `auth.getUser()` rend un utilisateur pour une session
// ANONYME — posée par `CartContext` au premier ajout au panier. Tout le code qui écrivait
// `Boolean(user)` a donc commencé, ce jour-là, à traiter un visiteur de passage comme un client
// connecté. Conséquence réelle : « Iniciar sesión » a disparu du site entier dès le premier ajout
// au panier, `SiteMenu` en portant le seul lien du chrome (corrigé par la spec 33).
//
// ⚠️ POURQUOI ICI, dans `packages/supabase` plutôt que dans une app. C'est le seul module que le
// code CLIENT, le code SERVEUR et les deux apps importent déjà. Une première version de la spec 33
// avait écrit ce prédicat à TROIS endroits (`CoquillaVitrine.tsx`, `pago/page.tsx`,
// `lib/auth/viewer.ts`), chacun avec un commentaire disant « même prédicat que les deux autres » —
// ce qui documentait la dispersion au lieu de l'éviter. Une règle de sécurité produit qui a déjà
// cassé le site une fois mérite une source unique.
//
// Elle ne dépend de rien (pas de client Supabase, pas de `cookies()`) : c'est une fonction pure sur
// la forme minimale d'un utilisateur, donc importable depuis un composant client comme depuis un
// Server Component.
//
// La 4ᵉ définition, `is_anonymous_session()` en SQL, reste séparée et c'est voulu : couche
// différente, source différente (`auth.users`, pas le claim JWT), et testée par pgTAP.

/** La forme minimale dont ce prédicat a besoin — compatible avec le `User` de supabase-js. */
export type IdentityLike = { is_anonymous?: boolean } | null | undefined;

/**
 * Un compte avec une identité propre, jamais une session anonyme. C'est ce que l'interface appelle
 * « connecté » : un anonyme possède bien son panier et ses commandes, mais il n'a pas de compte.
 *
 * ⚠️ Une identité anonyme reste une identité valide partout ailleurs — `/cuenta/reservas` lui est
 * accessible, gain voulu de la spec 31. Ce prédicat ne décide QUE de ce que l'interface appelle
 * un compte.
 */
export function isRealAccount(user: IdentityLike): boolean {
  return Boolean(user) && !user?.is_anonymous;
}
