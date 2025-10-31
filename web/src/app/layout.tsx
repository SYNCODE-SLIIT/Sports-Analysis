import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Suspense } from "react";
import { Analytics } from "@vercel/analytics/next";
import { Providers } from "@/components/providers";
import { AuthProvider } from "@/components/AuthProvider";
import { Navbar } from "@/components/Navbar";
import { MaintenanceBanner } from "@/components/MaintenanceBanner";
import { AdminAwareFooter } from "@/components/AdminAwareFooter";
import { FloatingChatbot } from "@/components/chatbot/FloatingChatbot";
import { PlanProvider } from "@/components/PlanProvider";
import { PlanAwareLayout } from "@/components/PlanAwareLayout";
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
  title: "ATHLETE — Live Football Insights & Analytics",
  description: "Get real-time match probabilities, detailed analysis, and live updates from the world's biggest football leagues.",
  keywords: ["football", "soccer", "analytics", "live scores", "match analysis", "predictions"],
  authors: [{ name: "ATHLETE" }],
  icons: {
    icon: "/favicon.ico",
    apple: "/apple-touch-icon.png",
  },
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
  openGraph: {
    title: "ATHLETE — Live Football Insights & Analytics",
    description: "Advanced football analytics and live match insights.",
    type: "website",
    images: ["/banner.jpg"],
  },
  twitter: {
    card: "summary_large_image",
    title: "ATHLETE — Live Football Insights & Analytics",
    description: "Advanced football analytics and live match insights.",
    images: ["/banner.jpg"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased min-h-screen flex flex-col`}
      >
        <Providers>
          <AuthProvider>
            <PlanProvider>
              <PlanAwareLayout>
                <Suspense fallback={null}>
                  <Navbar />
                </Suspense>
                <MaintenanceBanner />
                <main className="flex-1">{children}</main>
                <AdminAwareFooter />
                <Suspense fallback={null}>
                  <FloatingChatbot />
                </Suspense>
              </PlanAwareLayout>
            </PlanProvider>
          </AuthProvider>
  </Providers>
  <Analytics />
      </body>
    </html>
  );
}
