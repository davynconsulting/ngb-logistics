"use client";

import { useId, useState } from "react";
import { Plus } from "lucide-react";
import { openException } from "@/lib/actions/operations";
import { EXCEPTION_TYPE_LABELS, SEVERITY_LABELS, type ExceptionSeverity, type ExceptionType } from "@/lib/domain/operations";
import { useFormAction } from "@/components/forms/use-form-action";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import { FormField } from "@/components/forms/form-field";
import { FormAlert } from "@/components/auth/form-alert";

type Option = { id: string; label: string };

export function OpenExceptionForm({ shipmentId, containers, staff }: { shipmentId: string; containers: Option[]; staff: Option[] }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const { state, pending, onSubmit, formRef, errors } = useFormAction(openException.bind(null, shipmentId), { localTimes: ["follow_up_at"] });
  if (!open) {
    return (
      <div className="flex flex-col gap-2">
        {state?.ok && <FormAlert kind="success">{state.message}</FormAlert>}
        <Button type="button" variant="outline" className="self-start" onClick={() => setOpen(true)}><Plus aria-hidden /> Open an exception</Button>
      </div>
    );
  }
  return (
    <form ref={formRef} onSubmit={(e) => { onSubmit(e); }} noValidate className="flex flex-col gap-3 rounded-md border p-3">
      {state?.ok && <FormAlert kind="success">{state.message}</FormAlert>}
      {state?.error && <FormAlert kind="error">{state.error}</FormAlert>}
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField id={`${id}-type`} label="Type" errors={errors?.type}>
          <NativeSelect id={`${id}-type`} name="type" defaultValue="" required>
            <option value="">Choose…</option>
            {(Object.keys(EXCEPTION_TYPE_LABELS) as ExceptionType[]).map((t) => <option key={t} value={t}>{EXCEPTION_TYPE_LABELS[t]}</option>)}
          </NativeSelect>
        </FormField>
        <FormField id={`${id}-sev`} label="Severity">
          <NativeSelect id={`${id}-sev`} name="severity" defaultValue="medium">
            {(Object.keys(SEVERITY_LABELS) as ExceptionSeverity[]).map((s) => <option key={s} value={s}>{SEVERITY_LABELS[s]}</option>)}
          </NativeSelect>
        </FormField>
      </div>
      <FormField id={`${id}-title`} label="Title" errors={errors?.title}>
        <Input id={`${id}-title`} name="title" maxLength={200} required />
      </FormField>
      <FormField id={`${id}-details`} label="Details (internal)" errors={errors?.details}>
        <Textarea id={`${id}-details`} name="details" rows={2} maxLength={2000} />
      </FormField>
      <div className="grid gap-3 sm:grid-cols-2">
        {containers.length > 0 && (
          <FormField id={`${id}-cont`} label="Container (optional)">
            <NativeSelect id={`${id}-cont`} name="container_id" defaultValue="">
              <option value="">Whole shipment</option>
              {containers.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </NativeSelect>
          </FormField>
        )}
        <FormField id={`${id}-owner`} label="Owner" description="Default: the shipment's responsible person">
          <NativeSelect id={`${id}-owner`} name="owner_id" defaultValue="">
            <option value="">Default</option>
            {staff.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </NativeSelect>
        </FormField>
        <FormField id={`${id}-next`} label="Next action" errors={errors?.nextAction}>
          <Input id={`${id}-next`} name="next_action" maxLength={500} />
        </FormField>
        <FormField id={`${id}-fu`} label="Next follow-up" errors={errors?.followUpAt}>
          <Input id={`${id}-fu`} name="follow_up_at" type="datetime-local" />
        </FormField>
      </div>
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>Open exception</Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Close</Button>
      </div>
    </form>
  );
}
