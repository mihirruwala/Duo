import type { Metadata, Viewport } from "next";
import { connection } from "next/server";
import { Bricolage_Grotesque, Figtree, Geist_Mono } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

const bricolage = Bricolage_Grotesque({ variable: "--font-bricolage", subsets: ["latin"], display: "swap" });
const figtree = Figtree({ variable: "--font-figtree", subsets: ["latin"], display: "swap" });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"], display: "swap" });

export const metadata: Metadata = {
  title: { default: "DUO", template: "%s · DUO" },
  description: "A private space for two: connect, share, take control, and have fun.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#1a1420",
  colorScheme: "dark",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Every page renders per request: required for the CSP nonce and per-user content.
  await connection();
  return (
    <html lang="en" className={`dark ${bricolage.variable} ${figtree.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <TooltipProvider delayDuration={300}>{children}</TooltipProvider>
        {/* Offset keeps toasts clear of the "Remote control active" banner. */}
        <Toaster position="top-center" offset={{ top: 64 }} />
      </body>
    </html>
  );
}
