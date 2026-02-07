.PHONY: test e2e build typecheck

test:
	bun test

e2e:
	set -a && . ./.env && set +a && E2E=1 bun test tests/e2e.test.ts --timeout 600000

build:
	bun run build

typecheck:
	bun run typecheck
