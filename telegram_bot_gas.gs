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
    
    // 解析文字 (格式：分類 金額 備註)
    const result = parseText(text, contents.message.message_id, now);
    
    if (!result) {
      sendText(chatId, "❌ 無法解析金額，請使用格式：『分類 金額』，例如：『午餐 100』");
      return;
    }

    // 寫入試算表
    appendToSheet(result);
    
    // 回報成功訊息 (使用時區校正後的日期)
    const successMsg = "✅ 記帳成功！\n📅 日期：" + result.date + "\n🏷️ 分類：" + result.category + "\n💰 金額：$" + result.amount + "\n📝 內容：" + result.note;
    sendText(chatId, successMsg);
    
  } catch (err) {
    // 嘗試回傳錯誤
    try {
      const contents = JSON.parse(e.postData.contents);
      sendText(contents.message.chat.id, "⚠️ 系統診斷訊息：\n" + err.toString());
    } catch (e2) {}
  }
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
    note = "來自 Telegram";
  } else {
    category = suggestCategory(parts[0]);
    amount = parseFloat(parts[1]);
    note = parts.slice(2).join(" ") || parts[0]; 
    if (note === parts[0]) note = parts[0] + " (來自 Telegram)";
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
