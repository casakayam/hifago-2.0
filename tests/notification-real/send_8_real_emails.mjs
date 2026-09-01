// Spec 23 — ENVOI RÉEL des 8 emails transactionnels, depuis la stack Supabase LOCALE vers Resend.
//
// ⚠️ CE SCRIPT ENVOIE DE VRAIS EMAILS. Il n'est dans aucun job de CI, et il refuse de démarrer sans
// HIFAGO_REAL_EMAIL_SEND=1 et --yes. C'est le seul test du dépôt qui sort du réseau : les pgTAP
// tournent dans une transaction annulée (donc incapables d'envoyer) et
// tests/notification-integration/ intercepte Resend avec un serveur de fixtures local.
//
// Ce qu'il prouve, et que rien d'autre ne prouve : les 8 événements, déclenchés par leur VRAI
// chemin d'appel, produisent 8 emails qui arrivent réellement dans une boîte.
//
// PRÉREQUIS
//   1. `npx supabase stop && npx supabase start` — le conteneur edge-runtime fige ses variables
//      d'environnement à sa création : un `docker restart` ne relit jamais supabase/functions/.env.
//   2. supabase/functions/.env SANS ligne RESEND_API_BASE_URL (l'absence = envoi réel vers
//      api.resend.com), avec RESEND_API_KEY réelle et NOTIFICATION_EMAIL_FROM sur un domaine
//      vérifié chez Resend (aujourd'hui kayamproject.com — hifago.test serait rejeté en 403).
//   3. Le secret Vault `admin_app_public_url` posé en local, sinon create_partner_invitation
//      n'empile RIEN (raise warning silencieux) et l'email 1 n'existe jamais.
//
// ⚠️ TANT QUE LE .env EST DANS CET ÉTAT, `npm run test:notification-integration` enverrait 2 vrais
// emails vers @test.local, et tout e2e qui empile une notification part vraiment. Prévenir les
// autres sessions travaillant sur cette base locale partagée avant de lancer.
import pg from "pg";

const { Client } = pg;

const CONNECTION_STRING =
  process.env.PGURL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const FUNCTIONS_URL = "http://127.0.0.1:54321/functions/v1/send-notification-emails";
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

// Resend limite par défaut à 2 requêtes/seconde. Un 429 tomberait dans la branche !res.ok de
// l'Edge Function : attempts++ et un last_error inutile dans le journal qu'on veut garder propre.
const DISPATCH_INTERVAL_MS = 700;

// Préfixe UUID libre — 99990000/99991000/99992000 sont pris par les pgTAP de notification,
// 70000000 par create_order_camp.concurrency, 77770000 par pms-integration,
// a0000000/b0000000/c0000000/d0000000 par seed.sql.
const P = "88880000-0000-4000-8000-0000000000";

const ACCOUNTS = {
  A: { id: `${P}01`, email: "gabriel.34.miro@gmail.com", label: "admin" },
  B: { id: `${P}02`, email: "gmiro46+4@gmail.com", label: "socio proposant" },
  C: { id: `${P}03`, email: "gmiro46+5@gmail.com", label: "référent externe" },
  D: { id: `${P}04`, email: "gmiro46+6@gmail.com", label: "prestataire activité" },
  E: { id: `${P}05`, email: "gmiro46+8@gmail.com", label: "prestataire camp" },
};
const PARTNERS = { B: `${P}12`, C: `${P}13`, D: `${P}14`, E: `${P}15` };
const ESTABS = { B: `${P}22`, D: `${P}24`, E: `${P}25` };
const PRODUCTS = { B: `${P}32`, D: `${P}34`, E: `${P}35` };

const INVITATION_EMAIL = "gmiro46+1@gmail.com";
const CLIENT_EMAIL = "gmiro46+7@gmail.com";

// Dates volontairement hors de toute fenêtre utilisée ailleurs (seed : 2026, concurrence : 2029),
// et manifestement synthétiques une fois lues dans l'email reçu.
const ACTIVITY_DATE = "2031-03-01";
const CAMP_DATE = "2031-03-03";
const CAMP_DURATION_DAYS = 2;

// Identifiant unique du run, jamais une date civile — il ne sert qu'à suffixer des codes de test
// (`TEST8MAILS-INV-<tag>`) pour qu'un run n'écrase pas le précédent. `Date.now()` plutôt qu'un
// horodatage formaté : la règle fuseau du projet (eslint.rules.mjs, scripts/check-timezone.sh)
// interdit `new Date()` justement parce qu'un ISO tronqué RESSEMBLE à une date civile alors qu'il
// est en UTC. Ici on n'en veut pas une, donc on n'en fabrique pas l'apparence. (2026-09-01)
const RUN_TAG = String(Date.now());
const INVITATION_CODE = `TEST8MAILS-INV-${RUN_TAG}`;
const REFERRER_CODE = `TEST8MAILS-REF-${RUN_TAG}`;
const MP_PAYMENT_ID = `TEST8MAILS-MP-${RUN_TAG}`;

const UNDELIVERABLE_RE = "@(hifago\\.test|test\\.local)$";
const NEUTRALIZED_REASON =
  "domaine non délivrable (@hifago.test / @test.local) — neutralisé avant un envoi Resend réel";

// Aucun <, >, & ni " : les corps d'email n'échappent pas le HTML (faiblesse connue documentée dans
// docs/06-emails-transactionnels.md). Un nom mal choisi casserait le rendu du message reçu.
const NAMES = {
  B: "[TEST 8 EMAILS] Socio proposante",
  C: "[TEST 8 EMAILS] Referente externo",
  D: "[TEST 8 EMAILS] Proveedor actividad",
  E: "[TEST 8 EMAILS] Proveedor camp",
};

// Les 8 adresses de ce harnais — sert à retrouver nos propres lignes, jamais celles d'autrui.
const OUR_EMAILS = [
  ...Object.values(ACCOUNTS).map((a) => a.email),
  INVITATION_EMAIL,
  CLIENT_EMAIL,
];

const parkedIds = new Set();

// ---------------------------------------------------------------------------------------------
// Garde-fous d'entrée
// ---------------------------------------------------------------------------------------------

function assertAuthorized() {
  if (process.env.HIFAGO_REAL_EMAIL_SEND !== "1") {
    throw new Error(
      "Refus de démarrer : ce script envoie de VRAIS emails. Relancer avec HIFAGO_REAL_EMAIL_SEND=1."
    );
  }
  if (!process.argv.includes("--yes")) {
    throw new Error("Refus de démarrer : ajouter --yes pour confirmer l'envoi réel.");
  }
  if (!/@127\.0\.0\.1:54322\//.test(CONNECTION_STRING)) {
    throw new Error(
      `Refus de démarrer : la connexion doit viser la stack locale (127.0.0.1:54322), pas ${CONNECTION_STRING}.`
    );
  }
}

// ---------------------------------------------------------------------------------------------
// Connexions — une par identité, JAMAIS mutualisées
// ---------------------------------------------------------------------------------------------

// set_config(..., false) est SESSION-scoped, pas transactionnel : réutiliser une connexion ferait
// fuiter l'identité d'une phase à l'autre. Et create_order lit partner_accounts.saved_attribution_code
// dès que auth.uid() n'est pas null — un reste d'identité écraserait silencieusement l'attribution
// et ferait disparaître l'email 5.
async function connect(claimsAccountId) {
  const client = new Client({ connectionString: CONNECTION_STRING });
  await client.connect();
  if (claimsAccountId) {
    await client.query("select set_config('request.jwt.claims', $1, false)", [
      JSON.stringify({ sub: claimsAccountId, role: "authenticated" }),
    ]);
  }
  return client;
}

// ---------------------------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------------------------

// Purge des restes d'un run précédent. auth.users et partner_accounts sont volontairement épargnés :
// notification_emails.recipient_account_id les référence par clé étrangère SANS on delete, et le
// journal est conservé (demande de Jérôme). Les comptes sont donc réutilisés d'un run à l'autre.
// Un run interrompu laisse des lignes jamais envoyées. Elles n'ont rien à faire dans un journal
// d'ENVOI (aucun envoi n'a eu lieu), et elles feraient échouer le contrôle de lot du run suivant.
// Strictement bornée à nos 8 adresses et aux lignes sans provider_message_id : le journal des
// emails réellement partis, lui, n'est jamais touché.
async function purgeUnsentRunRows(sql) {
  const { rowCount } = await sql.query(
    `delete from notification_emails
      where recipient_email = any($1)
        and status in ('pending', 'sending')
        and provider_message_id is null`,
    [OUR_EMAILS]
  );
  return rowCount;
}

async function purgeBusinessFixtures(sql) {
  const partners = Object.values(PARTNERS);
  const estabs = Object.values(ESTABS);
  const products = Object.values(PRODUCTS);
  const accounts = Object.values(ACCOUNTS).map((a) => a.id);

  // Les commandes sont mémorisées AVANT toute suppression : une fois order_lines vidée, plus rien
  // ne relie une commande à nos produits, et un `delete from orders` par sous-requête ne trouverait
  // plus rien. L'ordre enfants → parents n'est pas négociable ici (ledger_entries et
  // availability_blocks pointent sur order_lines, order_lines et payments sur orders).
  const { rows: orderRows } = await sql.query(
    "select distinct order_id from order_lines where product_id = any($1)",
    [products]
  );
  const orderIds = orderRows.map((r) => r.order_id);

  if (orderIds.length > 0) {
    await sql.query(
      `delete from ledger_entries where order_line_id in (
         select id from order_lines where order_id = any($1))`,
      [orderIds]
    );
    await sql.query(
      `delete from availability_blocks where source_order_line_id in (
         select id from order_lines where order_id = any($1))`,
      [orderIds]
    );
    await sql.query("delete from payments where order_id = any($1)", [orderIds]);
    await sql.query("delete from order_lines where order_id = any($1)", [orderIds]);
    await sql.query("delete from orders where id = any($1)", [orderIds]);
  }
  await sql.query("delete from availability_blocks where establishment_id = any($1)", [estabs]);
  await sql.query("delete from audit_log where actor_id = any($1)", [accounts]);
  await sql.query(
    `delete from product_proposals where partner_id = any($1) or submitted_by = any($2)`,
    [partners, accounts]
  );
  await sql.query(
    `delete from establishment_proposals where partner_id = any($1) or submitted_by = any($2)`,
    [partners, accounts]
  );
  await sql.query("delete from partner_invitations where created_by = any($1)", [accounts]);
  await sql.query(
    "delete from payment_reconciliation_entries where failure_reason like 'TEST8MAILS%'"
  );
  await sql.query("delete from product_availability where product_id = any($1)", [products]);
  await sql.query("delete from provider_resource_calendar where establishment_id = any($1)", [estabs]);
  await sql.query("delete from products where id = any($1)", [products]);
  // partner_capabilities AVANT establishments : la capacité `operator` est scopée par
  // establishment_id, donc elle épingle l'établissement par clé étrangère.
  await sql.query(
    "delete from partner_capabilities where partner_id = any($1) or account_id = any($2)",
    [partners, accounts]
  );
  await sql.query("delete from establishments where id = any($1)", [estabs]);
  // partner_codes AVANT partners (partner_codes.partner_id référence partners), et
  // partner_accounts.saved_attribution_code référence partner_codes(code).
  await sql.query("update partner_accounts set saved_attribution_code = null where id = any($1)", [accounts]);
  await sql.query("delete from partner_codes where code like 'TEST8MAILS-%'");
  await sql.query("update partner_accounts set partner_id = null where id = any($1)", [accounts]);
  await sql.query("delete from partners where id = any($1)", [partners]);
}

async function seedFixtures(sql) {
  // Le trigger on_auth_user_created provisionne partner_accounts. `on conflict do nothing` rend le
  // script rejouable : les comptes survivent au nettoyage (ancres du journal).
  for (const account of Object.values(ACCOUNTS)) {
    await sql.query(
      "insert into auth.users (id, email) values ($1, $2) on conflict (id) do nothing",
      [account.id, account.email]
    );
  }

  for (const [key, id] of Object.entries(PARTNERS)) {
    await sql.query("insert into partners (id, display_name) values ($1, $2)", [id, NAMES[key]]);
  }
  await sql.query("update partner_accounts set partner_id = $1 where id = $2", [PARTNERS.B, ACCOUNTS.B.id]);
  await sql.query("update partner_accounts set partner_id = $1 where id = $2", [PARTNERS.C, ACCOUNTS.C.id]);
  await sql.query("update partner_accounts set partner_id = $1 where id = $2", [PARTNERS.D, ACCOUNTS.D.id]);
  await sql.query("update partner_accounts set partner_id = $1 where id = $2", [PARTNERS.E, ACCOUNTS.E.id]);

  // establishments.slug est dérivé du nom par le trigger establishments_set_slug et unique →
  // horodater le nom. products.slug n'a aucun trigger → le fournir explicitement.
  for (const [key, id] of Object.entries(ESTABS)) {
    await sql.query(
      "insert into establishments (id, partner_id, name) values ($1, $2, $3::jsonb)",
      [id, PARTNERS[key], JSON.stringify({ es: `${NAMES[key]} ${RUN_TAG}` })]
    );
  }

  // capacité admin scopée account_id (contrainte partner_capabilities_scope : partner_id NULL).
  await sql.query(
    `insert into partner_capabilities (account_id, role, source, status)
     values ($1, 'admin', 'migration', 'active')`,
    [ACCOUNTS.A.id]
  );
  // referrer AVANT operator — trigger partner_capabilities_operator_implies_referrer.
  for (const id of Object.values(PARTNERS)) {
    await sql.query(
      `insert into partner_capabilities (partner_id, role, source, status)
       values ($1, 'referrer', 'migration', 'active')`,
      [id]
    );
  }
  for (const key of ["B", "D", "E"]) {
    await sql.query(
      `insert into partner_capabilities (partner_id, role, source, status, establishment_id)
       values ($1, 'operator', 'migration', 'active', $2)`,
      [PARTNERS[key], ESTABS[key]]
    );
  }

  await sql.query(
    `insert into products (id, partner_id, establishment_id, type, name, description,
                           price_cop, sellable, slug, default_capacity, duration_days)
     values
       ($1, $2, $3, 'activity', $4::jsonb, $5::jsonb, 120000, true, $6, 10, null),
       ($7, $8, $9, 'activity', $10::jsonb, $11::jsonb, 150000, true, $12, 10, null),
       ($13, $14, $15, 'camp', $16::jsonb, $17::jsonb, 500000, true, $18, 10, $19)`,
    [
      PRODUCTS.B, PARTNERS.B, ESTABS.B,
      JSON.stringify({ es: "[TEST] Actividad del socio B" }),
      JSON.stringify({ es: "Producto de prueba, propuesta de contenido." }),
      `test8-act-b-${RUN_TAG}`,
      PRODUCTS.D, PARTNERS.D, ESTABS.D,
      JSON.stringify({ es: "[TEST] Actividad del proveedor D" }),
      JSON.stringify({ es: "Producto de prueba, pago confirmado." }),
      `test8-act-d-${RUN_TAG}`,
      PRODUCTS.E, PARTNERS.E, ESTABS.E,
      JSON.stringify({ es: "[TEST] Camp del proveedor E" }),
      JSON.stringify({ es: "Camp de prueba, recurso bloqueado." }),
      `test8-camp-e-${RUN_TAG}`, CAMP_DURATION_DAYS,
    ]
  );

  await sql.query(
    "insert into product_availability (product_id, date, capacity, booked) values ($1, $2, 10, 0), ($3, $4, 10, 0)",
    [PRODUCTS.D, ACTIVITY_DATE, PRODUCTS.E, CAMP_DATE]
  );
  // provider_resource_calendar sur CHACUN des duration_days jours, sinon create_order répond
  // resource_unavailable et l'email 8 n'existe jamais.
  await sql.query(
    `insert into provider_resource_calendar (establishment_id, slot_date, capacity, booked)
     select $1, $2::date + n, 5, 0 from generate_series(0, $3::int - 1) n`,
    [ESTABS.E, CAMP_DATE, CAMP_DURATION_DAYS]
  );

  await sql.query(
    "insert into partner_codes (code, partner_id, active) values ($1, $2, true)",
    [REFERRER_CODE, PARTNERS.C]
  );
}

// ---------------------------------------------------------------------------------------------
// Déclencheurs — chacun par son VRAI chemin d'appel
// ---------------------------------------------------------------------------------------------

function unwrap(result, label) {
  const payload = result.rows[0].r;
  if (!payload || payload.ok !== true) {
    throw new Error(`${label} a échoué : ${JSON.stringify(payload)}`);
  }
  return payload;
}

async function triggerAll({ sql, asAdmin, asSocio }) {
  const ids = {};

  // 1 · partner_invitation
  const invitation = unwrap(
    await asAdmin.query("select create_partner_invitation($1, 'referrer', null, 7, $2) as r", [
      INVITATION_CODE,
      INVITATION_EMAIL,
    ]),
    "create_partner_invitation"
  );
  ids.invitation = invitation.invitation_id;

  // 2 · admin_new_proposal (trigger AFTER INSERT sur product_proposals)
  const proposal = unwrap(
    await asSocio.query("select submit_product_proposal($1, $2::jsonb) as r", [
      PRODUCTS.B,
      JSON.stringify({
        name: { es: "[TEST] Actividad del socio B, propuesta" },
        description: { es: "Cambio de descripcion de prueba." },
        price_cop: 130000,
      }),
    ]),
    "submit_product_proposal"
  );
  ids.proposal = proposal.proposal_id;

  // 3 · admin_new_reconciliation_exception (trigger AFTER INSERT)
  const entry = await sql.query(
    `insert into payment_reconciliation_entries (raw_event, failure_reason)
     values ($1::jsonb, $2) returning id`,
    [JSON.stringify({ test8mails: true, run: RUN_TAG }), `TEST8MAILS ${RUN_TAG} — excepcion de prueba`]
  );
  ids.reconciliation = entry.rows[0].id;

  // 4 · partner_proposal_decided — REJET, jamais approbation : la branche approve réécrit
  // products.name/price_cop/capacity/default_capacity depuis le payload et mettrait à null tout ce
  // que le payload ne porte pas.
  unwrap(
    await asAdmin.query("select moderate_product_proposal($1, 'reject', 1, null, $2) as r", [
      ids.proposal,
      "Motivo de prueba: verificacion de los 8 correos.",
    ]),
    "moderate_product_proposal"
  );

  // 5, 6, 7 · une SEULE commande, une SEULE ligne. create_order résout le référent une fois par
  // commande : la ligne est external_referrer, donc elle alimente à la fois le fan-out commission
  // (jointure sur referrer_partner_id → C) et le fan-out paiement (jointure sur products.partner_id
  // → D). holder_email donne la confirmation client.
  const order = unwrap(
    await sql.query("select create_order($1::jsonb, $2, $3, null, false, $4, 'qr') as r", [
      JSON.stringify([{ product_id: PRODUCTS.D, date: ACTIVITY_DATE, qty: 2 }]),
      "Cliente de Prueba 8 Correos",
      CLIENT_EMAIL,
      REFERRER_CODE,
    ]),
    "create_order (activité)"
  );
  ids.order = order.order_id;

  const intent = unwrap(
    await sql.query("select create_payment_intent($1) as r", [ids.order]),
    "create_payment_intent"
  );
  unwrap(
    await sql.query("select apply_payment_webhook($1, $2, 'approved', $3::jsonb) as r", [
      MP_PAYMENT_ID,
      intent.payment_id,
      JSON.stringify({ test8mails: true, run: RUN_TAG }),
    ]),
    "apply_payment_webhook"
  );

  // 8 · partner_camp_evento_blocked — déclenché par create_order AVANT tout paiement.
  // Cette commande n'est délibérément JAMAIS payée : un webhook dessus rejouerait les emails 6 et 7
  // avec un related_id différent, donc non dédupliqués — deux doublons dans la boîte.
  const campOrder = unwrap(
    await sql.query("select create_order($1::jsonb, $2, $3, null, false, null, null) as r", [
      JSON.stringify([{ product_id: PRODUCTS.E, date: CAMP_DATE, qty: 1 }]),
      "Cliente de Prueba Camp",
      CLIENT_EMAIL,
    ]),
    "create_order (camp)"
  );
  ids.campOrder = campOrder.order_id;
  const campLine = await sql.query("select id from order_lines where order_id = $1", [ids.campOrder]);
  ids.campLine = campLine.rows[0].id;

  return ids;
}

// ---------------------------------------------------------------------------------------------
// Protection de la réputation d'envoi + parking
// ---------------------------------------------------------------------------------------------

// Une ligne vers @hifago.test / @test.local ne pourra JAMAIS être délivrée : la laisser partir
// produit un bounce dur qui abîme la réputation du domaine expéditeur. On la passe en 'abandoned'
// (état terminal que claim_notification_email_batch ne réclame jamais) plutôt que de la supprimer —
// le journal garde la trace et l'explication. Couvre d'un coup les lignes héritées d'autres runs ET
// les copies des emails 2 et 3 destinées à l'admin seedé (notify_all_admins arrose tous les admins).
async function neutralizeUndeliverable(sql) {
  const { rows } = await sql.query(
    `update notification_emails
        set status = 'abandoned', last_error = $1
      where status = 'pending' and recipient_email ~* $2
      returning id, event_type, recipient_email`,
    [NEUTRALIZED_REASON, UNDELIVERABLE_RE]
  );
  return rows;
}

// L'Edge Function appelle claim_notification_email_batch avec p_limit: 20 EN DUR et ignore le corps
// de la requête. Le seul levier pour n'envoyer qu'une ligne à la fois est donc de contrôler ce qui
// est 'pending' au moment de l'appel.
async function parkAllExcept(sql, targetId) {
  const { rows } = await sql.query(
    `update notification_emails set status = 'sending', last_attempt_at = now()
      where status = 'pending' and id <> $1
      returning id, recipient_email`,
    [targetId]
  );
  for (const row of rows) parkedIds.add(row.id);

  // Re-tamponner les lignes parkées aux tours précédents : claim_notification_email_batch reprend
  // toute ligne 'sending' vieille de plus de 10 minutes. Un run qui traîne les relâcherait dans le lot.
  if (parkedIds.size > 0) {
    await sql.query(
      "update notification_emails set last_attempt_at = now() where id = any($1) and status = 'sending'",
      [[...parkedIds]]
    );
  }
  // La cible a pu être parkée à un tour précédent : la remettre en 'pending' APRÈS le parking.
  await sql.query(
    "update notification_emails set status = 'pending' where id = $1 and status = 'sending'",
    [targetId]
  );
  return rows;
}

async function unparkAll(sql) {
  if (parkedIds.size === 0) return;
  // `and status = 'sending'` protège nos propres lignes déjà passées à 'sent'.
  await sql.query(
    "update notification_emails set status = 'pending' where id = any($1) and status = 'sending'",
    [[...parkedIds]]
  );
}

// ---------------------------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------------------------

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function dispatchOne(sql, row, ourIds) {
  const foreign = await parkAllExcept(sql, row.id);
  // Nos 7 autres lignes en attente sont évidemment parkées elles aussi : seules comptent celles qui
  // ne sont PAS de ce run. Une ligne étrangère vers un vrai domaine, elle, appartient à quelqu'un
  // d'autre — on ne l'envoie pas à sa place, on s'arrête.
  const suspicious = foreign.filter(
    (r) => !ourIds.has(r.id) && !/@(hifago\.test|test\.local)$/i.test(r.recipient_email)
  );
  if (suspicious.length > 0) {
    throw new Error(
      `Ligne(s) 'pending' inattendue(s) vers un vrai domaine, appartenant à une autre session : ` +
        `${suspicious.map((r) => r.recipient_email).join(", ")} — arrêt, on ne les envoie pas.`
    );
  }

  const response = await fetch(FUNCTIONS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
    body: JSON.stringify({}),
  });
  if (!response.ok) {
    throw new Error(`send-notification-emails a répondu ${response.status} : ${await response.text()}`);
  }
  const summary = await response.json();

  if (summary.reason === "missing_api_key") {
    throw new Error(
      "RESEND_API_KEY absente du conteneur edge-runtime. Poser la clé dans supabase/functions/.env " +
        "puis `npx supabase stop && npx supabase start` (un docker restart ne relit pas ce fichier)."
    );
  }
  if (summary.claimed !== 1) {
    throw new Error(
      `Lot inattendu : claimed=${summary.claimed} au lieu de 1 — une ligne étrangère s'est invitée, arrêt.`
    );
  }
  if (summary.sent !== 1 || summary.failed !== 0) {
    const { rows } = await sql.query("select last_error from notification_emails where id = $1", [row.id]);
    throw new Error(
      `Envoi refusé par Resend (sent=${summary.sent}, failed=${summary.failed}) : ${rows[0]?.last_error}`
    );
  }
  return summary;
}

// ---------------------------------------------------------------------------------------------
// Vérification
// ---------------------------------------------------------------------------------------------

function expectedRows(ids) {
  return [
    { n: 1, event_type: "partner_invitation", related_table: "partner_invitations", related_id: ids.invitation, to: INVITATION_EMAIL },
    { n: 2, event_type: "admin_new_proposal", related_table: "product_proposals", related_id: ids.proposal, to: ACCOUNTS.A.email },
    { n: 3, event_type: "admin_new_reconciliation_exception", related_table: "payment_reconciliation_entries", related_id: ids.reconciliation, to: ACCOUNTS.A.email },
    { n: 4, event_type: "partner_proposal_decided", related_table: "product_proposals", related_id: ids.proposal, to: ACCOUNTS.B.email },
    { n: 5, event_type: "partner_commission_earned", related_table: "orders", related_id: ids.order, to: ACCOUNTS.C.email },
    { n: 6, event_type: "partner_payment_confirmed", related_table: "orders", related_id: ids.order, to: ACCOUNTS.D.email },
    { n: 7, event_type: "client_order_confirmed", related_table: "orders", related_id: ids.order, to: CLIENT_EMAIL },
    { n: 8, event_type: "partner_camp_evento_blocked", related_table: "order_lines", related_id: ids.campLine, to: ACCOUNTS.E.email },
  ];
}

async function findQueuedRow(sql, expected) {
  const { rows } = await sql.query(
    `select id, event_type, recipient_email, subject, status, attempts, provider_message_id, last_error
       from notification_emails
      where event_type = $1 and related_table = $2 and related_id = $3 and recipient_email = $4`,
    [expected.event_type, expected.related_table, expected.related_id, expected.to]
  );
  return rows[0];
}

// ---------------------------------------------------------------------------------------------
// Nettoyage final
// ---------------------------------------------------------------------------------------------

async function finalCleanup(sql) {
  await purgeUnsentRunRows(sql);
  await purgeBusinessFixtures(sql);
  // Le compte admin de test survit comme ancre du journal, mais sa capacité est retirée : sans ce
  // geste, chaque proposition créée en dev local enverrait un email réel à la boîte de Jérôme.
  await sql.query("delete from partner_capabilities where account_id = $1", [ACCOUNTS.A.id]);
}

// ---------------------------------------------------------------------------------------------

async function main() {
  assertAuthorized();

  const sql = await connect(null);
  const asAdmin = await connect(ACCOUNTS.A.id);
  const asSocio = await connect(ACCOUNTS.B.id);
  let exitCode = 0;

  try {
    console.log(`Run ${RUN_TAG} — envoi RÉEL via Resend depuis la stack locale.\n`);

    const leftovers = await purgeUnsentRunRows(sql);
    if (leftovers > 0) {
      console.log(`${leftovers} ligne(s) jamais envoyée(s) d'un run précédent retirée(s) de la file.`);
    }
    await purgeBusinessFixtures(sql);
    await seedFixtures(sql);
    console.log("Fixtures posées (5 comptes, 4 partenaires, 3 établissements, 3 produits).");

    const ids = await triggerAll({ sql, asAdmin, asSocio });
    console.log("Les 8 événements ont été déclenchés par leur vrai chemin d'appel.\n");

    const neutralized = await neutralizeUndeliverable(sql);
    if (neutralized.length > 0) {
      console.log(`${neutralized.length} ligne(s) vers un domaine non délivrable neutralisée(s) :`);
      for (const row of neutralized) console.log(`   ${row.event_type} → ${row.recipient_email}`);
      console.log("");
    }

    const expected = expectedRows(ids);
    const queued = [];
    for (const item of expected) {
      const row = await findQueuedRow(sql, item);
      if (!row) throw new Error(`Email ${item.n} (${item.event_type}) n'a jamais été empilé.`);
      queued.push({ ...item, ...row });
    }

    const ourIds = new Set(queued.map((r) => r.id));
    for (const [index, row] of queued.entries()) {
      await dispatchOne(sql, row, ourIds);
      console.log(`   ${row.n}. ${row.event_type} → ${row.recipient_email}`);
      if (index < queued.length - 1) await sleep(DISPATCH_INTERVAL_MS);
    }
    console.log("");

    const results = [];
    for (const item of queued) {
      results.push({ ...item, ...(await findQueuedRow(sql, item)) });
    }

    console.log("| # | événement                          | destinataire              | statut | id Resend |");
    console.log("|---|------------------------------------|---------------------------|--------|-----------|");
    let failed = false;
    for (const row of results) {
      const isReal = !!row.provider_message_id && !row.provider_message_id.startsWith("fixture-message-");
      const ok = row.status === "sent" && isReal;
      if (!ok) failed = true;
      console.log(
        `| ${row.n} | ${row.event_type.padEnd(34)} | ${row.recipient_email.padEnd(25)} | ` +
          `${(ok ? "envoyé" : row.status).padEnd(6)} | ${row.provider_message_id ?? row.last_error ?? "—"} |`
      );
    }

    if (failed) {
      console.error(
        "\nÉchec — au moins un email n'est pas parti réellement. Un provider_message_id préfixé " +
          "`fixture-message-` signifie que RESEND_API_BASE_URL est encore posé dans supabase/functions/.env."
      );
      exitCode = 1;
    } else {
      console.log(
        `\nLes 8 emails sont partis chez Resend. À vérifier maintenant dans les boîtes :\n` +
          `   ${ACCOUNTS.A.email} → 2 messages (emails 2 et 3)\n` +
          `   gmiro46 (alias +1, +4, +5, +6, +7, +8) → 6 messages\n` +
          `Rappel : les emails 2 et 3 portent des liens relatifs, donc morts dans un client mail, et ` +
          `les emails 5 et 6 sont volontairement sans détail. Faiblesses connues, pas des ratés du test.`
      );
    }
  } catch (err) {
    console.error(err);
    exitCode = 1;
  } finally {
    await unparkAll(sql).catch((err) => console.error("Dé-parking final a échoué :", err));
    await finalCleanup(sql).catch((err) => console.error("Nettoyage final a échoué :", err));
    await Promise.all([sql.end(), asAdmin.end(), asSocio.end()]);
  }

  process.exit(exitCode);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
