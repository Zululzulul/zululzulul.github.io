(() => {
  'use strict';
  const data = window.PORTFOLIO;
  if (!data) return;
  const $ = (s, parent = document) => parent.querySelector(s);
  const $$ = (s, parent = document) => [...parent.querySelectorAll(s)];
  const escapeHTML = (value = '') => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const safeURL = (value = '') => {
    const raw = String(value).trim();
    if (!raw || raw.startsWith('//')) return '';
    if (/^[a-z][a-z\d+.-]*:/i.test(raw) && !/^https?:\/\//i.test(raw)) return '';
    return escapeHTML(raw);
  };
  const grid = $('#project-grid');
  const home = $('#home-view');
  const projectView = $('#project-view');
  let currentProject = null;
  let navigationFrame = 0;
  let activeFilter = 'all';
  const videoBindings = new Map();
  const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
  const categories = [['all','All'],['team','Team projects'],['personal','Personal projects'],['jam','Game jams'],['school','School assignments']];
  const orderedProjects = (items, category) => {
    const ids = data.projectOrder?.[category] || data.projectOrder?.all || [];
    const ranks = new Map(ids.map((id, index) => [id, index]));
    return [...items].sort((a, b) => (ranks.get(a.id) ?? ids.length) - (ranks.get(b.id) ?? ids.length));
  };
  const projects = orderedProjects(data.projects, 'all');
  const inCategory = (p, category) => category === 'all' || (p.categories || []).includes(category);
  const hasVideo = p => p.video && ((p.video.type === 'file' && safeURL(p.video.url)) || (p.video.type === 'youtube' && /^[A-Za-z0-9_-]{11}$/.test(p.video.id)));
  const textList = items => `<ul>${items.map(text => `<li>${escapeHTML(text)}</li>`).join('')}</ul>`;
  const tones = {'Design problem': 'problem', 'Design decision': 'decision', 'How I would change it now': 'decision', 'Why this decision': 'why', 'Why this change': 'why'};
  const definitionList = (className, items) => `<dl class="${className}">${items.map(item => `<div${tones[item.label] ? ` class="tone-${tones[item.label]}"` : ''}><dt>${escapeHTML(item.label)}</dt><dd>${escapeHTML(item.text)}</dd></div>`).join('')}</dl>`;

  function cover(p, large = false) {
    if (!safeURL(p.cover)) return '';
    const alt = escapeHTML(p.coverAlt || p.title);
    let art;
    if (p.coverFit === 'brand') {
      const logo = safeURL(p.coverLogo) ? `<img class="cover-brand-logo" src="${safeURL(p.coverLogo)}" alt="${escapeHTML(p.coverLogoAlt || '')}" width="32" height="32">` : '';
      art = `<div class="cover-brand">${logo}<img class="cover-brand-title" src="${safeURL(p.cover)}" alt="${alt}" width="${Number(p.coverWidth) || 200}" height="${Number(p.coverHeight) || 64}"></div>`;
    } else {
      art = `<img src="${safeURL(p.cover)}" alt="${alt}" width="${Number(p.coverWidth) || 1536}" height="${Number(p.coverHeight) || 1024}" loading="${large || p === projects[0] ? 'eager' : 'lazy'}">`;
      if (large) art = `<button type="button" class="image-open cover-open" data-image="${safeURL(p.cover)}" data-alt="${alt}" aria-label="Enlarge: ${escapeHTML(p.title)}">${art}</button>`;
    }
    const preview = !large && p.cardPreview && safeURL(p.cardPreview.url) ? `<video class="card-video" data-card-video="${escapeHTML(p.id)}" data-loop-video data-src="${safeURL(p.cardPreview.url)}" muted loop playsinline preload="none" width="1280" height="720" aria-hidden="true" tabindex="-1"></video>` : '';
    return `<div class="cover${large && p.coverWide ? ' cover-wide' : ''}">${art}${preview}</div>`;
  }

  function renderFilters() {
    $('#project-filters').innerHTML = categories.map(([id, label]) => `<button type="button" class="filter-button" data-filter="${id}" aria-pressed="${id === activeFilter}" aria-controls="project-grid">${label}</button>`).join('');
    $$('.filter-button').forEach(button => button.addEventListener('click', () => {
      activeFilter = button.dataset.filter;
      $$('.filter-button').forEach(b => b.setAttribute('aria-pressed', String(b === button)));
      renderCards();
    }));
  }

  function renderCards() {
    releaseVideo(grid);
    const visible = orderedProjects(projects.filter(p => inCategory(p, activeFilter)), activeFilter);
    grid.innerHTML = visible.map(p => {
      const toggle = p.cardPreview && safeURL(p.cardPreview.url) ? `<button class="preview-toggle" type="button" data-card-toggle="${escapeHTML(p.id)}" aria-label="Play preview: ${escapeHTML(p.title)}"><span aria-hidden="true">▶</span></button>` : '';
      return `<article class="project-card"><a class="card-link" href="#project/${encodeURIComponent(p.id)}" aria-label="View project: ${escapeHTML(p.title)}">${cover(p)}<div class="card-body"><p class="card-category">${escapeHTML(p.categoryLabel)}</p><h3>${escapeHTML(p.title)}</h3><p class="card-role"><span>My role</span> ${escapeHTML(p.role)}</p><p class="card-description">${escapeHTML(p.summary)}</p><div class="card-bottom"><span class="card-tags">${(p.tags || []).map(escapeHTML).join(' · ')}</span><span class="card-action">View project <span aria-hidden="true">→</span></span></div></div></a>${toggle}</article>`;
    }).join('') || '<p class="empty-state">No projects in this category yet.</p>';
    $('.project-count').textContent = `${visible.length} ${visible.length === 1 ? 'project' : 'projects'}`;
    bindCardPreviews();
  }

  function bindCardPreviews() {
    const cleanups = [];
    let active = true;
    const supportsObserver = typeof window.IntersectionObserver === 'function';
    const listen = (target, event, handler) => {
      target.addEventListener(event, handler);
      cleanups.push(() => target.removeEventListener(event, handler));
    };
    const states = $$('[data-card-video]', grid).map(video => ({
      video, button: $(`[data-card-toggle="${video.dataset.cardVideo}"]`, grid),
      title: projects.find(p => p.id === video.dataset.cardVideo)?.title || 'Gameplay',
      visible: !supportsObserver, userPaused: false, explicit: false, blocked: false,
      pending: false, ready: false, timer: null
    }));
    const allowed = state => active && state.visible && !home.hidden && !document.hidden &&
      !state.userPaused && !state.blocked && !document.body.classList.contains('no-scroll') &&
      (state.explicit || (supportsObserver && !motionPreference.matches && !window.navigator?.connection?.saveData)) &&
      !$$('video').some(video => !video.hasAttribute('data-loop-video') && !video.paused && !video.ended);
    const cancelDelay = state => { if (state.timer !== null) clearTimeout(state.timer); state.timer = null; };
    const update = state => {
      const playing = !state.video.paused && allowed(state);
      state.video.classList.toggle('is-playing', playing);
      state.button.innerHTML = `<span aria-hidden="true">${playing ? 'Ⅱ' : '▶'}</span>`;
      state.button.setAttribute('aria-label', `${playing ? 'Pause' : 'Play'} preview: ${state.title}`);
    };
    const play = state => {
      if (state.pending || !state.video.paused) return;
      if (!state.video.getAttribute('src')) state.video.src = state.video.dataset.src;
      state.video.muted = true;
      state.pending = true;
      Promise.resolve(state.video.play()).catch(error => {
        if (error.name !== 'AbortError') state.blocked = true;
      }).finally(() => {
        state.pending = false;
        if (!allowed(state)) state.video.pause();
        update(state);
      });
    };
    const sync = () => states.forEach(state => {
      if (!allowed(state)) {
        cancelDelay(state); state.ready = false; state.video.pause(); update(state); return;
      }
      if (state.ready) { play(state); return; }
      if (state.timer === null) state.timer = setTimeout(() => {
        state.timer = null; state.ready = true;
        if (allowed(state)) play(state);
      }, 700);
    });
    states.forEach(state => {
      state.video.muted = true;
      listen(state.video, 'play', () => update(state));
      listen(state.video, 'pause', () => update(state));
      listen(state.video, 'error', () => { state.blocked = true; state.video.pause(); update(state); });
      listen(state.button, 'click', () => {
        cancelDelay(state);
        if (!state.video.paused) state.userPaused = true;
        else {
          state.userPaused = false; state.explicit = true; state.blocked = false; state.ready = true; state.visible = true;
          $$('video').filter(video => !video.hasAttribute('data-loop-video')).forEach(video => video.pause());
        }
        sync();
      });
      update(state);
    });
    const observer = supportsObserver ? new window.IntersectionObserver(entries => {
      entries.forEach(entry => {
        const state = states.find(item => item.video === entry.target);
        if (state) state.visible = entry.isIntersecting && entry.intersectionRatio >= 0.55;
      });
      sync();
    }, {threshold: [0, 0.55]}) : null;
    states.forEach(state => observer?.observe(state.video));
    videoBindings.set(grid, {sync, destroy() {
      active = false; observer?.disconnect();
      states.forEach(state => { cancelDelay(state); state.video.pause(); });
      cleanups.forEach(cleanup => cleanup());
    }});
  }

  function videoMarkup(p) {
    if (p.mediaLinksOnly) return `<ul class="resource-list">${resourceLinks(p.links)}</ul>`;
    const v = p.video;
    if (v && v.type === 'file' && safeURL(v.url)) {
      const label = escapeHTML(v.title || 'Project video');
      const video = `<video class="project-video" width="${Number(v.width) || 1600}" height="${Number(v.height) || 900}" ${v.loop ? 'muted loop data-loop-video' : 'controls'} playsinline preload="none" aria-label="${label}" ${safeURL(v.poster) ? `poster="${safeURL(v.poster)}"` : ''}><source src="${safeURL(v.url)}" type="video/mp4"><p>Your browser cannot play this video. <a href="${safeURL(v.url)}">Open the recording</a>.</p></video>`;
      const sourceLink = p.videoLink && safeURL(p.videoLink.url) ? `<p class="video-source"><a href="${safeURL(p.videoLink.url)}" target="_blank" rel="noopener noreferrer">${escapeHTML(p.videoLink.title)}<span class="sr-only"> (opens in a new tab)</span></a></p>` : '';
      return (v.loop ? `<div class="loop-player">${video}<button type="button" class="loop-toggle" aria-label="Play clip: ${label}"><span aria-hidden="true">▶</span></button></div>` : video) + sourceLink;
    }
    if (v && v.type === 'youtube' && /^[A-Za-z0-9_-]{11}$/.test(v.id)) {
      const canEmbed = /^https?:$/.test(window.location.protocol);
      return `<div class="youtube-player">${canEmbed ? `<div class="video-consent"><button class="button load-video" data-video="${escapeHTML(v.id)}" type="button">Load YouTube video</button></div>` : ''}<p class="video-fallback"><a ${canEmbed ? '' : 'class="button" '}href="https://www.youtube.com/watch?v=${escapeHTML(v.id)}" target="_blank" rel="noopener noreferrer">Watch on YouTube<span class="sr-only"> (opens in a new tab)</span></a></p></div>`;
    }
    return '';
  }

  function resourceLinks(items = []) {
    return items.filter(item => safeURL(item.url)).map(item => `<li><a href="${safeURL(item.url)}" target="_blank" rel="noopener noreferrer">${escapeHTML(item.title)}<span class="sr-only"> (opens in a new tab)</span></a></li>`).join('');
  }

  function releaseVideo(container) {
    videoBindings.get(container)?.destroy();
    videoBindings.delete(container);
  }

  function updateVideoPlayback() {
    videoBindings.forEach(binding => binding.sync());
  }

  function bindVideo(container) {
    releaseVideo(container);
    const videos = $$('video', container);
    const cleanups = [];
    const listen = (target, event, handler) => {
      target.addEventListener(event, handler);
      cleanups.push(() => target.removeEventListener(event, handler));
    };
    const supportsObserver = typeof window.IntersectionObserver === 'function';
    let active = true;
    const states = videos.filter(video => video.hasAttribute('data-loop-video')).map(video => ({
      video, button: $('.loop-toggle', video.parentElement), visible: !supportsObserver,
      userPaused: false, userStarted: false, blocked: false, pending: false
    }));
    const canPlay = state => active && state.visible && !document.hidden &&
      !state.userPaused && !state.blocked &&
      (state.userStarted || (supportsObserver && !motionPreference.matches)) &&
      !document.body.classList.contains('no-scroll') &&
      !$$('video').some(video => !video.hasAttribute('data-loop-video') && !video.paused && !video.ended);
    const updateButton = state => {
      const playing = !state.video.paused;
      state.button.innerHTML = `<span aria-hidden="true">${playing ? 'Ⅱ' : '▶'}</span>`;
      state.button.setAttribute('aria-label', `${playing ? 'Pause' : 'Play'} clip: ${state.video.getAttribute('aria-label')}`);
    };
    const play = state => {
      if (state.pending || !state.video.paused) return;
      state.pending = true;
      Promise.resolve(state.video.play()).catch(error => {
        if (error.name !== 'AbortError') state.blocked = true;
      }).finally(() => {
        state.pending = false;
        if (!canPlay(state)) state.video.pause();
        else if (state.video.paused) play(state);
        updateButton(state);
      });
    };
    const sync = () => states.forEach(state => {
      if (canPlay(state)) play(state);
      else state.video.pause();
    });
    states.forEach(state => {
      state.video.muted = true;
      const toggle = () => {
        if (state.video.paused) {
          state.userPaused = false;
          state.userStarted = true;
          state.blocked = false;
          state.visible = true;
          $$('video').filter(video => !video.hasAttribute('data-loop-video')).forEach(video => video.pause());
          if (canPlay(state)) play(state);
        } else {
          state.userPaused = true;
          state.video.pause();
        }
      };
      listen(state.button, 'click', toggle);
      listen(state.video, 'click', toggle);
      listen(state.video, 'play', () => updateButton(state));
      listen(state.video, 'pause', () => updateButton(state));
      updateButton(state);
    });
    const observer = supportsObserver && states.length ? new window.IntersectionObserver(entries => {
      entries.forEach(entry => {
        const state = states.find(item => item.video === entry.target);
        if (state) state.visible = entry.isIntersecting && entry.intersectionRatio >= 0.25;
      });
      sync();
    }, {threshold: [0, 0.25]}) : null;
    states.forEach(state => observer?.observe(state.video));
    videos.filter(video => !video.hasAttribute('data-loop-video')).forEach(video => {
      listen(video, 'play', () => {
        $$('video').forEach(other => { if (other !== video) other.pause(); });
        updateVideoPlayback();
      });
      listen(video, 'pause', updateVideoPlayback);
      listen(video, 'ended', updateVideoPlayback);
    });
    $$('.load-video', container).forEach(videoButton => listen(videoButton, 'click', () => {
      const frame = document.createElement('iframe');
      frame.className = 'project-video';
      frame.src = `https://www.youtube-nocookie.com/embed/${videoButton.dataset.video}`;
      frame.title = 'Project video';
      frame.allow = 'encrypted-media; picture-in-picture; fullscreen';
      frame.allowFullscreen = true;
      frame.referrerPolicy = 'strict-origin-when-cross-origin';
      frame.tabIndex = 0;
      videoButton.parentElement.replaceWith(frame);
      frame.focus();
    }));
    videoBindings.set(container, {sync, destroy() {
      active = false;
      observer?.disconnect();
      cleanups.forEach(cleanup => cleanup());
      videos.forEach(video => video.pause());
    }});
  }

  function clipPair(clips, note, comparison = false) {
    const items = clips.filter(clip => safeURL(clip.url));
    if (!items.length) return '';
    return `${note ? `<p class="clips-note">${escapeHTML(note)}</p>` : ''}<div class="clip-pair${comparison ? ' is-comparison' : ''}">${items.map(clip => `<figure class="clip"><h3>${escapeHTML(clip.title)}</h3>${videoMarkup({video: {...clip, type: 'file'}})}<figcaption>${escapeHTML(clip.description)}</figcaption></figure>`).join('')}</div>`;
  }

  function imageButton(item) {
    if (!safeURL(item.src)) return '';
    return `<button type="button" class="image-open" data-image="${safeURL(item.src)}" data-alt="${escapeHTML(item.alt)}" aria-label="Enlarge: ${escapeHTML(item.title)}"><img src="${safeURL(item.src)}" alt="${escapeHTML(item.alt)}" width="${Number(item.width) || 1200}" height="${Number(item.height) || 800}" loading="lazy"></button>`;
  }

  function imageGallery(items = [], paired = false) {
    const images = items.filter(item => safeURL(item.src));
    if (!images.length) return '';
    return `<div class="case-gallery${paired ? ' gallery-pair' : ''}">${images.map(item => `<figure class="gallery-figure">${imageButton(item)}<figcaption><h3>${escapeHTML(item.title)}</h3>${item.caption ? `<p>${escapeHTML(item.caption)}</p>` : ''}</figcaption></figure>`).join('')}</div>`;
  }

  function caseSection(section) {
    const parts = [
      `<h2>${escapeHTML(section.title)}</h2>`,
      section.rules && definitionList('minigame-rules', section.rules),
      ...(section.paragraphs || []).map(text => `<p>${escapeHTML(text)}</p>`),
      section.statements && definitionList('design-notes', section.statements),
      section.flow && `<ol class="step-list">${section.flow.map(item => `<li><h3>${escapeHTML(item.title)}</h3><p>${escapeHTML(item.text)}</p></li>`).join('')}</ol>`,
      section.credits && definitionList('pair-list', section.credits),
      section.examples && `<div class="work-examples"><h3>${escapeHTML(section.examples.title)}</h3>${textList(section.examples.items)}</div>`,
      imageGallery(section.gallery, section.galleryPaired),
      section.clips && clipPair(section.clips, section.clipsNote, section.clipsComparison),
      section.video && `<figure class="case-recording">${videoMarkup(section)}${section.videoCaption ? `<figcaption>${escapeHTML(section.videoCaption)}</figcaption>` : ''}</figure>`,
      section.callout && `<aside class="callout"><h3>${escapeHTML(section.callout.label)}</h3>${section.callout.text ? `<p>${escapeHTML(section.callout.text)}</p>` : ''}${section.callout.items ? textList(section.callout.items) : ''}</aside>`
    ];
    return `<section class="case-section" id="case-${escapeHTML(section.id)}">${parts.filter(Boolean).join('')}</section>`;
  }

  function renderProject(p) {
    releaseVideo(projectView);
    const next = projects[(projects.indexOf(p) + 1) % projects.length];
    const anchor = id => `#project/${encodeURIComponent(p.id)}/${id}`;
    const sections = [...(p.caseSections || []).map(s => [s.id, s.navTitle || s.title]), ...(p.hideMedia ? [] : [['media', p.mediaTitle || 'Media']])];
    const facts = [['My role', p.role], ['Team', p.team], ['Duration', p.duration], ['Engine / tools', p.engine]].filter(([, value]) => value);
    const figure = p.videoInIntro && hasVideo(p) ? videoMarkup(p) : cover(p, true);
    const award = p.award ? `<p class="jam-result"><strong>${escapeHTML(p.award.result)}</strong> ${escapeHTML(p.award.event)} · Theme: ${escapeHTML(p.award.theme)}</p>` : '';
    const links = (p.links || []).length ? `<ul class="resource-list">${resourceLinks(p.links)}</ul>` : '';
    const jump = p.projectJump || (!p.hideMedia && hasVideo(p) && !p.videoInIntro ? {section: 'media', label: p.mediaTitle || 'Watch the video'} : null);
    const experience = p.experience ? `<aside class="experience" aria-labelledby="experience-title"><h2 id="experience-title">Player experience</h2><div class="experience-copy"><p>${escapeHTML(p.experience)}</p>${p.experienceDetail ? `<p class="experience-detail">${escapeHTML(p.experienceDetail)}</p>` : ''}</div></aside>` : '';
    const media = p.hideMedia ? '' : `<section class="case-section" id="case-media"><h2>${escapeHTML(p.mediaTitle || 'Media')}</h2>${videoMarkup(p)}${(p.documents || []).length ? `<ul class="resource-list">${resourceLinks(p.documents)}</ul>` : ''}</section>`;
    projectView.innerHTML = `<nav class="project-nav" aria-label="Project navigation"><a href="#work"><span aria-hidden="true">←</span> All projects</a></nav>
      <header class="project-head"><p class="project-category">${escapeHTML(p.categoryLabel)}</p><h1 id="project-title" tabindex="-1">${escapeHTML(p.title)}</h1><p class="project-lead">${escapeHTML(p.summary)}</p></header>
      <dl class="project-facts">${facts.map(([label, value]) => `<div><dt>${label}</dt><dd>${escapeHTML(value)}</dd></div>`).join('')}</dl>
      <div class="project-intro-grid"><div><div class="project-figure">${figure}</div>${award}</div><aside class="contribution-summary"><h2>My contribution</h2>${textList(p.contributions || [])}${links}${jump ? `<a class="project-jump" href="${anchor(jump.section)}">${escapeHTML(jump.label)} <span aria-hidden="true">↓</span></a>` : ''}</aside></div>
      ${experience}
      <div class="case-layout"><nav class="case-index" aria-label="On this page"><p class="case-index-title">On this page</p>${sections.map(([id, label]) => `<a href="${anchor(id)}">${escapeHTML(label)}</a>`).join('')}</nav>
      <div class="case-content">${(p.caseSections || []).map(caseSection).join('')}${media}</div></div>
      <div class="project-end"><a class="button" href="#work">All projects</a>${next && next.id !== p.id ? `<a class="next-project" href="#project/${encodeURIComponent(next.id)}">Next project: ${escapeHTML(next.title)} <span aria-hidden="true">→</span></a>` : ''}</div>`;
    bindVideo(projectView);
    $$('.image-open', projectView).forEach(button => button.addEventListener('click', () => openImage(button)));
  }

  const menu = $('.menu-toggle');
  const nav = $('#main-nav');
  function closeMenu() {
    nav.classList.remove('is-open');
    menu.setAttribute('aria-expanded', 'false');
    menu.textContent = 'Menu';
  }
  menu.addEventListener('click', () => {
    if (menu.getAttribute('aria-expanded') === 'true') closeMenu();
    else {
      nav.classList.add('is-open');
      menu.setAttribute('aria-expanded', 'true');
      menu.textContent = 'Close';
    }
  });
  nav.addEventListener('click', event => {
    if (event.target.closest('a, button')) closeMenu();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && menu.getAttribute('aria-expanded') === 'true') { closeMenu(); menu.focus(); }
  });
  window.matchMedia('(min-width: 601px)').addEventListener('change', closeMenu);

  function focusAndScroll(target, initial = false) {
    if (!target) return;
    if (!initial) {
      if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
      target.focus({preventScroll: true});
    }
    target.scrollIntoView({behavior: 'instant', block: 'start'});
  }

  function route(initial = false) {
    cancelAnimationFrame(navigationFrame);
    const hash = window.location.hash.slice(1);
    if (hash === 'main-content') { focusAndScroll($('#main-content')); return; }
    const match = hash.match(/^project\/([^/]+)(?:\/([a-z0-9-]+))?$/);
    let p = null;
    if (match) {
      try { p = data.projects.find(item => item.id === decodeURIComponent(match[1])); } catch {}
    }
    closeMenu();
    if (p) {
      const changed = currentProject !== p.id;
      if (changed) renderProject(p);
      currentProject = p.id;
      home.hidden = true;
      projectView.hidden = false;
      document.title = `${p.title} — ${data.name}`;
      navigationFrame = requestAnimationFrame(() => {
        if (currentProject !== p.id || projectView.hidden) return;
        if (match[2]) focusAndScroll($(`#case-${match[2]}`), initial);
        else if (changed || initial) { window.scrollTo({top: 0, behavior: 'instant'}); $('#project-title')?.focus({preventScroll: true}); }
      });
    } else {
      const wasProject = !!currentProject;
      currentProject = null;
      home.hidden = false;
      projectView.hidden = true;
      if (wasProject) { releaseVideo(projectView); projectView.innerHTML = ''; }
      document.title = `${data.name} — Game Designer`;
      const target = ['work', 'about', 'contact', 'home'].includes(hash) ? $(`#${hash}`) : hash.startsWith('project/') ? $('#work') : null;
      navigationFrame = requestAnimationFrame(() => {
        if (target) focusAndScroll(target, initial);
        else if (wasProject) window.scrollTo({top: 0, behavior: 'instant'});
      });
    }
    updateVideoPlayback();
  }

  const mediaDialog = $('#media-dialog');
  let mediaTrigger = null;
  function openImage(trigger) {
    if (!safeURL(trigger.dataset.image)) return;
    mediaTrigger = trigger;
    $('#media-content').innerHTML = `<img class="enlarged-image" src="${safeURL(trigger.dataset.image)}" alt="${escapeHTML(trigger.dataset.alt)}">`;
    mediaDialog.showModal();
    document.body.classList.add('no-scroll');
    $$('video', projectView).forEach(video => video.pause());
    updateVideoPlayback();
    $('.dialog-close', mediaDialog).focus();
  }
  $('.dialog-close', mediaDialog).addEventListener('click', () => mediaDialog.close());
  mediaDialog.addEventListener('close', () => {
    $('#media-content').innerHTML = '';
    document.body.classList.remove('no-scroll');
    updateVideoPlayback();
    if (mediaTrigger && mediaTrigger.isConnected) mediaTrigger.focus();
  });
  mediaDialog.addEventListener('click', event => {
    if (event.target === mediaDialog || event.target.classList.contains('enlarged-image')) mediaDialog.close();
  });

  $$('[data-cv]').forEach(link => {
    const available = Boolean(safeURL(data.cvUrl));
    link.href = available ? data.cvUrl : `mailto:${data.email}?subject=CV%20request`;
    $('[data-cv-label]', link).textContent = available ? 'CV' : 'Request CV';
    if (available) { link.target = '_blank'; link.rel = 'noopener noreferrer'; }
  });
  if (data.designFocus) $('[data-design-focus]').textContent = data.designFocus;
  $$('[data-email]').forEach(link => { link.href = `mailto:${data.email}`; if (link.classList.contains('contact-email')) link.textContent = data.email; });
  $$('[data-linkedin]').forEach(link => { if (/^https:\/\//.test(data.linkedin)) link.href = data.linkedin; });
  $('#year').textContent = String(new Date().getFullYear());
  renderFilters();
  renderCards();
  document.addEventListener('visibilitychange', updateVideoPlayback);
  motionPreference.addEventListener('change', updateVideoPlayback);
  window.addEventListener('hashchange', () => route());
  route(true);
})();
