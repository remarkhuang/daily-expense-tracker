/**
 * 每日記帳 Telegram Bot - Google Apps Script (GAS)
 * 版本：1.1 (支援回覆訊息、UTC+8 時區、PWA 欄位對齊)
 */

// 請填入你的 Telegram Bot Token
const BOT_TOKEN = '8563514183:AAHZWeXwELL2Q1gq4ttloY4d3DrVv6O4W6o';
const SHEET_NAME = '帳目';

function doPost(e) {
  try {
    const contents = JSON.parse(e.postData.contents);
    if (!contents.message) return;
    
    const chatId = contents.message.chat.id;
    
    // 處理語音訊息
    if (contents.message.voice) {
      sendText(chatId, "🎤 收到語音！目前機器人僅支援【打字】記帳（例：午餐 150），或請在 PWA 網頁版中使用語音記帳功能喔！");
      return;
    }

    if (!contents.message.text) return;
    const text = contents.message.text;
    const now = new Date();
    
    // 處理指令
    if (text.startsWith('/')) {
      handleCommand(text, chatId, now);
      return;
    }

    // 檢查是否處於編輯模式
    const cache = CacheService.getScriptCache();
    const editingId = cache.get('editing_' + chatId);

    if (editingId) {
      if (text === '取消' || text === 'cancel') {
        cache.remove('editing_' + chatId);
        sendText(chatId, "已取消編輯。");
        return;
      }
      const editResult = editInSheet(editingId, text, now);
      sendText(chatId, editResult);
      cache.remove('editing_' + chatId); // 清除編輯狀態
      return;
    }
    
    // 解析文字 (格式：分類 金額 備註)
    const result = parseText(text, contents.message.message_id, now);
    
    if (!result) {
      sendText(chatId, "❌ 無法解析金額，請使用格式：『分類 金額』\n或輸入 /help 查看更多指令");
      return;
    }

    // 寫入試算表
    appendToSheet(result);
    
    // 回報成功訊息
    const successMsg = `✅ 記帳成功！\n📅 日期：${result.date}\n🏷️ 分類：${result.category}\n💰 金額：$${result.amount}\n📝 內容：${result.note}\n\n✏️ 編輯：/edit_${result.id}\n🗑️ 刪除：/del_${result.id}`;
    sendText(chatId, successMsg);
    
  } catch (err) {
    try {
      sendText(contents.message.chat.id, "⚠️ 錯誤：" + err.toString());
    } catch (e2) {}
  }
}

// 處理指令
function handleCommand(text, chatId, now) {
  const params = text.split(/\s+/); // 只用空白切割
  const cmd = params[0].toLowerCase();

  if (cmd === '/start' || cmd === '/help') {
    sendText(chatId, 
      "👋 歡迎使用每日記帳 Bot！\n\n" +
      "📌 **記帳方式**：\n" +
      "直接輸入：`午餐 120` 或 `交通 50 加油`\n\n" +
      "📌 **指令清單**：\n" +
      "/list - 查看最近 5 筆帳目\n" +
      "/edit [ID] - 編輯指定帳目 (輸入後Bot會提示輸入新內容)\n" +
      "/del [ID] - 刪除指定帳目\n" +
      "/help - 顯示此說明"
    );
  } else if (cmd.startsWith('/edit')) {
    let idToEdit = "";
    if (cmd.startsWith('/edit_')) {
       idToEdit = text.substring(6).trim();
    } else if (params.length >= 2) {
       idToEdit = params[1].trim();
    }

    if (!idToEdit) {
       sendText(chatId, "❌ 請指定 ID，例如：/edit_tg_12345");
       return;
    }
    
    // 設定快取，進入編輯模式 (10分鐘有效)
    CacheService.getScriptCache().put('editing_' + chatId, idToEdit, 600);
    sendText(chatId, `✏️ 請輸入 ID: ${idToEdit} 的新內容\n格式：『分類 金額 備註』(例如：晚餐 200)\n\n(輸入『取消』可退出編輯模式)`);

  } else if (cmd.startsWith('/del')) {
    // 支援兩種格式：
    // 1. /del_tg_123 (點擊指令)
    // 2. /del tg_123 (手動輸入)
    
    let idToDelete = "";
    
    if (cmd.startsWith('/del_')) {
      // 格式：/del_tg_123
      idToDelete = text.substring(5).trim(); // 移除 '/del_'
    } else if (params.length >= 2) {
      // 格式：/del tg_123
      idToDelete = params[1].trim();
    }
    
    if (!idToDelete) {
      sendText(chatId, "❌ 請指定 ID，例如：/del_tg_12345 (可從 /list 查詢)");
      return;
    }

    const result = deleteFromSheet(idToDelete);
    sendText(chatId, result);
    
  } else if (cmd === '/list') { // 取消 /cancel 指令，統一在編輯模式中處理
     const cache = CacheService.getScriptCache();
     cache.remove('editing_' + chatId); // 如果輸入 /list 強制退出編輯模式
     const list = getLastEntries(5);
     sendText(chatId, list);
  } else if (cmd === '/cancel') {
     const cache = CacheService.getScriptCache();
     cache.remove('editing_' + chatId);
     sendText(chatId, "已取消所有操作。");
  } else {
    sendText(chatId, "❌ 未知指令，輸入 /help 查看說明");
  }
}

// 編輯 Sheet 中的帳目
function editInSheet(id, newText, now) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) return "❌ 找不到『" + SHEET_NAME + "』頁籤";

  const targetId = String(id).trim();
  const data = sheet.getDataRange().getValues();
  
  // 尋找對應的列
  let rowIndex = -1;
  let originalDate = null;

  for (let i = data.length - 1; i >= 1; i--) {
    const sheetId = String(data[i][0]).trim();
    if (sheetId === targetId) {
      rowIndex = i + 1; // 1-based
      originalDate = data[i][1]; // 保留原始日期
      break;
    }
  }

  if (rowIndex === -1) return `❌ 找不到 ID 為 ${targetId} 的帳目，無法編輯。`;

  // 解析新內容 (傳入 0 作為 msgId，因為我們不使用這個新的 ID)
  const newEntry = parseText(newText, 0, now);
  if (!newEntry) return "❌ 無法解析新內容，請檢查格式 (例如: 午餐 150)";

  // 更新試算表
  // 欄位順序：ID, 日期, 類型, 分類, 金額, 備註
  // 我們只更新：分類(C3+1=4), 金額(C4+1=5), 備註(C5+1=6)
  // 注意 data[i] 是 0-based，sheet.getRange 是 1-based
  // ID=col1, Date=col2, Type=col3, Category=col4, Amount=col5, Note=col6
  
  // 保持原始日期 (如果原來有日期的話)
  if (originalDate) {
    // 寫回原始日期 (如果不變更)
    // 但 parseText 目前會回傳今天的日期字串。
    // 如果我們要保留 Date 物件格式，直接不更新 Date 欄位即可。
  }

  // 更新第 4, 5, 6 欄 (Category, Amount, Note)
  sheet.getRange(rowIndex, 4).setValue(newEntry.category);
  sheet.getRange(rowIndex, 5).setValue(newEntry.amount);
  sheet.getRange(rowIndex, 6).setValue(newEntry.note);

  return `✅ 編輯成功！\nID: ${targetId}\n新內容：${newEntry.category} $${newEntry.amount} (${newEntry.note})`;
}

// 從 Sheet 刪除
function deleteFromSheet(id) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) return "❌ 找不到『" + SHEET_NAME + "』頁籤";

  const targetId = String(id).trim();
  const data = sheet.getDataRange().getValues();
  
  // 通常第 0 欄是 ID
  for (let i = data.length - 1; i >= 1; i--) { // 從後面找回來，跳過標題
    const sheetId = String(data[i][0]).trim();
    if (sheetId === targetId) {
      sheet.deleteRow(i + 1); // deleteRow 是 1-based
      return `🗑️ 已刪除帳目 (ID: ${targetId})`;
    }
  }
  return `❌ 找不到 ID 為 ${targetId} 的帳目`;
}

// 取得最近帳目
function getLastEntries(count) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) return "尚無資料";
  
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return "尚無資料";
  
  const startRow = Math.max(2, lastRow - count + 1);
  const numRows = lastRow - startRow + 1;
  const data = sheet.getRange(startRow, 1, numRows, 7).getValues(); // 假設有 7 欄
  
  let msg = "📋 **最近帳目**：\n";
  // 反向顯示 (最新的在上面)
  for (let i = data.length - 1; i >= 0; i--) {
    const row = data[i];
    // ID, Date, Type, Category, Amount, Note, CreatedAt
    const id = row[0];
    const date = row[1]; // 可能需要格式化
    const cat = row[3];
    const amt = row[4];
    const note = row[5];
    
    // 簡單格式化日期
    let dateStr = date;
    if (date instanceof Date) {
      dateStr = Utilities.formatDate(date, "GMT+8", "MM-dd");
    }
    
    msg += `▫️ ${dateStr} ${cat} $${amt} (${note}) \n   ✏️ /edit_${id}  🗑️ /del_${id}\n`;
  }
  return msg;
}

// 解析邏輯
function parseText(text, msgId, now) {
  const parts = text.split(/[\s,]+/);
  if (parts.length < 1) return null;

  let category = "其他";
  let amount = 0;
  let note = "";

  if (parts.length === 1) {
    amount = parseFloat(parts[0]);
    note = "";
  } else {
    category = suggestCategory(parts[0]);
    amount = parseFloat(parts[1]);
    note = parts.slice(2).join(" ") || parts[0]; 
  }

  if (isNaN(amount)) return null;

  const dateStr = Utilities.formatDate(now, "GMT+8", "yyyy-MM-dd");
  const createdAt = Utilities.formatDate(now, "GMT+8", "yyyy-MM-dd HH:mm:ss");
  const id = "tg_" + msgId;

  return {
    id: id,
    date: dateStr,
    type: '支出', // 統一使用中文 '支出'
    category: category,
    amount: amount,
    note: note,
    createdAt: createdAt
  };
}

// 簡單分類建議
function suggestCategory(note) {
  // 如果使用者打的是內建分類，就直接給該分類，否則才進行關鍵字比對
  const defaultCats = ['飲食', '交通', '購物', '娛樂', '醫療', '生活', '投資', '人情', '學習', '工作', '其他'];
  if (defaultCats.includes(note)) return note;

  const categories = {
    '飲食': ['午餐', '早餐', '晚餐', '飲料', '星巴克', '飯', '麵', '吃'],
    '交通': ['捷運', '公車', '計程車', '加油', '停車', 'Uber'],
    '購物': ['買', '衣服', '淘寶', 'Shopee', '蝦皮'],
    '娛樂': ['電影', '遊戲', 'Netflix'],
    '醫療': ['看醫生', '藥', '診所'],
    '生活': ['水費', '電費', '房租']
  };

  for (let cat in categories) {
    if (categories[cat].some(keyword => note.includes(keyword))) {
      return cat;
    }
  }
  return '其他';
}

// 寫入試算表 (嚴格對齊 PWA 欄位)
function appendToSheet(entry) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  
  if (!sheet) {
    sheet = ss.getSheets()[0]; // 若找不到 '帳目' 分頁，取第一個
  }

  // 順序：ID, 日期, 類型, 分類, 金額, 備註, 建立時間
  sheet.appendRow([
    entry.id,
    entry.date,
    entry.type,
    entry.category,
    entry.amount,
    entry.note,
    entry.createdAt
  ]);
}

// 發送訊息 (使用確定可工作的 JSON POST 邏輯)
function sendText(chatId, text) {
  const url = "https://api.telegram.org/bot" + BOT_TOKEN + "/sendMessage";
  const payload = {
    "method": "post",
    "chat_id": String(chatId),
    "text": text,
    "parse_mode": "HTML"
  };
  UrlFetchApp.fetch(url, {
    "method": "post",
    "contentType": "application/json",
    "payload": JSON.stringify(payload)
  });
}
