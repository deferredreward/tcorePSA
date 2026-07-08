// DCS (git.door43.org, a Gitea fork) REST API client — the browser-side
// equivalent of tC3's gogs-client + system git. DCS sends
// Access-Control-Allow-Origin:* on /api/v1 and archive downloads (verified
// against Gitea 1.26.4+dcs), so a PWA can authenticate, read whole repos as
// zips, and commit files cross-origin — no git binary or isomorphic-git.
// Pure module (fetch only, no IndexedDB/DOM) so node tests can use it.

export const DCS_HOST = 'https://git.door43.org';
const API = `${DCS_HOST}/api/v1`;

// The per-app access token name, like tC3's 'translation-core'. Gitea only
// reveals a token's secret at creation, so login must create a fresh token —
// it cannot re-read an existing one. The name is qualified per device (see
// login) so a second device's sign-in doesn't revoke the first device's token.
const TOKEN_NAME = 'tcore-checks-pwa';

async function api(path, { token, basic, method = 'GET', body } = {}) {
  const headers = {};
  // Bearer works for both personal access tokens and OAuth access tokens
  if (token) headers.Authorization = `Bearer ${token}`;
  else if (basic) headers.Authorization = `Basic ${btoa(`${basic.username}:${basic.password}`)}`;
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let detail = '';
    try {
      detail = (await res.json()).message || '';
    } catch {
      /* non-JSON error body */
    }
    const err = new Error(`DCS ${res.status}${detail ? `: ${detail}` : ''}`);
    err.status = res.status;
    throw err;
  }
  return res.status === 204 ? null : res.json();
}

// ── OAuth (PKCE public client) ──────────────────────────────────────────────
// The user-facing sign-in, adapted from bible-editor's DCS OAuth design for a
// backend-less PWA: no client secret — Gitea's PKCE public-client flow, with
// the code exchange done from the browser. The token endpoint's CORS
// preflight only allows GET, so the exchange MUST be a form-encoded "simple
// request" (no preflight); the response itself sends
// Access-Control-Allow-Origin:* (verified against DCS 1.26.4).
// Requires a one-time OAuth2 app registration on DCS (Settings →
// Applications, "public client", redirect URI = the deployed app URL);
// the client id arrives via VITE_DCS_CLIENT_ID.

export const OAUTH_CLIENT_ID =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_DCS_CLIENT_ID) || '';

const base64url = (bytes) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function appRedirectUri() {
  const base = (typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL) || '/';
  return `${location.origin}${base}`;
}

async function tokenRequest(params) {
  const res = await fetch(`${DCS_HOST}/login/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new Error(`Door43 sign-in failed: ${data.error_description || data.error || `HTTP ${res.status}`}`);
  }
  return data;
}

function authFromTokenData(user, data) {
  return {
    username: user.login,
    token: data.access_token,
    kind: 'oauth',
    refreshToken: data.refresh_token || null,
    // refresh a minute early
    expiresAt: data.expires_in ? Date.now() + (data.expires_in - 60) * 1000 : null,
  };
}

// Kick off the OAuth redirect. State + PKCE verifier wait in sessionStorage
// for completeOAuth() when DCS redirects back to the app.
export async function startOAuth() {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const state = base64url(crypto.getRandomValues(new Uint8Array(16)));
  sessionStorage.setItem('dcs:oauth', JSON.stringify({ verifier, state }));
  const challenge = base64url(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))),
  );
  const url = new URL(`${DCS_HOST}/login/oauth/authorize`);
  url.searchParams.set('client_id', OAUTH_CLIENT_ID);
  url.searchParams.set('redirect_uri', appRedirectUri());
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  location.assign(url.toString());
}

// Call on app load: if the URL carries an OAuth ?code= return, finish the
// exchange and return the auth record (caller persists it); null otherwise.
export async function completeOAuth() {
  const params = new URLSearchParams(location.search);
  const code = params.get('code');
  if (!code) return null;
  const pending = JSON.parse(sessionStorage.getItem('dcs:oauth') || 'null');
  sessionStorage.removeItem('dcs:oauth');
  // strip ?code=&state= so reloads/bookmarks don't retry a used code
  history.replaceState(null, '', location.pathname + location.hash);
  if (!pending || params.get('state') !== pending.state) {
    throw new Error('Door43 sign-in failed: state mismatch — please try again');
  }
  const data = await tokenRequest({
    grant_type: 'authorization_code',
    client_id: OAUTH_CLIENT_ID,
    code,
    redirect_uri: appRedirectUri(),
    code_verifier: pending.verifier,
  });
  const user = await api('/user', { token: data.access_token });
  return authFromTokenData(user, data);
}

// Exchange the refresh token for a fresh access token (OAuth tokens expire
// hourly). Returns the updated auth record.
export async function refreshOAuth(auth) {
  const data = await tokenRequest({
    grant_type: 'refresh_token',
    client_id: OAUTH_CLIENT_ID,
    refresh_token: auth.refreshToken,
  });
  return { ...auth, ...authFromTokenData({ login: auth.username }, data) };
}

// ── Password / personal-access-token fallback ───────────────────────────────
// Sign in with a Door43 username + password (or an existing access token
// pasted as the password — tried first, so accounts with 2FA still work).
// Zero-setup fallback when no OAuth client id is configured. `deviceLabel`
// (a per-install id) qualifies the created token's name so devices don't
// clobber each other's tokens. Returns {username, token, kind: 'pat'}.
export async function login(username, secret, deviceLabel = '') {
  try {
    const user = await api('/user', { token: secret });
    if (user?.login?.toLowerCase() === username.trim().toLowerCase()) {
      return { username: user.login, token: secret, kind: 'pat' };
    }
  } catch {
    /* not a token — fall through to basic auth */
  }
  const basic = { username: username.trim(), password: secret };
  const user = await api('/user', { basic }); // 401 here = bad credentials
  // Per-device token name: only ever delete THIS device's own previous token
  // (avoids piling up tokens on repeat sign-ins) while leaving other devices'
  // tokens — and their sync — intact.
  const tokenName = deviceLabel ? `${TOKEN_NAME} (${deviceLabel})` : TOKEN_NAME;
  const tokens = await api(`/users/${user.login}/tokens`, { basic });
  const stale = (tokens || []).find((t) => t.name === tokenName);
  if (stale) await api(`/users/${user.login}/tokens/${stale.id}`, { basic, method: 'DELETE' });
  const created = await api(`/users/${user.login}/tokens`, {
    basic,
    method: 'POST',
    body: { name: tokenName, scopes: ['read:user', 'write:repository'] },
  });
  return { username: user.login, token: created.sha1, kind: 'pat' };
}

export async function getRepo(owner, repo, token) {
  try {
    return await api(`/repos/${owner}/${repo}`, { token });
  } catch (err) {
    if (err.status === 404) return null;
    throw err;
  }
}

export function createRepo(name, token) {
  return api('/user/repos', {
    token,
    method: 'POST',
    body: {
      name,
      description: 'Bible checking project — tCore Checks (PWA)',
      private: false,
      default_branch: 'master',
      auto_init: false,
    },
  });
}

// Head commit sha of a branch, or null while the repo is still empty.
export async function getBranchSha(owner, repo, branch, token) {
  try {
    const b = await api(`/repos/${owner}/${repo}/branches/${encodeURIComponent(branch)}`, { token });
    return b?.commit?.id || null;
  } catch (err) {
    if (err.status === 404) return null;
    throw err;
  }
}

// Full recursive tree at a ref -> {path: blobSha}. Lets sync diff local
// bytes against the remote without downloading file contents.
export async function getTree(owner, repo, ref, token) {
  const shaByPath = {};
  let seen = 0;
  for (let page = 1; ; page++) {
    const t = await api(
      `/repos/${owner}/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=true&per_page=1000&page=${page}`,
      { token },
    );
    const entries = t?.tree || [];
    for (const e of entries) if (e.type === 'blob') shaByPath[e.path] = e.sha;
    // total_count counts every entry (files + dirs); per_page can be capped
    // server-side (DCS honours smaller pages), so advance by the entries we
    // actually received rather than an assumed page size — else a large tree
    // stops early and its files get pushed as create → 422 "already exists".
    seen += entries.length;
    if (!entries.length || seen >= (t.total_count || 0)) break;
  }
  return shaByPath;
}

// Whole repo at a ref as a zip (Uint8Array) — feeds straight into importBurrito,
// which already tolerates the archive's single wrapper directory.
export async function downloadArchive(owner, repo, ref, token) {
  const res = await fetch(`${API}/repos/${owner}/${repo}/archive/${encodeURIComponent(ref)}.zip`, {
    // Bearer (like api()) so OAuth access tokens work, not just PAT sha1s —
    // otherwise an OAuth user can't download a private repo's archive.
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(`DCS archive download failed (HTTP ${res.status})`);
  return new Uint8Array(await res.arrayBuffer());
}

// One commit changing many files (Gitea batch contents API).
// files: [{operation: 'create'|'update'|'delete', path, content: base64, sha?}]
// Omit branch to target the default branch (required while the repo is empty).
export function commitFiles(owner, repo, { branch, message, files }, token) {
  return api(`/repos/${owner}/${repo}/contents`, {
    token,
    method: 'POST',
    body: { branch: branch || undefined, message, files },
  });
}

// The signed-in user's repos, most recently pushed first.
export async function listMyRepos(token, limit = 50) {
  const repos = await api(`/user/repos?page=1&limit=${limit}`, { token });
  return (repos || []).sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
}

// "owner/repo", a git.door43.org URL, or a live door43.org/u/ URL -> {owner, repo}
export function parseRepoRef(input) {
  let s = String(input || '').trim();
  s = s.replace(/^https?:\/\//, '').replace(/^(git\.)?door43\.org\//, '');
  s = s.replace(/\.git$/, '').replace(/\/+$/, '');
  const parts = s.split('/').filter(Boolean);
  if (parts[0] === 'u') parts.shift();
  if (parts.length < 2 || /[\s]/.test(parts[0] + parts[1])) return null;
  return { owner: parts[0], repo: parts[1] };
}

// Uint8Array -> base64, chunked to stay under argument-list limits
export function toBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}
