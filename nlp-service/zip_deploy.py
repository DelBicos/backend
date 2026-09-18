"""Gera deploy.zip com caminhos estilo Unix (/), exigidos pelo Kudu/rsync no
Linux App Service. O Compress-Archive do PowerShell grava separadores '\\',
que o Linux interpreta como parte do nome do arquivo, quebrando o deploy.
"""
import os
import zipfile

INCLUDE_DIRS = ["app", "data", "artifacts"]
INCLUDE_FILES = ["requirements.txt"]
EXCLUDE_DIR_NAMES = {"__pycache__"}

out_path = "deploy.zip"
if os.path.exists(out_path):
    os.remove(out_path)

count = 0
with zipfile.ZipFile(out_path, "w", zipfile.ZIP_DEFLATED) as zf:
    for base in INCLUDE_DIRS:
        for dirpath, dirnames, filenames in os.walk(base):
            dirnames[:] = [d for d in dirnames if d not in EXCLUDE_DIR_NAMES]
            for filename in filenames:
                full_path = os.path.join(dirpath, filename)
                arcname = full_path.replace(os.sep, "/")
                zf.write(full_path, arcname)
                count += 1
    for f in INCLUDE_FILES:
        zf.write(f, f.replace(os.sep, "/"))
        count += 1

print(f"deploy.zip criado com {count} arquivos (caminhos com '/').")
