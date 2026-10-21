// Shared page-local observer. Serialized source is used by WebViews and the extension;
// never stringify a function at runtime (release Hermes does not retain its source).
export const MEDIA_CONTEXT_SCRIPT = String.raw`
(function () {
    if (window.__yiqikanMediaContext)
        return;
    var selector = '.anthology-list-play a,.module-play-list a,.stui-content__playlist a,.myui-content__list a,.playlist a,.play-list a,.play_list a,.video-episode-card,.ep-item,.list-box .item,[data-yk-episode],.movie-episode-quick-tab,.movie-episode-grid button,.multi-page .list-box li,.video-pod__list .video-pod__item';
    var excluded = '[data-yk-player],[data-yk-frame-player],[data-yk-entry],nav,.pagination,.ant-pagination';
    var selectedSelector = '.active,.on,.current,.selected,.playing,[aria-current="true"],[aria-current="page"],[aria-selected="true"]';
    var stamps = new WeakMap(), sequence = 0, last = null, pending = null, chosen = null, observed = false, documentToken = Math.random().toString(36).slice(2);
    function text(value) {
        return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 300);
    }
    function identity(value) {
        var s = text(value).replace(/\s+/g, '').toLowerCase(), m = s.match(/^(?:第)?(\d+)(?:集|话|期)?$/) || s.match(/^(?:ep|p)(\d+)(?:[.、:].*)?$/);
        return m ? (m[1].replace(/^0+/, '') || '0') : s;
    }
    function hash(value) {
        var h = 2166136261;
        for (var i = 0; i < value.length; i++) {
            h ^= value.charCodeAt(i);
            h = Math.imul(h, 16777619);
        }
        return (h >>> 0).toString(36);
    }
    function label(node) {
        var part = node.closest('.multi-page,.video-pod__list') && node.querySelector('.page-num');
        if (part && /^P?\s*\d+$/i.test(text(part.textContent)))
            return 'P' + identity(part.textContent);
        var named = text(node.getAttribute('data-yk-episode') || node.getAttribute('data-episode') || '');
        if (named)
            return named.slice(0, 120);
        var title = text(node.getAttribute('title'));
        if (/^(?:第\s*\d+\s*[集话期]|EP\s*\d+|P\s*\d+)$/i.test(title))
            return title;
        return text(node.textContent).slice(0, 120);
    }
    function options() {
        var nodes = Array.from(document.querySelectorAll(selector));
        document.querySelectorAll('button,a,[role="button"],[tabindex],[onclick],.cursor-pointer').forEach(function (n) {
            var title = text(n.getAttribute('title'));
            if (/^(?:第\s*\d+\s*[集话期]|EP\s*\d+)$/i.test(label(n)) || /^(?:第\s*\d+\s*[集话期]|EP\s*\d+)$/i.test(title)) {
                if (nodes.indexOf(n) < 0)
                    nodes.push(n);
            }
        });
        return nodes.filter(function (n) {
            return !n.closest(excluded) && label(n);
        });
    }
    function optionFor(target) {
        var nodes = options();
        for (var n = target; n && n !== document.documentElement; n = n.parentElement)
            if (nodes.indexOf(n) >= 0)
                return n;
        return null;
    }
    function episodeOf(n) {
        return { label: label(n), url: n.tagName === 'A' && /^https?:/.test(n.href) ? n.href : undefined };
    }
    function active(n) {
        return n.matches(selectedSelector) || Boolean(n.closest('li.active,li.on,li.current,li.selected')) || (n.matches('.movie-episode-quick-tab') && n.classList.contains('movie-button-primary'));
    }
    function currentEpisode() {
        var nodes = options().filter(active), ids = Array.from(new Set(nodes.map(function (n) {
            return identity(label(n));
        })));
        if (ids.length === 1)
            return episodeOf(nodes[0]);
        if (ids.length > 1)
            return undefined;
        if (chosen && chosen.page === location.href)
            return chosen.episode;
        if (/(^|\.)bilibili\.com$/.test(location.hostname) && /\/video\/BV/.test(location.pathname))
            return { label: 'P' + (new URL(location.href).searchParams.get('p') || '1'), url: location.href };
        return undefined;
    }
    function title() {
        // A selector list uses document order, so .video-info-title would win
        // over its nested h1 and include counters and duplicate hidden headings.
        var h = document.querySelector('h1.video-title') || document.querySelector('h1') || document.querySelector('.video-info-title,.stui-content__detail .title,.myui-content__detail .title');
        return text(h && h.textContent) || text(document.title);
    }
    function pageIdentity(ep) {
        var u = new URL(location.href);
        if (/(^|\.)bilibili\.com$/.test(u.hostname)) {
            var bv = u.pathname.match(/\/video\/(BV[a-zA-Z0-9]+)/);
            if (bv) {
                var part = u.searchParams.get('p') || '1', numbered = ep && text(ep.label).match(/^P\s*(\d+)$/i);
                if (numbered) part = numbered[1];
                else if (ep) {
                    // New video-pod layouts have CID keys instead of .page-num.
                    // The selected source can load before history updates ?p=.
                    // Use the page's BV-verified CID mapping, never list position
                    // or videoData.cid (which can still describe the first part).
                    try {
                        var data = window.__INITIAL_STATE__ && window.__INITIAL_STATE__.videoData;
                        var nodes = Array.from(document.querySelectorAll('.video-pod__list.multip .video-pod__item[data-key]')).filter(function (n) { return identity(label(n)) === identity(ep.label); });
                        if (data && data.bvid === bv[1] && Array.isArray(data.pages) && nodes.length === 1) {
                            var cid = nodes[0].getAttribute('data-key');
                            var pages = data.pages.filter(function (p) { return p && String(p.cid) === cid && Number.isInteger(p.page) && p.page > 0; });
                            if (pages.length === 1) part = String(pages[0].page);
                        }
                    } catch (_) {}
                }
                return u.hostname.replace(/^www\./, '') + '|' + bv[1] + '|p' + part;
            }
        }
        var lib = u.pathname.match(/\/(?:vodplay|play|w)\/(\d+)-(\d+)-(\d+)\.html/);
        if (lib && /(^|\.)libvio[a-z0-9]*\./i.test(u.hostname))
            return u.hostname.replace(/^www\./, '') + '|' + lib[1] + '|' + lib[3];
        ['spm_id_from', 'spm_id', 'vd_source', 'from', 'utm_source', 'utm_medium', 'utm_campaign'].forEach(function (k) {
            u.searchParams.delete(k);
        });
        u.hash = '';
        return u.href;
    }
    function stamp(video) {
        var value = stamps.get(video);
        if (!value) {
            value = { id: ++sequence, epoch: 0 };
            stamps.set(video, value);
            video.addEventListener('emptied', function () {
                value.epoch++;
            });
        }
        return documentToken + ':' + value.id + ':' + value.epoch;
    }
    function noteSelection(target) {
        var node = optionFor(target);
        if (!node)
            return null;
        var ep = episodeOf(node), cur = currentEpisode();
        if (cur && identity(cur.label) === identity(ep.label))
            return null;
        pending = { episode: ep, source: last && last.source };
        chosen = { page: location.href, episode: ep };
        return ep;
    }
    function read(video, external) {
        observed = true;
        var ep = pending ? pending.episode : currentEpisode(), identityName = title(), name = identityName, page = location.href;
        // Rules improve display metadata, never the existing identity format.
        // Different rule versions must still identify the same room content.
        try {
            var named = window.__yiqikanSiteRules && window.__yiqikanSiteRules.title();
            if (named && named.status === 'applied') name = text(named.value) || identityName;
        } catch (_) {}
        var source = external ? external.source : video ? (hash(video.getAttribute('src') || video.currentSrc || video.src || '') + '|' + stamp(video)) : '';
        var ready = external ? external.ready : Boolean(video && video.readyState >= 1 && !video.error && (video.currentSrc || video.getAttribute('src')));
        // BV + part identifies Bilibili content. Its asynchronously hydrated
        // heading can also contain counters; those changes are not a new video.
        var biliVideo = /(^|\.)bilibili\.com$/.test(location.hostname) && /\/video\/BV[a-zA-Z0-9]+/.test(location.pathname);
        var semantic = biliVideo ? pageIdentity(ep) + '|' + identity(ep && ep.label) : ep ? pageIdentity() + '|' + identityName + '|' + identity(ep.label) : '';
        if (last && semantic && last.semantic && semantic !== last.semantic && source === last.source && !pending)
            pending = { episode: ep, source: source };
        if (pending) {
            var selected = currentEpisode();
            // A late load from an intermediate selection must not release the
            // newest selection's clock while the page still identifies it otherwise.
            if (selected && pending.episode && identity(selected.label) !== identity(pending.episode.label)) {
                if (ready)
                    pending.source = source;
                ready = false;
            }
            else if (!selected && options().some(active))
                ready = false;
            else if (source === pending.source)
                ready = false;
            else if (ready) {
                chosen = { page: page, episode: pending.episode };
                ep = pending.episode;
                pending = null;
            }
        }
        var contentKey = semantic || page + '|' + identityName + '|' + source;
        var result = { key: contentKey + '|' + source, contentKey: contentKey, contentId: semantic ? 'dom-' + hash(semantic) : undefined, pageUrl: page, title: name, episode: ep, ready: ready };
        if (ready)
            last = { source: source, semantic: semantic };
        return result;
    }
    function matchingOptions(media) {
        if (!media || !media.episode)
            return [];
        return options().filter(function (n) {
            return identity(label(n)) === identity(media.episode.label);
        });
    }
    function target(media) {
        var nodes = matchingOptions(media), exact = nodes.filter(function (n) {
            return media.episode.url && n.href === media.episode.url;
        });
        if (exact.length === 1)
            return exact[0];
        var visible = nodes.filter(function (n) {
            var r = n.getBoundingClientRect();
            return r.width > 0 && r.height > 0 && getComputedStyle(n).visibility !== 'hidden';
        });
        return visible.length === 1 ? visible[0] : null;
    }
    window.__yiqikanMediaContext = { read: read, options: options, optionFor: optionFor, label: label, identity: identity, currentEpisode: currentEpisode, noteSelection: noteSelection, target: target, hasObserved: function () { return observed; } };
})();
`;
