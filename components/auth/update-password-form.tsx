"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import { updatePassword } from "@/lib/actions/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { FormAlert } from "./form-alert";

export function UpdatePasswordForm() {
  const [state, action, pending] = useActionState(updatePassword, undefined);
  const errs = (k: string) => state?.fieldErrors?.[k]?.map((message) => ({ message }));

  return (
    <form action={action} noValidate className="flex flex-col gap-5">
      {state?.error && <FormAlert kind="error">{state.error}</FormAlert>}
      <FieldGroup>
        <Field data-invalid={!!state?.fieldErrors?.password}>
          <FieldLabel htmlFor="password">New password</FieldLabel>
          <Input id="password" name="password" type="password" autoComplete="new-password" required
            aria-invalid={!!state?.fieldErrors?.password} />
          <FieldDescription>At least 10 characters, with letters and numbers.</FieldDescription>
          <FieldError errors={errs("password")} />
        </Field>
        <Field data-invalid={!!state?.fieldErrors?.confirm}>
          <FieldLabel htmlFor="confirm">Confirm new password</FieldLabel>
          <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required
            aria-invalid={!!state?.fieldErrors?.confirm} />
          <FieldError errors={errs("confirm")} />
        </Field>
      </FieldGroup>
      <Button type="submit" size="lg" disabled={pending} className="w-full">
        {pending && <Loader2 className="animate-spin" aria-hidden />}
        Save new password
      </Button>
    </form>
  );
}
