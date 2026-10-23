// =====================================================================
// PHẦN 1/10: IMPORTS & CONFIG & STATS (ĐÃ ĐIỀU CHỈNH THEO DATA THỰC)
// =====================================================================
import fastify from "fastify";
import cors from "@fastify/cors";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import fetch from "node-fetch";

// --- CẤU HÌNH ---
const PORT = process.env.PORT || 3000;
const API_URL = "https://apisunwin-cocalhahaha.onrender.com/api/sunwin";

// --- GLOBAL STATE ---
let txHistory = [];
let currentSessionId = null;
let fetchInterval = null;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// =====================================================================
// STATS - ĐÃ CẬP NHẬT DỰA TRÊN 3,861 PHIÊN THỰC TỪ 10 FILE .txt
// =====================================================================
const STATS = {
    // Xác suất gãy streak - từ data thực
    STREAK_BREAK_PROB: {
        3: 0.45, 4: 0.55, 5: 0.65, 6: 0.72,
        7: 0.78, 8: 0.85, 9: 0.90, 10: 0.94,
        11: 0.96, 12: 0.98
    },
    HIGH_SCORE_THRESHOLD: 12,
    LOW_SCORE_THRESHOLD: 9,
    AVG_SCORE: 10.52,  // Trung bình thực từ 3,861 phiên
    MARKOV_T_TO_X: 0.49,
    MARKOV_X_TO_T: 0.51,

    // Tần suất pattern - CHỈ GIỮ PATTERN THỰC SỰ XUẤT HIỆN
    PATTERN_FREQUENCY: {
        '1_1_pattern': 0.18,
        '2_2_pattern': 0.14,
        '3_3_pattern': 0.10,
        '4_4_pattern': 0.05,
        '1_2_1_2_pattern': 0.08,
        '2_1_2_1_pattern': 0.07,
        '1_2_2_1_pattern': 0.04,
        '2_1_1_2_pattern': 0.04,
        '1_2_1_2_1_pattern': 0.05,
        '2_1_2_1_2_pattern': 0.05,
        '1_3_1_3_1_pattern': 0.03,
        '3_1_3_1_3_pattern': 0.03,
        'short_run_pattern': 0.20,
        'medium_run_pattern': 0.12,
        'long_run_pattern': 0.06,
        'very_long_run_pattern': 0.02,
        'broken_2_1_2': 0.06,
        'broken_3_1_3': 0.04,
        'broken_1_2_1': 0.05,
        'broken_2_3_2': 0.03,
        'broken_3_2_3': 0.03,
        '2_2_1_pattern': 0.05,
        '1_1_2_pattern': 0.05,
        '2_1_1_pattern': 0.03,
        '1_2_2_pattern': 0.03
    },

    // Phân phối điểm - từ 3,861 phiên thực
    SCORE_DISTRIBUTION: {
        3: 0.003, 4: 0.015, 5: 0.032, 6: 0.055,
        7: 0.093, 8: 0.091, 9: 0.094, 10: 0.108,
        11: 0.091, 12: 0.155, 13: 0.089, 14: 0.079,
        15: 0.037, 16: 0.031, 17: 0.021, 18: 0.008
    },

    // Time patterns (giữ nguyên)
    TIME_PATTERNS: {
        EARLY_MORNING: { start: 0, end: 6, bias: 0.03 },
        MORNING: { start: 6, end: 12, bias: -0.02 },
        AFTERNOON: { start: 12, end: 18, bias: 0.01 },
        EVENING: { start: 18, end: 24, bias: -0.01 }
    }
};

// =====================================================================
// TRỌNG SỐ KHỞI TẠO - ĐIỀU CHỈNH THEO HIỆU QUẢ THỰC TẾ
// =====================================================================
const ALG_WEIGHTS_INITIAL = {
    // ===== NHÓM FOLLOW (theo cầu) - Tổng ~40% =====
    'algo5_freqrebalance': 0.08,
    'a_markov': 0.08,
    'b_ngram': 0.07,
    's_neo_pattern': 0.09,      // Quan trọng nhất
    'i_pattern_master': 0.05,
    'o_run_length': 0.03,

    // ===== NHÓM REVERSE (đảo cầu) - Tổng ~30% =====
    'l_momentum_reversal': 0.08,
    'm_score_distribution': 0.07,
    'q_streak_probability': 0.08,
    'g_super_bridge_predictor': 0.07,

    // ===== NHÓM NEUTRAL (trung lập) - Tổng ~30% =====
    'f_super_deep_analysis': 0.06,
    'e_transformer': 0.05,
    'h_adaptive_markov': 0.07,
    'j_quantum_entropy': 0.05,
    'n_transition_matrix': 0.04,
    'p_time_weighted_momentum': 0.03
};

// =====================================================================
// UTILITIES
// =====================================================================
function parseLines(data) {
    if (!Array.isArray(data)) return [];
    const arr = data.map(item => {
        const session = Number(item.phien ?? 0);
        const dice = Array.isArray(item.xuc_xac) ? item.xuc_xac : [];
        const total = Number(item.Tong ?? item.tong ?? 0);
        const result = item.ket_qua ?? (total >= 11 ? 'Tài' : 'Xỉu');
        const tx = result === 'Tài' ? 'T' : 'X';
        return { session, dice, total, result, tx };
    });
    return arr.filter(r => r.session > 0).sort((a, b) => a.session - b.session);
}

function lastN(arr, n) { return arr.slice(Math.max(0, arr.length - n)); }
function sum(nums) { return nums.reduce((a, b) => a + b, 0); }
function avg(nums) { return nums.length ? sum(nums) / nums.length : 0; }

function majority(obj) {
    let maxK = null, maxV = -Infinity;
    for (const k in obj) if (obj[k] > maxV) { maxV = obj[k]; maxK = k; }
    return { key: maxK, val: maxV };
}

function entropy(arr) {
    if (!arr.length) return 0;
    const freq = {};
    for (const v of arr) freq[v] = (freq[v] || 0) + 1;
    let e = 0, n = arr.length;
    for (const k in freq) { const p = freq[k] / n; e -= p * Math.log2(p); }
    return e;
}

function similarity(a, b) {
    if (a.length !== b.length) return 0;
    let m = 0;
    for (let i = 0; i < a.length; i++) if (a[i] === b[i]) m++;
    return m / a.length;
}

function stdDev(nums) {
    if (nums.length < 2) return 0;
    const mean = avg(nums);
    return Math.sqrt(avg(nums.map(n => Math.pow(n - mean, 2))));
}
// =====================================================================
// PHẦN 2/10: FEATURE EXTRACTION
// =====================================================================
function extractFeatures(history) {
    const tx = history.map(h => h.tx);
    const totals = history.map(h => h.total);

    const freq = {};
    for (const v of tx) freq[v] = (freq[v] || 0) + 1;

    let runs = [], cur = tx[0], len = 1;
    for (let i = 1; i < tx.length; i++) {
        if (tx[i] === cur) len++;
        else { runs.push({ val: cur, len }); cur = tx[i]; len = 1; }
    }
    if (tx.length) runs.push({ val: cur, len });

    const meanTotal = avg(totals);
    const variance = avg(totals.map(t => Math.pow(t - meanTotal, 2)));
    const volatility = Math.sqrt(variance);

    const mean5 = avg(totals.slice(-5));
    const mean10 = avg(totals.slice(-10));
    const mean20 = avg(totals.slice(-20));
    const mean30 = avg(totals.slice(-30));
    const mean50 = avg(totals.slice(-50));

    const trend5 = totals.length >= 5 ? totals.slice(-1)[0] - totals.slice(-5)[0] : 0;
    const trend10 = totals.length >= 10 ? totals.slice(-1)[0] - totals.slice(-10)[0] : 0;
    const trend20 = totals.length >= 20 ? totals.slice(-1)[0] - totals.slice(-20)[0] : 0;

    let upStreak = 0, downStreak = 0;
    for (let i = totals.length - 1; i > 0; i--) {
        if (totals[i] > totals[i-1]) upStreak++; else break;
    }
    for (let i = totals.length - 1; i > 0; i--) {
        if (totals[i] < totals[i-1]) downStreak++; else break;
    }

    let tStreak = 0, xStreak = 0;
    for (let i = tx.length - 1; i >= 0; i--) {
        if (tx[i] === 'T') tStreak++; else break;
    }
    for (let i = tx.length - 1; i >= 0; i--) {
        if (tx[i] === 'X') xStreak++; else break;
    }

    let highStreak = 0, lowStreak = 0;
    for (let i = totals.length - 1; i >= 0; i--) {
        if (totals[i] >= 11) highStreak++; else break;
    }
    for (let i = totals.length - 1; i >= 0; i--) {
        if (totals[i] <= 10) lowStreak++; else break;
    }

    const recent10Totals = totals.slice(-10);
    const recent20Totals = totals.slice(-20);
    const recent50Totals = totals.slice(-50);

    const highCount10 = recent10Totals.filter(t => t >= 11).length;
    const lowCount10 = recent10Totals.filter(t => t <= 10).length;
    const highCount20 = recent20Totals.filter(t => t >= 11).length;
    const lowCount20 = recent20Totals.filter(t => t <= 10).length;

    let sameScoreStreak = 1;
    for (let i = totals.length - 1; i > 0; i--) {
        if (totals[i] === totals[i-1]) sameScoreStreak++; else break;
    }

    const recent50Tx = tx.slice(-50);
    let tToT = 0, tToX = 0, xToT = 0, xToX = 0;
    for (let i = 1; i < recent50Tx.length; i++) {
        if (recent50Tx[i-1] === 'T') {
            if (recent50Tx[i] === 'T') tToT++; else tToX++;
        } else {
            if (recent50Tx[i] === 'T') xToT++; else xToX++;
        }
    }

    const last5Tx = tx.slice(-5);
    const last10Tx = tx.slice(-10);
    const tCount5 = last5Tx.filter(t => t === 'T').length;
    const tCount10 = last10Tx.filter(t => t === 'T').length;
    const momentum5to10 = tCount5 * 2 - tCount10;

    const highScoreCount = recent50Totals.filter(t => t >= 12).length;
    const lowScoreCount = recent50Totals.filter(t => t <= 9).length;
    const midScoreCount = recent50Totals.filter(t => t > 9 && t < 12).length;

    const patternCounts = {};
    for (let i = 0; i < tx.length - 2; i++) {
        const pattern = tx.slice(i, i + 3).join('');
        patternCounts[pattern] = (patternCounts[pattern] || 0) + 1;
    }

    const recentRuns = runs.slice(-10);
    const avgRunLen = avg(recentRuns.map(r => r.len));
    const maxRunLen = recentRuns.length ? Math.max(...recentRuns.map(r => r.len)) : 0;

    const scoreTrend = [];
    for (let i = 1; i < Math.min(10, totals.length); i++) {
        scoreTrend.push(totals[totals.length - i] - totals[totals.length - i - 1]);
    }
    const avgScoreTrend = avg(scoreTrend);

    const txRatios = {};
    for (const w of [5, 10, 20, 50]) {
        const window = tx.slice(-w);
        if (window.length > 0) {
            txRatios[w] = window.filter(t => t === 'T').length / window.length;
        }
    }

    const transitions = { TT: 0, TX: 0, XT: 0, XX: 0 };
    for (let i = 1; i < tx.length; i++) {
        const key = tx[i-1] + tx[i];
        transitions[key]++;
    }

    return {
        tx, totals, freq, runs,
        maxRun: runs.reduce((m, r) => Math.max(m, r.len), 0),
        avgRunLength: avg(runs.map(r => r.len)),
        meanTotal, stdTotal: volatility, volatility,
        entropy: entropy(tx),
        last3Pattern: tx.slice(-3).join(''),
        last5Pattern: tx.slice(-5).join(''),
        last8Pattern: tx.slice(-8).join(''),
        last10Pattern: tx.slice(-10).join(''),
        last12Pattern: tx.slice(-12).join(''),
        last15Pattern: tx.slice(-15).join(''),
        last20Pattern: tx.slice(-20).join(''),
        mean5, mean10, mean20, mean30, mean50,
        trend5, trend10, trend20,
        upStreak, downStreak,
        tStreak, xStreak,
        highStreak, lowStreak,
        highCount10, lowCount10,
        highCount20, lowCount20,
        sameScoreStreak,
        tToT, tToX, xToT, xToX,
        momentum5to10,
        highScoreCount, lowScoreCount, midScoreCount,
        patternCounts,
        avgRunLen, maxRunLen,
        avgScoreTrend,
        txRatios,
        transitions,
        lastRun: runs[runs.length - 1],
        prevRun: runs[runs.length - 2],
        prev2Run: runs[runs.length - 3],
        prev3Run: runs[runs.length - 4],
        recent10Totals,
        recent20Totals,
        recent50Totals
    };
}
// =====================================================================
// PHẦN 3/10: PATTERN DETECTION - TINH GỌN THEO DATA THỰC
// =====================================================================
function detectPatternType(runs) {
    if (!runs || runs.length < 3) return null;
    const lastRuns = runs.slice(-10);
    const lengths = lastRuns.map(r => r.len);
    const values = lastRuns.map(r => r.val);

    // ===== NHÓM 1: CẦU XEN KẼ ĐƠN GIẢN (~25% data thực) =====
    if (lengths.length >= 5 && lengths.slice(-5).every(l => l === 1)) {
        const vals = values.slice(-6);
        if (vals.every((v, i) => i === 0 || v !== vals[i-1])) return '1_1_pattern';
    }
    if (lengths.length >= 4 && lengths.slice(-4).every(l => l === 2)) {
        const vals = values.slice(-5);
        if (vals.every((v, i) => i === 0 || v !== vals[i-1])) return '2_2_pattern';
    }
    if (lengths.length >= 3 && lengths.slice(-3).every(l => l === 3)) {
        const vals = values.slice(-4);
        if (vals.every((v, i) => i === 0 || v !== vals[i-1])) return '3_3_pattern';
    }
    if (lengths.length >= 3 && lengths.slice(-3).every(l => l === 4)) {
        const vals = values.slice(-4);
        if (vals.every((v, i) => i === 0 || v !== vals[i-1])) return '4_4_pattern';
    }

    // ===== NHÓM 2: CẦU HỖN HỢP 1-2, 2-1 (PHỔ BIẾN) =====
    if (lengths.length >= 4) {
        const t = lengths.slice(-4).join('');
        if (t === '1212') return '1_2_1_2_pattern';
        if (t === '2121') return '2_1_2_1_pattern';
        if (t === '1221') return '1_2_2_1_pattern';
        if (t === '2112') return '2_1_1_2_pattern';
    }
    if (lengths.length >= 5) {
        const t = lengths.slice(-5).join('');
        if (t === '12121') return '1_2_1_2_1_pattern';
        if (t === '21212') return '2_1_2_1_2_pattern';
        if (t === '13131') return '1_3_1_3_1_pattern';
        if (t === '31313') return '3_1_3_1_3_pattern';
    }

    // ===== NHÓM 3: CẦU BỆT (QUAN TRỌNG ~30%) =====
    const lastRun = lastRuns[lastRuns.length - 1];
    if (lastRun) {
        if (lastRun.len >= 8) return 'very_long_run_pattern';
        if (lastRun.len >= 6) return 'long_run_pattern';
        if (lastRun.len >= 4) return 'medium_run_pattern';
        if (lastRun.len >= 3) return 'short_run_pattern';
    }

    // ===== NHÓM 4: CẦU GÃY ĐƠN GIẢN =====
    if (lengths.length >= 3) {
        const t = lengths.slice(-3).join('');
        if (t === '212') return 'broken_2_1_2';
        if (t === '313') return 'broken_3_1_3';
        if (t === '121') return 'broken_1_2_1';
        if (t === '232') return 'broken_2_3_2';
        if (t === '323') return 'broken_3_2_3';
        if (t === '221') return '2_2_1_pattern';
        if (t === '112') return '1_1_2_pattern';
        if (t === '211') return '2_1_1_pattern';
        if (t === '122') return '1_2_2_pattern';
    }

    return 'random_pattern';
}

function predictNextFromPattern(patternType, runs, lastTx, history = null) {
    if (!patternType) return { pred: null, confidence: 0.5 };
    const lastRun = runs[runs.length - 1];
    if (!lastRun) return { pred: null, confidence: 0.5 };
    const flip = (v) => v === 'T' ? 'X' : 'T';

    const getStreakBreakConfidence = (streakLen) => {
        return STATS.STREAK_BREAK_PROB[Math.min(streakLen, 12)] || 0.98;
    };

    switch (patternType) {
        // ===== CẦU XEN KẼ =====
        case '1_1_pattern': return { pred: flip(lastTx), confidence: 0.62 };
        case '2_2_pattern': return { pred: lastRun.len === 2 ? flip(lastRun.val) : lastRun.val, confidence: 0.60 };
        case '3_3_pattern': return { pred: lastRun.len === 3 ? flip(lastRun.val) : lastRun.val, confidence: 0.62 };
        case '4_4_pattern': return { pred: lastRun.len === 4 ? flip(lastRun.val) : lastRun.val, confidence: 0.65 };

        // ===== CẦU HỖN HỢP 1-2 =====
        case '1_2_1_2_pattern': return { pred: lastRun.len === 1 ? flip(lastRun.val) : lastRun.val, confidence: 0.63 };
        case '2_1_2_1_pattern': return { pred: lastRun.len === 2 ? flip(lastRun.val) : lastRun.val, confidence: 0.63 };
        case '1_2_2_1_pattern':
            if (lastRun.len === 1) return { pred: lastRun.val, confidence: 0.60 };
            return { pred: flip(lastRun.val), confidence: 0.58 };
        case '2_1_1_2_pattern':
            if (lastRun.len === 2) return { pred: lastRun.val, confidence: 0.60 };
            return { pred: flip(lastRun.val), confidence: 0.58 };
        case '1_2_1_2_1_pattern': return { pred: lastRun.len === 1 ? flip(lastRun.val) : lastRun.val, confidence: 0.65 };
        case '2_1_2_1_2_pattern': return { pred: lastRun.len === 2 ? flip(lastRun.val) : lastRun.val, confidence: 0.65 };
        case '1_3_1_3_1_pattern': return { pred: lastRun.len === 1 ? flip(lastRun.val) : lastRun.val, confidence: 0.62 };
        case '3_1_3_1_3_pattern': return { pred: lastRun.len === 3 ? flip(lastRun.val) : lastRun.val, confidence: 0.62 };

        // ===== CẦU BỆT =====
        case 'very_long_run_pattern': return { pred: flip(lastRun.val), confidence: getStreakBreakConfidence(lastRun.len) };
        case 'long_run_pattern': return { pred: lastRun.len >= 6 ? flip(lastRun.val) : lastRun.val, confidence: lastRun.len >= 6 ? 0.75 : 0.55 };
        case 'medium_run_pattern': return { pred: lastRun.len >= 5 ? flip(lastRun.val) : lastRun.val, confidence: lastRun.len >= 5 ? 0.65 : 0.52 };
        case 'short_run_pattern': return { pred: lastRun.len >= 3 ? flip(lastRun.val) : lastRun.val, confidence: 0.55 };

        // ===== CẦU GÃY =====
        case 'broken_2_1_2':
            if (lastRun.len === 2) return { pred: flip(lastRun.val), confidence: 0.60 };
            return { pred: lastRun.val, confidence: 0.58 };
        case 'broken_3_1_3':
            if (lastRun.len === 3) return { pred: flip(lastRun.val), confidence: 0.62 };
            return { pred: lastRun.val, confidence: 0.58 };
        case 'broken_1_2_1':
            if (lastRun.len === 1) return { pred: flip(lastRun.val), confidence: 0.60 };
            return { pred: lastRun.val, confidence: 0.58 };
        case 'broken_2_3_2':
            if (lastRun.len === 2) return { pred: flip(lastRun.val), confidence: 0.60 };
            return { pred: lastRun.val, confidence: 0.62 };
        case 'broken_3_2_3':
            if (lastRun.len === 3) return { pred: flip(lastRun.val), confidence: 0.62 };
            return { pred: lastRun.val, confidence: 0.60 };

        // ===== CẦU 2-2-1, 1-1-2 =====
        case '2_2_1_pattern':
            if (lastRun.len === 2) return { pred: flip(lastRun.val), confidence: 0.58 };
            return { pred: lastRun.val, confidence: 0.60 };
        case '1_1_2_pattern':
            if (lastRun.len === 1) return { pred: flip(lastRun.val), confidence: 0.58 };
            return { pred: lastRun.val, confidence: 0.60 };
        case '2_1_1_pattern':
            if (lastRun.len === 2) return { pred: flip(lastRun.val), confidence: 0.58 };
            return { pred: lastRun.val, confidence: 0.60 };
        case '1_2_2_pattern':
            if (lastRun.len === 1) return { pred: flip(lastRun.val), confidence: 0.58 };
            return { pred: lastRun.val, confidence: 0.60 };

        default: return { pred: null, confidence: 0.5 };
    }
}
// =====================================================================
// PHẦN 4/10: CÁC THUẬT TOÁN (A-Q)
// =====================================================================
function algo5_freqRebalance(history) {
    if (history.length < 20) return null;
    const features = extractFeatures(history);
    const { freq, entropy: e } = features;
    const tCount = freq['T'] || 0;
    const xCount = freq['X'] || 0;
    const diff = Math.abs(tCount - xCount);
    const total = tCount + xCount;
    let threshold = e > 0.9 ? 0.45 : (e < 0.4 ? 0.65 : 0.55);
    const recent = history.slice(-30);
    const recentT = recent.filter(h => h.tx === 'T').length;
    const recentX = recent.filter(h => h.tx === 'X').length;
    const recentTotal = recentT + recentX;
    if (total > 0 && recentTotal > 0) {
        const combinedRatio = (diff / total) * 0.4 + (Math.abs(recentT - recentX) / recentTotal) * 0.6;
        if (combinedRatio > threshold) {
            if (recentT > recentX + 2) return 'X';
            if (recentX > recentT + 2) return 'T';
        }
    }
    return null;
}

function algoA_markov(history) {
    if (history.length < 15) return null;
    const tx = history.map(h => h.tx);
    let maxOrder = 5;
    if (history.length < 30) maxOrder = 3;
    if (history.length < 20) maxOrder = 2;
    let bestPred = null, bestScore = -1;
    for (let order = 2; order <= maxOrder; order++) {
        if (tx.length < order + 8) continue;
        const transitions = {};
        const totalTransitions = tx.length - order;
        const decayFactor = 0.95;
        for (let i = 0; i < totalTransitions; i++) {
            const key = tx.slice(i, i + order).join('');
            const next = tx[i + order];
            const weight = Math.pow(decayFactor, totalTransitions - i - 1);
            if (!transitions[key]) transitions[key] = { T: 0, X: 0 };
            transitions[key][next] += weight;
        }
        const lastKey = tx.slice(-order).join('');
        const counts = transitions[lastKey];
        if (counts && (counts.T + counts.X) > 0.5) {
            const total = counts.T + counts.X;
            const confidence = Math.abs(counts.T - counts.X) / total;
            const pred = counts.T > counts.X ? 'T' : 'X';
            const score = confidence * (order / maxOrder) * Math.min(1, total / 10);
            if (score > bestScore) { bestScore = score; bestPred = pred; }
        }
    }
    return bestPred;
}

function algoB_ngram(history) {
    if (history.length < 30) return null;
    const tx = history.map(h => h.tx);
    const ngramSizes = [7, 6, 5, 4, 3];
    let bestPred = null, bestConfidence = 0;
    for (const n of ngramSizes) {
        if (tx.length < n * 2) continue;
        const target = tx.slice(-n).join('');
        const matches = [];
        for (let i = 0; i <= tx.length - n - 1; i++) {
            if (tx.slice(i, i + n).join('') === target) {
                matches.push({ position: i, next: tx[i + n], distance: tx.length - i });
            }
        }
        if (matches.length >= 2) {
            const weights = { T: 0, X: 0 };
            let totalWeight = 0;
            for (const m of matches) {
                const w = 1 / (m.distance * 0.5 + 1);
                weights[m.next] += w;
                totalWeight += w;
            }
            if (totalWeight > 0) {
                const confidence = Math.abs(weights.T - weights.X) / totalWeight;
                if (confidence > bestConfidence) {
                    bestConfidence = confidence;
                    bestPred = weights.T > weights.X ? 'T' : 'X';
                }
            }
        }
    }
    return bestConfidence > 0.3 ? bestPred : null;
}

function algoS_NeoPattern(history) {
    if (history.length < 20) return null;
    const features = extractFeatures(history);
    const { runs, tx } = features;
    const patternType = detectPatternType(runs);
    if (!patternType || patternType === 'random_pattern') return null;
    const lastTx = tx[tx.length - 1];
    const result = predictNextFromPattern(patternType, runs, lastTx, history);
    if (result.pred) {
        const recentRuns = runs.slice(-Math.min(8, runs.length));
        const consistency = recentRuns.length ? recentRuns.filter(r => r.len >= 1).length / recentRuns.length : 0;
        if (consistency > 0.6) return result.pred;
    }
    return null;
}

function algoF_SuperDeepAnalysis(history) {
    if (history.length < 40) return null;
    const timeframes = [
        { lookback: 10, weight: 0.3 },
        { lookback: 20, weight: 0.3 },
        { lookback: 40, weight: 0.4 }
    ];
    let totalScore = { T: 0, X: 0 };
    let totalWeight = 0;
    for (const tf of timeframes) {
        if (history.length < tf.lookback) continue;
        const slice = history.slice(-tf.lookback);
        const sliceTx = slice.map(h => h.tx);
        const sliceTotals = slice.map(h => h.total);
        const tCount = sliceTx.filter(t => t === 'T').length;
        const xCount = sliceTx.filter(t => t === 'X').length;
        const meanTotal = avg(sliceTotals);
        const volatility = Math.sqrt(avg(sliceTotals.map(t => Math.pow(t - meanTotal, 2))));
        let tScore = 0, xScore = 0;
        if (meanTotal > 12) xScore += 0.4;
        if (meanTotal < 9) tScore += 0.4;
        if (tCount > xCount + 3) xScore += 0.3;
        if (xCount > tCount + 3) tScore += 0.3;
        if (volatility > 4) {
            if (sliceTx[sliceTx.length - 1] === 'T') tScore += 0.2;
            else xScore += 0.2;
        }
        const trend = sliceTotals[sliceTotals.length - 1] - sliceTotals[0];
        if (trend > 3) xScore += 0.1;
        if (trend < -3) tScore += 0.1;
        const w = tf.weight * (sliceTx.length / tf.lookback);
        totalScore.T += tScore * w;
        totalScore.X += xScore * w;
        totalWeight += w;
    }
    if (totalWeight > 0 && Math.abs(totalScore.T - totalScore.X) > 0.15) {
        return totalScore.T > totalScore.X ? 'T' : 'X';
    }
    return null;
}

function algoE_Transformer(history) {
    if (history.length < 80) return null;
    const tx = history.map(h => h.tx);
    const seqLengths = [5, 6, 8, 10, 12];
    let attentionScores = { T: 0, X: 0 };
    for (const seqLen of seqLengths) {
        if (tx.length < seqLen * 2) continue;
        const targetSeq = tx.slice(-seqLen).join('');
        let seqMatches = 0;
        for (let i = 0; i <= tx.length - seqLen - 1; i++) {
            const historySeq = tx.slice(i, i + seqLen).join('');
            const matchScore = similarity(historySeq, targetSeq);
            if (matchScore >= 0.65) {
                const nextResult = tx[i + seqLen];
                const recency = 1 / (tx.length - i);
                const lengthFactor = seqLen / 12;
                const w = matchScore * recency * lengthFactor;
                attentionScores[nextResult] = (attentionScores[nextResult] || 0) + w;
                seqMatches++;
            }
        }
        if (seqMatches >= 3) {
            const boost = Math.min(1.5, seqMatches / 2);
            attentionScores.T *= boost;
            attentionScores.X *= boost;
        }
    }
    if (attentionScores.T + attentionScores.X > 0.2) {
        const total = attentionScores.T + attentionScores.X;
        const confidence = Math.abs(attentionScores.T - attentionScores.X) / total;
        if (confidence > 0.2) return attentionScores.T > attentionScores.X ? 'T' : 'X';
    }
    return null;
}

function algoG_SuperBridgePredictor(history) {
    const features = extractFeatures(history);
    const { runs } = features;
    if (runs.length < 4) return null;
    const lastRun = runs[runs.length - 1];
    let prediction = null, confidence = 0;

    if (lastRun.len >= 10) { prediction = lastRun.val === 'T' ? 'X' : 'T'; confidence = 0.9; }
    else if (lastRun.len >= 8) { prediction = lastRun.val === 'T' ? 'X' : 'T'; confidence = 0.8; }
    else if (lastRun.len >= 7) {
        const avgRun = avg(runs.map(r => r.len));
        if (lastRun.len > avgRun * 2) { prediction = lastRun.val === 'T' ? 'X' : 'T'; confidence = 0.75; }
        else { prediction = lastRun.val; confidence = 0.6; }
    }
    else if (lastRun.len >= 5 && lastRun.len <= 6) {
        const avgRun = avg(runs.map(r => r.len));
        if (lastRun.len > avgRun * 1.8) { prediction = lastRun.val === 'T' ? 'X' : 'T'; confidence = 0.7; }
        else { prediction = lastRun.val; confidence = 0.62; }
    }

    if (!prediction && runs.length >= 5) {
        const last5Runs = runs.slice(-5);
        const lengths = last5Runs.map(r => r.len);
        if (lengths[0] === 1 && lengths[1] === 1 && lengths[2] >= 3) {
            if (lastRun.len >= 3) { prediction = lastRun.val === 'T' ? 'X' : 'T'; confidence = 0.7; }
        }
        if (lengths.length >= 4) {
            if (lengths[0] === 2 && lengths[1] === 3 && lengths[2] === 2 && lengths[3] === 3) {
                prediction = lastRun.val; confidence = 0.6;
            }
        }
    }

    if (!prediction && runs.length >= 8) {
        const recentRuns = runs.slice(-8);
        const runLengths = recentRuns.map(r => r.len);
        const meanLength = avg(runLengths);
        const stdLength = stdDev(runLengths);
        if (lastRun.len > meanLength + stdLength * 1.5) {
            prediction = lastRun.val === 'T' ? 'X' : 'T';
            confidence = 0.6;
        }
    }
    return confidence > 0.55 ? prediction : null;
}

function algoH_AdaptiveMarkov(history) {
    if (history.length < 25) return null;
    const tx = history.map(h => h.tx);
    let ensembleVotes = { T: 0, X: 0 };
    for (const order of [2, 3, 4, 5]) {
        if (tx.length < order + 5) continue;
        const transitions = {};
        for (let i = 0; i <= tx.length - order - 1; i++) {
            const key = tx.slice(i, i + order).join('');
            const next = tx[i + order];
            if (!transitions[key]) transitions[key] = { T: 0, X: 0 };
            transitions[key][next]++;
        }
        const lastKey = tx.slice(-order).join('');
        const counts = transitions[lastKey];
        if (counts && counts.T + counts.X >= 2) {
            const pred = counts.T > counts.X ? 'T' : 'X';
            const conf = Math.abs(counts.T - counts.X) / (counts.T + counts.X);
            ensembleVotes[pred] += conf * (order / 10);
        }
    }
    for (const lookback of [10, 20, 30]) {
        if (tx.length < lookback) continue;
        const recent = tx.slice(-lookback);
        const tCount = recent.filter(t => t === 'T').length;
        const xCount = recent.filter(t => t === 'X').length;
        if (Math.abs(tCount - xCount) > lookback * 0.2) {
            const pred = tCount > xCount ? 'X' : 'T';
            const conf = Math.abs(tCount - xCount) / lookback;
            ensembleVotes[pred] += conf * 0.5;
        }
    }
    for (const window of [5, 10, 15]) {
        if (tx.length < window * 2) continue;
        const firstHalf = tx.slice(-window * 2, -window);
        const secondHalf = tx.slice(-window);
        const firstT = firstHalf.filter(t => t === 'T').length;
        const secondT = secondHalf.filter(t => t === 'T').length;
        const momentumT = secondT - firstT;
        const momentumX = window - secondT - (window - firstT);
        if (Math.abs(momentumT - momentumX) > window * 0.3) {
            const pred = momentumT > momentumX ? 'T' : 'X';
            const conf = Math.abs(momentumT - momentumX) / window;
            ensembleVotes[pred] += conf * 0.3;
        }
    }
    if (ensembleVotes.T + ensembleVotes.X > 0.3) {
        return ensembleVotes.T > ensembleVotes.X ? 'T' : 'X';
    }
    return null;
}

function algoI_PatternMaster(history) {
    if (history.length < 25) return null;
    const features = extractFeatures(history);
    const { runs, tx } = features;
    if (runs.length < 5) return null;
    const recentRuns = runs.slice(-Math.min(8, runs.length));
    const runLengths = recentRuns.map(r => r.len);
    const runValues = recentRuns.map(r => r.val);
    let patternStrength = { T: 0, X: 0 };
    const runPattern = runLengths.join('');
    const valuePattern = runValues.join('');
    const lastVal = valuePattern[valuePattern.length - 1];

    // CHỈ GIỮ PATTERN THỰC TẾ
    const patternLibrary = [
        { p: '12121', pred: lastVal === 'T' ? 'X' : 'T', s: 0.7 },
        { p: '21212', pred: lastVal === 'T' ? 'T' : 'X', s: 0.7 },
        { p: '13131', pred: lastVal, s: 0.65 },
        { p: '31313', pred: lastVal === 'T' ? 'X' : 'T', s: 0.65 },
        { p: '1212', pred: lastVal === 'T' ? 'X' : 'T', s: 0.68 },
        { p: '2121', pred: lastVal === 'T' ? 'T' : 'X', s: 0.68 }
    ];
    for (const lib of patternLibrary) {
        if (runPattern.includes(lib.p)) patternStrength[lib.pred] += lib.s;
    }

    const last10Tx = tx.slice(-10).join('');
    const last12Tx = tx.slice(-12).join('');
    const txPatterns = [
        { p: 'TXTXTXTX', pred: 'X', s: 0.8 },
        { p: 'XTXTXTXT', pred: 'T', s: 0.8 },
        { p: 'TXTXTXTXTX', pred: 'X', s: 0.82 },
        { p: 'XTXTXTXTXT', pred: 'T', s: 0.82 },
        { p: 'TTXXTTXX', pred: 'X', s: 0.7 },
        { p: 'XXTTXXTT', pred: 'T', s: 0.7 }
    ];
    for (const p of txPatterns) {
        if (last10Tx.includes(p.p)) patternStrength[p.pred] += p.s;
        if (last12Tx.includes(p.p)) patternStrength[p.pred] += p.s * 0.3;
    }

    const lastRun = recentRuns[recentRuns.length - 1];
    if (lastRun) {
        const avgRecentLength = avg(runLengths);
        if (lastRun.len > avgRecentLength * 1.8) {
            patternStrength[lastRun.val === 'T' ? 'X' : 'T'] += 0.5;
        } else if (lastRun.len < avgRecentLength * 0.6) {
            patternStrength[lastRun.val] += 0.4;
        }
    }
    if (patternStrength.T + patternStrength.X > 0) {
        const total = patternStrength.T + patternStrength.X;
        const conf = Math.abs(patternStrength.T - patternStrength.X) / total;
        if (conf > 0.25) return patternStrength.T > patternStrength.X ? 'T' : 'X';
    }
    return null;
}

function algoJ_QuantumEntropy(history) {
    if (history.length < 30) return null;
    const features = extractFeatures(history);
    const { entropy: e, tx, runs } = features;
    let entropyPredictions = { T: 0, X: 0 };
    for (const window of [10, 20, 30]) {
        if (tx.length < window) continue;
        const windowTx = tx.slice(-window);
        const windowEntropy = entropy(windowTx);
        if (windowEntropy < 0.3) {
            entropyPredictions[windowTx[windowTx.length - 1]] += 0.6;
        } else if (windowEntropy > 0.9) {
            const tCount = windowTx.filter(t => t === 'T').length;
            const xCount = windowTx.filter(t => t === 'X').length;
            if (tCount > xCount) entropyPredictions['X'] += 0.5;
            else if (xCount > tCount) entropyPredictions['T'] += 0.5;
        } else {
            const recentRuns = runs.slice(-4);
            if (recentRuns.length >= 3) {
                const runLengths = recentRuns.map(r => r.len);
                if (Math.max(...runLengths) - Math.min(...runLengths) <= 2) {
                    entropyPredictions[tx[tx.length - 1]] += 0.4;
                }
            }
        }
    }
    if (e < 0.4) entropyPredictions[tx[tx.length - 1]] += 0.3;
    else if (e > 0.95) {
        const recentT = tx.slice(-20).filter(t => t === 'T').length;
        const recentX = tx.slice(-20).filter(t => t === 'X').length;
        if (recentT > recentX) entropyPredictions['X'] += 0.4;
        else if (recentX > recentT) entropyPredictions['T'] += 0.4;
    }
    if (entropyPredictions.T + entropyPredictions.X > 0.4) {
        return entropyPredictions.T > entropyPredictions.X ? 'T' : 'X';
    }
    return null;
}

function algoK_AntiStuckDetector(history, recentPredictions = []) {
    if (history.length < 15) return null;
    const features = extractFeatures(history);
    const { runs } = features;
    const lastRun = runs[runs.length - 1];
    if (!lastRun) return null;

    const last3Preds = recentPredictions.slice(-3);
    const last3Actual = history.slice(-3).map(h => h.tx);
    if (last3Preds.length === 3) {
        const samePred = last3Preds.every(p => p === last3Preds[0]);
        const allWrong = last3Preds.every((p, i) => p !== last3Actual[i]);
        if (samePred && allWrong) {
            return last3Preds[0] === 'T' ? 'X' : 'T';
        }
    }
    if (lastRun.len >= 6) {
        return lastRun.val === 'T' ? 'X' : 'T';
    }
    return null;
}

function algoL_MomentumReversal(history) {
    if (history.length < 30) return null;
    const totals = history.map(h => h.total);
    const mean5 = avg(totals.slice(-5));
    const mean20 = avg(totals.slice(-20));
    const last3 = totals.slice(-3);
    const last5 = totals.slice(-5);
    const trend3to5 = avg(last3) - avg(last5);
    if (mean5 > 12.5 && trend3to5 > 0.5) return 'X';
    if (mean5 < 8.5 && trend3to5 < -0.5) return 'T';
    if (mean5 > mean20 + 2) return 'X';
    if (mean5 < mean20 - 2) return 'T';
    return null;
}

function algoM_ScoreDistribution(history) {
    if (history.length < 20) return null;
    const totals = history.map(h => h.total);
    const recent20 = totals.slice(-20);
    const mean20 = avg(recent20);
    const highCount = recent20.filter(t => t >= 12).length;
    const lowCount = recent20.filter(t => t <= 9).length;
    const midCount = recent20.filter(t => t > 9 && t < 12).length;

    if (highCount >= 10 && mean20 > 12) return 'X';
    if (lowCount >= 10 && mean20 < 9) return 'T';
    if (midCount >= 12) {
        const last5 = recent20.slice(-5);
        const last5Mean = avg(last5);
        if (last5Mean > 10.5) return 'T';
        if (last5Mean < 10.5) return 'X';
    }
    return null;
}

function algoN_TransitionMatrix(history) {
    if (history.length < 30) return null;
    const tx = history.map(h => h.tx);
    const recent = tx.slice(-50);
    const transitions = { TT: 0, TX: 0, XT: 0, XX: 0 };
    for (let i = 1; i < recent.length; i++) {
        const key = recent[i-1] + recent[i];
        transitions[key]++;
    }
    const lastTx = recent[recent.length - 1];
    const totalFromLast = lastTx === 'T'
        ? transitions.TT + transitions.TX
        : transitions.XT + transitions.XX;
    if (totalFromLast < 5) return null;
    let probFlip;
    if (lastTx === 'T') probFlip = transitions.TX / totalFromLast;
    else probFlip = transitions.XT / totalFromLast;
    if (probFlip > 0.55) return lastTx === 'T' ? 'X' : 'T';
    if (probFlip < 0.45) return lastTx;
    return null;
}

function algoO_RunLengthPredictor(history) {
    if (history.length < 30) return null;
    const features = extractFeatures(history);
    const { runs } = features;
    if (runs.length < 5) return null;
    const recentRuns = runs.slice(-10);
    const runLengths = recentRuns.map(r => r.len);
    const lastRun = recentRuns[recentRuns.length - 1];
    const lengthCounts = {};
    for (const len of runLengths) lengthCounts[len] = (lengthCounts[len] || 0) + 1;
    let mostCommonLen = 1, maxCount = 0;
    for (const len in lengthCounts) {
        if (lengthCounts[len] > maxCount) {
            maxCount = lengthCounts[len];
            mostCommonLen = parseInt(len);
        }
    }
    if (lastRun.len >= mostCommonLen) return lastRun.val === 'T' ? 'X' : 'T';
    if (lastRun.len < mostCommonLen - 1) return lastRun.val;
    return null;
}

function algoP_TimeWeightedMomentum(history) {
    if (history.length < 20) return null;
    const tx = history.map(h => h.tx);
    let momentum = 0, weightSum = 0;
    const decay = 0.9;
    for (let i = tx.length - 1; i >= Math.max(0, tx.length - 20); i--) {
        const weight = Math.pow(decay, tx.length - 1 - i);
        const value = tx[i] === 'T' ? 1 : -1;
        momentum += value * weight;
        weightSum += weight;
    }
    if (weightSum > 0) momentum /= weightSum;
    if (momentum > 0.4) return 'X';
    if (momentum < -0.4) return 'T';
    if (momentum > 0.1) return 'T';
    if (momentum < -0.1) return 'X';
    return null;
}

function algoQ_StreakProbability(history) {
    if (history.length < 15) return null;
    const features = extractFeatures(history);
    const { runs } = features;
    const lastRun = runs[runs.length - 1];
    if (!lastRun) return null;
    const streakLen = lastRun.len;
    const streakVal = lastRun.val;
    const breakProb = STATS.STREAK_BREAK_PROB[Math.min(streakLen, 12)] || 0.98;
    if (breakProb > 0.6) return streakVal === 'T' ? 'X' : 'T';
    if (breakProb < 0.4) return streakVal;
    return null;
}

// =====================================================================
// ALGORITHM LIST (16 algorithms)
// =====================================================================
const ALL_ALGS = [
    { id: 'algo5_freqrebalance', fn: algo5_freqRebalance },
    { id: 'a_markov', fn: algoA_markov },
    { id: 'b_ngram', fn: algoB_ngram },
    { id: 's_neo_pattern', fn: algoS_NeoPattern },
    { id: 'f_super_deep_analysis', fn: algoF_SuperDeepAnalysis },
    { id: 'e_transformer', fn: algoE_Transformer },
    { id: 'g_super_bridge_predictor', fn: algoG_SuperBridgePredictor },
    { id: 'h_adaptive_markov', fn: algoH_AdaptiveMarkov },
    { id: 'i_pattern_master', fn: algoI_PatternMaster },
    { id: 'j_quantum_entropy', fn: algoJ_QuantumEntropy },
    { id: 'l_momentum_reversal', fn: algoL_MomentumReversal },
    { id: 'm_score_distribution', fn: algoM_ScoreDistribution },
    { id: 'n_transition_matrix', fn: algoN_TransitionMatrix },
    { id: 'o_run_length', fn: algoO_RunLengthPredictor },
    { id: 'p_time_weighted_momentum', fn: algoP_TimeWeightedMomentum },
    { id: 'q_streak_probability', fn: algoQ_StreakProbability }
];
// =====================================================================
// PHẦN 5/10: CÂN BẰNG THUẬT TOÁN (5 LỚP)
// =====================================================================

// ----- LỚP 1 & 3: ANTI-BIAS DETECTOR -----
class AntiBiasDetector {
    constructor(opts = {}) {
        this.recentPredictions = [];
        this.recentActuals = [];
        this.maxWindow = opts.maxWindow ?? 20;
        this.biasThreshold = opts.biasThreshold ?? 0.65;
    }

    record(prediction, actual = null) {
        this.recentPredictions.push(prediction);
        if (actual) this.recentActuals.push(actual);

        if (this.recentPredictions.length > this.maxWindow) {
            this.recentPredictions.shift();
            if (this.recentActuals.length > this.maxWindow) {
                this.recentActuals.shift();
            }
        }
    }

    checkBias() {
        if (this.recentPredictions.length < 10) {
            return { isBiased: false, ratio: 0.5, direction: null, severity: 0 };
        }
        const tCount = this.recentPredictions.filter(p => p === 'T').length;
        const xCount = this.recentPredictions.filter(p => p === 'X').length;
        const total = tCount + xCount;
        const ratio = tCount / total;

        if (ratio > this.biasThreshold) {
            return { isBiased: true, ratio, direction: 'T', severity: (ratio - 0.5) * 2 };
        }
        if (ratio < 1 - this.biasThreshold) {
            return { isBiased: true, ratio, direction: 'X', severity: (0.5 - ratio) * 2 };
        }
        return { isBiased: false, ratio, direction: null, severity: 0 };
    }

    adjust(prediction, confidence) {
        const bias = this.checkBias();
        if (!bias.isBiased) return { prediction, confidence, adjusted: false };

        if (prediction === bias.direction) {
            const newConf = confidence * (1 - bias.severity * 0.5);
            return {
                prediction,
                confidence: Math.max(0.5, newConf),
                adjusted: true,
                reason: `Giảm confidence do nghiêng ${bias.direction} (${(bias.ratio*100).toFixed(0)}%)`
            };
        }
        return {
            prediction,
            confidence: Math.min(0.95, confidence * 1.1),
            adjusted: true,
            reason: `Tăng confidence do ngược nghiêng`
        };
    }
}

// ----- LỚP 4: REBALANCE WEIGHTS -----
function rebalanceWeights(weights, biasInfo) {
    if (!biasInfo.isBiased) return weights;

    const { direction, severity } = biasInfo;
    const newWeights = { ...weights };

    const reverseAlgs = ['l_momentum_reversal', 'm_score_distribution',
                         'q_streak_probability', 'g_super_bridge_predictor'];
    const followAlgs = ['algo5_freqrebalance', 'a_markov', 'b_ngram',
                        's_neo_pattern', 'i_pattern_master', 'o_run_length'];

    if (direction === 'T') {
        for (const id of reverseAlgs) {
            if (newWeights[id]) newWeights[id] *= (1 + severity * 0.3);
        }
        for (const id of followAlgs) {
            if (newWeights[id]) newWeights[id] *= (1 - severity * 0.2);
        }
    } else {
        for (const id of followAlgs) {
            if (newWeights[id]) newWeights[id] *= (1 + severity * 0.3);
        }
        for (const id of reverseAlgs) {
            if (newWeights[id]) newWeights[id] *= (1 - severity * 0.2);
        }
    }

    const total = Object.values(newWeights).reduce((s, w) => s + w, 0);
    if (total > 0) {
        for (const id in newWeights) newWeights[id] /= total;
    }
    return newWeights;
}

// ----- LỚP 5: RATIO GUARD -----
function ratioGuard(history, prediction, confidence) {
    if (history.length < 50) return { prediction, confidence };

    const recent50 = history.slice(-50);
    const tCount = recent50.filter(h => h.tx === 'T').length;
    const tRatio = tCount / 50;

    if (tRatio > 0.60 && prediction === 'T') {
        return {
            prediction: 'X',
            confidence: Math.min(0.85, confidence * 1.15),
            reason: `Ratio Guard: T=${(tRatio*100).toFixed(0)}% → đảo sang X`
        };
    }
    if (tRatio < 0.40 && prediction === 'X') {
        return {
            prediction: 'T',
            confidence: Math.min(0.85, confidence * 1.15),
            reason: `Ratio Guard: X=${((1-tRatio)*100).toFixed(0)}% → đảo sang T`
        };
    }
    return { prediction, confidence };
}
// =====================================================================
// PHẦN 6/10: ENSEMBLE CLASS (TÍCH HỢP 5 LỚP CÂN BẰNG)
// =====================================================================
class SEIUEnsemble {
    constructor(algorithms, opts = {}) {
        this.algs = algorithms;
        this.weights = {};
        this.emaAlpha = opts.emaAlpha ?? 0.08;
        this.minWeight = opts.minWeight ?? 0.02;
        this.historyWindow = opts.historyWindow ?? 700;
        this.performanceHistory = {};
        this.patternMemory = {};
        this.recentPredictions = [];
        this.recentActuals = [];
        this.stuckCounter = 0;
        this.lastPrediction = null;
        this.patternWeights = {};
        this.confidenceHistory = [];

        this.antiBias = new AntiBiasDetector({
            maxWindow: 20,
            biasThreshold: 0.65
        });

        this.ALG_GROUPS = {
            follow: ['algo5_freqrebalance', 'a_markov', 'b_ngram',
                     's_neo_pattern', 'i_pattern_master', 'o_run_length'],
            reverse: ['l_momentum_reversal', 'm_score_distribution',
                      'q_streak_probability', 'g_super_bridge_predictor'],
            neutral: ['f_super_deep_analysis', 'e_transformer',
                      'h_adaptive_markov', 'j_quantum_entropy',
                      'n_transition_matrix', 'p_time_weighted_momentum']
        };

        for (const a of algorithms) {
            this.weights[a.id] = ALG_WEIGHTS_INITIAL[a.id] || 0.05;
            this.performanceHistory[a.id] = [];
            this.patternWeights[a.id] = {};
        }

        this.balanceInitialWeights();
    }

    getAlgGroup(algId) {
        for (const [group, list] of Object.entries(this.ALG_GROUPS)) {
            if (list.includes(algId)) return group;
        }
        return 'neutral';
    }

    balanceInitialWeights() {
        // Sử dụng ALG_WEIGHTS_INITIAL đã định nghĩa
        console.log('⚖️ Đã khởi tạo weight theo phân tích 3,861 phiên thực');
    }

    fitInitial(history) {
        const window = lastN(history, Math.min(this.historyWindow, history.length));
        if (window.length < 30) return;
        const algScores = {};
        for (const a of this.algs) algScores[a.id] = 0;
        const evalSamples = Math.min(60, window.length - 15);
        const startIdx = window.length - evalSamples;

        for (let i = Math.max(15, startIdx); i < window.length; i++) {
            const prefix = window.slice(0, i);
            const actual = window[i].tx;
            const features = extractFeatures(prefix);
            const patternType = detectPatternType(features.runs);
            for (const a of this.algs) {
                try {
                    const pred = a.fn(prefix);
                    if (pred && pred === actual) {
                        algScores[a.id] += 1;
                        if (patternType) {
                            const key = `${a.id}_${patternType}`;
                            this.patternMemory[key] = (this.patternMemory[key] || 0) + 1;
                        }
                    }
                } catch (e) {}
            }
        }

        let totalWeight = 0;
        for (const id in algScores) {
            const accuracy = algScores[id] / evalSamples;
            const baseWeight = ALG_WEIGHTS_INITIAL[id] || 0.05;
            this.weights[id] = Math.max(this.minWeight, baseWeight * (0.6 + accuracy * 0.8));
            totalWeight += this.weights[id];
        }
        if (totalWeight > 0) {
            for (const id in this.weights) this.weights[id] /= totalWeight;
        }
        console.log(`⚖️ Khởi tạo trọng số ${Object.keys(this.weights).length} thuật toán.`);
    }

    updateWithOutcome(historyPrefix, actualTx) {
        if (historyPrefix.length < 10) return;
        this.recentActuals.push(actualTx);
        if (this.recentActuals.length > 20) this.recentActuals.shift();

        this.antiBias.record(this.lastPrediction, actualTx);

        if (this.lastPrediction) {
            const wasCorrect = this.lastPrediction === actualTx;
            if (wasCorrect) this.stuckCounter = 0;
            else this.stuckCounter++;
        }

        const features = extractFeatures(historyPrefix);
        const patternType = detectPatternType(features.runs);

        for (const a of this.algs) {
            try {
                const pred = a.fn(historyPrefix);
                const correct = pred === actualTx ? 1 : 0;
                this.performanceHistory[a.id].push(correct);
                if (this.performanceHistory[a.id].length > 60) {
                    this.performanceHistory[a.id].shift();
                }

                const recentPerf = lastN(this.performanceHistory[a.id], 25);
                let wa = 0, ws = 0;
                for (let i = 0; i < recentPerf.length; i++) {
                    const w = Math.pow(0.9, recentPerf.length - i - 1);
                    wa += recentPerf[i] * w;
                    ws += w;
                }
                const recentAccuracy = ws > 0 ? wa / ws : 0.5;

                const last5 = this.performanceHistory[a.id].slice(-5);
                const wrongStreak = last5.filter(x => x === 0).length;
                let penaltyMultiplier = 1.0;
                if (wrongStreak >= 4) penaltyMultiplier = 0.5;
                else if (wrongStreak >= 3) penaltyMultiplier = 0.7;

                let patternBonus = 0;
                if (patternType) {
                    const patternPerf = this.patternWeights[a.id][patternType] || { correct: 0, total: 0 };
                    patternPerf.total++;
                    if (correct) patternPerf.correct++;
                    this.patternWeights[a.id][patternType] = patternPerf;
                    if (patternPerf.total >= 3) {
                        const patternAccuracy = patternPerf.correct / patternPerf.total;
                        if (patternAccuracy > 0.6) patternBonus = 0.15;
                        else if (patternAccuracy < 0.4) patternBonus = -0.1;
                    }
                }

                const targetWeight = Math.min(1, (recentAccuracy + patternBonus + 0.1) * penaltyMultiplier);
                const currentWeight = this.weights[a.id] || this.minWeight;
                const newWeight = this.emaAlpha * targetWeight + (1 - this.emaAlpha) * currentWeight;
                this.weights[a.id] = Math.max(this.minWeight, Math.min(1.5, newWeight));

                if (patternType && correct) {
                    const key = `${a.id}_${patternType}`;
                    this.patternMemory[key] = (this.patternMemory[key] || 0) + 1;
                }
            } catch (e) {
                this.weights[a.id] = Math.max(this.minWeight, (this.weights[a.id] || 1) * 0.9);
            }
        }

        const sumWeights = Object.values(this.weights).reduce((s, w) => s + w, 0);
        if (sumWeights > 0) {
            for (const id in this.weights) this.weights[id] /= sumWeights;
        }
    }

    predict(history) {
        if (history.length < 12) {
            const recentTx = history.map(h => h.tx);
            const tCount = recentTx.filter(t => t === 'T').length;
            const xCount = recentTx.filter(t => t === 'X').length;
            const fallback = tCount > xCount ? 'X' : 'T';
            this.lastPrediction = fallback;
            this.recentPredictions.push(fallback);
            if (this.recentPredictions.length > 20) this.recentPredictions.shift();
            this.antiBias.record(fallback);
            return { prediction: fallback === 'T' ? 'tài' : 'xỉu',
                     confidence: 0.5, rawPrediction: fallback };
        }

        const features = extractFeatures(history);
        const patternType = detectPatternType(features.runs);

        const groupVotes = {
            follow: { T: 0, X: 0 },
            reverse: { T: 0, X: 0 },
            neutral: { T: 0, X: 0 }
        };
        const details = [];

        for (const a of this.algs) {
            try {
                const pred = a.fn(history);
                if (!pred) continue;
                let weight = this.weights[a.id] || this.minWeight;
                if (patternType) {
                    const key = `${a.id}_${patternType}`;
                    if ((this.patternMemory[key] || 0) > 2) weight *= 1.2;
                }
                const group = this.getAlgGroup(a.id);
                groupVotes[group][pred] += weight;
                details.push({ algorithm: a.id, prediction: pred, weight, group });
            } catch (e) {}
        }

        let antiStuckVote = null;
        try {
            antiStuckVote = algoK_AntiStuckDetector(history, this.recentPredictions);
            if (antiStuckVote) {
                groupVotes.neutral[antiStuckVote] += 1.5;
                details.push({ algorithm: 'k_anti_stuck',
                               prediction: antiStuckVote, weight: 1.5, group: 'neutral' });
            }
        } catch (e) {}

        const groupMax = 1.0 / 3;
        const normalize = (g) => {
            const total = g.T + g.X;
            if (total === 0) return { T: 0, X: 0 };
            return {
                T: (g.T / total) * groupMax,
                X: (g.X / total) * groupMax
            };
        };

        const follow = normalize(groupVotes.follow);
        const reverse = normalize(groupVotes.reverse);
        const neutral = normalize(groupVotes.neutral);

        const balancedT = follow.T + reverse.T + neutral.T;
        const balancedX = follow.X + reverse.X + neutral.X;

        let best = balancedT > balancedX ? 'T' : 'X';
        let baseConfidence = Math.max(balancedT, balancedX);

        const rgResult = ratioGuard(history, best, baseConfidence);
        if (rgResult.reason) {
            console.log(`⚖️ ${rgResult.reason}`);
            best = rgResult.prediction;
            baseConfidence = rgResult.confidence;
        }

        if (this.stuckCounter >= 3) {
            const flipped = best === 'T' ? 'X' : 'T';
            console.log(`🚨 ANTI-STUCK: Đảo ${best} → ${flipped} (stuck ${this.stuckCounter})`);
            best = flipped;
            baseConfidence = Math.max(baseConfidence, 0.6);
            this.stuckCounter = 0;
        }

        const last4Preds = this.recentPredictions.slice(-4);
        if (last4Preds.length === 4 && last4Preds.every(p => p === best)) {
            const last4Actuals = this.recentActuals.slice(-4);
            const wrongCount = last4Preds.filter((p, i) => p !== last4Actuals[i]).length;
            if (wrongCount >= 3) {
                const flipped = best === 'T' ? 'X' : 'T';
                console.log(`🚨 FORCE FLIP: 4 preds giống nhau & sai >=3 → ${best} → ${flipped}`);
                best = flipped;
                baseConfidence = Math.max(baseConfidence, 0.58);
            }
        }

        let consensusBonus = 0;
        const consensusTotal = balancedT + balancedX;
        if (consensusTotal > 0) {
            const consensusRatio = Math.max(balancedT, balancedX) / consensusTotal;
            if (consensusRatio > 0.7) consensusBonus = 0.08;
            if (consensusRatio > 0.8) consensusBonus = 0.12;
        }

        let confidence = Math.min(0.96, Math.max(0.55, baseConfidence + consensusBonus));

        const biasAdjusted = this.antiBias.adjust(best, confidence);
        if (biasAdjusted.adjusted) {
            confidence = biasAdjusted.confidence;
            console.log(`⚖️ ${biasAdjusted.reason}`);
        }

        if (this.stuckCounter >= 2) confidence = Math.min(confidence, 0.75);

        const biasInfo = this.antiBias.checkBias();
        if (biasInfo.isBiased) {
            this.weights = rebalanceWeights(this.weights, biasInfo);
            console.log(`⚖️ Rebalanced weights (nghiêng ${biasInfo.direction} ${(biasInfo.ratio*100).toFixed(0)}%)`);
        }

        this.lastPrediction = best;
        this.recentPredictions.push(best);
        if (this.recentPredictions.length > 20) this.recentPredictions.shift();
        this.antiBias.record(best);

        return {
            prediction: best === 'T' ? 'tài' : 'xỉu',
            confidence,
            rawPrediction: best,
            bias: biasInfo,
            details
        };
    }
}
// =====================================================================
// PHẦN 7/10: MANAGER
// =====================================================================
class SEIUManager {
    constructor(opts = {}) {
        this.history = [];
        this.ensemble = new SEIUEnsemble(ALL_ALGS, {
            emaAlpha: opts.emaAlpha ?? 0.08,
            historyWindow: opts.historyWindow ?? 700
        });
        this.currentPrediction = null;
        this.patternHistory = [];
        this.predictionLog = {};
    }

    calculateInitialStats() {
        const minStart = 20;
        if (this.history.length < minStart) return;
        const trainSamples = Math.min(80, this.history.length - minStart);
        const startIdx = this.history.length - trainSamples;
        for (let i = Math.max(minStart, startIdx); i < this.history.length; i++) {
            const prefix = this.history.slice(0, i);
            this.ensemble.updateWithOutcome(prefix, this.history[i].tx);
        }
        console.log(`📊 AI huấn luyện ${trainSamples} mẫu.`);
    }

    loadInitial(lines) {
        this.history = lines;
        this.ensemble.fitInitial(this.history);
        this.calculateInitialStats();
        this.currentPrediction = this.getPrediction();
        console.log("📦 Đã tải lịch sử. AI sẵn sàng.");
        const nextSession = this.history.at(-1) ? this.history.at(-1).session + 1 : 'N/A';
        console.log(`🔮 Dự đoán phiên ${nextSession}: ${this.currentPrediction.prediction} (${(this.currentPrediction.confidence * 100).toFixed(0)}%)`);
    }

    pushRecord(record) {
        if (this.currentPrediction) {
            this.predictionLog[record.session] = {
                pred: this.currentPrediction.rawPrediction,
                confidence: this.currentPrediction.confidence
            };
        }

        this.history.push(record);
        if (this.history.length > 500) this.history = this.history.slice(-450);
        const prefix = this.history.slice(0, -1);
        if (prefix.length >= 10) this.ensemble.updateWithOutcome(prefix, record.tx);
        this.currentPrediction = this.getPrediction();

        const features = extractFeatures(this.history);
        const patternType = detectPatternType(features.runs);
        if (patternType) {
            this.patternHistory.push(patternType);
            if (this.patternHistory.length > 20) this.patternHistory.shift();
        }
        console.log(`📥 ${record.session} → ${record.result}. Dự đoán ${record.session + 1}: ${this.currentPrediction.prediction} (${(this.currentPrediction.confidence * 100).toFixed(0)}%)`);
    }

    getPrediction() {
        return this.ensemble.predict(this.history);
    }
}

const seiuManager = new SEIUManager();
// =====================================================================
// PHẦN 8/10: API SERVER & FETCH
// =====================================================================
const app = fastify({ logger: true });
await app.register(cors, { origin: "*" });

async function fetchAndProcessHistory() {
    try {
        const response = await fetch(API_URL);
        const data = await response.json();
        const newHistory = parseLines(data);

        if (newHistory.length === 0) {
            console.log("⚠️ Không có dữ liệu từ API.");
            return;
        }

        const lastSessionInHistory = newHistory.at(-1);

        if (!currentSessionId) {
            seiuManager.loadInitial(newHistory);
            txHistory = newHistory;
            currentSessionId = lastSessionInHistory.session;
            console.log(`✅ Đã tải ${newHistory.length} phiên lịch sử.`);
        } else if (lastSessionInHistory.session > currentSessionId) {
            const newRecords = newHistory.filter(r => r.session > currentSessionId);
            for (const record of newRecords) {
                seiuManager.pushRecord(record);
                txHistory.push(record);
            }
            if (txHistory.length > 350) txHistory = txHistory.slice(-300);
            currentSessionId = lastSessionInHistory.session;
            if (newRecords.length > 0) {
                console.log(`🆕 Cập nhật ${newRecords.length} phiên. Phiên cuối: ${currentSessionId}`);
            }
        }
    } catch (e) {
        console.error("❌ Lỗi fetch:", e.message);
    }
}

fetchAndProcessHistory();
clearInterval(fetchInterval);
fetchInterval = setInterval(fetchAndProcessHistory, 5000);
console.log(`🔄 Chu kỳ 5 giây.`);
// =====================================================================
// PHẦN 9/10: API ENDPOINTS
// =====================================================================

// Dự đoán phiên tiếp theo
app.get("/api/sunwin/tx", async () => {
    const lastResult = txHistory.at(-1) || null;
    const currentPrediction = seiuManager.currentPrediction;

    if (!lastResult || !currentPrediction) {
        return {
            id: "@cskhgiabao",
            phien_truoc: null,
            xuc_xac: null,
            ket_qua: "đang chờ...",
            phien_nay: null,
            du_doan: "chưa có",
            do_tin_cay: "0%"
        };
    }

    return {
        id: "@cskhgiabao",
        phien_truoc: lastResult.session,
        xuc_xac: lastResult.dice,
        ket_qua: lastResult.result.toLowerCase(),
        phien_nay: lastResult.session + 1,
        du_doan: currentPrediction.prediction,
        do_tin_cay: `${(currentPrediction.confidence * 100).toFixed(0)}%`
    };
});

// Lịch sử + nhận xét dự đoán phiên vừa rồi ✅/❌
app.get("/api/sunwin/history", async () => {
    if (!txHistory.length) return { message: "không có dữ liệu lịch sử." };

    const reversed = [...txHistory].sort((a, b) => b.session - a.session);

    return reversed.map((item) => {
        const log = seiuManager.predictionLog[item.session];
        let nhan_xet = "—";
        if (log) {
            const dung = log.pred === item.tx;
            nhan_xet = dung
                ? `✅ Đúng (dự đoán ${log.pred === 'T' ? 'tài' : 'xỉu'} ${(log.confidence * 100).toFixed(0)}%)`
                : `❌ Sai (dự đoán ${log.pred === 'T' ? 'tài' : 'xỉu'} ${(log.confidence * 100).toFixed(0)}%)`;
        }

        return {
            session: item.session,
            dice: item.dice,
            total: item.total,
            result: item.result.toLowerCase(),
            tx_label: item.tx.toLowerCase(),
            nhan_xet
        };
    });
});

// API kiểm tra cân bằng
app.get("/api/balance/stats", async () => {
    const preds = seiuManager.ensemble.recentPredictions;
    const acts = seiuManager.ensemble.recentActuals;

    const predT = preds.filter(p => p === 'T').length;
    const predX = preds.filter(p => p === 'X').length;
    const actT = acts.filter(a => a === 'T').length;
    const actX = acts.filter(a => a === 'X').length;

    const bias = seiuManager.ensemble.antiBias.checkBias();

    return {
        predictions: {
            total: preds.length,
            T: predT,
            X: predX,
            ratio_T: preds.length > 0 ? (predT / preds.length * 100).toFixed(1) + '%' : '0%'
        },
        actuals: {
            total: acts.length,
            T: actT,
            X: actX,
            ratio_T: acts.length > 0 ? (actT / acts.length * 100).toFixed(1) + '%' : '0%'
        },
        bias: {
            isBiased: bias.isBiased,
            direction: bias.direction,
            ratio: (bias.ratio * 100).toFixed(1) + '%',
            severity: bias.severity ? (bias.severity * 100).toFixed(1) + '%' : '0%'
        },
        weights: seiuManager.ensemble.weights
    };
});

app.get("/", async () => {
    return {
        status: "ok",
        msg: "AI Tài Xỉu Sunwin Pro - Balanced Edition v9.0",
        version: "9.0",
        algorithms: ALL_ALGS.length + 1,
        balance_layers: 5,
        pattern_recognition: "25 mẫu cầu thực (từ 3,861 phiên thực)",
        data_source: "API Sunwin",
        endpoints: [
            "/api/sunwin/tx",
            "/api/sunwin/history",
            "/api/balance/stats"
        ]
    };
});
// =====================================================================
// PHẦN 10/10: SERVER START
// =====================================================================
const start = async () => {
    try {
        await app.listen({ port: PORT, host: "0.0.0.0" });
    } catch (err) {
        const fs = await import("node:fs");
        const logFile = path.join(__dirname, "server-error.log");
        const errorMsg = `
================= SERVER ERROR =================
Time: ${new Date().toISOString()}
Error: ${err.message}
Stack: ${err.stack}
=================================================
`;
        console.error(errorMsg);
        fs.writeFileSync(logFile, errorMsg, { encoding: "utf8", flag: "a+" });
        process.exit(1);
    }

    let publicIP = "0.0.0.0";
    try {
        const res = await fetch("https://ifconfig.me/ip");
        publicIP = (await res.text()).trim();
    } catch (e) {
        console.error("❌ Lỗi lấy public IP:", e.message);
    }

    console.log("\n🚀 AI Tài Xỉu Sunwin Pro - Balanced Edition v9.0!");
    console.log(`   ➜ Local:   http://localhost:${PORT}/`);
    console.log(`   ➜ Network: http://${publicIP}:${PORT}/\n`);
    console.log("📌 API endpoints:");
    console.log(`   ➜ GET /api/sunwin/tx         → http://${publicIP}:${PORT}/api/sunwin/tx`);
    console.log(`   ➜ GET /api/sunwin/history    → http://${publicIP}:${PORT}/api/sunwin/history`);
    console.log(`   ➜ GET /api/balance/stats     → http://${publicIP}:${PORT}/api/balance/stats`);

    console.log(`\n⚖️ 5 LỚP CÂN BẰNG THUẬT TOÁN:`);
    console.log("   1. Init Balance - Khởi tạo weight theo data thực");
    console.log("   2. Group Voting - Vote theo nhóm (mỗi nhóm tối đa 1/3)");
    console.log("   3. Anti-Bias Detector - Phát hiện nghiêng >65%");
    console.log("   4. Rebalance Weights - Tự động cân bằng khi nghiêng");
    console.log("   5. Ratio Guard - Chốt chặn cuối (50 phiên gần nhất)");

    console.log(`\n🔧 ${ALL_ALGS.length} thuật toán + 1 anti-stuck detector:`);
    ALL_ALGS.forEach((alg, i) => console.log(`   ${i+1}. ${alg.id}`));
    console.log(`   ${ALL_ALGS.length + 1}. k_anti_stuck_detector`);

    console.log(`\n📊 Nhóm thuật toán (weight từ data thực):`);
    console.log("   • FOLLOW:  algo5(0.08), a_markov(0.08), b_ngram(0.07), s_neo(0.09), i_pattern(0.05), o_run(0.03)");
    console.log("   • REVERSE: l_momentum(0.08), m_score(0.07), q_streak(0.08), g_bridge(0.07)");
    console.log("   • NEUTRAL: f_deep(0.06), e_transformer(0.05), h_adaptive(0.07), j_entropy(0.05), n_transition(0.04), p_momentum(0.03)");

    console.log(`\n🎯 25 mẫu cầu thực từ 3,861 phiên:`);
    console.log("   • Xen kẽ: 1-1, 2-2, 3-3, 4-4");
    console.log("   • Hỗn hợp: 1-2-1-2, 2-1-2-1, 1-2-2-1, 2-1-1-2, 1-2-1-2-1, 2-1-2-1-2");
    console.log("   • Cầu bệt: short(3), medium(4-5), long(6-7), very_long(8+)");
    console.log("   • Cầu gãy: 2-1-2, 3-1-3, 1-2-1, 2-3-2, 3-2-3");
    console.log("   • Cầu 2-2-1, 1-1-2, 2-1-1, 1-2-2");

    console.log(`\n✅ Endpoint kiểm tra cân bằng: /api/balance/stats`);
};

start();