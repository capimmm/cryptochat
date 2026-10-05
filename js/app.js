/* CryptoChat — app principal */
(function () {
  'use strict';

  const $  = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));

  const { deriveKey, encrypt, decrypt, pairSecret } = window.CryptoChat;
  const Store = window.Store;
  const Peers = window.Peers;

  const state = {
    screen: 'home',
    normal: { identity:null, peer:null, contacts:[], connections:{}, keys:{}, active:null, messages:{} },
    priv: {
      code:null, peer:null, connection:null, key:null, messages:[],
      connected:false, remoteId:null,
      call:null, localStream:null, screenStream:null, callTimer:null, callStart:null,
      callKind:null, muted:false, videoOff:false,
      recording:false, recorder:null, recChunks:[], recStart:0, recTimer:null
    }
  };

  /* ---------- helpers ---------- */
  let toastT;
  const toast = t => {
    const el = $('#toast'); el.textContent = t; el.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('show'), 2800);
  };
  const fmtTime = ts => new Date(ts).toLocaleTimeString('pt-BR', {hour:'2-digit',minute:'2-digit'});
  const fmtDur  = s  => { s = Math.max(0,Math.floor(s)); return String(Math.floor(s/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0'); };
  const initials = c => String(c).replace(/[^A-Za-z0-9]/g,'').slice(0,2).toUpperCase() || '··';
  const uid = () => crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)+Date.now().toString(36);
  const normCode = s => String(s||'').trim().toUpperCase().replace(/\s+/g,'');
  const fmtCode = s => { s = s.replace(/[^A-Za-z0-9]/g,'').toUpperCase(); return s.length===8 ? s.slice(0,4)+'-'+s.slice(4) : s; };
  const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  async function copyText(t) {
    try { await navigator.clipboard.writeText(t); return true; }
    catch (e) {
      const ta = document.createElement('textarea'); ta.value=t; ta.style.position='fixed'; ta.style.opacity='0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch (_){}
      document.body.removeChild(ta); return true;
    }
  }

  const setStatus = (el,on) => el.classList.toggle('on',!!on);
  const svgChat = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-12 6.9L4 20l1.1-4A8 8 0 1 1 21 12z"/><path d="M8.5 11h7M8.5 14h4"/></svg>`;
  const svgGhost = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="10" r="5.5"/><path d="M8.5 14.5 7 21l5-2.2L17 21l-1.5-6.5"/></svg>`;

  /* ---------- navegação ---------- */
  function goto(screen) {
    state.screen = screen;
    $$('.screen').forEach(s => s.classList.remove('active'));
    const el = document.getElementById('screen-' + screen);
    if (el) el.classList.add('active');
  }
  $$('[data-nav]').forEach(b => b.addEventListener('click', () => {
    const t = b.dataset.nav;
    if (t === 'normal')  initNormal();
    if (t === 'private') initPrivate();
  }));
  $$('[data-back]').forEach(b => b.addEventListener('click', () => goto('home')));

  /* ============================================================
     MODO NORMAL
     ============================================================ */
  async function initNormal() {
    goto('normal');
    state.normal.identity = Store.getIdentity();
    $('#norm-id').textContent = state.normal.identity;

    state.normal.contacts = Store.getContacts();
    state.normal.messages = {};
    state.normal.contacts.forEach(c => state.normal.messages[c.code] = Store.getMessages(c.code));
    if (!state.normal.active && state.normal.contacts.length) state.normal.active = state.normal.contacts[0].code;

    renderContacts(); renderNormalChat(); updateNormalComposer();

    if (!state.normal.peer) {
      setStatus($('#norm-status'), false);
      try {
        const p = await Peers.create('n', state.normal.identity);
        state.normal.peer = p;
        p.on('connection', onNormalIncoming);
        p.on('disconnected', () => { try { p.reconnect(); } catch (e) {} });
        p.on('error', () => setStatus($('#norm-status'), false));
        setStatus($('#norm-status'), true);
        reconnectAll();
      } catch (e) {
        toast('Sem conexão P2P');
      }
    } else setStatus($('#norm-status'), true);
  }

  function reconnectAll() {
    state.normal.contacts.forEach(c => {
      const cur = state.normal.connections[c.code];
      if (!cur || cur.closed) connectToContact(c.code);
    });
  }
  setInterval(() => { if (state.screen === 'normal' && state.normal.peer) reconnectAll(); }, 18000);

  async function ensureKey(code) {
    if (state.normal.keys[code]) return state.normal.keys[code];
    const k = await deriveKey(pairSecret(state.normal.identity, code));
    state.normal.keys[code] = k; return k;
  }

  async function connectToContact(code) {
    const ex = state.normal.connections[code];
    if (ex && !ex.closed && ex.open) return ex;
    const p = state.normal.peer;
    if (!p || p.destroyed) return null;
    try {
      const conn = p.connect(Peers.makeId('n', code), { reliable: true });
      conn._cc = code; setupNormalConn(conn, code); return conn;
    } catch (e) { return null; }
  }

  function onNormalIncoming(conn) {
    const rid = conn.peer || '';
    const pre = Peers.makeId('n','');
    let raw = rid.startsWith(pre) ? rid.slice(pre.length) : '';
    const code = fmtCode(raw);
    if (!code) { try { conn.close(); } catch(e){} return; }
    if (!state.normal.contacts.find(c => c.code === code)) {
      state.normal.contacts.push({ code, online:false });
      Store.saveContacts(state.normal.contacts);
      state.normal.messages[code] = Store.getMessages(code);
      renderContacts();
      toast('Novo contato: ' + code);
    }
    const ex = state.normal.connections[code];
    if (ex && !ex.closed && ex.open) { try { conn.close(); } catch(e){} return; }
    conn._cc = code; setupNormalConn(conn, code);
  }

  function setupNormalConn(conn, code) {
    state.normal.connections[code] = conn;
    const mark = on => {
      const c = state.normal.contacts.find(x => x.code === code);
      if (c) { c.online = on; renderContacts(); }
    };
    conn.on('open', () => { try { conn.send({t:'hello', code:state.normal.identity}); } catch(e){} mark(true); });
    conn.on('data', async d => {
      if (!d) return;
      if (d.t === 'hello') { mark(true); return; }
      if (d.t === 'msg') await receiveNormal(code, d);
    });
    conn.on('close', () => { mark(false); delete state.normal.connections[code]; });
    conn.on('error', () => mark(false));
    if (conn.open) { try { conn.send({t:'hello', code:state.normal.identity}); } catch(e){} mark(true); }
    setTimeout(() => { if (!conn.open) { mark(false); try { conn.close(); } catch(e){} } }, 8000);
  }

  async function receiveNormal(from, packet) {
    const key = await ensureKey(from);
    let pl;
    try { pl = await decrypt(key, packet.p); }
    catch (e) { pl = { x:'[indecifrável]', erro:true }; }
    const msg = { id:packet.id, ts:packet.ts, mine:false, text:pl.x, erro:pl.erro };
    if (!state.normal.messages[from]) state.normal.messages[from] = [];
    if (state.normal.messages[from].some(m => m.id === msg.id)) return;
    state.normal.messages[from].push(msg);
    Store.saveMessages(from, state.normal.messages[from]);
    if (state.normal.active === from && state.screen === 'normal') renderNormalChat();
    else {
      const chip = document.querySelector(`.contact-chip[data-code="${from}"]`);
      if (chip) chip.classList.add('ping');
    }
  }

  async function sendNormal() {
    const inp = $('#norm-input'); const text = inp.value.trim();
    if (!text) return;
    if (!state.normal.active) return toast('Adicione um contato primeiro');
    const code = state.normal.active;
    const conn = await connectToContact(code);
    if (!conn || !conn.open) return toast('Contato offline');
    const key = await ensureKey(code);
    const id = uid(), ts = Date.now();
    const p = await encrypt(key, { x:text, t:ts });
    try { conn.send({ t:'msg', id, ts, p }); } catch (e) { return toast('Falha ao enviar'); }
    state.normal.messages[code].push({ id, ts, mine:true, text });
    Store.saveMessages(code, state.normal.messages[code]);
    inp.value = ''; renderNormalChat();
  }

  function renderContacts() {
    const wrap = $('#norm-contacts'); wrap.innerHTML = '';
    state.normal.contacts.forEach(c => {
      const b = document.createElement('button');
      b.className = 'contact-chip' + (state.normal.active === c.code ? ' on' : '') + (c.online ? ' online' : '');
      b.dataset.code = c.code;
      b.innerHTML = `<span class="contact-avatar">${initials(c.code)}<span class="dot"></span></span><span class="contact-name">${esc(c.code)}</span>`;
      b.addEventListener('click', () => {
        state.normal.active = c.code;
        renderContacts(); renderNormalChat(); updateNormalComposer();
      });
      wrap.appendChild(b);
    });
  }

  function renderNormalChat() {
    const w = $('#norm-chat'); w.innerHTML = '';
    if (!state.normal.active) { w.innerHTML = `<div class="empty-state">${svgChat}<h3>Nenhuma conversa</h3><p>Adicione um contato pelo código.</p></div>`; return; }
    const msgs = state.normal.messages[state.normal.active] || [];
    if (!msgs.length) { w.innerHTML = `<div class="empty-state">${svgChat}<h3>Conversa vazia</h3><p>Diga olá para <b>${esc(state.normal.active)}</b>.</p></div>`; return; }
    const frag = document.createDocumentFragment();
    msgs.forEach(m => {
      const el = document.createElement('div');
      el.className = 'msg ' + (m.mine ? 'mine' : 'theirs') + (m.erro ? ' sys' : '');
      const who = document.createElement('div'); who.className = 'msg-who';
      who.textContent = (m.mine ? 'Você' : state.normal.active) + ' · ' + fmtTime(m.ts);
      const bb = document.createElement('div'); bb.className = 'msg-bubble'; bb.textContent = m.text;
      el.appendChild(who); el.appendChild(bb); frag.appendChild(el);
    });
    w.appendChild(frag); w.scrollTop = w.scrollHeight;
  }

  function updateNormalComposer() {
    const inp = $('#norm-input'), btn = $('#norm-send');
    const on = !!state.normal.active;
    inp.disabled = !on; btn.disabled = !on;
    inp.placeholder = on ? 'Mensagem para ' + state.normal.active : 'Adicione um contato';
  }

  /* modal adicionar */
  function openAdd() { $('#modal-back').classList.add('open'); $('#modal-input').value = ''; setTimeout(() => $('#modal-input').focus(), 320); }
  function closeAdd() { $('#modal-back').classList.remove('open'); }
  async function confirmAdd() {
    const code = normCode($('#modal-input').value);
    if (!code || code.length < 4) return toast('Código inválido');
    if (code === state.normal.identity) return toast('Esse é o seu código');
    if (state.normal.contacts.find(c => c.code === code)) { toast('Já adicionado'); return closeAdd(); }
    state.normal.contacts.push({ code, online:false });
    Store.saveContacts(state.normal.contacts);
    state.normal.messages[code] = Store.getMessages(code);
    state.normal.active = code;
    renderContacts(); renderNormalChat(); updateNormalComposer(); closeAdd();
    toast('Conectando…'); await connectToContact(code);
  }

  /* ============================================================
     MODO PRIVADO
     ============================================================ */
  async function initPrivate() {
    goto('private');
    state.priv.code = Store.getPrivateCode();
    state.priv.messages = Store.getPrivateMessages();
    $('#priv-code').textContent = state.priv.code;
    $('#priv-connect').classList.remove('hidden');
    $('#priv-chat').classList.add('hidden');
    $('#priv-composer').classList.add('hidden');
    $('#priv-hint').textContent = 'Aguardando alguém conectar…';
    setStatus($('#priv-status'), false);
    togglePrivateCallButtons(false);

    if (state.priv.peer) { try { state.priv.peer.destroy(); } catch(e){} state.priv.peer = null; }

    try {
      const p = await Peers.create('p', state.priv.code);
      state.priv.peer = p;
      setStatus($('#priv-status'), true);
      p.on('connection', onPrivIncoming);
      p.on('disconnected', () => { try { p.reconnect(); } catch(e){} });
      p.on('error', () => setStatus($('#priv-status'), false));
      // handler de chamada recebida
      p.on('call', onIncomingCall);
    } catch (e) { toast('Não foi possível criar a sala'); setStatus($('#priv-status'), false); }
  }

  function togglePrivateCallButtons(on) {
    ['#priv-call-audio','#priv-call-video','#priv-call-screen'].forEach(s => {
      $(s).classList.toggle('hidden', !on);
    });
  }

  function onPrivIncoming(conn) {
    if (state.priv.connection && !state.priv.connection.closed) { try { conn.close(); } catch(e){} return; }
    setupPrivateConn(conn);
  }

  function setupPrivateConn(conn) {
    state.priv.connection = conn;
    state.priv.remoteId = conn.peer;

    conn.on('open', async () => {
      state.priv.key = await deriveKey('priv::' + state.priv.code);
      state.priv.connected = true;
      setStatus($('#priv-status'), true);
      togglePrivateCallButtons(true);

      $('#priv-connect').classList.add('hidden');
      $('#priv-chat').classList.remove('hidden');
      $('#priv-composer').classList.remove('hidden');
      if (!state.priv.messages.length) pushSys('Conectado. Conversa efêmera.');
      renderPrivateChat();
      setTimeout(() => $('#priv-input-msg').focus(), 420);
    });

    conn.on('data', async d => {
      if (!d) return;
      if (d.t === 'msg')   return receivePrivate(d);
      if (d.t === 'bye')   return endPrivateSession('A outra pessoa saiu.');
      if (d.t === 'call-end') return endCall(false);
    });

    // se um lado cair, ambos desconectam
    conn.on('close', () => endPrivateSession('Conexão encerrada.'));
    conn.on('error', () => endPrivateSession('Erro na conexão.'));
  }

  function endPrivateSession(reason) {
    endCall(true);
    stopRecording(true);
    try { if (state.priv.connection) state.priv.connection.close(); } catch(e){}
    try { if (state.priv.peer) state.priv.peer.destroy(); } catch(e){}
    state.priv.connection = null;
    state.priv.peer = null;
    state.priv.connected = false;
    state.priv.key = null;
    state.priv.messages = [];

    setStatus($('#priv-status'), false);
    togglePrivateCallButtons(false);
    $('#priv-connect').classList.remove('hidden');
    $('#priv-chat').classList.add('hidden');
    $('#priv-composer').classList.add('hidden');
    $('#priv-hint').textContent = 'Aguardando alguém conectar…';

    if (reason) toast(reason);
  }

  async function joinPrivate(raw) {
    const code = normCode(raw);
    if (!code || code.length < 4) return toast('Código inválido');
    if (code === state.priv.code) return toast('Esse é o seu código');
    if (state.priv.connection && !state.priv.connection.closed) return toast('Já conectado');
    const p = state.priv.peer; if (!p) return toast('Sem conexão');
    toast('Conectando…');
    try {
      const conn = p.connect(Peers.makeId('p', code), { reliable: true });
      state.priv.remoteRoomCode = code;
      setupPrivateConn(conn);
      // guardar o código da sala com que estamos falando para re-derivar key
      // (neste caso a key é derivada do NOSSO código, que é a "sala" — a outra pessoa entrou na nossa)
    } catch (e) { toast('Falha ao conectar'); }
  }

  async function receivePrivate(packet) {
    if (!state.priv.key) return;
    let pl;
    try { pl = await decrypt(state.priv.key, packet.p); }
    catch (e) { pl = { type:'text', x:'[falha ao decifrar]', erro:true }; }
    const base = { id:packet.id, ts:packet.ts, mine:false };
    let m;
    if (pl.type === 'image') m = { ...base, type:'image', data:pl.data, mime:pl.mime, caption:pl.caption };
    else if (pl.type === 'voice') m = { ...base, type:'voice', data:pl.data, mime:pl.mime, duration:pl.duration };
    else m = { ...base, type:'text', text:pl.x, erro:pl.erro };
    if (state.priv.messages.some(x => x.id === m.id)) return;
    state.priv.messages.push(m);
    Store.savePrivateMessages(state.priv.messages);
    renderPrivateChat();
  }

  async function sendPrivate() {
    const inp = $('#priv-input-msg'); const text = inp.value.trim();
    if (!text) return;
    const conn = state.priv.connection;
    if (!conn || !conn.open) return toast('Sem conexão');
    const id = uid(), ts = Date.now();
    const p = await encrypt(state.priv.key, { type:'text', x:text, t:ts });
    try { conn.send({ t:'msg', id, ts, p }); } catch (e) { return toast('Falha ao enviar'); }
    state.priv.messages.push({ id, ts, mine:true, type:'text', text });
    Store.savePrivateMessages(state.priv.messages);
    inp.value = ''; renderPrivateChat();
  }

  function pushSys(text) {
    state.priv.messages.push({ id:uid(), ts:Date.now(), sys:true, text, type:'text' });
    Store.savePrivateMessages(state.priv.messages);
    renderPrivateChat();
  }

  function renderPrivateChat() {
    const w = $('#priv-messages'); w.innerHTML = '';
    if (!state.priv.messages.length) {
      w.innerHTML = `<div class="empty-state">${svgGhost}<h3>Conversa vazia</h3><p>Mensagens somem ao fechar o site.</p></div>`;
      return;
    }
    const frag = document.createDocumentFragment();
    state.priv.messages.forEach(m => frag.appendChild(buildMsg(m, true)));
    w.appendChild(frag); w.scrollTop = w.scrollHeight;
  }

  function buildMsg(m, priv) {
    const el = document.createElement('div');
    if (m.sys) { el.className = 'msg sys'; const b = document.createElement('div'); b.className='msg-bubble'; b.textContent = m.text; el.appendChild(b); return el; }

    el.className = 'msg ' + (m.mine ? 'mine' : 'theirs');

    const who = document.createElement('div'); who.className = 'msg-who';
    who.textContent = (m.mine ? 'Você' : 'Parceiro') + ' · ' + fmtTime(m.ts);
    el.appendChild(who);

    if (m.type === 'image') {
      const wrap = document.createElement('div'); wrap.className = 'msg-media';
      const img = document.createElement('img');
      img.src = 'data:' + m.mime + ';base64,' + m.data;
      img.alt = 'Imagem';
      img.addEventListener('click', () => openLightbox(img.src));
      wrap.appendChild(img); el.appendChild(wrap);
      if (m.caption) { const c = document.createElement('div'); c.className='msg-bubble'; c.textContent=m.caption; el.appendChild(c); }
    } else if (m.type === 'voice') {
      const wrap = document.createElement('div');
      wrap.className = 'msg-bubble voice-bubble';
      const btn = document.createElement('button'); btn.className = 'voice-play';
      btn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M6 4l14 8-14 8z"/></svg>`;
      const bars = document.createElement('div'); bars.className = 'voice-bars';
      for (let i = 0; i < 22; i++) {
        const s = document.createElement('span');
        s.style.height = (6 + Math.round(Math.random()*16)) + 'px';
        bars.appendChild(s);
      }
      const dur = document.createElement('span'); dur.className='voice-dur'; dur.textContent = fmtDur(m.duration||0);
      wrap.appendChild(btn); wrap.appendChild(bars); wrap.appendChild(dur);

      const audio = new Audio('data:' + m.mime + ';base64,' + m.data);
      let playing = false;
      const iconPlay  = `<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M6 4l14 8-14 8z"/></svg>`;
      const iconPause = `<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>`;
      btn.addEventListener('click', () => {
        if (playing) { audio.pause(); } else { audio.currentTime = 0; audio.play(); }
      });
      audio.addEventListener('play',  () => { playing = true;  btn.innerHTML = iconPause; });
      audio.addEventListener('pause', () => { playing = false; btn.innerHTML = iconPlay;  });
      audio.addEventListener('ended', () => { playing = false; btn.innerHTML = iconPlay;  });
      el.appendChild(wrap);
    } else {
      const b = document.createElement('div'); b.className = 'msg-bubble'; b.textContent = m.text;
      el.appendChild(b);
    }
    return el;
  }

  /* ---------- Imagem ---------- */
  function pickImage() { $('#priv-file').click(); }
  $('#priv-file').addEventListener('change', async e => {
    const file = e.target.files[0]; e.target.value = '';
    if (!file || !file.type.startsWith('image/')) return;
    toast('Preparando imagem…');
    try {
      const dataUrl = await resizeImage(file, 1280, 0.72);
      const base64 = dataUrl.split(',')[1];
      const mime = dataUrl.split(';')[0].split(':')[1];
      const conn = state.priv.connection;
      if (!conn || !conn.open) return toast('Sem conexão');
      const id = uid(), ts = Date.now();
      const p = await encrypt(state.priv.key, { type:'image', mime, data:base64, t:ts });
      conn.send({ t:'msg', id, ts, p });
      state.priv.messages.push({ id, ts, mine:true, type:'image', mime, data:base64 });
      Store.savePrivateMessages(state.priv.messages);
      renderPrivateChat();
    } catch (err) { toast('Falha ao enviar imagem'); }
  });

  function resizeImage(file, max, quality) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          let { width: w, height: h } = img;
          if (w > max || h > max) {
            if (w > h) { h = Math.round(h * max / w); w = max; }
            else       { w = Math.round(w * max / h); h = max; }
          }
          const c = document.createElement('canvas');
          c.width = w; c.height = h;
          c.getContext('2d').drawImage(img, 0, 0, w, h);
          resolve(c.toDataURL('image/jpeg', quality));
        };
        img.onerror = reject;
        img.src = reader.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function openLightbox(src) { $('#lightbox-img').src = src; $('#lightbox').classList.add('open'); }
  $('#lightbox').addEventListener('click', () => $('#lightbox').classList.remove('open'));

  /* ---------- Voz ---------- */
  async function toggleVoice() {
    if (state.priv.recording) return stopRecording(false);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio:true });
      const mr = new MediaRecorder(stream);
      state.priv.recorder = mr;
      state.priv.recChunks = [];
      mr.ondataavailable = e => { if (e.data.size) state.priv.recChunks.push(e.data); };
      mr.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        clearInterval(state.priv.recTimer);
        $('#priv-voice').classList.remove('recording');
        state.priv.recording = false;
        if (state.priv.cancelRec) { state.priv.cancelRec = false; return; }
        const blob = new Blob(state.priv.recChunks, { type:'audio/webm' });
        if (blob.size < 800) return;
        const duration = (Date.now() - state.priv.recStart) / 1000;
        const b64 = await blobToBase64(blob);
        const mime = 'audio/webm';
        const conn = state.priv.connection;
        if (!conn || !conn.open) return toast('Sem conexão');
        const id = uid(), ts = Date.now();
        const p = await encrypt(state.priv.key, { type:'voice', mime, data:b64, duration, t:ts });
        conn.send({ t:'msg', id, ts, p });
        state.priv.messages.push({ id, ts, mine:true, type:'voice', mime, data:b64, duration });
        Store.savePrivateMessages(state.priv.messages);
        renderPrivateChat();
      };
      mr.start();
      state.priv.recording = true;
      state.priv.recStart = Date.now();
      state.priv.cancelRec = false;
      $('#priv-voice').classList.add('recording');
      toast('Gravando… toque de novo para enviar');
    } catch (e) { toast('Microfone indisponível'); }
  }
  function stopRecording(cancel) {
    if (!state.priv.recording) return;
    state.priv.cancelRec = !!cancel;
    try { state.priv.recorder.stop(); } catch(e){}
  }
  const blobToBase64 = b => new Promise(res => {
    const r = new FileReader();
    r.onload = () => res(r.result.split(',')[1]);
    r.readAsDataURL(b);
  });

  /* ============================================================
     CHAMADAS
     ============================================================ */
  async function startCall(kind) {
    const conn = state.priv.connection;
    if (!conn || !conn.open) return toast('Sem conexão');
    if (state.priv.call) return toast('Chamada já ativa');
    try {
      let stream;
      if (kind === 'audio') stream = await navigator.mediaDevices.getUserMedia({ audio:true, video:false });
      else if (kind === 'video') stream = await navigator.mediaDevices.getUserMedia({ audio:true, video:{ facingMode:'user' } });
      else if (kind === 'screen') stream = await navigator.mediaDevices.getDisplayMedia({ video:true, audio:false });
      state.priv.localStream = stream;
      state.priv.callKind = kind;
      openCallOverlay(kind);

      const call = state.priv.peer.call(state.priv.remoteId, stream);
      if (!call) { toast('Falha na chamada'); return cleanupCall(); }
      state.priv.call = call;
      wireCall(call, kind);
    } catch (e) { toast('Permissão negada ou indisponível'); cleanupCall(); }
  }

  function onIncomingCall(call) {
    if (!state.priv.connected) { try { call.close(); } catch(e){} return; }
    if (state.priv.call) { try { call.close(); } catch(e){} return; }

    const meta = call.metadata || {};
    const kind = meta.kind || 'audio';
    state.priv.call = call;

    (async () => {
      try {
        let stream;
        if (kind === 'audio') stream = await navigator.mediaDevices.getUserMedia({ audio:true, video:false });
        else if (kind === 'video') stream = await navigator.mediaDevices.getUserMedia({ audio:true, video:{ facingMode:'user' } });
        else stream = await navigator.mediaDevices.getUserMedia({ audio:true, video:false }); // screen: só recebe
        state.priv.localStream = stream;
        state.priv.callKind = kind;
        openCallOverlay(kind);
        call.answer(stream);
        wireCall(call, kind);
      } catch (e) { toast('Não foi possível atender'); cleanupCall(); }
    })();
  }

  function wireCall(call, kind) {
    state.priv.callStart = Date.now();
    $('#call-status').textContent = kind === 'screen' ? 'Compartilhando tela' : 'Conectado';
    state.priv.callTimer = setInterval(() => {
      $('#call-duration').textContent = fmtDur((Date.now() - state.priv.callStart)/1000);
    }, 1000);

    call.on('stream', remote => {
      const rv = $('#call-remote-video');
      const ra = $('#call-remote-audio');
      if (kind === 'audio') {
        ra.srcObject = remote;
        $('#call-placeholder').classList.remove('hidden');
        rv.classList.add('hidden');
      } else {
        rv.srcObject = remote;
        rv.classList.remove('hidden');
        $('#call-placeholder').classList.add('hidden');
      }
    });

    // local video preview
    const lv = $('#call-local-video');
    if (state.priv.localStream) lv.srcObject = state.priv.localStream;
    $('#call-local').classList.toggle('audio-only', kind === 'audio');

    call.on('close', () => endCall(false));
    call.on('error', () => endCall(false));

    // botões
    $('#call-mute').classList.toggle('off', false);
    $('#call-video-toggle').classList.toggle('hidden', kind !== 'video');
    $('#call-screen-toggle').classList.toggle('hidden', kind !== 'screen');
  }

  function openCallOverlay(kind) {
    $('#call-overlay').classList.add('open');
    $('#call-status').textContent = kind === 'screen' ? 'Compartilhando tela' : 'Conectando…';
    $('#call-duration').textContent = '00:00';
    $('#call-avatar').textContent = initials(state.priv.code).slice(0,2) || '··';
    $('#call-name').textContent = 'Parceiro';
    $('#call-placeholder').classList.toggle('hidden', kind === 'video');
    $('#call-remote-video').classList.toggle('hidden', kind !== 'video');
    state.priv.muted = false;
    state.priv.videoOff = false;
  }

  function endCall(notify) {
    if (notify) {
      const conn = state.priv.connection;
      if (conn && conn.open) { try { conn.send({ t:'call-end' }); } catch(e){} }
    }
    cleanupCall();
  }

  function cleanupCall() {
    clearInterval(state.priv.callTimer); state.priv.callTimer = null;
    if (state.priv.call) { try { state.priv.call.close(); } catch(e){} state.priv.call = null; }
    if (state.priv.localStream) {
      state.priv.localStream.getTracks().forEach(t => t.stop());
      state.priv.localStream = null;
    }
    $('#call-remote-video').srcObject = null;
    $('#call-remote-audio').srcObject = null;
    $('#call-local-video').srcObject = null;
    $('#call-overlay').classList.remove('open');
    state.priv.callKind = null;
    state.priv.callStart = null;
  }

  function toggleMute() {
    if (!state.priv.localStream) return;
    const track = state.priv.localStream.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    state.priv.muted = !track.enabled;
    $('#call-mute').classList.toggle('off', state.priv.muted);
  }
  function toggleVideo() {
    if (!state.priv.localStream) return;
    const track = state.priv.localStream.getVideoTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    state.priv.videoOff = !track.enabled;
    $('#call-video-toggle').classList.toggle('off', state.priv.videoOff);
  }
  async function swapToScreen() {
    endCall(true);
    setTimeout(() => startCall('screen'), 320);
  }

  /* ============================================================
     QR CODE
     ============================================================ */
  function buildShareUrl() {
    const base = location.origin + location.pathname;
    return base + '?join=' + encodeURIComponent(state.priv.code);
  }
  function openQR() {
    const url = buildShareUrl();
    const wrap = $('#qr-wrap');
    wrap.innerHTML = '';
    try {
      const qr = qrcode(0, 'M');
      qr.addData(url);
      qr.make();
      wrap.innerHTML = qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
    } catch (e) {
      wrap.innerHTML = `<div style="width:220px;height:220px;display:grid;place-items:center;color:#000;font-size:11px;text-align:center;padding:20px">Não foi possível gerar o QR</div>`;
    }
    $('#qr-code-label').textContent = state.priv.code;
    $('#qr-back').classList.add('open');
  }

  /* ============================================================
     EVENTOS
     ============================================================ */
  $('#norm-copy').addEventListener('click', async () => { await copyText(state.normal.identity); toast('Código copiado'); });
  $('#norm-add').addEventListener('click', openAdd);
  $('#norm-send').addEventListener('click', sendNormal);
  $('#norm-input').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); sendNormal(); } });

  $('#modal-cancel').addEventListener('click', closeAdd);
  $('#modal-confirm').addEventListener('click', confirmAdd);
  $('#modal-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); confirmAdd(); }
    if (e.key === 'Escape') closeAdd();
  });
  $('#modal-back').addEventListener('click', e => { if (e.target === $('#modal-back')) closeAdd(); });

  $('#priv-copy').addEventListener('click', async () => { await copyText(state.priv.code); toast('Código copiado'); });
  $('#priv-qr').addEventListener('click', openQR);
  $('#priv-share').addEventListener('click', async () => {
    const url = buildShareUrl();
    if (navigator.share) {
      try { await navigator.share({ title:'CryptoChat', text:'Entra na minha sala privada:', url }); }
      catch (e) {}
    } else { await copyText(url); toast('Link copiado'); }
  });
  $('#qr-copy-link').addEventListener('click', async () => { await copyText(buildShareUrl()); toast('Link copiado'); });
  $('#qr-close').addEventListener('click', () => $('#qr-back').classList.remove('open'));
  $('#qr-back').addEventListener('click', e => { if (e.target === $('#qr-back')) $('#qr-back').classList.remove('open'); });

  $('#priv-join').addEventListener('click', () => joinPrivate($('#priv-input').value));
  $('#priv-input').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); joinPrivate($('#priv-input').value); } });

  $('#priv-send').addEventListener('click', sendPrivate);
  $('#priv-input-msg').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); sendPrivate(); } });
  $('#priv-img').addEventListener('click', pickImage);
  $('#priv-voice').addEventListener('click', toggleVoice);

  $('#priv-call-audio').addEventListener('click', () => startCall('audio'));
  $('#priv-call-video').addEventListener('click', () => startCall('video'));
  $('#priv-call-screen').addEventListener('click', () => startCall('screen'));

  $('#call-end').addEventListener('click', () => endCall(true));
  $('#call-mute').addEventListener('click', toggleMute);
  $('#call-video-toggle').addEventListener('click', toggleVideo);
  $('#call-screen-toggle').addEventListener('click', swapToScreen);

  window.addEventListener('pagehide', () => { try { Store.clearPrivate(); } catch(e){} });
  window.addEventListener('beforeunload', () => { try { Store.clearPrivate(); } catch(e){} });

  /* auto-join via URL ?join=CODE */
  (function autoJoin() {
    const p = new URLSearchParams(location.search);
    const code = p.get('join');
    if (!code) return;
    history.replaceState({}, '', location.pathname);
    setTimeout(async () => {
      await initPrivate();
      setTimeout(() => joinPrivate(code), 400);
    }, 500);
  })();

  if (!crypto.subtle) setTimeout(() => toast('Criptografia indisponível. Use HTTPS.'), 800);
})();
