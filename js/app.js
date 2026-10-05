/* CryptoChat — aplicação principal */
(function () {
  'use strict';

  const $  = sel => document.querySelector(sel);
  const $$ = sel => Array.from(document.querySelectorAll(sel));

  const { deriveKey, encrypt, decrypt, pairSecret } = window.CryptoChat;
  const Store = window.Store;
  const Peers = window.Peers;

  const state = {
    screen: 'home',
    normal: {
      identity: null,
      peer: null,
      contacts: [],
      connections: {},
      keys: {},
      active: null,
      messages: {}
    },
    private: {
      code: null,
      peer: null,
      connection: null,
      key: null,
      messages: [],
      connected: false,
      effectiveCode: null
    }
  };

  /* ---------- Utilidades ---------- */
  let toastTimer;
  function toast(text) {
    const el = $('#toast');
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
  }
  const fmtTime = ts => new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const initials = code => String(code).replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase();
  const uid = () => crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36);
  const normalizeCode = s => String(s || '').trim().toUpperCase().replace(/\s+/g, '');

  function formatCode(s) {
    s = String(s).replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    if (s.length === 8) return s.slice(0, 4) + '-' + s.slice(4);
    return s;
  }

  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; }
    catch (e) {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch (_) {}
      document.body.removeChild(ta);
      return true;
    }
  }

  function setStatus(el, on) { el.classList.toggle('on', !!on); }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  const svgChat = () => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-12 6.9L4 20l1.1-4A8 8 0 1 1 21 12z"/><path d="M8.5 11h7M8.5 14h4"/></svg>`;
  const svgGhost = () => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="10" r="5.5"/><path d="M8.5 14.5 7 21l5-2.2L17 21l-1.5-6.5"/></svg>`;

  /* ---------- Navegação ---------- */
  function goto(screen) {
    state.screen = screen;
    $$('.screen').forEach(s => s.classList.remove('active'));
    const el = document.getElementById('screen-' + screen);
    if (el) el.classList.add('active');
  }

  document.querySelectorAll('[data-nav]').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.nav;
      if (target === 'normal')  initNormal();
      if (target === 'private') initPrivate();
    });
  });
  document.querySelectorAll('[data-back]').forEach(btn => {
    btn.addEventListener('click', () => goto('home'));
  });

  /* ============================================================
     MODO NORMAL
     ============================================================ */
  async function initNormal() {
    goto('normal');

    state.normal.identity = Store.getIdentity();
    $('#norm-id').textContent = state.normal.identity;

    state.normal.contacts = Store.getContacts();
    state.normal.messages = {};
    state.normal.contacts.forEach(c => {
      state.normal.messages[c.code] = Store.getMessages(c.code);
    });
    if (!state.normal.active && state.normal.contacts.length) {
      state.normal.active = state.normal.contacts[0].code;
    }

    renderContacts();
    renderNormalChat();
    updateNormalComposer();

    if (!state.normal.peer) {
      setStatus($('#norm-status'), false);
      try {
        const peer = await Peers.create('n', state.normal.identity);
        state.normal.peer = peer;
        peer.on('connection', onNormalIncoming);
        peer.on('disconnected', () => { try { peer.reconnect(); } catch (e) {} });
        peer.on('error', () => setStatus($('#norm-status'), false));
        setStatus($('#norm-status'), true);
        reconnectAll();
      } catch (e) {
        setStatus($('#norm-status'), false);
        toast('Sem conexão P2P no momento');
      }
    } else {
      setStatus($('#norm-status'), true);
    }
  }

  function reconnectAll() {
    state.normal.contacts.forEach(c => {
      if (!state.normal.connections[c.code] || state.normal.connections[c.code].closed) {
        connectToContact(c.code);
      }
    });
  }
  setInterval(() => {
    if (state.screen !== 'normal' || !state.normal.peer) return;
    reconnectAll();
  }, 20000);

  async function ensureKey(code) {
    if (state.normal.keys[code]) return state.normal.keys[code];
    const key = await deriveKey(pairSecret(state.normal.identity, code));
    state.normal.keys[code] = key;
    return key;
  }

  async function connectToContact(code) {
    const existing = state.normal.connections[code];
    if (existing && !existing.closed && existing.open) return existing;
    const peer = state.normal.peer;
    if (!peer || peer.destroyed) return null;
    try {
      const conn = peer.connect(Peers.makeId('n', code), { reliable: true });
      conn._ccCode = code;
      setupNormalConnection(conn, code);
      return conn;
    } catch (e) { return null; }
  }

  function onNormalIncoming(conn) {
    const remoteId = conn.peer || '';
    const prefix = Peers.makeId('n', '');
    let raw = remoteId.startsWith(prefix) ? remoteId.slice(prefix.length) : '';
    const code = formatCode(raw);
    if (!code) { try { conn.close(); } catch (e) {} return; }

    if (!state.normal.contacts.find(c => c.code === code)) {
      state.normal.contacts.push({ code, online: false });
      Store.saveContacts(state.normal.contacts);
      state.normal.messages[code] = Store.getMessages(code);
      renderContacts();
      toast('Novo contato: ' + code);
    }

    const existing = state.normal.connections[code];
    if (existing && !existing.closed && existing.open) {
      try { conn.close(); } catch (e) {}
      return;
    }
    conn._ccCode = code;
    setupNormalConnection(conn, code);
  }

  function setupNormalConnection(conn, code) {
    state.normal.connections[code] = conn;

    const markOnline = on => {
      const c = state.normal.contacts.find(x => x.code === code);
      if (c) { c.online = on; renderContacts(); }
    };

    conn.on('open', () => {
      try { conn.send({ t: 'hello', code: state.normal.identity }); } catch (e) {}
      markOnline(true);
    });
    conn.on('data', async data => {
      if (!data) return;
      if (data.t === 'hello') { markOnline(true); return; }
      if (data.t === 'msg')  { await receiveNormalMessage(code, data); }
    });
    conn.on('close', () => { markOnline(false); delete state.normal.connections[code]; });
    conn.on('error', () => { markOnline(false); });

    if (conn.open) { try { conn.send({ t: 'hello', code: state.normal.identity }); } catch (e) {} markOnline(true); }

    // fallback: se não abrir em 8s, marca offline
    setTimeout(() => {
      if (!conn.open) {
        markOnline(false);
        try { conn.close(); } catch (e) {}
      }
    }, 8000);
  }

  async function receiveNormalMessage(fromCode, packet) {
    const key = await ensureKey(fromCode);
    let payload;
    try { payload = await decrypt(key, packet.p); }
    catch (e) { payload = { x: '[não foi possível decifrar]', erro: true }; }

    const msg = { id: packet.id, ts: packet.ts, from: fromCode, mine: false, text: payload.x, erro: payload.erro };
    if (!state.normal.messages[fromCode]) state.normal.messages[fromCode] = [];
    if (state.normal.messages[fromCode].some(m => m.id === msg.id)) return;
    state.normal.messages[fromCode].push(msg);
    Store.saveMessages(fromCode, state.normal.messages[fromCode]);

    if (state.normal.active === fromCode && state.screen === 'normal') {
      renderNormalChat();
    } else {
      const chip = document.querySelector(`.contact-chip[data-code="${fromCode}"]`);
      if (chip) chip.classList.add('ping');
    }
  }

  async function sendNormal() {
    const input = $('#norm-input');
    const text = input.value.trim();
    if (!text) return;
    if (!state.normal.active) { toast('Adicione um contato primeiro'); return; }

    const code = state.normal.active;
    const conn = await connectToContact(code);
    if (!conn || !conn.open) { toast('Contato offline'); return; }

    const key = await ensureKey(code);
    const id = uid();
    const ts = Date.now();
    const payload = await encrypt(key, { x: text, t: ts });

    try { conn.send({ t: 'msg', id, ts, p: payload }); }
    catch (e) { toast('Falha ao enviar'); return; }

    state.normal.messages[code].push({ id, ts, from: state.normal.identity, mine: true, text });
    Store.saveMessages(code, state.normal.messages[code]);
    input.value = '';
    renderNormalChat();
  }

  function renderContacts() {
    const wrap = $('#norm-contacts');
    wrap.innerHTML = '';
    state.normal.contacts.forEach(c => {
      const btn = document.createElement('button');
      btn.className = 'contact-chip'
        + (state.normal.active === c.code ? ' on' : '')
        + (c.online ? ' online' : '');
      btn.dataset.code = c.code;
      btn.innerHTML = `
        <span class="contact-avatar">
          ${initials(c.code)}
          <span class="dot"></span>
        </span>
        <span class="contact-name">${escapeHtml(c.code)}</span>`;
      btn.addEventListener('click', () => {
        state.normal.active = c.code;
        renderContacts();
        renderNormalChat();
        updateNormalComposer();
      });
      wrap.appendChild(btn);
    });
  }

  function renderNormalChat() {
    const wrap = $('#norm-chat');
    wrap.innerHTML = '';

    if (!state.normal.active) {
      wrap.innerHTML = `<div class="empty-state">${svgChat()}<h3>Nenhuma conversa</h3><p>Adicione um contato pelo código para começar.</p></div>`;
      return;
    }
    const msgs = state.normal.messages[state.normal.active] || [];
    if (!msgs.length) {
      wrap.innerHTML = `<div class="empty-state">${svgChat()}<h3>Conversa vazia</h3><p>Diga olá para <b>${escapeHtml(state.normal.active)}</b>.</p></div>`;
      return;
    }
    const frag = document.createDocumentFragment();
    msgs.forEach(m => frag.appendChild(renderMsg(m, state.normal.active)));
    wrap.appendChild(frag);
    wrap.scrollTop = wrap.scrollHeight;
  }

  function renderMsg(m, contactCode) {
    const el = document.createElement('div');
    el.className = 'msg ' + (m.mine ? 'mine' : 'theirs') + (m.erro ? ' sys' : '');
    const who = document.createElement('div');
    who.className = 'msg-who';
    who.textContent = (m.mine ? 'Você' : contactCode) + ' · ' + fmtTime(m.ts);
    const bubble = document.createElement('div');
    bubble.className = 'msg-bubble';
    bubble.textContent = m.text;
    el.appendChild(who);
    el.appendChild(bubble);
    return el;
  }

  function updateNormalComposer() {
    const input = $('#norm-input');
    const btn = $('#norm-send');
    const enabled = !!state.normal.active;
    input.disabled = !enabled;
    btn.disabled = !enabled;
    input.placeholder = enabled ? 'Mensagem para ' + state.normal.active : 'Adicione um contato para conversar';
  }

  /* ---------- Adicionar contato ---------- */
  function openAddModal() {
    $('#modal-back').classList.add('open');
    $('#modal-input').value = '';
    setTimeout(() => $('#modal-input').focus(), 320);
  }
  function closeAddModal() { $('#modal-back').classList.remove('open'); }

  async function confirmAddContact() {
    const code = normalizeCode($('#modal-input').value);
    if (!code || code.length < 4) { toast('Código inválido'); return; }
    if (code === state.normal.identity) { toast('Esse é o seu próprio código'); return; }
    if (state.normal.contacts.find(c => c.code === code)) { toast('Contato já adicionado'); closeAddModal(); return; }

    state.normal.contacts.push({ code, online: false });
    Store.saveContacts(state.normal.contacts);
    state.normal.messages[code] = Store.getMessages(code);
    state.normal.active = code;

    renderContacts();
    renderNormalChat();
    updateNormalComposer();
    closeAddModal();
    toast('Conectando a ' + code + '…');

    const conn = await connectToContact(code);
    if (!conn) toast('Não foi possível conectar agora');
  }

  /* ============================================================
     MODO PRIVADO
     ============================================================ */
  async function initPrivate() {
    goto('private');

    state.private.code = Store.getPrivateCode();
    state.private.effectiveCode = state.private.code;
    $('#priv-code').textContent = state.private.code;

    state.private.messages = Store.getPrivateMessages();

    $('#priv-connect').classList.remove('hidden');
    $('#priv-chat').classList.add('hidden');
    $('#priv-composer').classList.add('hidden');
    $('#priv-hint').textContent = 'Aguardando alguém conectar…';
    setStatus($('#priv-status'), false);

    if (state.private.peer) { try { state.private.peer.destroy(); } catch (e) {} state.private.peer = null; }

    try {
      const peer = await Peers.create('p', state.private.code);
      state.private.peer = peer;
      setStatus($('#priv-status'), true);
      peer.on('connection', onPrivateIncoming);
      peer.on('disconnected', () => { try { peer.reconnect(); } catch (e) {} });
      peer.on('error', () => setStatus($('#priv-status'), false));
    } catch (e) {
      toast('Não foi possível criar a sala agora');
      setStatus($('#priv-status'), false);
    }
  }

  function onPrivateIncoming(conn) {
    if (state.private.connection && !state.private.connection.closed) {
      try { conn.close(); } catch (e) {}
      return;
    }
    state.private.effectiveCode = state.private.code;
    setupPrivateConnection(conn);
  }

  function setupPrivateConnection(conn) {
    state.private.connection = conn;

    conn.on('open', async () => {
      const shared = state.private.effectiveCode || state.private.code;
      state.private.key = await deriveKey('priv::' + shared);
      state.private.connected = true;
      setStatus($('#priv-status'), true);

      $('#priv-connect').classList.add('hidden');
      $('#priv-chat').classList.remove('hidden');
      $('#priv-composer').classList.remove('hidden');

      if (!state.private.messages.length) {
        pushSystemMsg('Conectado. Conversa efêmera — some ao fechar.');
      }
      renderPrivateChat();
      setTimeout(() => $('#priv-input-msg').focus(), 380);
    });

    conn.on('data', async data => {
      if (!data || data.t !== 'msg') return;
      await receivePrivateMessage(data);
    });

    conn.on('close', () => {
      state.private.connected = false;
      setStatus($('#priv-status'), false);
      if (state.private.messages.length) pushSystemMsg('Conexão encerrada.');
    });
    conn.on('error', () => { state.private.connected = false; setStatus($('#priv-status'), false); });
  }

  async function joinPrivate(rawCode) {
    const code = normalizeCode(rawCode);
    if (!code || code.length < 4) { toast('Código inválido'); return; }
    if (code === state.private.code) { toast('Esse é o seu próprio código'); return; }
    if (state.private.connection && !state.private.connection.closed) { toast('Já conectado'); return; }

    const peer = state.private.peer;
    if (!peer) { toast('Sem conexão'); return; }

    toast('Conectando…');
    try {
      const conn = peer.connect(Peers.makeId('p', code), { reliable: true });
      state.private.effectiveCode = code;
      setupPrivateConnection(conn);
    } catch (e) { toast('Falha ao conectar'); }
  }

  async function receivePrivateMessage(packet) {
    if (!state.private.key) return;
    let payload;
    try { payload = await decrypt(state.private.key, packet.p); }
    catch (e) { payload = { x: '[falha ao decifrar]', erro: true }; }
    state.private.messages.push({ id: packet.id, ts: packet.ts, mine: false, text: payload.x, erro: payload.erro });
    Store.savePrivateMessages(state.private.messages);
    renderPrivateChat();
  }

  async function sendPrivate() {
    const input = $('#priv-input-msg');
    const text = input.value.trim();
    if (!text) return;
    const conn = state.private.connection;
    if (!conn || !conn.open) { toast('Sem conexão'); return; }

    const id = uid();
    const ts = Date.now();
    const payload = await encrypt(state.private.key, { x: text, t: ts });
    try { conn.send({ t: 'msg', id, ts, p: payload }); }
    catch (e) { toast('Falha ao enviar'); return; }

    state.private.messages.push({ id, ts, mine: true, text });
    Store.savePrivateMessages(state.private.messages);
    input.value = '';
    renderPrivateChat();
  }

  function renderPrivateChat() {
    const wrap = $('#priv-messages');
    wrap.innerHTML = '';
    if (!state.private.messages.length) {
      wrap.innerHTML = `<div class="empty-state">${svgGhost()}<h3>Conversa vazia</h3><p>Mensagens somem quando o site for fechado.</p></div>`;
      return;
    }
    const frag = document.createDocumentFragment();
    state.private.messages.forEach(m => {
      const el = document.createElement('div');
      el.className = 'msg ' + (m.sys ? 'sys' : (m.mine ? 'mine' : 'theirs')) + (m.erro ? ' sys' : '');
      if (!m.sys) {
        const who = document.createElement('div');
        who.className = 'msg-who';
        who.textContent = (m.mine ? 'Você' : 'Parceiro') + ' · ' + fmtTime(m.ts);
        el.appendChild(who);
      }
      const bubble = document.createElement('div');
      bubble.className = 'msg-bubble';
      bubble.textContent = m.text;
      el.appendChild(bubble);
      frag.appendChild(el);
    });
    wrap.appendChild(frag);
    wrap.scrollTop = wrap.scrollHeight;
  }

  function pushSystemMsg(text) {
    state.private.messages.push({ id: uid(), ts: Date.now(), sys: true, text });
    Store.savePrivateMessages(state.private.messages);
    renderPrivateChat();
  }

  /* ============================================================
     EVENTOS
     ============================================================ */
  $('#norm-copy').addEventListener('click', async () => {
    await copyText(state.normal.identity);
    toast('Código copiado');
  });
  $('#norm-add').addEventListener('click', openAddModal);
  $('#norm-send').addEventListener('click', sendNormal);
  $('#norm-input').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); sendNormal(); } });

  $('#modal-cancel').addEventListener('click', closeAddModal);
  $('#modal-confirm').addEventListener('click', confirmAddContact);
  $('#modal-input').addEventListener('keydown', e => {
    if (e.key === 'Enter')  { e.preventDefault(); confirmAddContact(); }
    if (e.key === 'Escape') closeAddModal();
  });
  $('#modal-back').addEventListener('click', e => { if (e.target === $('#modal-back')) closeAddModal(); });

  $('#priv-copy').addEventListener('click', async () => {
    await copyText(state.private.code);
    toast('Código copiado');
  });
  $('#priv-join').addEventListener('click', () => joinPrivate($('#priv-input').value));
  $('#priv-input').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); joinPrivate($('#priv-input').value); } });
  $('#priv-send').addEventListener('click', sendPrivate);
  $('#priv-input-msg').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); sendPrivate(); } });

  if (!crypto.subtle) setTimeout(() => toast('Criptografia indisponível. Use HTTPS.'), 600);
})();
