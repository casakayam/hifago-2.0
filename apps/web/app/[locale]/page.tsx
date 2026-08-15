import { setRequestLocale, getTranslations } from "next-intl/server";
import { createClient } from "@hifago/supabase/server";
import { asLocalizedField, resolveLocalizedField } from "@hifago/domain";
import { Link } from "@/i18n/navigation";
import { Card } from "@hifago/ui";

export default async function HomePage({
  params,
}: PageProps<"/[locale]">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("HomePage");

  const supabase = await createClient();
  // products_select_public (Tranche 2) : catalogue public, sellable=true seulement. Minimal à
  // dessein — pas de filtre/catégorie/recherche, hors périmètre de cette feature (feature 6) :
  // le vrai besoin ici est de donner au panier un chemin de navigation client-side réel entre
  // deux fiches produit, sans lequel un panier multi-établissement ne serait jamais atteignable
  // par un vrai visiteur (une navigation par URL, elle, réinitialise toujours le panier en
  // mémoire — comportement attendu, pas un bug).
  const { data: products } = await supabase
    .from("products")
    .select("slug, name")
    .eq("sellable", true)
    .order("created_at");

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-8">
      <div className="text-center">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="text-muted">{t("description")}</p>
      </div>

      <div className="flex flex-col gap-3">
        {(products ?? []).map((product) => (
          <Link key={product.slug} href={`/products/${product.slug}`} data-testid={`catalog-link-${product.slug}`}>
            <Card>
              <Card.Header>
                <Card.Title>
                  {resolveLocalizedField(asLocalizedField(product.name), locale) ?? product.slug}
                </Card.Title>
              </Card.Header>
            </Card>
          </Link>
        ))}
      </div>
    </main>
  );
}
