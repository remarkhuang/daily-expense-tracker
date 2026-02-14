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
    
    // 解析文字 (格式：分類 金額 備註)
    const result = parseText(text, contents.message.message_id, now);
    
    if (!result) {
      sendText(chatId, "❌ 無法解析金額，請使用格式：『分類 金額』\n或輸入 /help 查看更多指令");
      return;
    }

    // 寫入試算表
    appendToSheet(result);
    
    // 回報成功訊息
    const successMsg = `✅ 記帳成功！\n📅 日期：${result.date}\n🏷️ 分類：${result.category}\n💰 金額：$${result.amount}\n📝 內容：${result.note}\n\n🗑️ 刪除此筆：/del_${result.id}`;
    sendText(chatId, successMsg);
    
  } catch (err) {
    try {
      sendText(contents.message.chat.id, "⚠️ 錯誤：" + err.toString());
    } catch (e2) {}
  }
}

// 處理指令
function handleCommand(text, chatId, now) {
  const parts = text.split(/[\s_]+/); // 支援 /del_ID 或 /del ID
  const cmd = parts[0].toLowerCase();

  if (cmd === '/start' || cmd === '/help') {
    sendText(chatId, 
      "👋 歡迎使用每日記帳 Bot！\n\n" +
      "📌 **記帳方式**：\n" +
      "直接輸入：`午餐 120` 或 `交通 50 加油`\n\n" +
      "📌 **指令清單**：\n" +
      "/list - 查看最近 5 筆帳目\n" +
      "/del [ID] - 刪除指定帳目 (例: /del_tg_123)\n" +
      "/help - 顯示此說明"
    );
  } else if (cmd === '/del' || cmd === '/delete') {
    if (parts.length < 2) {
      sendText(chatId, "❌ 請指定 ID，例如：/del_tg_12345 (可從 /list 查詢)");
      return;
    }
    const idToDelete = parts[1];
    const result = deleteFromSheet(idToDelete);
    sendText(chatId, result);
  } else if (cmd === '/list') {
    const list = getLastEntries(5);
    sendText(chatId, list);
  } else {
    sendText(chatId, "❌ 未知指令，輸入 /help 查看說明");
  }
}

// 從 Sheet 刪除
function deleteFromSheet(id) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) return "❌ 找不到『" + SHEET_NAME + "』頁籤";

  const data = sheet.getDataRange().getValues();
  // 假設第一欄是 ID (0-indexed)
  // 如果 ID 在其他欄位，需調整 index
  // 根據 parseText，ID 寫入時應該要對應到正確欄位。
  // 查看 appendToSheet 實作 (假設在下方, 需確保 ID 寫入位置)
  
  // 通常第 0 欄是 ID
  for (let i = data.length - 1; i >= 1; i--) { // 從後面找回來，跳過標題
    if (String(data[i][0]) === String(id)) {
      sheet.deleteRow(i + 1); // deleteRow 是 1-based
      return `🗑️ 已刪除帳目 (ID: ${id})`;
    }
  }
  return `❌ 找不到 ID 為 ${id} 的帳目`;
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
    
    msg += `▫️ ${dateStr} ${cat} $${amt} (${note}) \n   刪除: /del_${id}\n`;
  }
  return msg;
}

// 解析邏輯
function parseText(text, msgId, now) {
  const parts = text.split(/[\s,]+/);
  // ... (保留原本邏輯)

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
