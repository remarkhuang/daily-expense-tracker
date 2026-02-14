// ============================================
// sync.js — Google Sheets 雲端同步引擎
// ============================================

import { getAccessToken, isLoggedIn } from './auth.js';
import { getAllEntries, getUnsyncedEntries, markAsSynced, mergeEntries, getPendingDeletions, clearPendingDeletions, removeFromLocal } from './store.js';

const SHEETS_API = 'https://www.googleapis.com/discovery/v1/apis/sheets/v4/rest';
const SHEET_NAME = '帳目';
const HEADER_ROW = ['ID', '日期', '類型', '分類', '金額', '備註', '建立時間'];

let spreadsheetId = null;
const SHEET_ID_KEY = 'expense_tracker_sheet_id';
const DEFAULT_SHEET_ID = '1o7KlfhiJqVpSvTjR_C3yavph-Z8Lsznpb-H42OET8AM';

const syncListeners = [];

export function onSyncChange(callback) {
    syncListeners.push(callback);
}

function notifySyncListeners(status, message) {
    syncListeners.forEach(fn => fn({ status, message, spreadsheetId }));
}

export function getSpreadsheetId() {
    if (!spreadsheetId) {
        spreadsheetId = localStorage.getItem(SHEET_ID_KEY) || DEFAULT_SHEET_ID;
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
        if (res.status === 401) {
            throw new Error('登入認證已失效，請重新登入');
        }
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error?.message || `API 錯誤 ${res.status}`);
    }

    return res.json();
}

// 尋找或建立「每日記帳」試算表
async function findOrCreateSpreadsheet() {
    // 先檢查本地紀錄或預設 ID
    const savedId = localStorage.getItem(SHEET_ID_KEY) || DEFAULT_SHEET_ID;
    if (savedId) {
        try {
            // 確認試算表仍存在
            await sheetsApi(`https://sheets.googleapis.com/v4/spreadsheets/${savedId}?fields=spreadsheetId`);
            spreadsheetId = savedId;
            if (!localStorage.getItem(SHEET_ID_KEY)) {
                localStorage.setItem(SHEET_ID_KEY, savedId);
            }
            return savedId;
        } catch (e) {
            // 如果是 401 (token 過期)，不要清除 sheet ID，因為 ID 本身沒問題
            if (e.message.includes('401') || e.message.includes('認證') || e.message.includes('credentials')) {
                console.warn('[Sync] Token 可能過期，但保留 spreadsheet ID:', savedId);
                spreadsheetId = savedId; // 仍然設定 ID，讓後續流程可以嘗試
                throw e; // 重新拋出讓上層處理
            }
            // 其他錯誤（如 404 找不到、403 無權限）
            console.warn('[Sync] 無法存取試算表:', savedId, e.message);
            if (savedId !== DEFAULT_SHEET_ID) {
                localStorage.removeItem(SHEET_ID_KEY);
            }
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

// 將未同步的帳目上傳或更新到 Sheets
export async function syncToSheet() {
    if (!isLoggedIn()) return;

    notifySyncListeners('syncing', '正在同步變更...');

    try {
        await findOrCreateSpreadsheet();

        // 1. 處理待刪除的帳目 (雲端刪除) — 錯誤不中斷整體同步
        try {
            await handleCloudDeletions();
        } catch (delErr) {
            console.error('[Sync] 雲端刪除失敗，但繼續同步其他變更:', delErr);
        }

        const unsynced = getUnsyncedEntries();
        if (unsynced.length === 0) {
            notifySyncListeners('idle', '已是最新');
            return;
        }

        // 2. 取得雲端現有的所有 ID 及其列號
        const result = await sheetsApi(
            `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(SHEET_NAME)}!A:A`
        );
        const cloudIds = (result.values || []).map(row => row[0]);

        const toUpdate = [];
        const toAppend = [];

        unsynced.forEach(entry => {
            const rowIndex = cloudIds.indexOf(entry.id);
            if (rowIndex !== -1) {
                // 已存在，加入更新隊列 (rowIndex 是 0-based，加 1 才是 Excel 行號)
                toUpdate.push({ entry, rowIndex: rowIndex + 1 });
            } else {
                // 不存在，追加
                toAppend.push(entry);
            }
        });

        // 3. 處理更新 (使用 batchUpdate 效率較低，這裡用單筆 PUT 或進階 batch 都可以，先確保正確性)
        for (const item of toUpdate) {
            await updateSingleRow(item.entry, item.rowIndex);
        }

        // 4. 處理追加
        if (toAppend.length > 0) {
            const rows = toAppend.map(e => [
                e.id,
                e.date,
                e.type === 'income' ? '收入' : '支出',
                e.category,
                e.amount,
                e.note,
                e.createdAt,
            ]);

            await sheetsApi(
                `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(SHEET_NAME)}!A:G:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
                {
                    method: 'POST',
                    body: JSON.stringify({ values: rows }),
                }
            );
        }

        markAsSynced(unsynced.map(e => e.id));
        notifySyncListeners('success', `已同步 ${unsynced.length} 筆 (含更新)`);
    } catch (err) {
        console.error('[Sync] 同步失敗:', err);
        notifySyncListeners('error', '同步失敗: ' + err.message);
    }
}

// 更新單一列的輔助函式
async function updateSingleRow(entry, rowNumber) {
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
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(SHEET_NAME)}!A${rowNumber}:G${rowNumber}?valueInputOption=USER_ENTERED`,
        {
            method: 'PUT',
            body: JSON.stringify({ values: [row] }),
        }
    );
}

// 從 Sheets 拉取資料合併到本地
export async function syncFromSheet() {
    if (!isLoggedIn()) return;

    notifySyncListeners('syncing', '從雲端拉取資料...');

    try {
        await findOrCreateSpreadsheet();

        const result = await sheetsApi(
            `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(SHEET_NAME)}!A2:G10000`
        );

        const rows = result.values || [];

        // --- 全量對齊邏輯 (Reconciliation) ---
        // 取得所有 ID (含去除空白處理)
        const cloudIds = new Set(rows.map(row => String(row[0] || '').trim()));
        const localEntries = getAllEntries();
        const pendingDelIds = new Set(getPendingDeletions().map(id => String(id).trim()));
        let removedCount = 0;

        console.log('[Sync] 雲端現有 ID 數:', cloudIds.size);
        console.log('[Sync] 本地現有帳目數:', localEntries.length);
        console.log('[Sync] 待刪除 ID 數:', pendingDelIds.size);

        localEntries.forEach(entry => {
            const localId = String(entry.id).trim();

            // 跳過正在等待雲端刪除的帳目（不要把它們從本地重新加回來）
            if (pendingDelIds.has(localId)) {
                console.log(`[Sync] 帳目 ${localId} 在待刪除清單中，跳過對齊`);
                return;
            }

            // 如果本地標記為已同步，但在雲端找不到了，表示在 Sheets 端被手動刪除
            if (entry.synced && !cloudIds.has(localId)) {
                removeFromLocal(entry.id);
                removedCount++;
                console.log(`[Sync] 帳目 ${localId} 已在雲端消失，從本地移除`);
            }
        });

        if (removedCount > 0) {
            console.log(`[Sync] 已從本地移除 ${removedCount} 筆在雲端不存在的帳目`);
        }

        if (rows.length === 0) {
            notifySyncListeners('idle', removedCount > 0 ? '已同步雲端刪除' : '雲端無資料');
            window.dispatchEvent(new CustomEvent('entries-changed'));
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

        // 發送事件通知 UI 更新 (尤其是刪除後)
        window.dispatchEvent(new CustomEvent('entries-changed'));

        notifySyncListeners('success',
            (added > 0 || removedCount > 0)
                ? `同步完成 (新增 ${added}, 移除 ${removedCount})`
                : '已是最新'
        );
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

// 同步單筆變更 (新增或編輯)
export async function syncSingleEntry(entry) {
    if (!isLoggedIn()) return;
    return syncToSheet(); // 直接使用統一的同步邏輯最安全，避免邏輯分歧
}
// 處理雲端同步刪除
async function handleCloudDeletions() {
    const deletedIds = getPendingDeletions();
    if (deletedIds.length === 0) return;

    console.log('[Sync] ===== 開始雲端刪除流程 =====');
    console.log('[Sync] 待刪除 ID 清單:', JSON.stringify(deletedIds));
    console.log('[Sync] 使用的 spreadsheetId:', spreadsheetId);

    if (!spreadsheetId) {
        console.error('[Sync] spreadsheetId 為空，無法執行雲端刪除');
        return;
    }

    try {
        // 1. 取得試算表資訊以獲取正確的頁籤 ID (sheetId)
        console.log('[Sync] 步驟 1: 取得試算表資訊...');
        const ssInfo = await sheetsApi(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties`);
        const targetSheet = ssInfo.sheets.find(s => s.properties.title === SHEET_NAME);

        if (!targetSheet) {
            console.error(`[Sync] 找不到名為「${SHEET_NAME}」的頁籤，可用頁籤:`, ssInfo.sheets.map(s => s.properties.title));
            return;
        }

        const realSheetId = targetSheet.properties.sheetId;
        console.log('[Sync] 頁籤 sheetId:', realSheetId, '頁籤名稱:', targetSheet.properties.title);

        // 2. 抓取雲端的 A 欄 (ID) 以確認列號
        console.log('[Sync] 步驟 2: 讀取雲端 A 欄...');
        const result = await sheetsApi(
            `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(SHEET_NAME)}!A:A`
        );
        const rows = result.values || [];
        console.log('[Sync] 雲端共有', rows.length, '列 (含表頭)');

        if (rows.length === 0) {
            console.warn('[Sync] 雲端無任何內容，清除待刪除清單');
            clearPendingDeletions(deletedIds);
            return;
        }

        // 列出前幾個 ID 方便除錯
        console.log('[Sync] 雲端前 5 筆 ID:', rows.slice(0, 5).map(r => JSON.stringify(r[0])));

        // 3. 找出待刪除 ID 對應的 0-indexed 列號
        const indicesToDelete = [];
        const notFoundIds = [];

        deletedIds.forEach(id => {
            const targetId = String(id).trim();
            let found = false;

            for (let i = 0; i < rows.length; i++) {
                const cellValue = String(rows[i][0] || '').trim();
                if (cellValue === targetId) {
                    // 保護表頭
                    if (i === 0 && (cellValue === 'ID' || cellValue === 'id')) {
                        console.warn('[Sync] 跳過表頭列');
                    } else {
                        indicesToDelete.push(i);
                        console.log(`[Sync] ID「${targetId}」找到在第 ${i} 列 (0-indexed)`);
                    }
                    found = true;
                    break;
                }
            }

            if (!found) {
                notFoundIds.push(targetId);
                console.log(`[Sync] ID「${targetId}」在雲端未找到`);
            }
        });

        // 清除已不在雲端的 ID（不需要再追蹤了）
        if (notFoundIds.length > 0) {
            console.log('[Sync] 以下 ID 在雲端已不存在，直接清除:', notFoundIds);
            clearPendingDeletions(notFoundIds);
        }

        if (indicesToDelete.length === 0) {
            console.log('[Sync] 沒有需要在雲端刪除的列');
            return;
        }

        // 4. 排序 (由後往前刪，以免列號偏移)
        indicesToDelete.sort((a, b) => b - a);
        console.log('[Sync] 步驟 4: 即將刪除的列號 (0-indexed, 由後往前):', indicesToDelete);

        // 5. 發送批次更新請求
        const requests = indicesToDelete.map(index => ({
            deleteDimension: {
                range: {
                    sheetId: realSheetId,
                    dimension: 'ROWS',
                    startIndex: index,
                    endIndex: index + 1
                }
            }
        }));

        console.log('[Sync] 步驟 5: 發送 batchUpdate 請求...', JSON.stringify(requests));

        const batchResult = await sheetsApi(
            `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
            {
                method: 'POST',
                body: JSON.stringify({ requests })
            }
        );

        console.log('[Sync] batchUpdate 回應:', JSON.stringify(batchResult));

        // 6. 清除已成功刪除的 ID
        const successIds = deletedIds.filter(id => {
            const targetId = String(id).trim();
            return !notFoundIds.includes(targetId);
        });
        clearPendingDeletions(successIds);
        console.log(`[Sync] ✅ 成功同步刪除 ${indicesToDelete.length} 筆資料`);

    } catch (err) {
        console.error('[Sync] ❌ 雲端刪除程序失敗:', err.message);
        console.error('[Sync] 錯誤詳情:', err);
        // 不清除 pendingDeletions，讓下次同步時可以重試
        throw err; // 重新拋出讓上層知道
    }
}
