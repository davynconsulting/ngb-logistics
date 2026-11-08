import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { Geist, Geist_Mono } from "next/font/google";
import { ThemeProvider } from "@/components/layout/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { ServiceWorkerRegistrar } from "@/components/pwa/service-worker-registrar";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "NGB LOGISTICS · Cargo Tracking",
    template: "%s · NGB LOGISTICS",
  },
  description:
    "Track your cargo from bill of lading to delivery, empty-container return and payment.",
  applicationName: "NGB Cargo Tracking",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#1d3557" },
    { media: "(prefers-color-scheme: dark)", color: "#0f1a2b" },
  ],
};

/*
 * Reading the request's nonce (set by proxy.ts, lib/security/csp.ts) renders every page per request,
 * which a nonce Content-Security-Policy requires: Next.js adds the nonce to its own scripts, and
 * next-themes gets it for its inline theme script.
 */
export default async function RootLayout({ children }: LayoutProps<"/">) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
          nonce={nonce}
        >
          {children}
          <ServiceWorkerRegistrar />
          <Toaster richColors position="top-center" />
        </ThemeProvider>
      </body>
    </html>
  );
}
