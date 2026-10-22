/** The small, local-first workspace behind Folio. All currency values are INR. */
const STORAGE_KEY = "folio.workspace.v1";
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const clone = (value) => JSON.parse(JSON.stringify(value));

export let persistenceError = null;
let blockedStorage = false;
let recoveryRaw = null;
let browserStorage = null;
let storageBaseline = null;
let memorySnapshot = null;
const isBrowser =
  typeof window !== "undefined" && typeof document !== "undefined";
const STORAGE_UNAVAILABLE =
  "Browser storage is unavailable. Changes cannot be saved on this device. Enable site storage or use a browser that allows it.";

try {
  browserStorage = globalThis.localStorage || null;
} catch {
  // Browsers may forbid storage in private or sandboxed contexts. The workspace
  // remains usable for this session; Node also follows this in-memory path.
}
if (isBrowser && !browserStorage) persistenceError = STORAGE_UNAVAILABLE;

export function today() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const part = (name) => parts.find((value) => value.type === name).value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function uid(prefix = "id") {
  const token =
    globalThis.crypto?.randomUUID?.() ||
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}-${token}`;
}

function round(value) {
  return (
    Math.round((value + Number.EPSILON * Math.max(1, Math.abs(value))) * 100) /
    100
  );
}

function amount(value, label, fallback = 0) {
  const candidate =
    value === undefined || value === null || value === "" ? fallback : value;
  if (
    (typeof candidate !== "number" && typeof candidate !== "string") ||
    (typeof candidate === "string" && candidate.trim() === "")
  ) {
    throw new TypeError(`${label} must be a valid number.`);
  }
  const number = Number(candidate);
  if (!Number.isFinite(number) || number < 0 || number > 1e12) {
    throw new RangeError(`${label} must be a finite, non-negative amount.`);
  }
  return number;
}

function validDate(value, label) {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) {
    throw new TypeError(`${label} must use YYYY-MM-DD.`);
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  ) {
    throw new RangeError(`${label} must be a real calendar date.`);
  }
  return value;
}

function plusDays(date, count) {
  const value = new Date(`${validDate(date, "Invoice date")}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + count);
  return value.toISOString().slice(0, 10);
}

export function money(value) {
  const number = Number(value);
  if (!Number.isFinite(number))
    throw new TypeError("Currency must be a finite number.");
  const rounded = round(number);
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: Number.isInteger(rounded) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(rounded);
}

export function calculate(invoice = {}) {
  if (!Array.isArray(invoice.items))
    throw new TypeError("Invoice items must be an array.");
  const subtotal = round(
    invoice.items.reduce((sum, item) => {
      if (!item || typeof item !== "object")
        throw new TypeError("Each invoice item must be an object.");
      const quantity = amount(item.quantity, "Item quantity", 1);
      const rate = amount(item.rate, "Item rate");
      // Round each displayed line before summing so the invoice matches its rows.
      return sum + round(quantity * rate);
    }, 0),
  );
  if (!Number.isFinite(subtotal) || subtotal > 1e12)
    throw new RangeError("Invoice subtotal is too large.");
  const discount = round(amount(invoice.discount, "Discount"));
  if (discount > subtotal)
    throw new RangeError("Discount cannot exceed the subtotal.");
  const taxRate = amount(invoice.taxRate, "Tax rate");
  if (taxRate > 100)
    throw new RangeError("Tax rate must be between 0 and 100.");
  const taxable = round(subtotal - discount);
  const tax = round((taxable * taxRate) / 100);
  const total = round(taxable + tax);
  const paid = round(amount(invoice.paid, "Payment"));
  if (paid > total)
    throw new RangeError("Payment cannot exceed the invoice total.");
  return { subtotal, discount, tax, total, paid, balance: round(total - paid) };
}

export function status(invoice, asOf = today()) {
  validDate(asOf, "Current date");
  const totals = calculate(invoice);
  if (invoice.stage === "draft") return "Draft";
  if (totals.balance === 0) return "Paid";
  if (invoice.dueDate && validDate(invoice.dueDate, "Due date") < asOf)
    return "Overdue";
  return totals.paid > 0 ? "Partial" : "Unpaid";
}

function normalizeInvoice(
  fields,
  { existing = null, clients = store.clients } = {},
) {
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) {
    throw new TypeError("Invoice fields must be an object.");
  }
  const merged = { ...existing, ...fields };
  const date = validDate(merged.date || today(), "Invoice date");
  const dueDate = validDate(merged.dueDate || plusDays(date, 15), "Due date");
  if (dueDate < date)
    throw new RangeError("Due date cannot be before the invoice date.");
  const stage = merged.stage || "draft";
  if (!["draft", "sent"].includes(stage))
    throw new RangeError("Invoice stage must be draft or sent.");
  if (!clients.some((client) => client.id === merged.clientId)) {
    throw new RangeError("Choose an existing client for this invoice.");
  }
  if (!Array.isArray(merged.items) || merged.items.length === 0) {
    throw new RangeError("Add at least one invoice item.");
  }
  const items = merged.items.map((item) => {
    if (!item || typeof item !== "object")
      throw new TypeError("Each invoice item must be an object.");
    const description = String(item.description || "").trim();
    if (!description)
      throw new RangeError("Each invoice item needs a description.");
    const quantity = amount(item.quantity, "Item quantity", 1);
    if (quantity === 0)
      throw new RangeError("Item quantity must be greater than zero.");
    return {
      description,
      quantity,
      rate: round(amount(item.rate, "Item rate")),
    };
  });
  const number = String(merged.number || invoiceNumber()).trim();
  if (!number) throw new RangeError("Invoice number is required.");
  const invoice = {
    id: existing?.id || merged.id || uid("inv"),
    number,
    clientId: merged.clientId,
    date,
    dueDate,
    items,
    taxRate: amount(merged.taxRate, "Tax rate"),
    discount: round(amount(merged.discount, "Discount")),
    paid: round(amount(merged.paid, "Payment")),
    stage,
    notes: String(merged.notes || "").trim(),
  };
  calculate(invoice);
  return invoice;
}

const CLIENTS = [
  {
    id: "client-arc",
    name: "Arc & Co.",
    contact: "Ananya Mehta",
    email: "ananya@arcandco.example",
    phone: "+91 98201 42810",
    address: "22, Chapel Road, Bandra West, Mumbai 400050",
    gstin: "27AABCA1042L1Z8",
    color: "#f0e9dc",
  },
  {
    id: "client-lumen",
    name: "Lumen Labs",
    contact: "Rohan Shah",
    email: "rohan@lumenlabs.example",
    phone: "+91 98450 21693",
    address: "14, 80 Feet Road, Indiranagar, Bengaluru 560038",
    gstin: "29AABCL7736R1Z2",
    color: "#e6eafb",
  },
  {
    id: "client-olive",
    name: "Olive Collective",
    contact: "Mira Kapoor",
    email: "mira@olivecollective.example",
    phone: "+91 98110 70514",
    address: "D-18, Defence Colony, New Delhi 110024",
    gstin: "07AABCO9012K1Z6",
    color: "#e9edde",
  },
  {
    id: "client-mono",
    name: "Mono Studio",
    contact: "Kabir Sethi",
    email: "kabir@monostudio.example",
    phone: "+91 98200 31926",
    address: "6, Turner Road, Bandra West, Mumbai 400050",
    gstin: "27AABCM8045D1Z4",
    color: "#ece7e1",
  },
  {
    id: "client-loop",
    name: "Loop Creative",
    contact: "Tara Iyer",
    email: "tara@loopcreative.example",
    phone: "+91 98403 62815",
    address: "31, TTK Road, Alwarpet, Chennai 600018",
    gstin: "33AABCL6408N1Z5",
    color: "#f7e4e1",
  },
  {
    id: "client-form",
    name: "Form & Field",
    contact: "Dev Malhotra",
    email: "dev@formandfield.example",
    phone: "+91 98230 41829",
    address: "8, Lane 5, Koregaon Park, Pune 411001",
    gstin: "27AABCF2086P1Z3",
    color: "#e2efeb",
  },
  {
    id: "client-northstar",
    name: "Northstar Ventures",
    contact: "Nisha Rao",
    email: "nisha@northstar.example",
    phone: "+91 98451 38640",
    address: "44, Residency Road, Bengaluru 560025",
    gstin: "29AABCN5109T1Z7",
    color: "#e5ebf1",
  },
];

function seedInvoice(number, clientId, date, dueDate, items, options = {}) {
  const invoice = {
    id: `inv-${number}`,
    number: `INV-2026-${number}`,
    clientId,
    date,
    dueDate,
    items: items.map(([description, quantity, rate]) => ({
      description,
      quantity,
      rate,
    })),
    taxRate: 18,
    discount: 0,
    paid: 0,
    stage: "sent",
    notes:
      "Thank you for choosing Studio North. It is a pleasure creating with you.",
    ...options,
  };
  if (options.paid === "full")
    invoice.paid = calculate({ ...invoice, paid: 0 }).total;
  return invoice;
}

function seedData() {
  return {
    clients: clone(CLIENTS),
    business: {
      name: "Studio North",
      owner: "Raunak Patel",
      email: "hello@studionorth.example",
      address: "204, The Mill, Senapati Bapat Marg, Lower Parel, Mumbai 400013",
      gstin: "27AABCS7620M1Z9",
      phone: "+91 98700 24186",
    },
    invoices: [
      seedInvoice("032", "client-arc", "2026-10-18", "2026-11-02", [
        ["Brand identity — final delivery", 1, 60000],
        ["Brand guidelines & handoff", 1, 12000],
      ]),
      seedInvoice(
        "031",
        "client-lumen",
        "2026-10-16",
        "2026-10-30",
        [["Website design — milestone 02", 1, 45000]],
        { paid: "full" },
      ),
      seedInvoice("030", "client-olive", "2026-10-12", "2026-10-17", [
        ["Social campaign art direction", 1, 24000],
        ["Campaign templates", 8, 1000],
      ]),
      seedInvoice(
        "029",
        "client-mono",
        "2026-10-10",
        "2026-10-25",
        [["E-commerce experience design", 1, 54000]],
        { paid: 20000 },
      ),
      seedInvoice(
        "028",
        "client-loop",
        "2026-10-08",
        "2026-10-18",
        [["October creative retainer", 1, 24000]],
        { paid: "full" },
      ),
      seedInvoice(
        "027",
        "client-form",
        "2026-10-05",
        "2026-10-20",
        [
          ["Packaging concept exploration", 1, 38000],
          ["Production-ready artwork", 1, 8000],
        ],
        { stage: "draft" },
      ),
      seedInvoice("026", "client-northstar", "2026-10-01", "2026-10-15", [
        ["Product strategy workshop", 2, 20000],
        ["Investor deck design", 1, 60000],
      ]),
      seedInvoice(
        "025",
        "client-lumen",
        "2026-09-14",
        "2026-09-28",
        [["Website design — milestone 01", 1, 95000]],
        { paid: "full" },
      ),
      seedInvoice(
        "024",
        "client-arc",
        "2026-08-12",
        "2026-08-26",
        [["Brand discovery & strategy", 1, 68000]],
        { paid: "full" },
      ),
      seedInvoice(
        "023",
        "client-northstar",
        "2026-07-08",
        "2026-07-22",
        [["Product interface design sprint", 1, 82000]],
        { paid: "full" },
      ),
      seedInvoice(
        "022",
        "client-olive",
        "2026-06-10",
        "2026-06-24",
        [["Summer campaign design", 1, 56000]],
        { paid: "full" },
      ),
      seedInvoice(
        "021",
        "client-loop",
        "2026-05-06",
        "2026-05-20",
        [["Creative direction & launch assets", 1, 72000]],
        { paid: "full" },
      ),
    ],
    expenses: [
      {
        id: "exp-01",
        title: "Adobe Creative Cloud",
        category: "Software",
        date: "2026-10-16",
        amount: 4230,
        vendor: "Adobe",
      },
      {
        id: "exp-02",
        title: "Studio workspace",
        category: "Office",
        date: "2026-10-05",
        amount: 18000,
        vendor: "The Mill Coworking",
      },
      {
        id: "exp-03",
        title: "Typography licenses",
        category: "Design assets",
        date: "2026-10-11",
        amount: 6400,
        vendor: "Indian Type Foundry",
      },
      {
        id: "exp-04",
        title: "Client workshop supplies",
        category: "Projects",
        date: "2026-10-08",
        amount: 2850,
        vendor: "Paper & Co.",
      },
      {
        id: "exp-05",
        title: "Figma Professional",
        category: "Software",
        date: "2026-10-02",
        amount: 1350,
        vendor: "Figma",
      },
      {
        id: "exp-06",
        title: "September studio workspace",
        category: "Office",
        date: "2026-09-05",
        amount: 18000,
        vendor: "The Mill Coworking",
      },
    ],
  };
}

function validateSnapshot(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Workspace must be an object.");
  for (const key of ["clients", "invoices", "expenses"]) {
    if (!Array.isArray(value[key]))
      throw new Error(`Workspace ${key} must be an array.`);
  }
  if (!value.business || typeof value.business.name !== "string")
    throw new Error("Business details are missing.");
  for (const key of ["owner", "email", "address", "gstin", "phone"]) {
    if (
      Object.hasOwn(value.business, key) &&
      typeof value.business[key] !== "string"
    ) {
      throw new Error(`Business ${key} must be text.`);
    }
  }
  for (const client of value.clients) {
    if (
      !client ||
      typeof client.id !== "string" ||
      !client.id ||
      typeof client.name !== "string" ||
      !client.name.trim()
    ) {
      throw new Error("A saved client is incomplete.");
    }
  }
  for (const key of ["clients", "invoices", "expenses"]) {
    const ids = value[key].map((record) => record?.id);
    if (
      ids.some((id) => typeof id !== "string" || !id) ||
      new Set(ids).size !== ids.length
    ) {
      throw new Error(`Workspace ${key} must have unique IDs.`);
    }
  }
  const numbers = new Set();
  for (const invoice of value.invoices) {
    if (
      typeof invoice.number !== "string" ||
      !invoice.number.trim() ||
      numbers.has(invoice.number)
    ) {
      throw new Error("Saved invoice numbers must be unique.");
    }
    numbers.add(invoice.number);
    validDate(invoice.date, "Invoice date");
    validDate(invoice.dueDate, "Due date");
    if (!["draft", "sent"].includes(invoice.stage))
      throw new Error("Saved invoice stage must be draft or sent.");
    normalizeInvoice(invoice, { existing: invoice, clients: value.clients });
  }
  for (const expense of value.expenses) {
    if (!expense || typeof expense.title !== "string" || !expense.title.trim())
      throw new Error("A saved expense is incomplete.");
    validDate(expense.date, "Expense date");
    amount(expense.amount, "Expense amount");
  }
  return value;
}

function load() {
  if (!browserStorage) return seedData();
  let raw;
  try {
    raw = browserStorage.getItem(STORAGE_KEY);
    storageBaseline = raw ?? null;
  } catch {
    browserStorage = null;
    if (isBrowser) persistenceError = STORAGE_UNAVAILABLE;
    return seedData();
  }
  if (raw === null || raw === undefined) return seedData();
  try {
    return validateSnapshot(JSON.parse(raw));
  } catch (error) {
    blockedStorage = true;
    recoveryRaw = raw;
    persistenceError = `Saved workspace could not be read (${error.message}). Your original data is preserved. Download a recovery backup before clearing the workspace.`;
    console.error(persistenceError);
    return seedData();
  }
}

export const store = load();

export function persist() {
  if (blockedStorage) throw new Error(persistenceError);
  if (isBrowser && !browserStorage) {
    persistenceError = STORAGE_UNAVAILABLE;
    throw new Error(persistenceError);
  }
  validateSnapshot(store);
  const serialized = JSON.stringify(store);
  if (browserStorage) {
    let current;
    try {
      current = browserStorage.getItem(STORAGE_KEY) ?? null;
    } catch (error) {
      persistenceError =
        "Your browser could not read the saved workspace. Check site storage and try again.";
      throw new Error(persistenceError, { cause: error });
    }
    if (current !== storageBaseline) {
      persistenceError =
        "This workspace changed in another tab. Reload this page, then retry your change. Your latest saved records have been preserved.";
      throw new Error(persistenceError);
    }
    try {
      browserStorage.setItem(STORAGE_KEY, serialized);
    } catch (error) {
      persistenceError =
        "Your browser could not save this workspace. Free some storage and try again.";
      throw new Error(persistenceError, { cause: error });
    }
    storageBaseline = serialized;
  }
  memorySnapshot = serialized;
  recoveryRaw = null;
  persistenceError = null;
  return true;
}

/** Preserve original unreadable bytes instead of exporting the demo fallback. */
export function backupData() {
  if (blockedStorage && recoveryRaw !== null) {
    return {
      recovery: true,
      content: JSON.stringify(
        { format: "folio-recovery", raw: recoveryRaw, error: persistenceError },
        null,
        2,
      ),
    };
  }
  return { recovery: false, content: JSON.stringify(store, null, 2) };
}

export function resetData() {
  const previous = clone(store);
  const wasBlocked = blockedStorage;
  const previousError = persistenceError;
  Object.assign(store, seedData());
  blockedStorage = false;
  persistenceError = null;
  try {
    persist();
  } catch (error) {
    Object.assign(store, previous);
    blockedStorage = wasBlocked;
    persistenceError = previousError || error.message;
    throw error;
  }
  return store;
}

/** Import a validated backup without changing the identity of the live store. */
export function restoreData(snapshot) {
  const next = validateSnapshot(clone(snapshot));
  const previous = clone(store);
  Object.assign(store, next);
  try {
    persist();
  } catch (error) {
    Object.assign(store, previous);
    throw error;
  }
  return store;
}

/** An explicit user clear is the only blank-workspace recovery from corrupt data. */
export function clearData() {
  const previous = clone(store);
  const wasBlocked = blockedStorage;
  const previousError = persistenceError;
  Object.assign(store, { clients: [], invoices: [], expenses: [] });
  blockedStorage = false;
  persistenceError = null;
  try {
    persist();
  } catch (error) {
    Object.assign(store, previous);
    blockedStorage = wasBlocked;
    persistenceError = wasBlocked ? previousError : error.message;
    throw error;
  }
  return store;
}

export function invoiceNumber() {
  const year = today().slice(0, 4);
  const prefix = `INV-${year}-`;
  const maximum = store.invoices.reduce((current, invoice) => {
    if (!invoice.number.startsWith(prefix)) return current;
    const suffix = invoice.number.slice(prefix.length);
    return /^\d+$/.test(suffix) ? Math.max(current, Number(suffix)) : current;
  }, 0);
  return `${prefix}${String(maximum + 1).padStart(3, "0")}`;
}

function saveInvoices(invoices) {
  const previous = store.invoices;
  store.invoices = invoices;
  try {
    persist();
  } catch (error) {
    store.invoices = previous;
    throw error;
  }
}

function assertUnique(invoice, excludedId = null) {
  if (
    store.invoices.some(
      (item) => item.id !== excludedId && item.number === invoice.number,
    )
  ) {
    throw new RangeError("An invoice with this number already exists.");
  }
  if (
    store.invoices.some(
      (item) => item.id !== excludedId && item.id === invoice.id,
    )
  ) {
    throw new RangeError("An invoice with this ID already exists.");
  }
}

export function addInvoice(fields) {
  const invoice = normalizeInvoice(fields);
  assertUnique(invoice);
  saveInvoices([invoice, ...store.invoices]);
  return invoice;
}

export function updateInvoice(id, fields) {
  const existing = store.invoices.find((invoice) => invoice.id === id);
  if (!existing) throw new RangeError("Invoice could not be found.");
  const invoice = normalizeInvoice(fields, { existing });
  assertUnique(invoice, id);
  saveInvoices(store.invoices.map((item) => (item.id === id ? invoice : item)));
  return invoice;
}

export function deleteInvoice(id) {
  if (!store.invoices.some((invoice) => invoice.id === id)) return false;
  saveInvoices(store.invoices.filter((invoice) => invoice.id !== id));
  return true;
}
