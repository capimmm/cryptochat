/* CryptoChat — wrapper PeerJS (WebRTC P2P) */
(function (global) {
  'use strict';

  const PREFIX = 'ccx-v2-';

  function makeId(kind, code) {
    const safe = String(code).replace(/[^A-Za-z0-9]/g, '');
    return PREFIX + kind + '-' + safe;
  }

  function create(kind, code) {
    return new Promise((resolve, reject) => {
      const peer = new Peer(makeId(kind, code), { debug: 0 });
      let opened = false;
      const timer = setTimeout(() => {
        if (!opened) { try { peer.destroy(); } catch (e) {} reject(new Error('timeout')); }
      }, 12000);

      peer.on('open', () => {
        opened = true;
        clearTimeout(timer);
        resolve(peer);
      });
      peer.on('error', err => {
        if (!opened) { clearTimeout(timer); reject(err); }
      });
    });
  }

  global.Peers = { create, makeId };
})(window);
