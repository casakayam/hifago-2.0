"use client";

import { Input, Label, TextField } from "@hifago/ui";

/**
 * Le couple « mot de passe + confirmation » — la SEULE définition de la règle de mot de passe de
 * la vitrine (longueur minimale, `autoComplete="new-password"`, nommage des champs).
 *
 * ⚠️ Recopié entre `SignupForm` et `ResetPasswordForm` : la durcir (8 caractères, une majuscule,
 * un indicateur de force) demandait de toucher deux fichiers, et rien n'aurait signalé l'oubli du
 * second. La comparaison des deux valeurs reste chez l'appelant : c'est lui qui possède le message
 * d'erreur et son namespace de traduction — une molécule ne traduit rien (convention du dépôt).
 *
 * `MIN_CARACTERES` est exporté pour que la garde de l'appelant, si elle en pose une un jour, cite
 * la même valeur que le champ plutôt qu'un littéral recopié.
 */
export const MIN_CARACTERES = 6;

export function CamposContrasena({
  password,
  confirmPassword,
  onPasswordChange,
  onConfirmPasswordChange,
  labelPassword,
  labelConfirmPassword,
}: {
  password: string;
  confirmPassword: string;
  onPasswordChange: (valeur: string) => void;
  onConfirmPasswordChange: (valeur: string) => void;
  labelPassword: string;
  labelConfirmPassword: string;
}) {
  return (
    <>
      <TextField name="password" value={password} onChange={onPasswordChange} isRequired>
        <Label>{labelPassword}</Label>
        <Input type="password" autoComplete="new-password" minLength={MIN_CARACTERES} />
      </TextField>
      <TextField
        name="confirm-password"
        value={confirmPassword}
        onChange={onConfirmPasswordChange}
        isRequired
      >
        <Label>{labelConfirmPassword}</Label>
        <Input type="password" autoComplete="new-password" minLength={MIN_CARACTERES} />
      </TextField>
    </>
  );
}
