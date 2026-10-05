/* CryptoChat — PeerJS wrapper */
(function (global) {
  'use strict';
  const PREFIX = 'ccx-v3-';

  function makeId(kind, code) {
    return PREFIX + kind + '-' + String(code).replace(/[^A-Za-z0-9]/g, '');
  }

  function create(kind, code) {
    return new Promise((resolve, reject) => {
      const peer = new Peer(makeId(kind, code), { debug: 0 });
      let opened = false;
      const timer = setTimeout(() => {
        if (!opened) { try { peer.destroy(); } catch (e) {} reject(new Error('timeout')); }
      }, 14000);

      peer.on('open', () => { opened = true; clearTimeout(timer); resolve(peer); });
      peer.on('error', err => { if (!opened) { clearTimeout(timer); reject(err); } });
    });
  }

  global.Peers = { create, makeId };
})(window);
