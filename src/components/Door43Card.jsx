import { useEffect, useState } from 'preact/hooks';
import { login, startOAuth, completeOAuth, listMyRepos, OAUTH_CLIENT_ID, DCS_HOST } from '../lib/dcs';
import { fetchProjectFromDcs } from '../lib/sync';
import { saveDcsAuth, clearDcsAuth } from '../lib/store';

// Door43 (DCS) account + online import. Entirely optional — the app works
// signed-out; an account is only needed to sync/import projects with DCS.
// Sign-in is OAuth (PKCE, no backend) when a client id is configured, with a
// username + password/token fallback that needs no setup. The auth record
// lives in IndexedDB for this install.
export function Door43Card({ auth, onAuthChange, onImport }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [repoRef, setRepoRef] = useState('');
  const [myRepos, setMyRepos] = useState(null);
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

  // finish the OAuth round-trip if DCS just redirected back with ?code=
  useEffect(() => {
    run(async () => {
      const a = await completeOAuth();
      if (a) {
        await saveDcsAuth(a);
        onAuthChange(a);
      }
    });
  }, []);

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
      setMyRepos(null);
      onAuthChange(null);
    });

  const importRepo = (ref) =>
    run(async () => {
      const fetched = await fetchProjectFromDcs(ref, auth);
      await onImport(fetched);
      setRepoRef('');
      setMyRepos(null);
    });

  const showMyRepos = () => run(async () => setMyRepos(await listMyRepos(auth.token)));

  return (
    <div class="card">
      <h2>Door43 sync</h2>
      {!auth ? (
        <>
          <p class="muted">
            Optional: sign in to sync projects with git.door43.org — check offline, sync when you
            have internet, pick up on another device.
          </p>
          {OAUTH_CLIENT_ID && (
            <button class="primary" style="width:100%" onClick={() => run(startOAuth)} disabled={busy}>
              Sign in with Door43
            </button>
          )}
          {(() => {
            const form = (
              <div class="row" style="flex-wrap:wrap;gap:8px;margin-top:8px">
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
            return OAUTH_CLIENT_ID ? (
              <details style="margin-top:8px">
                <summary class="muted" style="cursor:pointer">
                  Or sign in with a password / access token
                </summary>
                {form}
              </details>
            ) : (
              form
            );
          })()}
        </>
      ) : (
        <>
          <div class="row" style="align-items:center">
            <span class="grow">
              Signed in as <strong>{auth.username}</strong>
            </span>
            <button class="secondary" style="padding:6px 10px" onClick={signOut} disabled={busy}>
              Sign out
            </button>
          </div>
          <div class="row" style="flex-wrap:wrap;gap:8px;margin-top:10px">
            <input
              type="text"
              class="grow"
              placeholder="Import: owner/repo or Door43 URL"
              value={repoRef}
              onInput={(e) => setRepoRef(e.target.value)}
              autocapitalize="off"
            />
            <button class="secondary" onClick={() => importRepo(repoRef)} disabled={busy || !repoRef.trim()}>
              Import
            </button>
            <button class="secondary" onClick={showMyRepos} disabled={busy}>
              {busy && myRepos == null ? 'Loading…' : 'My repos'}
            </button>
          </div>
          {myRepos && !myRepos.length && <p class="muted">No repos under {auth.username} yet.</p>}
          {myRepos?.map((r) => (
            <div class="row" style="align-items:center;margin-top:6px" key={r.full_name}>
              <span class="grow" style="overflow:hidden;text-overflow:ellipsis">
                {r.full_name}
              </span>
              <button
                class="secondary"
                style="padding:6px 10px"
                onClick={() => importRepo(r.full_name)}
                disabled={busy}
              >
                Import
              </button>
            </div>
          ))}
          <p class="muted" style="margin-top:8px;font-size:0.8rem">
            Projects sync to {DCS_HOST.replace('https://', '')}/{auth.username}
          </p>
        </>
      )}
      {error && <p class="error">{error}</p>}
    </div>
  );
}
