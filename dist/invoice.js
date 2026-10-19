import {
  store,
  money,
  calculate,
  status,
  invoiceNumber,
  addInvoice,
  updateInvoice,
  deleteInvoice,
  today,
} from "./data.js";

const esc = (value = "") =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const dateLabel = (value) =>
  value
    ? new Date(`${value}T12:00:00`).toLocaleDateString("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "—";
const number = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);
const round = (value) => Math.round((value + Number.EPSILON) * 100) / 100;

function mountDialog(className, content) {
  const dialog = document.createElement("dialog");
  dialog.className = `inv-dialog ${className}`;
  dialog.innerHTML = content;
  const heading = dialog.querySelector("h2");
  if (heading) {
    heading.id = `invoice-heading-${crypto.randomUUID()}`;
    dialog.setAttribute("aria-labelledby", heading.id);
  }
  document.body.append(dialog);
  const cleanup = () => {
    dialog.remove();
    document.body.classList.toggle(
      "inv-modal-open",
      !!document.querySelector(".inv-dialog[open]"),
    );
  };
  dialog.addEventListener("close", cleanup, { once: true });
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) {
      const rect = dialog.getBoundingClientRect();
      if (
        event.clientX < rect.left ||
        event.clientX > rect.right ||
        event.clientY < rect.top ||
        event.clientY > rect.bottom
      )
        dialog.close();
    }
  });
  dialog
    .querySelectorAll("[data-inv-close]")
    .forEach((button) =>
      button.addEventListener("click", () => dialog.close()),
    );
  document.body.classList.add("inv-modal-open");
  dialog.showModal();
  return dialog;
}

const closeIcon =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>';
const plusIcon =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
const trashIcon =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 10v7M14 10v7"/></svg>';

export function openInvoiceEditor({
  invoiceId = null,
  clientId = null,
  onSave = () => {},
} = {}) {
  const original = invoiceId
    ? store.invoices.find((invoice) => invoice.id === invoiceId)
    : null;
  if (invoiceId && !original) return;
  const due = new Date(`${today()}T12:00:00Z`);
  due.setUTCDate(due.getUTCDate() + 15);
  const draft = original
    ? structuredClone(original)
    : {
        number: invoiceNumber(),
        clientId: store.clients.some((client) => client.id === clientId)
          ? clientId
          : "",
        date: today(),
        dueDate: due.toISOString().slice(0, 10),
        items: [{ description: "", quantity: 1, rate: 0 }],
        taxRate: 18,
        discount: 0,
        paid: 0,
        stage: "draft",
        notes: "Thank you for your business. It’s a pleasure working with you.",
      };
  if (!draft.items?.length)
    draft.items = [{ description: "", quantity: 1, rate: 0 }];
  const dialog = mountDialog(
    "inv-editor",
    `
    <form class="inv-form">
      <header class="inv-dialog-header"><div><span class="inv-eyebrow">SALES / INVOICES</span><h2>${original ? "Edit invoice" : "Create an invoice"}</h2><p>Make your next great piece of business official.</p></div><button type="button" class="inv-icon-button" data-inv-close aria-label="Close invoice editor">${closeIcon}</button></header>
      <div class="inv-editor-body">
        <section class="inv-details-grid">
          <div class="inv-bill-card"><label for="inv-client">Bill to <span class="inv-required">*</span></label><select id="inv-client" name="clientId" required><option value="">Select a client</option>${store.clients.map((client) => `<option value="${esc(client.id)}" ${client.id === draft.clientId ? "selected" : ""}>${esc(client.name)}</option>`).join("")}</select><div class="inv-client-details"></div>${!store.clients.length ? '<p class="inv-field-hint">Add a client from Clients before creating an invoice.</p>' : ""}</div>
          <div class="inv-meta-grid"><div class="inv-field"><label for="inv-number">Invoice number <span class="inv-required">*</span></label><input id="inv-number" name="number" value="${esc(draft.number)}" required maxlength="40" /></div><div class="inv-field"><label for="inv-date">Invoice date <span class="inv-required">*</span></label><input id="inv-date" name="date" type="date" value="${esc(draft.date)}" required /></div><div class="inv-field"><label for="inv-due">Due date <span class="inv-required">*</span></label><input id="inv-due" name="dueDate" type="date" value="${esc(draft.dueDate)}" required /></div></div>
        </section>
        <section class="inv-line-section"><div class="inv-section-heading"><h3>Items & services</h3><span>All amounts in INR</span></div><div class="inv-line-scroll"><div class="inv-line-head"><span>ITEM DESCRIPTION</span><span>QTY</span><span>RATE</span><span>AMOUNT</span><span></span></div><div class="inv-lines"></div></div><button type="button" class="inv-add-item">${plusIcon} Add line item</button></section>
        <div class="inv-bottom-grid"><div class="inv-notes-block"><label for="inv-notes">Notes & payment details</label><textarea id="inv-notes" name="notes" rows="4" maxlength="3000" placeholder="A thank you, payment instructions, or anything else your client should know.">${esc(draft.notes)}</textarea><p class="inv-field-hint">These notes will appear on the invoice.</p></div><div class="inv-editor-summary"><div class="inv-total-line"><span>Subtotal</span><strong data-total="subtotal"></strong></div><div class="inv-total-line inv-adjustment"><label for="inv-discount">Discount <span>₹</span></label><input id="inv-discount" name="discount" type="number" min="0" step="0.01" value="${number(draft.discount)}" /></div><div class="inv-total-line inv-adjustment"><label for="inv-tax">Tax <span>%</span></label><input id="inv-tax" name="taxRate" type="number" min="0" max="100" step="0.01" value="${number(draft.taxRate)}" /></div><div class="inv-total-line inv-tax-amount"><span>Tax amount</span><span data-total="tax"></span></div><div class="inv-grand-total"><span>Total amount</span><strong data-total="total"></strong></div>${number(draft.paid) > 0 ? `<div class="inv-total-line inv-paid-line"><span>Payment received</span><span>${money(draft.paid)}</span></div>` : ""}</div></div>
        <p class="inv-form-error" role="alert" hidden></p>
      </div>
      <footer class="inv-dialog-footer"><span class="inv-footer-note"><span class="inv-lock-dot"></span> Your invoice is saved on this device</span><div><button type="button" class="inv-button inv-button-plain" data-inv-close>Cancel</button><button type="submit" name="saveAction" value="draft" class="inv-button inv-button-secondary">Save as draft</button><button type="submit" name="saveAction" value="sent" class="inv-button inv-button-primary">${original ? "Save changes" : "Create invoice"} <span aria-hidden="true">↗</span></button></div></footer>
    </form>`,
  );
  const form = dialog.querySelector("form");
  const lines = dialog.querySelector(".inv-lines");
  const error = dialog.querySelector(".inv-form-error");
  const renderClient = () => {
    const client = store.clients.find(
      (item) => item.id === form.elements.clientId.value,
    );
    dialog.querySelector(".inv-client-details").innerHTML = client
      ? `<strong>${esc(client.contact || client.name)}</strong>${client.email ? `<span>${esc(client.email)}</span>` : ""}${client.address ? `<span>${esc(client.address)}</span>` : ""}${client.gstin ? `<span>GSTIN: ${esc(client.gstin)}</span>` : ""}`
      : "<span>Your client’s details will appear here.</span>";
  };
  function readDraft() {
    const items = [...lines.querySelectorAll(".inv-line")].map((row) => ({
      description: row.querySelector('[data-field="description"]').value.trim(),
      quantity: number(row.querySelector('[data-field="quantity"]').value),
      rate: number(row.querySelector('[data-field="rate"]').value),
    }));
    return {
      ...draft,
      number: form.elements.number.value.trim(),
      clientId: form.elements.clientId.value,
      date: form.elements.date.value,
      dueDate: form.elements.dueDate.value,
      items,
      taxRate: number(form.elements.taxRate.value),
      discount: number(form.elements.discount.value),
      notes: form.elements.notes.value.trim(),
    };
  }
  function updateTotals() {
    const current = readDraft();
    // During editing a line can be empty, or a discount can briefly exceed the
    // subtotal. Keep the preview useful while submission validates the values.
    const safeItems = current.items.map((item) => ({
      ...item,
      quantity: Math.max(0, item.quantity),
      rate: Math.max(0, item.rate),
    }));
    const subtotal = safeItems.reduce(
      (sum, item) => sum + round(item.quantity * item.rate),
      0,
    );
    try {
      const totals = calculate({
        ...current,
        items: safeItems,
        discount: Math.min(Math.max(0, current.discount), subtotal),
        taxRate: Math.min(100, Math.max(0, current.taxRate)),
        paid: 0,
      });
      dialog.querySelectorAll("[data-total]").forEach((element) => {
        element.textContent = money(totals[element.dataset.total]);
      });
    } catch {
      dialog.querySelectorAll("[data-total]").forEach((element) => {
        element.textContent = "—";
      });
    }
    lines.querySelectorAll(".inv-line").forEach((row, index) => {
      const amount = current.items[index].quantity * current.items[index].rate;
      row.querySelector(".inv-line-amount").textContent = Number.isFinite(
        amount,
      )
        ? money(amount)
        : "—";
    });
    lines.querySelectorAll("[data-remove-line]").forEach((button) => {
      button.disabled = current.items.length <= 1;
    });
  }
  function renderLines() {
    lines.innerHTML = draft.items
      .map(
        (item, index) =>
          `<div class="inv-line"><input aria-label="Item ${index + 1} description" data-field="description" value="${esc(item.description)}" placeholder="Describe your item or service" required maxlength="300" /><input aria-label="Item ${index + 1} quantity" data-field="quantity" type="number" min="0.01" step="0.01" value="${number(item.quantity)}" required /><div class="inv-rate-input"><span>₹</span><input aria-label="Item ${index + 1} rate" data-field="rate" type="number" min="0" step="0.01" value="${number(item.rate)}" required /></div><strong class="inv-line-amount"></strong><button type="button" class="inv-icon-button inv-remove-item" data-remove-line="${index}" aria-label="Remove item ${index + 1}">${trashIcon}</button></div>`,
      )
      .join("");
    updateTotals();
  }
  lines.addEventListener("input", updateTotals);
  lines.addEventListener("click", (event) => {
    const button = event.target.closest("[data-remove-line]");
    if (!button || lines.children.length <= 1) return;
    draft.items = readDraft().items;
    draft.items.splice(number(button.dataset.removeLine), 1);
    renderLines();
  });
  dialog.querySelector(".inv-add-item").addEventListener("click", () => {
    draft.items = [
      ...readDraft().items,
      { description: "", quantity: 1, rate: 0 },
    ];
    renderLines();
    lines.lastElementChild.querySelector("input").focus();
  });
  form.elements.clientId.addEventListener("change", renderClient);
  form.elements.discount.addEventListener("input", updateTotals);
  form.elements.taxRate.addEventListener("input", updateTotals);
  form.elements.date.addEventListener("change", () => {
    form.elements.dueDate.min = form.elements.date.value;
  });
  form.elements.dueDate.min = form.elements.date.value;
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const fields = readDraft();
    const fail = (message) => {
      error.textContent = message;
      error.hidden = false;
      error.scrollIntoView({ block: "nearest", behavior: "smooth" });
    };
    if (
      !fields.number ||
      !store.clients.some((client) => client.id === fields.clientId)
    )
      return fail("Choose a client and enter an invoice number.");
    if (!fields.date || !fields.dueDate || fields.dueDate < fields.date)
      return fail("The due date must be on or after the invoice date.");
    if (
      store.invoices.some(
        (invoice) =>
          invoice.number.toLowerCase() === fields.number.toLowerCase() &&
          invoice.id !== invoiceId,
      )
    )
      return fail(
        "That invoice number is already in use. Choose a unique number.",
      );
    if (
      fields.items.some(
        (item) =>
          !item.description ||
          !Number.isFinite(item.quantity) ||
          item.quantity <= 0 ||
          !Number.isFinite(item.rate) ||
          item.rate < 0,
      )
    )
      return fail(
        "Give every item a description, a positive quantity, and a rate of zero or more.",
      );
    if (fields.discount < 0 || fields.taxRate < 0 || fields.taxRate > 100)
      return fail(
        "Discount cannot be negative, and tax must be between 0 and 100%.",
      );
    fields.stage = event.submitter?.value === "draft" ? "draft" : "sent";
    try {
      calculate(fields);
      const saved = original
        ? updateInvoice(original.id, fields)
        : addInvoice(fields);
      const invoice =
        (typeof saved === "object" && saved) ||
        store.invoices.find((item) => item.id === (original?.id || saved)) ||
        store.invoices.find((item) => item.number === fields.number);
      dialog.close();
      onSave(invoice);
    } catch (cause) {
      fail(
        cause?.message || "The invoice could not be saved. Please try again.",
      );
    }
  });
  renderClient();
  renderLines();
  return dialog;
}

function invoiceDocument(invoice) {
  const client = store.clients.find((item) => item.id === invoice.clientId) || {
    name: "Client removed",
  };
  const business = store.business || {};
  const totals = calculate(invoice);
  return `<article class="inv-paper">
    <div class="inv-paper-top"><div class="inv-paper-brand"><div class="inv-brand-monogram">${esc((business.name || "F").slice(0, 1).toUpperCase())}</div><strong>${esc(business.name || "Your business")}</strong></div><span class="inv-paper-label">INVOICE</span></div>
    <div class="inv-paper-addresses"><div><h4>FROM</h4><strong>${esc(business.name || "Your business")}</strong>${business.address ? `<p>${esc(business.address).replace(/\n/g, "<br>")}</p>` : ""}${business.email ? `<p>${esc(business.email)}</p>` : ""}${business.phone ? `<p>${esc(business.phone)}</p>` : ""}${business.gstin ? `<p>GSTIN: ${esc(business.gstin)}</p>` : ""}</div><div><h4>BILL TO</h4><strong>${esc(client.name)}</strong>${client.contact ? `<p>${esc(client.contact)}</p>` : ""}${client.address ? `<p>${esc(client.address).replace(/\n/g, "<br>")}</p>` : ""}${client.email ? `<p>${esc(client.email)}</p>` : ""}${client.gstin ? `<p>GSTIN: ${esc(client.gstin)}</p>` : ""}</div><div class="inv-paper-meta"><h4>INVOICE DETAILS</h4><p><span>Invoice no.</span><strong>${esc(invoice.number)}</strong></p><p><span>Issued</span><strong>${dateLabel(invoice.date)}</strong></p><p><span>Due date</span><strong>${dateLabel(invoice.dueDate)}</strong></p></div></div>
    <table class="inv-paper-table"><thead><tr><th>DESCRIPTION</th><th>QTY</th><th>RATE</th><th>AMOUNT</th></tr></thead><tbody>${invoice.items.map((item) => `<tr><td>${esc(item.description).replace(/\n/g, "<br>")}</td><td>${esc(item.quantity)}</td><td>${money(item.rate)}</td><td>${money(item.quantity * item.rate)}</td></tr>`).join("")}</tbody></table>
    <div class="inv-paper-summary"><div><span>Subtotal</span><span>${money(totals.subtotal)}</span></div>${number(invoice.discount) ? `<div><span>Discount</span><span>− ${money(totals.discount ?? invoice.discount)}</span></div>` : ""}<div><span>Tax (${number(invoice.taxRate)}%)</span><span>${money(totals.tax)}</span></div><div class="inv-paper-total"><strong>Total</strong><strong>${money(totals.total)}</strong></div>${number(totals.paid) > 0 ? `<div><span>Amount paid</span><span>− ${money(totals.paid)}</span></div>` : ""}<div class="inv-paper-balance"><strong>Balance due</strong><strong>${money(totals.balance)}</strong></div></div>
    ${invoice.notes ? `<div class="inv-paper-notes"><h4>NOTES & PAYMENT DETAILS</h4><p>${esc(invoice.notes).replace(/\n/g, "<br>")}</p></div>` : ""}<div class="inv-paper-footer"><span>Thank you for your business.</span><span>${esc(business.name || "Your business")} · ${esc(invoice.number)}</span></div>
  </article>`;
}

function printInvoice(invoice) {
  const frame = document.createElement("iframe");
  frame.className = "inv-print-frame";
  frame.setAttribute("title", `Print invoice ${invoice.number}`);
  document.body.append(frame);
  const stylesheet = new URL("./invoice.css", import.meta.url).href;
  const doc = frame.contentDocument;
  doc.open();
  doc.write(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(invoice.number)} - Invoice</title><link rel="stylesheet" href="${esc(stylesheet)}"><style>html,body{margin:0;background:white;font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#202725}.inv-paper{box-shadow:none!important;margin:0!important;max-width:none!important;width:100%!important;min-height:0!important;padding:12mm!important;box-sizing:border-box}@page{size:A4;margin:8mm}@media print{.inv-paper{border:0!important}body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}</style></head><body>${invoiceDocument(invoice)}</body></html>`,
  );
  doc.close();
  let printed = false;
  const run = () => {
    if (printed || !frame.isConnected) return;
    printed = true;
    frame.contentWindow.addEventListener("afterprint", () => frame.remove(), {
      once: true,
    });
    frame.contentWindow.focus();
    frame.contentWindow.print();
    // Some browsers do not dispatch afterprint for an iframe. Keep the print
    // document alive long enough for their print preview to finish rendering.
    window.setTimeout(() => frame.remove(), 60000);
  };
  frame.onload = run;
  window.setTimeout(run, 700);
}

export function openInvoicePreview(invoiceId, { onChange = () => {} } = {}) {
  const invoice = store.invoices.find((item) => item.id === invoiceId);
  if (!invoice) return;
  const totals = calculate(invoice);
  const invoiceStatus = status(invoice);
  const dialog = mountDialog(
    "inv-preview",
    `<header class="inv-preview-header"><div><span class="inv-eyebrow">INVOICE DETAILS</span><div class="inv-preview-title"><h2>${esc(invoice.number)}</h2><span class="inv-status inv-status-${esc(invoiceStatus.toLowerCase().replace(/\s+/g, "-"))}">${esc(invoiceStatus)}</span></div></div><button type="button" class="inv-icon-button" data-inv-close aria-label="Close invoice preview">${closeIcon}</button></header><div class="inv-preview-toolbar"><span class="inv-preview-balance">Balance due <strong>${money(totals.balance)}</strong></span><div><button class="inv-button inv-button-secondary" data-edit>Edit invoice</button><button class="inv-button inv-button-secondary" data-print><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M7 8V3h10v5M7 17H4V9h16v8h-3M7 14h10v7H7zM17 11h.01"/></svg> Print / PDF</button>${totals.balance > 0 ? '<button class="inv-button inv-button-primary" data-payment>Record payment <span aria-hidden="true">↗</span></button>' : '<span class="inv-paid-badge">✓ Paid in full</span>'}</div></div><div class="inv-preview-canvas">${invoiceDocument(invoice)}</div><footer class="inv-preview-footer"><button class="inv-button inv-button-danger" data-delete>${trashIcon} Delete invoice</button>${invoice.stage === "draft" ? '<button class="inv-button inv-button-secondary" data-mark-sent>Mark as issued</button>' : '<span class="inv-field-hint">Keep a copy for your records with Print / PDF.</span>'}</footer>`,
  );
  const refresh = () => {
    dialog.close();
    onChange();
    openInvoicePreview(invoiceId, { onChange });
  };
  const fail = (message) => {
    let alert = dialog.querySelector(".inv-preview-error");
    if (!alert) {
      alert = document.createElement("p");
      alert.className = "inv-form-error inv-preview-error";
      alert.setAttribute("role", "alert");
      dialog.querySelector(".inv-preview-toolbar").after(alert);
    }
    alert.textContent = message;
  };
  dialog.querySelector("[data-edit]").addEventListener("click", () => {
    dialog.close();
    openInvoiceEditor({
      invoiceId,
      onSave: () => {
        onChange();
        openInvoicePreview(invoiceId, { onChange });
      },
    });
  });
  dialog
    .querySelector("[data-print]")
    .addEventListener("click", () => printInvoice(invoice));
  dialog.querySelector("[data-mark-sent]")?.addEventListener("click", () => {
    try {
      updateInvoice(invoiceId, { stage: "sent" });
      refresh();
    } catch (cause) {
      fail(
        cause.message || "The invoice could not be updated. Please try again.",
      );
    }
  });
  dialog.querySelector("[data-payment]")?.addEventListener("click", () => {
    const paymentDialog = mountDialog(
      "inv-small-dialog",
      `<form class="inv-payment-form"><header class="inv-small-header"><div><span class="inv-eyebrow">PAYMENTS</span><h2>Record a payment</h2></div><button type="button" class="inv-icon-button" data-inv-close aria-label="Close payment dialog">${closeIcon}</button></header><div class="inv-small-body"><p>Record money you’ve already received for <strong>${esc(invoice.number)}</strong>.</p><div class="inv-payment-balance"><span>Outstanding balance</span><strong>${money(totals.balance)}</strong></div><label for="inv-payment-amount">Amount received (₹)</label><input id="inv-payment-amount" name="amount" type="number" min="0.01" max="${round(totals.balance)}" step="0.01" value="${round(totals.balance)}" required /><p class="inv-field-hint">You can record the full balance or a partial payment.</p><p class="inv-form-error" role="alert" hidden></p></div><footer class="inv-small-footer"><button type="button" class="inv-button inv-button-secondary" data-inv-close>Cancel</button><button type="submit" class="inv-button inv-button-primary">Record payment</button></footer></form>`,
    );
    paymentDialog.querySelector("form").addEventListener("submit", (event) => {
      event.preventDefault();
      const amount = number(
        paymentDialog.querySelector('[name="amount"]').value,
      );
      const latest = store.invoices.find((item) => item.id === invoiceId);
      const currentBalance = latest ? calculate(latest).balance : 0;
      if (!(amount > 0) || amount > round(currentBalance)) {
        const alert = paymentDialog.querySelector(".inv-form-error");
        alert.textContent =
          "Enter an amount greater than zero and no more than the outstanding balance.";
        alert.hidden = false;
        return;
      }
      try {
        updateInvoice(invoiceId, {
          paid: round(number(latest.paid) + amount),
          stage: "sent",
        });
        paymentDialog.close();
        refresh();
      } catch (cause) {
        const alert = paymentDialog.querySelector(".inv-form-error");
        alert.textContent =
          cause.message || "The payment could not be saved. Please try again.";
        alert.hidden = false;
      }
    });
  });
  dialog.querySelector("[data-delete]").addEventListener("click", () => {
    const confirmation = mountDialog(
      "inv-small-dialog",
      `<div><header class="inv-small-header"><div><span class="inv-eyebrow">DELETE INVOICE</span><h2>Delete ${esc(invoice.number)}?</h2></div><button type="button" class="inv-icon-button" data-inv-close aria-label="Cancel deletion">${closeIcon}</button></header><div class="inv-small-body"><p>This will permanently delete this invoice${number(invoice.paid) > 0 ? " and its recorded payments" : ""} from this device. This action cannot be undone.</p></div><footer class="inv-small-footer"><button class="inv-button inv-button-secondary" data-inv-close>Keep invoice</button><button class="inv-button inv-button-delete" data-confirm-delete>Delete invoice</button></footer></div>`,
    );
    confirmation
      .querySelector("[data-confirm-delete]")
      .addEventListener("click", () => {
        try {
          deleteInvoice(invoiceId);
          confirmation.close();
          dialog.close();
          onChange();
        } catch (cause) {
          let alert = confirmation.querySelector(".inv-form-error");
          if (!alert) {
            alert = document.createElement("p");
            alert.className = "inv-form-error";
            alert.setAttribute("role", "alert");
            confirmation.querySelector(".inv-small-body").append(alert);
          }
          alert.textContent =
            cause.message ||
            "The invoice could not be deleted. Please try again.";
        }
      });
  });
  return dialog;
}
