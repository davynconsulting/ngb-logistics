"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Check, Copy, Loader2 } from "lucide-react";
import { inviteUser } from "@/lib/actions/users";
import { ROLE_LABELS, type AppRole } from "@/lib/auth/roles";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { FieldGroup } from "@/components/ui/field";
import { FormField } from "@/components/forms/form-field";
import { FormAlert } from "@/components/auth/form-alert";

type ClientOption = { id: string; legal_name: string; client_code: string };

export function InviteForm({
  roles, clients, defaults,
}: { roles: AppRole[]; clients: ClientOption[]; defaults: { role?: string; organization_id?: string } }) {
  const [state, action, pending] = useActionState(inviteUser, undefined);
  const [role, setRole] = useState(defaults.role ?? roles[0]);
  const [copied, setCopied] = useState(false);
  const err = (k: string) => state?.fieldErrors?.[k];
  const val = (k: string) => (state?.values?.[k] as string | undefined) ?? undefined;

  if (state?.ok && state.inviteLink) {
    return (
      <div className="flex flex-col gap-4">
        <FormAlert kind="success">{state.message}</FormAlert>
        <div className="flex flex-col gap-2">
          <label htmlFor="invite-link" className="text-sm font-medium">One-time sign-up link for {state.invitedEmail}</label>
          <div className="flex gap-2">
            <Input id="invite-link" readOnly value={state.inviteLink} className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
            <Button type="button" variant="outline" onClick={async () => {
              await navigator.clipboard.writeText(state.inviteLink!);
              setCopied(true);
            }}>
              {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">
            Send it privately (e.g. WhatsApp or email). It works <strong>once</strong>, expires soon, and lets the person choose
            their password. Treat it like a password: it is not shown again.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline"><Link href="/admin/users">Back to users</Link></Button>
          <Button type="button" variant="ghost" onClick={() => window.location.reload()}>Invite another</Button>
        </div>
      </div>
    );
  }

  return (
    <form action={action} noValidate className="flex flex-col gap-6">
      {state?.error && <FormAlert kind="error">{state.error}</FormAlert>}
      <FieldGroup className="grid gap-4 sm:grid-cols-2">
        <FormField id="full_name" label="Full name" errors={err("full_name")}>
          <Input id="full_name" name="full_name" autoComplete="off" defaultValue={val("full_name")} aria-invalid={!!err("full_name")} />
        </FormField>
        <FormField id="email" label="Email" errors={err("email")}>
          <Input id="email" name="email" type="email" inputMode="email" autoCapitalize="none" autoComplete="off"
            defaultValue={val("email")} aria-invalid={!!err("email")} />
        </FormField>
        <FormField id="role" label="Role" errors={err("role")}>
          <NativeSelect id="role" name="role" value={role} onChange={(e) => setRole(e.target.value as AppRole)}>
            {roles.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
          </NativeSelect>
        </FormField>
        {role === "client" ? (
          <FormField id="organization_id" label="Client company" errors={err("organization_id")}>
            <NativeSelect id="organization_id" name="organization_id" defaultValue={val("organization_id") ?? defaults.organization_id ?? ""}
              aria-invalid={!!err("organization_id")}>
              <option value="">Choose…</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.legal_name} ({c.client_code})</option>)}
            </NativeSelect>
          </FormField>
        ) : (
          <p className="self-end pb-2 text-sm text-muted-foreground">Staff accounts belong to NGB LOGISTICS.</p>
        )}
        <FormField id="phone_e164" label="Phone (optional)" errors={err("phone_e164")} description="International format, e.g. +250 788 123 456">
          <Input id="phone_e164" name="phone_e164" type="tel" inputMode="tel" defaultValue={val("phone_e164")} aria-invalid={!!err("phone_e164")} />
        </FormField>
      </FieldGroup>
      <div>
        <Button type="submit" size="lg" disabled={pending} className="w-full sm:w-auto">
          {pending && <Loader2 className="animate-spin" aria-hidden />}
          Create account &amp; get invite link
        </Button>
      </div>
    </form>
  );
}
