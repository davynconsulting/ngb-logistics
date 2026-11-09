"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { siteOrigin } from "@/lib/site-origin";
import { homePathFor, isAppRole, safeNextPath } from "@/lib/auth/roles";
import { emailField } from "@/lib/validation/common";

/**
 * Authentication Server Actions.
 * Error messages are deliberately generic: they never reveal whether an
 * email address has an account. Supabase Auth applies rate limiting.
 */

export type FormState = {
  error?: string;
  message?: string;
  fieldErrors?: Record<string, string[] | undefined>;
  values?: { email?: string };
} | undefined;

const emailSchema = emailField;

const signInSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, { error: "Enter your password" }).max(128),
  next: z.string().max(512).optional(),
});

export async function signIn(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = signInSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    next: formData.get("next") || undefined,
  });
  const email = String(formData.get("email") ?? "");
  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors, values: { email } };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });
  if (error || !data.user) {
    const tooMany = error?.status === 429;
    return {
      error: tooMany
        ? "Too many attempts. Please wait a few minutes and try again."
        : "Incorrect email or password.",
      values: { email },
    };
  }

  // The account must have an active profile (role + organization)
  const { data: profile } = await supabase
    .from("profiles")
    .select("role, is_active")
    .eq("id", data.user.id)
    .maybeSingle();

  if (!profile || !profile.is_active || !isAppRole(profile.role)) {
    await supabase.auth.signOut();
    return {
      error: "Your account is not active. Please contact NGB LOGISTICS.",
      values: { email },
    };
  }

  redirect(safeNextPath(parsed.data.next, profile.role) ?? homePathFor(profile.role));
}

/**
 * Sign out. The form also sends this device's push endpoint (if any) so the
 * next person using the phone does not receive this user's notifications.
 */
export async function signOut(formData?: FormData): Promise<void> {
  const supabase = await createClient();
  const endpoint = formData?.get("push_endpoint");
  if (typeof endpoint === "string" && /^https:\/\//.test(endpoint) && endpoint.length <= 1000) {
    await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint); // RLS: own rows only
  }
  await supabase.auth.signOut();
  redirect("/login?signed_out=1");
}

/** Absolute URL of this deployment, used for links in auth emails. */

export async function requestPasswordReset(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = emailSchema.safeParse(formData.get("email"));
  const email = String(formData.get("email") ?? "");
  if (!parsed.success) {
    return { fieldErrors: { email: [parsed.error.issues[0].message] }, values: { email } };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data, {
    redirectTo: `${await siteOrigin()}/auth/callback?next=/update-password`,
  });
  if (error?.status === 429) {
    return { error: "Too many requests. Please wait a few minutes and try again.", values: { email } };
  }

  // Same answer whether or not the account exists
  return {
    message: "If an account exists for that email, we've sent a link to reset your password.",
  };
}

const newPasswordSchema = z
  .object({
    password: z
      .string()
      .min(10, { error: "Use at least 10 characters" })
      .max(128)
      .regex(/[a-zA-Z]/, { error: "Include at least one letter" })
      .regex(/[0-9]/, { error: "Include at least one number" }),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { error: "Passwords do not match", path: ["confirm"] });

export async function updatePassword(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = newPasswordSchema.safeParse({
    password: formData.get("password"),
    confirm: formData.get("confirm"),
  });
  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors };
  }

  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims) {
    return { error: "Your reset link has expired. Please request a new one." };
  }

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    return {
      error:
        error.code === "same_password"
          ? "Choose a password different from your current one."
          : "Could not update your password. Please request a new reset link.",
    };
  }

  const role = claims.claims.app_metadata?.role;
  redirect(isAppRole(role) ? homePathFor(role) : "/login");
}
