import "server-only";
import { createClient } from "@/lib/supabase/server";

/**
 * Milestone reads for the staff shipment page, AS THE SIGNED-IN USER:
 * RLS limits events to shipments the user can access, and internal notes to staff.
 */
export async function getMilestones(shipmentId: string) {
  const supabase = await createClient();
  const [catalogue, timeline, notes] = await Promise.all([
    supabase.from("milestone_catalogue").select("*").order("sort_order"),
    supabase.from("milestone_timeline").select("*").eq("shipment_id", shipmentId)
      .order("event_at", { ascending: false }).limit(500),
    supabase.from("milestone_internal_notes").select("batch_id, note, created_at").eq("shipment_id", shipmentId),
  ]);
  if (catalogue.error || timeline.error || notes.error) throw new Error("Could not load milestones");

  // names of the people who recorded / corrected / cancelled
  const ids = new Set<string>();
  for (const e of timeline.data) for (const u of [e.recorded_by, e.corrected_by, e.voided_by]) if (u) ids.add(u);
  const people = new Map<string, string>();
  if (ids.size) {
    const { data } = await supabase.from("profiles").select("id, full_name, email").in("id", [...ids]);
    for (const p of data ?? []) people.set(p.id, p.full_name || p.email || "Staff");
  }

  const notesByBatch = new Map<string, string[]>();
  for (const n of notes.data) notesByBatch.set(n.batch_id, [...(notesByBatch.get(n.batch_id) ?? []), n.note]);

  const events = timeline.data
    .filter((e): e is typeof e & { id: string; batch_id: string; event_at: string; recorded_at: string; milestone_type: NonNullable<typeof e.milestone_type> } =>
      !!e.id && !!e.batch_id && !!e.event_at && !!e.recorded_at && !!e.milestone_type)
    .map((e) => ({
      ...e,
      recorder: e.recorded_by ? people.get(e.recorded_by) ?? "Staff" : "System",
      corrector: e.corrected_by ? people.get(e.corrected_by) ?? "Staff" : null,
      voider: e.voided_by ? people.get(e.voided_by) ?? "Staff" : null,
    }));

  return { catalogue: catalogue.data, events, notesByBatch: Object.fromEntries(notesByBatch) };
}

export type MilestoneData = Awaited<ReturnType<typeof getMilestones>>;
export type TimelineEvent = MilestoneData["events"][number];
