import { z } from "zod";
import { APP_ROLES } from "@/lib/auth/roles";
import { emailField, optionalPhone, requiredText } from "./common";

/** Invite form. Organization is required for client users; staff always join NGB. */
export const inviteUserSchema = z
  .object({
    email: emailField,
    full_name: requiredText("the person's full name", 120),
    role: z.enum(APP_ROLES, { error: "Choose a role" }),
    organization_id: z.preprocess((v) => (v === "" ? undefined : v), z.uuid().optional()),
    phone_e164: optionalPhone,
  })
  .refine((v) => v.role !== "client" || v.organization_id, {
    error: "Choose the client company",
    path: ["organization_id"],
  });

export type InviteUserInput = z.infer<typeof inviteUserSchema>;
