"use client";

import { useId, useRef } from "react";
import {
  issueCreditNote, issueInvoice, recordPayment, reviewPayment, setInvoiceDispute, voidInvoice, type FinanceState,
} from "@/lib/actions/finance";
import { PAYMENT_METHOD_LABELS, type PaymentMethod } from "@/lib/domain/finance";
import { useFormAction } from "@/components/forms/use-form-action";
import { FormField } from "@/components/forms/form-field";
import { FormAlert } from "@/components/auth/form-alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";

function Alerts({ state }: { state: FinanceState }) {
  return (
    <>
      {state?.ok && <FormAlert kind="success">{state.message}</FormAlert>}
      {state?.error && <FormAlert kind="error">{state.error}</FormAlert>}
    </>
  );
}

/** Issue a draft: assigns the next INV number; dates default to today and the client's terms. */
export function IssueInvoiceForm({ invoiceId, today, termsDays }: { invoiceId: string; today: string; termsDays: number }) {
  const id = useId();
  const { state, pending, onSubmit, formRef, errors } = useFormAction(issueInvoice.bind(null, invoiceId));
  return (
    <form ref={formRef} onSubmit={onSubmit} noValidate className="flex flex-col gap-3">
      <Alerts state={state} />
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField id={`${id}-i`} label="Issue date" description="Today or up to 60 days back" errors={errors?.issueDate}>
          <Input id={`${id}-i`} name="issue_date" type="date" defaultValue={today} max={today} />
        </FormField>
        <FormField id={`${id}-d`} label="Due date" description={`Empty: issue date + ${termsDays} days (client terms)`} errors={errors?.dueDate}>
          <Input id={`${id}-d`} name="due_date" type="date" min={today} />
        </FormField>
      </div>
      <p className="text-xs text-muted-foreground">Once issued, the invoice gets its number and can no longer be edited.</p>
      <div><Button type="submit" disabled={pending}>Issue invoice</Button></div>
    </form>
  );
}

export function RecordPaymentForm({ invoiceId, currency, max }: { invoiceId: string; currency: string; max: string }) {
  const id = useId();
  const { state, pending, onSubmit, formRef, errors } = useFormAction(recordPayment.bind(null, invoiceId, currency), { localTimes: ["paid_at"] });
  return (
    <form ref={formRef} onSubmit={onSubmit} noValidate className="flex flex-col gap-3">
      <Alerts state={state} />
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField id={`${id}-a`} label={`Amount (${currency})`} description={`Up to ${max} ${currency}`} errors={errors?.amount}>
          <Input id={`${id}-a`} name="amount" inputMode="decimal" placeholder="0.00" required aria-invalid={!!errors?.amount} />
        </FormField>
        <FormField id={`${id}-t`} label="Received" description="Your device's local time" errors={errors?.paidAt}>
          <Input id={`${id}-t`} name="paid_at" type="datetime-local" required aria-invalid={!!errors?.paidAt} />
        </FormField>
        <FormField id={`${id}-m`} label="Method" errors={errors?.method}>
          <NativeSelect id={`${id}-m`} name="method" defaultValue="bank_transfer">
            {(Object.keys(PAYMENT_METHOD_LABELS) as PaymentMethod[]).map((m) => <option key={m} value={m}>{PAYMENT_METHOD_LABELS[m]}</option>)}
          </NativeSelect>
        </FormField>
        <FormField id={`${id}-r`} label="Transaction reference" description="Required unless cash" errors={errors?.reference}>
          <Input id={`${id}-r`} name="reference" maxLength={100} aria-invalid={!!errors?.reference} />
        </FormField>
      </div>
      <FormField id={`${id}-n`} label="Note" description="Internal" errors={errors?.note}>
        <Textarea id={`${id}-n`} name="note" rows={2} maxLength={1000} />
      </FormField>
      <div><Button type="submit" disabled={pending}>Record payment</Button></div>
    </form>
  );
}

/** Verify (creates a receipt number) or reject with a reason. Finance only. */
export function ReviewPaymentForm({ paymentId }: { paymentId: string }) {
  const id = useId();
  const { state, pending, onSubmit, formRef, errors } = useFormAction(reviewPayment.bind(null, paymentId));
  const decision = useRef<HTMLInputElement>(null);
  return (
    <form ref={formRef} onSubmit={onSubmit} noValidate className="flex flex-col gap-2">
      <Alerts state={state} />
      <FormField id={`${id}-r`} label="Reason" description="Required to reject" errors={errors?.reason}>
        <Input id={`${id}-r`} name="reason" maxLength={1000} />
      </FormField>
      {/* the hidden field is set by the clicked button (useFormAction does not send the submitter) */}
      <input ref={decision} type="hidden" name="decision" defaultValue="verified" />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending} onClick={() => { if (decision.current) decision.current.value = "verified"; }}>Verify</Button>
        <Button type="submit" variant="outline" disabled={pending} onClick={() => { if (decision.current) decision.current.value = "rejected"; }}>Reject</Button>
      </div>
    </form>
  );
}

/** A reason form for void, dispute open/resolve, and (with an amount) credit notes. */
export function ReasonForm({
  kind, invoiceId, currency, max, open,
}: { kind: "credit" | "void" | "dispute"; invoiceId: string; currency?: string; max?: string; open?: boolean }) {
  const id = useId();
  const action = kind === "credit" ? issueCreditNote.bind(null, invoiceId, currency ?? "")
    : kind === "void" ? voidInvoice.bind(null, invoiceId)
    : setInvoiceDispute.bind(null, invoiceId, open ?? true);
  const { state, pending, onSubmit, formRef, errors } = useFormAction(action);
  const label = kind === "credit" ? "Issue credit note" : kind === "void" ? "Void invoice" : open ? "Open dispute" : "Resolve dispute";
  return (
    <form ref={formRef} onSubmit={onSubmit} noValidate className="flex flex-col gap-3">
      <Alerts state={state} />
      {kind === "credit" && (
        <FormField id={`${id}-a`} label={`Amount (${currency})`} description={max ? `Up to ${max} ${currency}` : undefined} errors={errors?.amount}>
          <Input id={`${id}-a`} name="amount" inputMode="decimal" placeholder="0.00" required aria-invalid={!!errors?.amount} />
        </FormField>
      )}
      <FormField id={`${id}-r`} label={kind === "dispute" && !open ? "How it was resolved" : "Reason"} errors={errors?.reason}>
        <Textarea id={`${id}-r`} name="reason" rows={2} maxLength={1000} required aria-invalid={!!errors?.reason} />
      </FormField>
      <div><Button type="submit" variant={kind === "void" ? "destructive" : "default"} disabled={pending}>{label}</Button></div>
    </form>
  );
}
