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
