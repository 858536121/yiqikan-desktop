import { THEATER_STYLE_ID, THEATER_TARGET_CLASS } from '../contracts';
import { findBestPlayerInFrame } from './players';

export function applyTheaterMode(enable: boolean) {
    try {
      if (window.__yiqikanPlayer && window.__yiqikanPlayer.fullscreen(enable)) return;
      var existing = document.getElementById(THEATER_STYLE_ID);
      if (enable) {
        if (!existing) {
          var s = document.createElement('style');
          s.id = THEATER_STYLE_ID;
          s.innerHTML = `html, body { overflow: hidden !important; background: #000 !important; margin: 0 !important; padding: 0 !important; width: 100vw !important; height: 100vh !important; } header, .header, nav, .nav, .bili-header, .site-nav, .search-box, .m-navbar, #biliMainHeader { display: none !important; } .${THEATER_TARGET_CLASS} { position: fixed !important; top: 0 !important; left: 0 !important; width: 100vw !important; height: 100vh !important; z-index: 2147483647 !important; background: #000 !important; margin: 0 !important; padding: 0 !important; }`;
          document.head.appendChild(s);
        }
        var player = findBestPlayerInFrame();
        var targetEl = (player && player.element ? (player.element.closest('.bpx-player-container, .player-container, #player, .txp_player, .iqp-player, .m-video-player') || player.element) : document.querySelector('video'));
        if (targetEl) {
          targetEl.classList.add(THEATER_TARGET_CLASS);
        }
      } else {
        if (existing) existing.remove();
        var targets = document.querySelectorAll('.' + THEATER_TARGET_CLASS);
        for (var i = 0; i < targets.length; i++) {
          targets[i].classList.remove(THEATER_TARGET_CLASS);
        }
        setTimeout(function() {
          window.dispatchEvent(new Event('resize'));
        }, 100);
      }
    } catch (e) {}
  }
