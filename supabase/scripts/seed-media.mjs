// Photos de démonstration du catalogue — la 4ᵉ étape de `npm run db:setup`.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// POURQUOI CE SCRIPT EXISTE
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// `storage.objects` ne se remplit pas depuis un fichier SQL — c'est écrit dans `seed.sql` lui-même,
// et ce n'est pas un oubli. Conséquence mesurée le 2026-09-08 : `product_media` et
// `establishment_media` étaient à ZÉRO ligne, donc toute la vitrine rendait des aplats gris. C'est
// acceptable pour une vignette de catégorie ; ça ne l'est pas pour une FICHE, dont le carrousel est
// l'élément principal — l'écran ne se juge pas, et le chemin nominal n'est jamais exercé (spec 30
// §3.5).
//
// Le précédent est `seed_auth_users.mjs` : quand le SQL ne peut pas, on passe par Node et l'API.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// CE QUE LE JEU DE PHOTOS EXERCE, ET POURQUOI IL EST DÉCOUPÉ AINSI
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//   3 photos  Casa Kayam (établissement)  → carrousel COMPLET : flèches + points
//   2 photos  tour en lancha (produit)    → carrousel minimal
//   1 photo   cama dormitorio (chambre)   → NI flèches NI points (`Carousel` les masque à n = 1)
//   0 photo   traslado privado (vitrine)  → l'aplat gris de l'atome `Image`
//
// Les quatre cas d'un coup. Le dernier est le plus facile à perdre en ajoutant « juste une photo
// partout » : sans lui, plus rien n'exerce le placeholder, et personne ne s'en apercevrait.
//
// ⚠️ LES VISUELS SONT SYNTHÉTIQUES, pas des photographies. Générés (dégradé + un chiffre lisible,
// pour voir le carrousel défiler d'un coup d'œil), jamais téléchargés : CLAUDE.md §7.3 exige des
// données 100 % synthétiques, et une image trouvée en ligne poserait une question de licence que
// personne n'a envie d'arbitrer pour un jeu de démonstration.
//
// Usage local — `npm run db:setup` l'enchaîne. À la main :
//   SUPABASE_URL="http://127.0.0.1:54321" SUPABASE_SERVICE_ROLE_KEY="…" node supabase/scripts/seed-media.mjs

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error(
    "SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont requis en variables d'environnement " +
      "(jamais de valeur par défaut codée en dur ici — cf. hifago/CLAUDE.md §8.2)."
  );
  process.exit(1);
}

const BUCKET = "catalog-media";

// ⚠️ Le préfixe `seed/` n'est pas cosmétique : c'est lui qui rend ce script IDEMPOTENT sans risquer
// d'emporter autre chose. Les objets de l'admin et de l'import PMS vivent dans `products/`,
// `establishments/` et `tags/` ; la purge ci-dessous ne touche QUE `seed/`.
const PREFIXE = "seed";

const ETABLISSEMENT_CASA_KAYAM = "b0000000-0000-4000-8000-000000000002";
const PRODUIT_TOUR_LANCHA = "b0000000-0000-4000-8000-000000000001";
const PRODUIT_CAMA_DORMITORIO = "b0000000-0000-4000-8000-000000000008";

const PLAN = [
  { cible: "establishment", id: ETABLISSEMENT_CASA_KAYAM, ficheros: ["lugar-1", "lugar-2", "lugar-3"] },
  { cible: "product", id: PRODUIT_TOUR_LANCHA, ficheros: ["oferta-1", "oferta-2"] },
  { cible: "product", id: PRODUIT_CAMA_DORMITORIO, ficheros: ["oferta-1"] },
];

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

function cheminAsset(nom) {
  return fileURLToPath(new URL(`../seed-assets/${nom}.webp`, import.meta.url));
}

async function purger() {
  // ⚠️ Les LIGNES d'abord, les objets ensuite. L'inverse laisserait des lignes pointant vers des
  // objets disparus — la vitrine servirait alors des URL mortes, ce qui est pire qu'aucune photo.
  for (const table of ["product_media", "establishment_media"]) {
    const { error } = await supabase.from(table).delete().like("storage_path", `${PREFIXE}/%`);
    if (error) throw new Error(`purge ${table} : ${error.message}`);
  }

  const { data: objets, error } = await supabase.storage.from(BUCKET).list(PREFIXE, { limit: 1000 });
  if (error) throw new Error(`liste du bucket : ${error.message}`);
  if (objets?.length) {
    const chemins = objets.map((o) => `${PREFIXE}/${o.name}`);
    const { error: erreurSuppression } = await supabase.storage.from(BUCKET).remove(chemins);
    if (erreurSuppression) throw new Error(`purge du bucket : ${erreurSuppression.message}`);
    console.log(`   purge : ${chemins.length} objet(s) seed retiré(s)`);
  }
}

async function televerser(nom) {
  // Chemin STABLE (pas d'UUID) : c'est ce qui permet de rejouer le script sans accumuler, et de
  // reconnaître un objet de seed d'un coup d'œil dans le bucket.
  const chemin = `${PREFIXE}/${nom}.webp`;
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(chemin, readFileSync(cheminAsset(nom)), { contentType: "image/webp", upsert: true });
  if (error) throw new Error(`upload ${chemin} : ${error.message}`);
  return chemin;
}

async function main() {
  console.log("==> photos de démonstration (Storage + tables média)");
  await purger();

  let lignes = 0;
  for (const { cible, id, ficheros } of PLAN) {
    const table = cible === "product" ? "product_media" : "establishment_media";
    const colonne = cible === "product" ? "product_id" : "establishment_id";

    for (const [index, nom] of ficheros.entries()) {
      const storage_path = await televerser(nom);
      // `sort` explicite : c'est lui qui décide de la photo de COUVERTURE (la première) et de
      // l'ordre du carrousel. Le laisser à 0 partout rendrait l'ordre dépendant de l'insertion.
      const { error } = await supabase.from(table).insert({ [colonne]: id, storage_path, sort: index });
      if (error) throw new Error(`insert ${table} : ${error.message}`);
      lignes += 1;
    }
  }

  console.log(`   ${lignes} ligne(s) média posée(s) — un produit reste DÉLIBÉRÉMENT sans photo.`);
}

main().catch((erreur) => {
  console.error(erreur.message);
  process.exit(1);
});
