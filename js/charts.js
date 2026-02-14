// ============================================
// charts.js — Chart.js 圖表分析
// ============================================

import { Chart, registerables } from 'chart.js';
import { getEntriesByMonth, getMonthSummary } from './store.js';
import { getCategoryIcon } from './categories.js';

Chart.register(...registerables);

let doughnutChart = null;
let lineChart = null;
let barChart = null;
let chartYear, chartMonth;

const CHART_COLORS = [
    '#6c5ce7', '#00d2d3', '#ff6b6b', '#ffa502', '#2ed573',
    '#a29bfe', '#fd79a8', '#fdcb6e', '#e17055', '#74b9ff',
    '#55efc4', '#dfe6e9',
];

export function initCharts() {
    const now = new Date();
    chartYear = now.getFullYear();
    chartMonth = now.getMonth();

    document.getElementById('chart-prev-month').addEventListener('click', () => {
        chartMonth--;
        if (chartMonth < 0) { chartMonth = 11; chartYear--; }
        renderCharts();
    });

    document.getElementById('chart-next-month').addEventListener('click', () => {
        chartMonth++;
        if (chartMonth > 11) { chartMonth = 0; chartYear++; }
        renderCharts();
    });

    window.addEventListener('entries-changed', renderCharts);
}

export function renderCharts() {
    updateMonthLabel();
    renderSummaryCards();
    renderDoughnut();
    renderLine();
    renderBar();
}

function updateMonthLabel() {
    document.getElementById('chart-month-label').textContent =
        `${chartYear} 年 ${chartMonth + 1} 月`;
}

function renderSummaryCards() {
    const summary = getMonthSummary(chartYear, chartMonth);
    document.getElementById('summary-income').textContent = `$${summary.income.toLocaleString()}`;
    document.getElementById('summary-expense').textContent = `$${summary.expense.toLocaleString()}`;
    const balanceEl = document.getElementById('summary-balance');
    balanceEl.textContent = `${summary.balance >= 0 ? '+' : ''}$${summary.balance.toLocaleString()}`;
    balanceEl.style.color = summary.balance >= 0 ? 'var(--income-color)' : 'var(--expense-color)';
}

function renderDoughnut() {
    const canvas = document.getElementById('chart-doughnut');
    const entries = getEntriesByMonth(chartYear, chartMonth)
        .filter(e => e.type === 'expense');

    if (doughnutChart) doughnutChart.destroy();

    if (entries.length === 0) {
        canvas.parentElement.innerHTML = '<div class="no-data-chart">本月尚無支出</div>';
        // Restore canvas
        const container = canvas.parentElement || document.querySelector('.chart-card:first-child .chart-container');
        if (!document.getElementById('chart-doughnut')) {
            container.innerHTML = '<canvas id="chart-doughnut"></canvas>';
        }
        return;
    }

    // 確保 canvas 存在
    let ctx;
    const existingCanvas = document.getElementById('chart-doughnut');
    if (existingCanvas) {
        ctx = existingCanvas.getContext('2d');
    } else {
        return;
    }

    // 按分類加總
    const catTotals = {};
    entries.forEach(e => {
        catTotals[e.category] = (catTotals[e.category] || 0) + e.amount;
    });

    const labels = Object.keys(catTotals);
    const data = Object.values(catTotals);

    doughnutChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels.map(l => `${getCategoryIcon(l)} ${l}`),
            datasets: [{
                data,
                backgroundColor: CHART_COLORS.slice(0, labels.length),
                borderColor: 'rgba(15, 15, 35, 0.8)',
                borderWidth: 2,
                hoverOffset: 8,
            }],
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            cutout: '60%',
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        color: '#9d9db8',
                        padding: 12,
                        font: { size: 12, family: "'Noto Sans TC', sans-serif" },
                    },
                },
                tooltip: {
                    callbacks: {
                        label: (ctx) => {
                            const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
                            const pct = ((ctx.parsed / total) * 100).toFixed(1);
                            return ` $${ctx.parsed.toLocaleString()} (${pct}%)`;
                        },
                    },
                },
            },
            animation: {
                animateRotate: true,
                animateScale: true,
            },
        },
    });
}

function renderLine() {
    const canvas = document.getElementById('chart-line');
    const entries = getEntriesByMonth(chartYear, chartMonth)
        .filter(e => e.type === 'expense');

    if (lineChart) lineChart.destroy();

    // 取得該月天數
    const daysInMonth = new Date(chartYear, chartMonth + 1, 0).getDate();
    const dailyExpense = new Array(daysInMonth).fill(0);

    entries.forEach(e => {
        const day = new Date(e.date).getDate() - 1;
        if (day >= 0 && day < daysInMonth) {
            dailyExpense[day] += e.amount;
        }
    });

    const labels = Array.from({ length: daysInMonth }, (_, i) => `${i + 1}`);

    const ctx = canvas.getContext('2d');
    lineChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [{
                label: '每日支出',
                data: dailyExpense,
                borderColor: '#ff6b6b',
                backgroundColor: 'rgba(255, 107, 107, 0.1)',
                fill: true,
                tension: 0.4,
                pointRadius: 3,
                pointHoverRadius: 6,
                pointBackgroundColor: '#ff6b6b',
            }],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: {
                    ticks: { color: '#6b6b8a', font: { size: 10 }, maxRotation: 0 },
                    grid: { color: 'rgba(255,255,255,0.03)' },
                },
                y: {
                    ticks: {
                        color: '#6b6b8a',
                        font: { size: 10 },
                        callback: (v) => `$${v.toLocaleString()}`,
                    },
                    grid: { color: 'rgba(255,255,255,0.05)' },
                    beginAtZero: true,
                },
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: (ctx) => `支出: $${ctx.parsed.y.toLocaleString()}`,
                    },
                },
            },
            animation: {
                duration: 800,
                easing: 'easeOutQuart',
            },
        },
    });
}

function renderBar() {
    const canvas = document.getElementById('chart-bar');
    if (barChart) barChart.destroy();

    const labels = [];
    const incomes = [];
    const expenses = [];

    for (let i = 5; i >= 0; i--) {
        let y = chartYear;
        let m = chartMonth - i;
        if (m < 0) { m += 12; y--; }
        labels.push(`${y}/${m + 1}`);
        const summary = getMonthSummary(y, m);
        incomes.push(summary.income);
        expenses.push(summary.expense);
    }

    const ctx = canvas.getContext('2d');
    barChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [
                {
                    label: '收入',
                    data: incomes,
                    backgroundColor: 'rgba(0, 210, 211, 0.7)',
                    borderRadius: 6,
                    borderSkipped: false,
                },
                {
                    label: '支出',
                    data: expenses,
                    backgroundColor: 'rgba(255, 107, 107, 0.7)',
                    borderRadius: 6,
                    borderSkipped: false,
                },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: {
                    ticks: { color: '#6b6b8a', font: { size: 11 } },
                    grid: { display: false },
                },
                y: {
                    ticks: {
                        color: '#6b6b8a',
                        font: { size: 10 },
                        callback: (v) => `$${(v / 1000).toFixed(0)}k`,
                    },
                    grid: { color: 'rgba(255,255,255,0.05)' },
                    beginAtZero: true,
                },
            },
            plugins: {
                legend: {
                    labels: {
                        color: '#9d9db8',
                        font: { size: 12, family: "'Noto Sans TC', sans-serif" },
                    },
                },
                tooltip: {
                    callbacks: {
                        label: (ctx) => `${ctx.dataset.label}: $${ctx.parsed.y.toLocaleString()}`,
                    },
                },
            },
            animation: {
                duration: 800,
                easing: 'easeOutQuart',
            },
        },
    });
}
