'use strict';

/* ---------- Storage ---------- */

const STORAGE_KEY = 'inventory-system:v1';

function emptyData() {
  return { products: [], movements: [], settings: { businessName: 'Inventory', currency: '$' } };
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyData();
    const data = JSON.parse(raw);
    return {
      products: Array.isArray(data.products) ? data.products : [],
      movements: Array.isArray(data.movements) ? data.movements : [],
      settings: { ...emptyData().settings, ...(data.settings || {}) },
    };
  } catch (e) {
    console.error('Could not read saved data', e);
    return emptyData();
  }
}

let db = load();

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
  } catch (e) {
    toast('Could not save. Storage may be full or blocked.');
  }
}

// Ask the browser not to evict our data (Safari clears unused site data otherwise).
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

/* ---------- Helpers ---------- */

const $ = (sel, root = document) => root.querySelector(sel);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const num = (v) => { const n = parseFloat(String(v).replace(',', '.')); return Number.isFinite(n) ? n : 0; };
const round = (n) => Math.round(n * 1000) / 1000;

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function money(n) {
  const v = (Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return db.settings.currency + v;
}

function qtyFmt(n) {
  return (Number(n) || 0).toLocaleString(undefined, { maximumFractionDigits: 3 });
}

function dateFmt(iso, withTime = true) {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return withTime
    ? d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function localInputValue(date = new Date()) {
  const d = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return d.toISOString().slice(0, 16);
}

function status(p) {
  if (p.qty <= 0) return 'out';
  if (p.minQty > 0 && p.qty <= p.minQty) return 'low';
  return 'ok';
}
const STATUS_LABEL = { ok: 'In stock', low: 'Low stock', out: 'Out of stock' };
const TYPE_LABEL = { in: 'Stock in', out: 'Stock out', adjust: 'Adjust' };

function badge(p) {
  const s = status(p);
  return `<span class="badge ${s}">${STATUS_LABEL[s]}</span>`;
}

function categories() {
  return [...new Set(db.products.map((p) => p.category).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function productById(id) { return db.products.find((p) => p.id === id); }

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

function download(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function today() { return new Date().toISOString().slice(0, 10); }

/* ---------- CSV ---------- */

function toCSV(rows) {
  return rows.map((r) => r.map((v) => {
    const s = String(v ?? '');
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }).join(',')).join('\r\n');
}

function parseCSV(text) {
  text = text.replace(/^﻿/, '');
  const delim = (text.split('\n')[0].match(/;/g) || []).length > (text.split('\n')[0].match(/,/g) || []).length ? ';' : ',';
  const rows = []; let row = []; let field = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((v) => v.trim() !== ''));
}

const CSV_COLUMNS = ['name', 'sku', 'category', 'unit', 'qty', 'minQty', 'cost', 'price', 'location', 'supplier', 'notes'];
const CSV_HEADERS = ['Name', 'SKU', 'Category', 'Unit', 'Quantity', 'Low stock at', 'Cost', 'Price', 'Location', 'Supplier', 'Notes'];
const HEADER_ALIASES = {
  name: ['name', 'product', 'item', 'product name', 'item name'],
  sku: ['sku', 'code', 'barcode', 'item code', 'product code'],
  category: ['category', 'group', 'type'],
  unit: ['unit', 'uom'],
  qty: ['quantity', 'qty', 'stock', 'on hand', 'count'],
  minQty: ['low stock at', 'min', 'min qty', 'minimum', 'reorder level', 'reorder point', 'minqty'],
  cost: ['cost', 'unit cost', 'buy price', 'purchase price'],
  price: ['price', 'sale price', 'sell price', 'selling price', 'unit price'],
  location: ['location', 'shelf', 'bin', 'warehouse'],
  supplier: ['supplier', 'vendor'],
  notes: ['notes', 'note', 'description', 'comments'],
};

/* ---------- Data operations ---------- */

function normalizeProduct(p) {
  return {
    id: p.id || uid(),
    name: String(p.name || '').trim(),
    sku: String(p.sku || '').trim(),
    category: String(p.category || '').trim(),
    unit: String(p.unit || '').trim() || 'pcs',
    qty: round(num(p.qty)),
    minQty: round(num(p.minQty)),
    cost: num(p.cost),
    price: num(p.price),
    location: String(p.location || '').trim(),
    supplier: String(p.supplier || '').trim(),
    notes: String(p.notes || '').trim(),
    createdAt: p.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function recordMovement(product, type, amount, note, dateISO) {
  const before = product.qty;
  let after;
  if (type === 'in') after = before + amount;
  else if (type === 'out') after = before - amount;
  else after = amount; // adjust: set the count
  after = round(after);
  const m = {
    id: uid(),
    productId: product.id,
    productName: product.name,
    sku: product.sku,
    type,
    change: round(after - before),
    before, after,
    note: note || '',
    date: dateISO || new Date().toISOString(),
  };
  product.qty = after;
  product.updatedAt = new Date().toISOString();
  db.movements.push(m);
  return m;
}

/* ---------- Routing ---------- */

const VIEWS = { dashboard: 'Dashboard', products: 'Products', history: 'History', settings: 'Data & settings' };
let currentView = 'dashboard';
const ui = {
  search: '', category: '', status: '', sort: 'name', dir: 1,
  hSearch: '', hType: '', hProduct: '', hFrom: '', hTo: '', hLimit: 100,
};

function route() {
  const hash = location.hash.slice(1);
  const [view, query] = hash.split('?');
  currentView = VIEWS[view] ? view : 'dashboard';
  if (query) {
    const params = new URLSearchParams(query);
    if (currentView === 'products') ui.status = params.get('status') || '';
    if (currentView === 'history') ui.hProduct = params.get('product') || '';
  }
  render();
}
window.addEventListener('hashchange', route);

function render() {
  document.title = db.settings.businessName || 'Inventory';
  $('#brandName').textContent = db.settings.businessName || 'Inventory';
  $('#viewTitle').textContent = VIEWS[currentView];
  document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.view === currentView));
  const view = $('#view');
  if (currentView === 'dashboard') view.innerHTML = renderDashboard();
  else if (currentView === 'products') view.innerHTML = renderProducts();
  else if (currentView === 'history') view.innerHTML = renderHistory();
  else view.innerHTML = renderSettings();
  bindView();
}

/* ---------- Dashboard ---------- */

function renderDashboard() {
  const P = db.products;
  if (!P.length) {
    return `<div class="card empty-big">
      <h2 style="justify-content:center">Welcome</h2>
      <p>Add your first product to start tracking stock, or load some sample data to look around.</p>
      <div class="btn-row" style="justify-content:center">
        <button class="btn primary" data-act="add">Add product</button>
        <button class="btn" data-act="import-csv">Import from CSV / Excel</button>
        <button class="btn" data-act="sample">Load sample data</button>
      </div></div>`;
  }
  const units = P.reduce((s, p) => s + Math.max(0, p.qty), 0);
  const value = P.reduce((s, p) => s + Math.max(0, p.qty) * (p.cost || 0), 0);
  const retail = P.reduce((s, p) => s + Math.max(0, p.qty) * (p.price || 0), 0);
  const low = P.filter((p) => status(p) === 'low');
  const out = P.filter((p) => status(p) === 'out');
  const attention = [...out, ...low].slice(0, 8);
  const recent = db.movements.slice().sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8);

  const since = new Date(Date.now() - 30 * 864e5).toISOString();
  const last30 = db.movements.filter((m) => m.date >= since);
  const in30 = last30.filter((m) => m.change > 0).reduce((s, m) => s + m.change, 0);
  const out30 = last30.filter((m) => m.change < 0).reduce((s, m) => s - m.change, 0);

  return `
  <div class="grid-stats">
    <a class="card stat" href="#products"><div class="label">Products</div><div class="value">${P.length.toLocaleString()}</div></a>
    <div class="card stat"><div class="label">Units in stock</div><div class="value">${qtyFmt(units)}</div></div>
    <a class="card stat ${low.length ? 'warn' : ''}" href="#products?status=low"><div class="label">Low stock</div><div class="value">${low.length}</div></a>
    <a class="card stat ${out.length ? 'bad' : ''}" href="#products?status=out"><div class="label">Out of stock</div><div class="value">${out.length}</div></a>
    <div class="card stat"><div class="label">Stock value (cost)</div><div class="value">${money(value)}</div></div>
    <div class="card stat"><div class="label">Stock value (price)</div><div class="value">${money(retail)}</div></div>
    <div class="card stat"><div class="label">In, last 30 days</div><div class="value">${qtyFmt(in30)}</div></div>
    <div class="card stat"><div class="label">Out, last 30 days</div><div class="value">${qtyFmt(out30)}</div></div>
  </div>
  <div class="two-col">
    <div class="card">
      <h2>Needs attention <a href="#products?status=attention">See all</a></h2>
      ${attention.length ? `<ul class="list">${attention.map((p) => `
        <li data-open="${p.id}" style="cursor:pointer">
          <div class="grow"><div class="title">${esc(p.name)}</div>
          <div class="sub">${qtyFmt(p.qty)} ${esc(p.unit)} left${p.minQty ? ` · low at ${qtyFmt(p.minQty)}` : ''}</div></div>
          ${badge(p)}
          <button class="btn small in" data-move="in" data-id="${p.id}">+ In</button>
        </li>`).join('')}</ul>` : '<div class="empty">Everything is stocked.</div>'}
    </div>
    <div class="card">
      <h2>Recent activity <a href="#history">See all</a></h2>
      ${recent.length ? `<ul class="list">${recent.map(movementLi).join('')}</ul>` : '<div class="empty">No stock movements yet.</div>'}
    </div>
  </div>`;
}

function movementLi(m) {
  const cls = m.change >= 0 ? 'delta-pos' : 'delta-neg';
  const sign = m.change > 0 ? '+' : '';
  return `<li>
    <div class="grow"><div class="title">${esc(m.productName)}</div>
    <div class="sub">${TYPE_LABEL[m.type]} · ${dateFmt(m.date)}${m.note ? ' · ' + esc(m.note) : ''}</div></div>
    <span class="${cls} nowrap">${sign}${qtyFmt(m.change)}</span>
  </li>`;
}

/* ---------- Products ---------- */

function filteredProducts() {
  const q = ui.search.trim().toLowerCase();
  let list = db.products.filter((p) => {
    if (ui.category && p.category !== ui.category) return false;
    const s = status(p);
    if (ui.status === 'attention' && s === 'ok') return false;
    if (ui.status && ui.status !== 'attention' && s !== ui.status) return false;
    if (q) {
      const hay = [p.name, p.sku, p.category, p.location, p.supplier, p.notes].join(' ').toLowerCase();
      return q.split(/\s+/).every((w) => hay.includes(w));
    }
    return true;
  });
  const k = ui.sort, d = ui.dir;
  list.sort((a, b) => {
    let va = a[k], vb = b[k];
    if (k === 'value') { va = a.qty * a.cost; vb = b.qty * b.cost; }
    if (typeof va === 'number' || typeof vb === 'number') return ((va || 0) - (vb || 0)) * d;
    return String(va || '').localeCompare(String(vb || ''), undefined, { numeric: true, sensitivity: 'base' }) * d;
  });
  return list;
}

function renderProducts() {
  if (!db.products.length) {
    return `<div class="card empty-big"><h2 style="justify-content:center">No products yet</h2>
      <p>Add products one by one, or import a list from a CSV file (Excel can save as CSV).</p>
      <div class="btn-row" style="justify-content:center">
        <button class="btn primary" data-act="add">Add product</button>
        <button class="btn" data-act="import-csv">Import CSV</button>
      </div></div>`;
  }
  const cats = categories();
  const list = filteredProducts();
  const th = (key, label, cls = '') => {
    const arrow = ui.sort === key ? `<span class="arrow">${ui.dir > 0 ? '▲' : '▼'}</span>` : '';
    return `<th class="${cls}" data-sort="${key}">${label} ${arrow}</th>`;
  };
  return `
  <div class="toolbar">
    <div class="search">
      <svg viewBox="0 0 24 24"><path d="M15.5 14h-.8l-.3-.3A6.5 6.5 0 1 0 14 15.5l.3.3v.8l5 5 1.5-1.5zm-6 0a4.5 4.5 0 1 1 0-9 4.5 4.5 0 0 1 0 9z"/></svg>
      <input class="input" id="search" type="search" placeholder="Search name, SKU, location…" value="${esc(ui.search)}" autocomplete="off">
    </div>
    <select id="catFilter" aria-label="Category">
      <option value="">All categories</option>
      ${cats.map((c) => `<option ${c === ui.category ? 'selected' : ''}>${esc(c)}</option>`).join('')}
    </select>
    <select id="statusFilter" aria-label="Stock status">
      <option value="">Any stock</option>
      <option value="attention" ${ui.status === 'attention' ? 'selected' : ''}>Low or out</option>
      <option value="ok" ${ui.status === 'ok' ? 'selected' : ''}>In stock</option>
      <option value="low" ${ui.status === 'low' ? 'selected' : ''}>Low stock</option>
      <option value="out" ${ui.status === 'out' ? 'selected' : ''}>Out of stock</option>
    </select>
    <select id="sortSel" aria-label="Sort" class="sort-mobile">
      ${[['name', 'Name'], ['sku', 'SKU'], ['category', 'Category'], ['qty', 'Quantity'], ['value', 'Value'], ['updatedAt', 'Last updated']]
        .map(([k, l]) => `<option value="${k}" ${ui.sort === k ? 'selected' : ''}>Sort: ${l}</option>`).join('')}
    </select>
  </div>
  <div class="count">${list.length} of ${db.products.length} products</div>
  ${list.length ? '' : '<div class="card empty">No products match these filters.</div>'}
  ${list.length ? `
  <div class="card ptable"><div class="table-wrap"><table>
    <thead><tr>
      ${th('name', 'Product')}${th('category', 'Category')}${th('location', 'Location')}
      ${th('qty', 'Qty', 'num')}${th('price', 'Price', 'num')}${th('value', 'Value', 'num')}
      <th class="nosort">Status</th><th class="nosort"></th>
    </tr></thead>
    <tbody>${list.map((p) => `
      <tr data-open="${p.id}">
        <td><div class="pname">${esc(p.name)}</div>${p.sku ? `<div class="psku">${esc(p.sku)}</div>` : ''}</td>
        <td>${esc(p.category)}</td>
        <td>${esc(p.location)}</td>
        <td class="num"><b>${qtyFmt(p.qty)}</b> <span class="muted">${esc(p.unit)}</span></td>
        <td class="num">${p.price ? money(p.price) : ''}</td>
        <td class="num">${p.cost ? money(p.qty * p.cost) : ''}</td>
        <td>${badge(p)}</td>
        <td><div class="row-actions">
          <button class="btn small in" data-move="in" data-id="${p.id}" title="Stock in">+ In</button>
          <button class="btn small out" data-move="out" data-id="${p.id}" title="Stock out">− Out</button>
        </div></td>
      </tr>`).join('')}
    </tbody></table></div></div>
  <div class="pcards">${list.map((p) => `
    <div class="card pcard" data-open="${p.id}">
      <div style="min-width:0">
        <div class="pname">${esc(p.name)}</div>
        <div class="meta">${[p.sku, p.category, p.location].filter(Boolean).map(esc).join(' · ') || '&nbsp;'}</div>
        <div style="margin-top:6px">${badge(p)}</div>
      </div>
      <div class="qty">${qtyFmt(p.qty)} <small>${esc(p.unit)}</small></div>
      <div class="actions">
        <button class="btn in" data-move="in" data-id="${p.id}">+ In</button>
        <button class="btn out" data-move="out" data-id="${p.id}">− Out</button>
      </div>
    </div>`).join('')}</div>` : ''}`;
}

/* ---------- History ---------- */

function filteredMovements() {
  const q = ui.hSearch.trim().toLowerCase();
  return db.movements.filter((m) => {
    if (ui.hType && m.type !== ui.hType) return false;
    if (ui.hProduct && m.productId !== ui.hProduct) return false;
    if (ui.hFrom && m.date.slice(0, 10) < ui.hFrom) return false;
    if (ui.hTo && m.date.slice(0, 10) > ui.hTo) return false;
    if (q && !(m.productName + ' ' + (m.sku || '') + ' ' + m.note).toLowerCase().includes(q)) return false;
    return true;
  }).sort((a, b) => b.date.localeCompare(a.date));
}

function renderHistory() {
  const list = filteredMovements();
  const shown = list.slice(0, ui.hLimit);
  const prod = ui.hProduct ? productById(ui.hProduct) : null;
  const totIn = list.filter((m) => m.change > 0).reduce((s, m) => s + m.change, 0);
  const totOut = list.filter((m) => m.change < 0).reduce((s, m) => s - m.change, 0);
  return `
  <div class="toolbar">
    <div class="search">
      <svg viewBox="0 0 24 24"><path d="M15.5 14h-.8l-.3-.3A6.5 6.5 0 1 0 14 15.5l.3.3v.8l5 5 1.5-1.5zm-6 0a4.5 4.5 0 1 1 0-9 4.5 4.5 0 0 1 0 9z"/></svg>
      <input class="input" id="hSearch" type="search" placeholder="Search product or note…" value="${esc(ui.hSearch)}" autocomplete="off">
    </div>
    <select id="hType" aria-label="Type">
      <option value="">All types</option>
      ${Object.entries(TYPE_LABEL).map(([k, l]) => `<option value="${k}" ${ui.hType === k ? 'selected' : ''}>${l}</option>`).join('')}
    </select>
    <input class="input" style="width:auto" type="date" id="hFrom" value="${ui.hFrom}" aria-label="From date">
    <input class="input" style="width:auto" type="date" id="hTo" value="${ui.hTo}" aria-label="To date">
    <button class="btn" data-act="export-history">Export CSV</button>
  </div>
  ${prod ? `<div class="count">Showing <b>${esc(prod.name)}</b> only · <a href="#history" data-act="clear-hproduct">show all</a></div>` : ''}
  <div class="count">${list.length} movements · in ${qtyFmt(totIn)} · out ${qtyFmt(totOut)}</div>
  ${list.length ? `<div class="card hcards"><ul class="list">${shown.map((m) => movementLi(m).replace('<li>', `<li data-open="${m.productId}" style="cursor:pointer">`)).join('')}</ul></div>
    <div class="card htable"><div class="table-wrap"><table>
    <thead><tr><th class="nosort">Date</th><th class="nosort">Product</th><th class="nosort">Type</th>
      <th class="nosort num">Change</th><th class="nosort num">After</th><th class="nosort">Note</th></tr></thead>
    <tbody>${shown.map((m) => `
      <tr data-open="${m.productId}">
        <td class="nowrap">${dateFmt(m.date)}</td>
        <td><div class="pname">${esc(m.productName)}</div>${m.sku ? `<div class="psku">${esc(m.sku)}</div>` : ''}</td>
        <td><span class="badge ${m.type === 'in' ? 'in-t' : m.type === 'out' ? 'out-t' : 'adj-t'}">${TYPE_LABEL[m.type]}</span></td>
        <td class="num ${m.change >= 0 ? 'delta-pos' : 'delta-neg'}">${m.change > 0 ? '+' : ''}${qtyFmt(m.change)}</td>
        <td class="num">${qtyFmt(m.after)}</td>
        <td>${esc(m.note)}</td>
      </tr>`).join('')}</tbody></table></div></div>
    ${list.length > shown.length ? `<div style="text-align:center;margin-top:14px"><button class="btn" data-act="more-history">Show more (${list.length - shown.length} left)</button></div>` : ''}`
  : '<div class="card empty">No stock movements match.</div>'}`;
}

/* ---------- Settings ---------- */

function renderSettings() {
  let bytes = 0;
  try { bytes = (localStorage.getItem(STORAGE_KEY) || '').length * 2; } catch (e) { /* ignore */ }
  return `<div class="settings">
    <div class="card">
      <h2>Business</h2>
      <p>Shown at the top of the app and on exports.</p>
      <div class="fields">
        <div class="field"><label for="setName">Name</label><input id="setName" value="${esc(db.settings.businessName)}"></div>
        <div class="field"><label for="setCur">Currency symbol</label><input id="setCur" value="${esc(db.settings.currency)}" placeholder="$, €, IQD "></div>
      </div>
    </div>
    <div class="card">
      <h2>Backup</h2>
      <p>Your data is saved only in this browser on this device. Download a backup regularly, and use it to move your data to another device (phone, iPad, laptop).</p>
      <div class="btn-row">
        <button class="btn primary" data-act="backup">Download backup</button>
        <button class="btn" data-act="restore">Restore from backup</button>
      </div>
    </div>
    <div class="card">
      <h2>Spreadsheets</h2>
      <p>Export products to open in Excel or Google Sheets, or import a product list from CSV. Columns: ${CSV_HEADERS.join(', ')}. Products with the same SKU (or name) are updated.</p>
      <div class="btn-row">
        <button class="btn" data-act="export-csv">Export products (CSV)</button>
        <button class="btn" data-act="import-csv">Import products (CSV)</button>
        <button class="btn" data-act="template-csv">Download CSV template</button>
      </div>
    </div>
    <div class="card">
      <h2>Install on your device</h2>
      <p>iPhone / iPad: open in Safari, tap Share, then “Add to Home Screen”. Android / Windows: use the install icon in the address bar, or the browser menu “Install app”. After that it opens like an app and works without internet.</p>
    </div>
    <div class="card">
      <h2>Danger zone</h2>
      <p>${db.products.length} products, ${db.movements.length} movements, about ${(bytes / 1024).toFixed(0)} KB stored.</p>
      <div class="btn-row">
        <button class="btn" data-act="sample">Load sample data</button>
        <button class="btn danger" data-act="clear-history">Clear history</button>
        <button class="btn danger solid" data-act="wipe">Delete all data</button>
      </div>
    </div>
  </div>`;
}

/* ---------- View events ---------- */

function bindView() {
  const view = $('#view');
  const on = (id, ev, fn) => { const el = $('#' + id, view); if (el) el.addEventListener(ev, fn); };

  // Keep focus and caret when re-rendering on search.
  const rerenderKeepFocus = (id) => {
    const el = $('#' + id); const pos = el ? el.selectionStart : null;
    render();
    const n = $('#' + id); if (n) { n.focus(); if (pos != null) try { n.setSelectionRange(pos, pos); } catch (e) { /* ignore */ } }
  };

  on('search', 'input', (e) => { ui.search = e.target.value; rerenderKeepFocus('search'); });
  on('catFilter', 'change', (e) => { ui.category = e.target.value; render(); });
  on('statusFilter', 'change', (e) => { ui.status = e.target.value; render(); });
  on('sortSel', 'change', (e) => { ui.sort = e.target.value; ui.dir = ['qty', 'value', 'updatedAt'].includes(ui.sort) ? -1 : 1; render(); });
  on('hSearch', 'input', (e) => { ui.hSearch = e.target.value; ui.hLimit = 100; rerenderKeepFocus('hSearch'); });
  on('hType', 'change', (e) => { ui.hType = e.target.value; render(); });
  on('hFrom', 'change', (e) => { ui.hFrom = e.target.value; render(); });
  on('hTo', 'change', (e) => { ui.hTo = e.target.value; render(); });
  on('setName', 'change', (e) => { db.settings.businessName = e.target.value.trim() || 'Inventory'; save(); render(); toast('Saved'); });
  on('setCur', 'change', (e) => { db.settings.currency = e.target.value; save(); toast('Saved'); });
}

document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-move],[data-act],[data-sort],[data-open]');
  if (!t || t.closest('dialog')) return;
  if (t.dataset.move) { e.stopPropagation(); openMovement(t.dataset.id, t.dataset.move); return; }
  if (t.dataset.sort) {
    const k = t.dataset.sort;
    if (ui.sort === k) ui.dir *= -1; else { ui.sort = k; ui.dir = ['qty', 'value', 'price'].includes(k) ? -1 : 1; }
    render(); return;
  }
  if (t.dataset.act) { e.preventDefault(); action(t.dataset.act); return; }
  if (t.dataset.open) { if (productById(t.dataset.open)) openDetail(t.dataset.open); }
});

$('#addProductBtn').addEventListener('click', () => openProductForm());

function action(act) {
  switch (act) {
    case 'add': return openProductForm();
    case 'sample': return loadSample();
    case 'backup': return backup();
    case 'restore': return pickFile('.json,application/json', restore);
    case 'export-csv': return exportCSV();
    case 'import-csv': return pickFile('.csv,text/csv,text/plain', importCSV);
    case 'template-csv': return download('inventory-template.csv', '﻿' + toCSV([CSV_HEADERS, ['Example item', 'SKU-001', 'General', 'pcs', '10', '3', '2.50', '4.00', 'Shelf A1', '', '']]), 'text/csv');
    case 'export-history': return exportHistory();
    case 'more-history': ui.hLimit += 200; return render();
    case 'clear-hproduct': ui.hProduct = ''; location.hash = '#history'; return render();
    case 'clear-history':
      return confirmDialog('Clear all history?', 'Quantities stay as they are. Only the movement log is removed.', 'Clear history', () => {
        db.movements = []; save(); render(); toast('History cleared');
      });
    case 'wipe':
      return confirmDialog('Delete all data?', 'All products and history in this browser will be removed. Download a backup first if you might need it.', 'Delete everything', () => {
        db = emptyData(); save(); render(); toast('All data deleted');
      });
  }
}

/* ---------- Dialogs ---------- */

const dialog = $('#dialog');
const dialogForm = $('#dialogForm');

function openDialog(html, onSubmit, onReady) {
  dialogForm.innerHTML = html;
  dialogForm.onsubmit = (e) => {
    e.preventDefault();
    const submitter = e.submitter;
    if (submitter && submitter.value === 'cancel') { dialog.close(); return; }
    if (onSubmit(submitter ? submitter.value : '') !== false) dialog.close();
  };
  dialogForm.onclick = (e) => {
    const b = e.target.closest('[data-dlg]');
    if (b && b.dataset.dlg === 'cancel') { e.preventDefault(); dialog.close(); }
  };
  dialog.showModal();
  if (onReady) onReady(dialogForm);
}
dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });

function confirmDialog(title, text, okLabel, onOk) {
  openDialog(`<h3>${esc(title)}</h3><div class="sub" style="margin-top:0">${esc(text)}</div>
    <div class="dialog-actions"><button class="btn" data-dlg="cancel" type="button">Cancel</button>
    <button class="btn danger solid" value="ok">${esc(okLabel)}</button></div>`, () => onOk());
}

function field(name, label, value, opts = {}) {
  const { type = 'text', cls = '', hint = '', attrs = '' } = opts;
  return `<div class="field ${cls}"><label for="f_${name}">${label}</label>
    <input id="f_${name}" name="${name}" type="${type}" value="${esc(value)}" ${attrs}>
    ${hint ? `<div class="hint">${hint}</div>` : ''}</div>`;
}

function openProductForm(id) {
  const p = id ? productById(id) : null;
  const v = p || { name: '', sku: '', category: '', unit: 'pcs', qty: '', minQty: '', cost: '', price: '', location: '', supplier: '', notes: '' };
  const cats = categories();
  const units = [...new Set(['pcs', 'box', 'kg', 'g', 'L', 'mL', 'm', 'pack', 'set', 'pair', ...db.products.map((x) => x.unit)])].filter(Boolean);
  const numAttrs = 'inputmode="decimal" step="any" min="0"';
  openDialog(`
    <h3>${p ? 'Edit product' : 'Add product'}</h3>
    <div class="fields">
      ${field('name', 'Name *', v.name, { cls: 'full', attrs: 'required autocomplete="off"' })}
      ${field('sku', 'SKU / code', v.sku, { attrs: 'autocomplete="off" autocapitalize="characters"' })}
      ${field('category', 'Category', v.category, { attrs: 'list="catList" autocomplete="off"' })}
      ${p ? `<div class="field"><label>Quantity</label><input value="${qtyFmt(p.qty)} ${esc(p.unit)}" disabled>
        <div class="hint">Use Stock in / out to change it, so it is logged.</div></div>`
          : field('qty', 'Starting quantity', v.qty, { type: 'number', attrs: numAttrs + ' placeholder="0"' })}
      ${field('unit', 'Unit', v.unit, { attrs: 'list="unitList" autocomplete="off"' })}
      ${field('minQty', 'Low stock alert at', v.minQty, { type: 'number', attrs: numAttrs + ' placeholder="0 = off"' })}
      ${field('location', 'Location', v.location, { attrs: 'placeholder="Shelf, bin, room…" autocomplete="off"' })}
      ${field('cost', `Cost per unit (${esc(db.settings.currency.trim())})`, v.cost, { type: 'number', attrs: numAttrs })}
      ${field('price', `Sale price (${esc(db.settings.currency.trim())})`, v.price, { type: 'number', attrs: numAttrs })}
      ${field('supplier', 'Supplier', v.supplier, { cls: 'full', attrs: 'autocomplete="off"' })}
      <div class="field full"><label for="f_notes">Notes</label><textarea id="f_notes" name="notes">${esc(v.notes)}</textarea></div>
    </div>
    <datalist id="catList">${cats.map((c) => `<option value="${esc(c)}">`).join('')}</datalist>
    <datalist id="unitList">${units.map((u) => `<option value="${esc(u)}">`).join('')}</datalist>
    <div class="dialog-actions">
      ${p ? '<button class="btn danger" value="delete" formnovalidate>Delete</button><span class="spacer"></span>' : ''}
      <button class="btn" data-dlg="cancel" type="button">Cancel</button>
      <button class="btn primary" value="save">${p ? 'Save' : 'Add product'}</button>
    </div>`,
  (btn) => {
    if (btn === 'delete') {
      setTimeout(() => confirmDialog('Delete this product?', `“${p.name}” will be removed. Its past movements stay in History.`, 'Delete', () => {
        db.products = db.products.filter((x) => x.id !== p.id); save(); render(); toast('Product deleted');
      }), 0);
      return;
    }
    const f = new FormData(dialogForm);
    const data = Object.fromEntries(f.entries());
    if (!data.name.trim()) { $('#f_name').closest('.field').classList.add('invalid'); $('#f_name').focus(); return false; }
    const sku = data.sku.trim().toLowerCase();
    if (sku && db.products.some((x) => x.sku.toLowerCase() === sku && (!p || x.id !== p.id))) {
      toast('Another product already uses this SKU'); $('#f_sku').focus(); return false;
    }
    if (p) {
      Object.assign(p, normalizeProduct({ ...p, ...data, qty: p.qty }));
      toast('Saved');
    } else {
      const startQty = num(data.qty);
      const np = normalizeProduct({ ...data, qty: 0 });
      db.products.push(np);
      if (startQty) recordMovement(np, 'in', startQty, 'Opening stock');
      toast('Product added');
    }
    save(); render();
  }, (form) => { if (!p) $('#f_name', form).focus(); });
}

function openMovement(id, type = 'in') {
  const p = productById(id);
  if (!p) return;
  openDialog(`
    <h3>${esc(p.name)}</h3>
    <div class="sub">${p.sku ? esc(p.sku) + ' · ' : ''}Now ${qtyFmt(p.qty)} ${esc(p.unit)}</div>
    <div class="segmented" role="radiogroup">
      <label><input type="radio" name="type" value="in" ${type === 'in' ? 'checked' : ''}>Stock in</label>
      <label><input type="radio" name="type" value="out" ${type === 'out' ? 'checked' : ''}>Stock out</label>
      <label><input type="radio" name="type" value="adjust" ${type === 'adjust' ? 'checked' : ''}>Set count</label>
    </div>
    <div class="field"><label for="m_qty" id="m_label">Quantity</label>
      <div class="stepper">
        <button class="btn" type="button" data-step="-1" aria-label="Minus one">−</button>
        <input id="m_qty" name="qty" type="number" inputmode="decimal" step="any" min="0" value="1" required>
        <button class="btn" type="button" data-step="1" aria-label="Plus one">+</button>
      </div></div>
    <div class="preview" id="m_preview"></div>
    <div class="fields">
      <div class="field"><label for="m_date">Date</label><input id="m_date" name="date" type="datetime-local" value="${localInputValue()}"></div>
      <div class="field"><label for="m_note">Note</label><input id="m_note" name="note" placeholder="Supplier, order #, reason…" autocomplete="off"></div>
    </div>
    <div class="dialog-actions">
      <button class="btn" data-dlg="cancel" type="button">Cancel</button>
      <button class="btn primary" value="save" id="m_save">Save</button>
    </div>`,
  () => {
    const f = new FormData(dialogForm);
    const t = f.get('type');
    const q = num(f.get('qty'));
    if (q < 0 || (t !== 'adjust' && q <= 0)) { toast('Enter a quantity'); return false; }
    const d = f.get('date') ? new Date(f.get('date')) : new Date();
    recordMovement(p, t, q, String(f.get('note') || '').trim(), isNaN(d) ? undefined : d.toISOString());
    save(); render();
    toast(`${p.name}: now ${qtyFmt(p.qty)} ${p.unit}`);
  },
  (form) => {
    const qty = $('#m_qty', form);
    const update = () => {
      const t = form.querySelector('input[name=type]:checked').value;
      const q = num(qty.value);
      const after = t === 'in' ? p.qty + q : t === 'out' ? p.qty - q : q;
      $('#m_label', form).textContent = t === 'adjust' ? 'New counted quantity' : 'Quantity';
      const warn = after < 0 ? ' <span class="delta-neg">(below zero)</span>' : (p.minQty && after <= p.minQty ? ' <span style="color:var(--amber)">(low)</span>' : '');
      $('#m_preview', form).innerHTML = `${qtyFmt(p.qty)} → <b>${qtyFmt(round(after))}</b> ${esc(p.unit)}${warn}`;
      $('#m_save', form).textContent = t === 'in' ? 'Add stock' : t === 'out' ? 'Remove stock' : 'Set count';
    };
    form.querySelectorAll('input[name=type]').forEach((r) => r.addEventListener('change', () => {
      if (r.value === 'adjust' && r.checked) qty.value = p.qty;
      else if (r.checked && num(qty.value) === p.qty) qty.value = 1;
      update();
    }));
    form.querySelectorAll('[data-step]').forEach((b) => b.addEventListener('click', () => {
      qty.value = Math.max(0, round(num(qty.value) + Number(b.dataset.step))); update();
    }));
    qty.addEventListener('input', update);
    if (type === 'adjust') qty.value = p.qty;
    update();
    qty.focus(); qty.select();
  });
}

function openDetail(id) {
  const p = productById(id);
  if (!p) return;
  const moves = db.movements.filter((m) => m.productId === id).sort((a, b) => b.date.localeCompare(a.date));
  const cell = (label, value) => `<div><span>${label}</span><b>${value || '—'}</b></div>`;
  openDialog(`
    <h3>${esc(p.name)}</h3>
    <div class="sub">${[p.sku, p.category].filter(Boolean).map(esc).join(' · ')} ${badge(p)}</div>
    <div class="detail-grid">
      ${cell('In stock', `${qtyFmt(p.qty)} ${esc(p.unit)}`)}
      ${cell('Low stock at', p.minQty ? qtyFmt(p.minQty) : 'Off')}
      ${cell('Location', esc(p.location))}
      ${cell('Cost', p.cost ? money(p.cost) : '')}
      ${cell('Price', p.price ? money(p.price) : '')}
      ${cell('Stock value', p.cost ? money(Math.max(0, p.qty) * p.cost) : '')}
      ${p.supplier ? cell('Supplier', esc(p.supplier)) : ''}
      ${cell('Updated', dateFmt(p.updatedAt, false))}
    </div>
    ${p.notes ? `<div class="preview">${esc(p.notes)}</div>` : ''}
    <div class="btn-row">
      <button class="btn in" type="button" data-d="in">+ Stock in</button>
      <button class="btn out" type="button" data-d="out">− Stock out</button>
      <button class="btn" type="button" data-d="adjust">Set count</button>
      <button class="btn" type="button" data-d="edit">Edit</button>
    </div>
    <div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
        <b>History</b>${moves.length ? `<a href="#history?product=${p.id}" data-d="all">See all ${moves.length}</a>` : ''}
      </div>
      <div class="mini-history">${moves.length ? `<ul class="list">${moves.slice(0, 20).map(movementLi).join('')}</ul>` : '<div class="empty">No movements yet.</div>'}</div>
    </div>
    <div class="dialog-actions"><button class="btn" data-dlg="cancel" type="button">Close</button></div>`,
  () => {},
  (form) => {
    form.querySelectorAll('[data-d]').forEach((b) => b.addEventListener('click', (e) => {
      const d = b.dataset.d;
      dialog.close();
      if (d === 'edit') openProductForm(id);
      else if (d === 'all') { /* link navigates */ }
      else { e.preventDefault(); openMovement(id, d); }
    }));
  });
}

/* ---------- Import / export ---------- */

function pickFile(accept, handler) {
  const input = $('#fileInput');
  input.value = '';
  input.accept = accept;
  input.onchange = () => {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => handler(String(reader.result), file.name);
    reader.onerror = () => toast('Could not read the file');
    reader.readAsText(file);
  };
  input.click();
}

function backup() {
  const payload = { app: 'inventory-system', version: 1, exportedAt: new Date().toISOString(), ...db };
  download(`inventory-backup-${today()}.json`, JSON.stringify(payload, null, 2), 'application/json');
  toast('Backup downloaded');
}

function restore(text) {
  let data;
  try { data = JSON.parse(text); } catch (e) { toast('That file is not a valid backup'); return; }
  if (!data || !Array.isArray(data.products)) { toast('That file is not a valid backup'); return; }
  confirmDialog('Restore this backup?',
    `It has ${data.products.length} products and ${(data.movements || []).length} movements, and will replace everything currently in this browser.`,
    'Restore', () => {
      db = {
        products: data.products.map((p) => ({ ...normalizeProduct(p), updatedAt: p.updatedAt || new Date().toISOString() })),
        movements: Array.isArray(data.movements) ? data.movements : [],
        settings: { ...emptyData().settings, ...(data.settings || {}) },
      };
      save(); render(); toast('Backup restored');
    });
}

function exportCSV() {
  const rows = [CSV_HEADERS.concat(['Value (cost)', 'Status'])];
  db.products.slice().sort((a, b) => a.name.localeCompare(b.name)).forEach((p) => {
    rows.push(CSV_COLUMNS.map((k) => p[k]).concat([round(p.qty * p.cost), STATUS_LABEL[status(p)]]));
  });
  download(`products-${today()}.csv`, '﻿' + toCSV(rows), 'text/csv');
}

function exportHistory() {
  const rows = [['Date', 'Product', 'SKU', 'Type', 'Change', 'Before', 'After', 'Note']];
  filteredMovements().forEach((m) => rows.push([dateFmt(m.date), m.productName, m.sku || '', TYPE_LABEL[m.type], m.change, m.before, m.after, m.note]));
  download(`stock-history-${today()}.csv`, '﻿' + toCSV(rows), 'text/csv');
}

function importCSV(text) {
  const rows = parseCSV(text);
  if (rows.length < 2) { toast('No rows found in that file'); return; }
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const map = {};
  for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
    const i = header.findIndex((h) => aliases.includes(h));
    if (i >= 0) map[key] = i;
  }
  if (map.name == null) { toast('The file needs a “Name” column'); return; }
  let added = 0, updated = 0;
  for (const r of rows.slice(1)) {
    const rec = {};
    for (const [k, i] of Object.entries(map)) rec[k] = (r[i] ?? '').trim();
    if (!rec.name) continue;
    const existing = db.products.find((p) => (rec.sku && p.sku.toLowerCase() === rec.sku.toLowerCase())
      || (!rec.sku && p.name.toLowerCase() === rec.name.toLowerCase()));
    if (existing) {
      const merged = { ...existing };
      for (const k of Object.keys(rec)) if (k !== 'qty' && rec[k] !== '') merged[k] = rec[k];
      Object.assign(existing, normalizeProduct({ ...merged, qty: existing.qty }));
      if (rec.qty !== undefined && rec.qty !== '' && round(num(rec.qty)) !== existing.qty) {
        recordMovement(existing, 'adjust', num(rec.qty), 'CSV import');
      }
      updated++;
    } else {
      const np = normalizeProduct({ ...rec, qty: 0 });
      db.products.push(np);
      if (num(rec.qty)) recordMovement(np, 'in', num(rec.qty), 'CSV import');
      added++;
    }
  }
  save(); render();
  toast(`Imported: ${added} added, ${updated} updated`);
}

function loadSample() {
  const doLoad = () => {
    const items = [
      ['USB-C Cable 1m', 'CAB-001', 'Electronics', 'pcs', 45, 10, 1.8, 5.99, 'A1'],
      ['Wireless Mouse', 'MOU-210', 'Electronics', 'pcs', 6, 8, 7.5, 15.99, 'A2'],
      ['A4 Paper (500 sheets)', 'PAP-A4', 'Office', 'pack', 28, 10, 3.2, 6.5, 'B1'],
      ['Ballpoint Pens (box of 50)', 'PEN-050', 'Office', 'box', 0, 3, 4.0, 9.0, 'B2'],
      ['Hand Sanitizer 500mL', 'SAN-500', 'Cleaning', 'pcs', 14, 12, 2.1, 4.5, 'C1'],
      ['Paper Towels', 'TOW-012', 'Cleaning', 'pack', 40, 15, 5.0, 8.75, 'C2'],
      ['Packing Tape', 'TAP-048', 'Shipping', 'pcs', 3, 6, 1.1, 2.99, 'D1'],
      ['Cardboard Box Medium', 'BOX-M', 'Shipping', 'pcs', 120, 30, 0.6, 1.5, 'D2'],
      ['Coffee Beans 1kg', 'COF-1K', 'Kitchen', 'kg', 9, 4, 11.0, 19.0, 'E1'],
      ['Notebook A5', 'NTB-A5', 'Office', 'pcs', 33, 10, 1.4, 3.25, 'B3'],
    ];
    const start = Date.now() - 21 * 864e5;
    items.forEach(([name, sku, category, unit, qty, minQty, cost, price, location], i) => {
      if (db.products.some((p) => p.sku === sku)) return;
      const p = normalizeProduct({ name, sku, category, unit, qty: 0, minQty, cost, price, location });
      db.products.push(p);
      const opening = qty + 10 + i * 2;
      recordMovement(p, 'in', opening, 'Opening stock', new Date(start + i * 36e5).toISOString());
      recordMovement(p, 'out', opening - qty, 'Sales', new Date(start + (8 + i) * 864e5).toISOString());
    });
    save(); render(); toast('Sample data loaded');
  };
  if (db.products.length) confirmDialog('Add sample products?', 'Ten example products will be added next to your own.', 'Add samples', doLoad);
  else doLoad();
}

/* ---------- Keyboard shortcuts (laptop) ---------- */

document.addEventListener('keydown', (e) => {
  if (dialog.open || e.metaKey || e.ctrlKey || e.altKey) return;
  const tag = (e.target.tagName || '').toLowerCase();
  if (['input', 'textarea', 'select'].includes(tag)) return;
  if (e.key === '/') { e.preventDefault(); if (currentView !== 'products') location.hash = '#products'; setTimeout(() => $('#search') && $('#search').focus(), 0); }
  if (e.key === 'n') { e.preventDefault(); openProductForm(); }
});

/* ---------- Boot ---------- */

window.addEventListener('storage', (e) => { if (e.key === STORAGE_KEY) { db = load(); render(); } });

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

route();
