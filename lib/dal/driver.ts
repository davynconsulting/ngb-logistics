import "server-only";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import type { DriverContainer } from "@/lib/domain/driver";

/*
 * Driver reads, AS THE SIGNED-IN DRIVER. Since 0020 a driver reaches a
 * shipment only through an active truck assignment of their own, and reads
 * their jobs through driver_jobs() / driver_job_events(), which return only
 * what the job needs (no client account details, no internal notes).
 */

export type DriverJob = Awaited<ReturnType<typeof listDriverJobs>>[number];

export async function listDriverJobs() {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("driver_jobs");
  if (error) throw new Error("Could not load your jobs");
  return (data ?? []).map((j) => ({ ...j, containers: (j.containers ?? []) as unknown as DriverContainer[] }));
}

/** One of the driver's jobs, or null (unknown id, someone else's truck, cancelled). */
export async function getDriverJob(assignmentId: string) {
  if (!z.uuid().safeParse(assignmentId).success) return null;
  const jobs = await listDriverJobs();
  return jobs.find((j) => j.assignment_id === assignmentId) ?? null;
}

export async function getDriverJobEvents(assignmentId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("driver_job_events", { p_assignment_id: assignmentId });
  if (error) throw new Error("Could not load the job history");
  return data ?? [];
}

/** Road milestones (labels and rules) for the step buttons. */
export async function getDriverCatalogue() {
  const supabase = await createClient();
  const { data, error } = await supabase.from("milestone_catalogue").select("*").contains("allowed_roles", ["driver"]);
  if (error) throw new Error("Could not load milestones");
  return data ?? [];
}

/** Documents this driver uploaded for the shipment (to attach as evidence, e.g. the POD). */
export async function listMyUploads(shipmentId: string, userId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.from("documents")
    .select("id, document_type, file_name, container_id, uploaded_at")
    .eq("shipment_id", shipmentId).eq("uploaded_by", userId)
    .order("uploaded_at", { ascending: false }).limit(20);
  if (error) throw new Error("Could not load your uploads");
  return data ?? [];
}
