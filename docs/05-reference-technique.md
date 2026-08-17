---
id: refonte-reference-technique
titre: "Référence technique — patterns validés et extensions requises"
theme: cadrage
statut: "patterns de base validés 2026-08-12 ; extension calendrier partagé à valider"
maj: 2026-08-13
resume: >
  Squelettes de code validés pour l'anti-survente et la recherche géo+JSONB, complétés par
  l'extension métier 2026-08-13 pour les calendriers prestataire partagés et les camps multi-jours.
  Les patterns déjà spikés restent copiables ; l'extension multi-jours doit être validée par un
  nouveau test de concurrence avant d'être considérée comme acquise.
mots_cles: [squelette rpc, anti-survente, test de concurrence, recherche geo, jsonb, pattern valide]
repond_a:
  - "Quel squelette de code copier pour une RPC anti-survente et son test de concurrence ?"
---

# Référence technique — patterns validés + extension calendrier partagé

> Les patterns §1, §2 et §3 ont été prototypés et vérifiés dans une stack Supabase 100 % locale
> (Docker, zéro ressource cloud) pendant le cadrage de `04-architecture-cible.md`. L'extension §1bis,
> ajoutée après la décision métier du 2026-08-13, **n'est pas encore validée par spike** : elle doit
> passer le test de concurrence décrit avant d'être considérée comme un pattern copiable tel quel.

## 1. RPC anti-survente — squelette validé

**Résultat du spike (2026-08-12)** : 9 exécutions consécutives propres, 20 tentatives concurrentes
à chaque fois sur une place à capacité 1, **exactement 1 succès** à chaque run, état final en base
toujours cohérent. Reproduire cette structure pour toute nouvelle opération critique (réservation,
fermeture de date/créneau, décrément de capacité) — cf. `hifago/CLAUDE.md` § 4.

```sql
-- Gabarit : remplacer <table_capacite>, <table_log>, <nom_operation> par le domaine réel.

create table if not exists <table_capacite> (
  id uuid primary key default gen_random_uuid(),
  resource_id text not null,
  slot_date date not null,
  capacity int not null,
  booked int not null default 0,
  unique (resource_id, slot_date)
);
-- RPC-only (cf. CLAUDE.md § 3) : AUCUNE policy RLS d'écriture sur cette table.
-- revoke insert, update, delete on <table_capacite> from authenticated, anon;

create table if not exists <table_log> (
  id uuid primary key default gen_random_uuid(),
  resource_id text not null,
  slot_date date not null,
  qty int not null,
  created_at timestamptz not null default now()
);

create or replace function <nom_operation>(
  p_resource_id text,
  p_slot_date date,
  p_qty int
)
returns jsonb
language plpgsql
security definer         -- obligatoire : contourne RLS explicitement pour cette RPC
set search_path = ''     -- obligatoire : jamais omis sur une fonction SECURITY DEFINER
as $$
declare
  v_capacity int;
  v_booked int;
  v_log_id uuid;
begin
  -- Verrouillage explicite : bloque toute autre transaction visant la même ligne
  -- jusqu'au commit/rollback de celle-ci. C'est CE verrou, pas une vérification
  -- applicative préalable, qui garantit l'invariant sous concurrence réelle.
  select capacity, booked
    into v_capacity, v_booked
    from public.<table_capacite>
   where resource_id = p_resource_id
     and slot_date = p_slot_date
     for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'slot_not_found');
  end if;

  if v_booked + p_qty > v_capacity then
    return jsonb_build_object('ok', false, 'reason', 'full', 'capacity', v_capacity, 'booked', v_booked);
  end if;

  update public.<table_capacite>
     set booked = booked + p_qty
   where resource_id = p_resource_id
     and slot_date = p_slot_date;

  insert into public.<table_log> (resource_id, slot_date, qty)
  values (p_resource_id, p_slot_date, p_qty)
  returning id into v_log_id;

  return jsonb_build_object('ok', true, 'log_id', v_log_id);
end;
$$;
```

**Appel depuis une Route Handler Next.js** : un seul aller-retour réseau, jamais plusieurs requêtes
séparées (lecture puis écriture côté app) :

```ts
const { data, error } = await supabase.rpc('<nom_operation>', {
  p_resource_id: resourceId,
  p_slot_date: slotDate,
  p_qty: qty,
});
if (error || !data.ok) {
  // échec fermé : ne jamais laisser passer une réservation en cas de doute
}
```

## 1bis. Extension requise — ressource prestataire partagée et blocage multi-jours

> **Statut : décision métier/architecture du 2026-08-13, pas encore spikée techniquement.** Ne pas
> présenter cette extension comme validée avant d'avoir passé la barre de concurrence du §2.

Le gabarit du §1 reste la base, mais `resource_id` représente désormais aussi une **ressource de
disponibilité partagée du prestataire**, pas seulement un produit. Pour un camp de N jours :

1. construire les dates D…D+N−1 ;
2. verrouiller les lignes ressource/date dans un **ordre déterministe** (`ORDER BY slot_date FOR
   UPDATE`) pour réduire le risque de deadlock entre deux réservations multi-jours concurrentes ;
3. refuser si une seule date n'est pas ouverte/disponible ;
4. créer la ligne de commande et un `availability_block` portant la plage + l'id de la ligne source
   **dans la même transaction** ;
5. calculer l'indisponibilité des autres produits depuis ce blocage partagé — ne jamais parcourir
   côté application toutes les activités pour les fermer une par une après le commit ;
6. publier la notification prestataire seulement **après commit**. Un échec d'envoi est retentable
   et ne rouvre jamais les dates.

**Test supplémentaire obligatoire avant validation** : lancer en concurrence au minimum (a) une
réservation de camp 5 jours et (b) une réservation d'activité sur l'un de ces jours, toutes deux
visant la même ressource. Une seule opération incompatible doit réussir ; répéter au moins 5 runs,
comme au §2. Tester également deux camps dont les plages se chevauchent partiellement.

## 2. Test de concurrence réelle — squelette validé

**Pourquoi pas pgTAP** : chaque fichier `pg_prove` tourne dans une seule transaction, annulée en
rollback à la fin — structurellement une seule session active, aucune vraie concurrence possible
(cf. `hifago/CLAUDE.md` § 6). Le pattern retenu se fait au niveau RPC direct (driver `pg`, pas
Playwright/HTTP), contre une vraie instance Postgres locale, avec une **barrière de
synchronisation** — pas un `Promise.all` naïf, qui ne garantit aucun chevauchement réel.

```js
// spike-concurrency-test.mjs — adapter <nom_operation>/params au domaine réel.
import pg from 'pg';
const { Client } = pg;

const CONNECTION_STRING = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const N = 20; // tentatives concurrentes visant la même ressource à capacité limitée

async function main() {
  const clients = [];
  for (let i = 0; i < N; i++) {
    const client = new Client({ connectionString: CONNECTION_STRING });
    await client.connect();
    clients.push(client);
  }

  // Barrière : chaque worker signale qu'il est prêt, puis attend un signal commun.
  // Le signal ne se déclenche que lorsque TOUS les workers sont prêts, pour maximiser
  // le chevauchement réel des requêtes FOR UPDATE.
  let readyCount = 0;
  let resolveGo;
  const go = new Promise((resolve) => { resolveGo = resolve; });
  function markReady() { if (++readyCount === N) resolveGo(); }

  const results = await Promise.all(
    clients.map(async (client) => {
      markReady();
      await go;
      const res = await client.query('select <nom_operation>($1, $2, $3) as result', [
        /* p_resource_id */ 'test-resource',
        /* p_slot_date   */ '2026-12-24',
        /* p_qty         */ 1,
      ]);
      return res.rows[0].result;
    })
  );

  const successes = results.filter((r) => r.ok === true);
  console.log(`Succès : ${successes.length} / ${N} (doit être exactement 1)`);
  for (const client of clients) await client.end();
  process.exit(successes.length === 1 ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
```

**Barre d'acceptation** : au moins 5 exécutions consécutives propres (relancer avec un reset SQL
léger entre chaque run, pas `supabase db reset` — trop lent en boucle) avant de considérer une
nouvelle RPC critique validée. En cas d'échec ne serait-ce qu'une fois sur N runs, ne pas ignorer —
c'est un signal réel de trou dans le verrouillage.

## 3. Requête géo + JSONB combinée — pattern validé

Vérifié à 50 000 lignes (jeu de données volontairement dense en pire cas) : index GiST utilisé
(`Bitmap Index Scan`, pas de scan complet), p50 = 40 ms / p95 = 80 ms en round-trip. Détails
complets dans `04-architecture-cible.md` § Validation.

```sql
select
  id,
  coalesce(name->>'en', name->>'es') as name_display,
  ST_Distance(location, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) as distance_m
from products
where ST_DWithin(location, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $3)
order by distance_m
limit 20;
```

Prérequis : index GiST sur la colonne `geography` (`create index ... using gist (location)`) —
sans lui, PostGIS ne peut pas éviter un scan complet.
