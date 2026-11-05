"use server";

import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/dal/session";
import { createClient } from "@/lib/supabase/server";
import {
  containersFromForm, dateToTimestamp, registerShipmentSchema,
} from "@/lib/validation/shipment";
import { fieldErrors, type ActionState } from "@/lib/validation/common";

const FIELDS = [
  "client_id", "bl_number", "booking_reference", "shipping_line", "vessel_name", "voyage_number",
  "origin_port_id", "origin_terminal", "destination_country", "destination_city", "delivery_address",
  "cargo_description", "package_count", "gross_weight_kg", "planned_vessel_arrival", "assigned_ops_user_id",
] as const;

export type RegisterState = ActionState<Record<string, unknown>>;

/**
 * Registers a shipment with its containers and document checklist in ONE
 * database transaction (public.register_shipment, runs as the user → RLS).
 * Allowed: admin, operations manager, documentation officer.
 */
export async function registerShipment(_prev: RegisterState, formData: FormData): Promise<RegisterState> {
  await requireStaff("admin", "ops_manager", "doc_officer");

  const raw = {
    ...Object.fromEntries(FIELDS.map((f) => [f, String(formData.get(f) ?? "")])),
    containers: containersFromForm(formData),
    required_documents: formData.getAll("required_documents").map(String),
  };
  const parsed = registerShipmentSchema.safeParse(raw);
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error), values: raw };

  const { containers, required_documents, planned_vessel_arrival, ...shipment } = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("register_shipment", {
    p_shipment: { ...shipment, planned_vessel_arrival: dateToTimestamp(planned_vessel_arrival) },
    p_containers: containers,
    p_required_documents: required_documents,
  });

  if (error) {
    if (/shipments_bl_number_unique/.test(error.message)) {
      return { fieldErrors: { bl_number: ["A shipment with this bill of lading already exists"] }, values: raw };
    }
    const dup = error.message.match(/Container (\w+) is (already on an open shipment|listed twice)/);
    if (dup) {
      const i = containers.findIndex((c) => c.container_number === dup[1]);
      return {
        fieldErrors: {
          [`containers.${Math.max(i, 0)}.container_number`]: [
            dup[2] === "listed twice" ? "Listed twice" : "Already on another open shipment",
          ],
        },
        values: raw,
      };
    }
    if (error.code === "42501") return { error: "You are not allowed to register shipments.", values: raw };
    return { error: "Could not register the shipment. Please check the details and try again.", values: raw };
  }

  redirect(`/admin/shipments/${data[0].shipment_id}?created=1`);
}
