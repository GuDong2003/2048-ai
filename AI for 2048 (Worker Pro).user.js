// ==UserScript==
// @name         Chimera AI for 2048 (Worker Pro)
// @name:zh-CN   2048 AI
// @namespace    http://tampermonkey.net/
// @version      9.5.0
// @description  Background 2048 AI (Web Worker): Dynamic depth + probability sampling for higher scores.
// @description:zh-CN Web Worker 后台运行的 2048 AI。v9.5：极限深度 + 更多采样，冲击更高分数。
// @author       AI Fusion & Human Refinement + Patch
// @match        https://2048.linux.do/*
// @grant        none
// @run-at       document-idle
// @license      MIT
// ==/UserScript==

(function() {
    'use strict';

    // ===================================================================================
    // GLOBAL CONFIG - 全局配置（两种模式的差异在 MODE_PRESETS 里）
// ===================================================================================
    const CONFIG = {
        BUTTON_INIT_DELAY: 500,

        // Rule / 规则
        STOP_ON_VICTORY: false,         // 页面如果把 victory=true：是否停止AI（刷分建议 false）

        // UI / 存储键
        STORAGE_KEY_MODE: 'ChimeraAI_2048_Mode_v1',
        DEFAULT_MODE: 'endurance',      // endurance | peak
        STORAGE_KEY_SPEED: 'ChimeraAI_2048_Speed_v1',
        DEFAULT_SPEED: 'normal',        // normal | fast | turbo
        STORAGE_KEY_AUTO_RESTART: 'ChimeraAI_2048_AutoRestart_v1',
        DEFAULT_AUTO_RESTART: false,    // 自动新游戏开关（默认关闭）
        AUTO_RESTART_DELAY: 1500,       // 自动新游戏延迟（毫秒）
        STORAGE_KEY_SCORES: 'ChimeraAI_2048_ScoreHistory_v1',
        MAX_SCORE_RECORDS: 20,          // 最多记录几局
    };

    /**
     * 两个预设（v9.5 简化版）：
     * - endurance：baseDepth=6，maxDepth=8（稳定刷分）
     * - extreme：baseDepth=9，maxDepth=12（极限冲分）
     */
    const MODE_PRESETS = Object.freeze({
        endurance: {
            id: 'endurance',
            name: '稳定刷分',
            buttonText: '模式：稳定',
            buttonColor: '#8f7a66',

            worker: {
                baseDepth: 6,
                maxDepth: 8,
            }
        },
        extreme: {
            id: 'extreme',
            name: '极限冲分',
            buttonText: '模式：极限',
            buttonColor: '#dc2626',

            worker: {
                baseDepth: 9,
                maxDepth: 12,
            }
        }
    });

    /**
     * 速度预设（v9.5 简化版）：
     * - normal：正常速度
     * - turbo：极速（降低深度加速）
     */
    const SPEED_PRESETS = Object.freeze({
        normal: {
            id: 'normal',
            name: '正常',
            buttonText: '速度：正常',
            buttonColor: '#6b7280',
            ui: { autoPlayInterval: 25, aiDelayAfterMove: 25, startDelay: 300 },
            workerAdjust: { depthDelta: 0 }
        },
        turbo: {
            id: 'turbo',
            name: '极速',
            buttonText: '速度：极速',
            buttonColor: '#ef4444',
            ui: { autoPlayInterval: 0, aiDelayAfterMove: 0, startDelay: 60 },
            workerAdjust: { depthDelta: -2 }
        },
    });

    // ===================================================================================
    // WEB WORKER SCRIPT - 后台工作线程脚本（AI 核心）v9.5 = 极限深度 + 更多采样
    // ===================================================================================
    const workerCode = `
        // --- Runtime settings ---
        let SETTINGS = {
            baseDepth: 6,
            maxDepth: 8,
        };

        // --- Heuristic weights (identical to v7.5.0) ---
        const HEURISTIC_WEIGHTS = {
            THRONE_REWARD: 1e10, GAME_OVER_PENALTY: -1e12, ESCAPE_ROUTE_PENALTY: 1e8,
            SNAKE_PATTERN_REWARD: 800, EMPTY_CELLS_REWARD: 400, POTENTIAL_MERGE_REWARD: 18,
            SMOOTHNESS_PENALTY: 20, MONOTONICITY_PENALTY: 80,
        };

        const SNAKE_PATTERN_MATRIX = (() => {
            const matrix = Array.from({ length: 4 }, () => new Array(4));
            const weights = [
                [15, 14, 13, 12], [8, 9, 10, 11], [7, 6, 5, 4], [0, 1, 2, 3]
            ];
            for (let r = 0; r < 4; r++) {
                for (let c = 0; c < 4; c++) {
                    matrix[r][c] = Math.pow(4, weights[r][c]);
                }
            }
            return matrix;
        })();

        const CORNERS = [ { r: 0, c: 0 }, { r: 0, c: 3 }, { r: 3, c: 0 }, { r: 3, c: 3 } ];

        // --- Utility Functions ---
        const deepCopyGrid = (grid) => grid.map(row => [...row]);
        function areGridsEqual(grid1, grid2) {
            if (!grid1 || !grid2) return false;
            for (let r = 0; r < 4; r++) {
                for (let c = 0; c < 4; c++) {
                    if (grid1[r][c] !== grid2[r][c]) return false;
                }
            }
            return true;
        }
        const getLogValue = (() => {
            const cache = new Map();
            return (value) => {
                if (value === 0) return 0;
                if (!cache.has(value)) cache.set(value, Math.log2(value));
                return cache.get(value);
            };
        })();

        // --- Board Logic Core ---
        class Board {
            constructor(grid = null) {
                this.size = 4;
                this.grid = grid ? deepCopyGrid(grid) : Array.from({ length: 4 }, () => new Array(4).fill(0));
            }
            copy = () => new Board(this.grid);
            placeTile = (cell, value) => { this.grid[cell.r][cell.c] = value; };
            processLine(line) {
                const nonZero = line.filter(val => val !== 0);
                const result = [];
                let score = 0, i = 0;
                while (i < nonZero.length) {
                    if (i < nonZero.length - 1 && nonZero[i] === nonZero[i + 1]) {
                        const merged = nonZero[i] * 2;
                        result.push(merged);
                        score += merged;
                        i += 2;
                    } else {
                        result.push(nonZero[i]);
                        i++;
                    }
                }
                while (result.length < this.size) result.push(0);
                return { line: result, score };
            }
            transpose() {
                const newGrid = Array.from({ length: 4 }, () => new Array(4).fill(0));
                for (let r = 0; r < this.size; r++) for (let c = 0; c < this.size; c++) newGrid[c][r] = this.grid[r][c];
                this.grid = newGrid;
            }
            swipe(direction) {
                const originalGrid = deepCopyGrid(this.grid);
                let totalScore = 0;
                if (direction === 0 || direction === 2) this.transpose();
                if (direction === 1 || direction === 2) this.grid.forEach(row => row.reverse());
                for (let i = 0; i < this.size; i++) {
                    const { line, score } = this.processLine(this.grid[i]);
                    this.grid[i] = line;
                    totalScore += score;
                }
                if (direction === 1 || direction === 2) this.grid.forEach(row => row.reverse());
                if (direction === 0 || direction === 2) this.transpose();
                return { moved: !areGridsEqual(originalGrid, this.grid), score: totalScore };
            }
            getEmptyCells() {
                const cells = [];
                for (let r = 0; r < this.size; r++) for (let c = 0; c < this.size; c++) if (this.grid[r][c] === 0) cells.push({ r, c });
                return cells;
            }
            isGameOver() {
                if (this.getEmptyCells().length > 0) return false;
                for (let r = 0; r < this.size; r++) {
                    for (let c = 0; c < this.size; c++) {
                        const current = this.grid[r][c];
                        if ((c + 1 < this.size && current === this.grid[r][c + 1]) || (r + 1 < this.size && current === this.grid[r + 1][c])) return false;
                    }
                }
                return true;
            }
            static transformGrid(grid, targetCorner) {
                let newGrid = deepCopyGrid(grid);
                const size = grid.length;
                switch (targetCorner.r + '-' + targetCorner.c) {
                    case ('0-' + (size - 1)): return newGrid.map(row => row.reverse());
                    case ((size - 1) + '-0'): return newGrid.reverse();
                    case ((size - 1) + '-' + (size - 1)): newGrid.reverse(); return newGrid.map(row => row.reverse());
                    default: return newGrid;
                }
            }
        }

        // --- AI with Dynamic Depth + Probability Sampling ---
        class AI {
            constructor(baseDepth, maxDepth) {
                this.baseDepth = baseDepth;
                this.maxDepth = maxDepth;
                this.memo = new Map();
            }
            clearMemo = () => this.memo.clear();
            generateBoardKey = (grid) => grid.map(row => row.join('-')).join(',');

            // 动态深度：根据空格数量调整（空格多=分支大=降深度提速）
            getDynamicDepth(emptyCount) {
                if (emptyCount <= 2) return this.maxDepth;      // 危险！分支小，全力搜索
                if (emptyCount <= 3) return this.maxDepth - 1;
                if (emptyCount <= 5) return this.baseDepth;
                if (emptyCount <= 8) return this.baseDepth - 2; // 空格多，分支大，大幅降深
                return this.baseDepth - 3;                      // 开局/空旷，极速决策
            }

            static heuristic(board) {
                if (board.isGameOver()) return HEURISTIC_WEIGHTS.GAME_OVER_PENALTY;
                let maxTile = 0, maxTilePos = { r: -1, c: -1 };
                for (let r = 0; r < board.size; r++) for (let c = 0; c < board.size; c++) if (board.grid[r][c] > maxTile) { maxTile = board.grid[r][c]; maxTilePos = { r, c }; }
                const isCornered = CORNERS.some(c => c.r === maxTilePos.r && c.c === maxTilePos.c);
                if (isCornered) return AI.calculateStaticHeuristic(new Board(Board.transformGrid(board.grid, maxTilePos)));
                let maxScore = -Infinity;
                for (const corner of CORNERS) maxScore = Math.max(maxScore, AI.calculateStaticHeuristic(new Board(Board.transformGrid(board.grid, corner))));
                return maxScore;
            }
            static calculateStaticHeuristic(board) {
                let score = 0, emptyCells = 0, mergeOpportunities = 0, monoPenalty = 0, smoothPenalty = 0, snakePatternScore = 0;
                for (let r = 0; r < board.size; r++) {
                    for (let c = 0; c < board.size; c++) {
                        const tile = board.grid[r][c];
                        if (tile === 0) { emptyCells++; continue; }
                        snakePatternScore += tile * SNAKE_PATTERN_MATRIX[r][c];
                        const logValue = getLogValue(tile);
                        if (c + 1 < board.size) {
                            const rightNeighbor = board.grid[r][c + 1];
                            if (rightNeighbor > 0) { smoothPenalty += Math.abs(logValue - getLogValue(rightNeighbor)); if (tile === rightNeighbor) mergeOpportunities++; }
                            if (tile < rightNeighbor) monoPenalty += getLogValue(rightNeighbor) - logValue;
                        }
                        if (r + 1 < board.size) {
                            const downNeighbor = board.grid[r + 1][c];
                            if (downNeighbor > 0) { smoothPenalty += Math.abs(logValue - getLogValue(downNeighbor)); if (tile === downNeighbor) mergeOpportunities++; }
                            if (tile < downNeighbor) monoPenalty += getLogValue(downNeighbor) - logValue;
                        }
                    }
                }
                score += (board.grid[0][0] === board.grid.flat().reduce((a, b) => Math.max(a, b), 0)) ? HEURISTIC_WEIGHTS.THRONE_REWARD : -HEURISTIC_WEIGHTS.THRONE_REWARD;
                if (!board.copy().swipe(0).moved && !board.copy().swipe(3).moved) score -= HEURISTIC_WEIGHTS.ESCAPE_ROUTE_PENALTY;
                score += emptyCells * HEURISTIC_WEIGHTS.EMPTY_CELLS_REWARD;
                score += mergeOpportunities * HEURISTIC_WEIGHTS.POTENTIAL_MERGE_REWARD;
                score += snakePatternScore * HEURISTIC_WEIGHTS.SNAKE_PATTERN_REWARD;
                score -= monoPenalty * HEURISTIC_WEIGHTS.MONOTONICITY_PENALTY;
                score -= smoothPenalty * HEURISTIC_WEIGHTS.SMOOTHNESS_PENALTY;
                return score;
            }
            expectimax(board, depth, isMaxNode) {
                const memoKey = this.generateBoardKey(board.grid) + '-' + depth + '-' + (isMaxNode ? 1 : 0);
                if (this.memo.has(memoKey)) return this.memo.get(memoKey);
                if (depth === 0 || board.isGameOver()) return { score: AI.heuristic(board), move: null };
                const result = isMaxNode ? this.handleMaxNode(board, depth) : this.handleChanceNode(board, depth);
                this.memo.set(memoKey, result);
                return result;
            }
            handleMaxNode(board, depth) {
                let maxScore = -Infinity, bestMove = null;
                for (let dir = 0; dir < 4; dir++) {
                    const newBoard = board.copy();
                    const res = newBoard.swipe(dir);
                    if (!res.moved) continue;
                    const { score } = this.expectimax(newBoard, depth - 1, false);
                    const totalScore = score + res.score;
                    if (totalScore > maxScore) { maxScore = totalScore; bestMove = dir; }
                }
                return { score: maxScore, move: bestMove };
            }
            handleChanceNode(board, depth) {
                let emptyCells = board.getEmptyCells();
                if (emptyCells.length === 0) return { score: AI.heuristic(board), move: null };

                // 动态采样：空格多时少采样（空格多=分支大=少采样提速）
                let maxSamples;
                if (emptyCells.length <= 4) maxSamples = emptyCells.length; // 全采样
                else if (emptyCells.length <= 6) maxSamples = 4;
                else if (emptyCells.length <= 10) maxSamples = 3;
                else maxSamples = 2;  // 开局超多空格，只采样2个

                if (emptyCells.length > maxSamples) {
                    // 随机打乱后取前 maxSamples 个
                    for (let i = emptyCells.length - 1; i > 0; i--) {
                        const j = Math.floor(Math.random() * (i + 1));
                        [emptyCells[i], emptyCells[j]] = [emptyCells[j], emptyCells[i]];
                    }
                    emptyCells = emptyCells.slice(0, maxSamples);
                }

                let totalScore = 0;
                for (const cell of emptyCells) {
                    const board2 = board.copy(); board2.placeTile(cell, 2);
                    totalScore += 0.9 * this.expectimax(board2, depth - 1, true).score;
                    const board4 = board.copy(); board4.placeTile(cell, 4);
                    totalScore += 0.1 * this.expectimax(board4, depth - 1, true).score;
                }
                return { score: totalScore / emptyCells.length, move: null };
            }
            getBestMove(grid) {
                this.clearMemo();
                const board = new Board(grid);
                const emptyCount = board.getEmptyCells().length;
                const dynamicDepth = this.getDynamicDepth(emptyCount);
                return this.expectimax(board, dynamicDepth, true).move;
            }
        }

        let aiInstance;

        self.onmessage = function(e) {
            const data = e.data || {};
            const type = data.type;
            const payload = data.payload || {};

            if (type === 'init') {
                SETTINGS = Object.assign({}, SETTINGS, payload || {});
                aiInstance = new AI(SETTINGS.baseDepth, SETTINGS.maxDepth);
                self.postMessage({ type: 'initialized', payload: { settings: SETTINGS } });
                return;
            }

            if (type === 'updateSettings') {
                SETTINGS = Object.assign({}, SETTINGS, payload || {});
                aiInstance = new AI(SETTINGS.baseDepth, SETTINGS.maxDepth);
                self.postMessage({ type: 'settingsUpdated', payload: { settings: SETTINGS } });
                return;
            }

            if (type === 'calculateMove') {
                if (!aiInstance) return;
                const grid = payload.grid;
                const token = payload.token;
                const bestMove = aiInstance.getBestMove(grid);
                self.postMessage({ type: 'moveCalculated', payload: { move: bestMove, reason: null, token: token } });
            }
        };
    `;

    // ===================================================================================
    // UTILITY FUNCTIONS (MAIN THREAD) - 主线程工具函数
    // ===================================================================================
    const deepCopyGrid = (grid) => grid.map(row => [...row]);

    function areGridsEqual(grid1, grid2) {
        if (!grid1 || !grid2 || grid1.length !== grid2.length) return false;
        for (let r = 0; r < grid1.length; r++) {
            for (let c = 0; c < grid1[r].length; c++) {
                if (grid1[r][c] !== grid2[r][c]) return false;
            }
        }
        return true;
    }

    function safeGetMode() {
        try {
            const v = localStorage.getItem(CONFIG.STORAGE_KEY_MODE);
            if (v && MODE_PRESETS[v]) return v;
        } catch (e) { /* ignore */ }
        return CONFIG.DEFAULT_MODE;
    }

    function safeSetMode(mode) {
        try {
            localStorage.setItem(CONFIG.STORAGE_KEY_MODE, mode);
        } catch (e) { /* ignore */ }
    }

    function safeGetSpeed() {
        try {
            const v = localStorage.getItem(CONFIG.STORAGE_KEY_SPEED);
            if (v && SPEED_PRESETS[v]) return v;
        } catch (e) { /* ignore */ }
        return CONFIG.DEFAULT_SPEED;
    }

    function safeSetSpeed(speed) {
        try {
            localStorage.setItem(CONFIG.STORAGE_KEY_SPEED, speed);
        } catch (e) { /* ignore */ }
    }

    function safeGetAutoRestart() {
        try {
            const v = localStorage.getItem(CONFIG.STORAGE_KEY_AUTO_RESTART);
            if (v === 'true') return true;
            if (v === 'false') return false;
        } catch (e) { /* ignore */ }
        return CONFIG.DEFAULT_AUTO_RESTART;
    }

    function safeSetAutoRestart(enabled) {
        try {
            localStorage.setItem(CONFIG.STORAGE_KEY_AUTO_RESTART, enabled ? 'true' : 'false');
        } catch (e) { /* ignore */ }
    }

    // --- 分数历史记录 ---
    function loadScoreHistory() {
        try {
            const raw = localStorage.getItem(CONFIG.STORAGE_KEY_SCORES);
            if (raw) return JSON.parse(raw);
        } catch (e) { /* ignore */ }
        return [];
    }

    function saveScoreHistory(history) {
        try {
            localStorage.setItem(CONFIG.STORAGE_KEY_SCORES, JSON.stringify(history));
        } catch (e) { /* ignore */ }
    }

    function addScoreRecord(score, maxTile, mode) {
        const history = loadScoreHistory();
        history.unshift({
            score: score,
            maxTile: maxTile,
            mode: mode,
            time: Date.now(),
        });
        // 只保留最近 N 条
        if (history.length > CONFIG.MAX_SCORE_RECORDS) {
            history.length = CONFIG.MAX_SCORE_RECORDS;
        }
        saveScoreHistory(history);
        return history;
    }

    function clearScoreHistory() {
        saveScoreHistory([]);
    }

    // ===================================================================================
    // GAME INTEGRATION & CONTROL (MAIN THREAD) - 游戏集成与控制 (主线程)
    // ===================================================================================
    class GameController {
        constructor() {
            this.gameInstance = null;

            this.aiPlaying = false;
            this.isCalculating = false;
            this.lastBoardState = null;

            // Timer: can be setTimeout or requestAnimationFrame (for turbo)
            this.timerHandle = null;
            this.timerIsRAF = false;

            this.startButton = null;
            this.modeButton = null;
            this.speedButton = null;
            this.autoRestartButton = null;
            this.scorePanel = null;           // 分数统计面板

            this.aiWorker = null;

            this.currentMode = safeGetMode();
            this.currentSpeed = safeGetSpeed();
            this.autoRestart = safeGetAutoRestart();  // 新增：自动新游戏状态

            // Token to ignore stale worker results (Stop/Mode/Speed switch while worker is calculating)
            this.controlToken = 0;

            this.DIRECTION_MAP = Object.freeze({ 0: 'up', 1: 'right', 2: 'down', 3: 'left' });
        }

        // ---------------------------
        // Presets & settings builders
        // ---------------------------
        getPreset(mode) {
            return MODE_PRESETS[mode] || MODE_PRESETS[CONFIG.DEFAULT_MODE];
        }

        getSpeedPreset(speed) {
            return SPEED_PRESETS[speed] || SPEED_PRESETS[CONFIG.DEFAULT_SPEED];
        }

        getUiTiming() {
            return this.getSpeedPreset(this.currentSpeed).ui;
        }

        buildWorkerSettings(mode, speed) {
            const preset = this.getPreset(mode);
            const speedPreset = this.getSpeedPreset(speed);
            const adjust = speedPreset.workerAdjust || {};

            // v9.4: 动态深度配置
            const baseDepth = preset.worker.baseDepth || 6;
            const maxDepth = preset.worker.maxDepth || 8;
            const depthDelta = (adjust.depthDelta || 0) | 0;

            return {
                baseDepth: Math.max(3, baseDepth + depthDelta),
                maxDepth: Math.max(4, maxDepth + depthDelta),
            };
        }

        pushWorkerSettings() {
            if (!this.aiWorker) return;
            this.aiWorker.postMessage({
                type: 'updateSettings',
                payload: this.buildWorkerSettings(this.currentMode, this.currentSpeed),
            });
        }

        // ---------------------------
        // Worker init & messaging
        // ---------------------------
        init() {
            try {
                const blob = new Blob([workerCode], { type: 'application/javascript' });
                const url = URL.createObjectURL(blob);
                this.aiWorker = new Worker(url);
                URL.revokeObjectURL(url);

                this.aiWorker.onmessage = this.handleWorkerMessage.bind(this);

                // Init worker with current mode+speed settings
                this.aiWorker.postMessage({
                    type: 'init',
                    payload: this.buildWorkerSettings(this.currentMode, this.currentSpeed),
                });

                setTimeout(() => this.createButtons(), CONFIG.BUTTON_INIT_DELAY);
            } catch (e) {
                console.error("Failed to initialize AI Worker:", e);
                alert("Error: Could not create the background AI worker. The script may not run correctly.");
            }
        }

        handleWorkerMessage(e) {
            const { type, payload } = e.data || {};

            if (type === 'initialized') {
                console.log("AI Worker initialized successfully.", payload?.settings || '');
                return;
            }

            if (type === 'settingsUpdated') {
                // reduce console spam: only log in debug if needed
                // console.log("AI settings updated:", payload?.settings || '');
                return;
            }

            if (type === 'moveCalculated') {
                // Always clear calculating flag first
                this.isCalculating = false;

                // Ignore if already stopped
                if (!this.aiPlaying) return;

                // Ignore stale results (mode/speed switch / stop / start)
                if (payload?.token !== this.controlToken) {
                    this.scheduleNext(0);
                    return;
                }

                const move = payload?.move;
                const reason = payload?.reason;

                if (move === null || typeof move === 'undefined') {
                    this.stopAI(reason || "No move");
                    return;
                }

                this.executeMove(move);

                if (this.aiPlaying) {
                    this.scheduleNext(this.getUiTiming().aiDelayAfterMove);
                }
            }
        }

        // ---------------------------
        // Game integration
        // ---------------------------
        findGameInstance() {
            if (window.canvasGame?.board) return window.canvasGame;

            for (const key in window) {
                try {
                    const obj = window[key];
                    if (obj && typeof obj === 'object' && obj.board && typeof obj.handleMove === 'function') {
                        return obj;
                    }
                } catch (e) { /* ignore */ }
            }
            return null;
        }

        executeMove(moveCode) {
            const direction = this.DIRECTION_MAP[moveCode];
            if (direction && this.gameInstance?.handleMove) {
                this.gameInstance.handleMove(direction);
            }
        }

        // ---------------------------
        // Loop / scheduling
        // ---------------------------
        cancelNext() {
            if (this.timerHandle !== null) {
                if (this.timerIsRAF) {
                    cancelAnimationFrame(this.timerHandle);
                } else {
                    clearTimeout(this.timerHandle);
                }
            }
            this.timerHandle = null;
            this.timerIsRAF = false;
        }

        scheduleNext(delay) {
            this.cancelNext();
            if (!this.aiPlaying) return;

            const d = (delay | 0);

            // Use rAF for turbo (d<=0) to avoid tight setTimeout(0) loops
            if (d <= 0) {
                this.timerIsRAF = true;
                this.timerHandle = requestAnimationFrame(() => {
                    this.timerHandle = null;
                    this.timerIsRAF = false;
                    this.autoPlay();
                });
                return;
            }

            this.timerIsRAF = false;
            this.timerHandle = setTimeout(() => {
                this.timerHandle = null;
                this.autoPlay();
            }, d);
        }

        autoPlay() {
            if (!this.aiPlaying || this.isCalculating || !this.gameInstance) return;

            const shouldStopForVictory = CONFIG.STOP_ON_VICTORY && this.gameInstance.victory;
            if (this.gameInstance.gameOver || shouldStopForVictory) {
                // 传递 isGameOver=true 以触发自动新游戏
                this.stopAI(shouldStopForVictory ? "🏆 Victory!" : "Game Over", true);
                return;
            }

            // Wait for the board to change (avoid spamming while animation hasn't settled)
            if (this.lastBoardState && areGridsEqual(this.gameInstance.board, this.lastBoardState)) {
                this.scheduleNext(this.getUiTiming().autoPlayInterval);
                return;
            }

            this.lastBoardState = deepCopyGrid(this.gameInstance.board);
            this.isCalculating = true;

            // Send token so we can ignore stale results on mode/speed switch / stop
            this.aiWorker.postMessage({
                type: 'calculateMove',
                payload: { grid: this.lastBoardState, token: this.controlToken }
            });
        }

        // ---------------------------
        // Start/Stop
        // ---------------------------
        startAI() {
            if (this.aiPlaying) return;

            this.gameInstance = this.findGameInstance();
            if (!this.gameInstance) {
                alert("Could not find game instance! Please reload the page.");
                return;
            }

            this.aiPlaying = true;
            this.isCalculating = false;
            this.lastBoardState = null;

            // New token for a new run
            this.controlToken++;

            const modePreset = this.getPreset(this.currentMode);
            const speedPreset = this.getSpeedPreset(this.currentSpeed);
            const ver = (typeof GM_info !== 'undefined' && GM_info?.script?.version) ? GM_info.script.version : '7.8.0';

            console.log(
                `%cChimera AI v${ver} Started (Mode: ${modePreset.name}, Speed: ${speedPreset.name}, Pure v7.5.0)`,
                "color: #4CAF50; font-weight: bold;"
            );

            this.scheduleNext(this.getUiTiming().startDelay);
            this.updateStartButton('Stop AI', '#f65e3b');
        }

        stopAI(endText = 'Start AI', isGameOver = false) {
            this.aiPlaying = false;
            this.isCalculating = false;

            this.cancelNext();

            // Invalidate any pending worker result
            this.controlToken++;

            console.log("%cChimera AI Stopped.", "color: #f65e3b; font-weight: bold;");
            this.updateStartButton(endText, '#8f7a66');

            // 记录分数
            if (isGameOver && this.gameInstance) {
                const score = this.getCurrentScore();
                const maxTile = this.getMaxTile();
                if (score > 0) {
                    addScoreRecord(score, maxTile, this.currentMode);
                    this.updateScorePanel();
                    console.log(`%c本局分数: ${score}  最大块: ${maxTile}`, "color: #eab308; font-weight: bold;");
                }
            }

            // 自动新游戏：如果启用且是 Game Over，则自动重启
            if (isGameOver && this.autoRestart) {
                console.log("%c自动新游戏将在 " + CONFIG.AUTO_RESTART_DELAY + "ms 后启动...", "color: #22c55e;");
                setTimeout(() => this.tryAutoRestart(), CONFIG.AUTO_RESTART_DELAY);
            }
        }

        getCurrentScore() {
            try {
                if (this.gameInstance?.score != null) return this.gameInstance.score;
                // 尝试从 DOM 读取
                const el = document.querySelector('.score-container .score, .score-container, [class*="score"]');
                if (el) {
                    const text = (el.textContent || '').replace(/[^\d]/g, '');
                    if (text) return parseInt(text, 10);
                }
            } catch (e) { /* ignore */ }
            return 0;
        }

        getMaxTile() {
            try {
                if (this.gameInstance?.board) {
                    let max = 0;
                    const board = this.gameInstance.board;
                    for (let r = 0; r < board.length; r++) {
                        for (let c = 0; c < board[r].length; c++) {
                            if (board[r][c] > max) max = board[r][c];
                        }
                    }
                    return max;
                }
            } catch (e) { /* ignore */ }
            return 0;
        }

        tryAutoRestart() {
            if (!this.autoRestart) return;

            // 尝试找到并点击新游戏按钮
            const restartBtn = this.findRestartButton();
            if (restartBtn) {
                console.log("%c点击新游戏按钮...", "color: #22c55e;");
                restartBtn.click();

                // 等待游戏重置后自动开始 AI
                setTimeout(() => {
                    if (this.autoRestart) {
                        this.startAI();
                    }
                }, 500);
            } else {
                console.log("%c未找到新游戏按钮", "color: #f59e0b;");
            }
        }

        findRestartButton() {
            // 尝试多种选择器找到新游戏按钮
            const selectors = [
                '.restart-button',
                '.retry-button',
                'button.restart',
                'a.restart-button',
                '[class*="restart"]',
                '[class*="retry"]',
                '[class*="new-game"]',
                'button:contains("New Game")',
                'button:contains("Try again")',
                'button:contains("重新开始")',
                'button:contains("新游戏")',
            ];

            for (const sel of selectors) {
                try {
                    const btn = document.querySelector(sel);
                    if (btn) return btn;
                } catch (e) { /* ignore invalid selector */ }
            }

            // 兜底：遍历所有按钮找包含关键词的
            const buttons = document.querySelectorAll('button, a.button, .button');
            for (const btn of buttons) {
                const text = (btn.textContent || '').toLowerCase();
                if (text.includes('restart') || text.includes('retry') ||
                    text.includes('new game') || text.includes('again') ||
                    text.includes('重新') || text.includes('新游戏')) {
                    return btn;
                }
            }

            return null;
        }

        // ---------------------------
        // Mode & Speed
        // ---------------------------
        setMode(mode) {
            const preset = this.getPreset(mode);
            this.currentMode = preset.id;
            safeSetMode(this.currentMode);

            // Mode switch invalidates pending results
            this.controlToken++;

            // Update UI
            this.updateModeButton();

            // Push new settings to worker
            this.pushWorkerSettings();

            // If AI is running, request next step ASAP with the new mode
            if (this.aiPlaying) {
                this.isCalculating = false;
                this.lastBoardState = null;
                this.scheduleNext(0);
            }
        }

        toggleMode() {
            const next = (this.currentMode === 'endurance') ? 'extreme' : 'endurance';
            this.setMode(next);
        }

        setSpeed(speed) {
            const preset = this.getSpeedPreset(speed);
            this.currentSpeed = preset.id;
            safeSetSpeed(this.currentSpeed);

            // Speed switch invalidates pending results
            this.controlToken++;

            // Update UI
            this.updateSpeedButton();

            // Push new settings to worker (turbo may change depth/sampling)
            this.pushWorkerSettings();

            if (this.aiPlaying) {
                this.isCalculating = false;
                this.lastBoardState = null;
                this.scheduleNext(0);
            }
        }

        toggleSpeed() {
            const next = (this.currentSpeed === 'normal') ? 'turbo' : 'normal';
            this.setSpeed(next);
        }

        // ---------------------------
        // Auto Restart
        // ---------------------------
        toggleAutoRestart() {
            this.autoRestart = !this.autoRestart;
            safeSetAutoRestart(this.autoRestart);
            this.updateAutoRestartButton();
            console.log("%c自动新游戏: " + (this.autoRestart ? "开启" : "关闭"), "color: #22c55e;");
        }

        // ---------------------------
        // UI updates
        // ---------------------------
        updateStartButton(text, color) {
            if (this.startButton) {
                this.startButton.textContent = text;
                this.startButton.style.backgroundColor = color;
            }
        }

        updateModeButton() {
            const preset = this.getPreset(this.currentMode);
            if (!this.modeButton) return;

            this.modeButton.textContent = preset.buttonText;
            this.modeButton.style.backgroundColor = preset.buttonColor;

            const ws = preset.worker;
            this.modeButton.title =
                preset.name + '\n' +
                '动态深度: ' + ws.baseDepth + '~' + ws.maxDepth + '\n' +
                'v9.5 极限深度 + 更多采样';
        }

        updateSpeedButton() {
            const preset = this.getSpeedPreset(this.currentSpeed);
            if (!this.speedButton) return;

            this.speedButton.textContent = preset.buttonText;
            this.speedButton.style.backgroundColor = preset.buttonColor;

            const ui = preset.ui;
            const adj = preset.workerAdjust || {};
            const depthDelta = (adj.depthDelta || 0) | 0;

            this.speedButton.title =
                '速度：' + preset.name + '\n' +
                'aiDelayAfterMove: ' + ui.aiDelayAfterMove + 'ms\n' +
                'autoPlayInterval: ' + ui.autoPlayInterval + 'ms' +
                (depthDelta !== 0 ? ('\ndepthDelta: ' + depthDelta) : '');
        }

        updateAutoRestartButton() {
            if (!this.autoRestartButton) return;

            const enabled = this.autoRestart;
            this.autoRestartButton.textContent = enabled ? '自动续：开' : '自动续：关';
            this.autoRestartButton.style.backgroundColor = enabled ? '#22c55e' : '#6b7280';
            this.autoRestartButton.title = '自动新游戏\n' +
                '状态：' + (enabled ? '开启' : '关闭') + '\n' +
                '游戏结束后自动点击新游戏并继续 AI';
        }

        updateScorePanel() {
            if (!this.scorePanel) return;

            const history = loadScoreHistory();
            const tbody = this.scorePanel.querySelector('tbody');
            if (!tbody) return;

            if (history.length === 0) {
                tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:#999;padding:8px;">暂无记录</td></tr>';
                return;
            }

            // 计算最高分用于高亮
            const bestScore = Math.max(...history.map(h => h.score));

            tbody.innerHTML = history.map((rec, i) => {
                const d = new Date(rec.time);
                const timeStr = (d.getMonth() + 1) + '/' + d.getDate() + ' '
                              + String(d.getHours()).padStart(2, '0') + ':'
                              + String(d.getMinutes()).padStart(2, '0');
                const isBest = rec.score === bestScore;
                const rowColor = isBest ? '#fef3c7' : (i % 2 === 0 ? '#faf8ef' : '#f0ede4');
                const scoreColor = isBest ? '#d97706' : '#776e65';
                const modeLabel = rec.mode === 'peak' ? '冲' : '耐';
                const modeColor = rec.mode === 'peak' ? '#2563eb' : '#8f7a66';

                return '<tr style="background:' + rowColor + '">'
                    + '<td style="padding:3px 6px;text-align:center;color:#999;font-size:11px;">' + (i + 1) + '</td>'
                    + '<td style="padding:3px 6px;text-align:right;font-weight:bold;color:' + scoreColor + '">' + rec.score.toLocaleString() + '</td>'
                    + '<td style="padding:3px 6px;text-align:center;font-size:12px;">' + (rec.maxTile || '-') + '</td>'
                    + '<td style="padding:3px 6px;text-align:center;font-size:11px;">'
                    + '<span style="color:' + modeColor + '">' + modeLabel + '</span> '
                    + '<span style="color:#aaa">' + timeStr + '</span></td>'
                    + '</tr>';
            }).join('');
        }

        // ---------------------------
        // UI creation
        // ---------------------------
        createButtons() {
            if (document.getElementById('ai-toggle-button')) return;

            // --- Start/Stop button ---
            this.startButton = document.createElement('button');
            this.startButton.id = 'ai-toggle-button';
            this.startButton.textContent = 'Start AI';

            Object.assign(this.startButton.style, {
                position: 'fixed', top: '10px', right: '10px', zIndex: '10000',
                padding: '12px 18px', fontSize: '16px', fontWeight: 'bold',
                cursor: 'pointer', backgroundColor: '#8f7a66', color: '#f9f6f2',
                border: '2px solid #776e65', borderRadius: '6px',
                boxShadow: '0 3px 8px rgba(0,0,0,0.3)',
                fontFamily: '"Clear Sans", "Helvetica Neue", Arial, sans-serif',
                transition: 'all 0.2s ease', userSelect: 'none'
            });

            this.startButton.addEventListener('mouseenter', () => {
                this.startButton.style.transform = 'translateY(-1px)';
                this.startButton.style.boxShadow = '0 4px 12px rgba(0,0,0,0.4)';
            });
            this.startButton.addEventListener('mouseleave', () => {
                this.startButton.style.transform = 'translateY(0)';
                this.startButton.style.boxShadow = '0 3px 8px rgba(0,0,0,0.3)';
            });

            this.startButton.onclick = () => this.aiPlaying ? this.stopAI() : this.startAI();
            document.body.appendChild(this.startButton);

            // --- Mode toggle button ---
            this.modeButton = document.createElement('button');
            this.modeButton.id = 'ai-mode-button';

            Object.assign(this.modeButton.style, {
                position: 'fixed', top: '62px', right: '10px', zIndex: '10000',
                padding: '10px 14px', fontSize: '14px', fontWeight: 'bold',
                cursor: 'pointer', backgroundColor: '#8f7a66', color: '#f9f6f2',
                border: '2px solid #776e65', borderRadius: '6px',
                boxShadow: '0 3px 8px rgba(0,0,0,0.25)',
                fontFamily: '"Clear Sans", "Helvetica Neue", Arial, sans-serif',
                transition: 'all 0.2s ease', userSelect: 'none',
                opacity: '0.95'
            });

            this.modeButton.addEventListener('mouseenter', () => {
                this.modeButton.style.transform = 'translateY(-1px)';
                this.modeButton.style.boxShadow = '0 4px 12px rgba(0,0,0,0.35)';
                this.modeButton.style.opacity = '1';
            });
            this.modeButton.addEventListener('mouseleave', () => {
                this.modeButton.style.transform = 'translateY(0)';
                this.modeButton.style.boxShadow = '0 3px 8px rgba(0,0,0,0.25)';
                this.modeButton.style.opacity = '0.95';
            });

            this.modeButton.onclick = () => this.toggleMode();
            document.body.appendChild(this.modeButton);

            // --- Speed toggle button ---
            this.speedButton = document.createElement('button');
            this.speedButton.id = 'ai-speed-button';

            Object.assign(this.speedButton.style, {
                position: 'fixed', top: '114px', right: '10px', zIndex: '10000',
                padding: '10px 14px', fontSize: '14px', fontWeight: 'bold',
                cursor: 'pointer', backgroundColor: '#6b7280', color: '#f9f6f2',
                border: '2px solid #776e65', borderRadius: '6px',
                boxShadow: '0 3px 8px rgba(0,0,0,0.22)',
                fontFamily: '"Clear Sans", "Helvetica Neue", Arial, sans-serif',
                transition: 'all 0.2s ease', userSelect: 'none',
                opacity: '0.93'
            });

            this.speedButton.addEventListener('mouseenter', () => {
                this.speedButton.style.transform = 'translateY(-1px)';
                this.speedButton.style.boxShadow = '0 4px 12px rgba(0,0,0,0.32)';
                this.speedButton.style.opacity = '1';
            });
            this.speedButton.addEventListener('mouseleave', () => {
                this.speedButton.style.transform = 'translateY(0)';
                this.speedButton.style.boxShadow = '0 3px 8px rgba(0,0,0,0.22)';
                this.speedButton.style.opacity = '0.93';
            });

            this.speedButton.onclick = () => this.toggleSpeed();
            document.body.appendChild(this.speedButton);

            // --- Auto Restart toggle button ---
            this.autoRestartButton = document.createElement('button');
            this.autoRestartButton.id = 'ai-auto-restart-button';

            Object.assign(this.autoRestartButton.style, {
                position: 'fixed', top: '166px', right: '10px', zIndex: '10000',
                padding: '10px 14px', fontSize: '14px', fontWeight: 'bold',
                cursor: 'pointer', backgroundColor: '#6b7280', color: '#f9f6f2',
                border: '2px solid #776e65', borderRadius: '6px',
                boxShadow: '0 3px 8px rgba(0,0,0,0.22)',
                fontFamily: '"Clear Sans", "Helvetica Neue", Arial, sans-serif',
                transition: 'all 0.2s ease', userSelect: 'none',
                opacity: '0.93'
            });

            this.autoRestartButton.addEventListener('mouseenter', () => {
                this.autoRestartButton.style.transform = 'translateY(-1px)';
                this.autoRestartButton.style.boxShadow = '0 4px 12px rgba(0,0,0,0.32)';
                this.autoRestartButton.style.opacity = '1';
            });
            this.autoRestartButton.addEventListener('mouseleave', () => {
                this.autoRestartButton.style.transform = 'translateY(0)';
                this.autoRestartButton.style.boxShadow = '0 3px 8px rgba(0,0,0,0.22)';
                this.autoRestartButton.style.opacity = '0.93';
            });

            this.autoRestartButton.onclick = () => this.toggleAutoRestart();
            document.body.appendChild(this.autoRestartButton);

            // --- Score history panel ---
            this.scorePanel = document.createElement('div');
            this.scorePanel.id = 'ai-score-panel';

            Object.assign(this.scorePanel.style, {
                position: 'fixed', top: '218px', right: '10px', zIndex: '10000',
                width: '260px', maxHeight: '400px', overflowY: 'auto',
                backgroundColor: '#faf8ef', color: '#776e65',
                border: '2px solid #bbada0', borderRadius: '6px',
                boxShadow: '0 3px 8px rgba(0,0,0,0.22)',
                fontFamily: '"Clear Sans", "Helvetica Neue", Arial, sans-serif',
                fontSize: '13px', userSelect: 'none',
            });

            // Header
            const panelHeader = document.createElement('div');
            Object.assign(panelHeader.style, {
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '8px 10px', borderBottom: '1px solid #d6cdc4',
                backgroundColor: '#eee4da', borderRadius: '4px 4px 0 0',
            });

            const titleSpan = document.createElement('span');
            titleSpan.textContent = '分数记录';
            titleSpan.style.fontWeight = 'bold';
            titleSpan.style.fontSize = '14px';

            const clearBtn = document.createElement('button');
            clearBtn.textContent = '清空';
            Object.assign(clearBtn.style, {
                padding: '2px 8px', fontSize: '11px', cursor: 'pointer',
                backgroundColor: '#bbada0', color: '#f9f6f2', border: 'none',
                borderRadius: '3px', fontFamily: 'inherit',
            });
            clearBtn.onclick = () => {
                if (confirm('确定清空所有分数记录？')) {
                    clearScoreHistory();
                    this.updateScorePanel();
                }
            };

            panelHeader.appendChild(titleSpan);
            panelHeader.appendChild(clearBtn);
            this.scorePanel.appendChild(panelHeader);

            // Table
            const table = document.createElement('table');
            Object.assign(table.style, {
                width: '100%', borderCollapse: 'collapse', fontSize: '12px',
            });

            const thead = document.createElement('thead');
            thead.innerHTML = '<tr style="background:#eee4da;color:#8f7a66;">'
                + '<th style="padding:4px 6px;text-align:center;font-size:11px;">#</th>'
                + '<th style="padding:4px 6px;text-align:right;">分数</th>'
                + '<th style="padding:4px 6px;text-align:center;">最大块</th>'
                + '<th style="padding:4px 6px;text-align:center;">模式/时间</th>'
                + '</tr>';
            table.appendChild(thead);

            const tbody = document.createElement('tbody');
            table.appendChild(tbody);
            this.scorePanel.appendChild(table);

            document.body.appendChild(this.scorePanel);

            // initial render
            this.updateModeButton();
            this.updateSpeedButton();
            this.updateAutoRestartButton();
            this.updateScorePanel();
        }
    }

    // ===================================================================================
    // INITIALIZATION - 初始化
    // ===================================================================================
    const gameController = new GameController();
    gameController.init();

    // Expose for debugging
    window.ChimeraAI = {
        controller: gameController,
        setMode: (mode) => gameController.setMode(mode),
        getMode: () => gameController.currentMode,
        setSpeed: (speed) => gameController.setSpeed(speed),
        getSpeed: () => gameController.currentSpeed,
        setAutoRestart: (enabled) => {
            gameController.autoRestart = !!enabled;
            safeSetAutoRestart(gameController.autoRestart);
            gameController.updateAutoRestartButton();
        },
        getAutoRestart: () => gameController.autoRestart,
        getScoreHistory: () => loadScoreHistory(),
        clearScoreHistory: () => {
            clearScoreHistory();
            gameController.updateScorePanel();
        },
    };

})();
