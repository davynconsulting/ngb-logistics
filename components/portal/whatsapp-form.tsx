"use client";

import { useId, useState } from "react";
import { MessageCircle } from "lucide-react";
import { saveWhatsApp } from "@/lib/actions/portal";
import { useFormAction } from "@/components/forms/use-form-action";
import { FormField } from "@/components/forms/form-field";
import { FormAlert } from "@/components/auth/form-alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * WhatsApp opt-in with explicit consent (FRS §7.1). The database records the
 * consent time and source; turning it off removes the number.
 */
export function WhatsAppForm({ current }: { current: { optIn: boolean; phone: string | null; consentAt: string | null } }) {
  const id = useId();
  const [on, setOn] = useState(current.optIn);
  const { state, pending, onSubmit, formRef, errors } = useFormAction(saveWhatsApp, { resetOnSuccess: false });

  return (
    <form ref={formRef} onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      {state?.error && <FormAlert kind="error">{state.error}</FormAlert>}
      {state?.ok && state.message && <FormAlert kind="success">{state.message}</FormAlert>}
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="whatsapp_opt_in" checked={on} onChange={(e) => setOn(e.target.checked)} className="mt-0.5 size-4 accent-primary" />
        <span>
          <span className="flex items-center gap-1 font-medium"><MessageCircle className="size-4" aria-hidden /> Send me WhatsApp messages</span>
          <span className="text-muted-foreground">For key milestones, ETA changes and documents we need from you.</span>
        </span>
      </label>
      {on && (
        <>
          <FormField id={`${id}-phone`} label="WhatsApp number" errors={errors?.whatsapp_phone}
            description="With the country code, e.g. +250 788 123 456">
            <Input id={`${id}-phone`} name="whatsapp_phone" type="tel" inputMode="tel" autoComplete="tel"
              defaultValue={current.phone ?? ""} aria-invalid={!!errors?.whatsapp_phone} />
          </FormField>
          <FormField id={`${id}-consent`} label="Consent" errors={errors?.consent}>
            <label className="flex items-start gap-2 text-sm font-normal">
              <input id={`${id}-consent`} type="checkbox" name="consent" defaultChecked={current.optIn} className="mt-0.5 size-4 accent-primary" />
              <span>I agree that NGB LOGISTICS may send shipment updates to this number on WhatsApp. I can turn this off here at any time.</span>
            </label>
          </FormField>
        </>
      )}
      <div>
        <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save"}</Button>
      </div>
    </form>
  );
}
