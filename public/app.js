/* Simulated Alexa+ front end. All text from the server is set with textContent; nothing is inserted as HTML. */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };

  const TRY = ['Add my Cosori air fryer, model CP158-AF', 'I drive a 2020 Honda Civic', 'Add my Peloton treadmill', 'Is anything I own recalled?', 'What should I do about the air fryer?', 'I got the replacement', 'Is the Fisher-Price Rock n Play recalled?', 'What are you watching?'];
  const LIMIT_MS = 500;

  // Each browser gets its own household, so visitors to the demo do not share a list.
  let household;
  try { household = localStorage.getItem('rc-household'); } catch { /* storage blocked */ }
  if (!household || !/^[A-Za-z0-9_-]{16,64}$/.test(household)) {
    household = Array.from(crypto.getRandomValues(new Uint8Array(18)), (b) => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'[b % 64]).join('');
    try { localStorage.setItem('rc-household', household); } catch { /* keep it for this visit only */ }
  }

  const bar = $('lightbar'), home = $('home'), talk = $('talk'), heard = $('heard'), said = $('said'), cards = $('cards');
  const form = $('ask'), input = $('text'), send = $('send'), mic = $('mic'), voice = $('voice');
  let busy = false;

  // clock and rotating hint on the home screen
  const tick = () => { $('clock').textContent = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); };
  tick(); setInterval(tick, 15000);
  let hint = 0;
  setInterval(() => { if (home.hidden) return; hint = (hint + 1) % TRY.length; const h = $('hintLine'); h.style.opacity = '0'; setTimeout(() => { h.textContent = `“Alexa, ${TRY[hint][0].toLowerCase()}${TRY[hint].slice(1)}”`; h.style.opacity = '1'; }, 400); }, 5000);

  for (const t of TRY) { const b = el('button', 'chip', t); b.type = 'button'; b.addEventListener('click', () => ask(t)); $('chips').append(b); }

  function speak(text) {
    if (!voice.checked || !('speechSynthesis' in window)) { bar.dataset.state = 'idle'; return; }
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US'; u.rate = 1.02;
    const v = speechSynthesis.getVoices().find((x) => /en-US/i.test(x.lang) && /female|samantha|aria|jenny|zira|google us/i.test(x.name));
    if (v) u.voice = v;
    u.onstart = () => { bar.dataset.state = 'speaking'; };
    u.onend = u.onerror = () => { bar.dataset.state = 'idle'; };
    speechSynthesis.speak(u);
  }

  const niceDate = (iso) => { const d = new Date(`${iso}T00:00:00`); return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }); };
  const CONF = { confirmed: 'Model matches', likely: 'Likely yours', possible: 'Check the label' };

  function card(c) {
    const n = el('article', `card${c.urgent ? ' urgent' : ''}`);
    if (c.kind === 'items') {
      n.append(el('h3', '', c.title));
      const ul = el('ul'); for (const i of c.items || []) ul.append(el('li', '', i)); n.append(ul);
      return n;
    }
    if (c.kind === 'note') { n.append(el('div', 'label', c.title), el('p', '', c.text || '')); return n; }
    const top = el('div', 'card-top');
    if (c.urgent) top.append(el('span', 'tag stop', 'Stop using'));
    if (c.confidence) top.append(el('span', `tag ${c.confidence}`, CONF[c.confidence] || c.confidence));
    if (c.agency) top.append(el('span', 'tag', [c.agency, niceDate(c.date)].filter(Boolean).join(' · ')));
    n.append(top);
    if (c.item) n.append(el('div', 'for', `Your ${c.item}`));
    n.append(el('h3', '', c.title));
    if (c.text) n.append(el('div', 'label', 'The hazard'), el('p', '', c.text));
    if (c.remedy) n.append(el('div', 'label', 'What to do'), el('p', '', c.remedy));
    if (typeof c.url === 'string' && /^https:\/\//.test(c.url)) { const a = el('a', '', 'Official notice'); a.href = c.url; a.target = '_blank'; a.rel = 'noopener noreferrer'; n.append(a); }
    return n;
  }

  function trace(t) {
    const steps = $('steps'); steps.replaceChildren();
    $('traceEmpty').hidden = t.trace.length > 0;
    $('traceEmpty').textContent = t.trace.length ? '' : 'No tool call was needed for that.';
    for (const s of t.trace) {
      const li = el('li', `step${s.ok ? '' : ' failed'}`);
      const head = el('div', 'step-head');
      head.append(el('span', 'step-name', s.tool), el('span', `step-ms${s.ms > LIMIT_MS ? ' slow' : ''}`, `${s.ms} ms`));
      li.append(head);
      if (Object.keys(s.args).length) li.append(el('pre', '', JSON.stringify(s.args, null, 1).replace(/^\{\n|\n\}$/g, '').replace(/^ /gm, '')));
      steps.append(li);
    }
    const meter = $('meter');
    meter.hidden = !t.trace.length;
    if (t.trace.length) {
      const worst = Math.max(...t.trace.map((s) => s.ms));
      $('meterMs').textContent = `${worst} ms`;
      $('meterMs').className = worst > LIMIT_MS ? 'slow' : '';
      $('meterFill').style.width = `${Math.min(100, (worst / LIMIT_MS) * 100)}%`;
      $('meterFill').className = `meter-fill${worst > LIMIT_MS ? ' slow' : ''}`;
    }
  }

  async function ask(text) {
    text = (text || '').trim();
    if (!text || busy) return;
    busy = true; send.disabled = true; input.value = '';
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    home.hidden = true; talk.hidden = false;
    heard.textContent = text; said.textContent = 'One moment'; said.className = 'said thinking'; cards.replaceChildren();
    bar.dataset.state = 'thinking';
    try {
      const res = await fetch('sim/turn', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ household, text }) });
      const t = await res.json();
      if (!res.ok) throw new Error(t.error || 'The simulator is not answering.');
      said.className = t.speech.length > 220 ? 'said long' : 'said'; said.textContent = t.speech;
      cards.replaceChildren(...t.cards.map(card));
      trace(t);
      speak(t.speech);
    } catch (e) {
      said.className = 'said'; said.textContent = e.message || 'Something went wrong. Please try again.';
      bar.dataset.state = 'idle';
    } finally { busy = false; send.disabled = false; if (matchMedia('(pointer: fine)').matches) input.focus(); }
  }

  form.addEventListener('submit', (e) => { e.preventDefault(); ask(input.value); });

  // speech input, where the browser has it
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { mic.disabled = true; mic.title = 'This browser has no speech input. Type instead.'; }
  else {
    const rec = new SR(); rec.lang = 'en-US'; rec.interimResults = true; rec.maxAlternatives = 1;
    let listening = false, finalText = '';
    const stop = () => { listening = false; mic.setAttribute('aria-pressed', 'false'); if (bar.dataset.state === 'listening') bar.dataset.state = 'idle'; };
    rec.onresult = (e) => { let s = ''; for (const r of e.results) s += r[0].transcript; input.value = s; if (e.results[e.results.length - 1].isFinal) finalText = s; };
    rec.onend = () => { stop(); if (finalText) { const t = finalText; finalText = ''; ask(t); } };
    rec.onerror = (e) => { stop(); if (e.error === 'not-allowed') { mic.disabled = true; mic.title = 'Microphone access was refused. Type instead.'; } };
    mic.addEventListener('click', () => {
      if (listening) { rec.stop(); return; }
      if ('speechSynthesis' in window) speechSynthesis.cancel();
      finalText = ''; try { rec.start(); listening = true; mic.setAttribute('aria-pressed', 'true'); bar.dataset.state = 'listening'; } catch { stop(); }
    });
  }

  $('reset').addEventListener('click', async () => {
    if (!confirm('Empty your list and start over?')) return;
    const id = Array.from(crypto.getRandomValues(new Uint8Array(18)), (b) => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'[b % 64]).join('');
    try { await fetch('sim/reset', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ household }) }); } catch { /* the new household is empty either way */ }
    household = id; try { localStorage.setItem('rc-household', id); } catch { /* fine */ }
    talk.hidden = true; home.hidden = false; $('steps').replaceChildren(); $('meter').hidden = true; $('traceEmpty').hidden = false; $('traceEmpty').textContent = 'Ask something and the tool calls appear here.';
    if ('speechSynthesis' in window) speechSynthesis.cancel(); bar.dataset.state = 'idle';
  });

  fetch('sim/info').then((r) => r.json()).then((i) => {
    $('status').textContent = `${i.recalls.toLocaleString('en-US')} recalls loaded`;
    const facts = $('facts'); facts.replaceChildren();
    const row = (k, v) => facts.append(el('dt', '', k), el('dd', '', v));
    row('Assistant', i.brain === 'model' ? 'Language model' : 'Built-in rules');
    for (const [k, v] of Object.entries(i.counts || {})) row(k, Number(v).toLocaleString('en-US'));
    row('Vehicles', 'Live from NHTSA');
    if (i.dataBuiltAt) row('Data as of', new Date(i.dataBuiltAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }));
  }).catch(() => { $('status').textContent = 'Not connected'; });
})();
