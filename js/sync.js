// ============================================
// sync.js — Google Sheets 雲端同步引擎
// ============================================

import { getAccessToken, isLoggedIn } from './auth.js';
import { getAllEntries, getUnsyncedEntries, markAsSynced, mergeEntries, getPendingDeletions, clearPendingDeletions } from './store.js';

const SHEETS_API = 'https://www.googleapis.com/discovery/v1/apis/sheets/v4/rest';
const SHEET_NAME = '帳目';
const HEADER_ROW = ['ID', '日期', '類型', '分類', '金額', '備註', '建立時間'];

let spreadsheetId = null;
const SHEET_ID_KEY = 'expense_tracker_sheet_id';

const syncListeners = [];

export function onSyncChange(callback) {
    syncListeners.push(callback);
}

function notifySyncListeners(status, message) {
    syncListeners.forEach(fn => fn({ status, message, spreadsheetId }));
}

export function getSpreadsheetId() {
    if (!spreadsheetId) {
        spreadsheetId = localStorage.getItem(SHEET_ID_KEY);
    }
    return spreadsheetId;
}

export function setSpreadsheetId(id) {
    if (id) {
        spreadsheetId = id;
        localStorage.setItem(SHEET_ID_KEY, id);
    }
}

export function getSpreadsheetUrl() {
    const id = getSpreadsheetId();
    return id ? `https://docs.google.com/spreadsheets/d/${id}` : null;
}

async function sheetsApi(url, options = {}) {
    const token = getAccessToken();
    if (!token) throw new Error('未登入');

    const res = await fetch(url, {
        ...options,
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            ...(options.headers || {}),
        },
    });

    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error?.message || `API 錯誤 ${res.status}`);
    }

    return res.json();
}

// 尋找或建立「每日記帳」試算表
async function findOrCreateSpreadsheet() {
    // 先檢查本地紀錄
    const savedId = localStorage.getItem(SHEET_ID_KEY);
    if (savedId) {
        try {
            // 確認試算表仍存在
            await sheetsApi(`https://sheets.googleapis.com/v4/spreadsheets/${savedId}?fields=spreadsheetId`);
            spreadsheetId = savedId;
            return savedId;
        } catch (e) {
            // 試算表不存在，清除紀錄
            localStorage.removeItem(SHEET_ID_KEY);
        }
    }

    // 建立新試算表
    const body = {
        properties: { title: '每日記帳' },
        sheets: [{
            properties: { title: SHEET_NAME },
        }],
    };

    const result = await sheetsApi('https://sheets.googleapis.com/v4/spreadsheets', {
        method: 'POST',
        body: JSON.stringify(body),
    });

    spreadsheetId = result.spreadsheetId;
    localStorage.setItem(SHEET_ID_KEY, spreadsheetId);

    // 寫入表頭
    await sheetsApi(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${SHEET_NAME}!A1:G1?valueInputOption=RAW`,
        {
            method: 'PUT',
            body: JSON.stringify({ values: [HEADER_ROW] }),
        }
    );

    // 格式化表頭（粗體 + 凍結）
    await sheetsApi(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
        {
            method: 'POST',
            body: JSON.stringify({
                requests: [
                    {
                        repeatCell: {
                            range: { sheetId: 0, startRowIndex: 0, endRowIndex: 1 },
                            cell: {
                                userEnteredFormat: {
                                    textFormat: { bold: true },
                                    backgroundColor: { red: 0.2, green: 0.2, blue: 0.4 },
                                },
                            },
                            fields: 'userEnteredFormat(textFormat,backgroundColor)',
                        },
                    },
                    {
                        updateSheetProperties: {
                            properties: { sheetId: 0, gridProperties: { frozenRowCount: 1 } },
                            fields: 'gridProperties.frozenRowCount',
                        },
                    },
                ],
            }),
        }
    );

    return spreadsheetId;
}

// 將未同步的帳目上傳到 Sheets
export async function syncToSheet() {
    if (!isLoggedIn()) return;

    notifySyncListeners('syncing', '同步中...');

    try {
        await findOrCreateSpreadsheet();

        // 處理待刪除的帳目 (雲端刪除)
        await handleCloudDeletions();

        const unsynced = getUnsyncedEntries();
        if (unsynced.length === 0) {
            notifySyncListeners('idle', '已是最新');
            return;
        }

        const rows = unsynced.map(e => [
            e.id,
            e.date,
            e.type === 'income' ? '收入' : '支出',
            e.category,
            e.amount,
            e.note,
            e.createdAt,
        ]);

        await sheetsApi(
            `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${SHEET_NAME}!A:G:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
            {
                method: 'POST',
                body: JSON.stringify({ values: rows }),
            }
        );

        markAsSynced(unsynced.map(e => e.id));
        notifySyncListeners('success', `已同步 ${unsynced.length} 筆`);
    } catch (err) {
        console.error('[Sync] 同步失敗:', err);
        notifySyncListeners('error', '同步失敗: ' + err.message);
    }
}

// 從 Sheets 拉取資料合併到本地
export async function syncFromSheet() {
    if (!isLoggedIn()) return;

    notifySyncListeners('syncing', '從雲端拉取資料...');

    try {
        await findOrCreateSpreadsheet();

        const result = await sheetsApi(
            `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${SHEET_NAME}!A2:G10000`
        );

        const rows = result.values || [];
        if (rows.length === 0) {
            notifySyncListeners('idle', '雲端無資料');
            return 0;
        }

        // 解析資料 (適應可能的標題空格偏移)
        const remoteEntries = rows.map(row => {
            // 從截圖看，"金額" 標題前可能有一個空格，導致資料列產生偏移
            // 我們優先嘗試 row[4]，如果 row[4] 是空的或非數字，而 row[5] 是數字，則取 row[5]
            let amountVal = row[4];
            let noteVal = row[5];
            let createdAtVal = row[6];

            if ((amountVal === undefined || amountVal === '') && row[5] !== undefined) {
                amountVal = row[5];
                noteVal = row[6];
                createdAtVal = row[7];
            }

            return {
                id: row[0],
                date: row[1],
                type: row[2] === '收入' ? 'income' : 'expense',
                category: row[3],
                amount: parseFloat(amountVal) || 0,
                note: noteVal || '',
                createdAt: createdAtVal || new Date().toISOString(),
                synced: true,
            };
        });

        const added = mergeEntries(remoteEntries);
        notifySyncListeners('success', added > 0 ? `已合併 ${added} 筆雲端資料` : '已是最新');
        return added;
    } catch (err) {
        console.error('[Sync] 拉取失敗:', err);
        notifySyncListeners('error', '拉取失敗: ' + err.message);
        return 0;
    }
}

// 完整同步：先拉再推
export async function fullSync() {
    await syncFromSheet();
    await syncToSheet();
}

// 同步單筆新增的帳目
export async function syncSingleEntry(entry) {
    if (!isLoggedIn()) return;

    try {
        await findOrCreateSpreadsheet();
        const row = [
            entry.id,
            entry.date,
            entry.type === 'income' ? '收入' : '支出',
            entry.category,
            entry.amount,
            entry.note,
            entry.createdAt,
        ];

        await sheetsApi(
            `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${SHEET_NAME}!A:G:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
            {
                method: 'POST',
                body: JSON.stringify({ values: [row] }),
            }
        );

        markAsSynced([entry.id]);
    } catch (err) {
        console.error('[Sync] 單筆同步失敗:', err);
    }
}
// 處理雲端同步刪除
async function handleCloudDeletions() {
    const deletedIds = getPendingDeletions();
    if (deletedIds.length === 0) return;

    try {
        // 1. 先抓取雲端的 A 欄 (ID) 以確認列號
        const result = await sheetsApi(
            `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${SHEET_NAME}!A:A`
        );
        const rows = result.values || [];
        if (rows.length === 0) return;

        // 2. 找出待刪除 ID 對應的 0-indexed 列號
        const indicesToDelete = [];
        deletedIds.forEach(id => {
            const rowIndex = rows.findIndex(row => row[0] === id);
            if (rowIndex !== -1) {
                indicesToDelete.push(rowIndex);
            }
        });

        if (indicesToDelete.length === 0) {
            clearPendingDeletions(deletedIds);
            return;
        }

        // 3. 排序 (由後往前刪，以免列號偏移)
        indicesToDelete.sort((a, b) => b - a);

        // 4. 發送批次更新請求
        const requests = indicesToDelete.map(index => ({
            deleteDimension: {
                range: {
                    sheetId: 0, // 預設第一個工作表
                    dimension: 'ROWS',
                    startIndex: index,
                    endIndex: index + 1
                }
            }
        }));

        await sheetsApi(
            `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
            {
                method: 'POST',
                body: JSON.stringify({ requests })
            }
        );

        // 5. 清除本地紀錄
        clearPendingDeletions(deletedIds);
        console.log(`[Sync] 雲端已同步刪除 ${indicesToDelete.length} 筆`);

    } catch (err) {
        console.error('[Sync] 雲端刪除失敗:', err);
        // 不清除紀錄，下次同步時重試
    }
}
