/* CryptoChat — persistência */
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

  const safeGet = (st, k, fb) => { try { const v = st.getItem(k); return v == null ? fb : JSON.parse(v); } catch (e) { return fb; } };
  const safeSet = (st, k, v) => { try { st.setItem(k, JSON.stringify(v)); } catch (e) {} };
  const safeDel = (st, k) => { try { st.removeItem(k); } catch (e) {} };

  global.Store = {
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
    getPrivateMessages()    { return safeGet(sessionStorage, 'cc:priv:msgs', []); },
    // só salva texto — mídias ficam só em memória (evita estourar a cota)
    savePrivateMessages(m)  {
      const light = m.filter(x => x.type === 'text' || x.sys)
                     .map(x => ({ id:x.id, ts:x.ts, mine:x.mine, sys:x.sys, text:x.text }));
      safeSet(sessionStorage, 'cc:priv:msgs', light.slice(-200));
    },
    clearPrivate() {
      safeDel(sessionStorage, 'cc:priv:code');
      safeDel(sessionStorage, 'cc:priv:msgs');
    }
  };
})(window);
