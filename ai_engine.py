#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
2048 AI Engine - Numba JIT 加速版
Expectimax 算法 + 动态深度 + 概率采样
"""

import numpy as np
from numba import njit, prange
from numba.typed import List as NumbaList
import time

# ============================================================================
# 配置
# ============================================================================

# 深度配置
BASE_DEPTH = 5
MAX_DEPTH = 9

# 启发式权重（与 JS 版一致）
THRONE_REWARD = 1e10
GAME_OVER_PENALTY = -1e12
ESCAPE_ROUTE_PENALTY = 1e8
SNAKE_PATTERN_REWARD = 800.0
EMPTY_CELLS_REWARD = 350.0
POTENTIAL_MERGE_REWARD = 12.0
SMOOTHNESS_PENALTY = 20.0
MONOTONICITY_PENALTY = 60.0

# 蛇形权重矩阵 (左上角最大块最优)
SNAKE_WEIGHTS = np.array([
    [15, 14, 13, 12],
    [8,  9,  10, 11],
    [7,  6,  5,  4],
    [0,  1,  2,  3]
], dtype=np.int32)

# 预计算 4^weight
SNAKE_MATRIX = np.power(4.0, SNAKE_WEIGHTS).astype(np.float64)

# 方向映射: 0=上, 1=右, 2=下, 3=左
DIRECTION_NAMES = ['up', 'right', 'down', 'left']
DIRECTION_ARROWS = ['↑', '→', '↓', '←']


# ============================================================================
# Numba JIT 加速的核心函数
# ============================================================================

@njit(cache=False)
def process_line(line):
    """处理一行的移动和合并，返回 (新行, 得分)"""
    # 提取非零元素
    non_zero = line[line != 0]
    n = len(non_zero)
    result = np.zeros(4, dtype=np.int32)
    score = 0

    i = 0
    j = 0
    while i < n:
        if i < n - 1 and non_zero[i] == non_zero[i + 1]:
            merged = non_zero[i] * 2
            result[j] = merged
            score += merged
            i += 2
        else:
            result[j] = non_zero[i]
            i += 1
        j += 1

    return result, score


@njit(cache=False)
def swipe(grid, direction):
    """
    执行移动操作
    direction: 0=上, 1=右, 2=下, 3=左
    返回: (new_grid, score, moved)
    """
    new_grid = grid.copy()
    total_score = 0

    # 根据方向处理
    if direction == 0:  # 上
        for c in range(4):
            col = new_grid[:, c].copy()
            new_col, score = process_line(col)
            new_grid[:, c] = new_col
            total_score += score
    elif direction == 1:  # 右
        for r in range(4):
            row = new_grid[r, ::-1].copy()
            new_row, score = process_line(row)
            new_grid[r, :] = new_row[::-1]
            total_score += score
    elif direction == 2:  # 下
        for c in range(4):
            col = new_grid[::-1, c].copy()
            new_col, score = process_line(col)
            new_grid[:, c] = new_col[::-1]
            total_score += score
    elif direction == 3:  # 左
        for r in range(4):
            row = new_grid[r, :].copy()
            new_row, score = process_line(row)
            new_grid[r, :] = new_row
            total_score += score

    # 检查是否有移动
    moved = not np.array_equal(grid, new_grid)

    return new_grid, total_score, moved


@njit(cache=False)
def get_empty_cells(grid):
    """获取空格位置，返回 (row_indices, col_indices)"""
    rows = []
    cols = []
    for r in range(4):
        for c in range(4):
            if grid[r, c] == 0:
                rows.append(r)
                cols.append(c)
    return np.array(rows, dtype=np.int32), np.array(cols, dtype=np.int32)


@njit(cache=False)
def count_empty(grid):
    """计算空格数量"""
    count = 0
    for r in range(4):
        for c in range(4):
            if grid[r, c] == 0:
                count += 1
    return count


@njit(cache=False)
def is_game_over(grid):
    """检查游戏是否结束"""
    # 有空格就没结束
    if count_empty(grid) > 0:
        return False

    # 检查是否有相邻相同的
    for r in range(4):
        for c in range(4):
            val = grid[r, c]
            if c + 1 < 4 and val == grid[r, c + 1]:
                return False
            if r + 1 < 4 and val == grid[r + 1, c]:
                return False

    return True


@njit(cache=False)
def get_max_tile(grid):
    """获取最大块的值和位置"""
    max_val = 0
    max_r, max_c = 0, 0
    for r in range(4):
        for c in range(4):
            if grid[r, c] > max_val:
                max_val = grid[r, c]
                max_r, max_c = r, c
    return max_val, max_r, max_c


@njit(cache=False)
def transform_grid(grid, corner_r, corner_c):
    """将棋盘变换为目标角落在左上角的形式"""
    result = grid.copy()

    if corner_r == 0 and corner_c == 3:
        # 右上角 -> 水平翻转
        for r in range(4):
            result[r, :] = grid[r, ::-1]
    elif corner_r == 3 and corner_c == 0:
        # 左下角 -> 垂直翻转
        result = grid[::-1, :].copy()
    elif corner_r == 3 and corner_c == 3:
        # 右下角 -> 180度旋转
        result = grid[::-1, ::-1].copy()

    return result


@njit(cache=False)
def log2_safe(val):
    """安全的 log2 计算"""
    if val <= 0:
        return 0.0
    return np.log2(float(val))


@njit(cache=False)
def calculate_heuristic(grid):
    """计算启发式评估值"""
    if is_game_over(grid):
        return GAME_OVER_PENALTY

    # 找最大块位置
    max_val, max_r, max_c = get_max_tile(grid)

    # 检查是否在角落
    is_cornered = (max_r == 0 or max_r == 3) and (max_c == 0 or max_c == 3)

    if is_cornered:
        # 变换到左上角
        transformed = transform_grid(grid, max_r, max_c)
        return calculate_static_heuristic(transformed)
    else:
        # 尝试所有角落，取最大值
        max_score = -1e15
        for cr in (0, 3):
            for cc in (0, 3):
                transformed = transform_grid(grid, cr, cc)
                score = calculate_static_heuristic(transformed)
                if score > max_score:
                    max_score = score
        return max_score


@njit(cache=False)
def calculate_static_heuristic(grid):
    """计算静态启发式值（假设最大块在左上角）"""
    score = 0.0
    empty_cells = 0
    merge_opportunities = 0
    mono_penalty = 0.0
    smooth_penalty = 0.0
    snake_score = 0.0

    for r in range(4):
        for c in range(4):
            tile = grid[r, c]

            if tile == 0:
                empty_cells += 1
                continue

            # 蛇形权重
            snake_score += tile * SNAKE_MATRIX[r, c]

            log_val = log2_safe(tile)

            # 水平相邻
            if c + 1 < 4:
                right = grid[r, c + 1]
                if right > 0:
                    smooth_penalty += abs(log_val - log2_safe(right))
                    if tile == right:
                        merge_opportunities += 1
                    if tile < right:
                        mono_penalty += log2_safe(right) - log_val

            # 垂直相邻
            if r + 1 < 4:
                down = grid[r + 1, c]
                if down > 0:
                    smooth_penalty += abs(log_val - log2_safe(down))
                    if tile == down:
                        merge_opportunities += 1
                    if tile < down:
                        mono_penalty += log2_safe(down) - log_val

    # 王座奖励：最大块在左上角
    if grid[0, 0] == get_max_tile(grid)[0]:
        score += THRONE_REWARD
    else:
        score -= THRONE_REWARD

    # 逃生路线惩罚：上和左都不能动
    can_up = swipe(grid, 0)[2]
    can_left = swipe(grid, 3)[2]
    if not can_up and not can_left:
        score -= ESCAPE_ROUTE_PENALTY

    # 综合评分
    score += empty_cells * EMPTY_CELLS_REWARD
    score += merge_opportunities * POTENTIAL_MERGE_REWARD
    score += snake_score * SNAKE_PATTERN_REWARD
    score -= mono_penalty * MONOTONICITY_PENALTY
    score -= smooth_penalty * SMOOTHNESS_PENALTY

    return score


@njit(cache=False)
def get_dynamic_depth(empty_count, max_tile, base_depth, max_depth):
    """
    根据空格数量和最大块大小动态调整搜索深度
    base_depth=5, max_depth=9, 范围 5-9
    """
    # 阶段1: 早期（max_tile < 512）- 快速决策
    if max_tile < 512:
        return base_depth  # 固定 5

    # 阶段2: 中期（512 <= max_tile < 2048）- 适度谨慎
    elif max_tile < 2048:
        if empty_count <= 2:
            return base_depth + 1  # 6
        elif empty_count <= 4:
            return base_depth + 1  # 6
        else:
            return base_depth  # 5

    # 阶段3: 后期（max_tile >= 2048）- 全力搜索
    else:
        if empty_count <= 2:
            return max_depth      # 9
        elif empty_count <= 3:
            return max_depth - 1  # 8
        elif empty_count <= 5:
            return base_depth + 2  # 7
        elif empty_count <= 8:
            return base_depth + 1  # 6
        else:
            return base_depth  # 5


@njit(cache=False)
def expectimax_core(grid, depth, is_max_node):
    """
    Expectimax 核心计算（无记忆化，供 Python 包装器调用）
    返回: (score, best_move, should_cache, child_states)
    child_states: 用于记忆化的子状态列表
    """
    if depth == 0 or is_game_over(grid):
        return calculate_heuristic(grid), -1

    if is_max_node:
        max_score = -1e15
        best_move = -1

        for direction in range(4):
            new_grid, move_score, moved = swipe(grid, direction)
            if not moved:
                continue

            # 返回子状态让 Python 层处理记忆化
            child_score = calculate_heuristic(new_grid)  # 临时用启发式值
            total_score = child_score + move_score

            if total_score > max_score:
                max_score = total_score
                best_move = direction

        if best_move == -1:
            return calculate_heuristic(grid), -1

        return max_score, best_move

    else:
        empty_r, empty_c = get_empty_cells(grid)
        n_empty = len(empty_r)

        if n_empty == 0:
            return calculate_heuristic(grid), -1

        return 0.0, -1  # 期望节点由 Python 层处理


def grid_to_key(grid):
    """将 grid 转换为可哈希的 key"""
    return tuple(grid.flatten())


def expectimax_memo(grid, depth, is_max_node, memo):
    """
    带记忆化的 Expectimax 搜索（Python 函数）
    """
    if depth == 0 or is_game_over(grid):
        return calculate_heuristic(grid), -1

    # 检查缓存
    key = (grid_to_key(grid), depth, is_max_node)
    if key in memo:
        return memo[key]

    if is_max_node:
        max_score = -1e15
        best_move = -1

        for direction in range(4):
            new_grid, move_score, moved = swipe(grid, direction)
            if not moved:
                continue

            child_score, _ = expectimax_memo(new_grid, depth - 1, False, memo)
            total_score = child_score + move_score

            if total_score > max_score:
                max_score = total_score
                best_move = direction

        if best_move == -1:
            result = (calculate_heuristic(grid), -1)
        else:
            result = (max_score, best_move)

    else:
        # 期望节点：遍历所有空格
        empty_r, empty_c = get_empty_cells(grid)
        n_empty = len(empty_r)

        if n_empty == 0:
            result = (calculate_heuristic(grid), -1)
        else:
            total_score = 0.0
            for i in range(n_empty):
                r, c = empty_r[i], empty_c[i]

                # 放 2 (90% 概率)
                grid_2 = grid.copy()
                grid_2[r, c] = 2
                score_2, _ = expectimax_memo(grid_2, depth - 1, True, memo)

                # 放 4 (10% 概率)
                grid_4 = grid.copy()
                grid_4[r, c] = 4
                score_4, _ = expectimax_memo(grid_4, depth - 1, True, memo)

                total_score += 0.9 * score_2 + 0.1 * score_4

            result = (total_score / n_empty, -1)

    memo[key] = result
    return result


@njit(cache=False)
def expectimax(grid, depth, is_max_node, base_depth, max_depth):
    """
    Expectimax 搜索
    返回: (score, best_move)  best_move 只在顶层 max 节点有效
    """
    if depth == 0 or is_game_over(grid):
        return calculate_heuristic(grid), -1

    if is_max_node:
        # 最大化节点：选择最优方向
        max_score = -1e15
        best_move = -1

        for direction in range(4):
            new_grid, move_score, moved = swipe(grid, direction)
            if not moved:
                continue

            child_score, _ = expectimax(new_grid, depth - 1, False, base_depth, max_depth)
            total_score = child_score + move_score

            if total_score > max_score:
                max_score = total_score
                best_move = direction

        if best_move == -1:
            return calculate_heuristic(grid), -1

        return max_score, best_move

    else:
        # 期望节点：对所有可能的随机块取期望
        empty_r, empty_c = get_empty_cells(grid)
        n_empty = len(empty_r)

        if n_empty == 0:
            return calculate_heuristic(grid), -1

        total_score = 0.0
        for i in range(n_empty):
            r, c = empty_r[i], empty_c[i]

            # 放 2 (90% 概率)
            grid_2 = grid.copy()
            grid_2[r, c] = 2
            score_2, _ = expectimax(grid_2, depth - 1, True, base_depth, max_depth)

            # 放 4 (10% 概率)
            grid_4 = grid.copy()
            grid_4[r, c] = 4
            score_4, _ = expectimax(grid_4, depth - 1, True, base_depth, max_depth)

            total_score += 0.9 * score_2 + 0.1 * score_4

        return total_score / n_empty, -1


# ============================================================================
# 公开 API
# ============================================================================

class AIEngine:
    """AI 引擎封装类"""

    def __init__(self):
        self.base_depth = BASE_DEPTH
        self.max_depth = MAX_DEPTH
        self._warmup()

    def _warmup(self):
        """预热 Numba JIT 编译"""
        dummy_grid = np.array([
            [2, 4, 2, 4],
            [4, 2, 4, 2],
            [2, 4, 2, 4],
            [4, 2, 4, 2]
        ], dtype=np.int32)
        # 触发编译
        self.get_best_move(dummy_grid)

    def get_best_move(self, grid):
        """
        计算最优移动

        Args:
            grid: 4x4 numpy 数组或列表

        Returns:
            dict: {
                'move': int (0-3) 或 None,
                'move_name': str ('up'/'right'/'down'/'left') 或 None,
                'move_arrow': str ('↑'/'→'/'↓'/'←') 或 None,
                'depth': int,
                'time_ms': float
            }
        """
        # 确保是 numpy 数组
        if not isinstance(grid, np.ndarray):
            grid = np.array(grid, dtype=np.int32)
        else:
            grid = grid.astype(np.int32)

        start_time = time.perf_counter()

        # 动态深度（考虑最大块和空格数）
        empty_count = count_empty(grid)
        max_tile = get_max_tile(grid)[0]
        depth = get_dynamic_depth(empty_count, max_tile, self.base_depth, self.max_depth)

        # Expectimax 搜索（带记忆化）
        memo = {}
        _, best_move = expectimax_memo(grid, depth, True, memo)

        elapsed_ms = (time.perf_counter() - start_time) * 1000

        if best_move == -1:
            return {
                'move': None,
                'move_name': None,
                'move_arrow': None,
                'depth': depth,
                'time_ms': elapsed_ms
            }

        return {
            'move': best_move,
            'move_name': DIRECTION_NAMES[best_move],
            'move_arrow': DIRECTION_ARROWS[best_move],
            'depth': depth,
            'time_ms': elapsed_ms
        }


# ============================================================================
# 进程池 Worker 函数（供 multiprocessing 使用）
# ============================================================================

_ai_engine = None

def worker_init():
    """进程池 worker 初始化"""
    global _ai_engine
    import os
    _ai_engine = AIEngine()
    print(f"[AI Process {os.getpid()}] 引擎已初始化")


def worker_compute(board_list):
    """在独立进程中计算最优移动"""
    global _ai_engine
    grid = np.array(board_list, dtype=np.int32)
    result = _ai_engine.get_best_move(grid)
    return result


# ============================================================================
# 测试
# ============================================================================

if __name__ == '__main__':
    print("正在预热 Numba JIT...")
    engine = AIEngine()
    print(f"预热完成，base_depth={BASE_DEPTH}, max_depth={MAX_DEPTH}")

    # 测试棋盘
    test_grid = np.array([
        [2, 4, 8, 16],
        [0, 2, 4, 8],
        [0, 0, 2, 4],
        [0, 0, 0, 2]
    ], dtype=np.int32)

    print("\n测试棋盘:")
    print(test_grid)

    # 测试多次计算
    print("\n连续计算 10 次:")
    for i in range(10):
        result = engine.get_best_move(test_grid)
        print(f"  {i+1}: {result['move_arrow']} {result['move_name']}, "
              f"depth={result['depth']}, time={result['time_ms']:.2f}ms")
