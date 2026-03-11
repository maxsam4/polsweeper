import React, { useState } from 'react';

interface AddressInputProps {
  onSubmit: (address: string) => void;
  loading: boolean;
}

function isValidAddress(value: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(value);
}

export default function AddressInput({ onSubmit, loading }: AddressInputProps) {
  const [value, setValue] = useState('');
  const [touched, setTouched] = useState(false);

  const valid = isValidAddress(value);
  const showError = touched && value.length > 0 && !valid;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (valid && !loading) {
      onSubmit(value);
    }
  }

  return (
    <form className="address-input" onSubmit={handleSubmit}>
      <input
        type="text"
        className={`address-input__field${showError ? ' address-input__field--invalid' : ''}`}
        placeholder="0x your polygon address..."
        value={value}
        onChange={(e) => setValue(e.target.value.trim())}
        onBlur={() => setTouched(true)}
        spellCheck={false}
        autoComplete="off"
      />
      <button
        type="submit"
        className="btn btn--primary"
        disabled={!valid || loading}
      >
        {loading ? <span className="spinner" /> : 'Load'}
      </button>
    </form>
  );
}
