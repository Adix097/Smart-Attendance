#!/usr/bin/env bash
set -euo pipefail

pip install -r requirements.txt
pip uninstall -y opencv-python
pip install --force-reinstall --no-deps opencv-python-headless