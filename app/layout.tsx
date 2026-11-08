import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "inbill — Your billing workspace",
  description: "Create professional invoices and keep your business records together with inbill.",
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
