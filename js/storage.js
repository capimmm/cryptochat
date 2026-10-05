/* CryptoChat — persistência: Normal em localStorage, Privado em sessionStorage */
(function (global) {
  'use strict';

  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

  function generateCode() {
    let s = '';
    for (let i = 0; i < 4; i++) s += A[Math.floor(Math.random() * A.length)];
    s += '-';
    for (let i = 0; i < 4; i++) s += A[Math.floor(Math.random() * A.length)];
    return s;
  }

  function safeGet(store, key, fb) {
    try { const v = store.getItem(key); return v == null ? fb : JSON.parse(v); }
    catch (e) { return fb; }
  }
  function safeSet(store, key, val) {
    try { store.setItem(key, JSON.stringify(val)); } catch (e) {}
  }
  function safeDel(store, key) {
    try { store.removeItem(key); } catch (e) {}
  }

  const Store = {
    generateCode,

    getIdentity() {
      let id = localStorage.getItem('cc:identity');
      if (!id) { id = generateCode(); localStorage.setItem('cc:identity', id); }
      return id;
    },

    getContacts()       { return safeGet(localStorage, 'cc:contacts', []); },
    saveContacts(list)  { safeSet(localStorage, 'cc:contacts', list); },
    getMessages(id)     { return safeGet(localStorage, 'cc:msgs:' + id, []); },
    saveMessages(id, m) { safeSet(localStorage, 'cc:msgs:' + id, m.slice(-500)); },

    getPrivateCode() {
      let c = sessionStorage.getItem('cc:priv:code');
      if (!c) { c = generateCode(); sessionStorage.setItem('cc:priv:code', c); }
      return c;
    },
    resetPrivateCode() {
      const c = generateCode();
      sessionStorage.setItem('cc:priv:code', c);
      return c;
    },
    getPrivateMessages()    { return safeGet(sessionStorage, 'cc:priv:msgs', []); },
    savePrivateMessages(m)  { safeSet(sessionStorage, 'cc:priv:msgs', m.slice(-200)); },
    clearPrivate() {
      safeDel(sessionStorage, 'cc:priv:code');
      safeDel(sessionStorage, 'cc:priv:msgs');
    }
  };

  global.Store = Store;
})(window);
