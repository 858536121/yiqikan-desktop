// Shared page-local observer. Serialized source is used by WebViews and the extension;
// never stringify a function at runtime (release Hermes does not retain its source).
export const MEDIA_CONTEXT_SCRIPT = String.raw`
(function () {
    if (window.__yiqikanMediaContext)
        return;
    var selector = '.anthology-list-play a,.module-play-list a,.stui-content__playlist a,.myui-content__list a,.playlist a,.play-list a,.play_list a,.video-episode-card,.ep-item,.list-box .item,[data-yk-episode],.movie-episode-quick-tab,.movie-episode-grid button,.multi-page .list-box li,.video-pod__list .video-pod__item,.video-pod__item.simple .page-list .page-item';
    var excluded = '[data-yk-player],[data-yk-frame-player],[data-yk-entry],nav,.pagination,.ant-pagination';
    var selectedSelector = '.active,.on,.current,.selected,.playing,[aria-current="true"],[aria-current="page"],[aria-selected="true"]';
    var stamps = new WeakMap(), sequence = 0, last = null, pending = null, chosen = null, observed = false, documentToken = Math.random().toString(36).slice(2);
    function rulePlaybackPage() {
        try {
            var result = window.__yiqikanSiteRules && window.__yiqikanSiteRules.playbackPage();
            return result && result.status === 'applied' ? result.value : null;
        } catch (_) { return null; }
    }
    function shareablePlayback() { var page = rulePlaybackPage(); return page && page.shareUrl; }
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
    function nestedBiliPart(node) {
        if (!/(^|\.)bilibili\.com$/.test(location.hostname) || !node.matches('.video-pod__item.simple .page-list .page-item')) return null;
        var parent = node.closest('.video-pod__item.simple[data-key]'), bv = location.pathname.match(/\/video\/(BV[a-zA-Z0-9]+)/);
        var data = window.__INITIAL_STATE__ && window.__INITIAL_STATE__.videoData;
        if (!parent || !bv || parent.getAttribute('data-key') !== bv[1] || !data || data.bvid !== bv[1] || !Array.isArray(data.pages)) return null;
        var heading = node.querySelector('.title[title],.title-txt');
        var name = text(heading && (heading.getAttribute('title') || heading.textContent));
        var parts = data.pages.filter(function (part) { return name && text(part.part) === name && Number.isInteger(part.page) && part.page > 0; });
        return parts.length === 1 ? parts[0].page : null;
    }
    function label(node) {
        var nestedPart = nestedBiliPart(node);
        if (nestedPart) return 'P' + nestedPart;
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
            return !n.closest(excluded) && label(n)
                && !(collectionBv(n) && n.querySelector('.page-list .page-item'));
        });
    }
    function optionFor(target) {
        var nodes = options();
        for (var n = target; n && n !== document.documentElement; n = n.parentElement)
            if (nodes.indexOf(n) >= 0)
                return n;
        return null;
    }
    function collectionBv(n) {
        if (!/(^|\.)bilibili\.com$/.test(location.hostname) || !n.matches('.video-pod__list .video-pod__item.simple[data-key]'))
            return null;
        var key = n.getAttribute('data-key');
        return /^BV[a-zA-Z0-9]+$/.test(key || '') ? key : null;
    }
    function collectionItem(ep) {
        if (!ep) return null;
        var nodes = options().filter(function (n) { return collectionBv(n) && identity(label(n)) === identity(ep.label); });
        return nodes.length === 1 ? nodes[0] : null;
    }
    function episodeOf(n) {
        var nestedPart = nestedBiliPart(n);
        if (nestedPart) {
            var url = new URL(location.href); url.search = ''; url.hash = ''; url.searchParams.set('p', String(nestedPart));
            return { label: 'P' + nestedPart, url: url.href };
        }
        var bv = collectionBv(n);
        return { label: label(n), url: bv ? new URL('/video/' + bv + '/', location.href).href : n.tagName === 'A' && /^https?:/.test(n.href) ? n.href : undefined };
    }
    function activationTarget(n) {
        if (!collectionBv(n)) return n;
        // The collection container holds metadata; Vue handles clicks on
        // its inner control. Clicking the container never reaches that handler.
        var controls = n.querySelectorAll('.simple-base-item');
        return controls.length === 1 ? controls[0] : null;
    }
    function active(n) {
        return n.matches(selectedSelector) || Boolean(n.closest('li.active,li.on,li.current,li.selected')) || (n.matches('.movie-episode-quick-tab') && n.classList.contains('movie-button-primary'))
            || Boolean(collectionBv(n) && n.querySelector('.simple-base-item.active'));
    }
    function currentEpisode() {
        var page = rulePlaybackPage(); if (page && page.episode) return page.episode;
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
        var page = rulePlaybackPage(); if (page && page.title) return page.title;
        // A selector list uses document order, so .video-info-title would win
        // over its nested h1 and include counters and duplicate hidden headings.
        var h = document.querySelector('h1.video-title') || document.querySelector('h1') || document.querySelector('.video-info-title,.stui-content__detail .title,.myui-content__detail .title');
        return text(h && h.textContent) || text(document.title);
    }
    function pageIdentity(ep) {
        var u = new URL(location.href);
        var adapted = rulePlaybackPage(); if (adapted && adapted.identityUrl) return adapted.identityUrl;
        if (/(^|\.)bilibili\.com$/.test(u.hostname)) {
            var bv = u.pathname.match(/\/video\/(BV[a-zA-Z0-9]+)/);
            if (bv) {
                // Collections switch BV in the same document. Their verified
                // DOM key is available before both history and the heading.
                var item = collectionItem(ep);
                if (item) return u.hostname.replace(/^www\./, '') + '|' + collectionBv(item) + '|p1';
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
        var adaptedPage = rulePlaybackPage();
        var ep = pending ? pending.episode : currentEpisode(), identityName = title(), name = identityName, page = location.href;
        // Rules improve display metadata, never the existing identity format.
        // Different rule versions must still identify the same room content.
        try {
            var named = window.__yiqikanSiteRules && window.__yiqikanSiteRules.title();
            if (named && named.status === 'applied' && !(adaptedPage && adaptedPage.title)) name = text(named.value) || identityName;
        } catch (_) {}
        var source = external ? external.source : video ? (hash(video.getAttribute('src') || video.currentSrc || video.src || '') + '|' + stamp(video)) : '';
        var ready = external ? external.ready : Boolean(video && video.readyState >= 1 && !video.error && (video.currentSrc || video.getAttribute('src')));
        // BV + part identifies Bilibili content. Its asynchronously hydrated
        // heading can also contain counters; those changes are not a new video.
        var biliVideo = /(^|\.)bilibili\.com$/.test(location.hostname) && /\/video\/BV[a-zA-Z0-9]+/.test(location.pathname);
        var collection = biliVideo && collectionItem(ep);
        if (collection) {
            var heading = collection.querySelector('.title[title],.title-txt');
            name = text(heading && (heading.getAttribute('title') || heading.textContent)) || name;
        }
        var identityPage = pageIdentity(ep);
        var semantic = biliVideo ? identityPage + '|' + identity(ep && ep.label) : ep ? identityPage + '|' + identityName + '|' + identity(ep.label) : '';
        // Hydration evidence is supplied only by an opted-in site adapter.
        // The generic observer keeps rule precedence and makes no DOM/rule
        // alias guesses for other profiles.
        var metadata = adaptedPage && adaptedPage.episodeMetadata;
        var previousMetadata = last && last.episodeMetadata;
        var hydrated = metadata && previousMetadata
            && ((metadata.selectionKey && metadata.selectionKey === previousMetadata.selectionKey)
                || (!previousMetadata.selectionKey && metadata.positionKey && metadata.positionKey === previousMetadata.positionKey));
        if (last && semantic && last.semantic && semantic !== last.semantic && source === last.source && !pending && !hydrated)
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
        if (adaptedPage && adaptedPage.privatePage) {
            result.privatePage = true; result.shareUrl = adaptedPage.shareUrl;
        }
        if (ready)
            last = { source: source, semantic: semantic, episodeMetadata: metadata };
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
    window.__yiqikanMediaContext = { read: read, options: options, optionFor: optionFor, label: label, identity: identity, currentEpisode: currentEpisode, noteSelection: noteSelection, target: target, activationTarget: activationTarget, shareablePlayback: shareablePlayback, hasObserved: function () { return observed; } };
})();
`;
