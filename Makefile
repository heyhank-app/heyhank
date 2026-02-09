.PHONY: dev build start

dev:
	cd web && bun run dev

build:
	cd web && bun run build

start:
	cd web && bun run start
