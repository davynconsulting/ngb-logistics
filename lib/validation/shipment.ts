import { z } from "zod";
import { validateContainerNumber } from "@/lib/domain/container-number";
import { COUNTRIES, emptyToUndefined, optionalText, optionalUuid, requiredText, uuid } from "./common";

export const CONTAINER_SIZE_TYPES = [
  { value: "20GP", label: "20' dry" },
  { value: "40GP", label: "40' dry" },
  { value: "40HC", label: "40' high cube" },
  { value: "45HC", label: "45' high cube" },
  { value: "20RF", label: "20' reefer" },
  { value: "40RF", label: "40' reefer" },
  { value: "20OT", label: "20' open top" },
  { value: "40OT", label: "40' open top" },
  { value: "20FR", label: "20' flat rack" },
  { value: "40FR", label: "40' flat rack" },
  { value: "20TK", label: "20' tank" },
  { value: "OTHER", label: "Other" },
] as const;

export const REQUIRED_DOCUMENT_CHOICES = [
  { value: "bill_of_lading", label: "Bill of lading" },
  { value: "commercial_invoice", label: "Commercial invoice" },
  { value: "packing_list", label: "Packing list" },
  { value: "certificate_of_origin", label: "Certificate of origin" },
] as const;

const containerSchema = z.object({
  container_number: z.string().transform((v, ctx) => {
    const r = validateContainerNumber(v);
    if (!r.valid) {
      ctx.addIssue({
        code: "custom",
        message:
          r.reason === "format"
            ? "Use 4 letters + 7 digits, e.g. MSKU1234565"
            : "Check digit doesn't match. Please re-check the number",
      });
      return z.NEVER;
    }
    return r.value;
  }),
  size_type: z.preprocess(emptyToUndefined, z.enum(CONTAINER_SIZE_TYPES.map((s) => s.value)).optional()),
  seal_number: optionalText(40),
});

/** Shipment registration (FRS §3 step 02, §6.2, §6.3). */
export const registerShipmentSchema = z
  .object({
    client_id: uuid("the client"),
    bl_number: z.preprocess(emptyToUndefined, z.string().trim().toUpperCase().max(40).optional()),
    booking_reference: optionalText(60),
    shipping_line: optionalText(80),
    vessel_name: optionalText(80),
    voyage_number: optionalText(30),
    origin_port_id: uuid("the port of discharge"),
    origin_terminal: optionalText(120),
    destination_country: z.enum(COUNTRIES.map((c) => c.value), { error: "Choose the destination country" }),
    destination_city: requiredText("the destination city", 80),
    delivery_address: optionalText(300),
    cargo_description: optionalText(500),
    package_count: z.preprocess(
      (v) => (v === "" || v == null ? undefined : Number(v)),
      z.number({ error: "Enter a whole number" }).int().min(0).max(1_000_000).optional(),
    ),
    gross_weight_kg: z.preprocess(
      (v) => (typeof v === "string" ? v.replace(/,/g, "").trim() || undefined : v),
      z.string().regex(/^\d{1,10}(\.\d{1,2})?$/, { error: "Enter kilograms, e.g. 24500.50" }).optional(),
    ),
    planned_vessel_arrival: z.preprocess(
      emptyToUndefined,
      z.iso.date({ error: "Choose a date" }).optional(),
    ),
    assigned_ops_user_id: optionalUuid,
    containers: z.array(containerSchema).min(1, { error: "Add at least one container" }).max(50),
    required_documents: z.array(z.enum(REQUIRED_DOCUMENT_CHOICES.map((d) => d.value))).max(10),
  })
  .superRefine((v, ctx) => {
    const seen = new Map<string, number>();
    v.containers.forEach((c, i) => {
      if (seen.has(c.container_number)) {
        ctx.addIssue({ code: "custom", path: ["containers", i, "container_number"], message: "Listed twice" });
      }
      seen.set(c.container_number, i);
    });
  });

export type RegisterShipmentInput = z.infer<typeof registerShipmentSchema>;

/** Reads the repeated container fields of the registration form. */
export function containersFromForm(formData: FormData) {
  const numbers = formData.getAll("container_number").map(String);
  const sizes = formData.getAll("size_type").map(String);
  const seals = formData.getAll("seal_number").map(String);
  return numbers
    .map((n, i) => ({ container_number: n, size_type: sizes[i] ?? "", seal_number: seals[i] ?? "" }))
    .filter((c) => c.container_number.trim() !== "" || c.seal_number.trim() !== "");
}

/** Planned arrival is a calendar date; stored at 12:00 UTC so it never shifts a day in East African time zones. */
export function dateToTimestamp(date: string | undefined) {
  return date ? `${date}T12:00:00Z` : undefined;
}
