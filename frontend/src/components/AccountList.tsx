import { Account } from '../types';
import AccountCard from './AccountCard';

interface AccountListProps {
  accounts: Account[];
}

export default function AccountList({ accounts }: AccountListProps) {
  if (accounts.length === 0) {
    return (
      <div className="account-list__empty">
        <p>No accounts yet. Create one above to get started.</p>
      </div>
    );
  }

  return (
    <div className="account-list">
      {accounts.map((acct, i) => (
        <AccountCard
          key={acct.address}
          account={acct}
          animationDelay={i * 60}
        />
      ))}
    </div>
  );
}
