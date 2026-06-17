import { CsvStore } from './csv-store.js';
import { ConfigLoader } from './config-loader.js';

// ── STATE ────────────────────────────────────────────────────────
let spares    = [];
let machines  = [];
let config    = null;
let editIndex = null;
let detailIdx = null;

function stockStatus(sp) {
  if (sp.qtyInStock <= 0)                         return 'out';
  if (sp.qtyInStock <= sp.minStockReq)            return 'low';
  return 'ok';
}

// ── MACHINE DROPDOWN ────────────────────────────────────────────
async function populateMachineDropdowns() {
  const opts = machines.map(m => `<option value="${m.id}">${m.id} — ${m.name}</option>`).join('');
  document.getElementById('f-machine').innerHTML    = '<option value="">— Select —</option>' + opts;
  document.getElementById('machineFilter').innerHTML= '<option value="">All Machines</option>' +
    machines.map(m => `<option value="${m.id}">${m.id}</option>`).join('');
}

// ── STOCK INDICATOR ────────────────────────────────────────────
function updateStockIndicator() {
  const qty    = parseInt(document.getElementById('f-qty').value)    || 0;
  const minQty = parseInt(document.getElementById('f-minqty').value) || 1;
  const el     = document.getElementById('f-stock-indicator');
  if (qty <= 0)          { el.style.cssText='background:#7f1d1d;color:#fca5a5;padding:6px 14px;border-radius:8px;font-size:13px;font-weight:600;margin-top:4px;display:inline-block'; el.textContent='🔴 OUT OF STOCK'; }
  else if (qty <= minQty){ el.style.cssText='background:#78350f;color:#fcd34d;padding:6px 14px;border-radius:8px;font-size:13px;font-weight:600;margin-top:4px;display:inline-block'; el.textContent='⚠️ LOW STOCK — ' + qty + ' remaining'; }
  else                   { el.style.cssText='background:#14532d;color:#4ade80;padding:6px 14px;border-radius:8px;font-size:13px;font-weight:600;margin-top:4px;display:inline-block'; el.textContent='✅ OK — ' + qty + ' in stock'; }
}

// ── STATS ──────────────────────────────────────────────────────
function renderStats() {
  const total   = spares.length;
  const out     = spares.filter(s => s.qtyInStock <= 0).length;
  const low     = spares.filter(s => s.qtyInStock > 0 && s.qtyInStock <= s.minStockReq).length;
  const totalQty= spares.reduce((a,s) => a + (s.qtyInStock||0), 0);
  document.getElementById('stats-row').innerHTML = `
    <div class="mini-stat blue"><div class="label">Total Part Types</div><div class="value">${total}</div></div>
    <div class="mini-stat red"><div class="label">Out of Stock</div><div class="value">${out}</div></div>
    <div class="mini-stat amber"><div class="label">Low Stock</div><div class="value">${low}</div></div>
    <div class="mini-stat green"><div class="label">Total Items in Stock</div><div class="value">${totalQty}</div></div>`;
}

// ── TABLE ──────────────────────────────────────────────────────
function renderTable() {
  const search  = document.getElementById('searchInput').value.toLowerCase();
  const machine = document.getElementById('machineFilter').value;
  const status  = document.getElementById('statusFilter').value;

  const filtered = spares.filter(s => {
    const st = stockStatus(s);
    const ms = search ? (
      (s.spareName||'').toLowerCase().includes(search)||
      (s.specification||'').toLowerCase().includes(search)||
      (s.machine||'').toLowerCase().includes(search)||
      (s.supplier||'').toLowerCase().includes(search)||
      (s.id||'').toLowerCase().includes(search)
    ) : true;
    const mm = machine ? s.machine === machine : true;
    const ss = status  ? st === status : true;
    return ms && mm && ss;
  });

  const tbody = document.getElementById('sp-tbody');
  const empty = document.getElementById('empty-state');
  if (filtered.length === 0) { tbody.innerHTML=''; empty.style.display='block'; return; }
  empty.style.display = 'none';

  tbody.innerHTML = filtered.map(s => {
    const ri   = spares.indexOf(s);
    const st   = stockStatus(s);
    const rowC = st==='out'?'row-out':st==='low'?'row-low':'';
    const bdgC = st==='out'?'badge-out':st==='low'?'badge-low':'badge-ok';
    const bdgT = st==='out'?'OUT OF STOCK':st==='low'?'LOW STOCK':'OK';
    const qtyC = st==='out'?'qty-out':st==='low'?'qty-low':'qty-ok';
    const price= s.unitPrice ? '₹'+Number(s.unitPrice).toLocaleString('en-IN') : '—';
    return `<tr class="${rowC}">
      <td>${ri+1}</td>
      <td><strong>${s.id}</strong></td>
      <td>${s.machine||'—'}</td>
      <td><strong>${s.spareName}</strong></td>
      <td style="color:#94a3b8">${s.specification||'—'}</td>
      <td>${s.newUsedRepaired||'—'}</td>
      <td>${price}</td>
      <td class="${qtyC}">${s.qtyInStock}</td>
      <td style="color:#64748b">${s.minStockReq}</td>
      <td style="color:#94a3b8">${s.supplier||'—'}</td>
      <td><span class="badge ${bdgC}">${bdgT}</span></td>
      <td style="white-space:nowrap">
        <button class="btn-sm btn-view" onclick="viewDetail(${ri})">👁</button>
        <button class="btn-sm btn-edit" onclick="openEditModal(${ri})" style="margin-left:4px">✏️</button>
        <button class="btn-sm btn-del"  onclick="deletePart(${ri})"   style="margin-left:4px">🗑</button>
      </td></tr>`;
  }).join('');
}

// ── OPEN / CLOSE MODALS ────────────────────────────────────────
function openAddModal() {
  editIndex = null;
  document.getElementById('modal-title').textContent = '📦 Add Spare Part';
  document.getElementById('adjust-section').style.display = 'none';
  ['f-machine','f-storage','f-compartment','f-supplier','f-name','f-spec','f-lead','f-notes'].forEach(id=>{
    const el = document.getElementById(id); if(el) el.value='';
  });
  document.getElementById('f-condition').value    = 'New';
  document.getElementById('f-discontinued').value = 'no';
  document.getElementById('f-price').value        = '';
  document.getElementById('f-qty').value          = '0';
  document.getElementById('f-minqty').value       = '1';
  updateStockIndicator();
  document.getElementById('spModal').classList.add('show');
}

function openEditModal(idx) {
  editIndex = idx;
  const s   = spares[idx];
  document.getElementById('modal-title').textContent = '✏️ Edit — ' + s.spareName;
  document.getElementById('adjust-section').style.display = 'block';
  document.getElementById('f-machine').value     = s.machine||'';
  document.getElementById('f-storage').value     = s.storageLocation||'';
  document.getElementById('f-compartment').value = s.compartment||'';
  document.getElementById('f-supplier').value    = s.supplier||'';
  document.getElementById('f-name').value        = s.spareName||'';
  document.getElementById('f-spec').value        = s.specification||'';
  document.getElementById('f-condition').value   = s.newUsedRepaired||'New';
  document.getElementById('f-price').value       = s.unitPrice||'';
  document.getElementById('f-lead').value        = s.leadTime||'';
  document.getElementById('f-discontinued').value= s.discontinued?'yes':'no';
  document.getElementById('f-notes').value       = s.notes||'';
  document.getElementById('f-qty').value         = s.qtyInStock||0;
  document.getElementById('f-minqty').value      = s.minStockReq||1;
  document.getElementById('adj-type').value      = 'add';
  document.getElementById('adj-qty').value       = '1';
  document.getElementById('adj-reason').value    = '';
  updateStockIndicator();
  document.getElementById('spModal').classList.add('show');
}

function closeModal() { document.getElementById('spModal').classList.remove('show'); }

// ── SAVE PART ──────────────────────────────────────────────────
async function savePart() {
  const name = document.getElementById('f-name').value.trim();
  const qty  = parseInt(document.getElementById('f-qty').value) || 0;
  const min  = parseInt(document.getElementById('f-minqty').value) || 1;
  if (!name) { alert('Please enter Spare Name.'); return; }

  const entry = {
    machine:        document.getElementById('f-machine').value,
    storageLocation:document.getElementById('f-storage').value.trim(),
    compartment:    document.getElementById('f-compartment').value.trim(),
    spareName:      name,
    specification:  document.getElementById('f-spec').value.trim(),
    newUsedRepaired:document.getElementById('f-condition').value,
    unitPrice:      document.getElementById('f-price').value,
    qtyInStock:     qty,
    minStockReq:    min,
    leadTime:       document.getElementById('f-lead').value.trim(),
    supplier:       document.getElementById('f-supplier').value.trim(),
    discontinued:   document.getElementById('f-discontinued').value === 'yes',
    notes:          document.getElementById('f-notes').value.trim(),
    movements:      editIndex === null ? [] : spares[editIndex].movements || [],
  };

  try {
    if (editIndex === null) {
      entry.id = 'SP-' + String(Date.now()).slice(-6);
      await CsvStore.append('spareparts', entry);
    } else {
      const partId = spares[editIndex].id;
      await CsvStore.update('spareparts', partId, entry);
    }
    
    spares = await CsvStore.load('spareparts');
    closeModal();
    renderStats();
    renderTable();
  } catch (err) {
    console.error('Error saving part:', err);
    alert('Error saving part: ' + err.message);
  }
}

// ── ADJUST STOCK ───────────────────────────────────────────────
async function adjustStock() {
  if (editIndex === null) return;
  const type   = document.getElementById('adj-type').value;
  const qty    = parseInt(document.getElementById('adj-qty').value) || 0;
  const reason = document.getElementById('adj-reason').value.trim() || '—';
  if (qty <= 0) { alert('Enter a valid quantity.'); return; }

  const s = spares[editIndex];
  const originalQty = s.qtyInStock;
  
  if (type === 'deduct') {
    if (s.qtyInStock <= 0)        { alert('❌ Stock is already 0. Cannot deduct.'); return; }
    if (qty > s.qtyInStock)       { alert('❌ Only ' + s.qtyInStock + ' in stock. Cannot deduct ' + qty + '.'); return; }
  }

  try {
    // Update the entry with adjusted quantity
    const updatedQty = type === 'deduct' ? originalQty - qty : originalQty + qty;
    const movements = s.movements || [];
    movements.unshift({ 
      type, 
      qty, 
      reason, 
      date: new Date().toISOString().split('T')[0], 
      ref: '' 
    });

    await CsvStore.update('spareparts', s.id, {
      qtyInStock: updatedQty,
      movements
    });
    
    spares = await CsvStore.load('spareparts');
    document.getElementById('f-qty').value = updatedQty;
    updateStockIndicator();
    document.getElementById('adj-qty').value    = '1';
    document.getElementById('adj-reason').value = '';
    renderStats();
    renderTable();
  } catch (err) {
    console.error('Error adjusting stock:', err);
    alert('Error adjusting stock: ' + err.message);
  }
}

// ── DELETE ──────────────────────────────────────────────────────
async function deletePart(idx) {
  const partId = spares[idx].id;
  if (!confirm('Delete "' + spares[idx].spareName + '"?')) return;
  
  try {
    await CsvStore.remove('spareparts', partId);
    spares = await CsvStore.load('spareparts');
    renderStats();
    renderTable();
  } catch (err) {
    console.error('Error deleting part:', err);
    alert('Error deleting part: ' + err.message);
  }
}

// ── DETAIL VIEW ────────────────────────────────────────────────
function viewDetail(idx) {
  detailIdx = idx;
  const s   = spares[idx];
  const st  = stockStatus(s);
  const bdgC= st==='out'?'badge-out':st==='low'?'badge-low':'badge-ok';
  const bdgT= st==='out'?'OUT OF STOCK':st==='low'?'LOW STOCK':'OK';
  document.getElementById('d-title').textContent = '📦 ' + s.spareName;

  const mvtHTML = (s.movements && s.movements.length) ? `
    <table class="mvt-table"><thead><tr><th>Date</th><th>Type</th><th>Qty</th><th>Reason / Ref</th></tr></thead><tbody>
    ${s.movements.map(m=>`<tr>
      <td>${m.date||'—'}</td>
      <td style="color:${m.type==='add'?'#4ade80':'#f87171'};font-weight:600">${m.type==='add'?'➕ Added':'➖ Deducted'}</td>
      <td style="font-weight:600">${m.qty}</td>
      <td>${m.reason||'—'}${m.ref?' · '+m.ref:''}</td>
    </tr>`).join('')}
    </tbody></table>` : '<span style="color:#475569;font-size:13px">No stock movements recorded yet.</span>';

  document.getElementById('detail-content').innerHTML = `
    <div class="detail-section">
      <h3>🔩 Part Info</h3>
      <div class="detail-row"><span class="dk">Part ID</span><span class="dv">${s.id}</span></div>
      <div class="detail-row"><span class="dk">Spare Name</span><span class="dv"><strong>${s.spareName}</strong></span></div>
      <div class="detail-row"><span class="dk">Specification</span><span class="dv">${s.specification||'—'}</span></div>
      <div class="detail-row"><span class="dk">Condition</span><span class="dv">${s.newUsedRepaired||'—'}</span></div>
      <div class="detail-row"><span class="dk">Unit Price</span><span class="dv">${s.unitPrice?'₹'+Number(s.unitPrice).toLocaleString('en-IN'):'—'}</span></div>
    </div>
    <div class="detail-section">
      <h3>🏭 Location</h3>
      <div class="detail-row"><span class="dk">Machine</span><span class="dv">${s.machine||'—'}</span></div>
      <div class="detail-row"><span class="dk">Storage Location</span><span class="dv">${s.storageLocation||'—'}</span></div>
      <div class="detail-row"><span class="dk">Compartment</span><span class="dv">${s.compartment||'—'}</span></div>
      <div class="detail-row"><span class="dk">Supplier</span><span class="dv">${s.supplier||'—'}</span></div>
      <div class="detail-row"><span class="dk">Lead Time</span><span class="dv">${s.leadTime||'—'}</span></div>
    </div>
    <div class="detail-section">
      <h3>📊 Stock</h3>
      <div class="detail-row"><span class="dk">Qty in Stock</span><span class="dv" style="font-size:18px;font-weight:700;color:${st==='out'?'#f87171':st==='low'?'#fbbf24':'#4ade80'}">${s.qtyInStock}</span></div>
      <div class="detail-row"><span class="dk">Min. Stock Req.</span><span class="dv">${s.minStockReq}</span></div>
      <div class="detail-row"><span class="dk">Status</span><span class="dv"><span class="badge ${bdgC}">${bdgT}</span></span></div>
    </div>
    <div class="detail-section">
      <h3>📋 Stock Movement History</h3>
      ${mvtHTML}
    </div>`;

  document.getElementById('detailModal').classList.add('show');
}

function closeDetail() { document.getElementById('detailModal').classList.remove('show'); }
function editFromDetail() { closeDetail(); openEditModal(detailIdx); }

// ── EXCEL IMPORT ───────────────────────────────────────────────
async function importExcel(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const wb   = XLSX.read(new Uint8Array(e.target.result), { type:'array' });
      const ws   = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { header:1, defval:'' });
      const dataRows = rows.slice(2).filter(r => r[3]);
      if (!dataRows.length) { alert('No data rows found. Expected data from row 3 onward.'); return; }

      if (!confirm('Import ' + dataRows.length + ' spare parts?')) return;

      (async () => {
        try {
          const imported = dataRows.map(r => ({
            id:              'SP-' + String(Date.now() + Math.random()*999|0).slice(-6),
            machine:         String(r[0]||'').trim(),
            storageLocation: String(r[1]||'').trim(),
            compartment:     String(r[2]||'').trim(),
            spareName:       String(r[3]||'').trim(),
            specification:   String(r[4]||'').trim(),
            newUsedRepaired: String(r[5]||'New').trim(),
            unitPrice:       r[6]||'',
            qtyInStock:      parseInt(r[7]) || 0,
            minStockReq:     parseInt(r[8]) || 1,
            leadTime:        String(r[9]||'').trim(),
            supplier:        String(r[10]||'').trim(),
            discontinued:    String(r[11]||'').toLowerCase().includes('yes'),
            notes:           String(r[12]||'').trim(),
            movements:       [],
          }));

          for (const part of imported) {
            await CsvStore.append('spareparts', part);
          }
          
          spares = await CsvStore.load('spareparts');
          renderStats();
          renderTable();
          alert('✅ Imported ' + imported.length + ' spare parts successfully!');
        } catch (err) {
          console.error('Import error:', err);
          alert('Import failed: ' + err.message);
        }
      })();
    } catch(err) { alert('Import failed: ' + err.message); }
  };
  reader.readAsArrayBuffer(file);
  event.target.value = '';
}

// ── CLOSE ON OVERLAY CLICK ──────────────────────────────────────
document.getElementById('spModal').addEventListener('click',    function(e){ if(e.target===this) closeModal();  });
document.getElementById('detailModal').addEventListener('click', function(e){ if(e.target===this) closeDetail(); });

// ── CLOCK ──────────────────────────────────────────────────────
function updateClock() {
  document.getElementById('live-clock').textContent =
    new Date().toLocaleString('en-GB',{weekday:'short',year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit'});
}
updateClock(); 
setInterval(updateClock, 1000);

// ── INITIALIZATION ─────────────────────────────────────────────
async function initPage() {
  try {
    // Initialize CsvStore
    await CsvStore.init();
    
    // Load configuration and data
    config = await ConfigLoader.load();
    machines = await CsvStore.load('machines');
    spares = await CsvStore.load('spareparts');
    
    // Update page title with config
    document.title = '📦 ' + config.appTitle;
    if (document.querySelector('.navbar .logo')) {
      document.querySelector('.navbar .logo').textContent = '⚙️ ' + config.appTitle;
    }
    
    // Initialize UI
    await populateMachineDropdowns();
    renderStats();
    renderTable();
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
