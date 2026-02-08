# -*- mode: python ; coding: utf-8 -*-
"""
PyInstaller spec file for 2048 AI Client
"""

import sys
import shutil
from pathlib import Path

block_cipher = None

# 项目根目录
base_path = Path(SPECPATH)

# 不需要的 Qt/PyQt5 模块（减小打包体积 ~28M）
EXCLUDED_MODULES = [
    'PyQt5.QtBluetooth',
    'PyQt5.QtLocation',
    'PyQt5.QtMultimedia',
    'PyQt5.QtMultimediaWidgets',
    'PyQt5.QtNfc',
    'PyQt5.QtRemoteObjects',
    'PyQt5.QtSensors',
    'PyQt5.QtSerialPort',
    'PyQt5.QtSql',
    'PyQt5.QtSvg',
    'PyQt5.QtTest',
    'PyQt5.QtWebSockets',
    'PyQt5.QtXmlPatterns',
    'PyQt5.QtQuick3D',
]

# 打包后需要清理的 Qt 二进制文件/目录（通配符匹配）
QT_CLEANUP_PATTERNS = [
    # 整个 QML 目录（widget 应用不需要）
    'PyQt5/Qt5/qml',
    # 不需要的 frameworks
    'PyQt5/Qt5/lib/QtBluetooth.framework',
    'PyQt5/Qt5/lib/QtConcurrent.framework',
    'PyQt5/Qt5/lib/QtLocation.framework',
    'PyQt5/Qt5/lib/QtMultimedia.framework',
    'PyQt5/Qt5/lib/QtMultimediaQuick.framework',
    'PyQt5/Qt5/lib/QtNfc.framework',
    'PyQt5/Qt5/lib/QtQuick3D.framework',
    'PyQt5/Qt5/lib/QtQuick3DAssetImport.framework',
    'PyQt5/Qt5/lib/QtQuick3DRender.framework',
    'PyQt5/Qt5/lib/QtQuick3DRuntimeRender.framework',
    'PyQt5/Qt5/lib/QtQuick3DUtils.framework',
    'PyQt5/Qt5/lib/QtQuickControls2.framework',
    'PyQt5/Qt5/lib/QtQuickParticles.framework',
    'PyQt5/Qt5/lib/QtQuickShapes.framework',
    'PyQt5/Qt5/lib/QtQuickTemplates2.framework',
    'PyQt5/Qt5/lib/QtQuickTest.framework',
    'PyQt5/Qt5/lib/QtRemoteObjects.framework',
    'PyQt5/Qt5/lib/QtSensors.framework',
    'PyQt5/Qt5/lib/QtSerialPort.framework',
    'PyQt5/Qt5/lib/QtSql.framework',
    'PyQt5/Qt5/lib/QtSvg.framework',
    'PyQt5/Qt5/lib/QtTest.framework',
    'PyQt5/Qt5/lib/QtWebSockets.framework',
    'PyQt5/Qt5/lib/QtWebView.framework',
    'PyQt5/Qt5/lib/QtXmlPatterns.framework',
    'PyQt5/Qt5/lib/QtPositioningQuick.framework',
    'PyQt5/Qt5/lib/QtQmlWorkerScript.framework',
    # 不需要的插件
    'PyQt5/Qt5/plugins/bearer',
    'PyQt5/Qt5/plugins/position',
    'PyQt5/Qt5/plugins/generic',
    'PyQt5/Qt5/plugins/printsupport',
]

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
    excludes=EXCLUDED_MODULES,
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

# 过滤掉不需要的二进制文件和数据文件
def _should_exclude(name):
    """检查文件是否应该被排除"""
    for pattern in QT_CLEANUP_PATTERNS:
        if pattern in name:
            return True
    return False

a.binaries = [b for b in a.binaries if not _should_exclude(b[0])]
a.datas = [d for d in a.datas if not _should_exclude(d[0])]

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
