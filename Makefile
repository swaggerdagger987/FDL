.PHONY: test test-unit test-integration frontend-build backend-check

test: test-unit test-integration

test-unit:
	python3 -m pytest tests/unit

test-integration:
	python3 -m pytest tests/integration

backend-check:
	python3 -m py_compile src/backend/main.py

frontend-build:
	npm --prefix src/frontend install
	npm --prefix src/frontend run build
