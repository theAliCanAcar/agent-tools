# Agent Tools

Standard tool interface, tool() helper, reusable tool wrappers, structured errors, retry/timeout/fallback.

TypeScript package `agent-tools`.

## Install

```sh
npm install github:theAliCanAcar/agent-tools#main
```

## How to use

```ts
import { tool, retry } from 'agent-tools';
import { z } from 'zod';

const listInvoices = tool({
  name: 'list_invoices',
  description: 'List invoices by status',
  schema: z.object({ status: z.string().optional() }),
  execute: async ({ status }) => [{ id: '1', status: status ?? 'open' }],
});

const resilient = retry(listInvoices, { retries: 2 });
console.log(await resilient.execute({ status: 'open' }, {}));
```

## Use cases

### 1. Define a typed tool once

- **Scenario:** You need a list_invoices tool with Zod input validation.
- **Outcome:** Use tool() so name, schema, and execute stay in one place with structured ok/error results.

### 2. Add retries without rewriting business logic

- **Scenario:** A flaky HTTP API fails intermittently.
- **Outcome:** Wrap the tool with retry/timeout/fallback helpers.

## Dependencies

- `zod`: `^3.23.8`

## Scripts

```sh
npm install
npm run build
```

## Notes

- Keep API keys in environment variables or a gitignored `.env`. Never commit secrets.
- Side-effecting tools should go through approval when used with `agent-approval`.
- Related packages live in separate repositories under [theAliCanAcar](https://github.com/theAliCanAcar).

## License

MIT
