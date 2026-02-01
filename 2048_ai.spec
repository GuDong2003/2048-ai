# -*- mode: python ; coding: utf-8 -*-
"""
PyInstaller spec file for 2048 AI Client
"""

import sys
from pathlib import Path

block_cipher = None

# 项目根目录
base_path = Path(SPECPATH)

a = Analysis(
    ['2048_client.py'],
    pathex=[str(base_path)],
    binaries=[
        # C++ AI 引擎动态库
        (str(base_path / 'ai_bridge.dylib'), '.'),
    ],
    datas=[
        # JS 桥接脚本
        (str(base_path / 'ai_bridge.js'), '.'),
    ],
    hiddenimports=[
        'ai_engine',
        'numpy',
        'PyQt5',
        'PyQt5.QtCore',
        'PyQt5.QtWidgets',
        'PyQt5.QtWebEngineWidgets',
        'PyQt5.QtNetwork',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='2048 AI',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,  # GUI 应用，不显示控制台
    disable_windowed_traceback=False,
    argv_emulation=True,  # macOS 需要
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='2048 AI',
)

app = BUNDLE(
    coll,
    name='2048 AI.app',
    icon=None,  # 可以添加 icon.icns
    bundle_identifier='com.2048ai.client',
    info_plist={
        'CFBundleName': '2048 AI',
        'CFBundleDisplayName': '2048 AI',
        'CFBundleVersion': '1.0.0',
        'CFBundleShortVersionString': '1.0.0',
        'NSHighResolutionCapable': True,
    },
)
