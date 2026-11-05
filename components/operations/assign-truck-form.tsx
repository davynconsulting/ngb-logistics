"use client";

import { useId, useState } from "react";
import { assignTransport } from "@/lib/actions/operations";
import { useFormAction } from "@/components/forms/use-form-action";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import { FormField } from "@/components/forms/form-field";
import { FormAlert } from "@/components/auth/form-alert";

type Candidate = { id: string; label: string; status: string; needsOverride: boolean };

/** Assign a truck (and optionally driver, route, planned loading) to one or more containers. */
export function AssignTruckForm({
  shipmentId, candidates, routes, drivers, canOverride,
}: {
  shipmentId: string;
  candidates: Candidate[];
  routes: { id: string; name: string }[];
  drivers: { id: string; label: string }[];
  canOverride: boolean;
}) {
  const id = useId();
  const { state, pending, onSubmit, formRef, errors } = useFormAction(assignTransport.bind(null, shipmentId), { localTimes: ["planned_loading_at"] });
  const [picked, setPicked] = useState<string[]>(() => candidates.filter((c) => !c.needsOverride).map((c) => c.id));
  const early = candidates.filter((c) => picked.includes(c.id) && c.needsOverride);

  return (
    <form ref={formRef} onSubmit={onSubmit} noValidate className="flex flex-col gap-3">
      {state?.ok && <FormAlert kind="success">{state.message}</FormAlert>}
      {state?.error && <FormAlert kind="error">{state.error}</FormAlert>}
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">Containers</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {candidates.map((c) => (
            <label key={c.id} className="flex min-w-0 items-center gap-2 rounded-md border p-2 text-sm has-checked:border-primary has-checked:bg-primary/5">
              <input type="checkbox" name="container_ids" value={c.id} className="size-4 accent-primary" checked={picked.includes(c.id)}
                onChange={(e) => setPicked((p) => (e.target.checked ? [...p, c.id] : p.filter((x) => x !== c.id)))} />
              <span className="font-mono font-medium">{c.label}</span>
              <span className="truncate text-xs text-muted-foreground">{c.status}</span>
            </label>
          ))}
        </div>
        {errors?.containerIds && <p className="text-sm text-destructive">{errors.containerIds[0]}</p>}
      </fieldset>
      {early.length > 0 && (
        <FormAlert kind="info">
          {early.map((c) => c.label).join(", ")} {early.length === 1 ? "is" : "are"} not ready for dispatch yet.{" "}
          {canOverride ? "Give an override reason to assign a truck now." : "Only an operations manager can assign a truck this early."}
        </FormAlert>
      )}
      {early.length > 0 && canOverride && (
        <FormField id={`${id}-ovr`} label="Override reason" errors={errors?.overrideReason}>
          <Textarea id={`${id}-ovr`} name="override_reason" rows={2} maxLength={500} required />
        </FormField>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField id={`${id}-carrier`} label="Transporter" errors={errors?.transporter}>
          <Input id={`${id}-carrier`} name="transporter" maxLength={120} required aria-invalid={!!errors?.transporter} />
        </FormField>
        <FormField id={`${id}-truck`} label="Truck registration" errors={errors?.truck}>
          <Input id={`${id}-truck`} name="truck" maxLength={20} required autoCapitalize="characters" placeholder="e.g. T 123 ABC" aria-invalid={!!errors?.truck} />
        </FormField>
        <FormField id={`${id}-trailer`} label="Trailer registration (optional)" errors={errors?.trailer}>
          <Input id={`${id}-trailer`} name="trailer" maxLength={20} autoCapitalize="characters" />
        </FormField>
        <FormField id={`${id}-route`} label="Route (optional)">
          <NativeSelect id={`${id}-route`} name="route_id" defaultValue="">
            <option value="">No route yet</option>
            {routes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </NativeSelect>
        </FormField>
        <FormField id={`${id}-driver`} label="Driver name (optional)" errors={errors?.driverName}>
          <Input id={`${id}-driver`} name="driver_name" maxLength={120} autoComplete="off" />
        </FormField>
        <FormField id={`${id}-phone`} label="Driver phone (optional)" description="Staff only; never shown to clients" errors={errors?.driverPhone}>
          <Input id={`${id}-phone`} name="driver_phone" type="tel" inputMode="tel" placeholder="+250788123456" />
        </FormField>
        {drivers.length > 0 && (
          <FormField id={`${id}-duser`} label="Driver app user (optional)" description="Gives the driver access to this shipment">
            <NativeSelect id={`${id}-duser`} name="driver_user_id" defaultValue="">
              <option value="">None</option>
              {drivers.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
            </NativeSelect>
          </FormField>
        )}
        <FormField id={`${id}-plan`} label="Planned loading (optional)" errors={errors?.plannedLoadingAt}>
          <Input id={`${id}-plan`} name="planned_loading_at" type="datetime-local" />
        </FormField>
      </div>
      <FormField id={`${id}-refs`} label="Transit document references (optional)" description="Separate with commas" errors={errors?.transitRefs}>
        <Input id={`${id}-refs`} name="transit_refs" maxLength={700} />
      </FormField>
      <div><Button type="submit" disabled={pending || picked.length === 0 || (early.length > 0 && !canOverride)}>Assign truck</Button></div>
    </form>
  );
}
