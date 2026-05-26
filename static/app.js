// ── Content Analyzer Dashboard — Main JS (Streamlit edition) ─────────────────
//
// API calls are routed through the Streamlit FastAPI bridge at /_stcore/...
// The bridge URL is injected by the Streamlit host via window.STREAMLIT_API_BASE.
// Fallback: calls go to /api/... which Streamlit serves via its component server.

const API = (window.STREAMLIT_API_BASE || '').replace(/\/$/, '');
let currentView = 'dashboard';
let globalChannel = '';
let globalDate = '';
let pieChart = null;
let pieChartBarc = null;
let pieChartTabsons = null;

async function readErrorMessage(res) {
  const text = await res.text();
  if (!text) return `Request failed (${res.status})`;
  try {
    const data = JSON.parse(text);
    return data.error || data.message || text;
  } catch (e) {
    return text.slice(0, 300);
  }
}

async function readJsonResponse(res) {
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch (e) {
    throw new Error(`Server returned non-JSON (${res.status}): ${text.slice(0, 300)}`);
  }
  if (!res.ok || data.error) {
    throw new Error(data.error || data.message || `Request failed (${res.status})`);
  }
  return data;
}

async function fetchJson(url, options) {
  const res = await fetch(url, options);
  return readJsonResponse(res);
}

async function fetchBlobResponse(url, options) {
  const res = await fetch(url, options);
  if (!res.ok) throw new Error(await readErrorMessage(res));
  return res;
}

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => { loadChannelDates(); });

// ── Navigation ────────────────────────────────────────────────────────────────
function navigate(view) {
  currentView = view;
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const el = document.getElementById('view-' + view);
  if (el) el.classList.add('active');
  const nav = document.querySelector(`[data-view="${view}"]`);
  if (nav) nav.classList.add('active');
  const titles = { dashboard: 'Dashboard', analysis: 'Sheet Data', 'commercial-comparison': 'Commercial Comparison', 'compare-report': 'Compare Report', download: 'Download Reports' };
  document.getElementById('topbar-title').textContent = titles[view] || 'Dashboard';
  if (view === 'dashboard') loadDashboard();
  if (view === 'analysis') loadAnalysisSheets();
  if (view === 'commercial-comparison') loadCommercialComparison();
}

// ── Global Filters ────────────────────────────────────────────────────────────
async function loadChannelDates() {
  try {
    const data = await fetchJson(API + '/api/channels-dates');
    if (data.error) { showToast(data.error, 'error'); return; }
    if (!Array.isArray(data)) { showToast('Unexpected response from server', 'error'); return; }
    const chSel = document.getElementById('global-channel');
    const dtSel = document.getElementById('global-date');
    const channels = [...new Set(data.map(d => d.channel_name))];
    chSel.innerHTML = '<option value="">Select Channel</option>' + channels.map(c => `<option value="${c}">${c}</option>`).join('');
    chSel.onchange = () => {
      globalChannel = chSel.value;
      const dates = data.filter(d => d.channel_name === globalChannel).map(d => d.date);
      dtSel.innerHTML = '<option value="">Select Date</option>' + dates.map(d => `<option value="${d}">${d}</option>`).join('');
      dtSel.onchange = () => { globalDate = dtSel.value; onGlobalFilterChange(); };
    };
  } catch (e) {
    showToast('Failed to connect to server: ' + e.message, 'error');
  }
}

function onGlobalFilterChange() {
  if (!globalChannel || !globalDate) return;
  if (currentView === 'dashboard') loadDashboard();
  if (currentView === 'analysis') loadAnalysisSheets();
  if (currentView === 'commercial-comparison') loadCommercialComparison();
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
async function loadDashboard() {
  if (!globalChannel || !globalDate) return;
  const source = document.getElementById('dash-source').value;
  const dataType = document.getElementById('dash-datatype').value;
  try {
    const d = await fetchJson(`${API}/api/dashboard?channel=${encodeURIComponent(globalChannel)}&date=${encodeURIComponent(globalDate)}&source=${encodeURIComponent(source)}&data_type=${encodeURIComponent(dataType)}`);
    if (d.error) { showToast(d.error, 'error'); return; }
    renderKPIs(d, source, dataType);
    renderPieChart(d, source, dataType);
  } catch (e) { showToast('Failed to load dashboard: ' + e.message, 'error'); }
}

function renderKPIs(d, source, dataType) {
  const container = document.getElementById('kpi-row');
  if (source === 'TABSONS-BARC') {
    const addVals = (a, b) => {
      const na = parseNum(a), nb = parseNum(b);
      if (typeof a === 'string' && a.includes(':')) {
        const total = na + nb;
        const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
        return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
      }
      return na + nb;
    };
    const totalLineItem   = addVals(d.tabsons_total,        d.barc_total);
    const totalCommercial = addVals(d.tabsons_commercial,   d.barc_commercial);
    const totalPromo      = addVals(d.tabsons_promo,        d.barc_promo);
    const totalPromoSp    = addVals(d.tabsons_promo_sponsor,d.barc_promo_sponsor);
    const totalProgram    = addVals(d.tabsons_program !== undefined ? d.tabsons_program : 0,
                                   d.barc_program    !== undefined ? d.barc_program    : 0);
    container.innerHTML = `
      <div class="kpi-card"><div class="kpi-label">Total Line Item</div><div class="kpi-value">${totalLineItem}</div><div class="kpi-sub">TABSONS: ${d.tabsons_total} &nbsp;|&nbsp; BARC: ${d.barc_total}</div></div>
      <div class="kpi-card"><div class="kpi-label">Commercial</div><div class="kpi-value">${totalCommercial}</div><div class="kpi-sub">TABSONS: ${d.tabsons_commercial} &nbsp;|&nbsp; BARC: ${d.barc_commercial}</div></div>
      <div class="kpi-card"><div class="kpi-label">Promo</div><div class="kpi-value">${totalPromo}</div><div class="kpi-sub">TABSONS: ${d.tabsons_promo} &nbsp;|&nbsp; BARC: ${d.barc_promo}</div></div>
      <div class="kpi-card"><div class="kpi-label">PromoSponsor</div><div class="kpi-value">${totalPromoSp}</div><div class="kpi-sub">TABSONS: ${d.tabsons_promo_sponsor} &nbsp;|&nbsp; BARC: ${d.barc_promo_sponsor}</div></div>
      <div class="kpi-card kpi-program"><div class="kpi-label">Program</div><div class="kpi-value">${totalProgram}</div><div class="kpi-sub">TABSONS: ${d.tabsons_program !== undefined ? d.tabsons_program : '—'} &nbsp;|&nbsp; BARC: ${d.barc_program !== undefined ? d.barc_program : '—'}</div></div>`;
  } else {
    container.innerHTML = `
      <div class="kpi-card"><div class="kpi-label">Total Line Item</div><div class="kpi-value">${d.total_line_item}</div><div class="kpi-sub">${dataType}</div></div>
      <div class="kpi-card"><div class="kpi-label">Commercial</div><div class="kpi-value">${d.commercial}</div><div class="kpi-sub">${dataType}</div></div>
      <div class="kpi-card"><div class="kpi-label">Promo</div><div class="kpi-value">${d.promo}</div><div class="kpi-sub">${dataType}</div></div>
      <div class="kpi-card"><div class="kpi-label">PromoSponsor</div><div class="kpi-value">${d.promo_sponsor}</div><div class="kpi-sub">${dataType}</div></div>
      <div class="kpi-card kpi-program"><div class="kpi-label">Program</div><div class="kpi-value">${d.program !== undefined ? d.program : '—'}</div><div class="kpi-sub">${dataType}</div></div>`;
  }
}

function parseNum(v) {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'number') return v;
  const s = String(v).trim();
  if (!s || s === '—') return 0;
  if (s.includes(':')) {
    const parts = s.split(':').map(Number);
    if (parts.length === 3) return parts[0]*3600 + parts[1]*60 + parts[2];
  }
  const n = parseFloat(s.replace(/,/g, ''));
  return isNaN(n) ? 0 : n;
}

function renderPieChart(d, source, dataType) {
  const singleWrap = document.getElementById('chart-single');
  const dualWrap   = document.getElementById('chart-dual');

  if (pieChart)        { pieChart.destroy();        pieChart = null; }
  if (pieChartBarc)    { pieChartBarc.destroy();    pieChartBarc = null; }
  if (pieChartTabsons) { pieChartTabsons.destroy(); pieChartTabsons = null; }

  const palette1 = ['#2196F3', '#FF9800', '#00BCD4', '#9C27B0'];
  const palette2 = ['#00E676', '#FF4081', '#FFD740', '#536DFE'];

  const chartOpts = (labels, vals, palette) => ({
    type: 'doughnut',
    data: {
      labels,
      datasets: [{ data: vals, backgroundColor: palette, borderWidth: 0, hoverOffset: 8 }]
    },
    options: {
      responsive: true, maintainAspectRatio: true,
      plugins: {
        legend: { position: 'bottom', labels: { color: '#94a3b8', font: { size: 11 }, padding: 14, boxWidth: 12 } },
        tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${ctx.parsed}` } }
      },
      cutout: '62%'
    }
  });

  if (source === 'TABSONS-BARC') {
    singleWrap.style.display = 'none';
    dualWrap.style.display   = 'flex';

    const bLabels = ['Commercial', 'Promo', 'PromoSponsor', 'Program'];
    const bVals   = [parseNum(d.barc_commercial), parseNum(d.barc_promo), parseNum(d.barc_promo_sponsor), parseNum(d.barc_program)];
    const tVals   = [parseNum(d.tabsons_commercial), parseNum(d.tabsons_promo), parseNum(d.tabsons_promo_sponsor), parseNum(d.tabsons_program)];

    pieChartBarc    = new Chart(document.getElementById('pieChartBarc'),    chartOpts(bLabels, bVals, palette1));
    pieChartTabsons = new Chart(document.getElementById('pieChartTabsons'), chartOpts(bLabels, tVals, palette2));
  } else {
    singleWrap.style.display = 'flex';
    dualWrap.style.display   = 'none';
    const labels = ['Commercial', 'Promo', 'PromoSponsor', 'Program'];
    const vals   = [parseNum(d.commercial), parseNum(d.promo), parseNum(d.promo_sponsor), parseNum(d.program)];
    const palette = source === 'BARC XML' ? palette1 : palette2;
    pieChart = new Chart(document.getElementById('pieChart'), chartOpts(labels, vals, palette));
  }
}

// ── Analysis / Sheet Data ─────────────────────────────────────────────────────
async function loadAnalysisSheets() {
  if (!globalChannel || !globalDate) return;
  try {
    const data = await fetchJson(`${API}/api/sheets?channel=${encodeURIComponent(globalChannel)}&date=${encodeURIComponent(globalDate)}`);
    const sel = document.getElementById('analysis-sheet');
    sel.innerHTML = '<option value="">Select Sheet</option>' + data.map(s =>
      `<option value="${s.sheet_name}">${s.sheet_name} (${s.row_count} rows)</option>`).join('');
    document.getElementById('analysis-table-container').innerHTML = '';
  } catch (e) { showToast('Failed to load sheets: ' + e.message, 'error'); }
}

async function loadSheetData() {
  const sheet = document.getElementById('analysis-sheet').value;
  if (!sheet || !globalChannel || !globalDate) return;
  showLoading(true);
  try {
    const d = await fetchJson(`${API}/api/sheet-data?channel=${encodeURIComponent(globalChannel)}&date=${encodeURIComponent(globalDate)}&sheet=${encodeURIComponent(sheet)}`);
    renderSheetTable(d);
  } catch (e) { showToast('Failed to load sheet: ' + e.message, 'error'); }
  showLoading(false);
}

function renderSheetTable(d) {
  const container = document.getElementById('analysis-table-container');
  const rows = d.rows || [];
  if (!rows.length) { container.innerHTML = '<p style="color:var(--muted);padding:20px">No data</p>'; return; }
  const headers = rows[0];
  const bodyRows = rows.slice(1);
  const thead = `<thead><tr>${headers.map(h => `<th>${escHtml(h)}</th>`).join('')}</tr></thead>`;
  const tbody = `<tbody>${bodyRows.map(r =>
    `<tr>${r.map(c => `<td>${escHtml(c)}</td>`).join('')}</tr>`).join('')}</tbody>`;
  container.innerHTML = `<div class="data-table-wrap">
    <div class="table-header"><h3>${escHtml(d.sheet_name)}</h3><span style="color:var(--muted);font-size:11px;margin-left:auto">${d.row_count} rows × ${d.col_count} cols</span></div>
    <div class="table-scroll"><table class="data-table">${thead}${tbody}</table></div></div>`;
}

// ── Commercial Comparison ─────────────────────────────────────────────────────
async function loadCommercialComparison() {
  if (!globalChannel || !globalDate) return;
  showLoading(true);
  try {
    const d = await fetchJson(`${API}/api/commercial-comparison?channel=${encodeURIComponent(globalChannel)}&date=${encodeURIComponent(globalDate)}`);
    renderCommercialTables(d);
  } catch (e) { showToast('Failed to load commercial data: ' + e.message, 'error'); }
  showLoading(false);
}

function renderCommercialTables(d) {
  const container = document.getElementById('commercial-tables');
  const matched   = d.matched   || [];
  const unmatched = d.unmatched || [];

  const groupPairs = (rows) => {
    const pairs = [];
    for (let i = 0; i < rows.length; i += 2) {
      const barc = rows[i];
      const nct  = rows[i+1];
      if (barc && nct) pairs.push({ barc, nct });
      else if (barc)   pairs.push({ barc, nct: null });
    }
    return pairs;
  };

  let totalBarcCount = 0, totalNctCount = 0, totalBarcDur = '', totalNctDur = '';
  let allBarcBrands = 0, allNctBrands = 0, unmatchedNct = 0;

  const matchedPairs   = groupPairs(matched);
  const unmatchedPairs = groupPairs(unmatched);

  matchedPairs.forEach(p => {
    if (p.barc) {
      totalBarcCount += parseInt(p.barc.barc_count) || 0;
      allBarcBrands++;
    }
    if (p.nct) {
      totalNctCount += parseInt(p.nct.nct_count) || 0;
      allNctBrands++;
    }
  });
  unmatchedPairs.forEach(p => { if (p.nct) unmatchedNct++; });

  const matchedRows = matchedPairs.map(p => `
    <tr>
      <td class="td-barc">${escHtml(p.barc ? p.barc.barc_brand : '—')}</td>
      <td class="td-nct">${escHtml(p.nct  ? p.nct.nct_brand   : '—')}</td>
      <td class="td-barc">${escHtml(p.barc ? p.barc.barc_count    : '—')}</td>
      <td class="td-nct">${escHtml(p.nct  ? p.nct.nct_count     : '—')}</td>
      <td class="td-barc">${escHtml(p.barc ? p.barc.barc_duration : '—')}</td>
      <td class="td-nct">${escHtml(p.nct  ? p.nct.nct_duration   : '—')}</td>
      <td class="td-nct">${escHtml(p.nct  ? p.nct.nct_ps_count   : '—')}</td>
      <td class="td-nct">${escHtml(p.nct  ? p.nct.nct_ps_duration: '—')}</td>
      <td>${escHtml(p.barc ? p.barc.remarks : '')}</td>
      <td><button class="action-btn remove" onclick="removeBrand('${esc(p.barc ? p.barc.barc_brand : '')}')">Remove</button></td>
    </tr>`).join('');

  const unmatchedRows = unmatchedPairs.map(p => `
    <tr>
      <td class="td-barc">${escHtml(p.barc ? p.barc.barc_brand : '—')}</td>
      <td class="td-nct">${escHtml(p.nct  ? p.nct.nct_brand   : '—')}</td>
      <td class="td-nct">${escHtml(p.nct  ? p.nct.nct_count   : '—')}</td>
      <td class="td-nct">${escHtml(p.nct  ? p.nct.nct_duration: '—')}</td>
      <td><button class="action-btn merge" onclick="mergeBrand('${esc(p.nct ? p.nct.nct_brand : '')}')">Merge</button></td>
    </tr>`).join('');

  container.innerHTML = `
  <div class="data-table-wrap" style="margin-bottom:20px">
    <div class="comm-section-header matched" style="padding:10px 16px;display:flex;align-items:center;gap:8px">
      <span class="comm-section-title">✓ MATCHED</span>
      <span class="comm-section-count">${matchedPairs.length} pairs</span>
    </div>
    <div class="table-scroll">
      <table class="data-table comm-table">
        <thead><tr>
          <th class="th-barc">BARC Brand</th><th class="th-nct">NCT Brand</th>
          <th class="th-barc">BARC Ct</th><th class="th-nct">NCT Ct</th>
          <th class="th-barc">BARC Dur</th><th class="th-nct">NCT Dur</th>
          <th class="th-nct">NCT PS Ct</th><th class="th-nct">NCT PS Dur</th>
          <th class="th-common">Remarks</th><th class="th-action">Action</th>
        </tr></thead>
        <tbody>${matchedRows}</tbody>
        <tfoot><tr>
          <td colspan="2" style="font-weight:700;color:var(--accent2)">TOTALS</td>
          <td>${totalBarcCount || '—'}</td><td>${totalNctCount || '—'}</td>
          <td>${totalBarcDur || '—'}</td><td>${totalNctDur || '—'}</td>
          <td colspan="2">
            <span class="total-badge barc-badge">${allBarcBrands} BARC unique</span>
            <span class="total-badge nct-badge">${allNctBrands} NCT unique</span>
            ${unmatchedNct > 0 ? `<span class="total-note">NCT Tagging less than BARC by ${unmatchedNct}</span>` : ''}
          </td>
          <td colspan="2"></td>
        </tr></tfoot>
      </table>
    </div>
  </div>

  <div class="data-table-wrap">
    <div class="comm-section-header unmatched" style="padding:10px 16px;display:flex;align-items:center;gap:8px">
      <span class="comm-section-title">✗ NOT MATCHED</span>
      <span class="comm-section-count">${unmatchedPairs.length} items</span>
    </div>
    <div class="table-scroll">
      <table class="data-table comm-table">
        <thead><tr>
          <th class="th-barc">BARC Brand</th><th class="th-nct">NCT Brand</th>
          <th class="th-nct">NCT Count</th><th class="th-nct">NCT Duration</th>
          <th class="th-action">Action</th>
        </tr></thead>
        <tbody>${unmatchedRows}</tbody>
      </table>
    </div>
  </div>`;
}

function escHtml(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function esc(s) { return (s||'').replace(/'/g,"\\'").replace(/"/g,'&quot;'); }

// ── Brand actions ─────────────────────────────────────────────────────────────
async function removeBrand(brandName) {
  if (!confirm(`Unmatch "${brandName}" — move it back to NOT MATCHED?`)) return;
  showLoading(true);
  try {
    const d = await fetchJson(API+'/api/commercial/move-brand', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ channel: globalChannel, date: globalDate, action: 'remove_from_matched', brand_name: brandName })
    });
    if (d.error) throw new Error(d.error);
    showToast(`"${brandName}" moved to Not Matched`, 'success');
    loadCommercialComparison();
  } catch(e) { showToast('Error: '+e.message,'error'); }
  showLoading(false);
}

async function mergeBrand(brandName) {
  const target = prompt(`Match "${brandName}" to which BARC brand?\n\nEnter the exact BARC brand name:`);
  if (!target || !target.trim()) return;
  showLoading(true);
  try {
    const d = await fetchJson(API+'/api/commercial/move-brand', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ channel: globalChannel, date: globalDate, action: 'merge_to_matched', brand_name: brandName, target_barc_brand: target.trim() })
    });
    if (d.error) throw new Error(d.error);
    showToast(`"${brandName}" matched to "${target.trim()}"`, 'success');
    loadCommercialComparison();
  } catch(e) { showToast('Error: '+e.message,'error'); }
  showLoading(false);
}

// ── Compare Report ────────────────────────────────────────────────────────────
function onCompareFileSelect(e) {
  const file = e.target.files[0];
  if (!file) return;
  document.getElementById('compare-file-info').innerHTML = `<div style="display:flex;align-items:center;gap:10px;padding:10px;background:var(--surface2);border-radius:7px;margin-top:10px"><span style="color:#93c5fd;font-family:monospace;font-size:12px">${file.name}</span><span style="color:var(--muted);font-size:11px">${fmtSize(file.size)}</span></div>`;
  document.getElementById('compare-run-btn').style.display = 'inline-flex';
}

async function runCompare() {
  const input = document.getElementById('compare-file-input');
  const file = input.files[0];
  if (!file) { showToast('Please select a file','error'); return; }
  showLoading(true);
  try {
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetchBlobResponse(API+'/api/compare',{method:'POST',body:fd});
    const blob = await res.blob();
    let filename = 'comparison_result.xlsx';
    const disp = res.headers.get('Content-Disposition');
    if (disp) { const m = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/.exec(disp); if(m) filename = m[1].replace(/['"]/g,''); }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href=url; a.download=filename; a.click();
    setTimeout(()=>URL.revokeObjectURL(url),60000);
    showToast('Comparison complete! File downloaded.','success');
    loadChannelDates();
  } catch(e) { showToast('Error: '+e.message,'error'); }
  showLoading(false);
}

async function downloadTemplate() {
  try {
    const res = await fetchBlobResponse(API+'/api/template');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href=url; a.download='brand_comparison_template.xlsx'; a.click();
    showToast('Template downloaded','success');
  } catch(e) { showToast('Error downloading template','error'); }
}

// ── Downloads ─────────────────────────────────────────────────────────────────
async function downloadReport(type) {
  if (!globalChannel || !globalDate) { showToast('Select channel and date first','error'); return; }
  showLoading(true);
  try {
    const url = `${API}/api/download/${type}?channel=${encodeURIComponent(globalChannel)}&date=${encodeURIComponent(globalDate)}`;
    const res = await fetchBlobResponse(url);
    const blob = await res.blob();
    let filename = `report_${type}.xlsx`;
    const disp = res.headers.get('Content-Disposition');
    if (disp) { const m = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/.exec(disp); if(m) filename = m[1].replace(/['"]/g,''); }
    const u = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href=u; a.download=filename; a.click();
    showToast(`${type} report downloaded!`,'success');
  } catch(e) { showToast('Error: '+e.message,'error'); }
  showLoading(false);
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtSize(b) { if(b<1024)return b+' B'; if(b<1048576)return(b/1024).toFixed(1)+' KB'; return(b/1048576).toFixed(1)+' MB'; }

function showToast(msg, type='info') {
  let t = document.getElementById('toast');
  if (!t) { t=document.createElement('div'); t.id='toast'; t.className='toast'; document.body.appendChild(t); }
  t.textContent = msg; t.className = 'toast show ' + type;
  setTimeout(()=>{ t.className='toast'; }, 3500);
}

function showLoading(show) {
  let l = document.getElementById('loading-overlay');
  if (!l) { l=document.createElement('div'); l.id='loading-overlay'; l.className='loading-overlay'; l.innerHTML='<div class="spinner"></div>'; document.body.appendChild(l); }
  l.classList.toggle('show', show);
}