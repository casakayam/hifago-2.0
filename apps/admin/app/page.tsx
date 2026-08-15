import { redirect } from "next/navigation";
import { createClient } from "@hifago/supabase/server";

// Racine de l'app (admin+socio, cf. hifago/CLAUDE.md §2.1) : ne rend jamais de contenu, aiguille
// vers la page de base du type d'utilisateur connecté. C'est aussi la destination par défaut de
// app/login/page.tsx quand aucun `next` explicite n'est fourni — un login sans contexte de départ
// repasse par ici pour être aiguillé correctement plutôt que de supposer "admin" par défaut.
// operator ⇒ referrer (invariant DB) : un operator est donc toujours aussi referrer, testé en
// premier pour l'envoyer sur sa page la plus utile (ses fiches), pas sur ses commissions.
export default async function RootPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Feature 31 (docs/specs/07-connexion-inscription-complete.md §8) : 2FA rendu optionnel le
  // 2026-08-15 (décision Jérôme) — plus de redirection forcée vers /mfa/enroll ou /mfa/verify.

  const { data: isAdmin } = await supabase.rpc("is_admin", { uid: user.id });
  if (isAdmin) {
    redirect("/admin");
  }

  const { data: isOperator } = await supabase.rpc("has_capability", {
    uid: user.id,
    p_role: "operator",
  });
  if (isOperator) {
    redirect("/partner/products");
  }

  const { data: isReferrer } = await supabase.rpc("has_capability", {
    uid: user.id,
    p_role: "referrer",
  });
  if (isReferrer) {
    redirect("/partner/commissions");
  }

  // Feature 31 : jusqu'ici inatteignable en pratique (aucun compte n'existait sans rôle — la seule
  // création de compte passait par /partner/join, qui accorde toujours au moins `referrer`).
  // L'inscription libre change ça : un compte fraîchement créé sans capacité doit atterrir sur son
  // dashboard (qui affiche déjà cet état, cf. /partner/(app)/page.tsx « Aún no tienes ningún rol
  // asignado »), jamais sur /partner/join sans jeton — cet écran attend un `?token=` et affiche
  // sinon une erreur d'invitation invalide, un faux message pour ce cas.
  redirect("/partner");
}
