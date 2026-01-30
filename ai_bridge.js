/**
 * AI Bridge - 网页端 UI 和通信桥接
 * 配合 Python AI 引擎使用
 */

(function() {
    'use strict';

    // ===================================================================================
    // 配置
    // ===================================================================================
    const CONFIG = {
        STORAGE_KEY_AUTO_RESTART: 'PythonAI_2048_AutoRestart_v1',
        DEFAULT_AUTO_RESTART: false,
        AUTO_RESTART_DELAY: 1500,
        STORAGE_KEY_SCORES: 'PythonAI_2048_ScoreHistory_v1',
        MAX_SCORE_RECORDS: 20,
    };

    // ===================================================================================
    // 存储工具
    // ===================================================================================
    function safeGetAutoRestart() {
        try {
            const v = localStorage.getItem(CONFIG.STORAGE_KEY_AUTO_RESTART);
            if (v === 'true') return true;
            if (v === 'false') return false;
        } catch (e) {}
        return CONFIG.DEFAULT_AUTO_RESTART;
    }

    function safeSetAutoRestart(enabled) {
        try { localStorage.setItem(CONFIG.STORAGE_KEY_AUTO_RESTART, enabled ? 'true' : 'false'); } catch (e) {}
    }

    function loadScoreHistory() {
        try {
            const raw = localStorage.getItem(CONFIG.STORAGE_KEY_SCORES);
            if (raw) return JSON.parse(raw);
        } catch (e) {}
        return [];
    }

    function saveScoreHistory(history) {
        try { localStorage.setItem(CONFIG.STORAGE_KEY_SCORES, JSON.stringify(history)); } catch (e) {}
    }

    function addScoreRecord(score, maxTile) {
        const history = loadScoreHistory();
        history.unshift({ score, maxTile, time: Date.now() });
        if (history.length > CONFIG.MAX_SCORE_RECORDS) history.length = CONFIG.MAX_SCORE_RECORDS;
        saveScoreHistory(history);
        return history;
    }

    function clearScoreHistory() {
        saveScoreHistory([]);
    }

    // ===================================================================================
    // UI 控制器
    // ===================================================================================
    class UIController {
        constructor() {
            this.autoRestart = safeGetAutoRestart();
            this.isRunning = false;

            this.startButton = null;
            this.autoRestartButton = null;
            this.displayPanel = null;
            this.scorePanel = null;

            this.createUI();
        }

        createUI() {
            if (document.getElementById('ai-toggle-button')) return;

            // --- Start/Stop 按钮 ---
            this.startButton = this.createButton('ai-toggle-button', 'Start AI', {
                top: '10px', backgroundColor: '#8f7a66'
            });
            this.startButton.onclick = () => {
                // 设置标志位，Python 通过轮询检测
                window._aiControl = window._aiControl || {};
                window._aiControl.startClicked = true;
                console.log('[AI Bridge] Start clicked');
            };

            // --- 自动续按钮 ---
            this.autoRestartButton = this.createButton('ai-auto-restart-button', '', {
                top: '62px', backgroundColor: '#6b7280'
            });
            this.autoRestartButton.onclick = () => {
                this.toggleAutoRestart();
                window._aiControl = window._aiControl || {};
                window._aiControl.autoRestartChanged = this.autoRestart;
                console.log('[AI Bridge] Auto restart:', this.autoRestart);
            };
            this.updateAutoRestartButton();

            // --- 操作显示面板 ---
            this.displayPanel = document.createElement('div');
            this.displayPanel.id = 'ai-display-panel';
            Object.assign(this.displayPanel.style, {
                position: 'fixed', top: '114px', right: '10px', zIndex: '10000',
                width: '140px', padding: '10px 12px',
                backgroundColor: '#faf8ef', color: '#776e65',
                border: '2px solid #bbada0', borderRadius: '6px',
                boxShadow: '0 3px 8px rgba(0,0,0,0.22)',
                fontFamily: '"Clear Sans", "Helvetica Neue", Arial, sans-serif',
                fontSize: '13px', lineHeight: '1.6'
            });
            this.displayPanel.innerHTML = `
                <div style="font-weight:bold;margin-bottom:6px;color:#8f7a66;">AI 状态</div>
                <div id="ai-status">● 已停止</div>
                <div>当前: <span id="ai-current">-</span></div>
                <div>上步: <span id="ai-next">-</span></div>
                <div style="font-size:11px;color:#aaa;margin-top:4px;">
                    深度:<span id="ai-depth">-</span> 耗时:<span id="ai-time">-</span>ms
                </div>
            `;
            document.body.appendChild(this.displayPanel);

            // --- 分数记录面板 ---
            this._scorePanelCollapsed = false;
            this._scorePanelPos = { top: '238px', right: '10px', left: 'auto' };

            // 折叠时的小按钮
            this.scoreToggleBtn = document.createElement('button');
            this.scoreToggleBtn.id = 'ai-score-toggle';
            this.scoreToggleBtn.textContent = '📊';
            Object.assign(this.scoreToggleBtn.style, {
                position: 'fixed', top: '238px', right: '10px', zIndex: '10000',
                width: '36px', height: '36px', padding: '0',
                fontSize: '18px', cursor: 'grab',
                backgroundColor: '#8f7a66', color: '#f9f6f2',
                border: '2px solid #776e65', borderRadius: '6px',
                boxShadow: '0 3px 8px rgba(0,0,0,0.25)',
                display: 'none', userSelect: 'none'
            });

            // 小按钮拖拽逻辑
            let btnDragX = 0, btnDragY = 0, btnIsDragging = false, btnMoved = false;
            this.scoreToggleBtn.addEventListener('mousedown', (e) => {
                btnIsDragging = true;
                btnMoved = false;
                btnDragX = e.clientX - this.scoreToggleBtn.getBoundingClientRect().left;
                btnDragY = e.clientY - this.scoreToggleBtn.getBoundingClientRect().top;
                this.scoreToggleBtn.style.cursor = 'grabbing';
                e.preventDefault();
            });
            document.addEventListener('mousemove', (e) => {
                if (!btnIsDragging) return;
                btnMoved = true;
                const x = e.clientX - btnDragX;
                const y = e.clientY - btnDragY;
                this.scoreToggleBtn.style.left = x + 'px';
                this.scoreToggleBtn.style.top = y + 'px';
                this.scoreToggleBtn.style.right = 'auto';
                // 同步更新位置记录
                this._scorePanelPos = { top: y + 'px', left: x + 'px', right: 'auto' };
            });
            document.addEventListener('mouseup', () => {
                if (btnIsDragging) {
                    btnIsDragging = false;
                    this.scoreToggleBtn.style.cursor = 'grab';
                    // 如果没移动，则是点击，展开面板
                    if (!btnMoved) {
                        this.toggleScorePanel();
                    }
                }
            });

            document.body.appendChild(this.scoreToggleBtn);

            // 展开时的面板
            this.scorePanel = document.createElement('div');
            this.scorePanel.id = 'ai-score-panel';
            Object.assign(this.scorePanel.style, {
                position: 'fixed', top: '238px', right: '10px', zIndex: '10000',
                width: '240px', height: '300px', minWidth: '180px', minHeight: '80px',
                backgroundColor: '#faf8ef', color: '#776e65',
                border: '2px solid #bbada0', borderRadius: '6px',
                boxShadow: '0 3px 8px rgba(0,0,0,0.22)',
                fontFamily: '"Clear Sans", "Helvetica Neue", Arial, sans-serif',
                fontSize: '13px', overflow: 'hidden',
                display: 'flex', flexDirection: 'column',
                resize: 'both'
            });

            const panelHeader = document.createElement('div');
            panelHeader.id = 'ai-score-header';
            Object.assign(panelHeader.style, {
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '8px 10px', borderBottom: '1px solid #d6cdc4',
                backgroundColor: '#eee4da', borderRadius: '4px 4px 0 0',
                cursor: 'grab', userSelect: 'none'
            });

            const titleSpan = document.createElement('span');
            titleSpan.textContent = '分数记录';
            titleSpan.style.fontWeight = 'bold';

            const headerBtns = document.createElement('span');
            headerBtns.style.display = 'flex';
            headerBtns.style.gap = '4px';

            const collapseBtn = document.createElement('button');
            collapseBtn.textContent = '−';
            Object.assign(collapseBtn.style, {
                padding: '0 6px', fontSize: '14px', lineHeight: '18px', cursor: 'pointer',
                backgroundColor: '#bbada0', color: '#f9f6f2', border: 'none',
                borderRadius: '3px'
            });
            collapseBtn.onclick = (e) => {
                e.stopPropagation();
                this.toggleScorePanel();
            };

            const clearBtn = document.createElement('button');
            clearBtn.textContent = '清空';
            Object.assign(clearBtn.style, {
                padding: '0 6px', fontSize: '11px', lineHeight: '18px', cursor: 'pointer',
                backgroundColor: '#bbada0', color: '#f9f6f2', border: 'none',
                borderRadius: '3px'
            });
            clearBtn.onclick = (e) => {
                e.stopPropagation();
                if (confirm('确定清空所有分数记录？')) {
                    clearScoreHistory();
                    this.updateScorePanel();
                }
            };

            headerBtns.appendChild(collapseBtn);
            headerBtns.appendChild(clearBtn);
            panelHeader.appendChild(titleSpan);
            panelHeader.appendChild(headerBtns);
            this.scorePanel.appendChild(panelHeader);

            // 拖拽逻辑
            let dragX = 0, dragY = 0, isDragging = false;
            panelHeader.addEventListener('mousedown', (e) => {
                if (e.target.tagName === 'BUTTON') return;
                isDragging = true;
                dragX = e.clientX - this.scorePanel.getBoundingClientRect().left;
                dragY = e.clientY - this.scorePanel.getBoundingClientRect().top;
                panelHeader.style.cursor = 'grabbing';
                e.preventDefault();
            });
            document.addEventListener('mousemove', (e) => {
                if (!isDragging) return;
                const x = e.clientX - dragX;
                const y = e.clientY - dragY;
                this.scorePanel.style.left = x + 'px';
                this.scorePanel.style.top = y + 'px';
                this.scorePanel.style.right = 'auto';
            });
            document.addEventListener('mouseup', () => {
                if (isDragging) {
                    isDragging = false;
                    panelHeader.style.cursor = 'grab';
                }
            });

            // 表格内容区域
            this._scoreBody = document.createElement('div');
            Object.assign(this._scoreBody.style, {
                flex: '1', overflowY: 'auto'
            });

            const table = document.createElement('table');
            Object.assign(table.style, { width: '100%', borderCollapse: 'collapse', fontSize: '12px' });
            table.innerHTML = `
                <thead>
                    <tr style="background:#eee4da;color:#8f7a66;">
                        <th style="padding:4px 6px;text-align:center;font-size:11px;">#</th>
                        <th style="padding:4px 6px;text-align:right;">分数</th>
                        <th style="padding:4px 6px;text-align:center;">最大块</th>
                        <th style="padding:4px 6px;text-align:center;">时间</th>
                    </tr>
                </thead>
                <tbody id="score-tbody"></tbody>
            `;
            this._scoreBody.appendChild(table);
            this.scorePanel.appendChild(this._scoreBody);
            document.body.appendChild(this.scorePanel);


            this.updateScorePanel();
        }

        createButton(id, text, styleOverrides) {
            const btn = document.createElement('button');
            btn.id = id;
            btn.textContent = text;
            Object.assign(btn.style, {
                position: 'fixed', right: '10px', zIndex: '10000',
                padding: '10px 14px', fontSize: '14px', fontWeight: 'bold',
                cursor: 'pointer', color: '#f9f6f2',
                border: '2px solid #776e65', borderRadius: '6px',
                boxShadow: '0 3px 8px rgba(0,0,0,0.25)',
                fontFamily: '"Clear Sans", "Helvetica Neue", Arial, sans-serif',
                transition: 'all 0.2s ease', userSelect: 'none',
                ...styleOverrides
            });
            btn.addEventListener('mouseenter', () => {
                btn.style.transform = 'translateY(-1px)';
                btn.style.boxShadow = '0 4px 12px rgba(0,0,0,0.35)';
            });
            btn.addEventListener('mouseleave', () => {
                btn.style.transform = 'translateY(0)';
                btn.style.boxShadow = '0 3px 8px rgba(0,0,0,0.25)';
            });
            document.body.appendChild(btn);
            return btn;
        }

        toggleAutoRestart() {
            this.autoRestart = !this.autoRestart;
            safeSetAutoRestart(this.autoRestart);
            this.updateAutoRestartButton();
        }

        toggleScorePanel() {
            this._scorePanelCollapsed = !this._scorePanelCollapsed;
            if (this._scorePanelCollapsed) {
                // 记录面板位置，然后隐藏面板显示按钮
                const rect = this.scorePanel.getBoundingClientRect();
                this._scorePanelPos = {
                    top: rect.top + 'px',
                    left: this.scorePanel.style.left || 'auto',
                    right: this.scorePanel.style.left ? 'auto' : '10px'
                };
                this.scorePanel.style.display = 'none';
                this.scoreToggleBtn.style.display = 'block';
                this.scoreToggleBtn.style.top = this._scorePanelPos.top;
                this.scoreToggleBtn.style.left = this._scorePanelPos.left;
                this.scoreToggleBtn.style.right = this._scorePanelPos.right;
            } else {
                // 隐藏按钮显示面板
                this.scoreToggleBtn.style.display = 'none';
                this.scorePanel.style.display = 'flex';
                this.scorePanel.style.top = this._scorePanelPos.top;
                this.scorePanel.style.left = this._scorePanelPos.left;
                this.scorePanel.style.right = this._scorePanelPos.right;
            }
        }

        updateAutoRestartButton() {
            this.autoRestartButton.textContent = this.autoRestart ? '自动续：开' : '自动续：关';
            this.autoRestartButton.style.backgroundColor = this.autoRestart ? '#22c55e' : '#6b7280';
        }

        setRunning(running) {
            this.isRunning = running;
            this.startButton.textContent = running ? 'Stop AI' : 'Start AI';
            this.startButton.style.backgroundColor = running ? '#f65e3b' : '#8f7a66';

            const statusEl = document.getElementById('ai-status');
            if (statusEl) {
                statusEl.innerHTML = running
                    ? '<span style="color:#22c55e;">● 运行中</span>'
                    : '<span style="color:#999;">● 已停止</span>';
            }
        }

        updateDisplay(data) {
            const { current, next, depth, time } = data;
            const currentEl = document.getElementById('ai-current');
            const nextEl = document.getElementById('ai-next');
            const depthEl = document.getElementById('ai-depth');
            const timeEl = document.getElementById('ai-time');

            if (currentEl) currentEl.textContent = current || '-';
            if (nextEl) nextEl.textContent = next || '-';
            if (depthEl) depthEl.textContent = depth || '-';
            if (timeEl) timeEl.textContent = time ? time.toFixed(0) : '-';
        }

        updateScorePanel() {
            const tbody = document.getElementById('score-tbody');
            if (!tbody) return;

            const history = loadScoreHistory();
            if (history.length === 0) {
                tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:#999;padding:8px;">暂无记录</td></tr>';
                return;
            }

            const bestScore = Math.max(...history.map(h => h.score));
            tbody.innerHTML = history.map((rec, i) => {
                const d = new Date(rec.time);
                const timeStr = `${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
                const isBest = rec.score === bestScore;
                const rowColor = isBest ? '#fef3c7' : (i % 2 === 0 ? '#faf8ef' : '#f0ede4');
                const scoreColor = isBest ? '#d97706' : '#776e65';

                return `<tr style="background:${rowColor}">
                    <td style="padding:3px 6px;text-align:center;color:#999;font-size:11px;">${i+1}</td>
                    <td style="padding:3px 6px;text-align:right;font-weight:bold;color:${scoreColor}">${rec.score.toLocaleString()}</td>
                    <td style="padding:3px 6px;text-align:center;font-size:12px;">${rec.maxTile || '-'}</td>
                    <td style="padding:3px 6px;text-align:center;font-size:11px;color:#aaa">${timeStr}</td>
                </tr>`;
            }).join('');
        }

        recordScore(score, maxTile) {
            addScoreRecord(score, maxTile);
            this.updateScorePanel();
        }

        findRestartButton() {
            const selectors = [
                '.restart-button', '.retry-button', 'button.restart',
                '[class*="restart"]', '[class*="retry"]', '[class*="new-game"]'
            ];
            for (const sel of selectors) {
                try {
                    const btn = document.querySelector(sel);
                    if (btn) return btn;
                } catch (e) {}
            }

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

        clickRestartButton() {
            const btn = this.findRestartButton();
            if (btn) {
                btn.click();
                return true;
            }
            return false;
        }
    }

    // ===================================================================================
    // 游戏接口
    // ===================================================================================
    const GameInterface = {
        getGameInstance() {
            if (window.canvasGame?.board) return window.canvasGame;
            for (const key in window) {
                try {
                    const obj = window[key];
                    if (obj && typeof obj === 'object' && obj.board && typeof obj.handleMove === 'function') {
                        return obj;
                    }
                } catch (e) {}
            }
            return null;
        },

        getBoard() {
            const game = this.getGameInstance();
            return game?.board || null;
        },

        getScore() {
            const game = this.getGameInstance();
            return game?.score || 0;
        },

        isGameOver() {
            const game = this.getGameInstance();
            return game?.gameOver || false;
        },

        isVictory() {
            const game = this.getGameInstance();
            return game?.victory || false;
        },

        move(direction) {
            const game = this.getGameInstance();
            if (game?.handleMove) {
                game.handleMove(direction);
                return true;
            }
            return false;
        },

        getMaxTile() {
            const board = this.getBoard();
            if (!board) return 0;
            let max = 0;
            for (let r = 0; r < board.length; r++) {
                for (let c = 0; c < board[r].length; c++) {
                    if (board[r][c] > max) max = board[r][c];
                }
            }
            return max;
        }
    };

    // ===================================================================================
    // 初始化
    // ===================================================================================
    const uiController = new UIController();

    // 暴露给 Python 调用的接口
    window._aiBridge = {
        // 游戏接口
        getBoard: () => JSON.stringify(GameInterface.getBoard()),
        getScore: () => GameInterface.getScore(),
        isGameOver: () => GameInterface.isGameOver(),
        isVictory: () => GameInterface.isVictory(),
        move: (dir) => GameInterface.move(dir),
        getMaxTile: () => GameInterface.getMaxTile(),

        // UI 接口
        setRunning: (running) => uiController.setRunning(running),
        updateDisplay: (data) => uiController.updateDisplay(JSON.parse(data)),
        recordScore: (score, maxTile) => uiController.recordScore(score, maxTile),
        clickRestartButton: () => uiController.clickRestartButton(),

        // 状态接口
        getAutoRestart: () => uiController.autoRestart
    };

    // Python 端通过轮询 window._aiControl 读取按钮事件
    window._aiControl = {
        startClicked: false,
        autoRestartChanged: null
    };

    console.log('%c[AI Bridge] 初始化完成，等待 Python 连接...', 'color: #22c55e; font-weight: bold;');

})();
