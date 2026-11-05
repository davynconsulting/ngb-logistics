"use client";

import { useActionState, useId, useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { registerShipment, type RegisterState } from "@/lib/actions/shipments";
import { CONTAINER_SIZE_TYPES, REQUIRED_DOCUMENT_CHOICES } from "@/lib/validation/shipment";
import { COUNTRIES } from "@/lib/validation/common";
import { isValidContainerNumber, normalizeContainerNumber } from "@/lib/domain/container-number";
import { ROLE_LABELS, type AppRole } from "@/lib/auth/roles";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import { FieldGroup, FieldLegend, FieldSet } from "@/components/ui/field";
import { FormField } from "@/components/forms/form-field";
import { FormAlert } from "@/components/auth/form-alert";

type Option = { id: string; label: string };
type Row = { key: number; container_number: string; size_type: string; seal_number: string };

export function RegisterShipmentForm({
  clients, ports, staff, currentUserId,
}: {
  clients: Option[];
  ports: Option[];
  staff: { id: string; full_name: string; email: string | null; role: AppRole }[];
  currentUserId: string;
}) {
  const [state, action, pending] = useActionState<RegisterState, FormData>(registerShipment, undefined);
  const v = (state?.values ?? {}) as Record<string, unknown>;
  const val = (k: string) => (typeof v[k] === "string" ? (v[k] as string) : undefined);
  const err = (k: string) => state?.fieldErrors?.[k];
  const baseId = useId();

  const [rows, setRows] = useState<Row[]>([{ key: 0, container_number: "", size_type: "40HC", seal_number: "" }]);
  const [nextKey, setNextKey] = useState(1);
  // Restore container rows after a failed submit
  const [restoredFrom, setRestoredFrom] = useState<unknown>(undefined);
  if (state?.values && state.values !== restoredFrom && Array.isArray(v.containers)) {
    setRestoredFrom(state.values);
    const restored = (v.containers as Omit<Row, "key">[]).map((c, i) => ({ ...c, key: 1000 + i }));
    setRows(restored.length ? restored : rows);
  }
  const docs = Array.isArray(v.required_documents)
    ? (v.required_documents as string[])
    : ["bill_of_lading", "commercial_invoice", "packing_list"];

  const update = (key: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  return (
    <form action={action} noValidate className="flex flex-col gap-8">
      {state?.error && <FormAlert kind="error">{state.error}</FormAlert>}
      {state?.fieldErrors && !state.error && <FormAlert kind="error">Please correct the highlighted fields.</FormAlert>}

      <FieldSet>
        <FieldLegend>Client & bill of lading</FieldLegend>
        <FieldGroup className="grid gap-4 sm:grid-cols-2">
          <FormField id="client_id" label="Client" errors={err("client_id")} className="sm:col-span-2">
            <NativeSelect id="client_id" name="client_id" defaultValue={val("client_id") ?? ""} aria-invalid={!!err("client_id")}>
              <option value="">Choose the client…</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </NativeSelect>
          </FormField>
          <FormField id="bl_number" label="Bill of lading number" errors={err("bl_number")} description="Leave empty if not received yet">
            <Input id="bl_number" name="bl_number" autoCapitalize="characters" defaultValue={val("bl_number")}
              aria-invalid={!!err("bl_number")} className="uppercase" />
          </FormField>
          <FormField id="booking_reference" label="Booking reference" errors={err("booking_reference")}>
            <Input id="booking_reference" name="booking_reference" defaultValue={val("booking_reference")} />
          </FormField>
        </FieldGroup>
      </FieldSet>

      <FieldSet>
        <FieldLegend>Vessel & route</FieldLegend>
        <FieldGroup className="grid gap-4 sm:grid-cols-3">
          <FormField id="shipping_line" label="Shipping line" errors={err("shipping_line")}>
            <Input id="shipping_line" name="shipping_line" defaultValue={val("shipping_line")} />
          </FormField>
          <FormField id="vessel_name" label="Vessel" errors={err("vessel_name")}>
            <Input id="vessel_name" name="vessel_name" defaultValue={val("vessel_name")} />
          </FormField>
          <FormField id="voyage_number" label="Voyage" errors={err("voyage_number")}>
            <Input id="voyage_number" name="voyage_number" defaultValue={val("voyage_number")} className="uppercase" />
          </FormField>
          <FormField id="origin_port_id" label="Port of discharge" errors={err("origin_port_id")}>
            <NativeSelect id="origin_port_id" name="origin_port_id" defaultValue={val("origin_port_id") ?? ""} aria-invalid={!!err("origin_port_id")}>
              <option value="">Choose…</option>
              {ports.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </NativeSelect>
          </FormField>
          <FormField id="origin_terminal" label="Terminal / ICD" errors={err("origin_terminal")}>
            <Input id="origin_terminal" name="origin_terminal" defaultValue={val("origin_terminal")} />
          </FormField>
          <FormField id="planned_vessel_arrival" label="Planned vessel arrival" errors={err("planned_vessel_arrival")}>
            <Input id="planned_vessel_arrival" name="planned_vessel_arrival" type="date" defaultValue={val("planned_vessel_arrival")}
              aria-invalid={!!err("planned_vessel_arrival")} />
          </FormField>
          <FormField id="destination_country" label="Destination country" errors={err("destination_country")}>
            <NativeSelect id="destination_country" name="destination_country" defaultValue={val("destination_country") ?? "RW"}>
              {COUNTRIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </NativeSelect>
          </FormField>
          <FormField id="destination_city" label="Destination city" errors={err("destination_city")}>
            <Input id="destination_city" name="destination_city" defaultValue={val("destination_city")} aria-invalid={!!err("destination_city")} />
          </FormField>
          <FormField id="delivery_address" label="Delivery address" errors={err("delivery_address")}>
            <Input id="delivery_address" name="delivery_address" defaultValue={val("delivery_address")} />
          </FormField>
        </FieldGroup>
      </FieldSet>

      <FieldSet>
        <FieldLegend>Cargo</FieldLegend>
        <FieldGroup className="grid gap-4 sm:grid-cols-3">
          <FormField id="cargo_description" label="Description" errors={err("cargo_description")} className="sm:col-span-3">
            <Textarea id="cargo_description" name="cargo_description" rows={2} defaultValue={val("cargo_description")} />
          </FormField>
          <FormField id="package_count" label="Packages" errors={err("package_count")}>
            <Input id="package_count" name="package_count" type="number" inputMode="numeric" min={0} defaultValue={val("package_count")}
              aria-invalid={!!err("package_count")} />
          </FormField>
          <FormField id="gross_weight_kg" label="Gross weight (kg)" errors={err("gross_weight_kg")}>
            <Input id="gross_weight_kg" name="gross_weight_kg" inputMode="decimal" defaultValue={val("gross_weight_kg")}
              aria-invalid={!!err("gross_weight_kg")} />
          </FormField>
          <FormField id="assigned_ops_user_id" label="Responsible staff" errors={err("assigned_ops_user_id")}>
            <NativeSelect id="assigned_ops_user_id" name="assigned_ops_user_id" defaultValue={val("assigned_ops_user_id") ?? currentUserId}>
              {staff.map((s) => <option key={s.id} value={s.id}>{s.full_name || s.email} · {ROLE_LABELS[s.role]}</option>)}
            </NativeSelect>
          </FormField>
        </FieldGroup>
      </FieldSet>

      <FieldSet>
        <FieldLegend>Containers</FieldLegend>
        {err("containers") && <FormAlert kind="error">{err("containers")![0]}</FormAlert>}
        <ol className="flex flex-col gap-3">
          {rows.map((r, i) => {
            const id = `${baseId}-c${r.key}`;
            const e = err(`containers.${i}.container_number`);
            const typed = normalizeContainerNumber(r.container_number);
            const hint = typed.length === 11 && !isValidContainerNumber(typed) ? ["Check digit doesn't match"] : undefined;
            return (
              <li key={r.key} className="grid gap-3 rounded-md border p-3 sm:grid-cols-[1fr_10rem_1fr_auto] sm:items-end">
                <FormField id={`${id}-n`} label={`Container ${i + 1}`} errors={e ?? hint}>
                  <Input id={`${id}-n`} name="container_number" value={r.container_number} autoCapitalize="characters"
                    placeholder="e.g. MSKU1234565" className="font-mono uppercase" aria-invalid={!!(e ?? hint)}
                    onChange={(ev) => update(r.key, { container_number: ev.target.value })} />
                </FormField>
                <FormField id={`${id}-s`} label="Size / type">
                  <NativeSelect id={`${id}-s`} name="size_type" value={r.size_type} onChange={(ev) => update(r.key, { size_type: ev.target.value })}>
                    <option value="">—</option>
                    {CONTAINER_SIZE_TYPES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </NativeSelect>
                </FormField>
                <FormField id={`${id}-seal`} label="Seal number">
                  <Input id={`${id}-seal`} name="seal_number" value={r.seal_number} className="uppercase"
                    onChange={(ev) => update(r.key, { seal_number: ev.target.value })} />
                </FormField>
                <Button type="button" variant="ghost" size="icon" disabled={rows.length === 1}
                  aria-label={`Remove container ${i + 1}`} onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}>
                  <Trash2 aria-hidden />
                </Button>
              </li>
            );
          })}
        </ol>
        <div>
          <Button type="button" variant="outline" size="sm" onClick={() => {
            setRows((rs) => [...rs, { key: nextKey, container_number: "", size_type: rs.at(-1)?.size_type ?? "40HC", seal_number: "" }]);
            setNextKey((k) => k + 1);
          }}>
            <Plus aria-hidden /> Add container
          </Button>
        </div>
      </FieldSet>

      <FieldSet>
        <FieldLegend>Required documents</FieldLegend>
        <div className="grid gap-2 sm:grid-cols-2">
          {REQUIRED_DOCUMENT_CHOICES.map((d) => (
            <label key={d.value} className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="required_documents" value={d.value} defaultChecked={docs.includes(d.value)}
                className="size-4 accent-primary" />
              {d.label}
            </label>
          ))}
        </div>
      </FieldSet>

      <div>
        <Button type="submit" size="lg" disabled={pending} className="w-full sm:w-auto">
          {pending && <Loader2 className="animate-spin" aria-hidden />}
          Register shipment
        </Button>
        <p className="mt-2 text-xs text-muted-foreground">The shipment is saved as a draft with a new NGB reference.</p>
      </div>
    </form>
  );
}
