import { NewPartnerForm } from "./NewPartnerForm";

export default function NewPartnerPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Nuevo partner</h1>
      <NewPartnerForm />
    </div>
  );
}
