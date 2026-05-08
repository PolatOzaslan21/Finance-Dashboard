/* ===== CHART MANAGER ===== */
const Charts = {
    instances: {},
    colors: {
        blue: 'rgba(59,130,246,1)', blueAlpha: 'rgba(59,130,246,.15)',
        green: 'rgba(16,185,129,1)', greenAlpha: 'rgba(16,185,129,.15)',
        red: 'rgba(239,68,68,1)', redAlpha: 'rgba(239,68,68,.15)',
        cyan: 'rgba(6,182,212,1)', purple: 'rgba(139,92,246,1)',
        orange: 'rgba(245,158,11,1)', pink: 'rgba(236,72,153,1)',
        palette: ['rgba(59,130,246,1)','rgba(16,185,129,1)','rgba(139,92,246,1)','rgba(245,158,11,1)','rgba(236,72,153,1)','rgba(6,182,212,1)','rgba(251,146,60,1)'],
        paletteBg: ['rgba(59,130,246,.7)','rgba(16,185,129,.7)','rgba(139,92,246,.7)','rgba(245,158,11,.7)','rgba(236,72,153,.7)','rgba(6,182,212,.7)','rgba(251,146,60,.7)']
    },
    defaultOpts() {
        return {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { labels: { color: '#94a3b8', font: { family: "'Inter',sans-serif", size: 11 }, boxWidth: 12, padding: 16 } } },
            scales: {
                x: { ticks: { color: '#64748b', font: { size: 10 } }, grid: { color: 'rgba(30,41,59,.5)', drawBorder: false } },
                y: { ticks: { color: '#64748b', font: { size: 10 }, callback: v => '₺' + (v >= 1000 ? (v/1000).toFixed(0)+'K' : v) }, grid: { color: 'rgba(30,41,59,.5)', drawBorder: false } }
            }
        };
    },
    destroy(id) { if (this.instances[id]) { this.instances[id].destroy(); delete this.instances[id]; } },
    destroyAll() { Object.keys(this.instances).forEach(id => this.destroy(id)); },

    renderPortfolioTimeline(snapshots) {
        this.destroy('chart-portfolio-timeline');
        const ctx = document.getElementById('chart-portfolio-timeline');
        if (!ctx) return;
        const labels = snapshots.map(s => this._fmtDate(s.date));
        const opts = this.defaultOpts();
        opts.plugins.legend = { display: false };
        this.instances['chart-portfolio-timeline'] = new Chart(ctx, {
            type: 'line',
            data: { labels, datasets: [{ label: 'Portfolio Value', data: snapshots.map(s => s.value), borderColor: this.colors.blue, backgroundColor: this.colors.blueAlpha, fill: true, tension: .4, pointRadius: 4, pointHoverRadius: 7, pointBackgroundColor: this.colors.blue, borderWidth: 2.5 }] },
            options: opts
        });
    },

    renderAllocation(holdings) {
        this.destroy('chart-allocation');
        const ctx = document.getElementById('chart-allocation');
        if (!ctx || !holdings.length) return;
        const opts = { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { color: '#94a3b8', font: { family: "'Inter',sans-serif", size: 11 }, padding: 12, boxWidth: 12 } } } };
        this.instances['chart-allocation'] = new Chart(ctx, {
            type: 'doughnut',
            data: { labels: holdings.map(h => h.name), datasets: [{ data: holdings.map(h => h.marketValue), backgroundColor: this.colors.paletteBg, borderColor: this.colors.palette, borderWidth: 2, hoverOffset: 8 }] },
            options: opts
        });
    },

    renderCashflow(transactions) {
        this.destroy('chart-cashflow');
        const ctx = document.getElementById('chart-cashflow');
        if (!ctx) return;
        const monthly = this._groupByMonth(transactions);
        const labels = Object.keys(monthly).sort();
        const deposits = labels.map(m => monthly[m].filter(t => t.type === 'deposit').reduce((s,t) => s + t.amount, 0));
        const withdrawals = labels.map(m => monthly[m].filter(t => t.type === 'withdrawal').reduce((s,t) => s + t.amount, 0));
        const opts = this.defaultOpts();
        this.instances['chart-cashflow'] = new Chart(ctx, {
            type: 'bar',
            data: { labels: labels.map(l => this._fmtMonth(l)), datasets: [
                { label: 'Deposits', data: deposits, backgroundColor: this.colors.greenAlpha, borderColor: this.colors.green, borderWidth: 1.5, borderRadius: 4 },
                { label: 'Withdrawals', data: withdrawals, backgroundColor: this.colors.redAlpha, borderColor: this.colors.red, borderWidth: 1.5, borderRadius: 4 }
            ] },
            options: opts
        });
    },

    renderTradeVolume(transactions) {
        this.destroy('chart-trade-volume');
        const ctx = document.getElementById('chart-trade-volume');
        if (!ctx) return;
        const monthly = this._groupByMonth(transactions);
        const labels = Object.keys(monthly).sort();
        const buys = labels.map(m => monthly[m].filter(t => t.type === 'buy').reduce((s,t) => s + t.amount, 0));
        const sells = labels.map(m => monthly[m].filter(t => t.type === 'sell').reduce((s,t) => s + t.amount, 0));
        const opts = this.defaultOpts();
        this.instances['chart-trade-volume'] = new Chart(ctx, {
            type: 'bar',
            data: { labels: labels.map(l => this._fmtMonth(l)), datasets: [
                { label: 'Buys', data: buys, backgroundColor: 'rgba(59,130,246,.6)', borderColor: this.colors.blue, borderWidth: 1.5, borderRadius: 4 },
                { label: 'Sells', data: sells, backgroundColor: 'rgba(245,158,11,.6)', borderColor: this.colors.orange, borderWidth: 1.5, borderRadius: 4 }
            ] },
            options: opts
        });
    },

    renderHoldingsBreakdown(holdings) {
        this.destroy('chart-holdings-breakdown');
        const ctx = document.getElementById('chart-holdings-breakdown');
        if (!ctx || !holdings.length) return;
        const opts = this.defaultOpts();
        delete opts.scales;
        opts.indexAxis = 'y';
        opts.scales = { x: { ticks: { color:'#64748b', font:{size:10}, callback: v=>'₺'+(v>=1000?(v/1000).toFixed(0)+'K':v) }, grid:{ color:'rgba(30,41,59,.5)' } }, y: { ticks: { color:'#94a3b8', font:{size:11} }, grid:{ display:false } } };
        this.instances['chart-holdings-breakdown'] = new Chart(ctx, {
            type: 'bar',
            data: { labels: holdings.map(h => h.code || h.name.slice(0,20)), datasets: [{ label:'Market Value', data: holdings.map(h => h.marketValue), backgroundColor: this.colors.paletteBg.slice(0, holdings.length), borderColor: this.colors.palette.slice(0, holdings.length), borderWidth: 1.5, borderRadius: 6 }] },
            options: opts
        });
    },

    renderCashflowDetail(transactions) {
        this.destroy('chart-cashflow-detail');
        const ctx = document.getElementById('chart-cashflow-detail');
        if (!ctx) return;
        const monthly = this._groupByMonth(transactions);
        const labels = Object.keys(monthly).sort();
        const inflows = labels.map(m => monthly[m].filter(t => ['deposit','dividend','income','sell'].includes(t.type)).reduce((s,t) => s + t.amount, 0));
        const outflows = labels.map(m => monthly[m].filter(t => ['withdrawal','buy','fee','tax'].includes(t.type)).reduce((s,t) => s + t.amount, 0));
        const opts = this.defaultOpts();
        this.instances['chart-cashflow-detail'] = new Chart(ctx, {
            type: 'bar',
            data: { labels: labels.map(l => this._fmtMonth(l)), datasets: [
                { label:'Inflows', data: inflows, backgroundColor: this.colors.greenAlpha, borderColor: this.colors.green, borderWidth: 1.5, borderRadius: 4 },
                { label:'Outflows', data: outflows, backgroundColor: this.colors.redAlpha, borderColor: this.colors.red, borderWidth: 1.5, borderRadius: 4 }
            ] },
            options: opts
        });
    },

    renderCumulativeBalance(snapshots) {
        this.destroy('chart-cumulative-balance');
        const ctx = document.getElementById('chart-cumulative-balance');
        if (!ctx) return;
        const opts = this.defaultOpts();
        opts.plugins.legend = { display: false };
        this.instances['chart-cumulative-balance'] = new Chart(ctx, {
            type: 'line',
            data: { labels: snapshots.map(s => this._fmtDate(s.date)), datasets: [{ label:'Cash Balance', data: snapshots.map(s => s.cash), borderColor: this.colors.cyan, backgroundColor: 'rgba(6,182,212,.1)', fill: true, tension: .4, pointRadius: 3, borderWidth: 2 }] },
            options: opts
        });
    },

    renderValueVsDeposits(snapshots, transactions) {
        this.destroy('chart-value-vs-deposits');
        const ctx = document.getElementById('chart-value-vs-deposits');
        if (!ctx) return;
        let cumDep = 0;
        const depData = snapshots.map(s => {
            const monthTxs = transactions.filter(t => t.date.slice(0,7) === s.date.slice(0,7));
            cumDep += monthTxs.filter(t => t.type === 'deposit').reduce((sum,t) => sum + t.amount, 0);
            cumDep -= monthTxs.filter(t => t.type === 'withdrawal').reduce((sum,t) => sum + t.amount, 0);
            return cumDep;
        });
        const opts = this.defaultOpts();
        this.instances['chart-value-vs-deposits'] = new Chart(ctx, {
            type: 'line',
            data: { labels: snapshots.map(s => this._fmtDate(s.date)), datasets: [
                { label:'Portfolio Value', data: snapshots.map(s => s.value), borderColor: this.colors.blue, backgroundColor: this.colors.blueAlpha, fill: true, tension: .4, borderWidth: 2, pointRadius: 3 },
                { label:'Net Deposits', data: depData, borderColor: this.colors.orange, borderDash: [6,3], tension: .4, borderWidth: 2, pointRadius: 3, fill: false }
            ] },
            options: opts
        });
    },

    renderWeightsOverTime(data) {
        this.destroy('chart-weights-time');
        const ctx = document.getElementById('chart-weights-time');
        if (!ctx || !data.statements.length) return;
        const allNames = new Set();
        data.statements.forEach(s => (s.holdings||[]).forEach(h => allNames.add(h.name)));
        const names = [...allNames];
        const labels = data.statements.map(s => this._fmtDate(s.date));
        const datasets = names.map((name, i) => ({
            label: name.length > 20 ? name.slice(0,18)+'…' : name,
            data: data.statements.map(s => { const h = (s.holdings||[]).find(x => x.name === name); return h ? h.marketValue : 0; }),
            backgroundColor: this.colors.paletteBg[i % this.colors.paletteBg.length],
            borderColor: this.colors.palette[i % this.colors.palette.length],
            borderWidth: 1, fill: true
        }));
        const opts = this.defaultOpts();
        opts.scales.y.stacked = true; opts.scales.x.stacked = true;
        this.instances['chart-weights-time'] = new Chart(ctx, { type: 'bar', data: { labels, datasets }, options: opts });
    },

    _groupByMonth(txs) {
        const map = {};
        txs.forEach(t => { const m = t.date.slice(0,7); if (!map[m]) map[m] = []; map[m].push(t); });
        return map;
    },
    _fmtDate(d) { if (!d) return ''; const p = d.split('-'); return p[2]+'/'+p[1]; },
    _fmtMonth(m) { const [y, mo] = m.split('-'); const names = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']; return names[parseInt(mo)-1]+' '+y.slice(2); }
};
