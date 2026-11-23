.PHONY: init certs up down ps logs stats migrate seed sim sim-down fault test reset

ENV_FILE := .env.saas
DC := docker compose --env-file $(ENV_FILE)

init: certs
	@if [ ! -f $(ENV_FILE) ]; then cp .env.saas.example $(ENV_FILE) && echo "[Init] Created $(ENV_FILE)"; else echo "[Init] $(ENV_FILE) already exists"; fi

certs:
	@chmod +x infra/scripts/generate_certs.sh
	@./infra/scripts/generate_certs.sh

up:
	$(DC) up -d --build

down:
	$(DC) --profile sim down

ps:
	$(DC) --profile sim ps

logs:
	$(DC) logs -f --tail=100

stats:
	docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}"

migrate:
	$(DC) exec -T api alembic upgrade head

seed:
	$(DC) exec -T api python -m app.seed

sim:
	$(DC) --profile sim up -d simulator

sim-down:
	$(DC) --profile sim stop simulator

# Example: make fault DEVICE=acme-motor-01 TYPE=bearing_wear TTL=60
DEVICE ?= acme-motor-01
TYPE ?= bearing_wear
TTL ?= 60
fault:
	$(DC) --profile sim exec -T simulator python /sim/inject_fault.py $(DEVICE) $(TYPE) --ttl $(TTL) --valkey redis://valkey:6379/0 2>/dev/null || \
	docker run --rm --network future-eagle-saas_default -v "$(CURDIR)/simulator:/sim:ro" future-eagle-backend:local \
		python /sim/inject_fault.py $(DEVICE) $(TYPE) --ttl $(TTL) --valkey redis://valkey:6379/0

test:
	$(DC) exec -T api pytest -v

reset:
	$(DC) --profile sim down -v
