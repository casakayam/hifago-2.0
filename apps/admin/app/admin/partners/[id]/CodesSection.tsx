"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@hifago/supabase/client";
import {
  SimpleTable,
  SimpleTableBody,
  SimpleTableCell,
  SimpleTableHead,
  SimpleTableHeader,
  SimpleTableRow,
  Switch,
  toast,
} from "@hifago/ui";

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

      <SimpleTable aria-label="Códigos de atribución">
        <SimpleTableHeader>
          <SimpleTableRow>
            <SimpleTableHead>Código</SimpleTableHead>
            <SimpleTableHead>Activo</SimpleTableHead>
          </SimpleTableRow>
        </SimpleTableHeader>
        <SimpleTableBody>
          {codes.length > 0 ? (
            codes.map((code) => (
              <SimpleTableRow key={code.code} id={code.code} data-testid={`code-row-${code.code}`}>
                <SimpleTableCell data-label="Código">{code.code}</SimpleTableCell>
                <SimpleTableCell data-label="Activo">
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
                </SimpleTableCell>
              </SimpleTableRow>
            ))
          ) : (
            <SimpleTableRow>
              <SimpleTableCell colSpan={2} className="text-center text-muted">
                Ningún código todavía.
              </SimpleTableCell>
            </SimpleTableRow>
          )}
        </SimpleTableBody>
      </SimpleTable>
    </section>
  );
}
