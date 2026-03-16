PYTHON ?= python3
VENV := .venv
PIP := $(VENV)/bin/pip
PY := $(VENV)/bin/python

API_DIR := apps/api
WEB_DIR := apps/web
MODE ?= 1vs1
MATCH_TYPE ?= 50
PAGES ?= 2
MAX_RANKERS ?= 30
PER_RANKER_MATCHES ?= 8

.PHONY: init init-db ingest analyze sync-rankers api web web-clean test

init:
	$(PYTHON) -m venv $(VENV)
	$(PIP) install --upgrade pip
	$(PIP) install -r $(API_DIR)/requirements.txt
	@echo "For web: cd $(WEB_DIR) && npm install"

init-db:
	cd $(API_DIR) && PYTHONPATH=. ../../$(PY) scripts/init_db.py

ingest:
	cd $(API_DIR) && PYTHONPATH=. ../../$(PY) scripts/ingest_matches.py --ouid "$(OUID)" --match-type "$(MATCH_TYPE)" --max-matches "$(MAX_MATCHES)"

analyze:
	cd $(API_DIR) && PYTHONPATH=. ../../$(PY) scripts/analyze_user.py --ouid "$(OUID)" --match-type "$(MATCH_TYPE)" --window "$(WINDOW)" --current-tactic-json '$(TACTIC_JSON)'

sync-rankers:
	cd $(API_DIR) && PYTHONPATH=. ../../$(PY) scripts/sync_rankers.py --mode "$(MODE)" --match-type "$(MATCH_TYPE)" --pages "$(PAGES)" --max-rankers "$(MAX_RANKERS)" --per-ranker-matches "$(PER_RANKER_MATCHES)"

api:
	cd $(API_DIR) && PYTHONPATH=. ../../$(PY) -m uvicorn app.main:app --reload --port 8000

web:
	cd $(WEB_DIR) && npm run dev

web-clean:
	cd $(WEB_DIR) && npm run dev:clean

test:
	cd $(API_DIR) && PYTHONPATH=. ../../$(PY) -m unittest discover -s tests -p "test_*.py"
