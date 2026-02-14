// ============================================
// export.js — Excel 匯出（使用 SheetJS CDN）
// ============================================

import { getAllEntries, getEntriesByMonth } from './store.js';

let XLSX = null;

async function loadXLSX() {
    if (XLSX) return XLSX;

    // 動態載入 SheetJS CDN
    return new Promise((resolve, reject) => {
        if (window.XLSX) {
            XLSX = window.XLSX;
            resolve(XLSX);
            return;
        }

        const script = document.createElement('script');
        script.src = 'https://cdn.sheetjs.com/xlsx-0.20.1/package/dist/xlsx.full.min.js';
        script.onload = () => {
            XLSX = window.XLSX;
            resolve(XLSX);
        };
        script.onerror = () => reject(new Error('SheetJS 載入失敗'));
        document.head.appendChild(script);
    });
}

export function initExport() {
    document.getElementById('btn-export-excel').addEventListener('click', handleExport);
}

async function handleExport() {
    try {
        await loadXLSX();
    } catch (err) {
        window.showToast('Excel 匯出模組載入失敗', 'error');
        return;
    }

    const range = document.getElementById('export-range').value;

    let entries;
    let fileName;
    const now = new Date();

    if (range === 'month') {
        entries = getEntriesByMonth(now.getFullYear(), now.getMonth());
        fileName = `記帳紀錄_${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}.xlsx`;
    } else {
        entries = getAllEntries();
        fileName = `記帳紀錄_全部.xlsx`;
    }

    if (entries.length === 0) {
        window.showToast('沒有帳目可匯出', 'warning');
        return;
    }

    // 排序
    entries.sort((a, b) => new Date(a.date) - new Date(b.date));

    // 轉換資料
    const data = entries.map(e => ({
        '日期': e.date,
        '類型': e.type === 'income' ? '收入' : '支出',
        '分類': e.category,
        '金額': e.amount,
        '備註': e.note || '',
    }));

    // 建立工作簿
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(data);

    // 設定欄寬
    ws['!cols'] = [
        { wch: 12 }, // 日期
        { wch: 8 },  // 類型
        { wch: 10 }, // 分類
        { wch: 12 }, // 金額
        { wch: 20 }, // 備註
    ];

    XLSX.utils.book_append_sheet(wb, ws, '帳目');

    // 加入摘要頁
    const summaryData = calculateSummary(entries);
    const ws2 = XLSX.utils.json_to_sheet(summaryData);
    ws2['!cols'] = [
        { wch: 10 },
        { wch: 15 },
        { wch: 15 },
        { wch: 15 },
    ];
    XLSX.utils.book_append_sheet(wb, ws2, '摘要');

    // 下載
    XLSX.writeFile(wb, fileName);
    window.showToast(`已匯出 ${entries.length} 筆帳目`, 'success');
}

function calculateSummary(entries) {
    const monthly = {};
    entries.forEach(e => {
        const key = e.date.substring(0, 7); // YYYY-MM
        if (!monthly[key]) monthly[key] = { income: 0, expense: 0 };
        if (e.type === 'income') monthly[key].income += e.amount;
        else monthly[key].expense += e.amount;
    });

    return Object.entries(monthly)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([month, data]) => ({
            '月份': month,
            '收入': data.income,
            '支出': data.expense,
            '結餘': data.income - data.expense,
        }));
}
