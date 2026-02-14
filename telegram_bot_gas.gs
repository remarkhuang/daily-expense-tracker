/**
 * 每日記帳 Telegram Bot - Google Apps Script (GAS)
 * 轉貼到 Apps Script 編輯器中
 */

const TOKEN = '你的_TELEGRAM_BOT_TOKEN'; // 請填入從 BotFather 取得的 Token
const SHEET_NAME = '帳目';

// 當 Telegram 傳送訊息時會觸發此函式
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    if (!data.message || !data.message.text) return;

    const chatId = data.message.chat.id;
    const text = data.message.text;

    // 解析文字 (例如: "午餐 150" 或 "發票 1201.23")
    const result = parseText(text);
    if (!result) {
      sendMessage(chatId, "❌ 解析失敗\n請輸入格式如：午餐 150 或 早餐 50.5");
      return;
    }

    // 寫入試算表
    appendToSheet(result);
    
    sendMessage(chatId, `✅ 記帳成功！\n日期：${result.date}\n分類：${result.category}\n金額：${result.amount}\n內容：${result.note}`);
  } catch (err) {
    // 錯誤回報 (可選)
  }
}

// 解析邏輯
function parseText(text) {
  const parts = text.split(/[\s,]+/);
  if (parts.length < 2) return null;

  let note = parts[0];
  let amountStr = parts[1];
  
  // 簡單判斷金額
  const amount = parseFloat(amountStr);
  if (isNaN(amount)) return null;

  // 自動分類邏輯 (可根據需求擴展)
  const category = suggestCategory(note);
  const now = new Date();
  const dateStr = Utilities.formatDate(now, "GMT+8", "yyyy-MM-dd");
  const createdAt = now.toISOString();
  const id = "tg_" + Math.random().toString(36).substring(2, 9);

  return {
    id: id,
    date: dateStr,
    type: '支出', // 必須使用中文 '支出' 或 '收入'
    category: category,
    amount: amount,
    note: note + " (來自 Telegram)",
    createdAt: createdAt
  };
}

// 簡單分類建議
function suggestCategory(note) {
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

// 寫入試算表 (確保符合 PWA 格式)
function appendToSheet(entry) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(['ID', '日期', '類型', '分類', '金額', '備註', '建立時間']);
  }

  // 嚴格遵循 PWA 格式：
  // [0]ID, [1]日期, [2]類型, [3]分類, [4]金額, [5]備註, [6]建立時間
  sheet.appendRow([
    entry.id,         // A 欄
    entry.date,       // B 欄
    entry.type,       // C 欄
    entry.category,   // D 欄
    entry.amount,     // E 欄
    entry.note,       // F 欄
    entry.createdAt   // G 欄
  ]);
}

// 發送 Telegram 訊息
function sendMessage(chatId, text) {
  const url = `https://api.telegram.org/bot${TOKEN}/sendMessage`;
  const payload = {
    chat_id: chatId,
    text: text
  };
  UrlFetchApp.fetch(url, {
    method: 'post',
    payload: payload
  });
}
