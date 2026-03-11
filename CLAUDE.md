# Polsweeper

Virtual account system on Polygon PoS mainnet (chain 137). Users get deterministic deposit addresses (EIP-1167 clones) that auto-forward funds to their master address.

## Project Structure

```
polsweeper/
├── contracts/          # Foundry (Solidity 0.8.24, OZ v5.2.0, EVM: paris)
│   ├── src/
│   │   ├── VirtualAccountCreator.sol   # Factory — deploys clones, predicts addresses
│   │   └── VirtualAccountImpl.sol      # Implementation — sweeps POL + ERC20 to master
│   ├── test/VirtualAccount.t.sol       # 14 tests
│   └── script/Deploy.s.sol            # Nonce-prediction deploy script
├── backend/            # Express + better-sqlite3 + viem + TypeScript
│   ├── src/
│   │   ├── index.ts                   # App entry, auth middleware, sweeper loop
│   │   ├── config.ts                  # Env validation, chain ID 137
│   │   ├── routes/                    # create, accounts, sweep
│   │   ├── services/                  # chain (signer queue), indexer, sweep
│   │   └── db/                        # schema, queries (SQLite)
│   └── abi/                           # Minimal contract ABIs
└── frontend/           # Vite + React 18 + TypeScript
    └── src/
        ├── App.tsx                    # Single-page app
        ├── api/client.ts              # Backend API wrapper
        └── components/                # AddressInput, CreatePanel, AccountList, etc.
```

## Deployed Contracts (Polygon Mainnet)

- **VirtualAccountImpl**: `0xe2225fee3E92B49bF234a9FbE3d47Dce5bc3d390`
- **VirtualAccountCreator**: `0x4F92749B1CF0814ea31548969B5084937a816Afd`

## Architecture

- **Lazy deployment**: Addresses computed off-chain via CREATE2. Clones deployed on-demand by the sweeper when funds are first detected.
- **Single gas account**: One private key (GAS_PRIVATE_KEY) pays for all deploy + sweep txs.
- **Signer queue**: In-process queue ensures sequential tx submission (no nonce conflicts). DB writes happen only after tx receipt confirmation.
- **Sequence indexer**: Balance detection via `GetTokenBalancesSummary` API.
- **Sweeper loop**: Persistent loop iterates all accounts, 2s between accounts, 30s between full cycles.
- **Basic auth**: Bearer token on all `/api/` routes.
- **5-account limit**: Per master, enforced atomically in SQLite transaction.

## Commands

```bash
# Contracts
cd contracts && forge install          # Install OZ deps (first time)
cd contracts && forge test -vvv        # Run all 14 tests
cd contracts && forge fmt              # Format Solidity
cd contracts && source .env && forge script script/Deploy.s.sol --broadcast --rpc-url "$RPC_URL" -vvv

# Backend
cd backend && npm install
cd backend && npm run dev               # Start dev server (port from .env, default 3101)
cd backend && npm run typecheck         # Type check
cd backend && npm run build             # Compile to dist/
cd backend && npm test                  # Run vitest tests

# Frontend
cd frontend && npm install
cd frontend && npm run dev              # Dev server
cd frontend && npm run build            # Production build to dist/
cd frontend && npm test                 # Run vitest tests
```

## API Routes

| Route | Method | Body | Description |
|-------|--------|------|-------------|
| `/api/create` | POST | `{ master, count }` | Create virtual accounts off-chain |
| `/api/accounts/:master` | GET | — | List accounts + balances from indexer |
| `/api/sweep` | POST | `{ account }` | Sweep one account |
| `/api/stats` | GET | — | System stats + recent sweeps |
| `/health` | GET | — | Health check (no auth) |

All `/api/` routes require `Authorization: Bearer <token>` header.

## Environment Variables

### Backend (`backend/.env`)
- `GAS_PRIVATE_KEY` — Hex private key (with or without 0x prefix)
- `SEQUENCE_API_KEY` — Sequence indexer access key
- `RPC_URL` — Polygon RPC endpoint
- `FACTORY_ADDRESS` — Deployed VirtualAccountCreator address
- `AUTH_TOKEN` — Bearer token for API auth
- `PORT` — Server port (default 3101)
- `DB_PATH` — SQLite DB path (default `polsweeper.db`; set `:memory:` for tests)

### Frontend (`frontend/.env`)
- `VITE_API_URL` — Backend base URL (empty string if using nginx proxy)
- `VITE_AUTH_TOKEN` — Auth token matching backend

### Contracts (`contracts/.env`)
- `PRIVATE_KEY` — Deployer private key (0x-prefixed)
- `RPC_URL` — Polygon RPC endpoint

## Code Style

- **Solidity**: `forge fmt` — 120 char lines, 4-space tabs, no bracket spacing, optimizer 200 runs
- **TypeScript**: No linter configured; follow existing patterns

## Testing

Always add or update tests when adding or modifying backend/frontend code.
- **Backend**: vitest + supertest; tests in `backend/test/`. Mock chain/indexer modules, use `DB_PATH=:memory:` for isolation.
- **Frontend**: vitest + @testing-library/react; tests in `frontend/test/`. Mock API client module.
- **Contracts**: Foundry; tests in `contracts/test/`.

## Key Design Decisions

- **Salt**: `keccak256(abi.encode(master, index))` — deterministic per (master, index) pair
- **SafeERC20**: All token transfers use OZ SafeERC20 for non-standard tokens (USDT etc.)
- **Resilient sweeps**: `sweepAll` uses `try/catch` per ERC20 so one bad token doesn't block others
- **Priority fee**: Flat 31 gwei `maxPriorityFeePerGas` on all txs
- **Atomic creation**: Account count check + insert wrapped in SQLite transaction to prevent TOCTOU race
- **Timing-safe auth**: `crypto.timingSafeEqual` for token comparison

## Production

See `prod.md` (gitignored) for production server details and deployment instructions.
