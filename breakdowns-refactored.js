import { CsvStore } from './csv-store.js';
import { ConfigLoader } from './config-loader.js';

// ── STATE ────────────────────────────────────────────────────────
let breakdowns  = [];
let machines    = [];
let spares      = [];
let editIndex   = null;
let detailIdx   = null;
let selectedParts = []; // {spareId, spareName, specification, qtyUsed}
let config      = null;

// ── TOAST ────────────────────────────────────────────────────────
let bdToastTimer = null;
function showBdToast(msg, type) {
  const el = document.getElementById('bd-toast');
  el.innerHTML = msg;
  el.className = 'bd-toast ' + (type || '');
  el.classList.add('show');
  if (bdToastTimer) clearTimeout(bdToastTimer);
  bdToastTimer = setTimeout(() => el.classList.remove('show'), 4000);
}

// ── PARTS PANEL ──────────────────────────────────────────────
function populatePartsMachineFilter() {
  const sel = document.getElementById('parts-machine-filter');
  if (!sel) return;
  sel.innerHTML = '<option value="">All Machines</option>' +
    machines.map(m => `<option value="${m.id}">${m.id}</option>`).join('');
}

function togglePartsPanel() {
  const panel = document.getElementById('parts-panel');
  const isVisible = panel.style.display !== 'none';
  panel.style.display = isVisible ? 'none' : 'block';
  if (!isVisible) {
    renderPartsPanel();
    document.getElementById('parts-search').focus();
  }
}

function renderPartsPanel() {
  const search  = (document.getElementById('parts-search').value || '').toLowerCase();
  const machine = document.getElementById('parts-machine-filter').value;

  const filtered = spares.filter(s => {
    const matchSearch =
      (s.spareName||'').toLowerCase().includes(search) ||
      (s.specification||'').toLowerCase().includes(search) ||
      (s.machine||'').toLowerCase().includes(search);
    const matchMachine = machine ? s.machine === machine : true;
    return matchSearch && matchMachine;
  });

  const container = document.getElementById('parts-list');
  if (filtered.length === 0) {
    container.innerHTML = '<div class="pp-no-results">No spare parts found. Add parts in the Spare Parts page.</div>';
    return;
  }

  let html = `<div class="parts-panel-header">
    <span>Part Name</span><span>Specification</span>
    <span>Stock</span><span>Min Stock</span><span></span>
  </div>`;
  html += filtered.map(s => {
    const alreadyAdded = selectedParts.some(p => p.spareId === s.id);
    const stockColor = s.qtyInStock === 0 ? '#f87171' : s.qtyInStock <= s.minStockReq ? '#fbbf24' : '#4ade80';
    const maxQty = s.qtyInStock;
    return `
      <div class="parts-panel-row">
        <span style="color:#e2e8f0;font-weight:600">${s.spareName}</span>
        <span style="color:#94a3b8">${s.specification||'—'}</span>
        <span style="color:${stockColor};font-weight:700">${s.qtyInStock}</span>
        <span style="color:#64748b">${s.minStockReq}</span>
        <div style="display:flex;align-items:center;gap:6px">
          <input type="number" class="pp-qty-input" id="ppqty-${s.id}"
            value="1" min="1" max="${maxQty}" ${maxQty===0?'disabled':''} />
          <button class="btn-pp-add" onclick="addPartToSelected('${s.id}')"
            ${alreadyAdded || maxQty===0 ? 'disabled' : ''}>
            ${alreadyAdded ? '✓ Added' : maxQty===0 ? 'No Stock' : '＋ Add'}
          </button>
        </div>
      </div>`;
  }).join('');
  container.innerHTML = html;
}

function addPartToSelected(spareId) {
  const s = spares.find(x => x.id === spareId);
  if (!s) return;
  const qtyInput = document.getElementById('ppqty-' + spareId);
  const qty = parseInt(qtyInput ? qtyInput.value : 1) || 1;
  if (qty <= 0 || qty > s.qtyInStock) {
    alert(`⚠️ Invalid quantity. Available: ${s.qtyInStock}`); return;
  }
  if (selectedParts.some(p => p.spareId === spareId)) {
    alert('This part is already in the list.'); return;
  }
  selectedParts.push({ spareId: s.id, spareName: s.spareName, specification: s.specification||'', qtyUsed: qty });
  renderSelectedParts();
  renderPartsPanel();
}

function removeSelectedPart(spareId) {
  selectedParts = selectedParts.filter(p => p.spareId !== spareId);
  renderSelectedParts();
  renderPartsPanel();
}

function renderSelectedParts() {
  const container = document.getElementById('selected-parts-list');
  if (!container) return;
  if (selectedParts.length === 0) {
    container.innerHTML = '<div style="color:#475569;font-size:13px;padding:6px 0">No parts selected yet.</div>';
    return;
  }
  container.innerHTML = selectedParts.map(p => `
    <div class="selected-part-row">
      <span class="sp-name">📦 ${p.spareName}</span>
      <span class="sp-spec">${p.specification||'—'}</span>
      <span class="sp-qty">Qty: ${p.qtyUsed}</span>
      <button class="btn-sp-remove" onclick="removeSelectedPart('${p.spareId}')">✕</button>
    </div>`).join('');
}

// ── POPULATE MACHINE DROPDOWNS ────────────────────────────────
function populateMachineDropdowns() {
  const opts = machines.map(m =>
    `<option value="${m.id}">${m.id} — ${m.name}</option>`
  ).join('');

  document.getElementById('f-machine').innerHTML =
    '<option value="">— Select Machine —</option>' + opts;

  document.getElementById('machineFilter').innerHTML =
    '<option value="">All Machines</option>' +
    machines.map(m => `<option value="${m.id}">${m.id}</option>`).join('');

  populatePartsMachineFilter();
}

// ── AUTO-CALCULATE TTR ────────────────────────────────────────
function calcTTR() {
  const bdDate   = document.getElementById('f-bd-date').value;
  const startT   = document.getElementById('f-start-time').value;
  const endDate  = document.getElementById('f-end-date').value;
  const endT     = document.getElementById('f-end-time').value;
  const display  = document.getElementById('ttr-display');

  if (!bdDate || !startT || !endDate || !endT) {
    display.textContent = '— Enter start & end time —';
    return;
  }

  const start = new Date(`${bdDate}T${startT}`);
  const end   = new Date(`${endDate}T${endT}`);
  const diff  = end - start;

  if (diff <= 0) {
    display.textContent = '⚠️ End time must be after start time';
    display.style.color = '#f87171';
    return;
  }

  display.style.color = '#4ade80';
  const totalMins = Math.floor(diff / 60000);
  const hrs  = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  display.textContent = `${hrs}h ${mins}m  (${(totalMins / 60).toFixed(2)} hours)`;
}

function getTTRMinutes() {
  const bdDate  = document.getElementById('f-bd-date').value;
  const startT  = document.getElementById('f-start-time').value;
  const endDate = document.getElementById('f-end-date').value;
  const endT    = document.getElementById('f-end-time').value;
  if (!bdDate || !startT || !endDate || !endT) return 0;
  const diff = new Date(`${endDate}T${endT}`) - new Date(`${bdDate}T${startT}`);
  return diff > 0 ? Math.floor(diff / 60000) : 0;
}

// ── HISTORY ROWS (inside modal) ──────────────────────────────
let historyRows = [];

function renderHistoryTable() {
  const tbody = document.getElementById('history-tbody');
  if (historyRows.length === 0) {
    tbody.innerHTML = `<tr id="history-empty-row">
      <td colspan="3" style="text-align:center;color:#475569;padding:14px">No history entries yet</td>
    </tr>`;
    return;
  }
  tbody.innerHTML = historyRows.map((r, i) => `
    <tr>
      <td>${r.date || '—'}</td>
      <td>${r.note}</td>
      <td><button class="del-row-btn" onclick="removeHistoryRow(${i})">✕</button></td>
    </tr>`).join('');
}

function addHistoryRow() {
  const note = document.getElementById('f-note').value.trim();
  if (!note) { alert('Enter a note.'); return; }
  const today = new Date().toISOString().split('T')[0];
  historyRows.unshift({ date: today, note });
  document.getElementById('f-note').value = '';
  renderHistoryTable();
}

function removeHistoryRow(i) {
  historyRows.splice(i, 1);
  renderHistoryTable();
}

// ── UTILITY FUNCTIONS ────────────────────────────────────────
function generateRef() {
  return 'BD-' + String(Date.now()).slice(-5);
}

function clearAllData() {
  if (!confirm('🗑 Clear ALL breakdowns, machines, and spare parts data? This cannot be undone!')) return;
  (async () => {
    try {
      await CsvStore.save('breakdowns', []);
      breakdowns = [];
      renderTable();
      renderStats();
      showBdToast('✅ All data cleared.', 'success');
    } catch (err) {
      console.error('Error clearing breakdowns:', err);
      showBdToast('❌ Error clearing data', 'error');
    }
  })();
}

function log(html) {
  const console_el = document.getElementById('gen-console');
  if (!console_el) return;
  console_el.innerHTML += html + '<br>';
  console_el.parentElement.scrollTop = console_el.parentElement.scrollHeight;
}

// ── STATS ────────────────────────────────────────────────────────
function renderStats() {
  const total = breakdowns.length;
  const open  = breakdowns.filter(b => b.status === 'open').length;
  const closed= breakdowns.filter(b => b.status === 'closed').length;
  document.getElementById('stats-row').innerHTML = `
    <div class="mini-stat blue"><div class="label">Total</div><div class="value">${total}</div></div>
    <div class="mini-stat amber"><div class="label">Open</div><div class="value">${open}</div></div>
    <div class="mini-stat green"><div class="label">Closed</div><div class="value">${closed}</div></div>`;
}

// ── TABLE ────────────────────────────────────────────────────────
function renderTable() {
  const search  = document.getElementById('searchInput').value.toLowerCase();
  const machine = document.getElementById('machineFilter').value;
  const status  = document.getElementById('statusFilter').value;

  const filtered = breakdowns.filter(b => {
    const ms = search ? (
      (b.ref||'').toLowerCase().includes(search) ||
      (b.machine||'').toLowerCase().includes(search) ||
      (b.problem||'').toLowerCase().includes(search)
    ) : true;
    const mm = machine ? b.machine === machine : true;
    const ss = status ? b.status === status : true;
    return ms && mm && ss;
  });

  const tbody = document.getElementById('bd-tbody');
  const empty = document.getElementById('empty-state');
  if (filtered.length === 0) { tbody.innerHTML = ''; empty.style.display='block'; return; }
  empty.style.display = 'none';

  tbody.innerHTML = filtered.map((b, i) => {
    const ri = breakdowns.indexOf(b);
    const rowClass = b.status === 'open' ? 'row-open' : 'row-closed';
    const badgeClass = b.status === 'open' ? 'badge-open' : 'badge-closed';
    const badgeText = b.status === 'open' ? '🔴 OPEN' : '✅ CLOSED';
    return `<tr class="${rowClass}">
      <td>${ri+1}</td>
      <td><strong>${b.ref}</strong></td>
      <td>${b.machine||'—'}</td>
      <td>${b.bdDate||'—'}</td>
      <td style="color:#94a3b8">${b.problem||'—'}</td>
      <td style="text-align:center">${b.ttrMins||'—'}</td>
      <td><span class="badge ${badgeClass}">${badgeText}</span></td>
      <td style="white-space:nowrap">
        <button class="btn-sm btn-view" onclick="viewDetail(${ri})">👁</button>
        <button class="btn-sm btn-edit" onclick="openEditModal(${ri})" style="margin-left:4px">✏️</button>
        <button class="btn-sm btn-del" onclick="deleteBD(${ri})" style="margin-left:4px">🗑</button>
      </td></tr>`;
  }).join('');
}

// ── MODAL FUNCTIONS ─────────────────────────────────────────────
function openAddModal() {
  editIndex = null;
  historyRows = [];
  selectedParts = [];
  document.getElementById('modal-title').textContent = '🔴 Add Breakdown';
  ['f-ref','f-machine','f-bd-date','f-start-time','f-end-date','f-end-time',
   'f-problem','f-action','f-root-cause','f-technician','f-operator','f-note'
  ].forEach(id => { const el = document.getElementById(id); if(el) el.value=''; });
  document.getElementById('f-status').value = 'open';
  renderHistoryTable();
  renderSelectedParts();
  document.getElementById('f-ref').value = generateRef();
  document.getElementById('bdModal').classList.add('show');
}

async function openEditModal(idx) {
  editIndex = idx;
  const b = breakdowns[idx];
  document.getElementById('modal-title').textContent = '✏️ Edit — ' + b.ref;
  
  document.getElementById('f-ref').value       = b.ref||'';
  document.getElementById('f-machine').value   = b.machine||'';
  document.getElementById('f-bd-date').value   = b.bdDate||'';
  document.getElementById('f-start-time').value= b.startTime||'';
  document.getElementById('f-end-date').value  = b.endDate||'';
  document.getElementById('f-end-time').value  = b.endTime||'';
  document.getElementById('f-problem').value   = b.problem||'';
  document.getElementById('f-action').value    = b.action||'';
  document.getElementById('f-root-cause').value= b.rootCause||'';
  document.getElementById('f-technician').value= b.technician||'';
  document.getElementById('f-operator').value  = b.operator||'';
  document.getElementById('f-status').value    = b.status||'open';
  document.getElementById('f-note').value      = '';
  
  historyRows = b.history || [];
  selectedParts = b.selectedParts || [];
  
  renderHistoryTable();
  renderSelectedParts();
  document.getElementById('bdModal').classList.add('show');
}

function closeModal() {
  document.getElementById('bdModal').classList.remove('show');
  historyRows = [];
  selectedParts = [];
}

async function saveBD() {
  const ref = document.getElementById('f-ref').value.trim();
  const machine = document.getElementById('f-machine').value;
  if (!ref || !machine) { alert('Enter Ref and Machine.'); return; }

  const entry = {
    ref,
    machine,
    bdDate: document.getElementById('f-bd-date').value,
    startTime: document.getElementById('f-start-time').value,
    endDate: document.getElementById('f-end-date').value,
    endTime: document.getElementById('f-end-time').value,
    ttrMins: getTTRMinutes(),
    problem: document.getElementById('f-problem').value.trim(),
    action: document.getElementById('f-action').value.trim(),
    rootCause: document.getElementById('f-root-cause').value.trim(),
    technician: document.getElementById('f-technician').value.trim(),
    operator: document.getElementById('f-operator').value.trim(),
    status: document.getElementById('f-status').value,
    history: historyRows,
    selectedParts,
  };

  try {
    if (editIndex === null) {
      await CsvStore.append('breakdowns', entry);
    } else {
      const oldRef = breakdowns[editIndex].ref;
      await CsvStore.update('breakdowns', oldRef, entry);
    }
    breakdowns = await CsvStore.load('breakdowns');
    closeModal();
    renderStats();
    renderTable();
    showBdToast('✅ Breakdown saved.', 'success');
  } catch (err) {
    console.error('Error saving breakdown:', err);
    showBdToast('❌ Error saving breakdown', 'error');
  }
}

async function deleteBD(idx) {
  const ref = breakdowns[idx].ref;
  if (!confirm('Delete "' + ref + '"?')) return;
  
  try {
    await CsvStore.remove('breakdowns', ref);
    breakdowns = await CsvStore.load('breakdowns');
    renderStats();
    renderTable();
    showBdToast('✅ Breakdown deleted.', 'success');
  } catch (err) {
    console.error('Error deleting breakdown:', err);
    showBdToast('❌ Error deleting breakdown', 'error');
  }
}

// ── DETAIL VIEW ──────────────────────────────────────────────────
function viewDetail(idx) {
  detailIdx = idx;
  const b = breakdowns[idx];
  document.getElementById('d-title').textContent = '🔴 ' + b.ref;

  const histHTML = (b.history && b.history.length) ? `
    <table class="detail-table"><thead><tr><th>Date</th><th>Note</th></tr></thead><tbody>
    ${b.history.map(h=>`<tr><td>${h.date||'—'}</td><td>${h.note}</td></tr>`).join('')}
    </tbody></table>` : '<span style="color:#475569;font-size:13px">No history.</span>';

  const partsHTML = (b.selectedParts && b.selectedParts.length) ? `
    <table class="detail-table"><thead><tr><th>Part</th><th>Specification</th><th>Qty</th></tr></thead><tbody>
    ${b.selectedParts.map(p=>`<tr><td>${p.spareName}</td><td>${p.specification||'—'}</td><td>${p.qtyUsed}</td></tr>`).join('')}
    </tbody></table>` : '<span style="color:#475569;font-size:13px">No parts used.</span>';

  document.getElementById('detail-content').innerHTML = `
    <div class="detail-section">
      <h3>📋 Basic Info</h3>
      <div class="detail-row"><span class="dk">Reference</span><span class="dv">${b.ref}</span></div>
      <div class="detail-row"><span class="dk">Machine</span><span class="dv">${b.machine||'—'}</span></div>
      <div class="detail-row"><span class="dk">Date</span><span class="dv">${b.bdDate||'—'}</span></div>
      <div class="detail-row"><span class="dk">Status</span><span class="dv"><span class="badge ${b.status==='open'?'badge-open':'badge-closed'}">${b.status==='open'?'🔴 OPEN':'✅ CLOSED'}</span></span></div>
    </div>
    <div class="detail-section">
      <h3>⏱️ Time & TTR</h3>
      <div class="detail-row"><span class="dk">Start</span><span class="dv">${b.bdDate} ${b.startTime}</span></div>
      <div class="detail-row"><span class="dk">End</span><span class="dv">${b.endDate} ${b.endTime}</span></div>
      <div class="detail-row"><span class="dk">TTR (mins)</span><span class="dv" style="font-weight:700;color:#38bdf8">${b.ttrMins||'—'}</span></div>
    </div>
    <div class="detail-section">
      <h3>🔧 Details</h3>
      <div class="detail-row"><span class="dk">Problem</span><span class="dv">${b.problem||'—'}</span></div>
      <div class="detail-row"><span class="dk">Action</span><span class="dv">${b.action||'—'}</span></div>
      <div class="detail-row"><span class="dk">Root Cause</span><span class="dv">${b.rootCause||'—'}</span></div>
    </div>
    <div class="detail-section">
      <h3>👥 Personnel</h3>
      <div class="detail-row"><span class="dk">Technician</span><span class="dv">${b.technician||'—'}</span></div>
      <div class="detail-row"><span class="dk">Operator</span><span class="dv">${b.operator||'—'}</span></div>
    </div>
    <div class="detail-section">
      <h3>📦 Parts Used</h3>
      ${partsHTML}
    </div>
    <div class="detail-section">
      <h3>📝 History</h3>
      ${histHTML}
    </div>`;

  document.getElementById('detailModal').classList.add('show');
}

function closeDetail() {
  document.getElementById('detailModal').classList.remove('show');
}

function editFromDetail() {
  closeDetail();
  openEditModal(detailIdx);
}

// ── GENERATE TEST DATA ───────────────────────────────────────────
async function generateTestData() {
  const numYears = parseInt(prompt('Generate test data for how many years? (1-3)', '1'));
  if (!numYears || numYears < 1 || numYears > 3) return;

  const consoleDiv = document.getElementById('gen-console');
  if (!consoleDiv) { alert('Console not found'); return; }
  consoleDiv.innerHTML = '';
  consoleDiv.parentElement.style.display = 'block';

  function log(msg) {
    consoleDiv.innerHTML += msg + '<br>';
    consoleDiv.parentElement.scrollTop = consoleDiv.parentElement.scrollHeight;
  }

  log('🔄 Generating test data...');
  const newBDs = [];
  let totalGenerated = 0;

  const now = new Date();
  const currentYear = now.getFullYear();

  for (let yearOffset = 0; yearOffset < numYears; yearOffset++) {
    const year = currentYear - yearOffset;
    for (const machine of machines) {
      for (let month = 1; month <= 12; month++) {
        if (Math.random() > 0.4) continue;
        const count = Math.floor(Math.random() * 3) + 1;
        for (let i = 0; i < count; i++) {
          const day = Math.floor(Math.random() * 28) + 1;
          const startHour = Math.floor(Math.random() * 24);
          const startMin = Math.floor(Math.random() * 60);
          const durationMins = Math.floor(Math.random() * 240) + 15;
          const endHour = Math.floor((startHour * 60 + startMin + durationMins) / 60) % 24;
          const endMin = (startHour * 60 + startMin + durationMins) % 60;

          const bdDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          const endDate = durationMins > 24 * 60 ? 
            `${year}-${String(month).padStart(2, '0')}-${String(day+1).padStart(2, '0')}` : bdDate;

          newBDs.push({
            ref: `BD-${String(Date.now() + Math.random()*999|0).slice(-6)}`,
            machine: machine.id,
            bdDate,
            startTime: `${String(startHour).padStart(2, '0')}:${String(startMin).padStart(2, '0')}`,
            endDate,
            endTime: `${String(endHour).padStart(2, '0')}:${String(endMin).padStart(2, '0')}`,
            ttrMins: durationMins,
            problem: 'Test breakdown',
            action: 'Test action',
            rootCause: 'Test cause',
            technician: 'Test Tech',
            operator: 'Test Op',
            status: 'closed',
            history: [],
            selectedParts: [],
          });
          totalGenerated++;
        }
      }
      log(`✅ Year ${year} — generated for ${machine.id}`);
    }
  }

  try {
    breakdowns = [...breakdowns, ...newBDs];
    await CsvStore.save('breakdowns', breakdowns);
    log('─'.repeat(60));
    log(`🎉 Done! <strong style="color:#4ade80">${totalGenerated} test breakdowns</strong> added.`);
    log(`📊 Total records now: <strong style="color:#38bdf8">${breakdowns.length}</strong>`);
    log(`ℹ️ Go to KPI page and hit Calculate to verify MTTR/MTBF.`);
    
    populateMachineDropdowns();
    renderStats();
    renderTable();
  } catch (err) {
    console.error('Error generating test data:', err);
    log(`❌ Error: ${err.message}`);
  }
}

// ── MODAL OVERLAY CLICK ──────────────────────────────────────────
document.getElementById('bdModal').addEventListener('click', function(e) {
  if (e.target === this) closeModal();
});
document.getElementById('detailModal').addEventListener('click', function(e) {
  if (e.target === this) closeDetail();
});

// ── CLOCK ────────────────────────────────────────────────────────
function updateClock() {
  document.getElementById('live-clock').textContent =
    new Date().toLocaleString('en-GB', {
      weekday:'short', year:'numeric', month:'short',
      day:'numeric', hour:'2-digit', minute:'2-digit', second:'2-digit'
    });
}
updateClock();
setInterval(updateClock, 1000);

// ── INITIALIZATION ───────────────────────────────────────────────
async function initPage() {
  try {
    // Initialize CsvStore
    await CsvStore.init();
    
    // Load configuration and data
    config = await ConfigLoader.load();
    machines = await CsvStore.load('machines');
    breakdowns = await CsvStore.load('breakdowns');
    spares = await CsvStore.load('spareparts');
    
    // Initialize UI
    populateMachineDropdowns();
    renderStats();
    renderTable();
    
    // Enable copy-paste in textareas and inputs
    document.querySelectorAll('textarea, input[type="text"]').forEach(function(el) {
      el.addEventListener('paste', function(e) { e.stopPropagation(); });
      el.addEventListener('copy',  function(e) { e.stopPropagation(); });
      el.addEventListener('cut',   function(e) { e.stopPropagation(); });
    });
  } catch (err) {
    console.error('Error initializing page:', err);
    alert('Error loading data: ' + err.message);
  }
}

// Start initialization when page loads
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initPage);
} else {
  initPage();
}
