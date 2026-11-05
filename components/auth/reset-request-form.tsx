"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import { requestPasswordReset } from "@/lib/actions/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { FormAlert } from "./form-alert";

export function ResetRequestForm() {
  const [state, action, pending] = useActionState(requestPasswordReset, undefined);

  if (state?.message) return <FormAlert kind="success">{state.message}</FormAlert>;

  return (
    <form action={action} noValidate className="flex flex-col gap-5">
      {state?.error && <FormAlert kind="error">{state.error}</FormAlert>}
      <Field data-invalid={!!state?.fieldErrors?.email}>
        <FieldLabel htmlFor="email">Email</FieldLabel>
        <Input
          id="email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          required
          defaultValue={state?.values?.email}
          aria-invalid={!!state?.fieldErrors?.email}
        />
        <FieldError errors={state?.fieldErrors?.email?.map((message) => ({ message }))} />
      </Field>
      <Button type="submit" size="lg" disabled={pending} className="w-full">
        {pending && <Loader2 className="animate-spin" aria-hidden />}
        Send reset link
      </Button>
    </form>
  );
}
