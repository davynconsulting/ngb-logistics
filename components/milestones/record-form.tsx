"use client";

import { useActionState, useId, useMemo, useState, useSyncExternalStore, useTransition, type FormEvent } from "react";
import { Loader2, TriangleAlert } from "lucide-react";
import { recordMilestone, type RecordMilestoneState } from "@/lib/actions/milestones";
import {
  LOCATION_KIND_LABELS, milestoneGroup, toLocalInputValue, type MilestoneOption,
} from "@/lib/domain/milestones";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import { FormField } from "@/components/forms/form-field";
import { FormAlert } from "@/components/auth/form-alert";

type Container = { id: string; label: string; status: string };
type Evidence = { id: string; label: string };

const noopSubscribe = () => () => {};
const SEAL_MILESTONES = new Set(["loaded", "gate_out"]);
const LOCATION_KIND_MILESTONES = new Set(["container_discharged", "vessel_arrived"]);

/**
 * Record a milestone. Only milestones the user's role may record are offered.
 * The hints (out of order, already done) mirror the database rules; the
 * database checks everything again when the form is saved.
 */
export function RecordMilestoneForm(props: {
  shipmentId: string;
  options: MilestoneOption[];
  containers: Container[];
  evidence: Evidence[];
  canOverride: boolean;
}) {
  const [state, action, pending] = useActionState<RecordMilestoneState, FormData>(
    recordMilestone.bind(null, props.shipmentId), undefined);
  // Rendered in the browser only: the default time uses the device's time zone and
  // the idempotency key must be created once per form, on the device.
  const isClient = useSyncExternalStore(noopSubscribe, () => true, () => false);
  if (!isClient) return <p className="text-sm text-muted-foreground">Loading form…</p>;
  // a fresh form (new idempotency key, cleared fields) after each recorded milestone
  return <MilestoneFields key={state?.recorded ?? 0} {...props} state={state} action={action} pending={pending} />;
}

function MilestoneFields({
  options, containers, evidence, canOverride, state, action, pending,
}: {
  options: MilestoneOption[];
  containers: Container[];
  evidence: Evidence[];
  canOverride: boolean;
  state: RecordMilestoneState;
  action: (fd: FormData) => void;
  pending: boolean;
}) {
  const id = useId();
  const [, startTransition] = useTransition();
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [type, setType] = useState("");
  const [when, setWhen] = useState(() => toLocalInputValue(new Date()));
  const [latest] = useState(() => toLocalInputValue(new Date(Date.now() + 10 * 60e3)));
  const option = options.find((o) => o.entry.milestone_type === type);
  const [picked, setPicked] = useState<string[]>([]);
  const [visible, setVisible] = useState(true);

  const perContainer = option && option.entry.scope !== "shipment";
  const eventAtIso = useMemo(() => {
    const d = new Date(when);
    return Number.isNaN(d.getTime()) ? "" : d.toISOString();
  }, [when]);

  function choose(next: string) {
    setType(next);
    const o = options.find((x) => x.entry.milestone_type === next);
    // pre-select the containers for which this is the next step
    setPicked(o && o.entry.scope === "container" ? o.eligible : []);
    setVisible(o?.entry.client_visible_default ?? true);
  }

  const outOfOrder = !!option && (option.problems.length > 0
    || (perContainer && picked.some((c) => !option.eligible.includes(c))));
  const reasons = option ? [
    ...option.problems,
    ...(perContainer ? picked.filter((c) => !option.eligible.includes(c))
      .map((c) => containers.find((x) => x.id === c))
      .map((c) => `${c?.label} is ${c?.status.toLowerCase()}`) : []),
  ] : [];
  const pastPicked = option ? picked.filter((c) => option.past.includes(c)) : [];

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); // submit manually so the fields are kept if the database refuses
    const fd = new FormData(e.currentTarget);
    startTransition(() => action(fd));
  }

  const groups = new Map<string, MilestoneOption[]>();
  for (const o of options) {
    const g = milestoneGroup(o.entry.sort_order);
    groups.set(g, [...(groups.get(g) ?? []), o]);
  }
  const err = state?.fieldErrors;

  if (options.length === 0) {
    return <p className="text-sm text-muted-foreground">There are no milestones your role can record on this shipment.</p>;
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      {state?.ok && state.message && <FormAlert kind="success">{state.message}</FormAlert>}
      {state?.error && <FormAlert kind="error">{state.error}</FormAlert>}
      <input type="hidden" name="idempotency_key" value={idempotencyKey} />
      <input type="hidden" name="event_at" value={eventAtIso} />

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField id={`${id}-type`} label="Milestone" errors={err?.milestone}>
          <NativeSelect id={`${id}-type`} name="milestone" value={type} onChange={(e) => choose(e.target.value)}
            required aria-invalid={!!err?.milestone}>
            <option value="">Choose…</option>
            {[...groups.entries()].map(([group, list]) => (
              <optgroup key={group} label={group}>
                {list.map((o) => (
                  <option key={o.entry.milestone_type} value={o.entry.milestone_type}>
                    {o.entry.label}{o.problems.length || (o.entry.scope === "container" && o.eligible.length === 0) ? " (out of order)" : ""}
                  </option>
                ))}
              </optgroup>
            ))}
          </NativeSelect>
        </FormField>
        <FormField id={`${id}-when`} label="When it happened" errors={err?.eventAt}
          description="Your device's local time">
          <Input id={`${id}-when`} type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)}
            max={latest} required aria-invalid={!!err?.eventAt} />
        </FormField>
      </div>

      {perContainer && containers.length > 0 && (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium">
            Containers{option.entry.scope === "either" && <span className="font-normal text-muted-foreground"> (optional; none = whole shipment)</span>}
          </legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {containers.map((c) => (
              <label key={c.id} className="flex min-w-0 items-center gap-2 rounded-md border p-2 text-sm has-checked:border-primary has-checked:bg-primary/5">
                <input type="checkbox" name="container_ids" value={c.id} className="size-4 accent-primary"
                  checked={picked.includes(c.id)}
                  onChange={(e) => setPicked((p) => (e.target.checked ? [...p, c.id] : p.filter((x) => x !== c.id)))} />
                <span className="font-mono font-medium">{c.label}</span>
                <span className="truncate text-xs text-muted-foreground">{c.status}</span>
              </label>
            ))}
          </div>
          {err?.containerIds && <p className="text-sm text-destructive">{err.containerIds[0]}</p>}
        </fieldset>
      )}

      {option && pastPicked.length > 0 && (
        <FormAlert kind="error">
          {pastPicked.map((c) => containers.find((x) => x.id === c)?.label).join(", ")} already passed this step.
          To change a past milestone, correct or cancel it in the timeline.
        </FormAlert>
      )}
      {option && outOfOrder && pastPicked.length === 0 && (
        <div className="flex gap-2 rounded-md border border-warning/40 bg-warning/15 px-3 py-2 text-sm">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p>
            This is not the next step ({reasons.join("; ")}).{" "}
            {canOverride ? "To record it anyway, give an override reason. It is kept in the history." : "Only an operations manager can record it out of order."}
          </p>
        </div>
      )}
      {option && outOfOrder && canOverride && (
        <FormField id={`${id}-override`} label="Override reason" errors={err?.overrideReason}>
          <Textarea id={`${id}-override`} name="override_reason" rows={2} maxLength={500} required
            aria-invalid={!!err?.overrideReason} />
        </FormField>
      )}

      {option && (
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField id={`${id}-loc`} label={option.entry.requires_location ? "Location" : "Location (optional)"} errors={err?.location}>
            <Input id={`${id}-loc`} name="location" maxLength={200} required={option.entry.requires_location}
              placeholder={type === "empty_returned" ? "Return depot" : "e.g. Dar es Salaam port, Rusumo border"}
              aria-invalid={!!err?.location} />
          </FormField>
          {LOCATION_KIND_MILESTONES.has(type) && (
            <FormField id={`${id}-kind`} label="Location type">
              <NativeSelect id={`${id}-kind`} name="location_kind" defaultValue="terminal">
                {(["terminal", "icd"] as const).map((k) => <option key={k} value={k}>{LOCATION_KIND_LABELS[k]}</option>)}
              </NativeSelect>
            </FormField>
          )}
          {SEAL_MILESTONES.has(type) && (
            <FormField id={`${id}-seal`} label="Seal number (optional)" errors={err?.sealNumber}>
              <Input id={`${id}-seal`} name="seal_number" maxLength={50} autoCapitalize="characters" />
            </FormField>
          )}
        </div>
      )}

      {option && (
        <>
          <FormField id={`${id}-note`} label="Note for the client (optional)" errors={err?.publicNote}>
            <Textarea id={`${id}-note`} name="public_note" rows={2} maxLength={2000} />
          </FormField>
          <FormField id={`${id}-inote`} label="Internal note (optional)" description="Only NGB staff can see this" errors={err?.internalNote}>
            <Textarea id={`${id}-inote`} name="internal_note" rows={2} maxLength={2000} />
          </FormField>
          {evidence.length > 0 && (
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-medium">Evidence (optional)</legend>
              <div className="flex max-h-40 flex-col gap-1 overflow-y-auto rounded-md border p-2">
                {evidence.map((d) => (
                  <label key={d.id} className="flex min-w-0 items-center gap-2 text-sm">
                    <input type="checkbox" name="evidence_ids" value={d.id} className="size-4 shrink-0 accent-primary" />
                    <span className="truncate">{d.label}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="client_visible" checked={visible} onChange={(e) => setVisible(e.target.checked)}
              className="size-4 accent-primary" />
            Show this milestone to the client
          </label>
        </>
      )}

      <div>
        <Button type="submit" disabled={pending || !option || pastPicked.length > 0 || (outOfOrder && !canOverride)}>
          {pending && <Loader2 className="animate-spin" aria-hidden />} Record milestone
        </Button>
      </div>
    </form>
  );
}
