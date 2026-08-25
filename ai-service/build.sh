#!/usr/bin/env bash
# Render AI service build: install deps, then drop the full opencv-python wheel
# that insightface pulls in so only opencv-python-headless provides cv2.
set -euo pipefail
pip install -r requirements.txt
pip uninstall -y opencv-python || true
