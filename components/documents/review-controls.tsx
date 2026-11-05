"use client";

import { useActionState, useId, useState } from "react";
import { Check, X } from "lucide-react";
import { reviewDocument, type ReviewState } from "@/lib/actions/documents";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/forms/form-field";
import { FormAlert } from "@/components/auth/form-alert";

/** Verify or reject a pending document. A rejection needs a reason the client will see. */
export function ReviewControls({ documentId }: { documentId: string }) {
  const [state, action, pending] = useActionState<ReviewState, FormData>(reviewDocument.bind(null, documentId), undefined);
  const [rejecting, setRejecting] = useState(false);
  const id = useId();

  return (
    <div className="flex flex-col gap-2">
      {state?.error && <FormAlert kind="error">{state.error}</FormAlert>}
      {!rejecting ? (
        <div className="flex flex-wrap gap-2">
          <form action={action}>
            <input type="hidden" name="decision" value="verified" />
            <Button type="submit" size="sm" disabled={pending}><Check aria-hidden /> Verify</Button>
          </form>
          <Button type="button" size="sm" variant="outline" onClick={() => setRejecting(true)}>
            <X aria-hidden /> Reject…
          </Button>
        </div>
      ) : (
        <form action={action} className="flex flex-col gap-2">
          <input type="hidden" name="decision" value="rejected" />
          <FormField id={`${id}-reason`} label="Reason for rejection" description="The client will see this" errors={state?.fieldErrors?.reason}>
            <Textarea id={`${id}-reason`} name="reason" rows={2} maxLength={500} required autoFocus
              aria-invalid={!!state?.fieldErrors?.reason} />
          </FormField>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" variant="destructive" disabled={pending}>Reject document</Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setRejecting(false)}>Cancel</Button>
          </div>
        </form>
      )}
    </div>
  );
}
