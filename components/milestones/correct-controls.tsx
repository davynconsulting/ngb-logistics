"use client";

import { useActionState, useId, useState, useSyncExternalStore, useTransition, type FormEvent } from "react";
import { Ban, Pencil } from "lucide-react";
import { correctMilestone, type CorrectMilestoneState } from "@/lib/actions/milestones";
import { toLocalInputValue } from "@/lib/domain/milestones";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import { FormField } from "@/components/forms/form-field";
import { FormAlert } from "@/components/auth/form-alert";

type Target = { eventId: string; label: string; eventAt: string; location: string | null; publicNote: string | null };
const noopSubscribe = () => () => {};

/**
 * Correct (time, location, client note) or cancel a recorded milestone. Both add
 * a new record; the original stays in the history. For an action that covered
 * several containers, each container's event is corrected on its own.
 */
export function CorrectControls({ targets }: { targets: Target[] }) {
  const [mode, setMode] = useState<"correct" | "cancel" | null>(null);
  const [eventId, setEventId] = useState(targets[0]?.eventId ?? "");
  const isClient = useSyncExternalStore(noopSubscribe, () => true, () => false);
  const target = targets.find((t) => t.eventId === eventId) ?? targets[0];
  if (!target) return null;

  if (!mode) {
    return (
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={() => setMode("correct")}><Pencil aria-hidden /> Correct</Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setMode("cancel")}><Ban aria-hidden /> Cancel milestone</Button>
      </div>
    );
  }
  if (!isClient) return null;
  return (
    <div className="flex flex-col gap-3 rounded-md border bg-muted/30 p-3">
      {targets.length > 1 && (
        <NativeSelect aria-label="Container" value={eventId} onChange={(e) => setEventId(e.target.value)}>
          {targets.map((t) => <option key={t.eventId} value={t.eventId}>{t.label}</option>)}
        </NativeSelect>
      )}
      <CorrectionForm key={`${mode}-${target.eventId}`} mode={mode} target={target} onClose={() => setMode(null)} />
    </div>
  );
}

function CorrectionForm({ mode, target, onClose }: { mode: "correct" | "cancel"; target: Target; onClose: () => void }) {
  const id = useId();
  const [state, action, pending] = useActionState<CorrectMilestoneState, FormData>(
    correctMilestone.bind(null, target.eventId), undefined);
  const [, startTransition] = useTransition();
  const original = toLocalInputValue(new Date(target.eventAt));
  const [when, setWhen] = useState(original);
  const [location, setLocation] = useState(target.location ?? "");
  const [note, setNote] = useState(target.publicNote ?? "");

  if (state?.ok) {
    return (
      <div className="flex flex-col gap-2">
        <FormAlert kind="success">{state.message}</FormAlert>
        <Button type="button" size="sm" variant="ghost" className="self-start" onClick={onClose}>Close</Button>
      </div>
    );
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData();
    fd.set("mode", mode);
    fd.set("reason", String(new FormData(e.currentTarget).get("reason") ?? ""));
    // only send what changed
    if (mode === "correct") {
      if (when !== original) fd.set("event_at", new Date(when).toISOString());
      if (location !== (target.location ?? "")) fd.set("location", location);
      if (note !== (target.publicNote ?? "")) fd.set("public_note", note);
    }
    startTransition(() => action(fd));
  }

  const unchanged = mode === "correct" && when === original && location === (target.location ?? "") && note === (target.publicNote ?? "");
  const err = state?.fieldErrors;

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-3">
      {state?.error && <FormAlert kind="error">{state.error}</FormAlert>}
      {mode === "correct" ? (
        <>
          <FormField id={`${id}-when`} label="When it happened" errors={err?.eventAt}>
            <Input id={`${id}-when`} type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
          </FormField>
          <FormField id={`${id}-loc`} label="Location">
            <Input id={`${id}-loc`} value={location} maxLength={200} onChange={(e) => setLocation(e.target.value)} />
          </FormField>
          <FormField id={`${id}-note`} label="Note for the client">
            <Textarea id={`${id}-note`} rows={2} value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} />
          </FormField>
        </>
      ) : (
        <p className="text-sm">
          Cancelling restores the statuses from before this milestone. It is only possible while no later milestone depends on it.
          The milestone stays in the history, marked as cancelled.
        </p>
      )}
      <FormField id={`${id}-reason`} label={mode === "cancel" ? "Reason for cancelling" : "Reason for the correction"} errors={err?.reason}>
        <Textarea id={`${id}-reason`} name="reason" rows={2} maxLength={500} required aria-invalid={!!err?.reason} />
      </FormField>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" variant={mode === "cancel" ? "destructive" : "default"} disabled={pending || unchanged}>
          {mode === "cancel" ? "Cancel milestone" : "Save correction"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onClose}>Close</Button>
      </div>
    </form>
  );
}
