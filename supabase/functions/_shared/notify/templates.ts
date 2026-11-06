/*
 * Notification texts (English; `locale` is accepted for fr/rw/sw later).
 * Pure and self-contained: used by the sender (push + WhatsApp) and by the
 * portal inbox. Payloads come from the database triggers and contain only
 * client-safe fields for client templates (see migration 0014).
 *
 * URLs are app-relative paths; the service worker opens them on our own
 * origin only.
 */

export type NotificationInput = {
  template_key: string;
  payload: Record<string, unknown>;
  shipment_id?: string | null;
  locale?: string | null;
  timezone?: string | null;
};

export type RenderedNotification = {
  title: string;
  body: string;
  url: string;
  /** Replaces an earlier notification with the same tag on the device. */
  tag: string;
  whatsapp: { template: string; params: string[]; text: string };
};

export class UnknownTemplateError extends Error {}

/** Same labels as lib/domain/documents.ts (a unit test keeps them in sync). */
export const DOC_LABELS: Record<string, string> = {
  bill_of_lading: "Bill of lading",
  commercial_invoice: "Commercial invoice",
  packing_list: "Packing list",
  certificate_of_origin: "Certificate of origin",
  delivery_order: "Delivery order",
  customs_entry: "Customs entry",
  release_order: "Release order",
  gate_pass: "Gate pass",
  transit_document: "Transit document",
  proof_of_delivery: "Proof of delivery (POD)",
  container_return_receipt: "Container return receipt",
  photo: "Photo",
  invoice: "Invoice",
  receipt: "Receipt",
  other: "Other",
};

const INCIDENT_LABELS: Record<string, string> = {
  seal_damaged: "Seal damaged", cargo_damage: "Cargo damage", cargo_shortage: "Cargo shortage",
  container_damage: "Container damage", delivery_discrepancy: "Delivery discrepancy", other: "Incident",
};

const SEVERITY: Record<string, string> = { low: "Low", medium: "Medium", high: "High", critical: "Critical" };

/** Milestones after which the ETA is worth repeating to the client. */
const SHOW_ETA = new Set(["vessel_arrived", "container_discharged", "customs_released", "loaded", "gate_out",
  "transit_checkpoint", "arrived_at_border", "border_crossed", "update"]);

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

export function formatWhen(iso: unknown, timeZone: string): string | null {
  const s = str(iso);
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).format(d);
  } catch {
    return formatWhen(iso, "Africa/Kigali");
  }
}

function containersText(v: unknown): string | null {
  const list = Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  if (list.length === 0) return null;
  if (list.length <= 2) return list.join(" and ");
  return `${list.length} containers`;
}

/** "2878.49" + "USD" → "2,878.49 USD". String-only (amounts arrive as exact text; never floats). */
export function formatMoneyText(amount: unknown, currency: unknown): string | null {
  const a = str(amount);
  if (!a || !/^\d+(\.\d{1,2})?$/.test(a)) return null;
  const [int, frac = ""] = a.split(".");
  const grouped = int.replace(/^0+(?=\d)/, "").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${grouped}.${frac.padEnd(2, "0")}${str(currency) ? ` ${str(currency)}` : ""}`;
}

/** "2026-12-05" → "5 Dec 2026" (a calendar date: no time-zone shift). */
export function formatDay(v: unknown): string | null {
  const m = str(v)?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(m[2]) - 1];
  return month ? `${Number(m[3])} ${month} ${m[1]}` : null;
}

const invoiceUrl = (n: string | null) => (n && /^INV-\d{4}-\d{5,}$/.test(n) ? `/portal/invoices/${n}` : "/portal/invoices");

const adminInvoiceUrl = (id: unknown) => (str(id) && /^[0-9a-f-]{36}$/i.test(String(id)) ? `/admin/finance/invoices/${id}` : "/admin/finance");

const portalUrl = (ref: string | null) => (ref ? `/portal/shipments/${encodeURIComponent(ref)}` : "/portal");
const adminUrl = (id: unknown) => (str(id) && /^[0-9a-f-]{36}$/i.test(String(id)) ? `/admin/shipments/${id}` : "/admin");

export function renderNotification(n: NotificationInput): RenderedNotification {
  const p = n.payload ?? {};
  const tz = str(n.timezone) ?? str(p.timezone) ?? "Africa/Kigali";
  const ref = str(p.reference);
  const shipmentId = str(n.shipment_id) ?? str(p.shipment_id);
  const key = n.template_key;
  const when = (v: unknown) => formatWhen(v, tz);
  let title: string, body: string, url: string, tag: string;

  if (key === "account.activated") {
    title = "Welcome to NGB LOGISTICS";
    body = `Your account${str(p.organization) ? ` for ${str(p.organization)}` : ""} is active. Track your shipments, documents and ETAs here.`;
    url = "/portal";
    tag = "account";
  } else if (key.startsWith("milestone.")) {
    const milestone = key.slice("milestone.".length);
    const label = str(p.label) ?? milestone.replace(/_/g, " ");
    const parts = [label];
    const c = containersText(p.containers);
    if (c) parts.push(`for ${c}`);
    if (str(p.location)) parts.push(`at ${str(p.location)}`);
    const at = when(p.event_at);
    if (at) parts.push(`on ${at}`);
    let text = `${parts.join(" ")}.`;
    if (milestone === "gate_out" && str(p.route)) text += ` Route: ${str(p.route)}.`;
    if (milestone === "shipment_confirmed") {
      const missing = Array.isArray(p.missing_documents) ? p.missing_documents.map((d) => DOC_LABELS[String(d)] ?? String(d)) : [];
      text += missing.length ? ` Documents still needed: ${missing.join(", ")}.` : " All required documents received.";
    }
    const eta = SHOW_ETA.has(milestone) ? when(p.current_eta) : null;
    if (eta) text += ` ETA ${eta}.`;
    if (str(p.note)) text += ` ${clip(str(p.note)!, 200)}`;
    title = ref ? `${ref}: ${label}` : label;
    body = text;
    url = portalUrl(ref);
    tag = `shipment-${shipmentId ?? ref ?? "x"}`;
  } else if (key === "eta.changed") {
    const from = when(p.previous_eta), to = when(p.new_eta);
    title = ref ? `${ref}: new ETA` : "New ETA";
    body = `${from ? `ETA changed from ${from} to ${to}.` : `ETA is ${to}.`}${str(p.reason) ? ` Reason: ${clip(str(p.reason)!, 200)}` : ""}`;
    url = portalUrl(ref);
    tag = `eta-${shipmentId ?? ref ?? "x"}`;
  } else if (key === "document.rejected") {
    const doc = DOC_LABELS[String(p.document_type)] ?? "A document";
    const due = str(p.due_date);
    title = ref ? `${ref}: document needed` : "Document needed";
    body = `${doc} was not accepted${str(p.reason) ? `: ${clip(str(p.reason)!, 200)}` : ""}. Please upload a corrected copy${due ? ` by ${due}` : ""}.`;
    url = portalUrl(ref);
    tag = `doc-${shipmentId ?? ref ?? "x"}-${String(p.document_type)}`;
  } else if (key === "invoice.issued") {
    const inv = str(p.invoice_number);
    const total = formatMoneyText(p.total, p.currency);
    const due = formatDay(p.due_date);
    title = inv ? `Invoice ${inv}` : "New invoice";
    body = `${ref ? `${ref}: ` : ""}invoice${total ? ` for ${total}` : ""}${due ? `, due ${due}` : ""}.`;
    if (str(p.balance_due) && p.balance_due !== p.total) body += ` Balance: ${formatMoneyText(p.balance_due, p.currency)}.`;
    if (str(p.payment_instructions)) body += ` How to pay: ${clip(str(p.payment_instructions)!, 300)}`;
    url = invoiceUrl(inv);
    tag = `invoice-${inv ?? "x"}`;
  } else if (key === "payment.verified") {
    const inv = str(p.invoice_number);
    const amount = formatMoneyText(p.amount, p.currency);
    const balance = formatMoneyText(p.balance_due, p.currency);
    const rcpt = str(p.receipt_number);
    title = inv ? `${inv}: payment received` : "Payment received";
    body = `We received ${amount ?? "your payment"}${str(p.transaction_reference) ? ` (ref ${clip(str(p.transaction_reference)!, 60)})` : ""}.`
      + (balance ? (/^0+(\.0+)?$/.test(String(p.balance_due)) ? " The invoice is paid in full." : ` Remaining balance: ${balance}.`) : "")
      + (rcpt ? ` Receipt ${rcpt}.` : "");
    url = rcpt && /^RCPT-\d{4}-\d{5,}$/.test(rcpt) ? `/portal/receipts/${rcpt}` : invoiceUrl(inv);
    tag = `payment-${inv ?? "x"}`;
  } else if (key === "invoice.reminder") {
    const inv = str(p.invoice_number);
    const balance = formatMoneyText(p.balance_due, p.currency);
    const due = formatDay(p.due_date);
    const days = typeof p.days_from_due === "number" && Number.isInteger(p.days_from_due) ? p.days_from_due : null;
    const plural = (n: number) => `${n} day${n === 1 ? "" : "s"}`;
    if (days !== null && days > 0) {
      title = inv ? `${inv}: payment overdue` : "Payment overdue";
      body = `${balance ?? "The balance"} was due ${due ?? "earlier"} (${plural(days)} ago). Please pay or contact NGB finance if you have a question.`;
    } else if (days === 0) {
      title = inv ? `${inv}: payment due today` : "Payment due today";
      body = `${balance ?? "The balance"} is due today.`;
    } else {
      title = inv ? `${inv}: payment due soon` : "Payment due soon";
      body = `${balance ?? "The balance"} is due ${due ?? "soon"}${days !== null ? ` (in ${plural(-days)})` : ""}.`;
    }
    if (str(p.payment_instructions)) body += ` How to pay: ${clip(str(p.payment_instructions)!, 300)}`;
    url = invoiceUrl(inv);
    tag = `invoice-${inv ?? "x"}`;
  } else if (key === "staff.invoice_overdue" || key === "staff.invoice_disputed") {
    const inv = str(p.invoice_number) ?? "Invoice";
    const balance = formatMoneyText(p.balance_due, p.currency);
    const overdue = key === "staff.invoice_overdue";
    title = `${overdue ? "Overdue" : "Disputed"}: ${inv}`;
    body = [str(p.client_name), balance && `balance ${balance}`, overdue && formatDay(p.due_date) && `due ${formatDay(p.due_date)}`,
      !overdue && str(p.reason) && clip(str(p.reason)!, 200)].filter(Boolean).join(" · ")
      || (overdue ? "An invoice is past its due date." : "A client disputed an invoice.");
    url = adminInvoiceUrl(p.invoice_id);
    tag = `finance-${inv}`;
  } else if (key === "shipment.closed") {
    const n = typeof p.containers === "number" ? p.containers : null;
    const delivered = when(p.delivered_at);
    title = ref ? `${ref}: shipment closed` : "Shipment closed";
    body = `All done${delivered ? `: delivered ${delivered}` : ""}${n ? `, ${n} container${n === 1 ? "" : "s"} returned` : ""}. Thank you for shipping with NGB LOGISTICS.`
      + (str(p.booking_contact) ? ` Next booking: ${clip(str(p.booking_contact)!, 120)}` : "");
    url = portalUrl(ref);
    tag = `shipment-${shipmentId ?? ref ?? "x"}`;
  } else if (key === "staff.incident_reported") {
    const kind = INCIDENT_LABELS[String(p.incident_type)] ?? "Incident";
    title = ref ? `${ref}: ${kind.toLowerCase()}` : kind;
    const what = clip(str(p.description) ?? "An incident was reported", 300).replace(/[.!?…]?$/, (m) => m || ".");
    body = `${str(p.container) ? `${str(p.container)}: ` : ""}${what} Review it before the shipment can close.`;
    url = adminUrl(shipmentId);
    tag = `incident-${shipmentId ?? "x"}`;
  } else if (key === "shipment.alert") {
    title = ref ? `${ref}: update` : "Shipment update";
    body = clip(str(p.message) ?? "There is an update on your shipment.", 500);
    url = portalUrl(ref);
    tag = `alert-${shipmentId ?? ref ?? "x"}`;
  } else if (key === "staff.exception_opened" || key === "staff.exception_escalated") {
    const escalated = key.endsWith("escalated");
    title = `${escalated ? "Escalated" : "New exception"}: ${clip(str(p.title) ?? "Exception", 80)}`;
    body = [ref, SEVERITY[String(p.severity)] && `${SEVERITY[String(p.severity)]} severity`,
      str(p.next_action) && `Next: ${clip(str(p.next_action)!, 150)}`].filter(Boolean).join(" · ");
    url = adminUrl(shipmentId);
    tag = `exception-${str(p.exception_id) ?? "x"}`;
  } else if (key === "staff.client_uploaded") {
    const doc = DOC_LABELS[String(p.document_type)] ?? "A document";
    title = ref ? `${ref}: client upload` : "Client upload";
    body = `${doc}${str(p.file_name) ? ` (${clip(str(p.file_name)!, 60)})` : ""} is waiting for review.`;
    url = adminUrl(shipmentId);
    tag = `upload-${shipmentId ?? "x"}`;
  } else if (key === "staff.driver_report") {
    const truck = str(p.truck);
    title = ref ? `${ref}: driver report` : "Driver report";
    body = `${truck ? `Truck ${truck}: ` : ""}${clip(str(p.message) ?? "The driver reported a problem.", 300)}`;
    url = adminUrl(shipmentId);
    tag = `driver-report-${shipmentId ?? "x"}`;
  } else {
    throw new UnknownTemplateError(`No template for ${key}`);
  }

  title = clip(title, 120);
  body = clip(body, 700);
  return {
    title, body, url, tag,
    whatsapp: {
      template: `ngb_${key.replace(/\./g, "_")}`,
      params: [ref ?? "", body],
      text: `NGB LOGISTICS: ${title}\n${body}`,
    },
  };
}
