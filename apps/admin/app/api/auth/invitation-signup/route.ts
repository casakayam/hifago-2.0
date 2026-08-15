import { createClient } from "@hifago/supabase/server";
import { createServiceRoleClient } from "@hifago/supabase/service";

// Feature 31 (docs/specs/07-connexion-inscription-complete.md §7) — remplace l'appel client
// supabase.auth.signUp() de JoinForm.tsx : maintenant que enable_confirmations = true, un signUp
// client-side ne renverrait plus de session immédiate, ce qui casserait l'atterrissage instantané
// de /partner/join (Feature 29). Ce Route Handler crée le compte déjà confirmé (service_role,
// admin.createUser({email_confirm:true})) puis établit la session — consume_partner_invitation
// reste l'unique autorité de consommation du jeton, appelée par le client juste après.
//
// Pré-contrôle en lecture seule via la RPC check_partner_invitation (SECURITY DEFINER) — PAS une
// lecture directe de partner_invitations via service_role : cette table est RPC-only (revoke
// insert/update/delete ET aucun GRANT SELECT à service_role, 20260813163456_identity_rls.sql),
// service_role contourne la RLS mais jamais l'absence de GRANT, "permission denied for table
// partner_invitations" constaté en écrivant cette route. Préserve l'invariant déjà testé « une
// invitation invalide échoue sans créer de compte partiel » (docs/5-conception/roles-composables.md
// §9) — une fenêtre de concurrence résiduelle entre ce pré-contrôle et l'appel RPC réel reste
// possible (cas limite documenté §9 de la spec), mais n'entraîne jamais la création d'un compte
// pour un jeton déjà invalide au moment de la requête.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as
    | { token?: string; email?: string; password?: string }
    | null;
  const token = body?.token;
  const email = body?.email;
  const password = body?.password;
  if (!token || !email || !password) {
    return Response.json({ ok: false, reason: "invalid_request" }, { status: 400 });
  }

  const supabaseAnon = await createClient();
  const { data: check, error: checkError } = await supabaseAnon.rpc("check_partner_invitation", {
    p_token: token,
  });
  const checkResult = check as { ok: boolean; reason?: string } | null;
  if (checkError || !checkResult?.ok) {
    return Response.json(
      { ok: false, reason: checkResult?.reason ?? "invitation_not_found" },
      { status: 404 }
    );
  }

  const service = createServiceRoleClient();
  const { data: created, error: createError } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (createError || !created.user) {
    // Jamais de détail (fuite d'existence de compte) — email déjà pris est la cause la plus
    // probable, mais le message reste générique.
    return Response.json({ ok: false, reason: "email_already_used" }, { status: 409 });
  }

  // Établit la session (cookies) sur cette même réponse — le compte vient d'être créé confirmé,
  // ce signInWithPassword ne peut échouer que sur une incohérence interne.
  const supabase = await createClient();
  const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
  if (signInError) {
    return Response.json({ ok: false, reason: "session_failed" }, { status: 500 });
  }

  return Response.json({ ok: true });
}
