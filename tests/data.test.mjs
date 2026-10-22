import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Import as a data URL so this buildless module also runs without package.json.
const source = await readFile(
  new URL("../public/data.js", import.meta.url),
  "utf8",
);
const data = await import(
  `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
);
const {
  store,
  calculate,
  status,
  money,
  addInvoice,
  updateInvoice,
  deleteInvoice,
  invoiceNumber,
  persist,
  resetData,
  restoreData,
  clearData,
  today,
} = data;

const invoice = (overrides) => ({
  id: "test",
  number: "TEST-001",
  clientId: store.clients[0].id,
  date: "2026-10-19",
  dueDate: "2026-11-03",
  items: [{ description: "Design work", quantity: 2, rate: 1000 }],
  taxRate: 18,
  discount: 200,
  paid: 0,
  stage: "sent",
  notes: "",
  ...overrides,
});

test("calculates line amounts, absolute discount, tax, and remaining balance in order", () => {
  assert.deepEqual(calculate(invoice({ paid: 1000 })), {
    subtotal: 2000,
    discount: 200,
    tax: 324,
    total: 2124,
    paid: 1000,
    balance: 1124,
  });
});

test("rounds each visible line and calculated currency to cents", () => {
  assert.deepEqual(
    calculate(
      invoice({
        items: [
          { quantity: 1, rate: 1.005 },
          { quantity: 3, rate: 0.335 },
        ],
        discount: 0,
        taxRate: 18,
      }),
    ),
    {
      subtotal: 2.02,
      discount: 0,
      tax: 0.36,
      total: 2.38,
      paid: 0,
      balance: 2.38,
    },
  );
});

test("returns date-aware statuses with a due date inclusive of the due day", () => {
  const value = invoice({ dueDate: "2026-10-19" });
  assert.equal(status(value, "2026-10-19"), "Unpaid");
  assert.equal(status(value, "2026-10-20"), "Overdue");
  assert.equal(status({ ...value, paid: 100 }, "2026-10-19"), "Partial");
  assert.equal(status({ ...value, paid: 100 }, "2026-10-20"), "Overdue");
  assert.equal(status({ ...value, paid: 2124 }, "2026-10-20"), "Paid");
  assert.equal(status({ ...value, stage: "draft" }, "2026-10-20"), "Draft");
});

test("rejects invalid amounts, overpayments, and impossible discounts", () => {
  for (const paid of [-1, NaN, Infinity, "oops", true]) {
    assert.throws(() => calculate(invoice({ paid })), /Payment/);
  }
  assert.throws(() => calculate(invoice({ paid: 3000 })), /exceed/);
  assert.throws(() => calculate(invoice({ discount: 2001 })), /Discount/);
  assert.throws(() => calculate(invoice({ taxRate: 101 })), /Tax rate/);
  assert.throws(
    () => calculate(invoice({ items: [{ quantity: -1, rate: 100 }] })),
    /quantity/,
  );
  assert.throws(
    () => calculate(invoice({ items: [{ quantity: 1, rate: NaN }] })),
    /rate/,
  );
});

test("formats INR using Indian grouping and preserves meaningful paise", () => {
  assert.equal(money(123456), "₹1,23,456");
  assert.equal(money(1234.5), "₹1,234.50");
  assert.equal(money(1.005), "₹1.01");
  assert.throws(() => money(NaN), /finite/);
  assert.match(today(), /^\d{4}-\d{2}-\d{2}$/);
});

test("seed data has seven current invoices, historical chart records, and valid relationships", () => {
  assert.equal(
    store.invoices.filter((item) => item.date.startsWith("2026-10")).length,
    7,
  );
  assert.equal(
    store.invoices.filter((item) => item.date < "2026-10-01").length,
    5,
  );
  assert.equal(store.clients.length, 7);
  assert.equal(store.business.name, "Studio North");
  assert.deepEqual(
    new Set(store.invoices.map((item) => status(item, "2026-10-19"))),
    new Set(["Paid", "Unpaid", "Partial", "Overdue", "Draft"]),
  );
  for (const item of store.invoices) {
    assert.ok(store.clients.some((client) => client.id === item.clientId));
    assert.ok(calculate(item).total >= 0);
  }
  assert.equal(persist(), true);
});

test("add, update, and delete preserve schema, validation, and sequential numbering", () => {
  const count = store.invoices.length;
  const number = invoiceNumber();
  const created = addInvoice(
    invoice({ id: undefined, number, stage: "draft" }),
  );
  assert.equal(store.invoices.length, count + 1);
  assert.ok(created.id.startsWith("inv-"));
  assert.equal(created.number, number);
  assert.notEqual(invoiceNumber(), number);
  const changed = updateInvoice(created.id, { paid: 100, stage: "sent" });
  assert.equal(changed.id, created.id);
  assert.equal(status(changed, "2026-10-19"), "Partial");
  assert.throws(() => updateInvoice(created.id, { paid: -1 }), /Payment/);
  assert.equal(store.invoices.find((item) => item.id === created.id).paid, 100);
  assert.throws(
    () => addInvoice(invoice({ id: undefined, number })),
    /already exists/,
  );
  assert.throws(
    () => addInvoice(invoice({ number: "INVALID-DATE", date: "2026-02-30" })),
    /real calendar/,
  );
  assert.throws(
    () => addInvoice(invoice({ number: "INVALID-DUE", dueDate: "2026-10-01" })),
    /before/,
  );
  assert.throws(
    () =>
      addInvoice(invoice({ number: "INVALID-CLIENT", clientId: "missing" })),
    /existing client/,
  );
  assert.throws(
    () =>
      addInvoice(
        invoice({
          number: "INVALID-ITEM",
          items: [{ description: " ", quantity: 1, rate: 10 }],
        }),
      ),
    /description/,
  );
  assert.equal(deleteInvoice(created.id), true);
  assert.equal(deleteInvoice(created.id), false);
  assert.equal(store.invoices.length, count);
  assert.throws(() => updateInvoice("missing", {}), /found/);
});

test("reset retains the exported store object and restores the demo", () => {
  const identity = store;
  store.business.name = "Changed";
  resetData();
  assert.equal(store, identity);
  assert.equal(store.business.name, "Studio North");
  assert.equal(store.invoices.length, 12);
});

test("restore validates backups before replacement and clear preserves the business", () => {
  const original = JSON.parse(JSON.stringify(store));
  const changed = JSON.parse(JSON.stringify(store));
  changed.business.name = "Restored studio";
  changed.invoices[0].notes = "Restored from a backup.";
  assert.equal(restoreData(changed), store);
  assert.equal(store.business.name, "Restored studio");
  assert.equal(store.invoices[0].notes, "Restored from a backup.");
  changed.business.name = "External mutation";
  assert.equal(store.business.name, "Restored studio");
  const invalid = JSON.parse(JSON.stringify(store));
  delete invalid.invoices[0].date;
  assert.throws(() => restoreData(invalid), /Invoice date/);
  assert.equal(store.invoices[0].date, original.invoices[0].date);
  assert.equal(clearData(), store);
  assert.equal(store.business.name, "Restored studio");
  assert.deepEqual(store.invoices, []);
  assert.deepEqual(store.clients, []);
  assert.deepEqual(store.expenses, []);
  restoreData(original);
});

test("storage failures roll back restore and clear without claiming success", async () => {
  const keys = ["window", "document", "localStorage"];
  const descriptors = keys.map((key) =>
    Object.getOwnPropertyDescriptor(globalThis, key),
  );
  try {
    globalThis.window = {};
    globalThis.document = {};
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: () => null,
        setItem: () => {
          throw new Error("Quota exceeded");
        },
      },
    });
    const isolatedSource = `${source}\n// failed storage test`;
    const isolated = await import(
      `data:text/javascript;base64,${Buffer.from(isolatedSource).toString("base64")}`
    );
    const before = JSON.parse(JSON.stringify(isolated.store));
    const next = JSON.parse(JSON.stringify(before));
    next.business.name = "Should roll back";
    assert.throws(() => isolated.restoreData(next), /could not save/);
    assert.deepEqual(isolated.store, before);
    assert.throws(() => isolated.clearData(), /could not save/);
    assert.deepEqual(isolated.store, before);
    assert.match(isolated.persistenceError, /could not save/);
  } finally {
    keys.forEach((key, index) => {
      if (descriptors[index])
        Object.defineProperty(globalThis, key, descriptors[index]);
      else delete globalThis[key];
    });
  }
});

test("unavailable browser storage reports unsaved state while Node fallback remains valid", async () => {
  const keys = ["window", "document", "localStorage"];
  const descriptors = keys.map((key) =>
    Object.getOwnPropertyDescriptor(globalThis, key),
  );
  try {
    globalThis.window = {};
    globalThis.document = {};
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get: () => {
        throw new Error("Storage denied");
      },
    });
    const isolatedSource = `${source}\n// denied browser storage test`;
    const isolated = await import(
      `data:text/javascript;base64,${Buffer.from(isolatedSource).toString("base64")}`
    );
    assert.match(isolated.persistenceError, /unavailable/);
    assert.throws(() => isolated.persist(), /cannot be saved/);
    assert.throws(() => isolated.clearData(), /cannot be saved/);
    assert.equal(isolated.store.invoices.length, 12);
  } finally {
    keys.forEach((key, index) => {
      if (descriptors[index])
        Object.defineProperty(globalThis, key, descriptors[index]);
      else delete globalThis[key];
    });
  }
});

test("a corrupt saved workspace is preserved and cannot be silently overwritten", async () => {
  const originalStorage = globalThis.localStorage;
  const originalError = console.error;
  const raw = "{broken user workspace";
  let saved = raw;
  globalThis.localStorage = {
    getItem: () => saved,
    setItem: (_key, value) => {
      saved = value;
    },
  };
  console.error = () => {};
  try {
    // A distinct module instance sees the mocked browser storage during load.
    const isolatedSource = `${source}\n// corrupt workspace test`;
    const isolated = await import(
      `data:text/javascript;base64,${Buffer.from(isolatedSource).toString("base64")}`
    );
    assert.match(isolated.persistenceError, /original data is preserved/);
    assert.equal(saved, raw);
    const recovery = isolated.backupData();
    assert.equal(recovery.recovery, true);
    assert.equal(JSON.parse(recovery.content).raw, raw);
    assert.throws(() => isolated.persist(), /preserved/);
    const before = isolated.store.invoices.length;
    assert.throws(
      () => isolated.addInvoice(invoice({ number: "NEW-001" })),
      /preserved/,
    );
    assert.equal(isolated.store.invoices.length, before);
    assert.equal(saved, raw);
    assert.throws(() => isolated.restoreData(isolated.store), /preserved/);
    isolated.clearData();
    assert.equal(isolated.persistenceError, null);
    assert.equal(isolated.backupData().recovery, false);
    assert.equal(JSON.parse(saved).business.name, "Studio North");
    assert.deepEqual(JSON.parse(saved).invoices, []);
    assert.deepEqual(JSON.parse(saved).clients, []);
    assert.deepEqual(JSON.parse(saved).expenses, []);
  } finally {
    if (originalStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = originalStorage;
    console.error = originalError;
  }
});

test("stale tabs cannot overwrite invoices or clear a newer saved workspace", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "localStorage",
  );
  let saved = null;
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: () => saved,
      setItem: (_key, value) => {
        saved = value;
      },
    },
  });
  const openTab = (label) =>
    import(
      `data:text/javascript;base64,${Buffer.from(`${source}\n// concurrency ${label}`).toString("base64")}`
    );
  try {
    const first = await openTab("first");
    const stale = await openTab("stale");
    const before = JSON.parse(JSON.stringify(stale.store));
    const firstInvoice = first.addInvoice(
      invoice({ id: undefined, number: "FIRST-TAB-001" }),
    );
    const latestSaved = saved;
    assert.throws(
      () =>
        stale.addInvoice(invoice({ id: undefined, number: "STALE-TAB-001" })),
      /changed in another tab.*Reload/,
    );
    assert.equal(saved, latestSaved);
    assert.deepEqual(stale.store, before);
    assert.match(
      stale.persistenceError,
      /latest saved records have been preserved/,
    );
    for (const change of [
      () => stale.clearData(),
      () => stale.resetData(),
      () => stale.restoreData(before),
    ]) {
      assert.throws(change, /changed in another tab/);
      assert.equal(saved, latestSaved);
      assert.deepEqual(stale.store, before);
    }

    const reloaded = await openTab("reloaded");
    assert.ok(
      reloaded.store.invoices.some((item) => item.id === firstInvoice.id),
    );
    const nextInvoice = reloaded.addInvoice(
      invoice({ id: undefined, number: "RELOADED-TAB-001" }),
    );
    reloaded.updateInvoice(nextInvoice.id, { paid: 100 });
    const persisted = JSON.parse(saved);
    assert.ok(persisted.invoices.some((item) => item.id === firstInvoice.id));
    assert.equal(
      persisted.invoices.find((item) => item.id === nextInvoice.id).paid,
      100,
    );
  } finally {
    if (descriptor)
      Object.defineProperty(globalThis, "localStorage", descriptor);
    else delete globalThis.localStorage;
  }
});

test("restore rejects non-text business details before replacing or saving records", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "localStorage",
  );
  let saved = null;
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: () => saved,
      setItem: (_key, value) => {
        saved = value;
      },
    },
  });
  try {
    const isolated = await import(
      `data:text/javascript;base64,${Buffer.from(`${source}\n// business field validation`).toString("base64")}`
    );
    isolated.persist();
    const original = JSON.parse(JSON.stringify(isolated.store));
    const originalSaved = saved;
    for (const key of ["owner", "email", "address", "gstin", "phone"]) {
      const malformed = JSON.parse(JSON.stringify(original));
      malformed.business[key] = 123;
      assert.throws(
        () => isolated.restoreData(malformed),
        new RegExp(`Business ${key} must be text`),
      );
      assert.deepEqual(isolated.store, original);
      assert.equal(saved, originalSaved);
    }
  } finally {
    if (descriptor)
      Object.defineProperty(globalThis, "localStorage", descriptor);
    else delete globalThis.localStorage;
  }
});
