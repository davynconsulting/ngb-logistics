"use client";

import type { ReactNode } from "react";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";

/** Label + control + help text + error, wired for accessibility. */
export function FormField({
  id, label, errors, description, children, className,
}: {
  id: string;
  label: ReactNode;
  errors?: string[];
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Field data-invalid={!!errors?.length} className={className}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      {children}
      {description && <FieldDescription>{description}</FieldDescription>}
      <FieldError errors={errors?.map((message) => ({ message }))} />
    </Field>
  );
}
