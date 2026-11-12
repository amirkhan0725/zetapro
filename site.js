// The Windows download is pointless on a phone; keep the page to one button there.
(function () {
  if (/iPhone|iPad|Android/i.test(navigator.userAgent)) document.getElementById('dl').hidden = true;
})();

// Theme showcase: the Stats page in a few themes, each held 3.5 s, then a 0.8 s
// crossfade to the next. The extra frames load after the page does. It pauses in
// a hidden tab or while scrolled away, and with reduced motion it stays on the
// first frame and loads nothing more.
(function () {
  var box = document.querySelector('.showcase');
  if (!box) return;
  var frames = Array.prototype.slice.call(box.querySelectorAll('.frame'));
  var chip = box.querySelector('.theme-chip');
  var HOLD = 3500, FADE = 800;
  var reduce = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
  var cur = 0, timer = null, loaded = false, onScreen = true;
  if (frames.length < 2) return;

  function ready(img) { return img.getAttribute('src') && img.complete && img.naturalWidth > 0; }
  function running() { return loaded && !reduce.matches && !document.hidden && onScreen; }

  function schedule() {
    clearTimeout(timer);
    timer = running() ? setTimeout(step, HOLD + FADE) : null;
  }

  function step() {
    // Skip any frame that hasn't arrived yet rather than fading in a blank.
    var next = cur;
    for (var k = 1; k < frames.length; k++) {
      var i = (cur + k) % frames.length;
      if (ready(frames[i])) { next = i; break; }
    }
    if (next !== cur) {
      frames.forEach(function (f) { f.classList.remove('prev'); });
      frames[cur].classList.remove('on');
      frames[cur].classList.add('prev');
      frames[next].classList.add('on');
      cur = next;
      if (chip) {
        var name = frames[next].getAttribute('data-name') || '';
        chip.classList.add('swap');
        setTimeout(function () { chip.textContent = name; chip.classList.remove('swap'); }, 300);
      }
    }
    schedule();
  }

  function load() {
    if (loaded || reduce.matches) return;
    loaded = true;
    frames.forEach(function (f) {
      var src = f.getAttribute('data-src');
      if (src && !f.getAttribute('src')) f.setAttribute('src', src);
    });
    schedule();
  }

  document.addEventListener('visibilitychange', schedule);
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (entries) {
      onScreen = entries[entries.length - 1].isIntersecting;
      schedule();
    }).observe(box);
  }
  var onMotion = function () { if (reduce.matches) schedule(); else load(); schedule(); };
  if (reduce.addEventListener) reduce.addEventListener('change', onMotion);
  else if (reduce.addListener) reduce.addListener(onMotion);

  if (document.readyState === 'complete') load();
  else window.addEventListener('load', load);
})();

// The front page's name types itself once, then leaves a blinking caret. The real
// word stays in the heading for search engines and screen readers (aria-label);
// each letter's space is held from the start, so nothing shifts. Reduced motion:
// the word shows at once.
(function () {
  const h = document.querySelector('.hero h1');
  if (!h) return;
  const word = h.textContent.trim();
  h.setAttribute('aria-label', word);
  h.textContent = '';
  const letters = [...word].map((ch) => {
    const s = document.createElement('span');
    s.className = 'tw-ch';
    s.textContent = ch;
    s.setAttribute('aria-hidden', 'true');
    h.append(s);
    return s;
  });
  const caret = document.createElement('span');
  caret.className = 'tw-caret';
  caret.setAttribute('aria-hidden', 'true');
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    letters.forEach((s) => s.classList.add('on'));
    h.append(caret);
    return;
  }
  h.prepend(caret);
  let i = 0;
  setTimeout(function step() {
    letters[i].classList.add('on');
    letters[i].after(caret);
    if (++i < letters.length) setTimeout(step, 95 + Math.random() * 60);
  }, 350);
})();
