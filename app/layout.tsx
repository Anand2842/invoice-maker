import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Independent Billing Workspace",
  description: "Invoices and business records on your own Supabase backend.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
