"use client";

import { useId } from "react";
import {
  addIncidentNote, approveCredit, closeShipment, recordCondition, reopenShipment, reportIncident, resolveIncident,
  setReturnTerms, type ClosureState,
} from "@/lib/actions/closure";
import { CONDITIONS, CONDITION_LABELS, INCIDENT_TYPE_LABELS, type IncidentType } from "@/lib/domain/closure";
import { useFormAction } from "@/components/forms/use-form-action";
import { FormField } from "@/components/forms/form-field";
import { FormAlert } from "@/components/auth/form-alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";

type Opt = { id: string; label: string };

function Alerts({ state }: { state: ClosureState }) {
  return (
    <>
      {state?.ok && <FormAlert kind="success">{state.message}</FormAlert>}
      {state?.error && <FormAlert kind="error">{state.error}</FormAlert>}
    </>
  );
}

/** One text field + a button; used for comments, resolutions, credit, close and reopen. */
function TextActionForm({
  action, name, label, description, submit, required = true, rows = 2, variant = "default", errorKey,
}: {
  action: (prev: ClosureState, fd: FormData) => Promise<ClosureState>;
  name: string; label: string; description?: string; submit: string; required?: boolean; rows?: number;
  variant?: "default" | "outline" | "destructive"; errorKey: string;
}) {
  const id = useId();
  const { state, pending, onSubmit, formRef, errors } = useFormAction(action);
  return (
    <form ref={formRef} onSubmit={onSubmit} noValidate className="flex flex-col gap-3">
      <Alerts state={state} />
      <FormField id={id} label={label} description={description} errors={errors?.[errorKey]}>
        <Textarea id={id} name={name} rows={rows} maxLength={2000} required={required} aria-invalid={!!errors?.[errorKey]} />
      </FormField>
      <div><Button type="submit" variant={variant} disabled={pending}>{submit}</Button></div>
    </form>
  );
}

export const IncidentNoteForm = ({ incidentId }: { incidentId: string }) => (
  <TextActionForm action={addIncidentNote.bind(null, incidentId)} name="note" errorKey="note" label="Comment" rows={1} submit="Add comment" variant="outline" />
);
export const ResolveIncidentForm = ({ incidentId }: { incidentId: string }) => (
  <TextActionForm action={resolveIncident.bind(null, incidentId)} name="resolution" errorKey="resolution" label="Outcome of the review"
    description="Operations manager or admin; this unblocks closure" submit="Resolve incident" />
);
export const CreditForm = ({ shipmentId }: { shipmentId: string }) => (
  <TextActionForm action={approveCredit.bind(null, shipmentId)} name="reason" errorKey="reason" label="Credit terms and reason"
    description="Lets the shipment close with an open balance; recorded with your name" submit="Approve credit" variant="outline" />
);
export const CloseForm = ({ shipmentId }: { shipmentId: string }) => (
  <TextActionForm action={closeShipment.bind(null, shipmentId)} name="note" errorKey="note" label="Closing note" description="Optional; internal"
    required={false} submit="Close shipment" />
);
export const ReopenForm = ({ shipmentId }: { shipmentId: string }) => (
  <TextActionForm action={reopenShipment.bind(null, shipmentId)} name="reason" errorKey="reason" label="Reason for reopening"
    description="Required; kept in the closure log" submit="Reopen shipment" variant="outline" />
);

export function ReturnTermsForm({ containers }: { containers: Opt[] }) {
  const id = useId();
  const { state, pending, onSubmit, formRef, errors } = useFormAction(setReturnTerms, { localTimes: ["deadline"] });
  return (
    <form ref={formRef} onSubmit={onSubmit} noValidate className="flex flex-col gap-3">
      <Alerts state={state} />
      <fieldset className="flex flex-col gap-1">
        <legend className="mb-1 text-sm font-medium">Containers</legend>
        {containers.map((c) => (
          <label key={c.id} className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="container_ids" value={c.id} defaultChecked={containers.length === 1} className="size-4 accent-primary" />
            <span className="font-mono">{c.label}</span>
          </label>
        ))}
        {errors?.containerIds && <p className="text-sm text-destructive">{errors.containerIds.join(" ")}</p>}
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField id={`${id}-d`} label="Return deadline" description="Your device's local time" errors={errors?.deadline}>
          <Input id={`${id}-d`} name="deadline" type="datetime-local" required aria-invalid={!!errors?.deadline} />
        </FormField>
        <FormField id={`${id}-p`} label="Return depot" errors={errors?.depot}>
          <Input id={`${id}-p`} name="depot" maxLength={200} placeholder="e.g. Kigali ICD empty depot" />
        </FormField>
      </div>
      <FormField id={`${id}-c`} label="Charges if late" description="Demurrage or detention, if known; the client sees this" errors={errors?.charges}>
        <Input id={`${id}-c`} name="charges" maxLength={500} />
      </FormField>
      <div><Button type="submit" variant="outline" disabled={pending}>Save return terms</Button></div>
    </form>
  );
}

export function ConditionForm({ containerId }: { containerId: string }) {
  const id = useId();
  const { state, pending, onSubmit, formRef, errors } = useFormAction(recordCondition.bind(null, containerId));
  return (
    <form ref={formRef} onSubmit={onSubmit} noValidate className="flex flex-col gap-2">
      <Alerts state={state} />
      <div className="grid gap-2 sm:grid-cols-[10rem_1fr_auto] sm:items-end">
        <FormField id={`${id}-c`} label="Condition" errors={errors?.condition}>
          <NativeSelect id={`${id}-c`} name="condition" defaultValue="sound">
            {CONDITIONS.map((c) => <option key={c} value={c}>{CONDITION_LABELS[c]}</option>)}
          </NativeSelect>
        </FormField>
        <FormField id={`${id}-n`} label="Note" description="Required for damage (opens an incident)" errors={errors?.note}>
          <Input id={`${id}-n`} name="note" maxLength={1000} />
        </FormField>
        <Button type="submit" variant="outline" disabled={pending}>Save</Button>
      </div>
    </form>
  );
}

export function ReportIncidentForm({ shipmentId, containers, evidence }: { shipmentId: string; containers: Opt[]; evidence: Opt[] }) {
  const id = useId();
  const { state, pending, onSubmit, formRef, errors } = useFormAction(reportIncident.bind(null, shipmentId));
  return (
    <form ref={formRef} onSubmit={onSubmit} noValidate className="flex flex-col gap-3">
      <Alerts state={state} />
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField id={`${id}-t`} label="Type" errors={errors?.type}>
          <NativeSelect id={`${id}-t`} name="type" defaultValue="" required aria-invalid={!!errors?.type}>
            <option value="">Choose…</option>
            {(Object.keys(INCIDENT_TYPE_LABELS) as IncidentType[]).map((t) => <option key={t} value={t}>{INCIDENT_TYPE_LABELS[t]}</option>)}
          </NativeSelect>
        </FormField>
        <FormField id={`${id}-c`} label="Container" errors={errors?.containerId}>
          <NativeSelect id={`${id}-c`} name="container_id" defaultValue="">
            <option value="">Whole shipment</option>
            {containers.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </NativeSelect>
        </FormField>
      </div>
      <FormField id={`${id}-d`} label="What happened" errors={errors?.description}>
        <Textarea id={`${id}-d`} name="description" rows={3} maxLength={2000} required aria-invalid={!!errors?.description} />
      </FormField>
      {evidence.length > 0 && (
        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 text-sm font-medium">Evidence (uploaded documents and photos)</legend>
          {evidence.map((d) => (
            <label key={d.id} className="flex min-w-0 items-center gap-2 text-sm">
              <input type="checkbox" name="evidence" value={d.id} className="size-4 shrink-0 accent-primary" />
              <span className="truncate">{d.label}</span>
            </label>
          ))}
        </fieldset>
      )}
      <div><Button type="submit" disabled={pending}>Record incident</Button></div>
    </form>
  );
}
