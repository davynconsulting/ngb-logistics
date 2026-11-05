"use client";

import { useId, useState } from "react";
import { actOnException } from "@/lib/actions/operations";
import { SEVERITY_LABELS, type ExceptionSeverity } from "@/lib/domain/operations";
import { useFormAction } from "@/components/forms/use-form-action";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import { FormField } from "@/components/forms/form-field";
import { FormAlert } from "@/components/auth/form-alert";

type Mode = "update" | "escalate" | "resolve";

/** Follow up, escalate or resolve an open exception. The database checks who may do what. */
export function ExceptionActions({
  exceptionId, staff, canLead, canEscalate,
}: {
  exceptionId: string;
  staff: { id: string; label: string }[];
  /** owner or ops manager/admin: may reassign, change severity and resolve */
  canLead: boolean;
  canEscalate: boolean;
}) {
  const [mode, setMode] = useState<Mode | null>(null);
  if (!mode) {
    return (
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" onClick={() => setMode("update")}>Add follow-up</Button>
        {canEscalate && <Button type="button" size="sm" variant="outline" onClick={() => setMode("escalate")}>Escalate</Button>}
        {canLead && <Button type="button" size="sm" onClick={() => setMode("resolve")}>Resolve</Button>}
      </div>
    );
  }
  return <ActionForm key={mode} exceptionId={exceptionId} mode={mode} staff={staff} canLead={canLead} onClose={() => setMode(null)} />;
}

function ActionForm({ exceptionId, mode, staff, canLead, onClose }: {
  exceptionId: string; mode: Mode; staff: { id: string; label: string }[]; canLead: boolean; onClose: () => void;
}) {
  const id = useId();
  const { state, pending, onSubmit, formRef, errors } = useFormAction(actOnException.bind(null, exceptionId), { localTimes: ["follow_up_at"] });
  if (state?.ok) {
    return (
      <div className="flex flex-col gap-2">
        <FormAlert kind="success">{state.message}</FormAlert>
        <Button type="button" size="sm" variant="ghost" className="self-start" onClick={onClose}>Close</Button>
      </div>
    );
  }
  return (
    <form ref={formRef} onSubmit={onSubmit} noValidate className="flex flex-col gap-3 rounded-md border bg-muted/30 p-3">
      <input type="hidden" name="op" value={mode} />
      {state?.error && <FormAlert kind="error">{state.error}</FormAlert>}
      {mode === "update" && (
        <>
          <FormField id={`${id}-note`} label="Note" errors={errors?.note}>
            <Textarea id={`${id}-note`} name="note" rows={2} maxLength={2000} />
          </FormField>
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField id={`${id}-next`} label="Next action" errors={errors?.nextAction}>
              <Input id={`${id}-next`} name="next_action" maxLength={500} />
            </FormField>
            <FormField id={`${id}-fu`} label="Next follow-up" errors={errors?.followUpAt}>
              <Input id={`${id}-fu`} name="follow_up_at" type="datetime-local" />
            </FormField>
            {canLead && (
              <>
                <FormField id={`${id}-owner`} label="Reassign to">
                  <NativeSelect id={`${id}-owner`} name="owner_id" defaultValue="">
                    <option value="">Keep owner</option>
                    {staff.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                  </NativeSelect>
                </FormField>
                <FormField id={`${id}-sev`} label="Severity">
                  <NativeSelect id={`${id}-sev`} name="severity" defaultValue="">
                    <option value="">Keep</option>
                    {(Object.keys(SEVERITY_LABELS) as ExceptionSeverity[]).map((s) => <option key={s} value={s}>{SEVERITY_LABELS[s]}</option>)}
                  </NativeSelect>
                </FormField>
              </>
            )}
          </div>
        </>
      )}
      {mode === "escalate" && (
        <FormField id={`${id}-esc`} label="Why does it need the operations manager?" errors={errors?.note}>
          <Textarea id={`${id}-esc`} name="note" rows={2} maxLength={2000} required />
        </FormField>
      )}
      {mode === "resolve" && (
        <FormField id={`${id}-res`} label="How was it resolved?" errors={errors?.resolution}>
          <Textarea id={`${id}-res`} name="resolution" rows={2} maxLength={1000} required />
        </FormField>
      )}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {mode === "update" ? "Save follow-up" : mode === "escalate" ? "Escalate" : "Resolve exception"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onClose}>Close</Button>
      </div>
    </form>
  );
}
