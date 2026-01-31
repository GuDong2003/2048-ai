#!/usr/bin/env python3
"""AI Worker - 独立进程运行，由 2048_client.py 通过 subprocess 启动"""
import sys
import json
import numpy as np
from pathlib import Path
from ai_engine import AIEngine

# 调试日志文件
log_file = Path(__file__).parent / "ai_debug.log"
debug_fp = open(log_file, 'w')

def debug(msg):
    print(msg, file=debug_fp, flush=True)
    print(msg, file=sys.stderr, flush=True)

debug("[Worker] 正在初始化 AI 引擎...")
engine = AIEngine(parallel=False)
debug("[Worker] 引擎就绪")
print("READY", flush=True)  # 通知主进程已就绪

move_count = 0

# 循环处理请求
for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    try:
        req = json.loads(line)
        board = req['board']

        grid = np.array(board, dtype=np.int32)
        result = engine.get_best_move(grid)

        move_count += 1
        max_tile = max(max(row) for row in board)

        # 记录每步到日志文件
        debug(f"#{move_count} board={board} max={max_tile} -> {result.get('move_name')} depth={result.get('depth')} time={result.get('time_ms'):.1f}ms")

        print(json.dumps(result), flush=True)
    except Exception as e:
        debug(f"ERROR: {e}")
        print(json.dumps({'error': str(e), 'move': None}), flush=True)
