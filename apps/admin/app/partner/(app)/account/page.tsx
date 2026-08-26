import { redirect } from "next/navigation";
import { createClient } from "@hifago/supabase/server";
import { LogoutButton } from "@/components/LogoutButton";
import { ProfileBlock } from "./ProfileBlock";
import { EmailBlock } from "./EmailBlock";
import { PasswordBlock } from "./PasswordBlock";
import { PayoutAccountBlock } from "./PayoutAccountBlock";

// Server Component qui fait le fetch et passe des données déjà sérialisées à des sous-composants
// "use client" (idiome hifago/CLAUDE.md §2 point 3a) — les 3 blocs touchent des ressources
// distinctes (partner_accounts, auth.users email, mot de passe) et sont donc des composants
// séparés plutôt qu'un unique formulaire.
export default async function PartnerAccountPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login?next=/partner/account");
  }

  const { data: account } = await supabase
    .from("partner_accounts")
    .select("full_name, phone, partner_id")
    .eq("id", user.id)
    .maybeSingle();

  // La cuenta de pago n'a de sens que pour une identité referrer (elle seule reçoit une
  // commission) — un operator pur n'a rien à y faire, cf. partner_payout_accounts (spec 19
  // §10 point 7). N'importe quel statut ('active' ou 'suspended'), même raisonnement que
  // hasOperatorCapability dans nav-items.ts.
  const { data: referrerCapability } = account?.partner_id
    ? await supabase
        .from("partner_capabilities")
        .select("id")
        .eq("partner_id", account.partner_id)
        .eq("role", "referrer")
        .maybeSingle()
    : { data: null };

  const { data: payoutAccount } = account?.partner_id
    ? await supabase
        .from("partner_payout_accounts")
        .select("mercadopago_account")
        .eq("partner_id", account.partner_id)
        .maybeSingle()
    : { data: null };

  return (
    <div className="flex max-w-xl flex-col gap-6">
      <h1 className="text-2xl font-semibold">Mi cuenta</h1>

      <ProfileBlock
        initialFullName={account?.full_name ?? ""}
        initialPhone={account?.phone ?? ""}
      />
      <EmailBlock initialEmail={user.email ?? ""} />
      <PasswordBlock />
      {referrerCapability ? (
        <PayoutAccountBlock initialMercadopagoAccount={payoutAccount?.mercadopago_account ?? ""} />
      ) : null}

      <section className="flex flex-col gap-3 border-t border-border pt-6">
        <h2 className="text-lg font-medium">Cerrar sesión</h2>
        <p className="text-sm text-muted">Cierra tu sesión en este dispositivo.</p>
        <LogoutButton data-testid="logout-button-page" />
      </section>
    </div>
  );
}
