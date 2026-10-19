import {
  store,
  persist,
  money,
  calculate,
  status,
  uid,
  today,
  clearData,
  restoreData,
  backupData,
  persistenceError,
} from "./data.js";
import { openInvoiceEditor, openInvoicePreview } from "./invoice.js";

const $ = (s) => document.querySelector(s);
const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const paths = {
  grid: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
  invoice:
    "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M8 13h8 M8 17h5",
  users:
    "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M16 3a4 4 0 0 1 0 8 M22 21v-2a4 4 0 0 0-3-3.87 M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
  wallet:
    "M20 8V5a2 2 0 0 0-2-2H5a3 3 0 0 0 0 6h15v12H5a3 3 0 0 1-3-3V6 M20 12h-5v5h5 M16 14.5h.01",
  chart: "M3 3v18h18 M8 16v-5 M13 16V7 M18 16v-9",
  settings:
    "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M9 3l1-1h4l1 3 3 1 3 2-1 4 1 3-3 3-3 1-1 3h-4l-1-3-3-1-3-3 1-3-1-4 3-2 3-1z",
  search: "M21 21l-5-5 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0",
  plus: "M12 5v14 M5 12h14",
  arrow: "M7 17 17 7 M7 7h10v10",
  right: "M5 12h14 M13 6l6 6-6 6",
  chevron: "m9 5 7 7-7 7",
  down: "m6 9 6 6 6-6",
  calendar:
    "M8 2v4 M16 2v4 M3 10h18 M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2",
  download: "M12 3v12 m-5-5 5 5 5-5 M5 17v4h14v-4",
  filter: "M4 7h16 M7 12h10 M10 17h4",
  more: "M5 12h.01 M12 12h.01 M19 12h.01",
  close: "m6 6 12 12 M6 18 18 6",
  help: "M9.1 9a3 3 0 0 1 5.8 1c0 2-3 2-3 4 M12 17h.01 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0",
  check: "m5 12 4 4L19 6",
  clock: "M12 6v6l4 2 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0",
  trend: "m3 17 6-6 4 4 8-10 M15 5h6v6",
  sun: "M12 3v1 M12 20v1 M3 12h1 M20 12h1 M5.5 5.5l1 1 M17.5 17.5l1 1 M5.5 18.5l1-1 M17.5 6.5l1-1 M17 12a5 5 0 1 1-10 0 5 5 0 0 1 10 0",
  briefcase: "M8 6V3h8v3 M3 10h18 M10 10v4h4v-4 M4 6h16v14H4z",
  mail: "M3 5h18v14H3z m0 0 9 8 9-8",
  trash: "M3 6h18 M9 6V3h6v3 M5 6l1 15h12l1-15 M10 10v7 M14 10v7",
  menu: "M3 6h18 M3 12h18 M3 18h18",
  leaf: "M20 3C7 1 2 7 5 15c6 7 17 1 15-12 M5 20 15 9",
  bell: "M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9 M10 21h4",
};
const icon = (name, cl = "") =>
  `<svg class="icon ${cl}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name] || paths.invoice}"/></svg>`;
const logo = `<svg viewBox="0 0 40 40" fill="none" aria-hidden="true"><path d="M6 5h30L23 19H6zM6 24h21L14 37H6z" fill="currentColor"/></svg>`;
const initials = (name) =>
  String(name || "?")
    .split(" ")
    .filter(Boolean)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
const now = today();
let page = [
  "overview",
  "invoices",
  "clients",
  "expenses",
  "reports",
  "settings",
].includes(location.hash.slice(1))
  ? location.hash.slice(1)
  : "overview";
let period = now.slice(0, 7),
  invoiceTab = "All invoices",
  query = "",
  pageIndex = 1,
  chartMode = "6 months";
let selected = new Set();
const periodLabel = () =>
  new Date(period + "-01T12:00:00").toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
  });
const dateLabel = (v) =>
  new Date(v + "T12:00:00").toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
const invoicesInPeriod = () =>
  store.invoices.filter((i) => i.date.startsWith(period));
const activeInvoices = () =>
  invoicesInPeriod().filter((i) => i.stage !== "draft");
const sum = (arr, fn) => arr.reduce((a, i) => a + fn(i), 0);
const expenseTotal = () =>
  sum(
    store.expenses.filter((e) => e.date.startsWith(period)),
    (e) => Number(e.amount),
  );
const clientFor = (i) =>
  store.clients.find((c) => c.id === i.clientId) || {
    name: "Unknown client",
    color: "#e8e9ed",
    email: "",
  };
const badge = (i) =>
  `<span class="badge ${status(i).toLowerCase()}"><i></i>${esc(status(i))}</span>`;
let toastTimer;
function toast(msg) {
  $("#toast").textContent = msg;
  $("#toast").classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("#toast").classList.remove("show"), 3600);
}
function safeSave(mutate = () => {}) {
  const before = structuredClone(store);
  try {
    mutate();
    persist();
    return true;
  } catch (e) {
    Object.assign(store, before);
    const indicator = $(".save-status");
    if (indicator) {
      indicator.classList.add("storage-error");
      indicator.innerHTML = "<i></i> Save needs attention";
    }
    toast(e.message);
    return false;
  }
}
const navItems = [
  ["overview", "grid", "Overview"],
  ["invoices", "invoice", "Invoices"],
  ["clients", "users", "Clients"],
  ["expenses", "wallet", "Expenses"],
  ["reports", "chart", "Reports"],
];
function navigate(target) {
  page = target;
  query = "";
  pageIndex = 1;
  selected.clear();
  location.hash = target;
  render();
}
window.addEventListener("hashchange", () => {
  const p = location.hash.slice(1);
  if (p !== page && [...navItems.map((n) => n[0]), "settings"].includes(p))
    navigate(p);
});
function render() {
  const due = store.invoices.filter((i) => status(i) === "Overdue").length;
  $("#app").innerHTML =
    `<aside class="sidebar"><a href="#overview" class="brand" aria-label="Folio home">${logo}<span>folio<span class="brand-dot">.</span></span></a><button class="workspace-switch" data-nav="settings" aria-label="Business settings"><span class="workspace-avatar">${initials(store.business.name)}</span><span><strong>${esc(store.business.name)}</strong><small>Personal workspace</small></span>${icon("down")}</button><div class="nav-caption">WORKSPACE</div><nav aria-label="Main navigation">${navItems.map(([id, ic, label]) => `<button class="nav-item ${page === id ? "active" : ""}" data-nav="${id}" aria-label="${label}" title="${label}">${icon(ic)}<span>${label}</span>${id === "invoices" ? `<span class="nav-count">${store.invoices.length}</span>` : ""}</button>`).join("")}</nav><div class="sidebar-bottom"><div class="sidebar-note"><span class="note-symbol">${icon("leaf")}</span><strong>A little less admin.<br>A lot more possibility.</strong><p>Your next big thing starts<br>with a clear head.</p><button data-action="new-invoice">Create an invoice ${icon("right")}</button></div><button class="nav-item ${page === "settings" ? "active" : ""}" data-nav="settings" aria-label="Settings" title="Settings">${icon("settings")}<span>Settings</span></button><button class="nav-item" data-action="help" aria-label="Help and getting started" title="Help and getting started">${icon("help")}<span>Help & getting started</span>${icon("arrow")}</button><button class="profile" data-nav="settings" aria-label="Your profile"><span class="profile-avatar">${initials(store.business.owner)}</span><span><strong>${esc(store.business.owner)}</strong><small>Workspace owner</small></span>${icon("down")}</button></div></aside><div class="main-shell"><header class="topbar"><div class="breadcrumbs"><button class="icon-button mobile-menu" data-action="menu" aria-label="Toggle navigation">${icon("menu")}</button><span>Workspace</span>${icon("chevron")}<strong>${page === "overview" ? "Overview" : page[0].toUpperCase() + page.slice(1)}</strong></div><div class="top-actions"><span class="save-status ${persistenceError ? "storage-error" : ""}"><i></i> ${persistenceError ? "Save needs attention" : "Saved on this browser"}</span><button class="icon-button" data-action="search" aria-label="Search workspace">${icon("search")}</button><span class="top-separator"></span><button class="icon-button" data-action="activity" aria-label="View activity">${icon("bell")}${due ? '<b class="notification-dot"></b>' : ""}</button><button class="top-avatar" data-nav="settings" aria-label="Your business profile">${initials(store.business.owner)}</button></div></header><main id="main">${pageContent()}</main><footer class="app-footer"><span>Made for the way you work.</span><span>Folio <i>✦</i> Your business, in balance.</span></footer></div>`;
  bind();
}
function periodSelect() {
  const months = [];
  for (let n = 0; n < 12; n++) {
    const d = new Date(now.slice(0, 7) + "-01T12:00:00");
    d.setMonth(d.getMonth() - n);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    months.push(
      `<option value="${key}" ${key === period ? "selected" : ""}>${d.toLocaleDateString("en-IN", { month: "long", year: "numeric" })}</option>`,
    );
  }
  return `<label class="period-select">${icon("calendar")}<select id="period" aria-label="Reporting month">${months.join("")}</select>${icon("down")}</label>`;
}
function pageHeading(title, subtitle, action = "invoice") {
  return `<div class="page-heading"><div><div class="eyebrow">YOUR BUSINESS AT A GLANCE</div><h1>${title}</h1><p>${subtitle}</p></div><div class="heading-actions">${["overview", "reports"].includes(page) ? periodSelect() : ""}<button class="button primary" data-action="${action === "invoice" ? "new-invoice" : action === "client" ? "new-client" : "new-expense"}">${icon("plus")}${action === "invoice" ? "Create invoice" : action === "client" ? "Add client" : "Add expense"}</button></div></div>`;
}
function sparkPoints(kind) {
  const values = [];
  for (let n = 5; n >= 0; n--) {
    const d = new Date(period + "-01T12:00:00");
    d.setMonth(d.getMonth() - n);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const inv = store.invoices.filter(
      (i) => i.date.startsWith(key) && i.stage !== "draft",
    );
    values.push(
      sum(inv, (i) =>
        kind === "green"
          ? calculate(i).total
          : kind === "mint"
            ? calculate(i).paid
            : kind === "amber"
              ? calculate(i).balance
              : status(i) === "Overdue"
                ? calculate(i).balance
                : 0,
      ),
    );
  }
  const lo = Math.min(...values),
    hi = Math.max(...values);
  return values
    .map(
      (v, n) =>
        `${n * 12.8},${hi === lo ? 16 : 30 - ((v - lo) / (hi - lo)) * 28}`,
    )
    .join(" ");
}
function stats() {
  const inv = activeInvoices(),
    all = invoicesInPeriod();
  const total = sum(inv, (i) => calculate(i).total),
    paid = sum(inv, (i) => calculate(i).paid),
    balance = sum(inv, (i) => calculate(i).balance);
  const overdue = inv.filter((i) => status(i) === "Overdue");
  const data = [
    [
      "Total invoiced",
      total,
      "invoice",
      `${inv.length} invoices this month`,
      "green",
      "0,26 8,28 16,19 24,23 32,12 40,17 48,4 56,7 64,0",
    ],
    [
      "Payments received",
      paid,
      "wallet",
      `${inv.filter((i) => status(i) === "Paid").length} invoices paid in full`,
      "mint",
      "0,28 8,23 16,25 24,14 32,17 40,10 48,13 56,3 64,0",
    ],
    [
      "Outstanding amount",
      balance,
      "clock",
      `${inv.filter((i) => calculate(i).balance > 0).length} invoices awaiting payment`,
      "amber",
      "0,2 8,7 16,4 24,14 32,10 40,20 48,16 56,27 64,23",
    ],
    [
      "Overdue amount",
      sum(overdue, (i) => calculate(i).balance),
      "calendar",
      `${overdue.length} invoices need a follow-up`,
      "rose",
      "0,12 8,12 16,21 24,17 32,24 40,16 48,21 56,20 64,28",
    ],
  ];
  return `<div class="stats-grid">${data.map(([label, value, ic, sub, color, points]) => `<div class="stat-card ${color}"><div class="stat-top"><span>${label}</span><span class="stat-icon">${icon(ic)}</span></div><div class="stat-value">${money(value)}</div><div class="stat-bottom"><small>${color === "rose" && overdue.length ? '<span class="tiny-dot"></span>' : ""}${sub}</small><svg viewBox="0 0 64 32" class="sparkline" aria-hidden="true"><polyline points="${sparkPoints(color)}" fill="none" stroke="currentColor" stroke-width="1.8"/></svg></div></div>`).join("")}</div>`;
}
function compactMoney(value) {
  return value >= 100000
    ? `₹ ${(value / 100000).toFixed(1)}L`
    : `₹ ${Math.round(value / 1000)}k`;
}
function chart() {
  const count = chartMode === "6 months" ? 6 : 3;
  const rows = [];
  for (let n = count - 1; n >= 0; n--) {
    const d = new Date(period + "-01T12:00:00");
    d.setMonth(d.getMonth() - n);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const inv = store.invoices.filter(
      (i) => i.date.startsWith(key) && i.stage !== "draft",
    );
    rows.push({
      month: d.toLocaleDateString("en-IN", { month: "short" }),
      invoiced: sum(inv, (i) => calculate(i).total),
      paid: sum(inv, (i) => calculate(i).paid),
    });
  }
  const max = Math.max(...rows.map((r) => r.invoiced), 10000);
  const ceiling = Math.ceil(max / 50000) * 50000;
  return `<section class="panel revenue-panel"><div class="panel-heading"><div><h2>Revenue overview <span class="info-tip" tabindex="0" title="Collections grouped by invoice issue month">i</span></h2><p>A little perspective on your progress.</p></div><select id="chart-range" class="small-select" aria-label="Revenue chart range"><option ${count === 6 ? "selected" : ""}>6 months</option><option ${count === 3 ? "selected" : ""}>3 months</option></select></div><div class="chart-key"><span><i class="key-dot dark"></i>Invoiced</span><span><i class="key-dot light"></i>Collected</span></div><div class="bar-chart" role="img" aria-label="Invoiced and collected revenue for the past ${count} months"><div class="y-axis">${[1, 0.75, 0.5, 0.25, 0].map((n) => `<span>${n ? compactMoney(ceiling * n) : "₹ 0"}</span>`).join("")}</div><div class="chart-area"><div class="chart-grid"><i></i><i></i><i></i><i></i><i></i></div><div class="bars">${rows.map((r, n) => `<div class="bar-group"><div class="bar-pair" tabindex="0" aria-label="${r.month}: invoiced ${money(r.invoiced)}, collected ${money(r.paid)}"><div class="chart-tooltip"><strong>${r.month}</strong><span>Invoiced ${money(r.invoiced)}</span><span>Collected ${money(r.paid)}</span></div><div class="bar invoiced ${n === rows.length - 1 ? "current" : ""}" style="height:${Math.max((r.invoiced / ceiling) * 100, 0.8)}%"></div><div class="bar collected" style="height:${Math.max((r.paid / ceiling) * 100, 0.8)}%"></div></div><span class="x-label">${r.month}</span></div>`).join("")}</div></div></div><div class="chart-footer">${icon("trend")}<span>Every invoice is a step forward.</span><a href="#reports" data-nav="reports">View report ${icon("arrow")}</a></div></section>`;
}
function paymentSummary() {
  const inv = activeInvoices(),
    total = sum(inv, (i) => calculate(i).total),
    paid = sum(inv, (i) => calculate(i).paid),
    outstanding = Math.max(0, total - paid),
    ratio = total ? Math.round((paid / total) * 100) : 0;
  return `<section class="panel payment-panel"><div class="panel-heading"><div><h2>Payment snapshot</h2><p>${periodLabel()}</p></div>${icon("wallet")}</div><div class="donut-wrap"><div class="donut" style="--progress:${ratio * 3.6}deg"><div><span>Collected</span><strong>${ratio}<small>%</small></strong><span>of invoiced amount</span></div></div><div class="donut-accent">${icon("check")}</div></div><div class="payment-legend"><div><span><i class="key-dot dark"></i>Collected</span><strong>${money(paid)}</strong></div><div><span><i class="key-dot light"></i>Outstanding</span><strong>${money(outstanding)}</strong></div></div><button class="payment-link" data-action="outstanding">View outstanding invoices ${icon("right")}</button></section>`;
}
function invoiceRows(rows) {
  return rows
    .map((i) => {
      const c = clientFor(i),
        calc = calculate(i);
      return `<tr data-invoice="${esc(i.id)}"><td class="check-cell"><input type="checkbox" class="row-check" data-id="${esc(i.id)}" aria-label="Select ${esc(i.number)}" ${selected.has(i.id) ? "checked" : ""}></td><td><button class="invoice-number" data-open="${esc(i.id)}"><span class="document-icon">${icon("invoice")}</span>${esc(i.number)}</button></td><td><div class="client-cell"><span class="client-avatar" style="--avatar:${esc(c.color || "#e8ebf2")}">${initials(c.name)}</span><span><strong>${esc(c.name)}</strong><small>${esc(c.email)}</small></span></div></td><td class="date-cell">${dateLabel(i.date)}</td><td class="amount-cell">${money(calc.total)}</td><td>${badge(i)}</td><td class="date-cell due-date ${status(i) === "Overdue" ? "late" : ""}">${dateLabel(i.dueDate)}</td><td><button class="icon-button row-more" data-open="${esc(i.id)}" aria-label="Open ${esc(i.number)}">${icon("more")}</button></td></tr>`;
    })
    .join("");
}
function filteredInvoices() {
  let rows = [...store.invoices].sort(
    (a, b) => b.date.localeCompare(a.date) || b.number.localeCompare(a.number),
  );
  if (page === "overview") rows = rows.filter((i) => i.date.startsWith(period));
  if (invoiceTab === "Unpaid")
    rows = rows.filter((i) => i.stage !== "draft" && calculate(i).balance > 0);
  if (invoiceTab === "Paid") rows = rows.filter((i) => status(i) === "Paid");
  if (invoiceTab === "Drafts") rows = rows.filter((i) => status(i) === "Draft");
  if (query)
    rows = rows.filter((i) =>
      `${i.number} ${clientFor(i).name} ${clientFor(i).email}`
        .toLowerCase()
        .includes(query.toLowerCase()),
    );
  return rows;
}
function invoicePanel() {
  const rows = filteredInvoices(),
    size = page === "overview" ? 5 : 8,
    totalPages = Math.max(1, Math.ceil(rows.length / size));
  pageIndex = Math.min(pageIndex, totalPages);
  const slice = rows.slice((pageIndex - 1) * size, pageIndex * size);
  return `<section class="panel invoice-panel"><div class="panel-heading"><div><h2>${page === "overview" ? "Recent invoices" : "All invoices"} <span class="count-pill">${rows.length}</span></h2>${page === "overview" ? "<p>The latest on your work, and what it’s worth.</p>" : "<p>From first draft to the final payment.</p>"}</div>${page === "overview" ? `<button class="text-button" data-nav="invoices">View all invoices ${icon("right")}</button>` : `<button class="button outline" data-action="export-invoices">${icon("download")}Export CSV</button>`}</div><div class="table-toolbar"><div class="tabs" role="tablist" aria-label="Invoice status">${["All invoices", "Unpaid", "Paid", "Drafts"].map((t) => `<button role="tab" aria-selected="${invoiceTab === t}" class="tab ${invoiceTab === t ? "active" : ""}" data-tab="${t}">${t}</button>`).join("")}</div><div class="table-tools"><label class="table-search">${icon("search")}<input id="invoice-search" placeholder="Search invoices…" value="${esc(query)}" aria-label="Search invoices"></label><button class="button outline filter-button" data-action="filter">${icon("filter")}Filter</button></div></div>${selected.size ? `<div class="selection-bar"><span>${selected.size} selected</span><button class="text-button" data-action="export-selected">${icon("download")}Export selected</button><button class="text-button" data-action="clear-selection">Clear</button></div>` : ""}<div class="table-scroll"><table class="invoice-table"><thead><tr><th class="check-cell"><input type="checkbox" id="select-all" aria-label="Select visible invoices" ${slice.length && slice.every((i) => selected.has(i.id)) ? "checked" : ""}></th><th>Invoice number ${icon("down")}</th><th>Client</th><th>Issued on</th><th class="amount-cell">Amount</th><th>Status</th><th>Due date</th><th></th></tr></thead><tbody>${slice.length ? invoiceRows(slice) : `<tr><td colspan="8"><div class="empty-state">${icon("invoice")}<h3>${query ? "No matching invoices" : "A fresh page for your business"}</h3><p>${query ? "Try another client name or invoice number." : "Create an invoice to get things moving."}</p>${!query ? '<button class="button primary" data-action="new-invoice">Create invoice</button>' : ""}</div></td></tr>`}</tbody></table></div><div class="table-footer"><span>${rows.length ? `Showing ${(pageIndex - 1) * size + 1}–${Math.min(pageIndex * size, rows.length)} of ${rows.length} invoices` : "0 invoices"}</span><div class="pagination"><button class="icon-button" data-action="prev" aria-label="Previous page" ${pageIndex === 1 ? "disabled" : ""}>${icon("chevron", "flip")}</button><span class="page-num">${pageIndex}</span><button class="icon-button" data-action="next" aria-label="Next page" ${pageIndex === totalPages ? "disabled" : ""}>${icon("chevron")}</button></div></div></section>`;
}
function pageContent() {
  switch (page) {
    case "overview":
      return `${pageHeading(`Good ${new Date().getHours() < 12 ? "morning" : "afternoon"}, ${esc(store.business.owner?.split(" ")[0] || "there")} <span class="hello-sun">${icon("sun")}</span>`, "Here’s how your business is doing. Let’s make today a good one.")}${stats()}<div class="overview-charts">${chart()}${paymentSummary()}</div>${invoicePanel()}<div class="bottom-note">${icon("leaf")} Room to grow. Space to breathe. Everything in one place.</div>`;
    case "invoices":
      return `${pageHeading("Invoices", "Good work deserves a great invoice. Keep every detail in order.")}${invoicePanel()}`;
    case "clients":
      return clientsPage();
    case "expenses":
      return expensesPage();
    case "reports":
      return reportsPage();
    case "settings":
      return settingsPage();
  }
}
function clientsPage() {
  return `${pageHeading("Your people. Your business.", "A home for every client relationship.", "client")}<div class="client-summary"><span>${icon("users")}<strong>${store.clients.length}</strong> total clients</span><span>${icon("invoice")}<strong>${money(
    sum(
      store.invoices.filter((i) => i.stage !== "draft"),
      (i) => calculate(i).balance,
    ),
  )}</strong> outstanding across all clients</span></div><div class="client-grid">${store.clients
    .map((c) => {
      const invoices = store.invoices.filter(
        (i) => i.clientId === c.id && i.stage !== "draft",
      );
      return `<button class="panel client-card" data-client="${esc(c.id)}"><div class="client-card-head"><span class="large-client-avatar" style="--avatar:${esc(c.color || "#e6eee9")}">${initials(c.name)}</span>${icon("arrow")}</div><h2>${esc(c.name)}</h2><p>${esc(c.contact || c.email)}</p><div class="client-contact">${icon("mail")} ${esc(c.email)}</div><div class="client-card-footer"><span><small>Invoices</small><strong>${invoices.length}</strong></span><span><small>Outstanding</small><strong>${money(sum(invoices, (i) => calculate(i).balance))}</strong></span></div></button>`;
    })
    .join("")}</div>`;
}
function expensesPage() {
  return `${pageHeading("A clear view of your spending.", "Track the little things. They add up to the bigger picture.", "expense")}<div class="expenses-summary"><div class="panel expense-stat"><span>All recorded expenses</span><strong>${money(sum(store.expenses, (e) => Number(e.amount)))}</strong><small>${store.expenses.length} expenses recorded</small></div><div class="panel expense-stat"><span>This month</span><strong>${money(
    sum(
      store.expenses.filter((e) => e.date.startsWith(now.slice(0, 7))),
      (e) => Number(e.amount),
    ),
  )}</strong><small>${new Date(now + "T12:00:00").toLocaleDateString("en-IN", { month: "long", year: "numeric" })}</small></div><div class="expense-tip">${icon("leaf")}<p>Keep your business in balance.<br><span>Record expenses as they happen.</span></p></div></div><section class="panel"><div class="panel-heading"><div><h2>Expense ledger</h2><p>Every cost, accounted for.</p></div><button class="button outline" data-action="export-expenses">${icon("download")}Export CSV</button></div><div class="table-scroll"><table><thead><tr><th>Expense</th><th>Vendor</th><th>Category</th><th>Date</th><th class="amount-cell">Amount</th><th></th></tr></thead><tbody>${
    [...store.expenses]
      .sort((a, b) => b.date.localeCompare(a.date))
      .map(
        (e) =>
          `<tr><td><span class="expense-title">${icon("wallet")}${esc(e.title)}</span></td><td>${esc(e.vendor || "—")}</td><td><span class="category-pill">${esc(e.category)}</span></td><td class="date-cell">${dateLabel(e.date)}</td><td class="amount-cell">${money(e.amount)}</td><td><button class="icon-button" data-delete-expense="${esc(e.id)}" aria-label="Delete ${esc(e.title)}">${icon("trash")}</button></td></tr>`,
      )
      .join("") ||
    '<tr><td colspan="6"><div class="empty-state">No expenses yet. Add your first expense above.</div></td></tr>'
  }</tbody></table></div></section>`;
}
function reportsPage() {
  const inv = activeInvoices(),
    paid = sum(inv, (i) => calculate(i).paid),
    exp = expenseTotal();
  const cats = {};
  store.expenses
    .filter((e) => e.date.startsWith(period))
    .forEach(
      (e) => (cats[e.category] = (cats[e.category] || 0) + Number(e.amount)),
    );
  return `${pageHeading("Make sense of the numbers.", "A clearer picture. A more confident next step.")}${stats()}<div class="overview-charts">${chart()}<section class="panel report-summary"><div class="panel-heading"><div><h2>Monthly summary</h2><p>${periodLabel()}</p></div>${icon("chart")}</div><div class="report-line"><span>Collected on issued invoices</span><strong>${money(paid)}</strong></div><div class="report-line"><span>Recorded expenses</span><strong>− ${money(exp)}</strong></div><div class="report-net"><span>Collected less expenses</span><strong>${money(paid - exp)}</strong></div><p class="report-caveat">Collections are grouped by invoice issue date, not payment date. This is a workspace overview.</p><button class="button outline" data-action="export-report">${icon("download")}Export report</button></section></div><section class="panel category-panel"><div class="panel-heading"><div><h2>Where your money goes</h2><p>Expenses by category, ${periodLabel()}.</p></div></div>${
    Object.entries(cats)
      .map(
        ([name, amount], n) =>
          `<div class="category-row"><span>${esc(name)}</span><div class="category-track"><i style="width:${exp ? (amount / exp) * 100 : 0}%;background:${["#315c49", "#88a797", "#b4c9a8", "#ced8c7"][n % 4]}"></i></div><strong>${money(amount)}</strong></div>`,
      )
      .join("") ||
    '<p class="muted empty-state">No expenses recorded in this period.</p>'
  }</section>`;
}
function settingsPage() {
  const b = store.business;
  return `<div class="page-heading"><div><div class="eyebrow">MAKE YOURSELF AT HOME</div><h1>Your business, your way.</h1><p>These details appear on every invoice you create.</p></div></div><form id="business-form" class="panel settings-panel"><div class="panel-heading"><div><h2>Business profile</h2><p>A good introduction starts here.</p></div><span class="workspace-avatar">${initials(b.name)}</span></div><div class="form-grid">${[
    ["name", "Business name", b.name, "text"],
    ["owner", "Your name", b.owner, "text"],
    ["email", "Business email", b.email, "email"],
    ["phone", "Phone number", b.phone, "tel"],
    ["gstin", "GSTIN (optional)", b.gstin, "text"],
  ]
    .map(
      ([key, label, val, type]) =>
        `<label>${label}<input name="${key}" type="${type}" value="${esc(val)}" ${["name", "owner", "email"].includes(key) ? "required" : ""}></label>`,
    )
    .join(
      "",
    )}<label class="full-width">Business address<textarea name="address" rows="3">${esc(b.address)}</textarea></label></div><div class="form-footer"><span>${icon("check")}Used on new and existing invoice previews</span><button class="button primary" type="submit">Save changes</button></div></form><section class="panel data-panel"><div><h2>Your workspace data</h2><p>Records are saved in this browser. Download a backup to keep a copy.</p></div><div class="data-actions"><button class="button outline" data-action="backup">${icon("download")}Download backup</button><button class="button outline" data-action="restore">Restore backup</button><button class="button outline danger-text" data-action="clear-data">Clear workspace</button></div>${persistenceError ? `<p class="error-text">${esc(persistenceError)}</p>` : ""}</section>`;
}
function bind() {
  document.querySelectorAll("[data-nav]").forEach((el) =>
    el.addEventListener("click", (e) => {
      e.preventDefault();
      navigate(el.dataset.nav);
    }),
  );
  document.querySelectorAll("[data-open]").forEach((el) =>
    el.addEventListener("click", () =>
      openInvoicePreview(el.dataset.open, {
        onChange: () => {
          render();
          toast("Invoice updated");
        },
      }),
    ),
  );
  document
    .querySelectorAll("[data-action]")
    .forEach((el) =>
      el.addEventListener("click", () => action(el.dataset.action)),
    );
  document.querySelectorAll("[data-tab]").forEach((el) =>
    el.addEventListener("click", () => {
      invoiceTab = el.dataset.tab;
      pageIndex = 1;
      selected.clear();
      render();
    }),
  );
  document
    .querySelectorAll("[data-client]")
    .forEach((el) =>
      el.addEventListener("click", () => clientDetail(el.dataset.client)),
    );
  document.querySelectorAll("[data-delete-expense]").forEach((el) =>
    el.addEventListener("click", () =>
      confirmModal(
        "Delete this expense?",
        "This expense will be removed from your ledger.",
        () => {
          if (
            safeSave(() => {
              store.expenses = store.expenses.filter(
                (e) => e.id !== el.dataset.deleteExpense,
              );
            })
          ) {
            render();
            toast("Expense deleted");
          }
        },
      ),
    ),
  );
  $("#period")?.addEventListener("change", (e) => {
    period = e.target.value;
    pageIndex = 1;
    selected.clear();
    render();
  });
  $("#chart-range")?.addEventListener("change", (e) => {
    chartMode = e.target.value;
    render();
  });
  $("#invoice-search")?.addEventListener("input", (e) => {
    const pos = e.target.selectionStart;
    query = e.target.value;
    pageIndex = 1;
    render();
    $("#invoice-search").focus();
    $("#invoice-search").setSelectionRange(pos, pos);
  });
  document.querySelectorAll(".row-check").forEach((el) =>
    el.addEventListener("change", () => {
      el.checked ? selected.add(el.dataset.id) : selected.delete(el.dataset.id);
      render();
    }),
  );
  $("#select-all")?.addEventListener("change", (e) => {
    const size = page === "overview" ? 5 : 8;
    filteredInvoices()
      .slice((pageIndex - 1) * size, pageIndex * size)
      .forEach((i) =>
        e.target.checked ? selected.add(i.id) : selected.delete(i.id),
      );
    render();
  });
  $("#business-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const fields = Object.fromEntries(new FormData(e.target));
    for (const k in fields) fields[k] = fields[k].trim();
    if (!fields.name || !fields.owner) {
      toast("Add your business name and your name.");
      return;
    }
    if (safeSave(() => Object.assign(store.business, fields))) {
      render();
      toast("Business profile saved");
    }
  });
}
function action(name) {
  switch (name) {
    case "new-invoice":
      openInvoiceEditor({
        onSave: () => {
          render();
          toast("Invoice saved");
        },
      });
      break;
    case "new-client":
      clientForm();
      break;
    case "new-expense":
      expenseForm();
      break;
    case "outstanding":
      invoiceTab = "Unpaid";
      navigate("invoices");
      break;
    case "prev":
      pageIndex--;
      render();
      break;
    case "next":
      pageIndex++;
      render();
      break;
    case "filter":
      filterModal();
      break;
    case "export-invoices":
      exportInvoices(filteredInvoices());
      break;
    case "export-selected":
      exportInvoices(store.invoices.filter((i) => selected.has(i.id)));
      break;
    case "clear-selection":
      selected.clear();
      render();
      break;
    case "export-expenses":
      downloadCSV(
        "folio-expenses.csv",
        ["Title", "Vendor", "Category", "Date", "Amount INR"],
        store.expenses.map((e) => [
          e.title,
          e.vendor,
          e.category,
          e.date,
          e.amount,
        ]),
      );
      break;
    case "export-report":
      downloadCSV(
        `folio-report-${period}.csv`,
        ["Metric", "Amount INR"],
        [
          ["Invoiced", sum(activeInvoices(), (i) => calculate(i).total)],
          [
            "Collected on issued invoices",
            sum(activeInvoices(), (i) => calculate(i).paid),
          ],
          ["Outstanding", sum(activeInvoices(), (i) => calculate(i).balance)],
          ["Expenses", expenseTotal()],
          [
            "Collected less expenses",
            sum(activeInvoices(), (i) => calculate(i).paid) - expenseTotal(),
          ],
        ],
      );
      break;
    case "search":
      searchModal();
      break;
    case "activity":
      activityModal();
      break;
    case "help":
      helpModal();
      break;
    case "menu":
      $(".sidebar").classList.toggle("mobile-open");
      break;
    case "backup": {
      const backup = backupData();
      download(
        `folio-${backup.recovery ? "recovery" : "backup"}-${now}.json`,
        backup.content,
        "application/json",
      );
      toast(
        backup.recovery
          ? "Original saved data downloaded for recovery"
          : "Backup downloaded",
      );
      break;
    }
    case "restore":
      restoreBackup();
      break;
    case "clear-data":
      confirmModal(
        "Start with a clean workspace?",
        "This removes the current invoices, clients, and expenses from this browser. Download a backup first if you want to keep them.",
        () => {
          try {
            clearData();
            render();
            toast("Your workspace is ready for a fresh start");
          } catch (e) {
            toast(e.message);
          }
        },
      );
      break;
  }
}
function dialog(title, subtitle, body, cls = "") {
  const d = document.createElement("dialog");
  d.className = `app-dialog ${cls}`;
  d.innerHTML = `<div class="dialog-heading"><div><h2>${title}</h2>${subtitle ? `<p>${subtitle}</p>` : ""}</div><button class="icon-button" data-close aria-label="Close dialog">${icon("close")}</button></div>${body}`;
  const heading = d.querySelector("h2");
  heading.id = uid("dialog-heading");
  d.setAttribute("aria-labelledby", heading.id);
  document.body.append(d);
  d.querySelector("[data-close]").onclick = () => d.close();
  d.addEventListener("close", () => d.remove());
  d.addEventListener("click", (e) => {
    if (e.target === d) {
      const r = d.getBoundingClientRect();
      if (
        e.clientX < r.left ||
        e.clientX > r.right ||
        e.clientY < r.top ||
        e.clientY > r.bottom
      )
        d.close();
    }
  });
  d.showModal();
  return d;
}
function confirmModal(title, message, fn) {
  const d = dialog(
    title,
    message,
    `<div class="dialog-actions"><button class="button outline" id="cancel-confirm">Cancel</button><button class="button danger" id="confirm-yes">Confirm</button></div>`,
  );
  d.querySelector("#cancel-confirm").onclick = () => d.close();
  d.querySelector("#confirm-yes").onclick = () => {
    d.close();
    fn();
  };
}
function clientForm(id) {
  const c = store.clients.find((c) => c.id === id) || {};
  const d = dialog(
    id ? "Edit client" : "A new connection",
    "Keep their details close. Make invoicing simpler.",
    `<form id="client-form"><div class="form-grid">${[
      ["name", "Business / client name", "text"],
      ["contact", "Contact person", "text"],
      ["email", "Email address", "email"],
      ["phone", "Phone number", "tel"],
      ["gstin", "GSTIN (optional)", "text"],
    ]
      .map(
        ([key, label, type]) =>
          `<label>${label}<input name="${key}" value="${esc(c[key])}" type="${type}" ${["name", "email"].includes(key) ? "required" : ""}></label>`,
      )
      .join(
        "",
      )}<label class="full-width">Billing address<textarea name="address" rows="3">${esc(c.address)}</textarea></label></div><div class="dialog-actions"><button type="button" class="button outline" id="cancel-client">Cancel</button><button class="button primary" type="submit">${id ? "Save changes" : "Add client"}</button></div></form>`,
  );
  d.querySelector("#cancel-client").onclick = () => d.close();
  d.querySelector("form").onsubmit = (e) => {
    e.preventDefault();
    const values = Object.fromEntries(new FormData(e.target));
    for (const k in values) values[k] = values[k].trim();
    if (!values.name) {
      toast("Enter a client name");
      return;
    }
    if (
      safeSave(() => {
        if (id)
          Object.assign(
            store.clients.find((client) => client.id === id),
            values,
          );
        else
          store.clients.push({
            ...values,
            id: uid("client"),
            color: ["#eee6d7", "#e4e9f1", "#e3ecde", "#ece4ef"][
              store.clients.length % 4
            ],
          });
      })
    ) {
      d.close();
      render();
      toast(id ? "Client updated" : "New client added");
    }
  };
}
function clientDetail(id) {
  const c = store.clients.find((c) => c.id === id);
  const inv = store.invoices.filter((i) => i.clientId === id);
  const d = dialog(
    esc(c.name),
    esc(c.contact || "Client details"),
    `<div class="client-detail"><p>${icon("mail")} ${esc(c.email)}</p><p>${esc(c.phone)}</p><p>${esc(c.address)}</p>${c.gstin ? `<p>GSTIN ${esc(c.gstin)}</p>` : ""}<div class="detail-metrics"><span>Invoiced<strong>${money(
      sum(
        inv.filter((i) => i.stage !== "draft"),
        (i) => calculate(i).total,
      ),
    )}</strong></span><span>Outstanding<strong>${money(
      sum(
        inv.filter((i) => i.stage !== "draft"),
        (i) => calculate(i).balance,
      ),
    )}</strong></span></div><h3>Invoices <span class="count-pill">${inv.length}</span></h3>${inv.map((i) => `<button class="detail-invoice" data-detail-open="${esc(i.id)}"><span>${esc(i.number)}</span>${badge(i)}<strong>${money(calculate(i).total)}</strong>${icon("chevron")}</button>`).join("") || '<p class="muted">No invoices for this client yet.</p>'}</div><div class="dialog-actions"><button class="button outline" id="edit-client">Edit client</button><button class="button primary" id="client-invoice">${icon("plus")}Create invoice</button></div>`,
  );
  d.querySelector("#edit-client").onclick = () => {
    d.close();
    clientForm(id);
  };
  d.querySelector("#client-invoice").onclick = () => {
    d.close();
    openInvoiceEditor({
      clientId: id,
      onSave: () => {
        render();
        toast("Invoice saved");
      },
    });
  };
  d.querySelectorAll("[data-detail-open]").forEach(
    (el) =>
      (el.onclick = () => {
        d.close();
        openInvoicePreview(el.dataset.detailOpen, { onChange: render });
      }),
  );
}
function expenseForm() {
  const d = dialog(
    "Record an expense",
    "A small step toward a clearer picture.",
    `<form><div class="form-grid"><label class="full-width">What was it for?<input name="title" placeholder="e.g. Design software subscription" required></label><label>Amount (INR)<input name="amount" type="number" min="0.01" step="0.01" placeholder="0.00" required></label><label>Date<input name="date" type="date" value="${now}" required></label><label>Category<select name="category">${["Software", "Office", "Travel", "Professional services", "Marketing", "Other"].map((c) => `<option>${c}</option>`).join("")}</select></label><label>Vendor<input name="vendor" placeholder="e.g. Adobe"></label></div><div class="dialog-actions"><button type="button" class="button outline" id="cancel-expense">Cancel</button><button class="button primary" type="submit">Save expense</button></div></form>`,
  );
  d.querySelector("#cancel-expense").onclick = () => d.close();
  d.querySelector("form").onsubmit = (e) => {
    e.preventDefault();
    const values = Object.fromEntries(new FormData(e.target));
    values.amount = Number(values.amount);
    values.title = values.title.trim();
    if (!values.title || !Number.isFinite(values.amount) || values.amount <= 0)
      return;
    if (safeSave(() => store.expenses.push({ ...values, id: uid("exp") }))) {
      d.close();
      render();
      toast("Expense recorded");
    }
  };
}
function filterModal() {
  const d = dialog(
    "Filter invoices",
    "Choose the invoices you want to see.",
    `<div class="filter-options">${["All invoices", "Unpaid", "Paid", "Drafts"].map((t) => `<button class="filter-option ${invoiceTab === t ? "chosen" : ""}" data-filter="${t}">${t}${invoiceTab === t ? icon("check") : ""}</button>`).join("")}</div>`,
    "compact-dialog",
  );
  d.querySelectorAll("[data-filter]").forEach(
    (el) =>
      (el.onclick = () => {
        invoiceTab = el.dataset.filter;
        pageIndex = 1;
        selected.clear();
        d.close();
        render();
      }),
  );
}
function searchModal() {
  const d = dialog(
    "Find something",
    "Search invoices and clients across your workspace.",
    `<label class="global-search">${icon("search")}<input id="global-query" placeholder="Try an invoice number or client…" autofocus></label><div id="search-results" class="search-results"><p class="muted">Start typing to search your workspace.</p></div>`,
  );
  const input = d.querySelector("input");
  input.oninput = () => {
    const q = input.value.trim().toLowerCase();
    const result = d.querySelector("#search-results");
    if (!q) {
      result.innerHTML =
        '<p class="muted">Start typing to search your workspace.</p>';
      return;
    }
    const inv = store.invoices
        .filter((i) =>
          (i.number + " " + clientFor(i).name).toLowerCase().includes(q),
        )
        .slice(0, 5),
      clients = store.clients
        .filter((c) => `${c.name} ${c.email}`.toLowerCase().includes(q))
        .slice(0, 4);
    result.innerHTML =
      inv
        .map(
          (i) =>
            `<button data-search-invoice="${esc(i.id)}">${icon("invoice")}<span><strong>${esc(i.number)}</strong><small>${esc(clientFor(i).name)}</small></span><b>${money(calculate(i).total)}</b></button>`,
        )
        .join("") +
        clients
          .map(
            (c) =>
              `<button data-search-client="${esc(c.id)}">${icon("users")}<span><strong>${esc(c.name)}</strong><small>${esc(c.email)}</small></span>${icon("chevron")}</button>`,
          )
          .join("") ||
      '<div class="empty-state">No results found. Try a different search.</div>';
    result.querySelectorAll("[data-search-invoice]").forEach(
      (el) =>
        (el.onclick = () => {
          d.close();
          openInvoicePreview(el.dataset.searchInvoice, { onChange: render });
        }),
    );
    result.querySelectorAll("[data-search-client]").forEach(
      (el) =>
        (el.onclick = () => {
          d.close();
          clientDetail(el.dataset.searchClient);
        }),
    );
  };
}
function activityModal() {
  const overdue = store.invoices.filter((i) => status(i) === "Overdue");
  const d = dialog(
    "A moment to catch up",
    `${overdue.length} ${overdue.length === 1 ? "invoice needs" : "invoices need"} a follow-up.`,
    `<div class="activity-list">${overdue.map((i) => `<button data-activity-invoice="${esc(i.id)}"><span class="activity-icon">${icon("clock")}</span><span><strong>${esc(clientFor(i).name)}</strong><small>${esc(i.number)} · due ${dateLabel(i.dueDate)}</small></span><b>${money(calculate(i).balance)}</b>${icon("chevron")}</button>`).join("") || '<div class="empty-state">Everything is up to date. A good place to be.</div>'}</div>`,
  );
  d.querySelectorAll("[data-activity-invoice]").forEach(
    (el) =>
      (el.onclick = () => {
        d.close();
        openInvoicePreview(el.dataset.activityInvoice, { onChange: render });
      }),
  );
}
function helpModal() {
  dialog(
    "A little help to get going",
    "Your business, in balance.",
    `<div class="help-content"><div><span>01</span><section><h3>Make it yours</h3><p>Add your business name, address, and contact information in Settings. They’ll appear on your invoices.</p></section></div><div><span>02</span><section><h3>Bring your clients along</h3><p>Add clients, then create an invoice with your services, quantities, rates, discount, and tax.</p></section></div><div><span>03</span><section><h3>Keep things moving</h3><p>Open an invoice to record payments, edit details, or print and save it as a PDF from your browser.</p></section></div><div class="help-note">Your records are saved on this browser and device. Settings lets you download a JSON backup. Start with the sample data, then clear it whenever you’re ready.</div></div>`,
  );
}
function restoreBackup() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".json,application/json";
  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    if (file.size > 5_000_000) {
      toast("Choose a JSON backup smaller than 5 MB.");
      return;
    }
    let snapshot;
    try {
      snapshot = JSON.parse(await file.text());
    } catch {
      toast("This file is not a valid JSON backup.");
      return;
    }
    confirmModal(
      "Restore this backup?",
      "This replaces the current workspace records with the selected backup. Download the current workspace first if you want to keep it.",
      () => {
        try {
          restoreData(snapshot);
          render();
          toast("Workspace restored");
        } catch (e) {
          toast(e.message);
        }
      },
    );
  };
  input.click();
}
function download(filename, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function downloadCSV(filename, headers, rows) {
  const cell = (v) => {
    let s = String(v ?? "");
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return '"' + s.replaceAll('"', '""') + '"';
  };
  download(
    filename,
    "\ufeff" +
      [headers, ...rows].map((row) => row.map(cell).join(",")).join("\r\n"),
    "text/csv;charset=utf-8",
  );
  toast("CSV exported");
}
function exportInvoices(rows) {
  downloadCSV(
    "folio-invoices-" + now + ".csv",
    [
      "Invoice",
      "Client",
      "Issued",
      "Due",
      "Subtotal INR",
      "Discount INR",
      "Tax INR",
      "Total INR",
      "Paid INR",
      "Balance INR",
      "Status",
    ],
    rows.map((i) => {
      const c = calculate(i);
      return [
        i.number,
        clientFor(i).name,
        i.date,
        i.dueDate,
        c.subtotal,
        c.discount,
        c.tax,
        c.total,
        c.paid,
        c.balance,
        status(i),
      ];
    }),
  );
}
window.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === "k") {
    e.preventDefault();
    if (!document.querySelector("dialog[open]")) searchModal();
  }
});
window.addEventListener("storage", (event) => {
  if (event.key !== "folio.workspace.v1") return;
  const indicator = $(".save-status");
  if (indicator) {
    indicator.classList.add("storage-error");
    indicator.innerHTML = "<i></i> Updated in another tab";
  }
  toast(
    "Workspace updated in another tab. Reload this page before making changes.",
  );
});
render();
if (persistenceError) toast(persistenceError);
