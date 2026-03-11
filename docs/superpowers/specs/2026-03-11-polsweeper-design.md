# Polsweeper: Virtual Account System for Polygon

## Context

Polsweeper provides a virtual account service on Polygon PoS mainnet (chain ID 137). Users get deterministic deposit addresses that automatically forward received funds (POL + ERC20) to their master address. This enables use cases like payment processing, exchange deposit addresses, and fund aggregation — without requiring users to manage multiple wallets.

## Requirements

- **Lazy virtual account creation**: Accounts are created off-chain by computing deterministic CREATE2 addresses. No on-chain transaction at creation time — clones are deployed on-demand by the sweeper when funds are first detected. Instant UX.
- **Gasless UX**: Users enter their master address in the UI (no wallet connection). No gas costs for users at any point.
- **Sweep to master**: Anyone can trigger a sweep that sends all POL + ERC20 tokens from a virtual account to its fixed master.
- **Automated sweeper**: Persistent service polls Sequence indexer for balances and auto-sweeps when funds detected. Deploys clone on first sweep if needed.
- **Manual sweep**: UI provides a sweep button per account.
- **5 account limit**: Backend/UI policy only (not enforced on-chain). Users see "Contact Polygon Labs" when at limit.
- **Basic auth**: App is behind basic auth or invite code to prevent abuse of the subsidized gas endpoint.
- **SafeERC20**: All ERC20 transfers use OpenZeppelin SafeERC20 to handle non-standard tokens (e.g. USDT).
- **Resilient sweep**: `sweepAll` uses try/catch per ERC20 transfer so one bad token doesn't revert the entire sweep.

## Architecture

### System Components

```
Frontend (Vite + React)
    │
    │ REST API (behind basic auth)
    ▼
Backend (Express + SQLite + viem)
    │
    ├── API routes (create, list, sweep)
    ├── Sweeper service (persistent loop)
    ├── Sequence Indexer client
    │
    │ On-chain calls (single gas account)
    ▼
Polygon PoS Mainnet (chain ID 137)
    ├── VirtualAccountCreator (factory)
    ├── VirtualAccountImpl (singleton)
    └── Clone 0..N (EIP-1167 minimal proxies, deployed on demand)
```

### Smart Contracts

**VirtualAccountCreator** (factory):
- `deployAndSweep(address master, uint256 index, address[] calldata tokens)` — deploys clone if not yet deployed (checks `address.code.length == 0`), registers `masterOf[clone] = master`, then calls `sweepAll(tokens)` on the clone. Used by the sweeper for first-time sweeps.
- `getAddress(address master, uint256 index) → address` — predicts clone address without deploying (pure CREATE2 math)
- `getAddresses(address master, uint256 start, uint256 count) → address[]` — batch address prediction
- `masterOf(address clone) → address` — returns the master for a given clone
- Salt: `keccak256(abi.encode(master, index))`
- Emits: `AccountDeployed(address indexed master, uint256 index, address clone)` on first deploy
- Fully permissionless, no owner, no admin functions. The implementation address is immutable after deployment.

**VirtualAccountImpl** (singleton, deployed once):
- `factory` — immutable, set at construction. Works through delegatecall because immutables are in bytecode.
- `sweepAll(address[] calldata tokens)` — sweeps POL (if balance > 0) + each listed ERC20 to master. Uses try/catch per ERC20 so one bad token doesn't block others. Master is read via `factory.masterOf(address(this))`.
- `sweepPOL()` — sweeps only POL to master.
- `sweepERC20(address token)` — sweeps one ERC20 to master.
- `receive()` — accepts incoming POL.
- No access control on sweep functions (funds always go to fixed master).
- Uses OpenZeppelin SafeERC20 for all token transfers.
- All sweep functions include `require(master != address(0))` guard.
- Emits: `Swept(address indexed master, address indexed token, uint256 amount)` where `token = address(0)` for POL.

**Clones** (EIP-1167 minimal proxies, 45 bytes each):
- Deployed on-demand by factory's `deployAndSweep` when the sweeper first detects funds.
- Created via `Clones.cloneDeterministic(implementation, salt)`.
- Delegatecall all calls to VirtualAccountImpl.
- Can receive POL and ERC20 tokens at their deterministic addresses even before deployment.

### Backend Service

**Tech**: Express + SQLite + viem + TypeScript

**Authentication**: Basic auth or invite code on all routes. Simple gate to prevent gas abuse.

**API Routes:**

| Route | Method | Description |
|-------|--------|-------------|
| `/api/create` | POST | Create virtual accounts **off-chain**. Body: `{ master, count }`. Validates master is valid Ethereum address, validates 1 ≤ count ≤ 5, checks existing count in SQLite. Computes deterministic CREATE2 addresses (no on-chain tx), stores in SQLite, returns addresses instantly. |
| `/api/accounts/:master` | GET | Returns accounts from SQLite + balances from Sequence indexer. |
| `/api/sweep` | POST | Sweep one account. Body: `{ account }`. Validates account exists in DB. Calls shared `sweepAccount()`. No `tokens` parameter — sweeps whatever the indexer reports. |

**Shared Sweep Function:**
Both the API route and the sweeper service use the same `sweepAccount()` function:
```
sweepAccount(cloneAddress, master, index):
  1. Query Sequence indexer for token balances
  2. If any balance found (POL or ERC20):
     a. If clone not yet deployed (check `deployed` flag in DB):
        → call factory.deployAndSweep(master, index, tokenAddresses)
        → set deployed = true in DB
     b. If clone already deployed:
        → call sweepAll(tokenAddresses) on clone
     c. Sign with GAS_ACCOUNT, queue through in-process signer queue
     d. Write DB state only after waitForTransactionReceipt
  3. Return sweep result

Error handling:
  - If sweep tx reverts: log error, skip account, continue loop
  - If indexer unreachable: log warning, retry after backoff (2s, 4s, 8s, max 30s)
  - If RPC unreachable: pause loop, retry with exponential backoff
```
No filtering, no thresholds — sweep everything the indexer reports.

**Nonce / Concurrency**: One in-process queue per signer. All on-chain calls go through the queue (sequential). DB writes happen only after tx receipt confirmation.

**Sweeper Service** (persistent loop, not cron):
```
runSweeper():
  loop forever:
    accounts = db.getAllVirtualAccounts()
    for each account:
      try:
        sweepAccount(account.address, account.master, account.index)
      catch:
        log error, continue
      sleep(2000)  // 2 second delay between accounts
```

**Database** (SQLite):
```sql
CREATE TABLE virtual_accounts (
  id INTEGER PRIMARY KEY,
  master TEXT NOT NULL,
  address TEXT NOT NULL UNIQUE,
  account_index INTEGER NOT NULL,
  deployed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_master ON virtual_accounts(master);
```

**Sequence Indexer Integration:**
```
POST https://polygon-indexer.sequence.app/rpc/Indexer/GetTokenBalancesSummary
Headers: X-Access-Key: <key>
Body: {
  chainID: "polygon",
  omitMetadata: true,
  filter: {
    contractStatus: "ALL",
    accountAddresses: ["0x...", "0x...", ...]
  }
}
```

**Environment Variables:**
- `GAS_PRIVATE_KEY` — single gas account for all on-chain operations (deploy + sweep)
- `SEQUENCE_API_KEY` — Sequence indexer access key
- `RPC_URL` — Polygon PoS mainnet RPC endpoint
- `FACTORY_ADDRESS` — deployed factory contract address
- `AUTH_TOKEN` — basic auth token or invite code

### Frontend

**Tech**: Vite + React + TypeScript

**Design direction**: Minimalist, spacious, Polygon purple theme, monospace for addresses, clear typography hierarchy. Full visual polish applied during implementation via `frontend-design` skill.

**Single page with three sections:**

1. **Master Address Input** — text field for Polygon address + Load button. No wallet connection.
2. **Create Accounts** — count selector (1-5), shows "X of 5 used", Create button (instant, no gas). "Contact Polygon Labs" message when at limit.
3. **Account List** — each account shows: truncated address + index, copy button, token balances (from Sequence indexer), single "Sweep" button that sweeps all tokens.

**Structure:**
```
frontend/
├── index.html
├── vite.config.ts
├── package.json
├── src/
│   ├── main.tsx
│   ├── App.tsx
│   ├── components/
│   │   ├── AddressInput.tsx
│   │   ├── CreatePanel.tsx
│   │   ├── AccountList.tsx
│   │   ├── AccountCard.tsx
│   │   └── SweepButton.tsx
│   ├── api/
│   │   └── client.ts
│   └── types.ts
└── .env
```

## Project Structure

```
polsweeper/
├── contracts/                    # Foundry project
│   ├── foundry.toml
│   ├── src/
│   │   ├── VirtualAccountCreator.sol
│   │   └── VirtualAccountImpl.sol
│   ├── test/
│   │   └── VirtualAccount.t.sol
│   └── script/
│       └── Deploy.s.sol
├── backend/                      # Express + SQLite
│   ├── package.json
│   ├── tsconfig.json
│   ├── src/
│   │   ├── index.ts
│   │   ├── routes/
│   │   │   ├── create.ts
│   │   │   ├── accounts.ts
│   │   │   └── sweep.ts
│   │   ├── services/
│   │   │   ├── sweep.ts
│   │   │   ├── indexer.ts
│   │   │   └── chain.ts
│   │   ├── db/
│   │   │   ├── schema.ts
│   │   │   └── queries.ts
│   │   └── config.ts
│   ├── .env
│   └── abi/                      # Shared ABIs
├── frontend/                     # Vite + React
│   ├── package.json
│   ├── vite.config.ts
│   ├── src/
│   │   ├── main.tsx
│   │   ├── App.tsx
│   │   ├── components/
│   │   ├── api/
│   │   └── types.ts
│   └── .env
└── docs/
```

## Gas Estimates (Polygon)

| Operation | Gas | Cost (~30 gwei, POL ~$0.50) |
|-----------|-----|-----|
| Deploy impl (one-time) | ~200k | ~$0.01 |
| Deploy factory (one-time) | ~500k | ~$0.03 |
| Create virtual account | 0 | $0 (off-chain) |
| deployAndSweep (first sweep, POL only) | ~115k | ~$0.007 |
| deployAndSweep (first sweep, POL + 1 ERC20) | ~140k | ~$0.009 |
| sweepAll (subsequent, POL only) | ~35k | ~$0.002 |
| sweepAll (subsequent, POL + 1 ERC20) | ~60k | ~$0.004 |

## Verification Plan

1. **Smart contracts**: `forge test` — test deterministic address prediction, deployAndSweep, sweepAll with try/catch on bad tokens, require(master != 0) guard, empty balance edge cases
2. **Backend**: Start server, call API routes via curl, verify SQLite state, verify addresses match on-chain prediction
3. **Sweeper**: Start sweeper, send POL/ERC20 to a predicted (undeployed) address, observe deploy + sweep within one loop cycle
4. **Frontend**: Open in browser, enter master address, create accounts (instant), verify they appear, click sweep, verify funds move
5. **Integration**: Full flow from create (off-chain) → deposit → auto-deploy + sweep → verify master balance
6. **Bad token test**: Deploy a reverting ERC20, send it to a virtual account alongside POL, verify POL still sweeps successfully
