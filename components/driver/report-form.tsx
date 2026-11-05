"use client";

import { useActionState, useId, useState, useSyncExternalStore, useTransition, type FormEvent } from "react";
import { Loader2, TriangleAlert } from "lucide-react";
import { reportProblem, type ReportState } from "@/lib/actions/driver";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/forms/form-field";
import { FormAlert } from "@/components/auth/form-alert";

const noopSubscribe = () => () => {};

/** Tell NGB operations about a problem (breakdown, delay, border hold…). Staff only, never the client. */
export function ReportProblemForm({ assignmentId }: { assignmentId: string }) {
  const [state, action, pending] = useActionState<ReportState, FormData>(reportProblem.bind(null, assignmentId), undefined);
  const isClient = useSyncExternalStore(noopSubscribe, () => true, () => false);
  if (!isClient) return null;
  return <ReportFields key={state?.sent ?? 0} state={state} action={action} pending={pending} />;
}

function ReportFields({ state, action, pending }: { state: ReportState; action: (fd: FormData) => void; pending: boolean }) {
  const id = useId();
  const [, startTransition] = useTransition();
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(() => action(fd));
  }
  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-3">
      {state?.ok && state.message && <FormAlert kind="success">{state.message}</FormAlert>}
      {state?.error && <FormAlert kind="error">{state.error}</FormAlert>}
      <input type="hidden" name="idempotency_key" value={idempotencyKey} />
      <FormField id={`${id}-msg`} label="What is the problem?" description="Only NGB staff see this. Call operations if it is urgent."
        errors={state?.fieldErrors?.message}>
        <Textarea id={`${id}-msg`} name="message" rows={3} maxLength={1000} required
          placeholder="e.g. Flat tyre near Kayonza, about 2 hours delay" aria-invalid={!!state?.fieldErrors?.message} />
      </FormField>
      <Button type="submit" variant="outline" disabled={pending} className="h-11 w-full">
        {pending ? <Loader2 className="animate-spin" aria-hidden /> : <TriangleAlert aria-hidden />} Send to NGB
      </Button>
    </form>
  );
}
