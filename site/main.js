// The language toggle: ?lang= wins, then the remembered choice, then Hebrew. Both languages' copy is in the
// markup, so this only flips the root's lang/dir, the title and the image alts.
(function () {
  const KEY = 'faststudy-site:lang';
  // Each page carries its own English title on <title data-en>, so one script serves every page.
  const TITLES = { he: document.title, en: document.querySelector('title').dataset.en };
  const root = document.documentElement;
  const images = document.querySelectorAll('img[data-alt-en]');
  images.forEach((img) => (img.dataset.altHe = img.alt));

  function remembered() {
    try {
      return localStorage.getItem(KEY);
    } catch {
      return null;
    }
  }

  function remember(lang) {
    try {
      localStorage.setItem(KEY, lang);
    } catch {}
  }

  function apply(lang) {
    root.lang = lang;
    root.dir = lang === 'he' ? 'rtl' : 'ltr';
    document.title = TITLES[lang];
    images.forEach((img) => (img.alt = lang === 'he' ? img.dataset.altHe : img.dataset.altEn));
  }

  const asked = new URLSearchParams(location.search).get('lang');
  const initial = [asked, remembered()].find((l) => l === 'he' || l === 'en') || 'he';
  if (initial !== 'he') apply(initial);

  document.getElementById('lang-toggle').addEventListener('click', () => {
    const next = root.lang === 'he' ? 'en' : 'he';
    apply(next);
    remember(next);
  });
})();

// The journey carousel: one step at a time, wrapping both ways; "next" follows the reading direction.
(function () {
  const carousel = document.querySelector('.journey-carousel');
  if (!carousel) return;
  const list = carousel.querySelector('.journey');
  const slides = list.querySelectorAll(':scope > li');
  const counters = carousel.querySelectorAll('[data-journey-at]');
  let at = 0;

  function show(i) {
    const held = [...slides].some((li) => li.contains(document.activeElement));
    at = (i + slides.length) % slides.length;
    slides.forEach((li, n) => li.classList.toggle('is-active', n === at));
    counters.forEach((c) => (c.textContent = at + 1));
    // A focused screenshot goes hidden with its slide and drops focus to <body>, which arrows never reach.
    if (held) (slides[at].querySelector('.zoomable') || carousel).focus();
  }

  carousel
    .querySelectorAll('[data-step]')
    .forEach((btn) => btn.addEventListener('click', () => show(at + Number(btn.dataset.step))));
  carousel.addEventListener('keydown', (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const rtl = document.documentElement.dir === 'rtl';
    show(at + ((e.key === 'ArrowRight') !== rtl ? 1 : -1));
    e.preventDefault();
  });

  list.dataset.carousel = '';
  carousel.querySelector('.journey-nav').hidden = false;
  show(0);
})();

// Every content screenshot enlarges over a dimmed page; any click or Esc closes it and focus returns to its opener.
(function () {
  const shots = document.querySelectorAll('main img');
  if (!shots.length) return;
  const dialog = document.createElement('dialog');
  dialog.className = 'zoom';
  dialog.innerHTML =
    '<img alt="" /><button type="button"><span class="he">סגירה</span><span class="en">Close</span></button>';
  const big = dialog.querySelector('img');
  document.body.append(dialog);
  let opener = null;

  dialog.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => opener?.focus());

  shots.forEach((img) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'zoomable';
    img.replaceWith(button);
    button.append(img);
    button.addEventListener('click', () => {
      opener = button;
      big.src = img.currentSrc || img.src;
      big.alt = img.alt;
      dialog.showModal();
      dialog.querySelector('button').focus();
    });
  });
})();
