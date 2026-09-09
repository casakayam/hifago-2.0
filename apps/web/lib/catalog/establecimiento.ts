import { cache } from "react";
import { asLocalizedField, resolveLocalizedField } from "@hifago/domain";
import { createPublicClient } from "@/lib/supabase/publicClient";
import { hasNativeContent } from "@/lib/seo/nativeContent";
import { routing } from "@/i18n/routing";
import { esTipoOferta } from "./tipos";
import type { FichaEstablecimiento, FotoTarjeta, TarjetaOferta } from "./tipos";

// La fiche d'un LIEU — spec 30 §7b. Ce module retire la DERNIÈRE exemption vitrine de
// `scripts/check-data-layer.sh` : elle tombe à deux entrées, toutes deux hors vitrine (le compte
// client et le tunnel de paiement).
//
// ⚠️ Client anonyme sans cookies (invariant 3 de la spec 27), comme la fiche produit. Mêmes
// conséquences, mêmes raisons.

const BUCKET_MEDIA = "catalog-media";

// Une seule ligne, template literal sans interpolation : supabase-js infère le type de retour en
// analysant le type LITTÉRAL de la chaîne.
//
// ⚠️ `contact_phone` est nouveau (2026-09-08) et n'est lisible QUE grâce au
// `grant select (contact_phone)` de sa migration : `establishments` n'a aucun grant au niveau
// table pour `anon`, seulement colonne par colonne. Sans lui, cette requête entière échouerait sur
// « permission denied for column » — une erreur qui tombe avant la RLS et ressemble à un bug de
// policy (piège §11.1).
const COLUMNAS_ESTABLECIMIENTO = `id, slug, name, description, address, lat, lon, check_in_time, check_out_time, mode, contact_phone`;

/** Ce que la carte d'un produit affiche depuis une fiche établissement. */
const COLUMNAS_PRODUCTO = `id, slug, name, type, price_cop, price_label, capacity`;

export const getEstablecimientoPorSlug = cache(
  async (
    slug: string,
    { locale }: { locale: string }
  ): Promise<FichaEstablecimiento | null> => {
    const supabase = createPublicClient();

    const { data: establecimiento } = await supabase
      .from("establishments")
      .select(COLUMNAS_ESTABLECIMIENTO)
      .eq("slug", slug)
      .eq("status", "active")
      .maybeSingle();

    if (!establecimiento) return null;

    // Deux lectures indépendantes — ni l'une ni l'autre n'a besoin du résultat de la seconde.
    const [{ data: fotos }, { data: productos }] = await Promise.all([
      supabase
        .from("establishment_media")
        .select("storage_path")
        .eq("establishment_id", establecimiento.id)
        .order("sort", { ascending: true }),
      supabase
        .from("products")
        .select(COLUMNAS_PRODUCTO)
        .eq("establishment_id", establecimiento.id)
        .eq("sellable", true)
        .order("created_at"),
    ]);

    // La SEULE attente séquentielle : les photos dépendent des ids qu'on vient d'obtenir. Une
    // jointure imbriquée les ramènerait en un tour, mais imposerait de trier les médias côté
    // client — le tri `sort` décide de la photo de COUVERTURE, et le perdre changerait l'image de
    // chaque carte sans que rien ne le signale.
    const ids = (productos ?? []).map((producto) => producto.id);
    const { data: fotosProductos } =
      ids.length > 0
        ? await supabase
            .from("product_media")
            .select("product_id, storage_path")
            .in("product_id", ids)
            .order("sort", { ascending: true })
        : { data: [] };

    const urlPublica = (ruta: string) =>
      supabase.storage.from(BUCKET_MEDIA).getPublicUrl(ruta).data.publicUrl;

    // Toutes les photos de chaque produit, dans l'ordre de `sort` : la carte monte un carrousel,
    // pas une vignette unique.
    const fotosPorProducto = new Map<string, FotoTarjeta[]>();
    for (const fila of fotosProductos ?? []) {
      const lista = fotosPorProducto.get(fila.product_id) ?? [];
      lista.push({ url: urlPublica(fila.storage_path) });
      fotosPorProducto.set(fila.product_id, lista);
    }

    const tarjetas: TarjetaOferta[] = (productos ?? []).map((producto) => ({
      clave: `producto-${producto.id}`,
      href: `/productos/${producto.slug}`,
      nombre: resolveLocalizedField(asLocalizedField(producto.name), locale) ?? producto.slug,
      // ⚠️ `null` et non le nom du lieu : on EST déjà sur sa fiche. Le répéter sur chacune de ses
      // cartes serait du bruit, et la carte réserve ce sous-titre à l'établissement d'origine.
      establecimiento: null,
      // Même règle que partout : un libellé libre d'abord, un montant ensuite, sinon RIEN — jamais
      // « 0 COP ». ⚠️ Le prix était SÉLECTIONNÉ par l'écran d'origine et affiché nulle part, alors
      // que l'entretien du 2026-09-07 le demande explicitement sur une carte de chambre.
      precio: producto.price_label
        ? { tipo: "texto", label: producto.price_label }
        : producto.price_cop !== null
          ? { tipo: "monto", cop: producto.price_cop }
          : null,
      fotos: fotosPorProducto.get(producto.id) ?? [],
      tipo: esTipoOferta(producto.type) ? producto.type : "activity",
      nAlojamientos: null,
      capacidad: producto.capacity,
      testId: `tarjeta-${producto.slug}`,
    }));

    return {
      id: establecimiento.id,
      slug: establecimiento.slug ?? slug,
      nombre: resolveLocalizedField(asLocalizedField(establecimiento.name), locale) ?? slug,
      descripcion: resolveLocalizedField(asLocalizedField(establecimiento.description), locale),
      direccion: establecimiento.address,
      lat: establecimiento.lat,
      lon: establecimiento.lon,
      // ⚠️ LES HORAIRES DU LIEU, et eux seuls. `products.check_in_time` existe encore et reste
      // éditable côté admin, mais AUCUNE page publique ne le lit — c'est la règle tranchée le
      // 2026-09-08 (spec 30 §3.4), que deux migrations annonçaient déjà sans jamais la poser.
      horaEntrada: establecimiento.check_in_time,
      horaSalida: establecimiento.check_out_time,
      modo: establecimiento.mode === "rooms" || establecimiento.mode === "whole_house"
        ? establecimiento.mode
        : null,
      contacto: establecimiento.contact_phone,
      // ⚠️ PAS de repli sur les photos des chambres : la photo d'une chambre montre une chambre,
      // pas le lieu. L'afficher comme photo d'établissement promettrait autre chose que ce qu'on
      // montre — l'aplat gris dit la vérité (spec 30 §10.6). La carte GROUPÉE du catalogue, elle,
      // applique bien ce repli : elle représente explicitement ses couchages.
      fotos: (fotos ?? []).map((fila) => ({ url: urlPublica(fila.storage_path) })),
      alojamientos: tarjetas.filter((tarjeta) => tarjeta.tipo === "lodging"),
      otrosProductos: tarjetas.filter((tarjeta) => tarjeta.tipo !== "lodging"),
      localesNativas: routing.locales.filter((candidate) =>
        hasNativeContent(establecimiento.name, candidate)
      ),
    };
  }
);

/**
 * L'URL du bouton de contact, depuis un numéro E.164.
 *
 * ⚠️ La contrainte `establishments_contact_phone_e164` garantit la forme en base ; cette fonction
 * ne fait que retirer le `+`, que `wa.me` n'accepte pas. Elle ne devine RIEN — un composant qui
 * déduirait « c'est un numéro, donc WhatsApp » ferait de la logique métier dans du rendu.
 */
export function urlDeContacto(telefonoE164: string): string {
  return `https://wa.me/${telefonoE164.replace(/^\+/, "")}`;
}
