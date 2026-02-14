// ============================================
// voice.js — 語音辨識 + 自然語言解析
// ============================================

import { getCategoryKeywords, getCategoriesByType } from './categories.js';

let recognition = null;
let isListening = false;

const voiceListeners = [];

export function onVoiceResult(callback) {
    voiceListeners.push(callback);
}

function notifyVoiceListeners(event, data) {
    voiceListeners.forEach(fn => fn(event, data));
}

export function isVoiceSupported() {
    return ('SpeechRecognition' in window) || ('webkitSpeechRecognition' in window);
}

export function initVoice() {
    if (!isVoiceSupported()) {
        console.warn('[Voice] 此瀏覽器不支援語音辨識');
        return;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognition = new SpeechRecognition();
    recognition.lang = 'zh-TW';
    recognition.continuous = false;
    recognition.interimResults = true;

    recognition.onstart = () => {
        isListening = true;
        notifyVoiceListeners('start', null);
    };

    recognition.onresult = (event) => {
        let interimTranscript = '';
        let finalTranscript = '';

        for (let i = event.resultIndex; i < event.results.length; i++) {
            const transcript = event.results[i][0].transcript;
            if (event.results[i].isFinal) {
                finalTranscript += transcript;
            } else {
                interimTranscript += transcript;
            }
        }

        if (interimTranscript) {
            notifyVoiceListeners('interim', interimTranscript);
        }

        if (finalTranscript) {
            const parsed = parseVoiceInput(finalTranscript);
            notifyVoiceListeners('final', { raw: finalTranscript, parsed });
        }
    };

    recognition.onerror = (event) => {
        isListening = false;
        notifyVoiceListeners('error', event.error);
    };

    recognition.onend = () => {
        isListening = false;
        notifyVoiceListeners('end', null);
    };
}

export function startListening() {
    if (!recognition) {
        initVoice();
    }
    if (recognition && !isListening) {
        try {
            recognition.start();
        } catch (e) {
            console.error('[Voice] 啟動失敗:', e);
        }
    }
}

export function stopListening() {
    if (recognition && isListening) {
        recognition.stop();
    }
}

export function getIsListening() {
    return isListening;
}

// ---- 自然語言解析 ----

// 中文數字轉阿拉伯數字
function chineseToNumber(str) {
    const numMap = {
        '零': 0, '〇': 0, '一': 1, '二': 2, '兩': 2, '三': 3, '四': 4,
        '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10,
        '百': 100, '千': 1000, '萬': 10000, '億': 100000000,
    };

    // 先嘗試直接轉數字
    const directNum = Number(str);
    if (!isNaN(directNum) && directNum > 0) return directNum;

    let result = 0;
    let current = 0;
    let temp = 0;

    for (const ch of str) {
        if (numMap[ch] !== undefined) {
            const val = numMap[ch];
            if (val >= 10000) {
                // 萬、億
                temp = (temp || 1) * val;
                result += temp;
                temp = 0;
            } else if (val >= 10) {
                // 十、百、千
                temp = (current || 1) * val;
                current = 0;
            } else {
                current = val;
            }
        }
    }
    result += temp + current;

    return result || 0;
}

// 從文字中提取金額  
function extractAmount(text) {
    // 先嘗試匹配阿拉伯數字
    const arabicMatch = text.match(/(\d+(?:\.\d+)?)/);
    if (arabicMatch) {
        return Number(arabicMatch[1]);
    }

    // 嘗試中文數字
    const chineseNumPattern = /([零一二兩三四五六七八九十百千萬億]+)/;
    const chineseMatch = text.match(chineseNumPattern);
    if (chineseMatch) {
        const num = chineseToNumber(chineseMatch[1]);
        if (num > 0) return num;
    }

    return 0;
}

// 從文字中判斷分類
function inferCategory(text) {
    const keywords = getCategoryKeywords();

    for (const [category, words] of Object.entries(keywords)) {
        for (const word of words) {
            if (text.includes(word)) {
                return category;
            }
        }
    }
    return null;
}

// 判斷是收入還是支出
function inferType(text, category) {
    const incomeKeywords = ['薪水', '薪資', '收入', '獎金', '年終', '紅包', '股利', '配息', '利息', '進帳', '存入'];
    for (const kw of incomeKeywords) {
        if (text.includes(kw)) return 'income';
    }

    // 檢查分類是否屬於收入
    if (category) {
        const incomeCats = getCategoriesByType('income');
        if (incomeCats.find(c => c.name === category)) {
            return 'income';
        }
    }

    return 'expense';
}

// 主要解析函式
export function parseVoiceInput(text) {
    const cleaned = text.trim();
    const amount = extractAmount(cleaned);
    const category = inferCategory(cleaned);
    const type = inferType(cleaned, category);

    // 去除金額和分類關鍵字後，剩下的作為備註
    let note = cleaned;

    return {
        amount,
        category: category || (type === 'income' ? '其他收入' : '其他'),
        type,
        note,
    };
}
