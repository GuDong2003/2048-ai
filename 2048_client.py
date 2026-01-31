#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
2048 AI 桌面客户端 - Python AI 版
- 上方输入 Cookie 进行认证
- 嵌入浏览器运行 2048 游戏
- Python Numba JIT 加速 AI（独立子进程）
"""

import sys
import os
import json
import urllib.request
from pathlib import Path

# 注意：AI 引擎现在在子进程中运行，不需要在主进程预热

# 设置 Qt 插件路径（必须在 import PyQt5 之前）
def _setup_qt_plugins():
    venv_dir = Path(__file__).parent / ".venv"
    if venv_dir.exists():
        plugins = venv_dir / "lib" / f"python{sys.version_info.major}.{sys.version_info.minor}" / "site-packages" / "PyQt5" / "Qt5" / "plugins"
        if plugins.exists():
            os.environ["QT_PLUGIN_PATH"] = str(plugins)
            os.environ["QT_QPA_PLATFORM_PLUGIN_PATH"] = str(plugins / "platforms")

_setup_qt_plugins()

from PyQt5.QtCore import (
    Qt, QUrl, QTimer
)
from PyQt5.QtWidgets import (
    QApplication, QMainWindow, QWidget, QVBoxLayout, QHBoxLayout,
    QPushButton, QLineEdit, QLabel, QMessageBox, QGroupBox, QDialog
)
from PyQt5.QtWebEngineWidgets import QWebEngineView, QWebEnginePage, QWebEngineProfile
from PyQt5.QtNetwork import QNetworkCookie

# 配置文件路径
COOKIE_FILE = Path(__file__).parent / ".cookie_cache"
FEISHU_WEBHOOK_FILE = Path(__file__).parent / ".feishu_webhook"
FEISHU_THRESHOLD_FILE = Path(__file__).parent / ".feishu_threshold"

# 飞书推送默认阈值
DEFAULT_FEISHU_SCORE_THRESHOLD = 160000


def load_saved_cookie():
    """加载保存的 Cookie"""
    try:
        if COOKIE_FILE.exists():
            return COOKIE_FILE.read_text(encoding='utf-8').strip()
    except:
        pass
    return ""


def save_cookie(cookie_str):
    """保存 Cookie"""
    try:
        COOKIE_FILE.write_text(cookie_str, encoding='utf-8')
    except:
        pass


def load_feishu_webhook():
    """加载保存的飞书 Webhook URL"""
    try:
        if FEISHU_WEBHOOK_FILE.exists():
            return FEISHU_WEBHOOK_FILE.read_text(encoding='utf-8').strip()
    except:
        pass
    return ""


def save_feishu_webhook(webhook_url):
    """保存飞书 Webhook URL"""
    try:
        FEISHU_WEBHOOK_FILE.write_text(webhook_url, encoding='utf-8')
    except:
        pass


def load_feishu_threshold():
    """加载飞书推送分数阈值"""
    try:
        if FEISHU_THRESHOLD_FILE.exists():
            val = int(FEISHU_THRESHOLD_FILE.read_text(encoding='utf-8').strip())
            if val > 0:
                return val
    except:
        pass
    return DEFAULT_FEISHU_SCORE_THRESHOLD


def save_feishu_threshold(threshold):
    """保存飞书推送分数阈值"""
    try:
        FEISHU_THRESHOLD_FILE.write_text(str(threshold), encoding='utf-8')
    except:
        pass


# =============================================================================
# AI 引擎（子进程运行，避免阻塞 UI）
# =============================================================================

import subprocess
import threading
import queue


class AIManager:
    """AI 引擎管理器（使用子进程避免阻塞 UI）"""

    def __init__(self):
        self._initialized = False
        self._pending = False
        self._result = None
        self._result_queue = queue.Queue()
        self._worker_process = None
        self._reader_thread = None
        self._script_dir = Path(__file__).parent
        # 预计算的下一步
        self._next_move = None

    def initialize(self):
        """初始化 AI 子进程"""
        if self._initialized:
            return

        try:
            # 启动子进程
            worker_script = self._script_dir / "ai_worker.py"
            python_path = self._script_dir / ".venv" / "bin" / "python3"

            env = os.environ.copy()
            env['NUMBA_NUM_THREADS'] = '1'
            env['NUMBA_THREADING_LAYER'] = 'workqueue'

            self._worker_process = subprocess.Popen(
                [str(python_path), str(worker_script)],
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=None,  # 直接输出到终端，方便调试
                text=True,
                bufsize=1,
                env=env
            )

            # 等待 READY 信号
            ready_line = self._worker_process.stdout.readline().strip()
            if ready_line == "READY":
                self._initialized = True
                print("[AI] 子进程引擎就绪")

                # 启动读取线程
                self._reader_thread = threading.Thread(target=self._read_results, daemon=True)
                self._reader_thread.start()
            else:
                print(f"[AI] 子进程启动失败: {ready_line}")
                self._worker_process.kill()
                self._worker_process = None

        except Exception as e:
            print(f"[AI] 初始化子进程失败: {e}")
            self._initialized = False

    def _read_results(self):
        """后台线程：读取子进程输出"""
        while self._worker_process and self._worker_process.poll() is None:
            try:
                line = self._worker_process.stdout.readline()
                if line:
                    result = json.loads(line.strip())
                    self._result_queue.put(result)
            except Exception as e:
                print(f"[AI] 读取结果错误: {e}")
                break

    def submit_task(self, board):
        """提交计算任务到子进程"""
        if not self._initialized:
            self.initialize()
        if not self._initialized or not self._worker_process:
            return None

        if self._pending:
            return None  # 上一个任务还没完成

        self._pending = True
        self._result = None

        try:
            # 发送请求到子进程
            request = json.dumps({'board': board})
            self._worker_process.stdin.write(request + '\n')
            self._worker_process.stdin.flush()
        except Exception as e:
            print(f"[AI] 发送请求失败: {e}")
            self._pending = False
            return None

        return True

    def get_result(self):
        """获取计算结果（非阻塞）"""
        try:
            result = self._result_queue.get_nowait()
            self._pending = False

            # 保存下一步预测（如果有的话）
            if self._next_move:
                result['next_move'] = self._next_move
                self._next_move = None

            return result
        except queue.Empty:
            return None

    def set_next_move(self, move_arrow):
        """设置预计算的下一步"""
        self._next_move = move_arrow

    def is_busy(self):
        """检查是否有任务在执行"""
        return self._pending

    def shutdown(self):
        """清理子进程"""
        if self._worker_process:
            try:
                self._worker_process.stdin.close()
                self._worker_process.terminate()
                self._worker_process.wait(timeout=2)
            except:
                self._worker_process.kill()
            self._worker_process = None
        self._initialized = False


# =============================================================================
# 飞书推送
# =============================================================================

def send_feishu_notification(webhook_url, score, max_tile, threshold):
    """发送飞书通知"""
    if not webhook_url:
        return False

    try:
        threshold_display = f"{threshold // 10000} 万" if threshold >= 10000 else str(threshold)
        payload = {
            "msg_type": "text",
            "content": {
                "text": f"🎉 2048 AI 突破 {threshold_display}分！\n\n"
                        f"📊 最终分数: {score:,}\n"
                        f"🏆 最大方块: {max_tile}"
            }
        }
        data = json.dumps(payload).encode('utf-8')
        req = urllib.request.Request(
            webhook_url,
            data=data,
            headers={'Content-Type': 'application/json'}
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            return resp.status == 200
    except Exception as e:
        print(f"[飞书推送] 发送失败: {e}")
        return False


class SettingsDialog(QDialog):
    """设置对话框"""

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowTitle("设置")
        self.setMinimumWidth(450)
        self.setup_ui()

    def setup_ui(self):
        layout = QVBoxLayout(self)

        # 飞书 Webhook 设置
        feishu_group = QGroupBox("飞书推送设置")
        feishu_layout = QVBoxLayout(feishu_group)

        # Webhook URL
        webhook_row = QHBoxLayout()
        webhook_row.addWidget(QLabel("Webhook:"))
        self.webhook_input = QLineEdit()
        self.webhook_input.setPlaceholderText("https://open.feishu.cn/open-apis/bot/v2/hook/xxx")
        self.webhook_input.setText(load_feishu_webhook())
        webhook_row.addWidget(self.webhook_input, 1)
        feishu_layout.addLayout(webhook_row)

        # 分数阈值
        threshold_row = QHBoxLayout()
        threshold_row.addWidget(QLabel("推送阈值:"))
        self.threshold_input = QLineEdit()
        self.threshold_input.setPlaceholderText(str(DEFAULT_FEISHU_SCORE_THRESHOLD))
        self.threshold_input.setText(str(load_feishu_threshold()))
        self.threshold_input.setFixedWidth(120)
        threshold_row.addWidget(self.threshold_input)
        threshold_row.addWidget(QLabel("分（达到此分数时推送）"))
        threshold_row.addStretch()
        feishu_layout.addLayout(threshold_row)

        # 测试按钮
        test_btn = QPushButton("测试推送")
        test_btn.clicked.connect(self.test_notification)
        test_btn.setStyleSheet("background-color: #2196F3; color: white; padding: 6px 12px;")
        feishu_layout.addWidget(test_btn)

        layout.addWidget(feishu_group)

        # 按钮区域
        btn_row = QHBoxLayout()
        btn_row.addStretch()

        save_btn = QPushButton("保存")
        save_btn.clicked.connect(self.save_settings)
        save_btn.setStyleSheet("background-color: #4CAF50; color: white; padding: 8px 20px;")
        btn_row.addWidget(save_btn)

        cancel_btn = QPushButton("取消")
        cancel_btn.clicked.connect(self.reject)
        cancel_btn.setStyleSheet("background-color: #9e9e9e; color: white; padding: 8px 20px;")
        btn_row.addWidget(cancel_btn)

        layout.addLayout(btn_row)

    def test_notification(self):
        webhook_url = self.webhook_input.text().strip()
        if not webhook_url:
            QMessageBox.warning(self, "提示", "请先填写 Webhook URL")
            return

        threshold = self._parse_threshold()
        if send_feishu_notification(webhook_url, 168888, 4096, threshold):
            QMessageBox.information(self, "成功", "测试消息已发送，请检查飞书")
        else:
            QMessageBox.warning(self, "失败", "发送失败，请检查 Webhook URL 是否正确")

    def _parse_threshold(self):
        try:
            val = int(self.threshold_input.text().strip())
            if val > 0:
                return val
        except:
            pass
        return DEFAULT_FEISHU_SCORE_THRESHOLD

    def save_settings(self):
        webhook_url = self.webhook_input.text().strip()
        save_feishu_webhook(webhook_url)
        save_feishu_threshold(self._parse_threshold())
        self.accept()


# =============================================================================
# 自定义网页
# =============================================================================

class GameWebPage(QWebEnginePage):
    """自定义网页，用于捕获控制台输出"""

    def __init__(self, profile, parent=None):
        super().__init__(profile, parent)

    def javaScriptConsoleMessage(self, level, message, line, source):
        # 过滤 AI Bridge 的日志
        if '[AI Bridge]' in message or '[Python]' in message:
            print(f"[JS] {message}")


# =============================================================================
# 主窗口
# =============================================================================

class MainWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("2048 AI 客户端 (Python Numba)")
        self.setMinimumSize(400, 300)
        self.resize(1000, 1100)

        # 脚本路径
        self.script_dir = Path(__file__).parent
        self.bridge_script_path = self.script_dir / "ai_bridge.js"

        # AI 状态
        self.ai_running = False
        self.ai_manager = AIManager()
        self.auto_restart = False
        self.current_move_arrow = '-'
        self.next_move_arrow = '-'
        self._last_board = None  # 上一次的棋盘状态
        self._step_active = False  # 当前是否有步骤在执行

        # AI 结果轮询定时器（仅在等待 AI 计算时启动）
        self._ai_poll_timer = QTimer(self)
        self._ai_poll_timer.timeout.connect(self._step_poll_result)
        self._ai_poll_timer.setInterval(20)  # 20ms 轮询 AI 结果

        # 控制轮询定时器（检测 JS 端按钮点击）
        self.control_timer = QTimer(self)
        self.control_timer.timeout.connect(self.poll_controls)
        self.control_poll_interval = 100  # ms

        self.setup_ui()
        self.setup_browser()

    def setup_ui(self):
        """设置界面"""
        central_widget = QWidget()
        self.setCentralWidget(central_widget)
        layout = QVBoxLayout(central_widget)
        layout.setContentsMargins(10, 10, 10, 10)
        layout.setSpacing(10)

        # === 认证区域 ===
        auth_group = QGroupBox("认证设置")
        auth_layout = QVBoxLayout(auth_group)

        # Cookie 输入 + 按钮（同一行）
        cookie_row = QHBoxLayout()
        cookie_row.addWidget(QLabel("Cookie:"))
        self.cookie_input = QLineEdit()
        self.cookie_input.setPlaceholderText("输入 cookie，格式: session=xxx; _t=yyy (从浏览器复制)")
        # 加载保存的 Cookie
        saved_cookie = load_saved_cookie()
        if saved_cookie:
            self.cookie_input.setText(saved_cookie)
        cookie_row.addWidget(self.cookie_input, 1)

        self.apply_btn = QPushButton("应用")
        self.apply_btn.clicked.connect(self.apply_cookies)
        self.apply_btn.setStyleSheet("background-color: #4CAF50; color: white; padding: 8px 12px;")
        cookie_row.addWidget(self.apply_btn)

        self.refresh_btn = QPushButton("刷新")
        self.refresh_btn.clicked.connect(self.refresh_page)
        self.refresh_btn.setStyleSheet("background-color: #2196F3; color: white; padding: 8px 12px;")
        cookie_row.addWidget(self.refresh_btn)

        self.settings_btn = QPushButton("设置")
        self.settings_btn.clicked.connect(self.open_settings)
        self.settings_btn.setStyleSheet("background-color: #ff9800; color: white; padding: 8px 12px;")
        cookie_row.addWidget(self.settings_btn)

        auth_layout.addLayout(cookie_row)

        layout.addWidget(auth_group)

        # === 浏览器区域 ===
        browser_group = QGroupBox("2048 游戏")
        browser_layout = QVBoxLayout(browser_group)
        browser_layout.setContentsMargins(0, 10, 0, 0)

        self.browser = QWebEngineView()
        browser_layout.addWidget(self.browser)

        layout.addWidget(browser_group, 1)

        # === 状态栏 ===
        self.status_label = QLabel("就绪")
        self.status_label.setStyleSheet("color: #666; padding: 5px;")
        layout.addWidget(self.status_label)

    def setup_browser(self):
        """设置浏览器"""
        # 创建独立的 profile
        self.profile = QWebEngineProfile("2048_profile_v2", self.browser)
        self.cookie_store = self.profile.cookieStore()

        # 使用自定义页面
        self.page = GameWebPage(self.profile, self.browser)
        self.browser.setPage(self.page)

        # 页面加载完成后的处理
        self.browser.loadFinished.connect(self.on_page_loaded)

        # 加载游戏页面
        self.browser.setUrl(QUrl("https://2048.linux.do/"))
        self.status_label.setText("正在加载游戏页面...")

    def apply_cookies(self):
        """应用 Cookie 认证"""
        cookie_str = self.cookie_input.text().strip()
        if not cookie_str:
            QMessageBox.warning(self, "提示", "请输入 Cookie")
            return

        # 保存 Cookie
        save_cookie(cookie_str)

        self.cookie_store.deleteAllCookies()

        parent_domain_cookies = {
            'cf_clearance', 'linux_do_cdk_session_id', 'linux_do_credit_session_id',
            '__stripe_mid', '_ga', '_ga_1X49KS6K0M'
        }

        cookie_count = 0
        for part in cookie_str.split(';'):
            part = part.strip()
            if '=' in part:
                key, value = part.split('=', 1)
                key = key.strip()
                value = value.strip()

                cookie = QNetworkCookie(key.encode(), value.encode())
                cookie.setPath("/")

                if key in parent_domain_cookies:
                    cookie.setDomain(".linux.do")
                else:
                    cookie.setDomain("2048.linux.do")

                self.cookie_store.setCookie(cookie, QUrl("https://2048.linux.do/"))
                cookie_count += 1

        self.status_label.setText(f"已添加 {cookie_count} 个 Cookie，正在刷新页面...")
        QTimer.singleShot(500, self.refresh_page)

    def refresh_page(self):
        """刷新页面"""
        self.browser.reload()
        self.status_label.setText("正在刷新页面...")

    def on_page_loaded(self, ok):
        """页面加载完成"""
        if ok:
            self.status_label.setText("页面加载完成，正在注入 AI Bridge...")
            QTimer.singleShot(1000, self.inject_bridge)
        else:
            self.status_label.setText("页面加载失败")

    def inject_bridge(self):
        """注入 AI Bridge 脚本"""
        if not self.bridge_script_path.exists():
            QMessageBox.warning(self, "错误", f"找不到 AI Bridge 脚本:\n{self.bridge_script_path}")
            return

        try:
            # 读取 Bridge 脚本
            with open(self.bridge_script_path, 'r', encoding='utf-8') as f:
                bridge_script = f.read()

            # 注入 Bridge 脚本（不依赖 QWebChannel，直接用轮询方式通信）
            self.page.runJavaScript(bridge_script, self.on_bridge_injected)

        except Exception as e:
            QMessageBox.critical(self, "错误", f"注入脚本失败:\n{str(e)}")

    def on_bridge_injected(self, result):
        """Bridge 注入完成"""
        self.status_label.setText("AI Bridge 已注入，点击网页上的 Start AI 按钮开始")

        # 启动控制轮询
        self.control_timer.start(self.control_poll_interval)

        # 获取初始设置
        self.page.runJavaScript("window._aiBridge ? window._aiBridge.getAutoRestart() : false",
                                 lambda ar: self.on_auto_restart_changed(ar or False))

    def poll_controls(self):
        """轮询 JS 端的控制事件"""
        # 检测 Start 按钮点击
        self.page.runJavaScript("""
            (function() {
                var ctrl = window._aiControl || {};
                var result = {
                    startClicked: ctrl.startClicked || false,
                    autoRestartChanged: ctrl.autoRestartChanged
                };
                // 重置标志
                if (window._aiControl) {
                    window._aiControl.startClicked = false;
                    window._aiControl.autoRestartChanged = null;
                }
                return result;
            })()
        """, self.on_control_polled)

    def on_control_polled(self, result):
        """处理轮询结果"""
        if not result:
            return

        if result.get('startClicked'):
            self.toggle_ai()

        auto_restart = result.get('autoRestartChanged')
        if auto_restart is not None:
            self.on_auto_restart_changed(auto_restart)

    # =========================================================================
    # AI 控制
    # =========================================================================

    def toggle_ai(self):
        """切换 AI 开关"""
        if self.ai_running:
            self.stop_ai()
        else:
            self.start_ai()

    def start_ai(self):
        """启动 AI"""
        if self.ai_running:
            return

        self.ai_running = True
        self._step_active = False
        self.status_label.setText(f"AI 启动中，正在初始化...")

        # 更新 JS 端状态
        self.page.runJavaScript("window._aiBridge && window._aiBridge.setRunning(true)")

        # 初始化 AI 管理器
        self.ai_manager.initialize()

        self.status_label.setText("AI 运行中")

        # 启动第一步
        self._step_start()

    def stop_ai(self, reason="用户停止"):
        """停止 AI"""
        if not self.ai_running:
            return

        self.ai_running = False
        self._step_active = False
        self._ai_poll_timer.stop()
        self.status_label.setText(f"AI 已停止: {reason}")

        # 更新 JS 端状态
        self.page.runJavaScript("window._aiBridge && window._aiBridge.setRunning(false)")

    def on_auto_restart_changed(self, enabled):
        """自动续开关切换"""
        self.auto_restart = enabled

    # =========================================================================
    # 链式游戏循环：每一步完成后才触发下一步
    #   _step_start → _step_check_game_over → _step_read_board
    #   → _step_submit_ai → _step_poll_result → _step_execute_move
    #   → _step_wait_board_change → _step_start（循环）
    # =========================================================================

    def _step_start(self):
        """步骤1: 开始新一轮 - 检查游戏状态"""
        if not self.ai_running or self._step_active:
            return
        self._step_active = True

        self.page.runJavaScript(
            "window._aiBridge ? window._aiBridge.isGameOver() : false",
            self._step_check_game_over
        )

    def _step_check_game_over(self, is_game_over):
        """步骤2: 检查游戏是否结束"""
        if not self.ai_running:
            self._step_active = False
            return

        if is_game_over:
            self._step_active = False
            self.on_game_over()
            return

        # 继续：读取棋盘
        self.page.runJavaScript(
            "window._aiBridge ? window._aiBridge.getBoard() : null",
            self._step_read_board
        )

    def _step_read_board(self, board_json):
        """步骤3: 读取棋盘并提交 AI 计算"""
        if not self.ai_running or not board_json:
            self._step_active = False
            return

        try:
            board = json.loads(board_json)
            if not board:
                self._step_active = False
                return

            self._last_board = board
            self.ai_manager.submit_task(board)

            # 启动 AI 结果轮询
            self._ai_poll_timer.start()

        except Exception as e:
            print(f"[Main] 处理棋盘失败: {e}")
            self._step_active = False

    def _step_poll_result(self):
        """步骤4: 轮询 AI 计算结果"""
        if not self.ai_running:
            self._ai_poll_timer.stop()
            self._step_active = False
            return

        result = self.ai_manager.get_result()
        if not result:
            return  # 继续轮询

        # 收到结果，停止轮询
        self._ai_poll_timer.stop()

        move_name = result.get('move_name')
        if move_name is None:
            # 无有效移动（游戏可能结束）
            self._step_active = False
            self._step_start()
            return

        # 保存结果，进入验证步骤
        self._pending_result = result
        self._step_validate_move(move_name)

    def _step_validate_move(self, move_name):
        """步骤5: 重新读取棋盘验证移动是否有效"""
        self.page.runJavaScript(
            f"""(function() {{
                var b = window._aiBridge;
                if (!b) return null;
                var board = JSON.parse(b.getBoard());
                if (!board) return null;
                var copy = board.map(function(r) {{ return r.slice(); }});
                var moved = false;
                var dir = '{move_name}';
                function processLine(line) {{
                    var nz = line.filter(function(v) {{ return v !== 0; }});
                    var res = [], i = 0;
                    while (i < nz.length) {{
                        if (i < nz.length - 1 && nz[i] === nz[i+1]) {{
                            res.push(nz[i] * 2); i += 2;
                        }} else {{
                            res.push(nz[i]); i++;
                        }}
                    }}
                    while (res.length < 4) res.push(0);
                    return res;
                }}
                if (dir === 'up' || dir === 'down') {{
                    for (var c = 0; c < 4; c++) {{
                        var col = [copy[0][c], copy[1][c], copy[2][c], copy[3][c]];
                        if (dir === 'down') col.reverse();
                        var nr = processLine(col);
                        if (dir === 'down') nr.reverse();
                        for (var r = 0; r < 4; r++) {{
                            if (copy[r][c] !== nr[r]) moved = true;
                            copy[r][c] = nr[r];
                        }}
                    }}
                }} else {{
                    for (var r2 = 0; r2 < 4; r2++) {{
                        var row = copy[r2].slice();
                        if (dir === 'right') row.reverse();
                        var nr2 = processLine(row);
                        if (dir === 'right') nr2.reverse();
                        for (var c2 = 0; c2 < 4; c2++) {{
                            if (copy[r2][c2] !== nr2[c2]) moved = true;
                            copy[r2][c2] = nr2[c2];
                        }}
                    }}
                }}
                return {{valid: moved, board: board}};
            }})()""",
            self._step_on_validated
        )

    def _step_on_validated(self, result):
        """步骤5b: 验证结果处理"""
        if not self.ai_running or not self._pending_result:
            self._step_active = False
            return

        if not result or not result.get('valid'):
            # 无效移动，用最新棋盘重新计算
            print(f"[Main] 方向 {self._pending_result.get('move_name')} 无效，重新计算")
            self._pending_result = None
            current_board = result.get('board') if result else None
            if current_board:
                self._last_board = current_board
                self.ai_manager.submit_task(current_board)
                self._ai_poll_timer.start()
            else:
                self._step_active = False
                QTimer.singleShot(50, self._step_start)
            return

        # 更新 _last_board 为验证时的最新棋盘
        current_board = result.get('board')
        if current_board:
            self._last_board = current_board

        # 验证通过，执行移动
        self._step_execute_move()

    def _step_execute_move(self):
        """步骤6: 执行移动"""
        result = self._pending_result
        self._pending_result = None

        move_name = result.get('move_name')
        move_arrow = result.get('move_arrow', '-')
        depth = result.get('depth', 0)
        time_ms = result.get('time_ms', 0)

        # 更新显示
        prev_move = self.current_move_arrow
        self.current_move_arrow = move_arrow
        display_data = json.dumps({
            'current': move_arrow,
            'next': prev_move,
            'depth': depth,
            'time': time_ms
        })
        self.page.runJavaScript(f"window._aiBridge && window._aiBridge.updateDisplay('{display_data}')")

        # 执行移动
        self.page.runJavaScript(f"window._aiBridge && window._aiBridge.move('{move_name}')")

        # 更新状态栏
        self.status_label.setText(
            f"AI 运行中 | {move_arrow} | 深度:{depth} | 耗时:{time_ms:.0f}ms"
        )

        # 等待动画完成后检测棋盘变化
        self._board_check_count = 0
        QTimer.singleShot(80, self._step_wait_board_change)

    def _step_wait_board_change(self):
        """步骤7: 等待棋盘变化（确认移动已执行）"""
        if not self.ai_running:
            self._step_active = False
            return

        self._board_check_count += 1

        # 超时保护（最多等 1 秒）
        if self._board_check_count >= 15:
            self._step_active = False
            QTimer.singleShot(0, self._step_start)
            return

        # 读取当前棋盘
        self.page.runJavaScript(
            "window._aiBridge ? window._aiBridge.getBoard() : null",
            self._step_on_board_checked
        )

    def _step_on_board_checked(self, board_json):
        """步骤7b: 检查棋盘是否已变化"""
        if not self.ai_running:
            self._step_active = False
            return

        try:
            current_board = json.loads(board_json) if board_json else None
            if current_board and self._last_board:
                if current_board != self._last_board:
                    # 棋盘已变化 → 移动成功，开始下一轮
                    self._step_active = False
                    QTimer.singleShot(0, self._step_start)
                    return
        except:
            pass

        # 棋盘未变化，继续等待
        QTimer.singleShot(60, self._step_wait_board_change)

    def on_game_over(self):
        """游戏结束处理"""
        self.stop_ai("游戏结束")

        # 记录分数
        self.page.runJavaScript(
            "window._aiBridge ? [window._aiBridge.getScore(), window._aiBridge.getMaxTile()] : [0, 0]",
            self.on_score_received
        )

    def on_score_received(self, result):
        """收到分数"""
        if result:
            score, max_tile = result
            self.page.runJavaScript(
                f"window._aiBridge && window._aiBridge.recordScore({score}, {max_tile})"
            )
            self.status_label.setText(f"游戏结束 | 分数: {score} | 最大块: {max_tile}")

            # 飞书推送检测
            threshold = load_feishu_threshold()
            if score >= threshold:
                webhook_url = load_feishu_webhook()
                if webhook_url:
                    threading.Thread(
                        target=send_feishu_notification,
                        args=(webhook_url, score, max_tile, threshold),
                        daemon=True
                    ).start()
                    print(f"[飞书推送] 分数 {score} >= {threshold}，已触发推送")

            # 自动续
            if self.auto_restart:
                QTimer.singleShot(1500, self.auto_restart_game)

    def auto_restart_game(self):
        """自动重新开始游戏"""
        if not self.auto_restart:
            return

        self.page.runJavaScript(
            "window._aiBridge && window._aiBridge.clickRestartButton()",
            lambda success: QTimer.singleShot(500, self.start_ai) if success else None
        )

    def open_settings(self):
        """打开设置对话框"""
        dialog = SettingsDialog(self)
        dialog.exec_()

    def closeEvent(self, event):
        """窗口关闭"""
        self.control_timer.stop()
        self._ai_poll_timer.stop()
        self.ai_manager.shutdown()
        event.accept()


# =============================================================================
# 主入口
# =============================================================================

def main():
    QApplication.setAttribute(Qt.AA_EnableHighDpiScaling, True)
    QApplication.setAttribute(Qt.AA_UseHighDpiPixmaps, True)

    app = QApplication(sys.argv)
    app.setStyle('Fusion')

    app.setStyleSheet("""
        QMainWindow {
            background-color: #faf8ef;
        }
        QGroupBox {
            font-weight: bold;
            border: 2px solid #bbada0;
            border-radius: 8px;
            margin-top: 10px;
            padding-top: 10px;
            background-color: #faf8ef;
            color: #333333;
        }
        QGroupBox::title {
            subcontrol-origin: margin;
            left: 10px;
            padding: 0 5px;
            color: #333333;
        }
        QLabel {
            color: #333333;
            font-size: 14px;
        }
        QLineEdit {
            padding: 8px;
            border: 2px solid #bbada0;
            border-radius: 4px;
            background-color: white;
            color: #333333;
            font-size: 13px;
        }
        QPushButton {
            border: none;
            border-radius: 4px;
            font-weight: bold;
        }
        QPushButton:hover {
            opacity: 0.9;
        }
    """)

    window = MainWindow()
    window.show()

    sys.exit(app.exec_())


if __name__ == "__main__":
    main()
