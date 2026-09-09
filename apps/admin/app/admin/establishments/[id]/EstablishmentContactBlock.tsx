"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@hifago/supabase/client";
import { Button, Input, Label, TextField, toast } from "@hifago/ui";

// Spec 30 (Tranche 2) — le contact WhatsApp PUBLIC du lieu, affiché sur la fiche établissement.
//
// Bloc séparé à sauvegarde immédiate, exactement comme EstablishmentStayBlock : il appelle
// `update_establishment_contact` et JAMAIS `update_establishment`, qui remplace tous ses champs et
// est appelée par trois chemins de modération de propositions — l'étendre aurait fait écraser ce
// contact à chaque approbation, sans erreur et sans trace.
//
// ⚠️ Sans cet écran, la colonne posée ce matin ne serait remplissable que par le seed : un
// établissement créé en préprod ou en production naîtrait sans contact et le RESTERAIT. C'est la
// leçon de la spec 29 Tranche 3 — la différence entre une fonctionnalité montrable et une
// fonctionnalité livrée.
//
// ⚠️ Ce numéro est PUBLIC, contrairement à `partners.phone` et `partner_accounts.phone`, qui
// restent protégés par l'absence de policy publique. Ne jamais « simplifier » en lisant l'un des
// deux : ils décrivent une PERSONNE ou une ORGANISATION, celui-ci décrit un LIEU.

// E.164 — le MÊME motif que la contrainte `establishments_contact_phone_e164` et que la RPC.
// ⚠️ Trois copies de la même règle, et c'est assumé : celle-ci sert à expliquer AVANT d'envoyer,
// la RPC rend un motif lisible, la contrainte est le seul rempart qu'on ne peut pas contourner.
// Si elles divergent un jour, c'est la contrainte qui a raison.
const E164 = /^\+[1-9][0-9]{7,14}$/;

export function EstablishmentContactBlock({
  establishmentId,
  initialContactPhone,
}: {
  establishmentId: string;
  initialContactPhone: string | null;
}) {
  const router = useRouter();
  const [phone, setPhone] = useState(initialContactPhone ?? "");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const saisi = phone.trim();
  // Le champ VIDE est valide : c'est ainsi qu'on retire le bouton de la fiche publique.
  const formatInvalide = saisi.length > 0 && !E164.test(saisi);

  async function handleSave() {
    setIsSubmitting(true);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("update_establishment_contact", {
      p_establishment_id: establishmentId,
      // `undefined` et non `null` : un paramètre à valeur par défaut est typé optionnel côté types
      // générés, et la RPC applique alors son défaut `null` — donc vider le champ EFFACE bien le
      // contact. Même idiome qu'EstablishmentStayBlock.
      p_contact_phone: saisi || undefined,
    });
    setIsSubmitting(false);

    const result = data as { ok: boolean; reason?: string } | null;
    if (error || !result?.ok) {
      toast.danger(
        result?.reason === "invalid_phone"
          ? "El número debe estar en formato internacional, por ejemplo +573001234567."
          : "No se pudo guardar el contacto.",
      );
      return;
    }
    toast.success(saisi ? "Contacto actualizado." : "Contacto eliminado.");
    router.refresh();
  }

  return (
    <section
      className="flex flex-col gap-4 rounded-lg border bg-surface p-4"
      data-testid="establishment-contact-block"
    >
      <h2 className="text-lg font-medium">Contacto público</h2>

      <p className="text-sm text-muted">
        Se muestra en la ficha pública del establecimiento como botón de WhatsApp. Déjalo vacío para
        no mostrar ningún contacto.
      </p>

      <TextField fullWidth name="establishment-contact-phone" value={phone} onChange={setPhone}>
        <Label>WhatsApp — opcional</Label>
        <Input
          type="tel"
          placeholder="+573001234567"
          data-testid="establishment-contact-phone-input"
        />
      </TextField>

      {/* Message porté à côté du champ plutôt que par une prop `error` : le `TextField` de
          `@hifago/ui` n'en a pas. Même forme que `lobby-option-picker.tsx`, la convention locale. */}
      {formatInvalide ? (
        <p className="text-sm text-danger" data-testid="establishment-contact-phone-error">
          Formato internacional obligatorio, por ejemplo +573001234567.
        </p>
      ) : null}

      <div>
        <Button
          onPress={handleSave}
          isDisabled={isSubmitting || formatInvalide}
          data-testid="save-establishment-contact-button"
        >
          Guardar
        </Button>
      </div>
    </section>
  );
}
