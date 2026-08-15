"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@hifago/supabase/client";
import { Button, Checkbox, Label, TextField, TextArea, Select, ListBox } from "@hifago/ui";

type Audience = "clients" | "referrers" | "providers" | "partners" | "all";
type Channel = "whatsapp" | "email";
type CreateCampaignResult = { ok: boolean; campaign_id?: string; targets?: number };

const AUDIENCE_LABELS: Record<Audience, string> = {
  clients: "Clientes",
  referrers: "Referentes",
  providers: "Prestadores",
  partners: "Socios (referentes y prestadores)",
  all: "Todos",
};

// Rappel Habeas Data — jamais un blocage, le filtrage réel se fait à l'envoi
// (process_campaign_batch), pas ici. Exactement les 3 audiences listées par le plan.
const AUDIENCES_WITH_CLIENT_WARNING: Audience[] = ["clients", "partners", "all"];

export function NewCampaignForm() {
  const router = useRouter();
  const [audience, setAudience] = useState<Audience>("clients");
  const [channel, setChannel] = useState<Channel>("whatsapp");
  const [messageTemplate, setMessageTemplate] = useState("");
  const [includeIncomplete, setIncludeIncomplete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const showHabeasDataWarning = AUDIENCES_WITH_CLIENT_WARNING.includes(audience);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (!messageTemplate.trim()) {
      setError("El mensaje es obligatorio.");
      return;
    }

    setIsSubmitting(true);
    const supabase = createClient();
    const { data, error: rpcError } = await supabase.rpc("create_campaign", {
      p_audience: audience,
      p_channel: channel,
      p_message_template: messageTemplate.trim(),
      p_include_incomplete: includeIncomplete,
    });

    setIsSubmitting(false);

    const result = data as CreateCampaignResult | null;
    if (rpcError || !result?.ok || !result.campaign_id) {
      setError("No se pudo crear la campaña.");
      return;
    }

    router.push(`/admin/campaigns/${result.campaign_id}`);
  }

  return (
    <form onSubmit={handleSubmit} className="flex max-w-md flex-col gap-4">
      <Select
        fullWidth
        value={audience}
        onChange={(value) => value && setAudience(value as Audience)}
      >
        <Label>Audiencia</Label>
        <Select.Trigger data-testid="audience-select">
          <Select.Value />
          <Select.Indicator />
        </Select.Trigger>
        <Select.Popover>
          <ListBox>
            {Object.entries(AUDIENCE_LABELS).map(([value, label]) => (
              <ListBox.Item key={value} id={value} textValue={label}>
                {label}
                <ListBox.ItemIndicator />
              </ListBox.Item>
            ))}
          </ListBox>
        </Select.Popover>
      </Select>

      <Select fullWidth value={channel} onChange={(value) => value && setChannel(value as Channel)}>
        <Label>Canal</Label>
        <Select.Trigger data-testid="channel-select">
          <Select.Value />
          <Select.Indicator />
        </Select.Trigger>
        <Select.Popover>
          <ListBox>
            <ListBox.Item id="whatsapp" textValue="WhatsApp">
              WhatsApp
              <ListBox.ItemIndicator />
            </ListBox.Item>
            <ListBox.Item id="email" textValue="Correo electrónico">
              Correo electrónico
              <ListBox.ItemIndicator />
            </ListBox.Item>
          </ListBox>
        </Select.Popover>
      </Select>

      <TextField fullWidth value={messageTemplate} onChange={setMessageTemplate}>
        <Label>Mensaje</Label>
        <TextArea data-testid="message-template-input" />
      </TextField>

      <Checkbox
        data-testid="include-incomplete-checkbox"
        isSelected={includeIncomplete}
        onChange={setIncludeIncomplete}
      >
        <Checkbox.Content>
          <Checkbox.Control>
            <Checkbox.Indicator />
          </Checkbox.Control>
          Incluir identidades aún no completamente activas (onboarding / en revisión)
        </Checkbox.Content>
      </Checkbox>

      {showHabeasDataWarning ? (
        <p
          role="alert"
          data-testid="habeas-data-warning"
          className="rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-danger"
        >
          Esta audiencia incluye clientes: solo se enviará a quienes hayan dado su consentimiento
          de marketing en su pedido más reciente (Habeas Data). Este filtro se aplica al momento
          del envío, no impide crear la campaña.
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}

      <Button type="submit" isDisabled={isSubmitting} data-testid="create-campaign-button">
        {isSubmitting ? "Creando…" : "Crear campaña"}
      </Button>
    </form>
  );
}
