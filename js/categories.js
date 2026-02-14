// ============================================
// categories.js — 分類管理
// ============================================

const DEFAULT_EXPENSE_CATEGORIES = [
    { icon: '🍽️', name: '飲食', type: 'expense' },
    { icon: '🚗', name: '交通', type: 'expense' },
    { icon: '🛒', name: '購物', type: 'expense' },
    { icon: '🎮', name: '娛樂', type: 'expense' },
    { icon: '🏠', name: '居住', type: 'expense' },
    { icon: '💊', name: '醫療', type: 'expense' },
    { icon: '📚', name: '教育', type: 'expense' },
    { icon: '👔', name: '服飾', type: 'expense' },
    { icon: '📱', name: '通訊', type: 'expense' },
    { icon: '💡', name: '水電', type: 'expense' },
    { icon: '🎁', name: '禮物', type: 'expense' },
    { icon: '📦', name: '其他', type: 'expense' },
];

const DEFAULT_INCOME_CATEGORIES = [
    { icon: '💼', name: '薪資', type: 'income' },
    { icon: '💰', name: '獎金', type: 'income' },
    { icon: '📈', name: '投資', type: 'income' },
    { icon: '🏦', name: '利息', type: 'income' },
    { icon: '🎯', name: '副業', type: 'income' },
    { icon: '📦', name: '其他收入', type: 'income' },
];

const STORAGE_KEY = 'expense_tracker_categories';

export function getCategories() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
        return JSON.parse(saved);
    }
    const defaults = [...DEFAULT_EXPENSE_CATEGORIES, ...DEFAULT_INCOME_CATEGORIES];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(defaults));
    return defaults;
}

export function getCategoriesByType(type) {
    return getCategories().filter(c => c.type === type);
}

export function addCategory(icon, name, type) {
    const cats = getCategories();
    if (cats.find(c => c.name === name && c.type === type)) {
        return false; // 已存在
    }
    cats.push({ icon, name, type });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cats));
    return true;
}

export function removeCategory(name, type) {
    let cats = getCategories();
    cats = cats.filter(c => !(c.name === name && c.type === type));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cats));
}

export function getCategoryIcon(name) {
    const cats = getCategories();
    const found = cats.find(c => c.name === name);
    return found ? found.icon : '📦';
}

// 用於語音辨識的分類關鍵字映射
export function getCategoryKeywords() {
    return {
        '飲食': ['早餐', '午餐', '晚餐', '宵夜', '便當', '飯', '麵', '咖啡', '飲料', '水果', '零食', '甜點', '小吃', '餐廳', '火鍋', '燒烤', '外送', '吃'],
        '交通': ['計程車', '公車', '捷運', '高鐵', '台鐵', '火車', '加油', '油錢', '停車', 'uber', '機車', '汽車', '騎車', '搭車', '車費'],
        '購物': ['網購', '購物', '買', '衣服', '鞋子', '包包', '超市', '賣場', '百貨'],
        '娛樂': ['電影', 'KTV', '遊戲', '旅遊', '旅行', '唱歌', '演唱會', '展覽', '門票'],
        '居住': ['房租', '租金', '管理費', '水費', '電費', '瓦斯', '網路費'],
        '醫療': ['看醫生', '掛號', '藥', '看診', '健檢', '門診', '牙醫', '眼科'],
        '教育': ['學費', '書', '課程', '補習', '文具'],
        '服飾': ['衣服', '褲子', '外套', '鞋'],
        '通訊': ['電話費', '手機', '電信'],
        '水電': ['水費', '電費', '瓦斯費'],
        '薪資': ['薪水', '薪資', '月薪', '工資'],
        '獎金': ['獎金', '年終', '紅包', '分紅'],
        '投資': ['股票', '基金', '股利', '配息', '投資'],
        '利息': ['利息', '定存'],
        '副業': ['兼職', '副業', '接案', '外包'],
    };
}
