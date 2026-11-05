"use client";

import { useActionState, useEffect, useRef, useTransition, type FormEvent } from "react";
import type { ActionState } from "@/lib/validation/common";

/**
 * Form submission for server actions that return ActionState:
 * - submits manually, so typed values are kept when the server refuses;
 * - converts <input type="datetime-local"> values (device time zone) to ISO;
 * - resets the form after a successful save.
 */
export function useFormAction(
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>,
  { localTimes = [] as string[], resetOnSuccess = true } = {},
) {
  const [state, dispatch, pending] = useActionState<ActionState, FormData>(action, undefined);
  const [, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.ok && resetOnSuccess) formRef.current?.reset();
  }, [state, resetOnSuccess]);

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    for (const name of localTimes) {
      const v = fd.get(name);
      if (typeof v === "string" && v) {
        const d = new Date(v);
        fd.set(name, Number.isNaN(d.getTime()) ? "" : d.toISOString());
      }
    }
    startTransition(() => dispatch(fd));
  }

  return { state, pending, onSubmit, formRef, errors: state?.fieldErrors };
}
