import sys
print('Step 1: imports', flush=True)
import os
os.environ['NUMBA_NUM_THREADS'] = '1'
os.environ['NUMBA_THREADING_LAYER'] = 'workqueue'

print('Step 2: importing ai_engine module', flush=True)
import ai_engine
print('Step 3: module imported', flush=True)

print('Step 4: creating AIEngine instance...', flush=True)
engine = ai_engine.AIEngine(mode='stable')
print('Step 5: engine created!', flush=True)
