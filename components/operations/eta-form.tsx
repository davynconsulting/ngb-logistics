"use client";

import { useId } from "react";
import { reviseEta } from "@/lib/actions/operations";
import { ETA_REASON_LABELS, type EtaReasonCategory } from "@/lib/domain/operations";
import { useFormAction } from "@/components/forms/use-form-action";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import { FormField } from "@/components/forms/form-field";
import { FormAlert } from "@/components/auth/form-alert";

/** Revise the ETA with a reason (AC-09). Materiality is decided by the database. */
export function EtaForm({ shipmentId }: { shipmentId: string }) {
  const id = useId();
  const { state, pending, onSubmit, formRef, errors } = useFormAction(reviseEta.bind(null, shipmentId), { localTimes: ["new_eta"] });
  return (
    <form ref={formRef} onSubmit={onSubmit} noValidate className="flex flex-col gap-3">
      {state?.ok && <FormAlert kind="success">{state.message}</FormAlert>}
      {state?.error && <FormAlert kind="error">{state.error}</FormAlert>}
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField id={`${id}-eta`} label="New ETA" description="Your device's local time" errors={errors?.newEta}>
          <Input id={`${id}-eta`} name="new_eta" type="datetime-local" required aria-invalid={!!errors?.newEta} />
        </FormField>
        <FormField id={`${id}-cat`} label="Reason" errors={errors?.category}>
          <NativeSelect id={`${id}-cat`} name="category" defaultValue="" required aria-invalid={!!errors?.category}>
            <option value="">Choose…</option>
            {(Object.keys(ETA_REASON_LABELS) as EtaReasonCategory[]).map((k) => <option key={k} value={k}>{ETA_REASON_LABELS[k]}</option>)}
          </NativeSelect>
        </FormField>
      </div>
      <FormField id={`${id}-why`} label="Explanation" description="The client sees this with the new ETA" errors={errors?.reason}>
        <Textarea id={`${id}-why`} name="reason" rows={2} maxLength={500} required aria-invalid={!!errors?.reason} />
      </FormField>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="client_visible" defaultChecked className="size-4 accent-primary" /> Show to the client
      </label>
      <div><Button type="submit" disabled={pending}>Update ETA</Button></div>
    </form>
  );
}
