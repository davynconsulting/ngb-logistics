"use client";

import { useEffect } from "react";
import { registerServiceWorker } from "@/lib/pwa/push-client";

/** Registers /sw.js once per page load (push display + offline fallback). Renders nothing. */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    void registerServiceWorker();
  }, []);
  return null;
}
