import type { Metadata } from "next";
import type { ReactNode } from "react";
import { createClient } from "@hifago/supabase/server";
import { redirect } from "@/i18n/navigation";
import { Link } from "@/i18n/navigation";

// Zone COMPTE — la SEULE garde d'accès du site (spec 27 §5). Jamais indexée.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// POURQUOI LA GARDE EST ICI, ET PAS DANS `proxy.ts`
// ─────────────────────────────────────────────────────────────────────────────────────────────
// La documentation Supabase déconseille de faire porter l'AUTORISATION au middleware, et le proxy
// ne voit ni les rôles ni la ressource visée — il rafraîchit la session, c'est tout. Une garde de
// layout, elle, s'exécute au plus près de ce qu'elle protège et couvre d'un coup tous les écrans
// de la zone : la précédente vivait dans `account/orders/page.tsx` et n'aurait couvert aucun écran
// de compte ajouté après elle.
//
// ⚠️ L'invité doit pouvoir réserver de BOUT EN BOUT (cahier §1) : il n'y a donc aucune garde sur la
// vitrine ni sur le tunnel. Ajouter une garde ailleurs que dans cette zone serait une régression
// fonctionnelle, pas un durcissement.
//
// ⚠️ Un layout ne connaît pas le chemin courant, donc cette garde ne peut pas construire un
// `?next=<chemin>` précis. La spec 27 prévoit que `proxy.ts` pose le pathname en en-tête de requête
// pour le lui donner — non fait dans ce lot, qui ne touche pas au proxy. En attendant, la
// redirection est nue et la connexion renvoie vers l'accueil du compte : comportement identique à
// l'existant tant qu'il n'y a qu'un écran de compte, à corriger avec le renommage des routes.

export const metadata: Metadata = { robots: { index: false } };

export default async function CuentaLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect({ href: "/login", locale });
  }

  return (
    <>
      <header className="border-b border-default-200 px-4 py-3">
        <Link href="/" className="text-lg font-semibold">
          Hifago
        </Link>
      </header>
      {children}
    </>
  );
}
