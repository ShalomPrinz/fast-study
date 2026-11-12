// The language toggle: ?lang= wins, then the remembered choice, then Hebrew. Both languages' copy is in the
// markup, so this only flips the root's lang/dir, the title, the image alts and the demo player's version.
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

  // The demo player: the page language's poster under a play button; nothing of the video loads before the click.
  const play = document.querySelector('.demo-play');
  const poster = new Image(1920, 1080);
  poster.className = 'demo-poster';
  poster.loading = 'lazy';
  poster.alt = '';
  let video = null;
  let shown = null;

  // Before the click the poster follows the language; a loaded video changes file and keeps its place.
  function showDemo(lang) {
    if (!play || lang === shown) return;
    shown = lang;
    if (!video) return (poster.src = `video/poster-${lang}.jpg`);
    const at = video.currentTime;
    const playing = !video.paused;
    video.src = `video/demo-${lang}.mp4`;
    // A seek set before the new file's metadata is dropped once play() starts it.
    video.addEventListener('loadedmetadata', () => (video.currentTime = at), { once: true });
    if (playing) video.play();
  }

  if (play) {
    play.prepend(poster);
    play.setAttribute('role', 'button');
    play.addEventListener('keydown', (e) => {
      if (e.key !== ' ') return;
      e.preventDefault();
      play.click();
    });
    play.addEventListener('click', (e) => {
      e.preventDefault();
      video = document.createElement('video');
      video.className = 'demo-video';
      video.controls = true;
      video.playsInline = true;
      video.src = `video/demo-${shown}.mp4`;
      video.addEventListener('ended', () => {
        const held = document.activeElement === video;
        video.replaceWith(play);
        video = null;
        poster.src = `video/poster-${shown}.jpg`;
        if (held) play.focus();
      });
      play.replaceWith(video);
      video.focus();
      video.play();
    });
  }

  function apply(lang) {
    root.lang = lang;
    root.dir = lang === 'he' ? 'rtl' : 'ltr';
    document.title = TITLES[lang];
    images.forEach((img) => (img.alt = lang === 'he' ? img.dataset.altHe : img.dataset.altEn));
    showDemo(lang);
  }

  const asked = new URLSearchParams(location.search).get('lang');
  const initial = [asked, remembered()].find((l) => l === 'he' || l === 'en') || 'he';
  if (initial !== 'he') apply(initial);
  else showDemo(initial);

  document.getElementById('lang-toggle').addEventListener('click', () => {
    const next = root.lang === 'he' ? 'en' : 'he';
    apply(next);
    remember(next);
  });
})();

// The carousel's handle for the zoom below; null while the carousel is absent.
let journey = null;

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

  journey = { list, slides, at: () => at, show };
  list.dataset.carousel = '';
  carousel.querySelector('.journey-nav').hidden = false;
  show(0);
})();

// Every content screenshot enlarges over a dimmed page; a click anywhere but the journey arrows, or Esc, closes it and focus returns to its opener.
// A journey shot also steps through the four shots in place, and the carousel follows to the one last viewed.
(function () {
  const shots = document.querySelectorAll('main img:not(.demo-poster)');
  if (!shots.length) return;
  const dialog = document.createElement('dialog');
  dialog.className = 'zoom';
  const arrow = (step, d, he, en) =>
    `<button type="button" class="journey-arrow" data-step="${step}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}" /></svg>` +
    `<span class="sr-only"><span class="he">${he}</span><span class="en">${en}</span></span></button>`;
  dialog.innerHTML =
    '<img alt="" />' +
    arrow(-1, 'M15 6l-6 6 6 6', 'השלב הקודם', 'Previous step') +
    arrow(1, 'M9 6l6 6-6 6', 'השלב הבא', 'Next step') +
    '<div class="zoom-foot"><span class="zoom-count" aria-live="polite"><span class="he"><span data-zoom-at></span> מתוך 4</span>' +
    '<span class="en"><span data-zoom-at></span> of 4</span></span>' +
    '<button type="button" class="zoom-close"><span class="he">סגירה</span><span class="en">Close</span></button></div>';
  document.body.append(dialog);
  let opener = null;

  // A fresh <img> each time: re-pointing one that shows a bitmap keeps painting it until the new JPEG decodes.
  function render(img) {
    const big = new Image();
    big.src = img.currentSrc || img.src;
    big.alt = img.alt;
    dialog.querySelector('img').replaceWith(big);
  }

  function step(d) {
    journey.show(journey.at() + d);
    const slide = journey.slides[journey.at()];
    render(slide.querySelector('img'));
    opener = slide.querySelector('.zoomable');
    dialog.querySelectorAll('[data-zoom-at]').forEach((c) => (c.textContent = journey.at() + 1));
  }

  dialog.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    dialog.classList.remove('is-journey');
    opener?.focus();
  });
  dialog.querySelectorAll('.journey-arrow').forEach((btn) =>
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      step(Number(btn.dataset.step));
    }),
  );
  dialog.addEventListener('keydown', (e) => {
    if (!dialog.classList.contains('is-journey')) return;
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const rtl = document.documentElement.dir === 'rtl';
    step((e.key === 'ArrowRight') !== rtl ? 1 : -1);
    e.preventDefault();
  });

  shots.forEach((img) => {
    const inJourney = !!journey && journey.list.contains(img);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'zoomable';
    img.replaceWith(button);
    button.append(img);
    button.addEventListener('click', () => {
      opener = button;
      dialog.classList.toggle('is-journey', inJourney);
      if (inJourney) step(0);
      else render(img);
      dialog.showModal();
      dialog.querySelector('.zoom-close').focus();
    });
  });
})();
