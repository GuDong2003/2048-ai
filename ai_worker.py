#!/usr/bin/env python3
"""AI Worker - 独立进程运行，由 2048_client.py 通过 subprocess 启动"""
import sys
import json
import numpy as np
from ai_engine import AIEngine

print("[Worker] 正在初始化 AI 引擎...", file=sys.stderr, flush=True)
engine = AIEngine(parallel=False)
print("[Worker] 引擎就绪", file=sys.stderr, flush=True)
print("READY", flush=True)  # 通知主进程已就绪

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
        print(json.dumps(result), flush=True)
    except Exception as e:
        print(json.dumps({'error': str(e), 'move': None}), flush=True)
