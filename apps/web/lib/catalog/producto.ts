import { cache } from "react";
import {
  asLocalizedField,
  asLodgingKind,
  isPmsBacked,
  lastBookableDateIso,
  resolveLocalizedField,
  todayInBogota,
} from "@hifago/domain";
import { createPublicClient } from "@/lib/supabase/publicClient";
import { hasNativeContent } from "@/lib/seo/nativeContent";
import { routing } from "@/i18n/routing";
import { esTipoOferta } from "./tipos";
import type {
  FichaProducto,
  FilaDisponibilidad,
  FilaFranja,
  FilaTarifa,
  FotoTarjeta,
  ModoReserva,
  PrecioTarjeta,
} from "./tipos";

// La fiche d'une offre — spec 30 §7b. Ce module retire `productos/[slug]/page.tsx` de la liste
// d'exemptions de `scripts/check-data-layer.sh` : les six requêtes qu'il portait vivent ici.
//
// ⚠️ CE QUE CE DÉPLACEMENT NE FAIT PAS : réduire le nombre d'allers-retours. Le regroupement en
// `Promise.all` et l'unique attente séquentielle (les créneaux dépendent du comptage des règles)
// sont repris À L'IDENTIQUE. Le contrôle CI ne mesure que l'ENDROIT d'où part une requête, jamais
// leur nombre — croire que son vert prouve autre chose serait une erreur de lecture.
//
// ⚠️ CLIENT ANONYME SANS COOKIES (invariant 3 de la spec 27), là où la page utilisait le client
// à session. Conséquence réelle, et voulue : un admin connecté ne peut plus prévisualiser une
// fiche non publiée — `products_select_public` lui ouvrait la porte via `OR is_admin(…)`. Une
// fiche publique montre ce que le PUBLIC voit, et rien d'autre ; la prévisualisation, si elle est
// un jour demandée, est un écran d'admin, pas un effet de bord d'authentification.

const BUCKET_MEDIA = "catalog-media";

// Template literal SANS interpolation, sur une seule ligne : supabase-js infère le type de retour
// en analysant le type LITTÉRAL de la chaîne. Une concaténation l'élargirait en `string` et ferait
// tomber tout le typage sur `GenericStringError`.
//
// `establishment(...)` ne demande JAMAIS `photo_urls` : la colonne est hors du GRANT SELECT public
// (20260819110000), et la demander ferait échouer la requête ENTIÈRE — pas seulement ce champ.
const COLUMNAS_PRODUCTO = `id, slug, name, description, price_cop, price_tiers, min_qty, max_qty, unit, capacity, unit_count, lodging_kind, type, price_label, external_booking_url, occurrence_type, occurrence_date, recurrence_frequency_days, recurrence_end_date, recurrence_end_count, start_time, duration_minutes, lobby_category_id, establishment:establishments(id, slug, name, description, address)`;

/**
 * ⚠️ Mémoïsé par `cache` de React, et ce n'est pas une optimisation : `generateMetadata` et le
 * rendu de la page appellent tous deux cette fonction dans la MÊME requête. Sans le cache, chaque
 * fiche ferait deux fois le tour complet.
 */
export const getProductoPorSlug = cache(
  async (slug: string, { locale }: { locale: string }): Promise<FichaProducto | null> => {
    const supabase = createPublicClient();

    const { data: producto } = await supabase
      .from("products")
      .select(COLUMNAS_PRODUCTO)
      .eq("slug", slug)
      .maybeSingle();

    // `null` plutôt qu'une exception : la page appelle `notFound()`. Un produit non publié est
    // invisible à `anon` (RLS), donc il arrive ici exactement comme un slug inconnu — c'est la
    // même 404 pour le visiteur, et c'est voulu (jamais un « soft 404 » vers la catégorie).
    if (!producto) return null;

    const esEvento = producto.type === "evento";
    const esAlojamiento = producto.type === "lodging";
    const esPmsBacked = isPmsBacked({
      type: producto.type,
      lobbyCategoryId: producto.lobby_category_id,
    });

    // « Aujourd'hui » = le jour civil à GUATAPÉ, jamais celui d'UTC. Un serveur réglé en UTC fait
    // basculer la date à 19 h heure locale : les `gte("date", …)` retiraient alors du catalogue les
    // créneaux et tarifs de la soirée en cours (lot fuseau, 2026-08-28). Dérivé UNE fois, réutilisé
    // par les trois sites qui en ont besoin.
    const hoyIso = todayInBogota();

    // Un helper par requête plutôt qu'un ternaire dans le tableau : TypeScript infère alors le type
    // de chaque branche ligne par ligne, sans annotation manuelle — et chaque appel démarre sa
    // requête au même tick, donc en vrai parallèle malgré l'`await` interne.
    const leerDisponibilidad = async () =>
      esEvento
        ? { data: [] }
        : await supabase
            .from("product_availability")
            .select("date, capacity, booked")
            .eq("product_id", producto.id)
            .order("date");

    // ⚠️ Le conditionnel est VOLONTAIREMENT différent de celui ci-dessus (`esAlojamiento` en plus) :
    // un hébergement a toujours son écran dédié, quel que soit le nombre de règles de créneaux
    // qu'il pourrait porter. Lui en compter serait une requête gaspillée.
    const contarReglasDeFranja = async () =>
      esEvento || esAlojamiento
        ? { count: 0 }
        : await supabase
            .from("product_slot_rules")
            .select("id", { count: "exact", head: true })
            .eq("product_id", producto.id);

    const leerTarifas = async () =>
      esAlojamiento
        ? await supabase
            .from("product_date_rates")
            .select("date, price_cop")
            .eq("product_id", producto.id)
            .gte("date", hoyIso)
        : { data: [] };

    const [
      { data: disponibilidad },
      { count: nbReglasFranja },
      { data: tarifas },
      { data: fotosProducto },
      { data: fotosEstablecimiento },
    ] = await Promise.all([
      leerDisponibilidad(),
      contarReglasDeFranja(),
      leerTarifas(),
      supabase
        .from("product_media")
        .select("storage_path")
        .eq("product_id", producto.id)
        .order("sort", { ascending: true }),
      supabase
        .from("establishment_media")
        .select("storage_path")
        .eq("establishment_id", producto.establishment?.id ?? "")
        .order("sort", { ascending: true }),
    ]);

    const modoReserva = resolverModoReserva({
      esEvento,
      urlExterna: producto.external_booking_url,
      esAlojamiento,
      tieneFranjas: (nbReglasFranja ?? 0) > 0,
    });

    // La SEULE attente séquentielle du module, et elle est structurelle : on ne sait qu'ici si le
    // produit est à créneaux. La grouper avec le `Promise.all` demanderait de compter les règles
    // deux fois.
    const { data: franjas } =
      modoReserva === "slot"
        ? await supabase.rpc("get_product_slots", {
            p_product_id: producto.id,
            p_from: hoyIso,
            p_to: lastBookableDateIso(hoyIso),
          })
        : { data: [] };

    const urlPublica = (ruta: string) =>
      supabase.storage.from(BUCKET_MEDIA).getPublicUrl(ruta).data.publicUrl;

    const establecimiento = producto.establishment;

    return {
      id: producto.id,
      slug: producto.slug,
      // Un type inconnu ne devrait pas exister (contrainte CHECK), mais le repli évite qu'une
      // valeur ajoutée en base sans passer par le front fasse planter la fiche entière.
      tipo: esTipoOferta(producto.type) ? producto.type : "activity",
      // Repli sur le slug : une fiche sans nom dans aucune langue reste lisible plutôt que vide.
      nombre: resolveLocalizedField(asLocalizedField(producto.name), locale) ?? producto.slug,
      descripcion: resolveLocalizedField(asLocalizedField(producto.description), locale),
      fotos: enFotos(fotosProducto, urlPublica),
      precio: resolverPrecio(producto.price_label, producto.price_cop),
      unidad: producto.unit,
      modoReserva,
      urlExterna: producto.external_booking_url,
      // Renseignée pour tout evento, INDÉPENDAMMENT du mode : la date d'un événement est une
      // propriété de son type, pas de la façon dont on le réserve. Les confondre était le défaut
      // que la spec 30 corrige (§5b).
      ocurrencia: esEvento
        ? {
            tipo: producto.occurrence_type as "once" | "recurring" | null,
            fecha: producto.occurrence_date,
            frecuenciaDias: producto.recurrence_frequency_days,
            finFecha: producto.recurrence_end_date,
            finConteo: producto.recurrence_end_count,
            hora: producto.start_time,
          }
        : null,
      alojamiento: esAlojamiento
        ? {
            lodgingKind: asLodgingKind(producto.lodging_kind),
            capacity: producto.capacity,
            unitCount: producto.unit_count,
            priceTiers: producto.price_tiers,
            // Le même défaut que l'écran d'origine : un hébergement sans plafond saisi reste
            // réservable, borné à 20.
            maxQty: producto.max_qty ?? 20,
            esPmsBacked,
          }
        : null,
      disponibilidad: (disponibilidad ?? []) as FilaDisponibilidad[],
      tarifas: (tarifas ?? []) as FilaTarifa[],
      franjas: (franjas ?? []) as FilaFranja[],
      establecimiento: establecimiento
        ? {
            id: establecimiento.id,
            slug: establecimiento.slug,
            nombre:
              resolveLocalizedField(asLocalizedField(establecimiento.name), locale) ?? "",
            descripcion: resolveLocalizedField(
              asLocalizedField(establecimiento.description),
              locale
            ),
            direccion: establecimiento.address,
            fotos: enFotos(fotosEstablecimiento, urlPublica),
          }
        : null,
      // ⚠️ Prédicat DISTINCT et plus strict que le repli d'affichage ci-dessus : `hasNativeContent`
      // exige une chaîne non blanche. C'est le MÊME que celui du sitemap — deux versions feraient
      // lister des URL que les métadonnées déclarent `noindex`.
      localesNativas: routing.locales.filter((candidate) =>
        hasNativeContent(producto.name, candidate)
      ),
    };
  }
);

/**
 * Ce qui décide du bloc affiché sous le prix.
 *
 * ⚠️ `evento` reste EN TÊTE, délibérément. Le retirer rendrait tout evento sans URL réservable en
 * ligne — un changement de comportement produit que personne n'a demandé. Ce que la spec 30
 * corrige est l'inverse : que la vitrine ne soit plus RÉSERVÉE aux eventos (cahier §2e, « ce n'est
 * pas réservé aux eventos »). Un evento sans URL reste donc un cul-de-sac, nommé au §10.5.
 *
 * Exporté pour être testable seul : c'est la règle la plus facile à casser par inadvertance.
 */
export function resolverModoReserva({
  esEvento,
  urlExterna,
  esAlojamiento,
  tieneFranjas,
}: {
  esEvento: boolean;
  urlExterna: string | null;
  esAlojamiento: boolean;
  tieneFranjas: boolean;
}): ModoReserva {
  if (esEvento) return "evento";
  if (urlExterna !== null) return "vitrina";
  if (esAlojamiento) return "lodging";
  if (tieneFranjas) return "slot";
  return "date";
}

/**
 * Le prix d'une fiche, en DONNÉES — le formatage monétaire appartient à l'affichage.
 *
 * ⚠️ L'ordre dit la règle, et il compte : un libellé libre d'abord, un montant ensuite, sinon
 * RIEN. Jamais un zéro, qui prétendrait la gratuité — le défaut mesuré en réel le 2026-09-08,
 * quand la migration `products_price_cop_required_unless_vitrine` a rendu ce cas atteignable.
 */
export function resolverPrecio(priceLabel: string | null, priceCop: number | null): PrecioTarjeta {
  if (priceLabel) return { tipo: "texto", label: priceLabel };
  if (priceCop !== null) return { tipo: "monto", cop: priceCop };
  return null;
}

function enFotos(
  filas: { storage_path: string }[] | null,
  urlPublica: (ruta: string) => string
): FotoTarjeta[] {
  return (filas ?? [])
    .map((fila) => fila.storage_path)
    .filter((ruta): ruta is string => typeof ruta === "string" && ruta.length > 0)
    .map((ruta) => ({ url: urlPublica(ruta) }));
}
