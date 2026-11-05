"use client";

import { useId, useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { saveInvoiceDraft } from "@/lib/actions/finance";
import { formatAmount, previewLine, previewTotals, type LineInput } from "@/lib/domain/finance";
import { CURRENCIES } from "@/lib/domain/money";
import { useFormAction } from "@/components/forms/use-form-action";
import { FormField } from "@/components/forms/form-field";
import { FormAlert } from "@/components/auth/form-alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";

type Line = LineInput & { key: number };
const EMPTY: LineInput = { description: "", quantity: "1", unit_price: "", tax_rate: "18" };

/**
 * Draft invoice editor: lines with a live preview that rounds exactly like the
 * database (decimal strings, never floats). Saving replaces the draft's lines;
 * the database computes the stored totals.
 */
export function InvoiceEditor({
  invoiceId, shipments, shipmentId, initial,
}: {
  invoiceId: string | null;
  /** Choice of shipment for a new invoice; omitted when editing. */
  shipments?: { id: string; label: string; currency: string | null }[];
  shipmentId?: string;
  initial?: { currency: string; lines: LineInput[]; clientNote: string | null; paymentInstructions: string | null };
}) {
  const id = useId();
  const { state, pending, onSubmit, formRef, errors } = useFormAction(saveInvoiceDraft.bind(null, invoiceId), { resetOnSuccess: false });
  const next = useRef(initial?.lines.length ?? 1);
  const [lines, setLines] = useState<Line[]>(() => (initial?.lines.length ? initial.lines : [EMPTY]).map((l, key) => ({ ...l, key })));
  const [shipment, setShipment] = useState(shipmentId ?? "");
  const [currency, setCurrency] = useState(initial?.currency ?? shipments?.find((s) => s.id === shipmentId)?.currency ?? "USD");
  const totals = previewTotals(lines);

  const update = (key: number, patch: Partial<LineInput>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const add = () => setLines((ls) => [...ls, { ...EMPTY, key: next.current++ }]);
  const remove = (key: number) => setLines((ls) => (ls.length > 1 ? ls.filter((l) => l.key !== key) : ls));

  return (
    <form ref={formRef} onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      {state?.ok && <FormAlert kind="success">{state.message}</FormAlert>}
      {state?.error && <FormAlert kind="error">{state.error}</FormAlert>}
      <input type="hidden" name="lines" value={JSON.stringify(lines.map((l) => ({ description: l.description, quantity: l.quantity, unit_price: l.unit_price, tax_rate: l.tax_rate })))} />
      <div className="grid gap-3 sm:grid-cols-2">
        {shipments ? (
          <FormField id={`${id}-s`} label="Shipment" errors={errors?.shipmentId}>
            <NativeSelect id={`${id}-s`} name="shipment_id" value={shipment} required aria-invalid={!!errors?.shipmentId}
              onChange={(e) => {
                setShipment(e.target.value);
                const c = shipments.find((s) => s.id === e.target.value)?.currency;
                if (c) setCurrency(c);
              }}>
              <option value="">Choose…</option>
              {shipments.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </NativeSelect>
          </FormField>
        ) : <input type="hidden" name="shipment_id" value={shipment} />}
        <FormField id={`${id}-c`} label="Currency" errors={errors?.currency}>
          <NativeSelect id={`${id}-c`} name="currency" value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </NativeSelect>
        </FormField>
      </div>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 text-sm font-medium">Lines</legend>
        {errors?.lines && <p className="text-sm text-destructive">{errors.lines.join(" ")}</p>}
        {lines.map((l, i) => {
          const p = previewLine(l);
          const lineErrors = [...(errors?.[`lines.${i}`] ?? []), ...(errors?.[`lines.${i}.description`] ?? [])];
          return (
            <div key={l.key} className="grid grid-cols-2 gap-2 rounded-md border p-3 sm:grid-cols-[1fr_5rem_8rem_5rem_8rem_auto] sm:items-end">
              <FormField id={`${id}-d${l.key}`} label={`Line ${i + 1}`} className="col-span-2 sm:col-span-1">
                <Input id={`${id}-d${l.key}`} value={l.description} maxLength={300} placeholder="e.g. Port handling, Dar es Salaam"
                  onChange={(e) => update(l.key, { description: e.target.value })} />
              </FormField>
              <FormField id={`${id}-q${l.key}`} label="Qty">
                <Input id={`${id}-q${l.key}`} value={l.quantity} inputMode="decimal" onChange={(e) => update(l.key, { quantity: e.target.value })} />
              </FormField>
              <FormField id={`${id}-p${l.key}`} label="Unit price">
                <Input id={`${id}-p${l.key}`} value={l.unit_price} inputMode="decimal" placeholder="0.00" onChange={(e) => update(l.key, { unit_price: e.target.value })} />
              </FormField>
              <FormField id={`${id}-t${l.key}`} label="Tax %">
                <Input id={`${id}-t${l.key}`} value={l.tax_rate} inputMode="decimal" onChange={(e) => update(l.key, { tax_rate: e.target.value })} />
              </FormField>
              <div className="text-sm sm:text-right" aria-live="polite">
                {"error" in p
                  ? <span className="text-muted-foreground">{l.unit_price ? p.error : "—"}</span>
                  : <><span className="font-medium tabular-nums">{formatAmount(p.amount, currency)}</span><br />
                    <span className="text-xs text-muted-foreground tabular-nums">tax {formatAmount(p.tax, currency)}</span></>}
              </div>
              <Button type="button" variant="ghost" size="icon" onClick={() => remove(l.key)} disabled={lines.length === 1}
                aria-label={`Remove line ${i + 1}`} className="justify-self-end">
                <Trash2 className="size-4" aria-hidden />
              </Button>
              {lineErrors.length > 0 && <p className="col-span-2 text-sm text-destructive sm:col-span-6">{lineErrors.join(" ")}</p>}
            </div>
          );
        })}
        <div><Button type="button" variant="outline" onClick={add} disabled={lines.length >= 50}><Plus className="size-4" aria-hidden /> Add line</Button></div>
      </fieldset>

      <dl className="ml-auto grid w-full max-w-xs grid-cols-2 gap-1 text-sm tabular-nums">
        <dt className="text-muted-foreground">Subtotal</dt><dd className="text-right">{totals ? formatAmount(totals.subtotal, currency) : "—"}</dd>
        <dt className="text-muted-foreground">Tax</dt><dd className="text-right">{totals ? formatAmount(totals.tax, currency) : "—"}</dd>
        <dt className="font-medium">Total</dt><dd className="text-right font-semibold">{totals ? formatAmount(totals.total, currency) : "—"}</dd>
      </dl>

      <div className="grid gap-3 sm:grid-cols-2">
        <FormField id={`${id}-n`} label="Note to the client" description="Optional; printed on the invoice" errors={errors?.clientNote}>
          <Textarea id={`${id}-n`} name="client_note" rows={2} maxLength={2000} defaultValue={initial?.clientNote ?? ""} />
        </FormField>
        <FormField id={`${id}-pi`} label="Payment instructions" description="Bank or mobile money details" errors={errors?.paymentInstructions}>
          <Textarea id={`${id}-pi`} name="payment_instructions" rows={2} maxLength={2000} defaultValue={initial?.paymentInstructions ?? ""} />
        </FormField>
      </div>
      <div><Button type="submit" disabled={pending}>{invoiceId ? "Save draft" : "Create draft"}</Button></div>
    </form>
  );
}
