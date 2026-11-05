"use client";

import { useId } from "react";
import { setExceptionClientMessage } from "@/lib/actions/operations";
import { useFormAction } from "@/components/forms/use-form-action";
import { FormField } from "@/components/forms/form-field";
import { FormAlert } from "@/components/auth/form-alert";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

/** What the client sees in the portal for this exception (internal details stay internal). */
export function ClientMessageForm({ exceptionId, message, visible }: { exceptionId: string; message: string | null; visible: boolean }) {
  const id = useId();
  const { state, pending, onSubmit, formRef, errors } = useFormAction(setExceptionClientMessage.bind(null, exceptionId), { resetOnSuccess: false });
  return (
    <details className="rounded-md bg-muted/40 p-3" open={visible}>
      <summary className="cursor-pointer text-sm font-medium">
        Client message {visible ? <span className="font-normal text-success">· shown to the client</span> : <span className="font-normal text-muted-foreground">· not shown</span>}
      </summary>
      <form ref={formRef} onSubmit={onSubmit} noValidate className="mt-3 flex flex-col gap-3">
        {state?.error && <FormAlert kind="error">{state.error}</FormAlert>}
        {state?.ok && state.message && <FormAlert kind="success">{state.message}</FormAlert>}
        <FormField id={`${id}-msg`} label="Message for the client" errors={errors?.client_message}
          description="Plain language, no internal details. Showing it notifies the client.">
          <Textarea id={`${id}-msg`} name="client_message" rows={2} maxLength={500} defaultValue={message ?? ""} />
        </FormField>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="client_visible" defaultChecked={visible} className="size-4 accent-primary" />
          Show in the client portal
        </label>
        <div><Button type="submit" size="sm" variant="outline" disabled={pending}>{pending ? "Saving…" : "Save client message"}</Button></div>
      </form>
    </details>
  );
}
