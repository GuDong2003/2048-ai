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

dummy = np.array([[2,4,2,4],[4,2,4,2],[2,4,2,4],[4,2,4,2]], dtype=np.int32)

print('Step 5a: expectimax depth=0', flush=True)
r = ai_engine.expectimax(dummy, 0, True, 6, 8)
print(f'Result: {r}', flush=True)

print('Step 5b: expectimax depth=1', flush=True)
r = ai_engine.expectimax(dummy, 1, True, 6, 8)
print(f'Result: {r}', flush=True)

print('All done!', flush=True)
