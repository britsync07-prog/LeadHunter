import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LeadHunter Pro — B2B Outreach System",
  description: "Automated B2B Lead Scraping & Cold Email Engine",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="bg-slate-50 text-slate-900 font-body antialiased min-h-screen">
        {children}
      </body>
    </html>
  );
}
