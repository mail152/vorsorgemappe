/* Speicher — drei Wege, eine Schnittstelle.
   Jeder Weg kann: struktur() lesen, log(person) lesen, anhaengen(person, zeilen) schreiben.
   Niemand schreibt jemals die Datei eines anderen — deshalb kann es keine Konflikte geben. */
(function (global) {
  'use strict';

  const DATEI = {
    struktur: 'struktur.json',
    log: (p) => `ereignisse-${p}.jsonl`,
    kennwort: 'kennwort.json',
  };

  /* ---------------- Probelauf: alles im Browser, nichts nach draußen ---------------- */
  function probelauf() {
    const K = 'vorsorgemappe.probe.';
    return {
      art: 'probe',
      name: 'Probelauf auf diesem Gerät',
      async struktur() {
        const r = await fetch('../struktur.json', { cache: 'no-store' });
        if (!r.ok) throw new Error('struktur.json nicht gefunden (' + r.status + ')');
        return r.json();
      },
      async lies(datei) { return localStorage.getItem(K + datei); },
      async anhaengen(datei, zeilen) {
        const alt = localStorage.getItem(K + datei) || '';
        localStorage.setItem(K + datei, alt + zeilen.map((z) => JSON.stringify(z) + '\n').join(''));
      },
      async schreib(datei, text) { localStorage.setItem(K + datei, text); },
    };
  }

  /* ---------------- Ordner auf diesem Mac (File System Access) ---------------- */
  function ordner(griff) {
    return {
      art: 'ordner',
      name: 'Ordner auf diesem Gerät',
      griff,
      async struktur() { return JSON.parse(await this.lies(DATEI.struktur) || '{}'); },
      async lies(datei) {
        try {
          const h = await griff.getFileHandle(datei);
          return await (await h.getFile()).text();
        } catch (e) { return null; }
      },
      async anhaengen(datei, zeilen) {
        const alt = (await this.lies(datei)) || '';
        await this.schreib(datei, alt + zeilen.map((z) => JSON.stringify(z) + '\n').join(''));
      },
      async schreib(datei, text) {
        const h = await griff.getFileHandle(datei, { create: true });
        const s = await h.createWritable();
        await s.write(text);
        await s.close();
      },
    };
  }

  /* ---------------- Dropbox ---------------- */
  const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  async function pkceStart(appKey, pfad) {
    const roh = crypto.getRandomValues(new Uint8Array(64));
    const verifier = b64url(roh);
    const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
    sessionStorage.setItem('vm.verifier', verifier);
    localStorage.setItem('vm.dropbox.key', appKey);
    localStorage.setItem('vm.dropbox.pfad', pfad);
    const u = new URL('https://www.dropbox.com/oauth2/authorize');
    u.searchParams.set('client_id', appKey);
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('code_challenge', challenge);
    u.searchParams.set('code_challenge_method', 'S256');
    u.searchParams.set('token_access_type', 'offline');
    u.searchParams.set('redirect_uri', location.origin + location.pathname);
    location.href = u.toString();
  }

  async function pkceEinloesen(code) {
    const key = localStorage.getItem('vm.dropbox.key');
    const verifier = sessionStorage.getItem('vm.verifier');
    const r = await fetch('https://api.dropboxapi.com/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code, grant_type: 'authorization_code', client_id: key,
        code_verifier: verifier, redirect_uri: location.origin + location.pathname,
      }),
    });
    if (!r.ok) throw new Error('Anmeldung abgelehnt: ' + (await r.text()));
    const d = await r.json();
    localStorage.setItem('vm.dropbox.refresh', d.refresh_token || '');
    return d.access_token;
  }

  async function frischerToken() {
    const key = localStorage.getItem('vm.dropbox.key');
    const refresh = localStorage.getItem('vm.dropbox.refresh');
    if (!refresh) return null;
    const r = await fetch('https://api.dropboxapi.com/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refresh, client_id: key }),
    });
    if (!r.ok) return null;
    return (await r.json()).access_token;
  }

  /* Geschäftskonten haben zwei Wurzeln: den eigenen Mitgliedsordner (home) und die
     Team-Wurzel (root). Die Schnittstelle rechnet Pfade standardmäßig gegen home —
     ein geteilter Ordner wie /Astrid liegt aber an der Team-Wurzel und ist von dort
     aus nicht zu finden. Der Kopf Dropbox-API-Path-Root stellt das um. */
  async function wurzelBestimmen(token) {
    const r = await fetch('https://api.dropboxapi.com/2/users/get_current_account', {
      method: 'POST', headers: { Authorization: 'Bearer ' + token },
    });
    if (!r.ok) return null;
    const d = await r.json();
    const ri = d.root_info || {};
    if (!ri.root_namespace_id || ri.root_namespace_id === ri.home_namespace_id) return null;
    return ri.root_namespace_id;                 // nur bei Geschäftskonten nötig
  }

  function dropbox(token, wurzel) {
    const pfad = localStorage.getItem('vm.dropbox.pfad') || '';
    const voll = (d) => (pfad.replace(/\/$/, '') + '/' + d);
    const pathRoot = wurzel ? JSON.stringify({ '.tag': 'root', root: String(wurzel) }) : null;

    function koepfe(extra) {
      const h = Object.assign({ Authorization: 'Bearer ' + token }, extra || {});
      if (pathRoot) h['Dropbox-API-Path-Root'] = pathRoot;
      return h;
    }
    const rpc = (url, arg) => fetch(url, {
      method: 'POST', headers: koepfe({ 'Content-Type': 'application/json' }), body: JSON.stringify(arg),
    });
    const inhalt = (url, arg, koerper) => fetch(url, {
      method: 'POST',
      headers: koepfe({ 'Dropbox-API-Arg': JSON.stringify(arg), 'Content-Type': 'application/octet-stream' }),
      body: koerper,
    });

    return {
      art: 'dropbox', name: 'Dropbox', token, pfad, wurzel,

      /* Beim Scheitern nicht raten, sondern nachsehen und sagen, was da ist. */
      async pruefeOrdner() {
        const r = await rpc('https://api.dropboxapi.com/2/files/list_folder', { path: pfad.replace(/\/$/, '') });
        if (!r.ok) {
          const t = await r.text();
          if (t.includes('not_found'))
            throw new Error(`Den Ordner „${pfad}“ gibt es in dieser Dropbox nicht. `
              + 'Prüfe die Schreibweise — Groß- und Kleinschreibung ist egal, Leerzeichen nicht.');
          throw new Error('Ordner nicht lesbar: ' + t.slice(0, 200));
        }
        return (await r.json()).entries.map((e) => e.name);
      },

      async struktur() {
        const t = await this.lies(DATEI.struktur);
        if (t == null) {
          let da = [];
          try { da = await this.pruefeOrdner(); } catch (e) { throw e; }
          throw new Error(`struktur.json liegt nicht in „${pfad}“. Dort gefunden: `
            + (da.length ? da.slice(0, 8).join(', ') : 'nichts'));
        }
        const d = JSON.parse(t);
        if (!d.kapitel || !d.kapitel.length) throw new Error('struktur.json enthält keine Kapitel.');
        return d;
      },

      async lies(datei) {
        const r = await inhalt('https://content.dropboxapi.com/2/files/download', { path: voll(datei) }, '');
        if (r.status === 409) return null;              // Datei gibt es noch nicht
        if (!r.ok) throw new Error('Lesen fehlgeschlagen: ' + (await r.text()).slice(0, 200));
        return r.text();
      },

      async anhaengen(datei, zeilen) {
        const alt = (await this.lies(datei)) || '';
        await this.schreib(datei, alt + zeilen.map((z) => JSON.stringify(z) + '\n').join(''));
      },

      async schreib(datei, text) {
        const r = await inhalt('https://content.dropboxapi.com/2/files/upload',
          { path: voll(datei), mode: 'overwrite', mute: true }, new Blob([text]));
        if (!r.ok) throw new Error('Schreiben fehlgeschlagen: ' + (await r.text()).slice(0, 200));
      },
    };
  }

  global.Speicher = { DATEI, probelauf, ordner, dropbox, wurzelBestimmen, pkceStart, pkceEinloesen, frischerToken };
})(window);
