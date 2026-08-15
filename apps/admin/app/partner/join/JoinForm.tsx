"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@hifago/supabase/client";
import { Button, Checkbox, Input, Label, TextField } from "@hifago/ui";
import { PartnerTermsModal } from "./PartnerTermsModal";

// Messages en français en dur : cette app, hors next-intl (cf. hifago/CLAUDE.md — l'i18n ne
// vise qu'apps/web), pas une violation de la règle i18n.
const ERROR_MESSAGES: Record<string, string> = {
  invitation_not_found: "Ce lien d'invitation est introuvable.",
  already_consumed: "Cette invitation a déjà été utilisée.",
  already_revoked: "Cette invitation a été révoquée.",
  already_expired: "Cette invitation a expiré.",
  expired: "Cette invitation a expiré.",
  account_already_has_partner: "Ce compte est déjà rattaché à un partenaire.",
  not_authenticated: "La session n'a pas pu être établie. Réessayez.",
  // Feature 31 (docs/specs/07-connexion-inscription-complete.md §7) : raisons renvoyées par
  // POST /api/auth/invitation-signup, jamais par consume_partner_invitation elle-même.
  email_already_used: "Cet email est déjà utilisé par un autre compte.",
  session_failed: "La session n'a pas pu être établie. Réessayez.",
};

type ConsumeResult = { ok: boolean; reason?: string; roles?: string[]; partner_id?: string };
type SignupResult = { ok: boolean; reason?: string };

export function JoinForm({ token }: { token: string | null }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [termsOpen, setTermsOpen] = useState(false);

  if (!token) {
    return (
      <p role="alert" data-testid="invalid-token-error" className="text-sm text-danger">
        Ce lien d&apos;invitation est invalide : le jeton est manquant.
      </p>
    );
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    // Inatteignable en pratique (l'écran affiche déjà le message "lien invalide" plus haut sans
    // rendre ce formulaire quand token est absent) — garde ici uniquement pour que TypeScript
    // resserre `token` en `string` dans cette fermeture, définie après ce early return.
    if (!token) return;
    setError(null);
    setIsSubmitting(true);

    // Feature 31 (docs/specs/07-connexion-inscription-complete.md §7) : la vérification email
    // (enable_confirmations = true) empêcherait désormais un signUp() client-side de renvoyer une
    // session immédiate — ce Route Handler crée le compte déjà confirmé côté serveur (service_role)
    // et établit la session, pour que ce parcours reste instantané comme avant.
    const signupResponse = await fetch("/api/auth/invitation-signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, email, password }),
    });
    const signupResult = (await signupResponse.json()) as SignupResult;

    if (!signupResult.ok) {
      setError(
        ERROR_MESSAGES[signupResult.reason ?? ""] ??
          "Impossible de créer le compte. Vérifiez vos informations ou connectez-vous si vous avez déjà un compte."
      );
      setIsSubmitting(false);
      return;
    }

    const supabase = createClient();

    // Un seul aller-retour pour la consommation elle-même — explicit_consent vaut true dès que ce
    // formulaire est soumis (case cochée obligatoire pour activer le bouton, pas une vérification
    // serveur en plus, cf. plan Feature 13).
    const { data, error: rpcError } = await supabase.rpc("consume_partner_invitation", {
      p_token: token,
      p_signer_name: name,
      p_document_version: "v1",
    });

    setIsSubmitting(false);

    if (rpcError) {
      setError("Une erreur est survenue. Réessayez.");
      return;
    }

    const result = data as ConsumeResult;
    if (!result.ok) {
      setError(ERROR_MESSAGES[result.reason ?? ""] ?? "Une erreur est survenue. Réessayez.");
      return;
    }

    // Redirection immédiate vers le dashboard (spec §5.2) plutôt qu'un message inline : l'état
    // (rôle obtenu, établissement en attente éventuel) est recalculé à la volée par cette page,
    // pas transmis ici — robuste à un refresh, jamais un state éphémère perdu.
    router.push("/partner");
  }

  return (
    <form onSubmit={handleSubmit} className="flex w-full flex-col gap-4">
      <TextField fullWidth name="name" value={name} onChange={setName} isRequired>
        <Label>Nom complet</Label>
        <Input />
      </TextField>
      <TextField fullWidth name="email" value={email} onChange={setEmail} isRequired>
        <Label>Email</Label>
        <Input type="email" autoComplete="email" />
      </TextField>
      <TextField fullWidth name="password" value={password} onChange={setPassword} isRequired>
        <Label>Mot de passe</Label>
        <Input type="password" autoComplete="new-password" />
      </TextField>
      <div className="flex flex-col gap-1.5">
        <Checkbox data-testid="consent-checkbox" isSelected={consent} onChange={setConsent}>
          <Checkbox.Content>
            <Checkbox.Control>
              <Checkbox.Indicator />
            </Checkbox.Control>
            J&apos;accepte les conditions du rôle partenaire.
          </Checkbox.Content>
        </Checkbox>
        {/* Hors de Checkbox.Content (CheckboxButton react-aria, toute la zone est pressable) —
            un bouton imbriqué y déclencherait aussi le toggle de la case au lieu d'ouvrir la
            modale seule. */}
        <button
          type="button"
          onClick={() => setTermsOpen(true)}
          data-testid="view-terms-button"
          className="self-start text-xs text-muted underline"
        >
          Voir les conditions
        </button>
      </div>
      <PartnerTermsModal open={termsOpen} onOpenChange={setTermsOpen} />
      {error ? (
        <p role="alert" data-testid="join-error" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      <Button type="submit" isDisabled={isSubmitting || !consent} data-testid="join-submit-button">
        {isSubmitting ? "Création…" : "Rejoindre"}
      </Button>
    </form>
  );
}
