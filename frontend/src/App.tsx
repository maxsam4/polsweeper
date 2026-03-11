import { useState, useCallback } from 'react';
import { Account } from './types';
import { getAccounts, createAccounts } from './api/client';
import AddressInput from './components/AddressInput';
import CreatePanel from './components/CreatePanel';
import AccountList from './components/AccountList';
import StatsPanel from './components/StatsPanel';

type View = 'main' | 'stats';

const MAX_ACCOUNTS = 5;

export default function App() {
  const [view, setView] = useState<View>('main');
  const [masterAddress, setMasterAddress] = useState('');
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState(false);
  const [creatingAccounts, setCreatingAccounts] = useState(false);
  const [error, setError] = useState('');

  const fetchAccounts = useCallback(async (master: string) => {
    setLoadingAccounts(true);
    setError('');
    try {
      const result = await getAccounts(master);
      setAccounts(result);
      setMasterAddress(master);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load accounts');
    } finally {
      setLoadingAccounts(false);
    }
  }, []);

  const handleCreate = useCallback(
    async (count: number) => {
      if (!masterAddress) return;
      setCreatingAccounts(true);
      setError('');
      try {
        await createAccounts(masterAddress, count);
        // Refresh the full list after creation
        const refreshed = await getAccounts(masterAddress);
        setAccounts(refreshed);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to create accounts');
      } finally {
        setCreatingAccounts(false);
      }
    },
    [masterAddress],
  );

  return (
    <main className="app">
      <header className="header">
        <h1 className="header__title">polsweeper</h1>
        <p className="header__subtitle">
          Virtual deposit accounts on Polygon PoS
        </p>
      </header>

      <nav className="nav-tabs">
        <button
          className={`nav-tabs__btn${view === 'main' ? ' nav-tabs__btn--active' : ''}`}
          onClick={() => setView('main')}
        >
          Accounts
        </button>
        <button
          className={`nav-tabs__btn${view === 'stats' ? ' nav-tabs__btn--active' : ''}`}
          onClick={() => setView('stats')}
        >
          Stats
        </button>
      </nav>

      {view === 'stats' ? (
        <StatsPanel />
      ) : (
        <>
          {/* Address Input */}
          <section className="section">
            <p className="section__label">Master Address</p>
            <AddressInput onSubmit={fetchAccounts} loading={loadingAccounts} />
            {error && <p className="error-msg">{error}</p>}
          </section>

          {/* Create Panel */}
          {masterAddress && (
            <section className="section">
              <p className="section__label">Create Accounts</p>
              <CreatePanel
                currentCount={accounts.length}
                maxCount={MAX_ACCOUNTS}
                loading={creatingAccounts}
                onCreate={handleCreate}
              />
            </section>
          )}

          {/* Account List */}
          {masterAddress && (
            <section className="section">
              <p className="section__label">Accounts</p>
              {loadingAccounts ? (
                <div className="address-input__loading">
                  <span className="spinner spinner--dark" />
                </div>
              ) : (
                <AccountList accounts={accounts} />
              )}
            </section>
          )}
        </>
      )}
    </main>
  );
}
