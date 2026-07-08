import { useState } from 'preact/hooks';
import { login, startOAuth, OAUTH_CLIENT_ID } from '../lib/dcs';
import { saveDcsAuth, clearDcsAuth } from '../lib/store';

// Compact Door43 account panel, opened from the header. Auth only — the app
// is fully usable signed-out; importing and per-project sync live with the
// projects they act on. OAuth "Sign in with Door43" is primary when a client
// id is configured; a username + password/token form is the zero-setup
// fallback (tucked behind a disclosure when OAuth is available).
export function Door43Account({ auth, onAuthChange }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function run(fn) {
    setError(null);
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      setError(String(err.message || err));
    } finally {
      setBusy(false);
    }
  }

  const signInManual = () =>
    run(async () => {
      const a = await login(username, password);
      await saveDcsAuth(a);
      setPassword('');
      onAuthChange(a);
    });

  const signOut = () =>
    run(async () => {
      await clearDcsAuth();
      onAuthChange(null);
    });

  if (auth) {
    return (
      <>
        <p style="margin:0 0 8px">
          Signed in as <strong>@{auth.username}</strong>
        </p>
        <button class="secondary" style="width:100%" onClick={signOut} disabled={busy}>
          Sign out
        </button>
        <p class="muted" style="margin:8px 0 0">
          Sync a project with the ⇅ button, or import one from Door43 under “Add a translation”.
        </p>
        {error && <p class="error">{error}</p>}
      </>
    );
  }

  const passwordForm = (
    <div class="row" style="flex-direction:column;align-items:stretch;gap:8px;margin-top:8px">
      <input
        type="text"
        placeholder="Door43 username"
        value={username}
        onInput={(e) => setUsername(e.target.value)}
        autocapitalize="off"
      />
      <input
        type="password"
        placeholder="Password or access token"
        value={password}
        onInput={(e) => setPassword(e.target.value)}
      />
      <button class="secondary" onClick={signInManual} disabled={busy || !username || !password}>
        {busy ? 'Signing in…' : 'Sign in'}
      </button>
    </div>
  );

  return (
    <>
      <p class="muted" style="margin:0 0 10px">
        Optional — sync projects with Door43 to work across devices.
      </p>
      {OAUTH_CLIENT_ID && (
        <button class="primary" style="width:100%" onClick={() => run(startOAuth)} disabled={busy}>
          Sign in with Door43
        </button>
      )}
      {OAUTH_CLIENT_ID ? (
        <details style="margin-top:8px">
          <summary class="muted" style="cursor:pointer">
            Or use a password / access token
          </summary>
          {passwordForm}
        </details>
      ) : (
        passwordForm
      )}
      {error && <p class="error">{error}</p>}
    </>
  );
}
