.PHONY: init certs up down logs status ps reset

ENV_FILE := .env.saas

init: certs
	@if [ ! -f $(ENV_FILE) ]; then cp .env.saas.example $(ENV_FILE) && echo "[Init] Created $(ENV_FILE)"; else echo "[Init] $(ENV_FILE) already exists"; fi

certs:
	@chmod +x infra/scripts/generate_certs.sh
	@./infra/scripts/generate_certs.sh

up:
	docker compose --env-file $(ENV_FILE) up -d

down:
	docker compose --env-file $(ENV_FILE) down

ps:
	docker compose --env-file $(ENV_FILE) ps

logs:
	docker compose --env-file $(ENV_FILE) logs -f --tail=100

stats:
	docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}"

reset:
	docker compose --env-file $(ENV_FILE) down -v
