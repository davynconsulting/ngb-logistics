"use client";

import { useId, useState } from "react";
import { cancelTransport } from "@/lib/actions/operations";
import { useFormAction } from "@/components/forms/use-form-action";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/forms/form-field";
import { FormAlert } from "@/components/auth/form-alert";

export function CancelTruck({ assignmentId }: { assignmentId: string }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const { state, pending, onSubmit, formRef, errors } = useFormAction(cancelTransport.bind(null, assignmentId));
  if (!open) return <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(true)}>Cancel truck…</Button>;
  return (
    <form ref={formRef} onSubmit={onSubmit} noValidate className="flex flex-col gap-2">
      {state?.error && <FormAlert kind="error">{state.error}</FormAlert>}
      <FormField id={`${id}-r`} label="Why is this truck cancelled?" description="Kept internal" errors={errors?.reason}>
        <Textarea id={`${id}-r`} name="reason" rows={2} maxLength={500} required />
      </FormField>
      <div className="flex gap-2">
        <Button type="submit" size="sm" variant="destructive" disabled={pending}>Cancel assignment</Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>Keep</Button>
      </div>
    </form>
  );
}
