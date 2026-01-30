# 2048 AI Client

基于 Python + Numba JIT 加速的 2048 AI 桌面客户端。

## 功能特性

- **PyQt5 桌面客户端** - 内嵌浏览器运行 2048 游戏
- **Numba JIT 加速** - AI 引擎使用 Numba 编译，计算速度快
- **Expectimax 算法** - 带记忆化的期望最大搜索
- **动态深度** - 根据局面自动调整搜索深度 (5-9)
- **飞书推送** - 分数突破阈值时自动发送通知
- **分数记录** - 可折叠/拖动的历史分数面板
- **自动续玩** - 游戏结束后自动重新开始

## 安装

```bash
# 创建虚拟环境
python3 -m venv .venv
source .venv/bin/activate

# 安装依赖
pip install PyQt5 PyQtWebEngine numpy numba
```

## 使用

```bash
# 启动客户端
NUMBA_NUM_THREADS=1 NUMBA_THREADING_LAYER=workqueue python3 2048_client.py
```

1. 输入 Cookie 并点击「应用」进行认证
2. 点击网页上的「Start AI」按钮启动 AI
3. 点击「设置」配置飞书推送（可选）

## 文件说明

| 文件 | 说明 |
|------|------|
| `2048_client.py` | PyQt5 主程序，管理 UI 和 AI 子进程 |
| `ai_engine.py` | AI 引擎核心，Numba JIT 加速的 Expectimax |
| `ai_worker.py` | AI 子进程，避免阻塞 UI |
| `ai_bridge.js` | JS 桥接脚本，网页端 UI 和通信 |
| `2048.js` | 原版 JS AI（油猴脚本，参考用） |

## AI 算法

- **搜索算法**: Expectimax（期望最大搜索）
- **深度范围**: 5-9（动态调整）
  - 早期 (max < 512): 深度 5
  - 中期 (512-2048): 深度 5-6
  - 后期 (≥ 2048): 深度 5-9
- **启发式评估**:
  - 蛇形权重矩阵
  - 空格奖励
  - 合并机会奖励
  - 平滑度/单调性惩罚
  - 角落王座奖励
  - 逃生路线惩罚

## 配置文件

运行时自动生成（已在 .gitignore 中忽略）：

- `.cookie_cache` - 保存的 Cookie
- `.feishu_webhook` - 飞书 Webhook URL
- `.feishu_threshold` - 飞书推送分数阈值
