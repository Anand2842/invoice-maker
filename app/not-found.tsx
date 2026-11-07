export const metadata = { title: "Page not found — Folio" };

// Unknown addresses get a branded page with the common ways back, instead of the framework's black default.
export default function NotFound() {
  const link = { color: "#5b3fa8", fontWeight: 600, textDecoration: "none" } as const;
  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: "32px 16px", background: "#faf8f5", color: "#241f31", fontFamily: "system-ui, sans-serif" }}>
      <div style={{ maxWidth: 460, textAlign: "center", display: "grid", gap: 14 }}>
        <a href="/" style={{ ...link, fontSize: 26, color: "#5b3fa8" }}>folio.</a>
        <h1 style={{ margin: 0, fontSize: 28 }}>This page doesn’t exist</h1>
        <p style={{ margin: 0, color: "#5d5770" }}>The link may be old or mistyped. These will get you back on track:</p>
        <p style={{ margin: 0, display: "flex", gap: 18, justifyContent: "center", flexWrap: "wrap" }}>
          <a href="/" style={link}>Home</a>
          <a href="/free-online-invoice-generator/?document=invoice" style={link}>Create an invoice</a>
          <a href="/dashboard" style={link}>Dashboard</a>
          <a href="/start/" style={link}>Getting started</a>
        </p>
      </div>
    </main>
  );
}
