import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import Login from './Login';
import './App.css';

function Root() {
  const [token, setToken] = useState(() => localStorage.getItem('token') || '');
  const [role, setRole] = useState(() => localStorage.getItem('role') || '');
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    if (!token) { setChecking(false); return; }
    fetch('/api/auth', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => {
        if (!r.ok) throw new Error('invalid');
        return r.json();
      })
      .then(d => {
        if (!d.valid) { doLogout(); }
        else { setRole(d.role); localStorage.setItem('role', d.role); }
      })
      .catch(() => doLogout())
      .finally(() => setChecking(false));
  }, []);

  function doLogout() {
    localStorage.removeItem('token');
    localStorage.removeItem('email');
    localStorage.removeItem('role');
    setToken('');
    setRole('');
  }

  if (checking) return <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#09090b', color: '#6b7280' }}>Loading...</div>;

  if (!token) return <Login onLogin={(t, r) => { setToken(t); setRole(r); }} />;

  return <App token={token} role={role} onLogout={doLogout} />;
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
