"use client";

import { useActionState, useId, useMemo, useState, useSyncExternalStore, useTransition, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { recordDriverStep, type DriverStepState } from "@/lib/actions/driver";
import { toLocalInputValue } from "@/lib/domain/milestones";
import type { DriverStep } from "@/lib/domain/driver";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/forms/form-field";
import { FormAlert } from "@/components/auth/form-alert";
import { cn } from "@/lib/utils";

const noopSubscribe = () => () => {};

/**
 * Big-button road update for the driver's phone. One step at a time, for the
 * containers on this truck. Double taps and retries on a weak connection are
 * safe: the idempotency key is created once per form on the device.
 */
export function DriverStepForm(props: {
  assignmentId: string;
  steps: DriverStep[];
  containers: { id: string; label: string }[];
  evidence: { id: string; label: string }[];
}) {
  const [state, action, pending] = useActionState<DriverStepState, FormData>(
    recordDriverStep.bind(null, props.assignmentId), undefined);
  // browser only: default time in the device's time zone + one key per form
  const isClient = useSyncExternalStore(noopSubscribe, () => true, () => false);
  if (!isClient) return <p className="text-sm text-muted-foreground">Loading…</p>;
  return <StepFields key={state?.recorded ?? 0} {...props} state={state} action={action} pending={pending} />;
}

function StepFields({
  steps, containers, evidence, state, action, pending,
}: {
  steps: DriverStep[];
  containers: { id: string; label: string }[];
  evidence: { id: string; label: string }[];
  state: DriverStepState;
  action: (fd: FormData) => void;
  pending: boolean;
}) {
  const id = useId();
  const [, startTransition] = useTransition();
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [type, setType] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [when, setWhen] = useState(() => toLocalInputValue(new Date()));
  const [latest] = useState(() => toLocalInputValue(new Date(Date.now() + 10 * 60e3)));
  const step = steps.find((s) => s.type === type);
  const eventAtIso = useMemo(() => {
    const d = new Date(when);
    return Number.isNaN(d.getTime()) ? "" : d.toISOString();
  }, [when]);
  const err = state?.fieldErrors;

  function choose(s: DriverStep) {
    setType(s.type);
    setPicked(s.eligible);
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); // manual submit keeps the typed values if the server refuses
    const fd = new FormData(e.currentTarget);
    startTransition(() => action(fd));
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      {state?.ok && state.message && <FormAlert kind="success">{state.message}</FormAlert>}
      {state?.error && <FormAlert kind="error">{state.error}</FormAlert>}
      <input type="hidden" name="idempotency_key" value={idempotencyKey} />
      <input type="hidden" name="event_at" value={eventAtIso} />
      <input type="hidden" name="milestone" value={type} />

      <fieldset>
        <legend className="mb-2 text-sm font-medium">What happened?</legend>
        <div className="grid grid-cols-2 gap-2">
          {steps.map((s) => (
            <button key={s.type} type="button" onClick={() => choose(s)} aria-pressed={type === s.type}
              className={cn("min-h-12 rounded-lg border px-3 py-2 text-left text-sm font-medium transition-colors",
                type === s.type ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-muted")}>
              {s.label}
            </button>
          ))}
        </div>
        {err?.milestone && <p className="mt-1 text-sm text-destructive">{err.milestone[0]}</p>}
      </fieldset>

      {step && (
        <>
          {containers.length > 1 && (
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-medium">Containers</legend>
              {containers.filter((c) => step.eligible.includes(c.id)).map((c) => (
                <label key={c.id} className="flex min-h-11 items-center gap-3 rounded-md border px-3 text-sm has-checked:border-primary has-checked:bg-primary/5">
                  <input type="checkbox" name="container_ids" value={c.id} className="size-5 accent-primary"
                    checked={picked.includes(c.id)}
                    onChange={(e) => setPicked((p) => (e.target.checked ? [...p, c.id] : p.filter((x) => x !== c.id)))} />
                  <span className="font-mono font-medium">{c.label}</span>
                </label>
              ))}
              {err?.containerIds && <p className="text-sm text-destructive">{err.containerIds[0]}</p>}
            </fieldset>
          )}
          {containers.length <= 1 && step.eligible.map((c) => <input key={c} type="hidden" name="container_ids" value={c} />)}

          <FormField id={`${id}-loc`} label={step.requiresLocation ? "Where?" : "Where? (optional)"} errors={err?.location}>
            <Input id={`${id}-loc`} name="location" maxLength={200} required={step.requiresLocation}
              placeholder="e.g. Rusumo border, Kayonza, client warehouse" autoComplete="off" aria-invalid={!!err?.location} />
          </FormField>
          <FormField id={`${id}-when`} label="When?" description="Leave as is if it just happened" errors={err?.eventAt}>
            <Input id={`${id}-when`} type="datetime-local" value={when} max={latest}
              onChange={(e) => setWhen(e.target.value)} required aria-invalid={!!err?.eventAt} />
          </FormField>
          <FormField id={`${id}-note`} label="Note for NGB (optional)" description="Only NGB staff see this" errors={err?.note}>
            <Textarea id={`${id}-note`} name="note" rows={2} maxLength={1000} />
          </FormField>
          {evidence.length > 0 && (
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-medium">Attach your photos or POD (optional)</legend>
              {evidence.map((d) => (
                <label key={d.id} className="flex min-h-10 min-w-0 items-center gap-3 text-sm">
                  <input type="checkbox" name="evidence_ids" value={d.id} className="size-5 shrink-0 accent-primary" />
                  <span className="truncate">{d.label}</span>
                </label>
              ))}
            </fieldset>
          )}
          <Button type="submit" disabled={pending || picked.length === 0} className="h-12 w-full text-base">
            {pending && <Loader2 className="animate-spin" aria-hidden />} Save: {step.label}
          </Button>
        </>
      )}
    </form>
  );
}
