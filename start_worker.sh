#!/bin/bash
# AI Worker 启动脚本 - 确保干净的 Numba 环境

# 设置 Numba 必需的环境变量
export NUMBA_NUM_THREADS=1
export NUMBA_THREADING_LAYER=workqueue

# 清除可能干扰的变量
unset NUMBA_CACHE_DIR
unset NUMBA_DEBUG_CACHE

# 获取脚本所在目录
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# 执行 Python worker
exec "$SCRIPT_DIR/.venv/bin/python3" "$SCRIPT_DIR/ai_worker.py"
