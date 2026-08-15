import type { Metadata } from "next";
import { ForgotPasswordForm } from "./ForgotPasswordForm";

export const metadata: Metadata = {
  title: "¿Olvidaste tu contraseña?",
};

export default function ForgotPasswordPage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-2xl font-semibold">¿Olvidaste tu contraseña?</h1>
      <ForgotPasswordForm />
    </main>
  );
}
