/* The simulator acting as an OAuth client, the way the Alexa app does when a customer links an add-on. */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const CLIENT = 'recall-check-simulator', HERE = `${location.origin}/link`;
  const b64 = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const random = (n) => b64(crypto.getRandomValues(new Uint8Array(n)));

  const step = (text, ok = true) => { const li = document.createElement('li'); li.textContent = text; if (!ok) li.className = 'failed'; $('flow').append(li); };
  const show = (text, linked) => { $('state').textContent = text; $('go').hidden = linked; $('unlink').hidden = !linked; };

  async function start() {
    const verifier = random(48), state = random(16);
    const challenge = b64(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
    sessionStorage.setItem('rc-pkce', JSON.stringify({ verifier, state }));
    const to = new URL('/oauth/authorize', location.origin);
    to.search = new URLSearchParams({ response_type: 'code', client_id: CLIENT, redirect_uri: HERE, code_challenge: challenge, code_challenge_method: 'S256', state, scope: 'mcp:tools', resource: `${location.origin}/mcp` }).toString();
    location.assign(to);
  }

  async function finish(q) {
    const kept = JSON.parse(sessionStorage.getItem('rc-pkce') || 'null');
    sessionStorage.removeItem('rc-pkce');
    history.replaceState(null, '', HERE); // the code is spent; keep it out of the address bar
    if (q.get('error')) { step(`The authorization server refused: ${q.get('error_description') || q.get('error')}`, false); return show('Not linked.', false); }
    if (!kept || kept.state !== q.get('state')) { step('The reply did not match the request that was sent. Nothing was linked.', false); return show('Not linked.', false); }
    step('Signed in. The authorization server sent back a one-time code.');
    const res = await fetch('/oauth/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code: q.get('code'), redirect_uri: HERE, client_id: CLIENT, code_verifier: kept.verifier, resource: `${location.origin}/mcp` }) });
    const t = await res.json();
    if (!res.ok) { step(`The code could not be exchanged: ${t.error_description || t.error}`, false); return show('Not linked.', false); }
    step('Exchanged the code and the PKCE verifier for an access token and a refresh token.');
    localStorage.setItem('rc-link', JSON.stringify({ access: t.access_token, refresh: t.refresh_token, until: Date.now() + t.expires_in * 1000 }));
    step('Every MCP call from the simulator now carries the access token. Your list belongs to your account.');
    show('Linked. Go back to the simulator and your list will follow your account.', true);
  }

  $('go').addEventListener('click', () => { start().catch(() => show('This browser cannot run the linking flow.', false)); });
  $('unlink').addEventListener('click', () => { localStorage.removeItem('rc-link'); $('flow').replaceChildren(); show('Not linked. The simulator is using a list kept for this browser only.', false); });

  const q = new URLSearchParams(location.search);
  if (q.has('code') || q.has('error')) finish(q).catch(() => { step('The token request failed.', false); show('Not linked.', false); });
  else if (localStorage.getItem('rc-link')) show('Linked. The simulator is using your account.', true);
  else show('Not linked. The simulator is using a list kept for this browser only.', false);
})();
