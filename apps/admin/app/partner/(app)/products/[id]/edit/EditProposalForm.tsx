"use client";

import { useState } from "react";
import { createClient } from "@hifago/supabase/client";
import { asLocalizedField, resolveLocalizedField } from "@hifago/domain";
import { NO_PRODUCT_CATEGORY, PRODUCT_CATEGORIES } from "@/lib/products/categories";
import { Button, Input, Label, ListBox, Select, TextField } from "@hifago/ui";

const SUBMIT_ERRORS: Record<string, string> = {
  product_not_found: "No se encontró la actividad.",
  capability_suspended: "Tu capacidad de operador para este establecimiento no está activa.",
  pending_cap_exceeded:
    "Ya tienes 10 propuestas pendientes. Espera a que se revisen antes de enviar más.",
  not_authenticated: "No se pudo verificar tu sesión. Vuelve a intentarlo.",
};

const WITHDRAW_ERRORS: Record<string, string> = {
  proposal_not_found: "No se encontró la propuesta.",
  not_pending: "Esta propuesta ya fue procesada.",
  not_authenticated: "No se pudo verificar tu sesión. Vuelve a intentarlo.",
};

type PendingProposal = { id: string; payload: unknown; created_at: string } | null;

export function EditProposalForm({
  productId,
  initialNameEs,
  initialNameEn,
  initialDescriptionEs,
  initialDescriptionEn,
  initialPriceCop,
  initialCategory,
  pendingProposal,
}: {
  productId: string;
  initialNameEs: string;
  initialNameEn: string;
  initialDescriptionEs: string;
  initialDescriptionEn: string;
  initialPriceCop: number;
  initialCategory: string | null;
  pendingProposal: PendingProposal;
}) {
  // Pré-rempli avec la fiche COMPLÈTE actuelle, pas seulement les champs à modifier (propriété de
  // sûreté n°3, cf. plan feature 15) : un champ non retouché doit porter sa valeur actuelle dans
  // le payload envoyé au serveur.
  const [nameEs, setNameEs] = useState(initialNameEs);
  const [nameEn, setNameEn] = useState(initialNameEn);
  const [descriptionEs, setDescriptionEs] = useState(initialDescriptionEs);
  const [descriptionEn, setDescriptionEn] = useState(initialDescriptionEn);
  const [priceCop, setPriceCop] = useState(String(initialPriceCop));
  const [category, setCategory] = useState(initialCategory ?? NO_PRODUCT_CATEGORY);

  const [proposal, setProposal] = useState(pendingProposal);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isWithdrawing, setIsWithdrawing] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    const price = Number(priceCop);
    if (!nameEs.trim() || !Number.isFinite(price) || price <= 0) {
      setError("El nombre (es) y el precio son obligatorios.");
      return;
    }

    setIsSubmitting(true);

    const name: Record<string, string> = { es: nameEs.trim() };
    if (nameEn.trim()) name.en = nameEn.trim();

    const description: Record<string, string> | null = descriptionEs.trim()
      ? { es: descriptionEs.trim(), ...(descriptionEn.trim() ? { en: descriptionEn.trim() } : {}) }
      : null;

    const payload = {
      name,
      description,
      price_cop: price,
      category: category === NO_PRODUCT_CATEGORY ? null : category,
    };

    const supabase = createClient();
    const { data, error: rpcError } = await supabase.rpc("submit_product_proposal", {
      p_product_id: productId,
      p_payload: payload,
    });

    setIsSubmitting(false);

    const result = data as { ok: boolean; reason?: string; proposal_id?: string } | null;
    if (rpcError || !result?.ok) {
      setError(
        SUBMIT_ERRORS[result?.reason ?? ""] ?? "No se pudo enviar la propuesta. Inténtalo de nuevo."
      );
      return;
    }

    // Reflète la proposition tout juste créée directement depuis la réponse RPC, sans dépendre
    // d'un aller-retour serveur : un `router.refresh()` ne suffirait pas ici, useState(props) ne
    // se resynchronise pas tout seul sur une nouvelle valeur de prop après le montage initial.
    if (result.proposal_id) {
      setProposal({
        id: result.proposal_id,
        payload,
        created_at: new Date().toISOString(),
      });
    }
  }

  async function handleWithdraw() {
    if (!proposal) return;
    setError(null);
    setIsWithdrawing(true);

    const supabase = createClient();
    const { data, error: rpcError } = await supabase.rpc("withdraw_product_proposal", {
      p_proposal_id: proposal.id,
    });

    setIsWithdrawing(false);

    const result = data as { ok: boolean; reason?: string } | null;
    if (rpcError || !result?.ok) {
      setError(
        WITHDRAW_ERRORS[result?.reason ?? ""] ?? "No se pudo retirar la propuesta. Inténtalo de nuevo."
      );
      return;
    }

    setProposal(null);
  }

  const proposedName = proposal
    ? resolveLocalizedField(asLocalizedField((proposal.payload as { name?: unknown })?.name), "es")
    : null;

  return (
    <div className="flex max-w-md flex-col gap-6">
      {proposal ? (
        <div
          className="flex flex-col gap-2 rounded-lg border border-border p-4"
          data-testid="pending-proposal"
        >
          <p className="text-sm font-medium">Propuesta pendiente de revisión</p>
          <p className="text-sm text-muted">{proposedName ?? proposal.id}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            isDisabled={isWithdrawing}
            onPress={handleWithdraw}
            data-testid="withdraw-proposal-button"
          >
            {isWithdrawing ? "Retirando…" : "Retirar"}
          </Button>
        </div>
      ) : null}

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <TextField fullWidth name="name-es" value={nameEs} onChange={setNameEs} isRequired>
          <Label>Nombre (es)</Label>
          <Input />
        </TextField>
        <TextField fullWidth name="name-en" value={nameEn} onChange={setNameEn}>
          <Label>Nombre (en) — opcional</Label>
          <Input />
        </TextField>
        <TextField fullWidth name="description-es" value={descriptionEs} onChange={setDescriptionEs}>
          <Label>Descripción (es) — opcional</Label>
          <Input />
        </TextField>
        <TextField fullWidth name="description-en" value={descriptionEn} onChange={setDescriptionEn}>
          <Label>Descripción (en) — opcional</Label>
          <Input />
        </TextField>
        <TextField fullWidth name="price" value={priceCop} onChange={setPriceCop} isRequired>
          <Label>Precio (COP)</Label>
          <Input type="number" min={1} />
        </TextField>
        <Select
          fullWidth
          placeholder="Selecciona una categoría"
          value={category}
          onChange={(value) => value && setCategory(value as string)}
        >
          <Label>Categoría</Label>
          <Select.Trigger data-testid="category-select">
            <Select.Value />
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover>
            <ListBox>
              <ListBox.Item id={NO_PRODUCT_CATEGORY} textValue="— Sin categoría —">
                — Sin categoría —
                <ListBox.ItemIndicator />
              </ListBox.Item>
              {PRODUCT_CATEGORIES.map((item) => (
                <ListBox.Item key={item.value} id={item.value} textValue={item.label}>
                  {item.label}
                  <ListBox.ItemIndicator />
                </ListBox.Item>
              ))}
            </ListBox>
          </Select.Popover>
        </Select>
        {error ? (
          <p role="alert" data-testid="proposal-error" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
        <Button type="submit" isDisabled={isSubmitting} data-testid="submit-proposal-button">
          {isSubmitting ? "Enviando…" : "Enviar propuesta"}
        </Button>
      </form>
    </div>
  );
}
