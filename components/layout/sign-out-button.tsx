"use client";

import { useEffect, useState } from "react";
import { LogOut } from "lucide-react";
import { signOut } from "@/lib/actions/auth";
import { currentSubscription } from "@/lib/pwa/push-client";
import { Button } from "@/components/ui/button";

/**
 * Sign out, and stop this device's push notifications for this user (shared
 * phones): the endpoint goes to the server, which deletes the row; the browser
 * subscription is dropped too.
 */
export function SignOutButton() {
  const [endpoint, setEndpoint] = useState("");
  useEffect(() => {
    let live = true;
    currentSubscription(2000).then((s) => { if (live && s) setEndpoint(s.endpoint); });
    return () => { live = false; };
  }, []);

  return (
    <form
      action={signOut}
      onSubmit={() => { void currentSubscription(500).then((s) => s?.unsubscribe()).catch(() => {}); }}
    >
      <input type="hidden" name="push_endpoint" value={endpoint} />
      <Button type="submit" variant="secondary" size="sm" aria-label="Sign out">
        <LogOut aria-hidden />
        <span className="hidden sm:inline">Sign out</span>
      </Button>
    </form>
  );
}
