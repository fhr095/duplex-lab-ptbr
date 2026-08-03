#!/usr/bin/env python3
"""Path-stable entrypoint for the frozen EXP-0025-R D-only adapter.

This wrapper changes no model, data, mapping, or inference behavior. It only
adds the repository root to ``sys.path`` before importing the already frozen
adapter, matching execution via both ``python scripts/file.py`` and module
imports.
"""

from __future__ import annotations

import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from scripts.run_exp_0025_r_external_d_only import main


if __name__ == "__main__":
    main()
