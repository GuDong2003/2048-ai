# 2048 AI Client

基于 `PyQt5 + QWebEngine + C++ AI` 的 2048 桌面客户端。  
AI 核心来自 `nneonneo/2048-ai` 思路，当前通过 `ctypes` 调用本地动态库 `ai_bridge.dylib`。

参考项目: <https://github.com/nneonneo/2048-ai>

## 功能特性

- PyQt5 桌面端，内嵌网页直接运行 `https://2048.linux.do/`
- C++ 后端 AI（Expectimax + 启发式 + 置换表缓存）
- 前后端桥接：`ai_bridge.js`（网页 UI + JS API）与 Python 轮询通信
- 链式主循环：读盘、计算、校验、执行、等待变化，避免“乱步”
- 冲分模式（Score Rush）：终局自动暂停 + 二次 Start 进入冲分
- 冲分安全步：冲分阶段自动规避 `8192 + 8192 -> 16384` 的合并
- 自动续开、分数历史面板（可拖拽/折叠/清空）
- 飞书推送：分数达到阈值后通知
- 支持 PyInstaller 打包

## 当前架构

```text
2048_client.py (PyQt5 GUI)
  -> QWebEngine 加载 2048 页面
  -> 注入 ai_bridge.js
  -> 轮询 window._aiControl（Start/开关事件）
  -> AIManager 线程计算
  -> ai_engine.py (ctypes 封装)
  -> ai_bridge.dylib / ai_bridge.cpp (C++ AI)
```

说明：
- 当前主路径是“主进程 + 后台线程”异步计算，不是子进程 IPC 方案。
- `ai_worker.py` 仍保留，但不是当前默认运行路径。

## AI 运行流程（主循环）

`MainWindow` 采用链式步骤，单步完成后再进入下一步：

1. `_step_start`：检查是否可开始新一轮。
2. `_step_check_game_over`：检查游戏是否结束。
3. `_step_read_board`：读取棋盘，必要时触发终局暂停。
4. `_step_poll_result`：轮询 AI 结果（20ms 间隔）。
5. `_step_validate_move`：在 JS 侧复算该方向是否有效。
6. `_step_execute_move`：执行移动并更新面板显示。
7. `_step_wait_board_change`：等待动画/新砖块落地，确认棋盘变化。

这套流程用于降低网页动画与状态不同步导致的误操作。

## 冲分模式（Score Rush）

默认开启，行为分两阶段：

1. 终局预暂停阶段  
   当棋盘同时包含 `{32, 64, 128, 256, 512, 1024, 2048, 4096, 8192}` 时，AI 自动暂停，并提示再次 `Start`。

2. 冲分阶段（二次 Start 后）  
   对 AI 推荐步做“安全步筛选”：
   - 如果推荐步不会新增 `16384`，直接使用。
   - 如果会新增 `16384`，改走安全候选中启发式分数最高的方向。
   - 如果不存在安全步，自动暂停，等待手动接管。

前后端兼容：
- JS 存储键已迁移为 `ScoreRush`，同时兼容旧 `ManualMerge` 键。
- 控制字段优先 `scoreRushChanged`，兼容旧 `manualMergeChanged`。

## 安装

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install PyQt5 PyQtWebEngine numpy
```

## 运行

```bash
python3 2048_client.py
```

使用步骤：
1. 填写 Cookie 并点击“应用”。
2. 等待页面注入 bridge 完成。
3. 在网页右上角点击 `Start AI`。
4. 按需切换 `自动续`、`冲分暂停`。
5. 在“设置”中配置飞书 Webhook 与推送阈值（可选）。

## 打包（macOS）

```bash
pip install pyinstaller
pyinstaller --clean 2048_ai.spec
```

输出：`dist/2048 AI.app`

## 动态库编译（缺失时）

如果启动时提示找不到 `ai_bridge` 动态库，可在项目根目录编译：

```bash
c++ -std=c++17 -O3 -Wall -fPIC -shared -fvisibility=hidden -o ai_bridge.dylib ai_bridge.cpp
```

`ai_engine.py` 会按平台自动尝试加载 `ai_bridge.{dylib|so|dll}`。

## 主要文件

| 文件 | 说明 |
|------|------|
| `2048_client.py` | PyQt5 主程序、UI、主循环、冲分逻辑 |
| `ai_bridge.js` | 网页侧桥接/UI 控件/状态持久化 |
| `ai_engine.py` | Python 对 C++ AI 的 ctypes 封装 |
| `ai_bridge.cpp` | C++ AI 核心与导出 C API |
| `ai_bridge.dylib` | 已编译动态库（macOS） |
| `ai_worker.py` | 历史/备用 Worker 脚本（当前默认未使用） |
| `2048_ai.spec` | PyInstaller 打包配置 |

## 运行时配置文件

以下文件由程序自动生成（通常不提交）：

- `.cookie_cache`：Cookie 缓存
- `.feishu_webhook`：飞书 Webhook URL
- `.feishu_threshold`：飞书推送分数阈值
