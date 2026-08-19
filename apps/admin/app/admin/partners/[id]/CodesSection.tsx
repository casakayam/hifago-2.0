"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@hifago/supabase/client";
import { Switch, Table, toast } from "@hifago/ui";

type Code = { code: string; active: boolean };

export function CodesSection({ codes }: { codes: Code[] }) {
  const router = useRouter();
  const [updating, setUpdating] = useState<string | null>(null);

  async function handleToggle(code: string, nextActive: boolean) {
    setUpdating(code);

    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("set_partner_code_active", {
      p_code: code,
      p_active: nextActive,
    });

    setUpdating(null);
    if (rpcError) {
      toast.danger("No se pudo cambiar el estado del código.");
      return;
    }
    toast.success(nextActive ? "Código activado." : "Código desactivado.");
    router.refresh();
  }

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-lg font-medium">Códigos de atribución</h2>

      <Table>
        <Table.ScrollContainer>
          <Table.Content aria-label="Códigos de atribución">
            <Table.Header>
              <Table.Column isRowHeader>Código</Table.Column>
              <Table.Column>Activo</Table.Column>
            </Table.Header>
            <Table.Body
              items={codes}
              renderEmptyState={() => (
                <p className="p-4 text-center text-sm text-muted">Ningún código todavía.</p>
              )}
            >
              {(code) => (
                <Table.Row id={code.code} data-testid={`code-row-${code.code}`}>
                  <Table.Cell>{code.code}</Table.Cell>
                  <Table.Cell>
                    <Switch
                      isSelected={code.active}
                      isDisabled={updating === code.code}
                      onChange={(isActive) => handleToggle(code.code, isActive)}
                      aria-label={`Código ${code.code} activo`}
                      data-testid={`code-active-switch-${code.code}`}
                    >
                      <Switch.Content>
                        <Switch.Control>
                          <Switch.Thumb />
                        </Switch.Control>
                      </Switch.Content>
                    </Switch>
                  </Table.Cell>
                </Table.Row>
              )}
            </Table.Body>
          </Table.Content>
        </Table.ScrollContainer>
      </Table>
    </section>
  );
}
