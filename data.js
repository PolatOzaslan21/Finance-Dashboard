/* ===== DATA LAYER & PARSER ===== */
const DB_KEY = 'portfolioOS';

const Store = {
    _data: { statements: [], holdings: [], transactions: [], snapshots: [], meta: {} },
    load() {
        try { const d = localStorage.getItem(DB_KEY); if (d) this._data = JSON.parse(d); } catch(e) { console.error(e); }
        return this._data;
    },
    save() { localStorage.setItem(DB_KEY, JSON.stringify(this._data)); },
    clear() { this._data = { statements:[], holdings:[], transactions:[], snapshots:[], meta:{} }; this.save(); },
    get data() { return this._data; },
    addStatement(s) {
        const exists = this._data.statements.find(x => x.date === s.date);
        if (exists) Object.assign(exists, s); else this._data.statements.push(s);
        this._data.statements.sort((a,b) => a.date.localeCompare(b.date));
        if (s.holdings) this._data.holdings = s.holdings;
        if (s.transactions) this._data.transactions.push(...s.transactions);
        this._data.transactions.sort((a,b) => b.date.localeCompare(a.date));
        if (s.portfolioValue != null) {
            const snap = { date: s.date, value: s.portfolioValue, cash: s.cashBalance || 0 };
            const si = this._data.snapshots.findIndex(x => x.date === s.date);
            if (si >= 0) this._data.snapshots[si] = snap; else this._data.snapshots.push(snap);
            this._data.snapshots.sort((a,b) => a.date.localeCompare(b.date));
        }
        this.save();
    },
    exportJSON() {
        const blob = new Blob([JSON.stringify(this._data, null, 2)], {type:'application/json'});
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `portfolio-os-backup-${new Date().toISOString().slice(0,10)}.json`;
        a.click(); URL.revokeObjectURL(a.href);
    },
    importJSON(file) {
        return new Promise((res, rej) => {
            const r = new FileReader();
            r.onload = () => { try { this._data = JSON.parse(r.result); this.save(); res(true); } catch(e) { rej(e); } };
            r.readAsText(file);
        });
    }
};

/* ===== MIDAS STATEMENT PARSER ===== */
const Parser = {
    parse(text) {
        const result = { date: '', portfolioValue: 0, cashBalance: 0, holdings: [], transactions: [], raw: text.substring(0, 500) };
        result.date = this._extractDate(text);
        result.portfolioValue = this._extractNumber(text, /portf[oö]y\s*(?:de[gğ]eri|toplam[ıi]?)\s*[:\-]?\s*([\d.,]+)/i)
            || this._extractNumber(text, /total\s*(?:portfolio|value|asset)\s*[:\-]?\s*([\d.,]+)/i)
            || this._extractNumber(text, /toplam\s*varl[ıi]k\s*[:\-]?\s*([\d.,]+)/i);
        result.cashBalance = this._extractNumber(text, /nakit\s*(?:bakiye|dengesi?)\s*[:\-]?\s*([\d.,]+)/i)
            || this._extractNumber(text, /cash\s*balance\s*[:\-]?\s*([\d.,]+)/i)
            || this._extractNumber(text, /serbest\s*nakit\s*[:\-]?\s*([\d.,]+)/i);
        result.holdings = this._extractHoldings(text);
        result.transactions = this._extractTransactions(text, result.date);
        if (!result.portfolioValue && result.holdings.length) {
            result.portfolioValue = result.holdings.reduce((s, h) => s + h.marketValue, 0) + result.cashBalance;
        }
        return result;
    },
    _extractDate(text) {
        const patterns = [
            /hesap\s*(?:ekstresi?|özeti?)\s*(?:tarihi?|dönemi?)\s*[:\-]?\s*(\d{1,2})[.\/\-](\d{1,2})[.\/\-](\d{4})/i,
            /statement\s*date\s*[:\-]?\s*(\d{1,2})[.\/\-](\d{1,2})[.\/\-](\d{4})/i,
            /(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})/,
            /(\d{4})[.\-\/](\d{1,2})[.\-\/](\d{1,2})/
        ];
        for (const p of patterns) {
            const m = text.match(p);
            if (m) {
                if (m[1].length === 4) return `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;
                return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
            }
        }
        return new Date().toISOString().slice(0, 10);
    },
    _extractNumber(text, regex) {
        const m = text.match(regex);
        if (!m) return 0;
        return parseFloat(m[1].replace(/\./g, '').replace(',', '.')) || 0;
    },
    _extractHoldings(text) {
        const holdings = [];
        const lines = text.split('\n');
        const fundPatterns = [
            /^(.+?)\s+(TR[A-Z0-9]{10,}|[A-Z]{2,6})\s+([\d.,]+)\s+([\d.,]+)\s+([\d.,]+)/,
            /^(.+?fon.+?)\s+([\d.,]+)\s+([\d.,]+)\s+([\d.,]+)/i,
            /^([A-ZÇĞİÖŞÜa-zçğıöşü\s]+?)\s{2,}([\d.,]+)\s+([\d.,]+)\s+([\d.,]+)/
        ];
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.length < 10) continue;
            for (const pat of fundPatterns) {
                const m = trimmed.match(pat);
                if (m) {
                    const nums = [...m].slice(1).map(s => {
                        const n = parseFloat(s.replace(/\./g,'').replace(',','.'));
                        return isNaN(n) ? s : n;
                    });
                    const name = typeof nums[0] === 'string' ? nums[0].trim() : '';
                    if (!name) continue;
                    const numVals = nums.filter(n => typeof n === 'number');
                    if (numVals.length >= 3) {
                        holdings.push({
                            name, code: typeof nums[1] === 'string' ? nums[1] : '',
                            units: numVals[0], unitPrice: numVals[1], marketValue: numVals[2]
                        });
                    }
                    break;
                }
            }
        }
        return holdings;
    },
    _extractTransactions(text, stmtDate) {
        const txs = [];
        const lines = text.split('\n');
        const txPatterns = [
            /(\d{1,2}[.\/]\d{1,2}[.\/]\d{2,4})\s+(Al[ıi]m|Sat[ıi]m|Yat[ıi]r[ıi]m|Çekim|Temettü|Komisyon|Al[ıi][sş]|Sat[ıi][sş]|Deposit|Withdrawal|Buy|Sell|Dividend|Fee)\s+(.+?)\s+([\d.,]+)/i
        ];
        for (const line of lines) {
            const trimmed = line.trim();
            for (const pat of txPatterns) {
                const m = trimmed.match(pat);
                if (m) {
                    let type = this._mapTxType(m[2]);
                    let dateStr = m[1];
                    if (dateStr.length <= 8) {
                        const dp = dateStr.split(/[.\/]/);
                        if (dp[2] && dp[2].length === 2) dp[2] = '20' + dp[2];
                        dateStr = `${dp[2]}-${dp[1].padStart(2,'0')}-${dp[0].padStart(2,'0')}`;
                    }
                    const amount = parseFloat(m[4].replace(/\./g,'').replace(',','.')) || 0;
                    txs.push({ date: dateStr || stmtDate, type, description: m[3].trim(), fund: '', units: 0, price: 0, amount });
                    break;
                }
            }
        }
        return txs;
    },
    _mapTxType(raw) {
        const r = raw.toLowerCase();
        if (/al[ıi]|buy/.test(r)) return 'buy';
        if (/sat[ıi]|sell/.test(r)) return 'sell';
        if (/yat[ıi]r|deposit/.test(r)) return 'deposit';
        if (/çekim|withdr/.test(r)) return 'withdrawal';
        if (/temettü|dividend/.test(r)) return 'dividend';
        if (/komisyon|fee/.test(r)) return 'fee';
        return 'deposit';
    }
};

/* ===== DEMO DATA GENERATOR ===== */
function generateDemoData() {
    Store.clear();
    const funds = [
        { name: 'Midas Serbest Fon', code: 'MDS', basePrice: 42.50 },
        { name: 'Midas Para Piyasası Fon', code: 'MPP', basePrice: 1.85 },
        { name: 'Midas Hisse Senedi Fon', code: 'MHS', basePrice: 28.10 },
        { name: 'Midas Kısa Vadeli Tahvil Fon', code: 'MKT', basePrice: 15.30 },
        { name: 'Midas Altın Fon', code: 'MAF', basePrice: 8.75 }
    ];
    const months = [];
    for (let i = 11; i >= 0; i--) {
        const d = new Date(); d.setMonth(d.getMonth() - i); d.setDate(28);
        months.push(d.toISOString().slice(0, 10));
    }
    let cumDeposit = 0;
    months.forEach((date, idx) => {
        const deposit = 5000 + Math.round(Math.random() * 10000);
        const withdrawal = idx > 3 && Math.random() > 0.7 ? Math.round(Math.random() * 3000) : 0;
        cumDeposit += deposit - withdrawal;
        const growth = 1 + (idx * 0.015) + (Math.random() * 0.04 - 0.01);
        const portfolioValue = Math.round(cumDeposit * growth);
        const cashBalance = Math.round(500 + Math.random() * 2000);
        const investedValue = portfolioValue - cashBalance;
        const weights = [0.35, 0.25, 0.20, 0.12, 0.08];
        const holdings = funds.map((f, fi) => {
            const mv = Math.round(investedValue * weights[fi]);
            const price = +(f.basePrice * (1 + idx * 0.02 + (Math.random() * 0.03 - 0.01))).toFixed(4);
            return { name: f.name, code: f.code, units: +(mv / price).toFixed(4), unitPrice: price, marketValue: mv };
        });
        const transactions = [];
        transactions.push({ date, type: 'deposit', description: 'EFT Yatırım', fund: '', units: 0, price: 0, amount: deposit });
        if (withdrawal > 0) transactions.push({ date, type: 'withdrawal', description: 'EFT Çekim', fund: '', units: 0, price: 0, amount: withdrawal });
        const buyFund = funds[Math.floor(Math.random() * funds.length)];
        const buyAmt = Math.round(deposit * 0.6);
        const buyPrice = +(buyFund.basePrice * (1 + idx * 0.02)).toFixed(4);
        transactions.push({ date, type: 'buy', description: `${buyFund.name} Alım`, fund: buyFund.code, units: +(buyAmt / buyPrice).toFixed(4), price: buyPrice, amount: buyAmt });
        if (idx > 0 && Math.random() > 0.6) {
            const sellFund = funds[Math.floor(Math.random() * 3)];
            const sellAmt = Math.round(1000 + Math.random() * 2000);
            transactions.push({ date, type: 'sell', description: `${sellFund.name} Satım`, fund: sellFund.code, units: +(sellAmt / sellFund.basePrice).toFixed(2), price: sellFund.basePrice, amount: sellAmt });
        }
        if (idx % 3 === 0) transactions.push({ date, type: 'dividend', description: 'Temettü Dağıtımı', fund: 'MHS', units: 0, price: 0, amount: Math.round(200 + Math.random() * 500) });
        Store.addStatement({ date, portfolioValue, cashBalance, holdings, transactions });
    });
}
