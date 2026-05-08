/* ===== SERVICE WORKER REGISTRATION ===== */
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./service-worker.js').catch(console.warn);
    });
}

/* ===== UI CONTROLLER ===== */
document.addEventListener('DOMContentLoaded', () => {
    Store.load();
    initNavigation();
    initUpload();
    initExportImport();
    initActions();
    refreshDashboard();
});

function fmt(n) { return '₺' + Number(n||0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function fmtInt(n) { return '₺' + Number(n||0).toLocaleString('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 0 }); }
function pct(n) { return (n >= 0 ? '+' : '') + n.toFixed(2) + '%'; }

/* ===== NAVIGATION ===== */
function initNavigation() {
    document.querySelectorAll('.nav-item[data-view]').forEach(item => {
        item.addEventListener('click', e => {
            e.preventDefault();
            const view = item.dataset.view;
            document.querySelectorAll('.nav-item[data-view]').forEach(n => n.classList.remove('active'));
            item.classList.add('active');
            document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
            document.getElementById('view-' + view).classList.add('active');
            if (window.innerWidth <= 768) document.getElementById('sidebar').classList.remove('open');
            refreshView(view);
        });
    });
    document.getElementById('hamburger-btn').addEventListener('click', () => {
        document.getElementById('sidebar').classList.toggle('open');
    });
    document.getElementById('btn-view-all-tx').addEventListener('click', () => {
        document.querySelector('[data-view="transactions"]').click();
    });
}

/* ===== FILE UPLOAD ===== */
function initUpload() {
    const modal = document.getElementById('modal-upload');
    const zone = document.getElementById('upload-zone');
    const fileInput = document.getElementById('file-input');

    [document.getElementById('nav-upload-trigger'), document.getElementById('mobile-upload-btn')].forEach(btn => {
        if (btn) btn.addEventListener('click', e => { e.preventDefault(); modal.classList.add('open'); });
    });
    document.getElementById('modal-upload-close').addEventListener('click', () => modal.classList.remove('open'));
    modal.addEventListener('click', e => { if (e.target === modal) modal.classList.remove('open'); });
    document.getElementById('btn-browse').addEventListener('click', () => fileInput.click());

    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('dragover'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
    zone.addEventListener('drop', e => { e.preventDefault(); zone.classList.remove('dragover'); handleFiles(e.dataTransfer.files); });
    fileInput.addEventListener('change', () => { if (fileInput.files.length) handleFiles(fileInput.files); });
}

async function handleFiles(files) {
    const status = document.getElementById('upload-status');
    const log = document.getElementById('upload-log');
    const logContent = document.getElementById('upload-log-content');
    const bar = document.getElementById('progress-bar');
    const statusText = document.getElementById('upload-status-text');

    status.style.display = 'block';
    log.style.display = 'none';
    let output = '';
    let successCount = 0;

    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const progress = ((i + 1) / files.length * 100);
        bar.style.width = progress + '%';
        statusText.textContent = `Processing ${file.name}...`;

        try {
            let text = '';
            if (file.name.toLowerCase().endsWith('.pdf')) {
                text = await extractPDFText(file);
            } else {
                text = await file.text();
            }

            const result = Parser.parse(text);
            Store.addStatement(result);
            successCount++;

            const st = result.stats || {};
            output += `✓ ${file.name}\n`;
            output += `  Statement Date   : ${result.date}\n`;
            output += `  Portfolio Value   : ${fmt(result.portfolioValue)}\n`;
            output += `  Cash Balance      : ${fmt(result.cashBalance)}\n`;
            output += `  Holdings          : ${st.holdingsCount || 0}\n`;
            output += `  Investment Tx     : ${st.investmentTxCount || 0}\n`;
            output += `  Account Tx        : ${st.accountTxCount || 0}\n`;
            output += `  Dividend Tx       : ${st.dividendTxCount || 0}\n`;
            if (st.skippedCancelled) output += `  Skipped (İptal)   : ${st.skippedCancelled}\n`;
            if (st.skippedExpired)   output += `  Skipped (Süresi D): ${st.skippedExpired}\n`;
            if (st.skippedIgnored)   output += `  Skipped (Ignored) : ${st.skippedIgnored}\n`;
            if (st.warnings && st.warnings.length) {
                st.warnings.forEach(w => { output += `  ⚠ ${w}\n`; });
            }
            output += '\n';
        } catch (err) {
            output += `✗ ${file.name}: ${err.message}\n\n`;
        }
    }

    statusText.textContent = 'Complete!';
    log.style.display = 'block';
    logContent.textContent = output;
    refreshDashboard();

    if (successCount === 0) {
        toast('No statements imported. Check parse results.', 'error');
    } else {
        toast(`${successCount} statement${successCount > 1 ? 's' : ''} imported`, 'success');
    }

    setTimeout(() => { status.style.display = 'none'; bar.style.width = '0'; }, 3000);
}

async function extractPDFText(file) {
    if (typeof pdfjsLib === 'undefined') throw new Error('PDF.js not loaded');
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const Y_TOLERANCE = 3;
    const allLines = [];

    for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();

        // Group text items by y-coordinate (transform[5]) into visual lines
        const groups = [];
        for (const item of content.items) {
            const y = item.transform[5];
            const x = item.transform[4];
            const text = item.str;
            if (!text) continue;

            let matched = false;
            for (const g of groups) {
                if (Math.abs(g.y - y) < Y_TOLERANCE) {
                    g.items.push({ x, text });
                    // Update group y to average for better clustering
                    g.y = (g.y + y) / 2;
                    matched = true;
                    break;
                }
            }
            if (!matched) {
                groups.push({ y, items: [{ x, text }] });
            }
        }

        // Sort groups by y descending (PDF y goes bottom-up, so top of page = highest y)
        groups.sort((a, b) => b.y - a.y);

        for (const g of groups) {
            // Sort items left-to-right within each line
            g.items.sort((a, b) => a.x - b.x);
            const line = g.items.map(it => it.text).join(' ').trim();
            if (line) allLines.push(line);
        }
    }

    return allLines.join('\n');
}

/* ===== EXPORT / IMPORT ===== */
function initExportImport() {
    const modal = document.getElementById('modal-export');
    document.getElementById('nav-export-trigger').addEventListener('click', e => { e.preventDefault(); modal.classList.add('open'); });
    document.getElementById('modal-export-close').addEventListener('click', () => modal.classList.remove('open'));
    modal.addEventListener('click', e => { if (e.target === modal) modal.classList.remove('open'); });

    document.getElementById('btn-export-json').addEventListener('click', () => {
        Store.exportJSON();
        toast('Data exported successfully', 'success');
    });

    const importInput = document.getElementById('import-file-input');
    document.getElementById('btn-import-json').addEventListener('click', () => importInput.click());
    importInput.addEventListener('change', async () => {
        if (!importInput.files.length) return;
        try {
            await Store.importJSON(importInput.files[0]);
            toast('Data imported successfully', 'success');
            modal.classList.remove('open');
            refreshDashboard();
        } catch(e) {
            toast('Import failed: ' + e.message, 'error');
        }
    });
}

/* ===== ACTIONS ===== */
function initActions() {
    document.getElementById('nav-load-demo').addEventListener('click', e => {
        e.preventDefault();
        generateDemoData();
        toast('Demo data loaded — 12 months of sample portfolio data', 'success');
        refreshDashboard();
    });
    document.getElementById('nav-clear-data').addEventListener('click', e => {
        e.preventDefault();
        if (confirm('Delete all dashboard data? This cannot be undone.')) {
            Store.clear();
            Charts.destroyAll();
            toast('All data cleared', 'info');
            refreshDashboard();
        }
    });
    document.querySelectorAll('.period-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            refreshDashboard(btn.dataset.period);
        });
    });
    document.getElementById('tx-filter-type').addEventListener('change', () => refreshTransactions());
}

/* ===== REFRESH FUNCTIONS ===== */
function refreshDashboard(period) {
    const data = Store.data;
    const snaps = filterByPeriod(data.snapshots, period);
    const txs = filterByPeriod(data.transactions, period);

    // KPI
    const latest = snaps.length ? snaps[snaps.length - 1] : null;
    const prev = snaps.length > 1 ? snaps[snaps.length - 2] : null;
    document.getElementById('kpi-portfolio-val').textContent = latest ? fmt(latest.value) : '₺0.00';
    const change = latest && prev ? ((latest.value - prev.value) / prev.value * 100) : 0;
    const chEl = document.getElementById('kpi-portfolio-change');
    chEl.textContent = latest ? pct(change) : '+0.00%';
    chEl.className = 'kpi-change ' + (change >= 0 ? 'positive' : 'negative');
    document.getElementById('kpi-cash-val').textContent = latest ? fmt(latest.cash) : '₺0.00';
    const totalDep = txs.filter(t => t.type === 'deposit').reduce((s,t) => s + t.amount, 0);
    document.getElementById('kpi-deposits-val').textContent = fmtInt(totalDep);
    document.getElementById('kpi-deposits-count').textContent = txs.filter(t => t.type === 'deposit').length + ' transactions';
    const tradeVol = txs.filter(t => ['buy','sell'].includes(t.type)).reduce((s,t) => s + t.amount, 0);
    document.getElementById('kpi-trades-val').textContent = fmtInt(tradeVol);
    document.getElementById('kpi-trades-count').textContent = txs.filter(t => ['buy','sell'].includes(t.type)).length + ' trades';

    const lastDate = data.statements.length ? data.statements[data.statements.length-1].date : null;
    document.getElementById('dashboard-subtitle').textContent = lastDate ? 'Last statement: ' + lastDate : 'No data — upload a statement or load demo data';

    // Charts
    Charts.renderPortfolioTimeline(snaps);
    Charts.renderAllocation(data.holdings);
    Charts.renderCashflow(txs);
    Charts.renderTradeVolume(txs);

    // Recent TX
    renderRecentTransactions(data.transactions.slice(0, 10));
}

function refreshView(view) {
    const data = Store.data;
    if (view === 'holdings') refreshHoldings();
    if (view === 'transactions') refreshTransactions();
    if (view === 'cashflow') refreshCashflow();
    if (view === 'analytics') refreshAnalytics();
}

function refreshHoldings() {
    const data = Store.data;
    const h = data.holdings || [];
    const total = h.reduce((s, x) => s + x.marketValue, 0);
    document.getElementById('holdings-total-value').textContent = fmt(total);
    document.getElementById('holdings-count').textContent = h.length;
    document.getElementById('holdings-largest').textContent = h.length ? h.sort((a,b) => b.marketValue - a.marketValue)[0].name.slice(0,25) : '—';

    const tbody = document.getElementById('tbody-holdings');
    if (!h.length) { tbody.innerHTML = '<tr class="empty-row"><td colspan="6">No holdings data.</td></tr>'; return; }
    tbody.innerHTML = h.map(x => {
        const w = total ? (x.marketValue / total * 100).toFixed(1) : 0;
        return `<tr><td>${x.name}</td><td style="font-family:var(--font-mono);font-size:.8rem;color:var(--text-muted)">${x.code}</td><td class="text-right">${x.units.toLocaleString('tr-TR',{maximumFractionDigits:4})}</td><td class="text-right">${x.unitPrice.toLocaleString('tr-TR',{minimumFractionDigits:4})}</td><td class="text-right" style="font-weight:600">${fmt(x.marketValue)}</td><td class="text-right"><span style="color:var(--accent-blue)">${w}%</span></td></tr>`;
    }).join('');
    Charts.renderHoldingsBreakdown(h);
}

function refreshTransactions() {
    const data = Store.data;
    const filter = document.getElementById('tx-filter-type').value;
    let txs = data.transactions;
    if (filter !== 'all') txs = txs.filter(t => t.type === filter);
    document.getElementById('tx-subtitle').textContent = `${txs.length} transactions found`;

    const tbody = document.getElementById('tbody-transactions');
    if (!txs.length) { tbody.innerHTML = '<tr class="empty-row"><td colspan="7">No transactions found.</td></tr>'; return; }
    tbody.innerHTML = txs.slice(0, 100).map(t => `<tr>
        <td style="font-family:var(--font-mono);font-size:.8rem">${t.date}</td>
        <td><span class="tx-badge ${t.type}">${t.type}</span></td>
        <td>${t.description}</td>
        <td style="color:var(--text-muted)">${t.fund || '—'}</td>
        <td class="text-right">${t.units ? t.units.toLocaleString('tr-TR',{maximumFractionDigits:4}) : '—'}</td>
        <td class="text-right">${t.price ? fmt(t.price) : '—'}</td>
        <td class="text-right" style="font-weight:600;color:${['deposit','sell','dividend','income'].includes(t.type)?'var(--accent-green)':['withdrawal','buy','fee','tax'].includes(t.type)?'var(--accent-red)':'var(--text-primary)'}">₺${Math.abs(t.amount).toLocaleString('tr-TR',{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
    </tr>`).join('');
}

function refreshCashflow() {
    const data = Store.data;
    const txs = data.transactions;
    const inflows = txs.filter(t => ['deposit','dividend','income'].includes(t.type)).reduce((s,t) => s + t.amount, 0);
    const outflows = txs.filter(t => ['withdrawal','fee','tax'].includes(t.type)).reduce((s,t) => s + t.amount, 0);
    document.getElementById('cf-inflows').textContent = fmt(inflows);
    document.getElementById('cf-outflows').textContent = fmt(outflows);
    document.getElementById('cf-net').textContent = fmt(inflows - outflows);
    Charts.renderCashflowDetail(txs);
    Charts.renderCumulativeBalance(data.snapshots);
}

function refreshAnalytics() {
    const data = Store.data;
    document.getElementById('an-statements').textContent = data.statements.length;
    if (data.statements.length) {
        const first = data.statements[0].date, last = data.statements[data.statements.length-1].date;
        document.getElementById('an-range').textContent = first + ' → ' + last;
    }
    const deposits = data.transactions.filter(t => t.type === 'deposit');
    const months = new Set(deposits.map(t => t.date.slice(0,7)));
    const totalDep = deposits.reduce((s,t) => s + t.amount, 0);
    document.getElementById('an-avg-deposit').textContent = months.size ? fmtInt(totalDep / months.size) : '₺0';
    if (data.snapshots.length >= 2) {
        const first = data.snapshots[0].value, last = data.snapshots[data.snapshots.length-1].value;
        const growth = first ? ((last - first) / first * 100) : 0;
        document.getElementById('an-growth').textContent = pct(growth);
    }
    Charts.renderValueVsDeposits(data.snapshots, data.transactions);
    Charts.renderWeightsOverTime(data);
}

function renderRecentTransactions(txs) {
    const tbody = document.getElementById('tbody-recent-tx');
    if (!txs.length) { tbody.innerHTML = '<tr class="empty-row"><td colspan="4">No transactions yet. Upload a statement or load demo data.</td></tr>'; return; }
    tbody.innerHTML = txs.map(t => `<tr>
        <td style="font-family:var(--font-mono);font-size:.8rem">${t.date}</td>
        <td><span class="tx-badge ${t.type}">${t.type}</span></td>
        <td>${t.description}</td>
        <td class="text-right" style="font-weight:600;color:${['deposit','sell','dividend','income'].includes(t.type)?'var(--accent-green)':'var(--text-primary)'}">${fmt(t.amount)}</td>
    </tr>`).join('');
}

function filterByPeriod(arr, period) {
    if (!period || period === 'all' || !arr.length) return arr;
    const now = new Date();
    const months = { '1m': 1, '3m': 3, '6m': 6, '1y': 12 };
    const m = months[period] || 999;
    const cutoff = new Date(now.getFullYear(), now.getMonth() - m, 1).toISOString().slice(0,10);
    return arr.filter(item => item.date >= cutoff);
}

/* ===== TOAST ===== */
function toast(msg, type = 'info') {
    const container = document.getElementById('toast-container');
    const el = document.createElement('div');
    el.className = 'toast ' + type;
    el.textContent = msg;
    container.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; el.style.transform = 'translateX(20px)'; setTimeout(() => el.remove(), 300); }, 4000);
}
