#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
2048 AI Engine - C++ Backend via ctypes
Based on nneonneo/2048-ai, provides ~1000x faster execution than pure Python
"""

import ctypes
import os
import time
import numpy as np

# ============================================================================
# Load C++ library
# ============================================================================

_lib = None
_lib_path = None

def _find_library():
    """Find the ai_bridge shared library"""
    base_dir = os.path.dirname(os.path.abspath(__file__))

    # Try different suffixes based on platform
    suffixes = ['dylib', 'so', 'dll']

    # 优先使用 ai_bridge (无打印语句，适合 IPC)
    for suffix in suffixes:
        path = os.path.join(base_dir, f'ai_bridge.{suffix}')
        if os.path.isfile(path):
            return path, 'bridge'

    # 备选：原版库 (有打印语句，需要重定向)
    orig_paths = [
        os.path.join(base_dir, '参考', '2048-ai', 'bin', '2048.so'),
        os.path.join(base_dir, '参考', '2048-ai', 'bin', '2048.dylib'),
    ]
    for path in orig_paths:
        if os.path.isfile(path):
            return path, 'original'

    return None, None


def _load_library():
    """Load the C++ library"""
    global _lib, _lib_path, _lib_type

    if _lib is not None:
        return _lib

    _lib_path, _lib_type = _find_library()
    if _lib_path is None:
        raise RuntimeError(
            "Cannot find ai_bridge library. "
            "Please compile it first:\n"
            "  c++ -std=c++17 -O3 -Wall -fPIC -shared -fvisibility=hidden "
            "-o ai_bridge.dylib ai_bridge.cpp"
        )

    _lib = ctypes.CDLL(_lib_path)

    if _lib_type == 'original':
        # 原版库函数签名
        _lib.init_tables.argtypes = []
        _lib.init_tables.restype = None

        _lib.find_best_move.argtypes = [ctypes.c_uint64]
        _lib.find_best_move.restype = ctypes.c_int

        _lib.execute_move.argtypes = [ctypes.c_int, ctypes.c_uint64]
        _lib.execute_move.restype = ctypes.c_uint64

        # 初始化表
        _lib.init_tables()
    else:
        # ai_bridge 库函数签名
        _lib.ai_init.argtypes = []
        _lib.ai_init.restype = None

        _lib.ai_find_best_move.argtypes = [ctypes.c_uint64]
        _lib.ai_find_best_move.restype = ctypes.c_int

        _lib.ai_find_best_move_ex.argtypes = [
            ctypes.c_uint64,
            ctypes.POINTER(ctypes.c_int),      # out_depth
            ctypes.POINTER(ctypes.c_ulong),    # out_evals
            ctypes.POINTER(ctypes.c_int),      # out_cachehits
            ctypes.POINTER(ctypes.c_int),      # out_maxdepth
        ]
        _lib.ai_find_best_move_ex.restype = ctypes.c_int

        _lib.ai_execute_move.argtypes = [ctypes.c_int, ctypes.c_uint64]
        _lib.ai_execute_move.restype = ctypes.c_uint64

        _lib.ai_score_board.argtypes = [ctypes.c_uint64]
        _lib.ai_score_board.restype = ctypes.c_float

        _lib.ai_score_heur_board.argtypes = [ctypes.c_uint64]
        _lib.ai_score_heur_board.restype = ctypes.c_float

        _lib.ai_get_max_rank.argtypes = [ctypes.c_uint64]
        _lib.ai_get_max_rank.restype = ctypes.c_int

        _lib.ai_count_empty.argtypes = [ctypes.c_uint64]
        _lib.ai_count_empty.restype = ctypes.c_int

        # 初始化表
        _lib.ai_init()

    return _lib


# Library type
_lib_type = None


# Load on module import
_load_library()


# ============================================================================
# Direction names
# ============================================================================

DIRECTION_NAMES = ['up', 'down', 'left', 'right']
DIRECTION_ARROWS = ['↑', '↓', '←', '→']


# ============================================================================
# Board conversion functions
# ============================================================================

def board_to_int(grid):
    """
    Convert 4x4 grid (values like 2, 4, 8...) to 64-bit integer (nibble ranks)

    Args:
        grid: 4x4 array or list with actual tile values (0, 2, 4, 8, ...)

    Returns:
        64-bit integer where each nibble is log2(value), 0 for empty
    """
    board = 0
    for i in range(4):
        for j in range(4):
            val = grid[i][j]
            if val > 0:
                # Calculate rank: 2->1, 4->2, 8->3, etc.
                rank = 0
                while (1 << rank) < val:
                    rank += 1
                board |= rank << (4 * (i * 4 + j))
    return board


def int_to_board(board):
    """
    Convert 64-bit integer to 4x4 grid

    Args:
        board: 64-bit integer representation

    Returns:
        4x4 list with actual tile values
    """
    grid = [[0] * 4 for _ in range(4)]
    for i in range(4):
        for j in range(4):
            rank = (board >> (4 * (i * 4 + j))) & 0xF
            grid[i][j] = (1 << rank) if rank > 0 else 0
    return grid


# ============================================================================
# AI Engine class
# ============================================================================

class AIEngine:
    """
    AI Engine wrapper class

    Uses C++ backend for maximum performance.
    The `parallel` and `workers` parameters are kept for API compatibility
    but are ignored (C++ backend is single-threaded but extremely fast).
    """

    def __init__(self, parallel=True, workers=4):
        """
        Initialize AI Engine

        Args:
            parallel: Ignored (kept for API compatibility)
            workers: Ignored (kept for API compatibility)
        """
        self._lib = _lib
        self._lib_type = _lib_type

    def get_best_move(self, grid):
        """
        Calculate the best move

        Args:
            grid: 4x4 array or list with tile values

        Returns:
            dict: {
                'move': int (0-3) or None,
                'move_name': str,
                'move_arrow': str,
                'depth': int,
                'time_ms': float,
                'moves_evaled': int,
                'cachehits': int
            }
        """
        start_time = time.perf_counter()

        if isinstance(grid, np.ndarray):
            grid = grid.tolist()

        board = board_to_int(grid)

        if self._lib_type == 'original':
            # 原版库：需要重定向 stdout
            import os
            devnull = os.open(os.devnull, os.O_WRONLY)
            old_stdout = os.dup(1)
            os.dup2(devnull, 1)

            best_move = self._lib.find_best_move(ctypes.c_uint64(board))

            os.dup2(old_stdout, 1)
            os.close(devnull)
            os.close(old_stdout)

            elapsed_ms = (time.perf_counter() - start_time) * 1000

            # 原版库不返回详细统计
            if best_move == -1:
                return {
                    'move': None,
                    'move_name': None,
                    'move_arrow': None,
                    'depth': 0,
                    'time_ms': elapsed_ms,
                    'moves_evaled': 0,
                    'cachehits': 0
                }

            return {
                'move': best_move,
                'move_name': DIRECTION_NAMES[best_move],
                'move_arrow': DIRECTION_ARROWS[best_move],
                'depth': 0,
                'time_ms': elapsed_ms,
                'moves_evaled': 0,
                'cachehits': 0
            }
        else:
            # ai_bridge 库：有详细统计
            out_depth = ctypes.c_int()
            out_evals = ctypes.c_ulong()
            out_cachehits = ctypes.c_int()
            out_maxdepth = ctypes.c_int()

            best_move = self._lib.ai_find_best_move_ex(
                ctypes.c_uint64(board),
                ctypes.byref(out_depth),
                ctypes.byref(out_evals),
                ctypes.byref(out_cachehits),
                ctypes.byref(out_maxdepth)
            )

            elapsed_ms = (time.perf_counter() - start_time) * 1000

            if best_move == -1:
                return {
                    'move': None,
                    'move_name': None,
                    'move_arrow': None,
                    'depth': out_depth.value,
                    'time_ms': elapsed_ms,
                    'moves_evaled': out_evals.value,
                    'cachehits': out_cachehits.value
                }

            return {
                'move': best_move,
                'move_name': DIRECTION_NAMES[best_move],
                'move_arrow': DIRECTION_ARROWS[best_move],
                'depth': out_depth.value,
                'time_ms': elapsed_ms,
                'moves_evaled': out_evals.value,
                'cachehits': out_cachehits.value
            }


# ============================================================================
# Standalone functions (for direct access)
# ============================================================================

def find_best_move(board_int):
    """
    Find best move for a board (64-bit int representation)

    Args:
        board_int: 64-bit integer board representation

    Returns:
        int: Best move (0-3) or -1 if no valid move
    """
    return _lib.ai_find_best_move(ctypes.c_uint64(board_int))


def execute_move(move, board_int):
    """
    Execute a move on the board

    Args:
        move: Move direction (0=up, 1=down, 2=left, 3=right)
        board_int: 64-bit integer board representation

    Returns:
        int: New board state after move
    """
    return _lib.ai_execute_move(move, ctypes.c_uint64(board_int))


def score_board(board_int):
    """
    Calculate actual game score for a board

    Args:
        board_int: 64-bit integer board representation

    Returns:
        float: Score
    """
    return _lib.ai_score_board(ctypes.c_uint64(board_int))


def score_heur_board(board_int):
    """
    Calculate heuristic score for a board

    Args:
        board_int: 64-bit integer board representation

    Returns:
        float: Heuristic score
    """
    return _lib.ai_score_heur_board(ctypes.c_uint64(board_int))


def get_max_rank(board_int):
    """
    Get the maximum tile rank on the board

    Args:
        board_int: 64-bit integer board representation

    Returns:
        int: Max rank (e.g., 11 for 2048)
    """
    return _lib.ai_get_max_rank(ctypes.c_uint64(board_int))


def count_empty(board_int):
    """
    Count empty cells on the board

    Args:
        board_int: 64-bit integer board representation

    Returns:
        int: Number of empty cells
    """
    return _lib.ai_count_empty(ctypes.c_uint64(board_int))


# ============================================================================
# Test
# ============================================================================

if __name__ == '__main__':
    print("2048 AI Engine (C++ Backend)")
    print("=" * 60)
    print(f"Library: {_lib_path}")
    print()

    test_cases = [
        {
            'name': '早期',
            'board': [
                [2, 4, 8, 16],
                [0, 2, 4, 8],
                [0, 0, 2, 4],
                [0, 0, 0, 2]
            ]
        },
        {
            'name': '中期',
            'board': [
                [256, 128, 64, 32],
                [16, 8, 4, 2],
                [2, 4, 8, 16],
                [0, 0, 0, 0]
            ]
        },
        {
            'name': '后期',
            'board': [
                [2048, 1024, 512, 256],
                [128, 64, 32, 16],
                [8, 4, 2, 4],
                [2, 0, 0, 0]
            ]
        },
        {
            'name': '危险',
            'board': [
                [4096, 2048, 1024, 512],
                [256, 128, 64, 32],
                [16, 8, 4, 2],
                [2, 0, 0, 0]
            ]
        }
    ]

    engine = AIEngine()

    for tc in test_cases:
        result = engine.get_best_move(tc['board'])
        print(f"  {tc['name']}: {result['move_arrow']} "
              f"depth={result['depth']} "
              f"time={result['time_ms']:.1f}ms "
              f"evals={result['moves_evaled']} "
              f"hits={result['cachehits']}")

    print()
    print("性能测试...")

    # Benchmark: repeated calls
    test_board = [
        [2048, 1024, 512, 256],
        [128, 64, 32, 16],
        [8, 4, 2, 4],
        [2, 0, 0, 0]
    ]

    iterations = 100
    start = time.perf_counter()
    for _ in range(iterations):
        engine.get_best_move(test_board)
    elapsed = time.perf_counter() - start

    print(f"  {iterations} iterations in {elapsed*1000:.1f}ms")
    print(f"  Average: {elapsed*1000/iterations:.2f}ms per move")
    print(f"  Speed: {iterations/elapsed:.1f} moves/s")
