/* ===== DATA LAYER & PARSER ===== */
const DB_KEY = 'portfolioOS';

/**
 * Normalizes raw data to ensure all required fields exist as correct types.
 * Prevents "Cannot read properties of undefined" errors on .find/.push/.sort etc.
 */
function normalizeData(raw) {
    const safe = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    return {
        statements:   Array.isArray(safe.statements)   ? safe.statements   : [],
        holdings:     Array.isArray(safe.holdings)      ? safe.holdings     : [],
        transactions: Array.isArray(safe.transactions)  ? safe.transactions : [],
        snapshots:    Array.isArray(safe.snapshots)     ? safe.snapshots    : [],
        meta:         safe.meta && typeof safe.meta === 'object' && !Array.isArray(safe.meta) ? safe.meta : {}
    };
}

/**
 * Smart money/number parser supporting both Turkish and English formats.
 * Handles: "102751.640000", "0.79", "99474,63", "94.896,63", "-204,91 TRY", "-"
 */
function parseMoney(raw) {
    if (raw == null) return 0;
    let s = String(raw).trim();
    // Remove currency labels and non-breaking spaces
    s = s.replace(/[\u00A0\u202F]/g, '').replace(/\s*(TRY|TL|₺)\s*/gi, '').trim();
    // Dash or empty = 0
    if (s === '-' || s === '—' || s === '' || s === '–') return 0;
    // Preserve negative sign
    const negative = s.startsWith('-');
    if (negative) s = s.substring(1).trim();

    const hasDot = s.includes('.');
    const hasComma = s.includes(',');

    if (hasDot && hasComma) {
        // Both present: last occurring separator is the decimal
        const lastDot = s.lastIndexOf('.');
        const lastComma = s.lastIndexOf(',');
        if (lastComma > lastDot) {
            // "94.896,63" => comma is decimal
            s = s.replace(/\./g, '').replace(',', '.');
        } else {
            // "94,896.63" => dot is decimal
            s = s.replace(/,/g, '');
        }
    } else if (hasComma) {
        // Only comma: treat as decimal separator
        // "99474,63" => 99474.63
        s = s.replace(',', '.');
    } else if (hasDot) {
        // Only dot: check digits after last dot
        const lastDot = s.lastIndexOf('.');
        const afterDot = s.substring(lastDot + 1);
        const dotCount = (s.match(/\./g) || []).length;
        if (dotCount > 1) {
            // Multiple dots: all are thousands separators "1.234.567" => 1234567
            s = s.replace(/\./g, '');
        } else if (afterDot.length === 3 && lastDot > 0 && s.substring(0, lastDot).length <= 3) {
            // Single dot, exactly 3 digits after, short prefix: thousands separator "1.000" => 1000
            s = s.replace('.', '');
        }
        // Otherwise it's a decimal dot: "102751.640000", "0.79" => keep as-is
    }

    const num = parseFloat(s);
    if (isNaN(num)) return 0;
    return negative ? -num : num;
}

/**
 * Parse DD/MM/YY date string to YYYY-MM-DD
 */
function parseMidasDate(dateStr) {
    if (!dateStr) return '';
    const parts = dateStr.trim().split(/[.\/\-]/);
    if (parts.length < 3) return dateStr;
    let [d, m, y] = parts;
    if (y.length === 2) y = '20' + y;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

const Store = {
    _data: { statements: [], holdings: [], transactions: [], snapshots: [], meta: {} },
    load() {
        try {
            const d = localStorage.getItem(DB_KEY);
            if (d) {
                const parsed = JSON.parse(d);
                this._data = normalizeData(parsed);
            }
        } catch(e) {
            console.error('Store.load() parse error, resetting to defaults:', e);
            this._data = normalizeData(null);
        }
        return this._data;
    },
    save() { localStorage.setItem(DB_KEY, JSON.stringify(this._data)); },
    clear() { this._data = { statements:[], holdings:[], transactions:[], snapshots:[], meta:{} }; this.save(); },
    get data() { return this._data; },
    addStatement(s) {
        this._data = normalizeData(this._data);

        const safeDate         = (s && typeof s.date === 'string' && s.date) ? s.date : new Date().toISOString().slice(0, 10);
        const safePortfolioVal = (s && typeof s.portfolioValue === 'number' && isFinite(s.portfolioValue)) ? s.portfolioValue : 0;
        const safeCashBalance  = (s && typeof s.cashBalance === 'number' && isFinite(s.cashBalance)) ? s.cashBalance : 0;
        const safeHoldings     = (s && Array.isArray(s.holdings)) ? s.holdings : [];
        const safeTransactions = (s && Array.isArray(s.transactions)) ? s.transactions : [];
        const safeStats        = (s && s.stats) ? s.stats : {};

        const stmt = {
            date: safeDate,
            portfolioValue: safePortfolioVal,
            cashBalance: safeCashBalance,
            holdings: safeHoldings,
            transactions: safeTransactions,
            stats: safeStats,
            raw: (s && s.raw) || ''
        };

        // Upsert statement
        const exists = this._data.statements.find(x => x.date === stmt.date);
        if (exists) Object.assign(exists, stmt); else this._data.statements.push(stmt);
        this._data.statements.sort((a,b) => (a.date || '').localeCompare(b.date || ''));

        // Update holdings to latest
        if (safeHoldings.length) this._data.holdings = safeHoldings;

        // DEDUP: Remove old transactions from same statement date, then add new ones tagged
        this._data.transactions = this._data.transactions.filter(t => t._stmtDate !== stmt.date);
        const taggedTx = safeTransactions.map(t => ({ ...t, _stmtDate: stmt.date }));
        this._data.transactions.push(...taggedTx);
        this._data.transactions.sort((a,b) => (b.date || '').localeCompare(a.date || ''));

        // Upsert snapshot
        if (safePortfolioVal != null) {
            const snap = { date: stmt.date, value: safePortfolioVal, cash: safeCashBalance };
            const si = this._data.snapshots.findIndex(x => x.date === stmt.date);
            if (si >= 0) this._data.snapshots[si] = snap; else this._data.snapshots.push(snap);
            this._data.snapshots.sort((a,b) => (a.date || '').localeCompare(b.date || ''));
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
            r.onload = () => {
                try {
                    const parsed = JSON.parse(r.result);
                    this._data = normalizeData(parsed);
                    this.save();
                    res(true);
                } catch(e) {
                    rej(new Error('Invalid JSON file. Please check the file format and try again.'));
                }
            };
            r.onerror = () => rej(new Error('Failed to read file.'));
            r.readAsText(file);
        });
    }
};

/* ===== MIDAS STATEMENT PARSER ===== */
const Parser = {
    parse(text) {
        const result = {
            date: '', portfolioValue: 0, cashBalance: 0,
            holdings: [], transactions: [],
            stats: {
                holdingsCount: 0, investmentTxCount: 0, accountTxCount: 0,
                dividendTxCount: 0, skippedCancelled: 0, skippedExpired: 0,
                skippedIgnored: 0, warnings: []
            },
            raw: text.substring(0, 500)
        };

        // 1) Extract statement date from period header
        result.date = this._extractStatementDate(text);

        // 2) Extract portfolio summary values
        result.portfolioValue = this._extractLabelValue(text,
            /(?:toplam\s*portf[oö]y\s*de[gğ]eri|portf[oö]y\s*de[gğ]eri|total\s*portfolio\s*value)\s*[:\-]?\s*([\-\d.,]+)/i);
        result.cashBalance = this._extractLabelValue(text,
            /(?:nakit\s*bakiye|serbest\s*nakit|cash\s*balance)\s*[:\-]?\s*([\-\d.,]+)/i);

        // 3) Extract sections
        const sections = this._extractSections(text);

        // 4) Parse each section
        result.holdings = this._parseHoldingsSection(sections.portfolio || '');
        result.stats.holdingsCount = result.holdings.length;

        const invResult = this._parseInvestmentSection(sections.investment || '');
        result.stats.investmentTxCount = invResult.transactions.length;
        result.stats.skippedCancelled = invResult.skippedCancelled;
        result.stats.skippedExpired = invResult.skippedExpired;

        const acctResult = this._parseAccountSection(sections.account || '', result.date);
        result.stats.accountTxCount = acctResult.transactions.length;
        result.stats.skippedIgnored = acctResult.skippedIgnored;

        const divResult = this._parseDividendSection(sections.dividend || '', result.date);
        result.stats.dividendTxCount = divResult.transactions.length;

        // Merge all transactions
        result.transactions = [
            ...invResult.transactions,
            ...acctResult.transactions,
            ...divResult.transactions
        ];

        // Fallback: if no portfolio value found, sum holdings
        if (!result.portfolioValue && result.holdings.length) {
            result.portfolioValue = result.holdings.reduce((s, h) => s + h.marketValue, 0) + result.cashBalance;
        }

        // Warnings
        if (!result.holdings.length && !result.transactions.length) {
            result.stats.warnings.push('No recognizable Midas holdings or transactions found.');
        }

        return result;
    },

    /* --- Statement date from period header --- */
    _extractStatementDate(text) {
        // Match: "01/04/26 - 30/04/26 HESAP EKSTRESİ"  or similar period lines
        const periodPat = /(\d{2}\/\d{2}\/\d{2})\s*[-–]\s*(\d{2}\/\d{2}\/\d{2})\s*HESAP\s*EKSTRES/i;
        const m = text.match(periodPat);
        if (m) return parseMidasDate(m[2]); // End date of the period

        // Fallback: "Hesap Ekstresi Tarihi : DD/MM/YYYY" or "DD.MM.YYYY"
        const fallbacks = [
            /hesap\s*(?:ekstresi?|[oö]zeti?)\s*(?:tarihi?|d[oö]nemi?)\s*[:\-]?\s*(\d{1,2})[.\/\-](\d{1,2})[.\/\-](\d{2,4})/i,
            /statement\s*date\s*[:\-]?\s*(\d{1,2})[.\/\-](\d{1,2})[.\/\-](\d{2,4})/i
        ];
        for (const p of fallbacks) {
            const fm = text.match(p);
            if (fm) {
                let y = fm[3]; if (y.length === 2) y = '20' + y;
                return `${y}-${fm[2].padStart(2,'0')}-${fm[1].padStart(2,'0')}`;
            }
        }
        // Last fallback: first DD/MM/YYYY-ish date in text
        const generic = text.match(/(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})/);
        if (generic) return `${generic[3]}-${generic[2].padStart(2,'0')}-${generic[1].padStart(2,'0')}`;

        return new Date().toISOString().slice(0, 10);
    },

    /* --- Extract a labeled numeric value using parseMoney --- */
    _extractLabelValue(text, regex) {
        const m = text.match(regex);
        if (!m) return 0;
        return parseMoney(m[1]);
    },

    /* --- Split text into named sections --- */
    _extractSections(text) {
        const sections = {};
        const markers = [
            { name: 'portfolio',   re: /PORTF[ÖO]Y\s+[ÖO]ZET[İI]/i },
            { name: 'investment',  re: /YATIRIM\s+[İI][ŞS]LEMLER[İI]/i },
            { name: 'account',     re: /HESAP\s+[İI][ŞS]LEMLER[İI]/i },
            { name: 'dividend',    re: /TEMETT[ÜU]\s+[İI][ŞS]LEMLER[İI]/i },
            { name: 'transfer',    re: /H[İI]SSE\s+TRANSFERLER[İI]/i }
        ];
        const found = [];
        for (const mk of markers) {
            const m = text.search(mk.re);
            if (m >= 0) found.push({ name: mk.name, pos: m });
        }
        found.sort((a, b) => a.pos - b.pos);
        for (let i = 0; i < found.length; i++) {
            const start = found[i].pos;
            const end = i + 1 < found.length ? found[i + 1].pos : text.length;
            sections[found[i].name] = text.substring(start, end);
        }
        return sections;
    },

    /* --- Holdings parser (Midas format) --- */
    _parseHoldingsSection(sectionText) {
        const holdings = [];
        const lines = sectionText.split('\n');
        // Pattern: CODE - Name... UNITS AVGCOST TRY PNL TRY TOTALVALUE TRY
        const pat = /^([A-Z0-9]{2,6})\s*[-–]\s*(.+?)\s+([\d.,]+)\s+([\d.,-]+)\s*TRY\s+([\d.,-]+)\s*TRY\s+([\d.,-]+)\s*TRY/;
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.length < 10) continue;
            const m = trimmed.match(pat);
            if (m) {
                holdings.push({
                    code: m[1],
                    name: m[2].replace(/\.{2,}$/, '').trim(),
                    units: parseMoney(m[3]),
                    unitPrice: parseMoney(m[4]),
                    pnl: parseMoney(m[5]),
                    marketValue: parseMoney(m[6])
                });
            }
        }
        return holdings;
    },

    /* --- Investment transactions parser (Midas format) --- */
    _parseInvestmentSection(sectionText) {
        const transactions = [];
        let skippedCancelled = 0, skippedExpired = 0;
        const lines = sectionText.split('\n');
        // Pattern: DD/MM/YY HH:MM:SS OrderKind SYMBOL Direction Status CURRENCY ...numbers...
        const pat = /(\d{2}\/\d{2}\/\d{2})\s+(\d{2}:\d{2}:\d{2})\s+((?:Fon|Limit|Piyasa)\s+Emri)\s+([A-Z0-9]+)\s+(Al[ıi][şs]|Sat[ıi][şs])\s+(Ger[çc]ekle[şs]ti|[İI]ptal\s+Edildi|S[üu]resi\s+Doldu|Bekliyor)\s+([A-Z]{3})\s+([\d.,-]+|[-–])\s+([\d.,-]+|[-–])\s+([\d.,-]+|[-–])\s+([\d.,-]+|[-–])\s+([\d.,-]+|[-–])\s+([\d.,-]+|[-–])/i;

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            const m = trimmed.match(pat);
            if (!m) continue;

            const status = m[6].trim();
            const isCancelled = /iptal/i.test(status);
            const isExpired = /suresi|süresi/i.test(status);

            if (isCancelled) { skippedCancelled++; continue; }
            if (isExpired) { skippedExpired++; continue; }
            if (!/ger[çc]ekle[şs]ti/i.test(status)) continue; // skip Bekliyor etc.

            const direction = m[5].trim().toLowerCase();
            const isSell = /sat/i.test(direction);
            const date = parseMidasDate(m[1]);

            transactions.push({
                date,
                time: m[2],
                type: isSell ? 'sell' : 'buy',
                orderKind: m[3],
                fund: m[4],
                description: `${m[4]} ${isSell ? 'Satış' : 'Alış'}`,
                currency: m[7],
                units: parseMoney(m[10]),   // executed units
                price: parseMoney(m[11]),   // avg price
                fee: parseMoney(m[12]),     // fee
                amount: parseMoney(m[13])   // total amount
            });
        }
        return { transactions, skippedCancelled, skippedExpired };
    },

    /* --- Account transactions parser (Midas format) --- */
    _parseAccountSection(sectionText, stmtDate) {
        const transactions = [];
        let skippedIgnored = 0;
        const lines = sectionText.split('\n');
        // Pattern: DD/MM/YY HH:MM:SS DD/MM/YY HH:MM:SS TypeDescription Status AMOUNT TRY
        const pat = /(\d{2}\/\d{2}\/\d{2})\s+(\d{2}:\d{2}:\d{2})\s+(\d{2}\/\d{2}\/\d{2})\s+(\d{2}:\d{2}:\d{2})\s+(.+?)\s+(Ger[çc]ekle[şs]ti|[İI]ptal\s+Edildi|Bekliyor)\s+(-?[\d.,-]+)\s*TRY/i;

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            const m = trimmed.match(pat);
            if (!m) continue;

            const status = m[6].trim();
            if (!/ger[çc]ekle[şs]ti/i.test(status)) continue;

            const rawDesc = m[5].trim();
            const amount = parseMoney(m[7]);
            const date = parseMidasDate(m[1]);
            const mapping = this._mapAccountType(rawDesc);

            if (mapping.type === 'ignored') { skippedIgnored++; continue; }

            transactions.push({
                date,
                time: m[2],
                type: mapping.type,
                description: mapping.description || rawDesc,
                fund: '',
                units: 0,
                price: 0,
                amount: Math.abs(amount)
            });
        }
        return { transactions, skippedIgnored };
    },

    /* --- Dividend transactions parser --- */
    _parseDividendSection(sectionText, stmtDate) {
        const transactions = [];
        const lines = sectionText.split('\n');
        // Try to capture dividend lines with dates and amounts
        const pat = /(\d{2}\/\d{2}\/\d{2})\s+.*?([\d.,-]+)\s*TRY\s*$/i;
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            const m = trimmed.match(pat);
            if (m) {
                const amount = parseMoney(m[2]);
                if (amount > 0) {
                    transactions.push({
                        date: parseMidasDate(m[1]),
                        type: 'dividend',
                        description: 'Temettü',
                        fund: '', units: 0, price: 0,
                        amount
                    });
                }
            }
        }
        return { transactions };
    },

    /* --- Map account transaction type --- */
    _mapAccountType(rawDesc) {
        const lower = rawDesc.toLowerCase();
        if (/para\s*yat[ıi]rma/i.test(lower)) return { type: 'deposit', description: rawDesc };
        if (/para\s*[cç]ekme/i.test(lower)) return { type: 'withdrawal', description: rawDesc };
        if (/di[gğ]er\s*gelir/i.test(lower) || /nema/i.test(lower)) return { type: 'income', description: rawDesc };
        if (/stopaj/i.test(lower)) return { type: 'tax', description: rawDesc };
        if (/di[gğ]er\s*gider/i.test(lower) || /komisyon/i.test(lower)) return { type: 'fee', description: rawDesc };
        if (/[üu]cretsiz/i.test(lower) || /s[ıi]f[ıi]r\s*komisyon/i.test(lower)) return { type: 'ignored' };
        return { type: 'other', description: rawDesc };
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
