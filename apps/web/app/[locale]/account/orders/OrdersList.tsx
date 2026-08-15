"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { createClient } from "@hifago/supabase/client";
import { Button, Card } from "@hifago/ui";

type OrderLine = { id: string; status: string };
type Order = { id: string; holder_name: string; created_at: string; order_lines: OrderLine[] };

type CancelOrderResult = { ok: boolean; reason?: string; cancelled_lines?: number };

export function OrdersList({ orders: initialOrders }: { orders: Order[] }) {
  const t = useTranslations("AccountOrdersPage");
  const [orders, setOrders] = useState(initialOrders);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [errorId, setErrorId] = useState<string | null>(null);

  async function handleCancel(orderId: string) {
    setPendingId(orderId);
    setErrorId(null);

    const supabase = createClient();
    const { data } = await supabase.rpc("cancel_order", { p_order_id: orderId });
    const result = data as CancelOrderResult | null;

    setPendingId(null);

    if (!result?.ok) {
      setErrorId(orderId);
      return;
    }

    // Reflète la vraie transition écrite par la RPC (toutes les lignes reserved → cancelled_by_client
    // de CETTE commande) — pas un état optimiste inventé côté client.
    setOrders((prev) =>
      prev.map((order) =>
        order.id === orderId
          ? {
              ...order,
              order_lines: order.order_lines.map((line) =>
                line.status === "reserved" ? { ...line, status: "cancelled_by_client" } : line
              ),
            }
          : order
      )
    );
  }

  if (orders.length === 0) {
    return (
      <p data-testid="no-orders" className="text-sm text-muted">
        {t("empty")}
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-4">
      {orders.map((order) => {
        const total = order.order_lines.length;
        const active = order.order_lines.filter((line) => line.status === "reserved").length;
        const hasActiveLine = active > 0;

        return (
          <li key={order.id} data-testid={`order-row-${order.id}`}>
            <Card>
              <Card.Header>
                <Card.Title className="flex items-center justify-between text-base">
                  <span>{order.holder_name}</span>
                  <span className="text-sm font-normal text-muted">
                    {new Date(order.created_at).toLocaleDateString()}
                  </span>
                </Card.Title>
              </Card.Header>
              <Card.Content className="flex flex-col gap-3">
                <p data-testid={`order-status-${order.id}`} className="text-sm text-muted">
                  {t("linesSummary", { active, total })}
                </p>

                {errorId === order.id ? (
                  <p role="alert" data-testid={`cancel-error-${order.id}`} className="text-sm text-danger">
                    {t("cancelError")}
                  </p>
                ) : null}

                {hasActiveLine ? (
                  <Button
                    variant="outline"
                    size="sm"
                    isDisabled={pendingId === order.id}
                    onPress={() => handleCancel(order.id)}
                    data-testid={`cancel-order-button-${order.id}`}
                  >
                    {pendingId === order.id ? t("cancelling") : t("cancel")}
                  </Button>
                ) : null}
              </Card.Content>
            </Card>
          </li>
        );
      })}
    </ul>
  );
}
