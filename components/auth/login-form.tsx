"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import { signIn } from "@/lib/actions/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { FormAlert } from "./form-alert";

const NOTICES: Record<string, { kind: "error" | "success" | "info"; text: string }> = {
  no_access: { kind: "error", text: "Your account is not active. Please contact NGB LOGISTICS." },
  link_invalid: { kind: "error", text: "That link is invalid or has expired. Please request a new one." },
  signed_out: { kind: "success", text: "You have been signed out." },
};

export function LoginForm({ next, notice }: { next?: string; notice?: string }) {
  const [state, action, pending] = useActionState(signIn, undefined);
  const banner = !state && notice ? NOTICES[notice] : undefined;

  return (
    <form action={action} noValidate className="flex flex-col gap-5">
      {banner && <FormAlert kind={banner.kind}>{banner.text}</FormAlert>}
      {state?.error && <FormAlert kind="error">{state.error}</FormAlert>}
      {next && <input type="hidden" name="next" value={next} />}

      <FieldGroup>
        <Field data-invalid={!!state?.fieldErrors?.email}>
          <FieldLabel htmlFor="email">Email</FieldLabel>
          <Input
            id="email"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            required
            defaultValue={state?.values?.email}
            aria-invalid={!!state?.fieldErrors?.email}
          />
          <FieldError errors={state?.fieldErrors?.email?.map((message) => ({ message }))} />
        </Field>

        <Field data-invalid={!!state?.fieldErrors?.password}>
          <div className="flex items-center justify-between">
            <FieldLabel htmlFor="password">Password</FieldLabel>
            <Link href="/reset-password" className="text-sm text-primary underline-offset-4 hover:underline">
              Forgot password?
            </Link>
          </div>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            aria-invalid={!!state?.fieldErrors?.password}
          />
          <FieldError errors={state?.fieldErrors?.password?.map((message) => ({ message }))} />
        </Field>
      </FieldGroup>

      <Button type="submit" size="lg" disabled={pending} className="w-full">
        {pending && <Loader2 className="animate-spin" aria-hidden />}
        {pending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
