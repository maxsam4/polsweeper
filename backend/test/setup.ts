// Set minimal env vars so config.ts doesn't throw on import.
// These are test-only values — no real keys.
process.env.GAS_PRIVATE_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
process.env.SEQUENCE_API_KEY = "test-sequence-key";
process.env.RPC_URL = "http://localhost:8545";
process.env.FACTORY_ADDRESS = "0x4F92749B1CF0814ea31548969B5084937a816Afd";
process.env.AUTH_TOKEN = "test-auth-token";
process.env.PORT = "3199"; // test-only port
process.env.DB_PATH = ":memory:"; // in-memory DB for tests
