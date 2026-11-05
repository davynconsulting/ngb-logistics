"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import type { ActionState } from "@/lib/validation/common";
import { LANGUAGES, TIMEZONES } from "@/lib/validation/common";
import { CURRENCIES } from "@/lib/domain/money";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import { FieldGroup, FieldLegend, FieldSet } from "@/components/ui/field";
import { FormField } from "@/components/forms/form-field";
import { FormAlert } from "@/components/auth/form-alert";
import { ROLE_LABELS, type AppRole } from "@/lib/auth/roles";


export type ClientFormDefaults = {
  client_code?: string; legal_name?: string; primary_contact_name?: string | null; phone_e164?: string | null;
  email?: string | null; billing_address?: string | null; tax_id?: string | null; preferred_language?: string;
  timezone?: string; billing_terms_days?: number | null; credit_limit?: number | string | null;
  credit_currency?: string | null; account_manager_id?: string | null; show_driver_contact?: boolean; is_active?: boolean;
};

type Staff = { id: string; full_name: string; email: string | null; role: AppRole };

export function ClientForm({
  action, defaults, staff, mode, canEdit,
}: {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  defaults: ClientFormDefaults;
  staff: Staff[];
  mode: "create" | "edit";
  canEdit: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  // After a failed submit, show what the user typed; otherwise the saved values
  const val = (k: keyof ClientFormDefaults) => {
    const typed = state?.values?.[k];
    if (typed !== undefined && !state?.ok) return String(typed ?? "");
    const d = defaults[k];
    return d === null || d === undefined ? "" : String(d);
  };
  const err = (k: string) => state?.fieldErrors?.[k];
  const checked = (k: "show_driver_contact" | "is_active") =>
    state?.values && !state.ok ? state.values[k] === "on" : !!defaults[k];
  const key = state?.ok ? "saved" : JSON.stringify(state?.values ?? {});

  return (
    <form action={formAction} noValidate className="flex flex-col gap-6" key={key}>
      {state?.error && <FormAlert kind="error">{state.error}</FormAlert>}
      {state?.ok && state.message && <FormAlert kind="success">{state.message}</FormAlert>}
      {state?.fieldErrors && !state.error && <FormAlert kind="error">Please correct the highlighted fields.</FormAlert>}

      <fieldset disabled={!canEdit || pending} className="flex flex-col gap-6">
        <FieldSet>
          <FieldLegend>Company</FieldLegend>
          <FieldGroup className="grid gap-4 sm:grid-cols-2">
            <FormField id="client_code" label="Client code" errors={err("client_code")}
              description={mode === "create" ? "Short unique code, e.g. AKAGERA. Can't be changed later." : "Can't be changed."}>
              <Input id="client_code" name="client_code" defaultValue={val("client_code")} readOnly={mode === "edit"}
                autoCapitalize="characters" maxLength={20} aria-invalid={!!err("client_code")} className="font-mono uppercase" />
            </FormField>
            <FormField id="legal_name" label="Registered company name" errors={err("legal_name")}>
              <Input id="legal_name" name="legal_name" defaultValue={val("legal_name")} aria-invalid={!!err("legal_name")} />
            </FormField>
            <FormField id="tax_id" label="Tax ID (TIN)" errors={err("tax_id")}>
              <Input id="tax_id" name="tax_id" defaultValue={val("tax_id")} />
            </FormField>
            <FormField id="billing_address" label="Billing address" errors={err("billing_address")} className="sm:col-span-2">
              <Textarea id="billing_address" name="billing_address" rows={2} defaultValue={val("billing_address")} />
            </FormField>
          </FieldGroup>
        </FieldSet>

        <FieldSet>
          <FieldLegend>Main contact</FieldLegend>
          <FieldGroup className="grid gap-4 sm:grid-cols-2">
            <FormField id="primary_contact_name" label="Name" errors={err("primary_contact_name")}>
              <Input id="primary_contact_name" name="primary_contact_name" autoComplete="off"
                defaultValue={val("primary_contact_name")} aria-invalid={!!err("primary_contact_name")} />
            </FormField>
            <FormField id="phone_e164" label="Phone (international)" errors={err("phone_e164")} description="e.g. +250 788 123 456">
              <Input id="phone_e164" name="phone_e164" type="tel" inputMode="tel" defaultValue={val("phone_e164")}
                aria-invalid={!!err("phone_e164")} />
            </FormField>
            <FormField id="email" label="Email" errors={err("email")}>
              <Input id="email" name="email" type="email" inputMode="email" autoCapitalize="none"
                defaultValue={val("email")} aria-invalid={!!err("email")} />
            </FormField>
          </FieldGroup>
        </FieldSet>

        <FieldSet>
          <FieldLegend>Preferences & account</FieldLegend>
          <FieldGroup className="grid gap-4 sm:grid-cols-2">
            <FormField id="preferred_language" label="Language for messages" errors={err("preferred_language")}>
              <NativeSelect id="preferred_language" name="preferred_language" defaultValue={val("preferred_language") || "en"}>
                {LANGUAGES.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
              </NativeSelect>
            </FormField>
            <FormField id="timezone" label="Time zone" errors={err("timezone")}>
              <NativeSelect id="timezone" name="timezone" defaultValue={val("timezone") || "Africa/Kigali"}>
                {TIMEZONES.map((t) => <option key={t} value={t}>{t.replace("Africa/", "").replace("_", " ")}</option>)}
              </NativeSelect>
            </FormField>
            <FormField id="account_manager_id" label="Account manager" errors={err("account_manager_id")}>
              <NativeSelect id="account_manager_id" name="account_manager_id" defaultValue={val("account_manager_id")}>
                <option value="">Not assigned</option>
                {staff.map((s) => (
                  <option key={s.id} value={s.id}>{s.full_name || s.email} · {ROLE_LABELS[s.role]}</option>
                ))}
              </NativeSelect>
            </FormField>
            <FormField id="billing_terms_days" label="Payment terms (days)" errors={err("billing_terms_days")}>
              <Input id="billing_terms_days" name="billing_terms_days" type="number" inputMode="numeric" min={0} max={365}
                defaultValue={val("billing_terms_days")} aria-invalid={!!err("billing_terms_days")} />
            </FormField>
            <FormField id="credit_limit" label="Credit limit" errors={err("credit_limit")}>
              <Input id="credit_limit" name="credit_limit" inputMode="decimal" placeholder="Optional"
                defaultValue={val("credit_limit")} aria-invalid={!!err("credit_limit")} />
            </FormField>
            <FormField id="credit_currency" label="Credit currency" errors={err("credit_currency")}>
              <NativeSelect id="credit_currency" name="credit_currency" defaultValue={val("credit_currency")}
                aria-invalid={!!err("credit_currency")}>
                <option value="">—</option>
                {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </NativeSelect>
            </FormField>
          </FieldGroup>
          <label className="mt-2 flex items-start gap-2 text-sm">
            <input type="checkbox" name="show_driver_contact" defaultChecked={checked("show_driver_contact")} className="mt-0.5 size-4 accent-primary" />
            <span>Show driver name and phone to this client <span className="text-muted-foreground">(only with company policy and driver consent)</span></span>
          </label>
          {mode === "edit" && (
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" name="is_active" defaultChecked={checked("is_active")} className="mt-0.5 size-4 accent-primary" />
              <span>Active client</span>
            </label>
          )}
        </FieldSet>
      </fieldset>

      {canEdit && (
        <div>
          <Button type="submit" size="lg" disabled={pending} className="w-full sm:w-auto">
            {pending && <Loader2 className="animate-spin" aria-hidden />}
            {mode === "create" ? "Create client" : "Save changes"}
          </Button>
        </div>
      )}
    </form>
  );
}
