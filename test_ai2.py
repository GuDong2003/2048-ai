import sys
print('Step 1: imports', flush=True)
import os
os.environ['NUMBA_NUM_THREADS'] = '1'
os.environ['NUMBA_THREADING_LAYER'] = 'workqueue'

print('Step 2: importing numpy', flush=True)
import numpy as np

print('Step 3: importing ai_engine module', flush=True)
import ai_engine
print('Step 4: module imported', flush=True)

# Manually warmup the njit functions
print('Step 5: warmup njit functions...', flush=True)
dummy = np.array([[2,4,2,4],[4,2,4,2],[2,4,2,4],[4,2,4,2]], dtype=np.int32)

print('Step 5a: count_empty', flush=True)
ai_engine.count_empty(dummy)
print('Step 5b: swipe', flush=True)
ai_engine.swipe(dummy, 0)
print('Step 5c: is_game_over', flush=True)
ai_engine.is_game_over(dummy)
print('Step 5d: calculate_heuristic', flush=True)
ai_engine.calculate_heuristic(dummy)
print('Step 5e: expectimax', flush=True)
ai_engine.expectimax(dummy, 2, True, 6, 8)

print('Step 6: Now creating AIEngine instance...', flush=True)
engine = ai_engine.AIEngine(mode='stable')
print('Step 7: engine created!', flush=True)
