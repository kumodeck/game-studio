// The web demo's front page (index.html): words, the install line, and the editor in a frame.
//
// The rules for the frame (2026-10-19):
// - It loads when it is seen: the frame gets its src only once a quarter of it is on screen (IntersectionObserver).
//   WHY not a "Try it" button first: the editor itself is the point of the page, and a picture of a game with a button
//   reads as a video. WHY not at once: the 3D sample is a few MB of three.js and a scene that keeps drawing.
// - Phones (narrower than 768 px) get no frame at all: the 3D sample takes about 26 s to settle there. Each sample is a
//   card that opens the same editor on its own page (studio/?game=<id>).
// - "Click to use": until the editor is first pressed, the wheel over it and the keys move the page (the editor zooms
//   with the wheel, so a page scrolled with the mouse over it would get stuck). That first press is a real press: it
//   selects the object under it and can drag it at once (the third design review's ②, 2026-10-20 — a clear cover over
//   the editor used to eat it, so the lighthouse got selected only on the second click). The editor tells this page it
//   is in use (embed.ts, MSG_USED); after that it has the keys (and keeps arrows / Space / Page Down from scrolling this
//   page), and a click anywhere outside it gives the page back (MSG_IDLE: the wheel is the page's again).
// - Switching samples swaps the frame's page; saves are per sample and kept in this browser, shared with the full-size
//   editor (same site), so "Open full size" shows the same work.
(function () {
  var q = new URLSearchParams(location.search).get('lang');
  var ja = q ? q === 'ja' : /^ja/i.test(navigator.language || '');
  var T = window.DEMO_LIST_TEXT[ja ? 'ja' : 'en'];
  var langQ = q ? '&lang=' + encodeURIComponent(q) : '';
  var $ = function (id) { return document.getElementById(id); };
  if (ja) document.documentElement.lang = 'ja';
  document.title = T.pageTitle;
  ['brand', 'title', 'lead', 'installLabel', 'installNote', 'tryTitle', 'tryLead', 'phoneNote', 'loading', 'full',
    'line', 'f1Title', 'f1', 'f2Title', 'f2', 'f3Title', 'f3', 'engines', 'kdTitle', 'kd', 'kdLink', 'foot', 'license']
    .forEach(function (id) { $(id).textContent = T[id]; });
  $('gh').textContent = T.github;
  $('repo').textContent = T.repoLink;
  $('copy').textContent = T.copy;

  // 768, the brief's line between a phone and the rest (index.html's media query uses the same number).
  var wide = window.matchMedia('(min-width: 768px)');
  var stage = $('stage');
  var frame = null; // the editor's iframe, made when the stage is first seen (wide screens only)
  var seen = false;
  var current = null; // the sample shown in the frame
  var games = [];
  var editorUrl = function (g, embed) { return 'studio/?game=' + encodeURIComponent(g.id) + (embed ? '&embed=1' : '') + langQ; };

  fetch('studio/games.json', { cache: 'no-cache' }).then(function (r) { return r.json(); }).then(function (m) {
    games = m.games;
    if (m.install) $('cmd').textContent = m.install;
    if (m.repo) {
      $('gh').href = m.repo;
      $('repo').href = m.repo;
      $('license').href = m.repo + '/blob/main/LICENSE';
    } else {
      $('gh').hidden = true;
      $('repo').hidden = true;
    }
    if (m.kumodeck) $('kdLink').href = m.kumodeck;
    else $('kdLink').hidden = true;
    var list = $('samples');
    games.forEach(function (g) {
      var a = document.createElement('a');
      a.className = 'sample';
      a.href = editorUrl(g, false);
      a.dataset.game = g.id;
      a.setAttribute('role', 'tab');
      if (g.thumb) {
        var img = document.createElement('img');
        img.src = g.thumb; img.alt = ''; img.width = 640; img.height = 400; img.decoding = 'async';
        a.append(img);
      }
      var text = document.createElement('span'); text.className = 'text';
      var kind = document.createElement('span'); kind.className = 'kind'; kind.textContent = g.dim.toUpperCase();
      var name = document.createElement('span'); name.className = 'name'; name.textContent = ' ' + g.title;
      // English: the starter's own line (starter.json "blurb", in games.json); other languages: strings.js.
      var desc = document.createElement('span'); desc.className = 'desc'; desc.textContent = (ja && T[g.id]) || g.blurb || T[g.id] || '';
      var tap = document.createElement('span'); tap.className = 'tap'; tap.textContent = T.tap + ' →';
      text.append(kind, name, desc, tap);
      a.append(text);
      // Wide: switch the frame (a plain link still opens the editor with ⌘-click or a middle click). Phone: follow it.
      a.addEventListener('click', function (e) {
        if (!wide.matches || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        show(g);
      });
      list.append(a);
    });
    show(games[0]);
  }, function () { $('samples').textContent = T.error; });

  // ----- the sample in the frame -----
  function show(g) {
    if (!g) return;
    var changed = current !== g;
    current = g;
    document.querySelectorAll('a.sample').forEach(function (a) { a.setAttribute('aria-selected', String(a.dataset.game === g.id)); });
    $('full').href = editorUrl(g, false);
    if (g.thumb) $('poster').src = g.thumb;
    if (changed && frame) {
      setActive(false);
      stage.classList.remove('ready');
      frame.src = editorUrl(g, true);
    }
    load();
  }

  // Make the frame when the stage has been seen on a wide screen; on a phone never (no iframe in the page at all).
  function load() {
    if (frame || !seen || !wide.matches || !current) return;
    frame = document.createElement('iframe');
    frame.title = T.tryTitle;
    frame.allow = 'autoplay; fullscreen; gamepad';
    frame.addEventListener('load', function () { stage.classList.add('ready'); });
    frame.src = editorUrl(current, true);
    stage.append(frame);
  }
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (entries) {
      if (!entries.some(function (e) { return e.isIntersecting; })) return;
      seen = true;
      load();
    }, { threshold: 0.25 }).observe(stage);
  } else {
    seen = true;
  }
  wide.addEventListener('change', function () {
    if (!wide.matches && frame) {
      // Turned into a phone-sized window: take the frame out (the cards open the editor now).
      frame.remove();
      frame = null;
      stage.classList.remove('ready');
      setActive(false);
    }
    load();
  });

  // ----- "Click to use" -----
  // The same strings as embed.ts's MSG_USED / MSG_IDLE.
  var MSG_USED = 'studio:embed/used', MSG_IDLE = 'studio:embed/idle';
  function setActive(on) {
    var was = stage.classList.contains('active');
    stage.classList.toggle('active', on);
    $('hint').textContent = on ? T.hintActive : T.hintIdle;
    if (on && frame && document.activeElement !== frame) {
      // The keys go where the focus is: into the editor's page. (A press in it usually took the focus there already;
      // focusing again would pull it out of the game frame inside.)
      frame.focus();
      try { frame.contentWindow.focus(); } catch (e) { /* same site: never */ }
    }
    // Idle again: the editor hands the wheel back to this page until its next press.
    if (!on && was && frame) frame.contentWindow.postMessage({ type: MSG_IDLE }, location.origin);
  }
  setActive(false);
  window.addEventListener('message', function (e) {
    if (frame && e.source === frame.contentWindow && e.origin === location.origin && e.data && e.data.type === MSG_USED) setActive(true);
  });
  // A press anywhere on this page (outside the frame: presses inside it go to the editor's page) gives the page back.
  document.addEventListener('pointerdown', function () {
    if (stage.classList.contains('active')) setActive(false);
  }, true);
  // Tab out of the editor (or anything else that brings the focus back here) gives the page back too.
  window.addEventListener('focus', function () {
    if (document.activeElement !== frame) setActive(false);
  });

  // ----- the install line -----
  $('copy').addEventListener('click', function () {
    var text = $('cmd').textContent;
    var done = function () {
      $('copy').textContent = T.copied;
      $('copy').classList.add('done');
      setTimeout(function () { $('copy').textContent = T.copy; $('copy').classList.remove('done'); }, 1800);
    };
    var fallback = function () {
      // No clipboard API (an http:// page, an old browser): select the line and copy it the old way.
      var r = document.createRange();
      r.selectNodeContents($('cmd'));
      var s = getSelection();
      s.removeAllRanges();
      s.addRange(r);
      try { if (document.execCommand('copy')) done(); } catch (e) { /* the line stays selected for ⌘C */ }
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback);
    else fallback();
  });
})();
