// ==UserScript==
// @name         Chimera AI for 2048 (Worker Pro)
// @name:zh-CN   2048 奇美拉AI (后台运行版) - 原版
// @namespace    http://tampermonkey.net/
// @version      7.5.0
// @description  A highly optimized AI for 2048 that runs in the background using a Web Worker, featuring advanced heuristics and non-blocking performance.
// @description:zh-CN 一个为 2048 深度优化的AI，使用Web Worker实现后台运行，具有高级启发式算法和完全非阻塞的卓越性能。
// @author       AI Fusion & Human Refinement
// @match        https://2048.linux.do/*
// @grant        none
// @run-at       document-idle
// @license      MIT
// ==/UserScript==

(function() {
    'use strict';

    // ===================================================================================
    // AI CONFIGURATION - AI 大脑配置
    // ===================================================================================
    const CONFIG = {
        AI_SEARCH_DEPTH: 5,
        AUTO_PLAY_INTERVAL: 20,
        AI_DELAY_AFTER_MOVE: 20,
        BUTTON_INIT_DELAY: 500,
    };

    // ===================================================================================
    // WEB WORKER SCRIPT - 后台工作线程脚本
    // EN: All AI logic is encapsulated here to run in a separate thread.
    // ZH: 所有的AI逻辑都被封装在这里，以便在独立的线程中运行。
    // ===================================================================================
    const workerCode = `
        // --- Constants passed to worker ---
        const HEURISTIC_WEIGHTS = {
            THRONE_REWARD: 1e10, GAME_OVER_PENALTY: -1e12, ESCAPE_ROUTE_PENALTY: 1e8,
            SNAKE_PATTERN_REWARD: 800, EMPTY_CELLS_REWARD: 350, POTENTIAL_MERGE_REWARD: 12,
            SMOOTHNESS_PENALTY: 20, MONOTONICITY_PENALTY: 60,
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
            getValidMoves = () => [0, 1, 2, 3].filter(dir => this.copy().swipe(dir).moved);
            static transformGrid(grid, targetCorner) {
                let newGrid = deepCopyGrid(grid);
                const size = grid.length;
                switch (\`\${targetCorner.r}-\${targetCorner.c}\`) {
                    case \`0-\${size - 1}\`: return newGrid.map(row => row.reverse());
                    case \`\${size - 1}-0\`: return newGrid.reverse();
                    case \`\${size - 1}-\${size - 1}\`: newGrid.reverse(); return newGrid.map(row => row.reverse());
                    default: return newGrid;
                }
            }
        }

        // --- AI Heuristics & Search ---
        class AI {
            constructor(depth) {
                this.depth = depth;
                this.memo = new Map();
            }
            clearMemo = () => this.memo.clear();
            generateBoardKey = (grid) => grid.map(row => row.join('-')).join(',');
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
                const memoKey = \`\${this.generateBoardKey(board.grid)}-\${depth}-\${isMaxNode}\`;
                if (this.memo.has(memoKey)) return this.memo.get(memoKey);
                if (depth === 0 || board.isGameOver()) return { score: AI.heuristic(board), move: null };
                const result = isMaxNode ? this.handleMaxNode(board, depth) : this.handleChanceNode(board, depth);
                this.memo.set(memoKey, result);
                return result;
            }
            handleMaxNode(board, depth) {
                let maxScore = -Infinity, bestMove = null;
                const validMoves = board.getValidMoves();
                if (validMoves.length === 0) return { score: AI.heuristic(board), move: null };
                bestMove = validMoves[0];
                for (const move of validMoves) {
                    const newBoard = board.copy();
                    const { score: moveScore } = newBoard.swipe(move);
                    const { score } = this.expectimax(newBoard, depth - 1, false);
                    const totalScore = score + moveScore;
                    if (totalScore > maxScore) { maxScore = totalScore; bestMove = move; }
                }
                return { score: maxScore, move: bestMove };
            }
            handleChanceNode(board, depth) {
                const emptyCells = board.getEmptyCells();
                if (emptyCells.length === 0) return { score: AI.heuristic(board), move: null };
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
                return this.expectimax(board, this.depth, true).move;
            }
        }

        let aiInstance;

        // --- Worker Message Handler ---
        self.onmessage = function(e) {
            const { type, payload } = e.data;
            if (type === 'init') {
                aiInstance = new AI(payload.depth);
                self.postMessage({ type: 'initialized' });
            } else if (type === 'calculateMove') {
                if (!aiInstance) return;
                const bestMove = aiInstance.getBestMove(payload.grid);
                self.postMessage({ type: 'moveCalculated', payload: { move: bestMove } });
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

    // ===================================================================================
    // GAME INTEGRATION & CONTROL (MAIN THREAD) - 游戏集成与控制 (主线程)
    // ===================================================================================
    class GameController {
        constructor() {
            this.gameInstance = null;
            this.aiPlaying = false;
            this.aiTimer = null;
            this.isCalculating = false;
            this.lastBoardState = null;
            this.button = null;
            this.aiWorker = null;
            this.DIRECTION_MAP = Object.freeze({ 0: 'up', 1: 'right', 2: 'down', 3: 'left' });
        }

        init() {
            try {
                const blob = new Blob([workerCode], { type: 'application/javascript' });
                this.aiWorker = new Worker(URL.createObjectURL(blob));
                this.aiWorker.onmessage = this.handleWorkerMessage.bind(this);
                this.aiWorker.postMessage({ type: 'init', payload: { depth: CONFIG.AI_SEARCH_DEPTH } });
                setTimeout(() => this.createToggleButton(), CONFIG.BUTTON_INIT_DELAY);
            } catch (e) {
                console.error("Failed to initialize AI Worker:", e);
                alert("Error: Could not create the background AI worker. The script may not run correctly.");
            }
        }

        handleWorkerMessage(e) {
            const { type, payload } = e.data;
            if (type === 'moveCalculated') {
                this.executeMove(payload.move);
                this.isCalculating = false;
                if (this.aiPlaying) {
                    this.scheduleNext(CONFIG.AI_DELAY_AFTER_MOVE);
                }
            } else if (type === 'initialized') {
                console.log("AI Worker initialized successfully.");
            }
        }

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
            if (moveCode === null || typeof moveCode === 'undefined') {
                this.stopAI("Game Over?");
                return;
            }
            const direction = this.DIRECTION_MAP[moveCode];
            if (direction && this.gameInstance.handleMove) {
                this.gameInstance.handleMove(direction);
            }
        }

        autoPlay() {
            if (!this.aiPlaying || this.isCalculating || !this.gameInstance) return;

            if (this.gameInstance.gameOver || this.gameInstance.victory) {
                this.stopAI(this.gameInstance.victory ? "🏆 Victory!" : "Game Over");
                return;
            }

            if (areGridsEqual(this.gameInstance.board, this.lastBoardState)) {
                this.scheduleNext(CONFIG.AUTO_PLAY_INTERVAL);
                return;
            }

            this.lastBoardState = deepCopyGrid(this.gameInstance.board);
            this.isCalculating = true;
            this.aiWorker.postMessage({ type: 'calculateMove', payload: { grid: this.lastBoardState } });
        }

        scheduleNext(delay) {
            clearTimeout(this.aiTimer);
            if (this.aiPlaying) {
                this.aiTimer = setTimeout(() => this.autoPlay(), delay);
            }
        }

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

            console.log(`%cChimera AI v${GM_info.script.version} Started (Worker Mode)`, "color: #4CAF50; font-weight: bold;");
            this.scheduleNext(300);
            this.updateButton('Stop AI', '#f65e3b');
        }

        stopAI(endText = 'Start AI') {
            this.aiPlaying = false;
            this.isCalculating = false;
            clearTimeout(this.aiTimer);
            console.log("%cChimera AI Stopped.", "color: #f65e3b; font-weight: bold;");
            this.updateButton(endText, '#8f7a66');
        }

        updateButton(text, color) {
            if (this.button) {
                this.button.textContent = text;
                this.button.style.backgroundColor = color;
            }
        }

        createToggleButton() {
            if (document.getElementById('ai-toggle-button')) return;
            this.button = document.createElement('button');
            this.button.id = 'ai-toggle-button';
            this.button.textContent = 'Start AI';
            Object.assign(this.button.style, {
                position: 'fixed', top: '10px', right: '10px', zIndex: '10000',
                padding: '12px 18px', fontSize: '16px', fontWeight: 'bold',
                cursor: 'pointer', backgroundColor: '#8f7a66', color: '#f9f6f2',
                border: '2px solid #776e65', borderRadius: '6px',
                boxShadow: '0 3px 8px rgba(0,0,0,0.3)',
                fontFamily: '"Clear Sans", "Helvetica Neue", Arial, sans-serif',
                transition: 'all 0.2s ease', userSelect: 'none'
            });
            this.button.addEventListener('mouseenter', () => {
                this.button.style.transform = 'translateY(-1px)';
                this.button.style.boxShadow = '0 4px 12px rgba(0,0,0,0.4)';
            });
            this.button.addEventListener('mouseleave', () => {
                this.button.style.transform = 'translateY(0)';
                this.button.style.boxShadow = '0 3px 8px rgba(0,0,0,0.3)';
            });
            this.button.onclick = () => this.aiPlaying ? this.stopAI() : this.startAI();
            document.body.appendChild(this.button);
        }
    }

    // ===================================================================================
    // INITIALIZATION - 初始化
    // ===================================================================================
    const gameController = new GameController();
    gameController.init();

    window.ChimeraAI = {
        controller: gameController,
    };

})();