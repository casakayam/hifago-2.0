"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@hifago/supabase/client";
import { Button } from "@hifago/ui";

export function LogoutButton({
  className,
  "data-testid": dataTestId = "logout-button",
}: {
  className?: string;
  "data-testid"?: string;
}) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleLogout() {
    setIsSubmitting(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      isDisabled={isSubmitting}
      onPress={handleLogout}
      data-testid={dataTestId}
      className={className}
    >
      {isSubmitting ? "Saliendo…" : "Cerrar sesión"}
    </Button>
  );
}
