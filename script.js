(() => {
  const $ = s => document.querySelector(s);
  const state = { cfg: null, pages: {}, page: null, idx: null };
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const txt = (root, sel, d = '') => (root.querySelector(sel)?.textContent || d).trim();

  async function loadConfig() {
    const res = await fetch('site.xml', { cache: 'no-store' });
    if (!res.ok) throw new Error('site.xml not found');
    const doc = new DOMParser().parseFromString(await res.text(), 'application/xml');
    if (doc.querySelector('parsererror')) throw new Error('site.xml is not valid XML');
    return doc;
  }

  function parseVideo(el) {
    const provider = (el.getAttribute('provider') || '').toLowerCase(), vid = el.getAttribute('id');
    const poster = provider === 'vimeo' ? `https://vumbnail.com/${vid}.jpg` : `https://i.ytimg.com/vi/${vid}/maxresdefault.jpg`;
    const thumb = el.getAttribute('thumb') || poster;
    const embed = provider === 'vimeo'
      ? `https://player.vimeo.com/video/${encodeURIComponent(vid)}?autoplay=1&title=0&byline=0&portrait=0`
      : `https://www.youtube-nocookie.com/embed/${encodeURIComponent(vid)}?autoplay=1&rel=0&modestbranding=1`;
    return { video: true, embed, src: thumb, thumb, caption: el.getAttribute('caption') || '' };
  }

  function parse(doc) {
    const cfg = {
      title: txt(doc, 'settings > title'),
      description: txt(doc, 'settings > description'),
      vars: {
        '--bg': txt(doc, 'settings > backgroundColor'),
        '--text': txt(doc, 'settings > textColor'),
        '--link': txt(doc, 'settings > linkColor'),
        '--hover': txt(doc, 'settings > linkHoverColor'),
        '--accent': txt(doc, 'settings > accentColor'),
        '--font': txt(doc, 'settings > fontFamily'),
        '--display': txt(doc, 'settings > displayFontFamily')
      },
      defaultPage: txt(doc, 'settings > defaultPage', 'overview'),
      slideSpeed: parseInt(txt(doc, 'settings > hoverSlideSpeed', '600'), 10),
      header: {
        logo: txt(doc, 'header > logo'),
        social: [...doc.querySelectorAll('header > social > link')].map(l => ({ label: l.getAttribute('label'), url: l.getAttribute('url') }))
      },
      nav: [...doc.querySelectorAll('navigation > item')].map(i => ({
        id: i.getAttribute('id'), label: i.textContent.trim(), right: i.getAttribute('side') === 'right' }))
    };
    doc.querySelectorAll('pages > page').forEach(p => {
      const id = p.getAttribute('id'), type = p.getAttribute('type') || 'gallery';
      if (type === 'projects') {
        state.pages[id] = { id, type, projects: [...p.querySelectorAll('project')].map(x => ({ id: x.getAttribute('id'), title: x.getAttribute('title') })) };
      } else if (type === 'gallery') {
        state.pages[id] = { id, type, title: p.getAttribute('title') || id, description: txt(p, 'description'),
          images: [...p.querySelectorAll('image, video')].map(i => i.tagName === 'video' ? parseVideo(i) : ({
            src: i.getAttribute('src'), thumb: i.getAttribute('thumb') || i.getAttribute('src'),
            caption: i.getAttribute('caption') || '' })) };
      } else if (type === 'archive') {
        state.pages[id] = { id, type, images: [] };
      } else {
        state.pages[id] = { id, type, heading: txt(p, 'heading'),
          paragraphs: [...p.querySelectorAll('paragraph')].map(x => x.textContent.trim()),
          links: [...p.querySelectorAll('link')].map(l => ({ label: l.getAttribute('label'), url: l.getAttribute('url') })) };
      }
    });
    const all = Object.values(state.pages).filter(p => p.type === 'gallery').flatMap(p => p.images);
    Object.values(state.pages).filter(p => p.type === 'archive').forEach(p => { p.images = all; });
    return cfg;
  }

  function applyChrome(cfg) {
    const r = document.documentElement.style;
    Object.entries(cfg.vars).forEach(([k, v]) => v && r.setProperty(k, v));
    document.title = cfg.title;
    let m = document.querySelector('meta[name=description]');
    if (!m) { m = document.createElement('meta'); m.name = 'description'; document.head.appendChild(m); }
    m.content = cfg.description;
    const h = cfg.header;
    $('#logo').textContent = $('#m-logo').textContent = h.logo;
    $('#subnav').innerHTML = cfg.nav.filter(n => !n.right).map(n =>
      `<li><a class="item" data-page="${n.id}" href="#/${n.id}">${esc(n.label)}</a></li>`).join('');
    $('#right-nav').innerHTML = cfg.nav.filter(n => n.right).map(n =>
      `<li><a class="item" data-page="${n.id}" href="#/${n.id}">${esc(n.label)}</a></li>`).join('');
    $('#m-list').innerHTML = cfg.nav.map(n => `<li><a data-page="${n.id}" href="#/${n.id}">${esc(n.label)}</a></li>`).join('');
    const social = h.social.map(l => `<a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)}</a>`).join('');
    $('#rep-link').innerHTML = social;
    $('#m-rep').innerHTML = social;
  }

  // Routes: #/page or #/project/3 (1-based image number)
  function route() {
    const [, id, n] = location.hash.split('/');
    const pageId = state.pages[id] ? id : state.cfg.defaultPage;
    if (state.page !== pageId) { state.page = pageId; renderPage(); }
    const page = state.pages[pageId];
    const i = page.images && n ? parseInt(n, 10) - 1 : null;
    if (i != null && page.images[i]) openViewer(i); else closeViewerUI();
  }

  // Parent nav item for a project gallery: the page that lists it, else the first nav item
  function parentOf(id) {
    const nav = state.cfg.nav.map(n => n.id);
    const hit = nav.find(n => state.pages[n]?.projects?.some(p => p.id === id));
    return hit || nav[0];
  }

  function renderPage() {
    const p = state.pages[state.page];
    const active = p.type === 'gallery' ? (history.state?.from || parentOf(p.id)) : p.id;
    document.querySelectorAll('[data-page]').forEach(a => a.classList.toggle('active', a.dataset.page === active));

    document.body.classList.remove('menu-open');
    window.scrollTo(0, 0);
    document.body.classList.toggle('h-scroll', p.type === 'gallery');
    const main = $('#main');
    main.style.animation = 'none'; void main.offsetWidth; main.style.animation = '';
    if (p.type === 'projects') {
      main.innerHTML = `<ul class="projects">${p.projects.map(x => {
        const imgs = state.pages[x.id]?.images ?? [];
        const words = x.title.split(/\s+/).map((w, i) =>
          `<span class="word" style="--i:${i}">${esc(w)}<span class="labels" data-label="${esc(w)}"></span></span>`).join('');
        const thumbs = imgs.slice(0, 5).map((im, i) =>
          `<span class="thumb${i ? '' : ' show'}"><img src="${esc(im.thumb)}" alt=""></span>`).join('');
        return `<li><a class="work-link" href="#/${esc(x.id)}"><span class="previews"><span class="previews-inner"><span class="thumbs">${thumbs}</span></span></span>` +
          `<span class="title">${words}<span class="count">${imgs.length}</span></span></a></li>`;
      }).join('')}</ul>`;
      main.querySelectorAll('.work-link').forEach(initPreview);
    } else if (p.type === 'archive') {
      const colors = ['#973b2e', '#d3cbb4', '#6d1919', '#acbebf', '#573d29', '#8a8f6a', '#c9a77c'];
      main.innerHTML = `<section class="archive"><div class="grid">${p.images.map((im, i) =>
        `<div class="cell"><div class="cell-inner"><div class="image-holder">` +
        `<div class="archive-image-holder${im.video ? ' video' : ''}" data-i="${i}" style="background:${colors[i % colors.length]}"><img src="${esc(im.thumb)}" alt="${esc(im.caption)}" loading="lazy"><div class="shim"></div></div></div></div></div>`).join('')}</div></section>`;
      main.querySelectorAll('.archive-image-holder').forEach(h => {
        const img = h.querySelector('img'), done = () => h.classList.add('loaded');
        img.complete ? done() : img.addEventListener('load', done);
      });
    } else if (p.type === 'gallery') {
      const colors = ['#973b2e', '#d3cbb4', '#6d1919', '#acbebf', '#573d29', '#8a8f6a', '#c9a77c'];
      const fig = (im, i) => `<figure class="${im.video ? 'video' : ''}" data-i="${i}" style="background:${colors[i % colors.length]}">` +
        `<img src="${esc(im.src)}" alt="${esc(im.caption)}" loading="${i < 4 ? 'eager' : 'lazy'}"></figure>`;
      const list = state.pages[parentOf(p.id)]?.projects ?? [];
      const at = list.findIndex(x => x.id === p.id);
      const next = list.length > 1 && at >= 0 ? list[(at + 1) % list.length] : null;
      main.innerHTML = `<div class="gallery"><div class="feature-col">${p.images[0] ? fig(p.images[0], 0) : ''}</div>` +
        `<div class="grid-items">${p.images.slice(1).map((im, i) => fig(im, i + 1)).join('')}</div>` +
        (next ? `<a class="next-cta" href="#/${esc(next.id)}"><p>Next</p><p class="next-title">${esc(next.title)}<span class="arrow"></span></p></a>` : '') + '</div>';
      main.querySelectorAll('figure img').forEach(img => {
        const done = () => {
          img.parentNode.classList.add('loaded');
          img.parentNode.dataset.r = img.naturalWidth / img.naturalHeight;
          sizeFigures();
        };
        img.complete ? done() : img.addEventListener('load', done);
      });
    } else {
      main.innerHTML = `<div class="text"><h1>${esc(p.heading)}</h1>${p.paragraphs.map(t => `<p>${esc(t)}</p>`).join('')}
        <div class="links">${p.links.map(l => `<a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)}</a>`).join('')}</div></div>`;
    }
  }

  // Horizontal gallery: fit each figure's width to its image so the placeholder color doesn't show
  function sizeFigures() {
    const desk = matchMedia('(min-width:1024px) and (hover:hover) and (pointer:fine)').matches;
    const figs = document.querySelectorAll('.gallery figure');
    figs.forEach(f => { f.style.width = ''; });
    if (!desk) return;
    for (let pass = 0; pass < 2; pass++) {
      figs.forEach(f => { if (f.dataset.r) f.style.width = Math.round(f.clientHeight * f.dataset.r) + 'px'; });
    }
  }

  // Hover slideshow with eased horizontal drift following the cursor
  function initPreview(a) {
    const thumbs = [...a.querySelectorAll('.thumb')], box = a.querySelector('.previews'), strip = a.querySelector('.thumbs');
    let cur = 0, timer = null, raf = null, pos = 0, target = 0;
    const tick = () => {
      pos += .15 * (target - pos); strip.style.setProperty('--x', pos + '%');
      raf = Math.abs(target - pos) > .01 ? requestAnimationFrame(tick) : null;
    };
    a.addEventListener('mouseenter', () => {
      box.classList.toggle('--bottom', a.querySelector('.title').getBoundingClientRect().top >= innerHeight / 2);
      if (thumbs.length < 2) return;
      clearInterval(timer);
      timer = setInterval(() => {
        thumbs[cur].classList.remove('show'); cur = (cur + 1) % thumbs.length; thumbs[cur].classList.add('show');
      }, state.cfg.slideSpeed);
    });
    a.addEventListener('mousemove', e => {
      const r = a.getBoundingClientRect();
      target = 10 - Math.min(Math.max((e.clientX - r.left) / r.width, 0), 1) * 20;
      raf = raf || requestAnimationFrame(tick);
    });
    a.addEventListener('mouseleave', () => { clearInterval(timer); timer = null; });
  }

  function setDesc(open, refocus = true) {
    const v = $('#viewer'), btn = $('#v-info'), panel = $('#viewer-desc');
    if (open && btn.hidden) return;
    v.classList.toggle('desc-open', open);
    btn.setAttribute('aria-expanded', String(open));
    panel.setAttribute('aria-hidden', String(!open));
    if (open) panel.focus({ preventScroll: true }); else if (refocus && document.activeElement === panel) btn.focus();
  }
  const toggleDesc = () => setDesc(!$('#viewer').classList.contains('desc-open'));

  function openViewer(i) {
    const p = state.pages[state.page], im = p.images[i];
    state.idx = i;
    const v = $('#viewer'), img = $('#viewer-img');
    v.hidden = false; document.body.style.overflow = 'hidden';
    v.classList.toggle('is-video', !!im.video);
    $('#viewer-content iframe')?.remove();
    if (im.video) {
      img.style.display = 'none'; img.removeAttribute('src');
      const f = document.createElement('iframe');
      f.src = im.embed; f.title = im.caption;
      f.allow = 'autoplay; fullscreen; picture-in-picture; encrypted-media';
      $('#viewer-content').appendChild(f);
    } else {
      img.style.display = '';
      img.style.opacity = 0;
      img.onload = () => img.style.opacity = 1;
      img.src = im.src; img.alt = im.caption;
    }
    $('#viewer-caption').textContent = im.caption;
    $('#viewer-desc').textContent = p.description || '';
    $('#v-info').hidden = !p.description;
    if (!p.description) setDesc(false);
    $('#viewer-count').textContent = `${i + 1} / ${p.images.length}`;
    [1, -1].forEach(d => { new Image().src = p.images[(i + d + p.images.length) % p.images.length].src; });
  }
  function closeViewerUI() { setDesc(false, false); $('#viewer-content iframe')?.remove(); $('#viewer').hidden = true; document.body.style.overflow = ''; state.idx = null; }
  const go = d => {
    const n = state.pages[state.page].images.length;
    location.hash = `#/${state.page}/${((state.idx + d + n) % n) + 1}`;
  };
  const close = () => { location.hash = `#/${state.page}`; };

  function setMeta(name, content, property = false) {
    if (!content) return;
    const selector = property ? `meta[property="${name}"]` : `meta[name="${name}"]`;
    let meta = document.querySelector(selector);
    if (!meta) {
      meta = document.createElement('meta');
      if (property) meta.setAttribute('property', name); else meta.setAttribute('name', name);
      document.head.appendChild(meta);
    }
    meta.content = content;
  }

  function updatePageMetadata() {
    const p = state.pages[state.page];
    if (!p) return;
    const names = { index: 'Index', archive: 'Archive', about: 'About', people: 'People', places: 'Places', 'lost-and-found': 'Lost and Found', 'still-life': 'Still Life' };
    const label = p.title || p.heading || names[p.id] || p.id;
    const description = p.description || (p.type === 'gallery'
      ? `View the ${label} photography collection by visual artist Rick Alday.`
      : p.type === 'text'
        ? 'Learn more about Rick Alday, visual artist and photographer.'
        : p.type === 'archive'
          ? 'Browse the complete photography archive by Rick Alday.'
          : 'Photography and graphic design by visual artist Rick Alday.');
    const title = p.id === 'index' ? `${state.cfg.title} — Visual Artist` : `${label} — ${state.cfg.title}`;
    document.title = title;
    setMeta('description', description);
    setMeta('og:title', title, true);
    setMeta('og:description', description, true);
    setMeta('twitter:title', title);
    setMeta('twitter:description', description);

    if (p.type === 'gallery' && p.images?.[0]?.thumb) {
      setMeta('og:image', p.images[0].thumb, true);
      setMeta('twitter:image', p.images[0].thumb);
    }
  }

  function bind() {
    $('#main').addEventListener('click', e => {
      const f = e.target.closest('figure, .archive-image-holder'); if (f) location.hash = `#/${state.page}/${+f.dataset.i + 1}`;
      const a = e.target.closest('.projects a');
      if (a) history.replaceState({ from: state.page }, '');
    });
    document.querySelector('.zone-prev').onclick = () => go(-1);
    document.querySelector('.zone-next').onclick = () => go(1);
    $('#v-prev').onclick = () => go(-1); $('#v-next').onclick = () => go(1); $('#v-close').onclick = close;
    $('#v-info').onclick = toggleDesc;
    // Click outside the popover dismisses it without triggering navigation
    $('#viewer').addEventListener('click', e => {
      if (!$('#viewer').classList.contains('desc-open') || e.target.closest('#viewer-desc, #v-info')) return;
      e.stopPropagation(); e.preventDefault(); setDesc(false);
    }, true);
    $('#menu-btn').onclick = () => document.body.classList.toggle('menu-open');

    document.addEventListener('keydown', e => {
      if (state.idx == null) return;
      if (e.key === 'ArrowRight') go(1);
      else if (e.key === 'ArrowLeft') go(-1);
      else if (e.key === 'Escape') { $('#viewer').classList.contains('desc-open') ? setDesc(false) : close(); }
      else if (e.key === 'i' && !$('#v-info').hidden) toggleDesc();
    });
    let sx = null;
    const v = $('#viewer');
    v.addEventListener('touchstart', e => sx = e.touches[0].clientX, { passive: true });
    v.addEventListener('touchend', e => {
      if (sx == null) return;
      const dx = e.changedTouches[0].clientX - sx; sx = null;
      if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1);
    });
    window.addEventListener('hashchange', () => { route(); updatePageMetadata(); });
    window.addEventListener('resize', sizeFigures);
    // Vertical wheel scrolls the horizontal gallery on desktop
    window.addEventListener('wheel', e => {
      if (!document.body.classList.contains('h-scroll') || state.idx != null || !matchMedia('(min-width:1024px) and (hover:hover) and (pointer:fine)').matches) return;
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) { e.preventDefault(); window.scrollBy(e.deltaY, 0); }
    }, { passive: false });
  }

  (async () => {
    try {
      state.cfg = parse(await loadConfig());
      applyChrome(state.cfg); bind(); route(); updatePageMetadata();
    } catch (err) {
      $('#main').innerHTML = `<p style="padding:96px 7vw">Could not load site.xml (${esc(err.message)}). Serve this folder over http, e.g. <code>python3 -m http.server</code>.</p>`;
    }
  })();
})();
