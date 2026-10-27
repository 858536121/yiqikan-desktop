import type { Player } from './types';
import type { NativeMessage, PlayerControl, SeekRange } from '../contracts';

export function installPlayback({ findBestPlayerInFrame, wrapVideoElement, getCleanVideoTitle, sendMessage, applyTheaterMode }: PlaybackEnvironment) {
  let lastReportAt: number | undefined;
  function reportState(p: Player, eventName: string) {
    const now = Date.now();
    const progress = eventName === 'heartbeat' || eventName === 'timeupdate';
    if (progress && lastReportAt !== undefined && now - lastReportAt < 200) return;
    lastReportAt = now;
    // Native fullscreen owns transport controls while playback is available.
    // Restore the browser's trusted play control if autoplay was rejected.
    if (p.element && window.__yiqikanPlayer && window.__yiqikanPlayer.nativeControls)
      window.__yiqikanPlayer.nativeControls(!playBlocked && p.element.readyState >= 2 && !p.element.error);
    sendMessage({
      type: 'SYNC_EVENT',
      payload: {
        eventName,
        paused: p.paused,
        currentTime: p.currentTime,
        duration: p.duration || 0,
        playbackRate: p.playbackRate || 1,
        videoTitle: getCleanVideoTitle(),
        sampledAt: Date.now(),
        buffering: Boolean(p.element && (p.element.__yiqikanBuffering || (!p.paused && p.element.readyState < 3))),
        seeking: Boolean((p.element ? p.element.seeking : p.seeking) || (window.__isHost === true && hostSeek)),
        ended: Boolean(p.element && p.element.ended),
        control: playerControlState(p),
      }
    });
  }

  function playerControlState(p: Player): PlayerControl | null {
    var owner = (p.element || p.controlOwner) as HTMLVideoElement | undefined;
    if (!owner) return null;
    if (!owner.__ykControlId) {
      owner.__ykControlId = Math.random().toString(36).slice(2) + Date.now().toString(36);
      owner.__ykControlEpoch = 0;
      if (owner.addEventListener) owner.addEventListener('emptied', function() { owner!.__ykControlEpoch!++; });
    }
    var source = p.element ? String(owner.currentSrc || '') + '|' + String(owner.src || '') : p.controlSource || '';
    var hash = 2166136261;
    for (var i = 0; i < source.length; i++) { hash ^= source.charCodeAt(i); hash = Math.imul(hash, 16777619); }
    var key = owner.__ykControlId + ':' + owner.__ykControlEpoch + ':' + (hash >>> 0).toString(36);
    var ranges: SeekRange[] = [], duration = p.duration;
    if (Number.isFinite(duration) && duration > 0) {
      if (p.element && owner.seekable) {
        for (var j = 0; j < Math.min(owner.seekable.length, 32); j++) {
          var start = Math.max(0, owner.seekable.start(j)), end = Math.min(duration, owner.seekable.end(j));
          if (end > start) ranges.push({ start: start, end: end });
        }
      } else if (p.canSeek === true) ranges.push({ start: 0, end: duration });
    }
    return { key: key, ranges: ranges, ready: !playBlocked && (p.element ? owner.readyState >= 2 && !owner.error : p.canSeek === true) };
  }

  function controlSeekTarget(time: number, ranges: SeekRange[]): number | null {
    if (!Number.isFinite(time)) return null;
    var nearest: number | null = null, distance = Infinity;
    for (var range of ranges) {
      var value = Math.max(range.start, Math.min(range.end, time));
      if (Math.abs(value - time) < distance) { nearest = value; distance = Math.abs(value - time); }
    }
    return nearest;
  }

  let lastUserTouchTime = 0;
  let isApplyingSync = false;
  let syncActionTimer: ReturnType<typeof setTimeout> | null = null;

  function markProgrammaticSync(durationMs = 8000) {
    isApplyingSync = true;
    if (syncActionTimer) clearTimeout(syncActionTimer);
    syncActionTimer = setTimeout(() => {
      isApplyingSync = false;
      syncActionTimer = null;
    }, durationMs);
  }

  function clearProgrammaticSync() {
    isApplyingSync = false;
    if (syncActionTimer) {
      clearTimeout(syncActionTimer);
      syncActionTimer = null;
    }
  }

  function updateTouchTime() {
    window.__lastUserTouchTime = Date.now();
    lastUserTouchTime = window.__lastUserTouchTime;
    playBlocked = false;
  }

  document.addEventListener('touchstart', updateTouchTime, { passive: true, capture: true });
  document.addEventListener('pointerdown', updateTouchTime, { passive: true, capture: true });
  document.addEventListener('mousedown', updateTouchTime, { passive: true, capture: true });

  function hookVideoEvents(v: HTMLVideoElement) {
    if (v.__yiqikan_hooked) return;

    function isActiveVideo() {
      if (window.__yiqikanInactiveFrame) return false;
      var player = findBestPlayerInFrame();
      return !player || !player.element || player.element === v;
    }

    v.addEventListener('play', (e) => {
      if (!isActiveVideo()) return;
      const touchTime = window.__lastUserTouchTime || lastUserTouchTime || 0;
      const isManualUserGesture = (Date.now() - touchTime) < 1500;
      const isLocalMedia = v.id === 'yiqikan-local-video';
      if (window.__isHost === false && !isApplyingSync && isManualUserGesture && !isLocalMedia) {
        v.pause();
        sendMessage({ type: 'HOST_ONLY_WARNING', message: '仅房主可操作播放，自动恢复跟播' });
        sendMessage({ type: 'REQUEST_RESYNC' });
        return;
      }
      clearProgrammaticSync();
      var p = findBestPlayerInFrame() || wrapVideoElement(v);
      reportState(p, 'play');
    });

    v.addEventListener('pause', (e) => {
      if (!isActiveVideo()) return;
      clearProgrammaticSync();
      var p = findBestPlayerInFrame() || wrapVideoElement(v);
      reportState(p, 'pause');
    });

    v.addEventListener('seeked', (e) => {
      if (!isActiveVideo()) return;
      const touchTime = window.__lastUserTouchTime || lastUserTouchTime || 0;
      const isManualUserGesture = (Date.now() - touchTime) < 1500;
      const isLocalMedia = v.id === 'yiqikan-local-video';
      if (window.__isHost === false && !isApplyingSync && isManualUserGesture && !isLocalMedia) {
        sendMessage({ type: 'HOST_ONLY_WARNING', message: '仅房主可调整进度，自动恢复跟播' });
        sendMessage({ type: 'REQUEST_RESYNC' });
        return;
      }
      clearProgrammaticSync();
      var p = findBestPlayerInFrame() || wrapVideoElement(v);
      if (window.__isHost === true) {
        // A newer native drag may be waiting for this older seek to finish.
        reconcileVideoSync();
        settleHostSeek();
        return;
      }
      reportState(p, 'seeked');
    });

    v.addEventListener('timeupdate', () => {
      if (!isActiveVideo()) return;
      if (!window._lastUpdate || Date.now() - window._lastUpdate >= 250) {
        var p = findBestPlayerInFrame() || wrapVideoElement(v);
        reportState(p, 'timeupdate');
        window._lastUpdate = Date.now();
      }
    });

    ['waiting', 'stalled', 'seeking', 'loadeddata', 'canplay', 'playing', 'ratechange', 'ended', 'emptied', 'loadstart', 'durationchange'].forEach((eventName) => {
      v.addEventListener(eventName, () => {
        if (!isActiveVideo()) return;
        if (eventName === 'seeking' && window.__isHost === true) beginHostSeek(findBestPlayerInFrame() || wrapVideoElement(v));
        if (eventName === 'waiting' || (eventName === 'stalled' && v.readyState < 3)) v.__yiqikanBuffering = true;
        if ((eventName === 'canplay' || eventName === 'playing' || eventName === 'loadeddata') && v.readyState >= 3) v.__yiqikanBuffering = false;
        if (eventName === 'ended') window.__resetVideoSync();
        var p = findBestPlayerInFrame() || wrapVideoElement(v);
        reportState(p, eventName);
        if (eventName === 'loadeddata' || eventName === 'canplay' || eventName === 'playing') reconcileVideoSync();
      });
    });
    v.__yiqikan_hooked = true;
  }

  let latestSync: SyncTarget | null = null;
  let syncPlayer: Player | null = null;
  let lastSeekAt = -Infinity;
  let seekNeedsProgress = false;
  let syncWasUnavailable = false;
  let recoveryReadyAt = -Infinity;
  let lastSeekPosition = 0;
  let driftVotes = { direction: 0, count: 0, at: -Infinity };
  let playBlocked = false;
  let playPending: { generation: number } | null = null;
  let syncGeneration = 0;
  let desiredSyncPause: boolean | null = null;
  // Independent of latestSync: heartbeats and our own seek events must never
  // refill the budget for loading an uncached target.
  let recovery = newSyncRecovery();
  let recoveryControl: string | null = null;
  let rateCorrection = 0;
  function newSyncRecovery(): SyncRecovery {
    return { attempts: 0, cachedAttempts: 0, afterLoading: false, nextAt: -Infinity, lagSince: null, lagClass: null, stableSince: null,
      alignedSince: null, position: null, progressAt: -Infinity, advanced: false, limited: false };
  }
  function clearSyncRecovery() {
    if (recovery.limited) sendMessage({ type: 'SYNC_RECOVERY', phase: 'aligned' });
    recovery = newSyncRecovery();
  }

  let hostSeek: HostSeek | null = null;
  let hostSeekTimer: ReturnType<typeof setTimeout> | null = null;
  const syncNow = () => window.performance && typeof window.performance.now === 'function' ? window.performance.now() : Date.now();

  function beginHostSeek(player: Player, target?: number) {
    if (hostSeekTimer) clearTimeout(hostSeekTimer);
    hostSeekTimer = null;
    hostSeek = { player, target, origin: player.currentTime, startedAt: syncNow(), rate: player.playbackRate, confirmed: false,
      controlKey: latestSync ? latestSync.controlKey : undefined };
  }

  function hostSeekIsReady(pending: HostSeek) {
    const player = findBestPlayerInFrame();
    if (!player || (player.element || player.isPlatformAdapter) !== (pending.player.element || pending.player.isPlatformAdapter)) return false;
    if (pending.controlKey && (!playerControlState(player) || playerControlState(player)!.key !== pending.controlKey)) return false;
    if (latestSync && !latestSync.remote && latestSync.force) return false;
    const video = player.element;
    const readyState = video ? video.readyState : player.readyState;
    if ((video ? video.seeking : player.seeking) || readyState! < (player.paused ? 2 : 3)
      || (!player.paused && video && video.__yiqikanBuffering)) return false;
    if (!player.element && typeof pending.target === 'number' && !pending.confirmed) {
      // API-only players have no seeked event: wait for their real media clock.
      const advance = Math.max(0, syncNow() - pending.startedAt) / 1000 * Math.max(pending.rate, player.playbackRate);
      if (player.currentTime < pending.target - 0.75 || player.currentTime > pending.target + advance + 0.75) return false;
      if (Math.abs(pending.target - pending.origin) > 0.75 && Math.abs(player.currentTime - pending.origin) < 0.1) return false;
      pending.confirmed = true;
    }
    return true;
  }

  function settleHostSeek() {
    const pending = hostSeek;
    if (pending && pending.controlKey) {
      const current = findBestPlayerInFrame();
      if (!current || !playerControlState(current) || playerControlState(current)!.key !== pending.controlKey) {
        window.__resetVideoSync();
        return;
      }
    }
    if (!pending || hostSeekTimer || !hostSeekIsReady(pending)) return;
    // Website scrubbing may finish several seeks in a burst. Publish the last
    // settled position through the same path as a native toolbar drag.
    hostSeekTimer = setTimeout(() => {
      hostSeekTimer = null;
      if (hostSeek !== pending || !hostSeekIsReady(pending)) return;
      hostSeek = null;
      reportState(findBestPlayerInFrame()!, 'seeked');
    }, 250);
  }

  function restoreSyncRate(player: Player | null, rate: number) {
    if (player && player.playbackRate !== rate) player.playbackRate = rate;
  }

  function hasSyncBuffer(player: Player, position: number, rate: number) {
    const ranges = player.element && player.element.buffered;
    // Some platform adapters do not expose buffered ranges.
    if (!ranges) return true;
    const end = Number.isFinite(player.duration) && player.duration > 0
      ? Math.min(position + 2 * rate, player.duration) : position + 2 * rate;
    try {
      for (let i = 0; i < ranges.length; i++) {
        if (position >= ranges.start(i) && end <= ranges.end(i) + 0.05) return true;
      }
    } catch (e) { return false; }
    return false;
  }

  function startSyncPlayback(player: Player, remote: boolean) {
    if (playPending || playBlocked) return;
    markProgrammaticSync();
    const attempt = { generation: syncGeneration };
    playPending = attempt;
    Promise.resolve(player.play()).then(() => {
      // A reset invalidates the old goal, but a newer pause still wins if play
      // completes late. This also covers local toolbar play without a position.
      if (desiredSyncPause === true) player.pause();
    }).catch((error) => {
      if (attempt.generation !== syncGeneration || (error && error.name === 'AbortError')) return;
      playBlocked = true;
      if (remote) {
        sendMessage({ type: 'LOG', msg: '播放未能启动，请点击播放后恢复跟播' });
      }
      reportState(player, 'playblocked');
    }).finally(() => { if (playPending === attempt) playPending = null; });
  }

  window.__yiqikanResumeInGesture = () => {
    if (window.__isHost !== false || window.__followSyncEnabled !== true || desiredSyncPause !== false) return;
    const player = findBestPlayerInFrame();
    if (!player) return;
    playBlocked = false;
    startSyncPlayback(player, true);
  };

  window.__resetVideoSync = (preserveHostSeek = false) => {
    if (!preserveHostSeek) {
      if (hostSeekTimer) clearTimeout(hostSeekTimer);
      hostSeekTimer = null;
      hostSeek = null;
    }
    syncGeneration++;
    playBlocked = false;
    playPending = null;
    if (syncPlayer && latestSync) restoreSyncRate(syncPlayer, latestSync.playbackRate);
    latestSync = null;
    syncPlayer = null;
    seekNeedsProgress = false;
    clearSyncRecovery();
    recoveryControl = null;
    rateCorrection = 0;
    syncWasUnavailable = false;
    recoveryReadyAt = -Infinity;
    lastSeekAt = -Infinity;
    driftVotes = { direction: 0, count: 0, at: -Infinity };
  };

  function reconcileVideoSync() {
    settleHostSeek();
    if (!latestSync) return;
    const player = findBestPlayerInFrame();
    if (!player) return;
    if (syncPlayer && (player.element || player.isPlatformAdapter) !== (syncPlayer.element || syncPlayer.isPlatformAdapter)) {
      window.__resetVideoSync();
      sendMessage({ type: 'REQUEST_RESYNC' });
      return;
    }
    syncPlayer = player;
    const cmd = latestSync;
    if (cmd.controlKey && (window.__isHost === false || !playerControlState(player) || playerControlState(player)!.key !== cmd.controlKey)) {
      window.__resetVideoSync();
      return;
    }
    desiredSyncPause = cmd.paused;
    const now = syncNow();
    const rate = cmd.playbackRate;
    if (cmd.remote && (window.__followSyncEnabled === false || now - cmd.sampleAt > 3000)) {
      restoreSyncRate(player, rate);
      latestSync = null;
      driftVotes = { direction: 0, count: 0, at: -Infinity };
      return;
    }
    const video = player.element;
    const seeking = video ? video.seeking : player.seeking;
    const readyState = video ? video.readyState : player.readyState;
    if (playBlocked && !cmd.paused) {
      restoreSyncRate(player, rate);
      return;
    }
    const ready = readyState === undefined || readyState >= (cmd.force || cmd.paused ? 2 : 3);
    const buffering = video && video.__yiqikanBuffering;
    if (seeking || buffering || (readyState !== undefined && readyState < 3)) {
      syncWasUnavailable = true;
      recovery.afterLoading = true;
    } else if (syncWasUnavailable) {
      // Require actual progress after recovery, rather than an unconditional
      // extra second. Our own seek callbacks do not replenish alignment budgets.
      recoveryReadyAt = now + 300;
      syncWasUnavailable = false;
    }
    let target: number | null = cmd.currentTime;
    if (!cmd.paused && cmd.remote) target += Math.max(0, now - cmd.sampleAt) / 1000 * rate;
    if (Number.isFinite(player.duration) && player.duration > 0) target = Math.min(player.duration, target);
    target = Math.max(0, target);
    if (cmd.controlKey) {
      target = controlSeekTarget(target, playerControlState(player)!.ranges);
      if (target === null) { window.__resetVideoSync(); return; }
    }
    if (video && video.ended && !cmd.paused && Number.isFinite(player.duration) && target >= player.duration - 0.05) {
      restoreSyncRate(player, rate);
      latestSync = null;
      return; // A late playing sample at the end must not restart a finished video.
    }
    const diff = target - player.currentTime;
    const gap = Math.abs(diff);
    // Thresholds are in playback seconds, scaled to equal wall-clock error at
    // different host rates. Separate entry/exit thresholds prevent rate chatter.
    const softStart = 0.35 * rate;
    const softStop = 0.15 * rate;
    const hardThreshold = 1 * rate;
    const direction = Math.sign(diff);
    const rateLimited = direction > 0 ? rate * 1.03 > 4 : direction < 0 && rate * 0.97 < 0.25;
    if (gap <= softStop || (rateCorrection && rateCorrection !== direction)) rateCorrection = 0;
    const available = ready && !seeking && !buffering && !player.paused && !cmd.paused;
    if (!available) {
      recovery.stableSince = null; recovery.position = null; recovery.advanced = false;
      recovery.lagSince = null; recovery.alignedSince = null;
    } else {
      if (recovery.stableSince === null) recovery.stableSince = now;
      if (recovery.position !== null && Math.abs(player.currentTime - recovery.position) > 0.01) {
        recovery.progressAt = now; recovery.advanced = true;
      }
      recovery.position = player.currentTime;
      if (gap <= softStart) {
        if (recovery.alignedSince === null) recovery.alignedSince = now;
        if (now - recovery.alignedSince >= 5000) clearSyncRecovery();
      } else recovery.alignedSince = null;
      const lagClass = gap > softStart && (diff > 0 || rateLimited)
        ? direction + (gap >= hardThreshold ? ':large' : ':small') : null;
      if (lagClass) {
        if (recovery.lagSince === null || recovery.lagClass !== lagClass) recovery.lagSince = now;
      } else recovery.lagSince = null;
      recovery.lagClass = lagClass;
    }
    const stableProgress = available && recovery.advanced && now - recovery.stableSince! >= 300
      && now - recovery.progressAt <= 1500;
    const loadingRecovery = cmd.remote && !cmd.force && stableProgress && gap > softStart && (diff > 0 || rateLimited) && driftVotes.count >= 2
      && recovery.lagSince !== null && now - recovery.lagSince >= (gap >= hardThreshold ? 2000 : 5000)
      && now - cmd.sampleAt <= 1500 && !hasSyncBuffer(player, target, rate)
      && !seekNeedsProgress && now - lastSeekAt >= 3000 && now >= recovery.nextAt;
    if (loadingRecovery && recovery.attempts >= 2 && !recovery.limited) {
      recovery.limited = true;
      sendMessage({ type: 'SYNC_RECOVERY', phase: 'limited', gap: diff });
    }


    if (cmd.paused && !player.paused) {
      markProgrammaticSync();
      player.pause();
    }
    if (!ready || seeking || buffering || (!cmd.force && now < recoveryReadyAt)) {
      restoreSyncRate(player, rate);
    } else {
      if (seekNeedsProgress && Math.abs(player.currentTime - lastSeekPosition) > 0.1) seekNeedsProgress = false;
      const recoveredAlignment = cmd.remote && recovery.afterLoading && stableProgress
        && gap > softStart && driftVotes.count >= 2 && now - cmd.sampleAt <= 1500
        && recovery.cachedAttempts < 2;
      const hardSeek = cmd.force || (cmd.paused && gap > softStart)
        || ((gap >= hardThreshold || (rateLimited && gap > softStart)) && driftVotes.count >= 2) || recoveredAlignment;
      // A paused media clock cannot advance to release seekNeedsProgress. Keep
      // the cooldown, but allow a later paused host position to align again.
      const loadTarget = loadingRecovery && recovery.attempts < 2;
      const cachedTarget = cmd.paused || (recovery.cachedAttempts < 2 && hasSyncBuffer(player, target, rate));
      const cooledDown = (cmd.paused || !seekNeedsProgress) && now - lastSeekAt >= 3000;
      if (loadTarget || (hardSeek && (cmd.force || (cooledDown && cachedTarget)))) {
        if (loadTarget) {
          recovery.attempts++; recovery.nextAt = now + 10000;
          recovery.lagSince = null; recovery.stableSince = null; recovery.advanced = false;
        }
        if (!cmd.force && !cmd.paused && !loadTarget) recovery.cachedAttempts++;
        recovery.afterLoading = false;
        rateCorrection = 0;
        restoreSyncRate(player, rate);
        // force means one explicit alignment, not a seek on every timer tick.
        cmd.force = false;
        driftVotes.count = 0;
        if (gap > 0.05) {
          markProgrammaticSync();
          lastSeekAt = now;
          seekNeedsProgress = true;
          if (hostSeek && !player.element) {
            hostSeek.origin = player.currentTime;
            hostSeek.startedAt = now;
            hostSeek.rate = player.playbackRate;
          }
          player.seek(target);
          lastSeekPosition = player.currentTime;
        }
      // A short rolling buffer may never include a distant target. Keep
      // converging smoothly when a hard seek is unsafe or still cooling down.
      } else if (!cmd.paused && !player.paused && gap > (rateCorrection ? softStop : softStart)
        && driftVotes.count >= 2 && (diff < 0 || hasSyncBuffer(player, player.currentTime, rate * 1.1))) {
        rateCorrection = direction;
        const adjustment = gap / rate > 0.6 ? 0.1 : gap / rate > 0.3 ? 0.06 : 0.03;
        restoreSyncRate(player, Math.max(0.25, Math.min(4, rate * (1 + direction * adjustment))));
      } else {
        rateCorrection = 0;
        restoreSyncRate(player, rate);
      }
    }
    // Starting an unready video is necessary to decode the first frame on iOS.
    // A rejected autoplay is not retried by every heartbeat.
    if (!cmd.paused && player.paused && !playPending && !playBlocked) {
      startSyncPlayback(player, cmd.remote);
    }
    // Local host controls are one-shot; the sync timer must not undo a later native pause.
    if (!cmd.remote && !cmd.force && ready && !seeking) latestSync = null;
    settleHostSeek();
  }

  window.__syncCmd = (cmd) => {
    try {
      const age = cmd.remote && typeof cmd.sampledAt === 'number' ? Math.max(0, Date.now() - cmd.sampledAt) : 0;
      // Check every remote command shape before changing playback intent. Rate
      // events may carry paused=false but omit a position.
      if (cmd.remote && (window.__followSyncEnabled === false || age > 3000)) return;
      // A recognized iframe can be presented before its media has loaded.
      if (typeof cmd.fullscreen === 'boolean') applyTheaterMode(cmd.fullscreen);
      const player = findBestPlayerInFrame();
      if (!player) return;
      if (cmd.controlKey) {
        const control = playerControlState(player);
        if (window.__isHost === false || !control || control.key !== cmd.controlKey || !control.ranges.length) return;
        // Revalidate against the real ranges in the destination frame, after
        // the RN bridge and any iframe routing delay.
        const nearest = controlSeekTarget(cmd.currentTime!, control.ranges);
        if (nearest === null || !Number.isFinite(nearest)) return;
        cmd = Object.assign({}, cmd, { currentTime: nearest });
      }
      if (cmd.force && (!cmd.controlId || cmd.controlId !== recoveryControl)) {
        clearSyncRecovery(); recoveryControl = cmd.controlId || null;
      }
      if (cmd.allowRetry) playBlocked = false;
      if (typeof cmd.paused === 'boolean') desiredSyncPause = cmd.paused;
      if (player.element) hookVideoEvents(player.element);
      const now = syncNow();
      const rate = typeof cmd.playbackRate === 'number' && cmd.playbackRate > 0 ? cmd.playbackRate
        : latestSync ? latestSync.playbackRate : player.playbackRate || 1;
      if (!cmd.remote && (typeof cmd.currentTime === 'number' || typeof cmd.paused === 'boolean')) {
        if (typeof cmd.currentTime !== 'number' && latestSync && !latestSync.remote && latestSync.force) {
          // Pause/play during loading changes intent without losing the queued seek.
          latestSync.paused = cmd.paused!;
          latestSync.playbackRate = rate;
          reconcileVideoSync();
          return;
        }
        window.__resetVideoSync(typeof cmd.currentTime !== 'number');
        playBlocked = false;
      }
      if (typeof cmd.currentTime === 'number' && Number.isFinite(cmd.currentTime)) {
        const paused = typeof cmd.paused === 'boolean' ? cmd.paused : player.paused;
        const target = cmd.currentTime + (paused ? 0 : age / 1000 * rate);
        const diff = target - player.currentTime;
        const direction = Math.sign(diff);
        if (Math.abs(diff) <= 0.15 * rate) driftVotes = { direction: 0, count: 0, at: now };
        else if (direction !== driftVotes.direction) driftVotes = { direction, count: 1, at: now };
        else if (now - driftVotes.at >= 500) driftVotes = { direction, count: driftVotes.count + 1, at: now };
        latestSync = {
          currentTime: cmd.currentTime, paused, playbackRate: rate,
          controlKey: cmd.controlKey,
          sampleAt: now - age, remote: Boolean(cmd.remote),
          force: Boolean(cmd.force || !cmd.remote || (latestSync && latestSync.force)
            || (player.paused && !paused)),
        };
        if (!cmd.remote && window.__isHost === true) beginHostSeek(player, Math.max(0,
          Number.isFinite(player.duration) && player.duration > 0 ? Math.min(player.duration, target) : target));
        reconcileVideoSync();
      } else if (latestSync && (typeof cmd.paused === 'boolean' || typeof cmd.playbackRate === 'number')) {
        if (latestSync.remote && !latestSync.paused) latestSync.currentTime += Math.max(0, now - latestSync.sampleAt) / 1000 * latestSync.playbackRate;
        latestSync.sampleAt = now;
        latestSync.playbackRate = rate;
        if (typeof cmd.paused === 'boolean') latestSync.paused = cmd.paused!;
        reconcileVideoSync();
      } else {
        if (typeof cmd.playbackRate === 'number') restoreSyncRate(player, rate);
        if (typeof cmd.paused === 'boolean') {
          markProgrammaticSync();
          if (cmd.paused) player.pause();
          else startSyncPlayback(player, Boolean(cmd.remote));
        }
      }
    } catch(e) {
      sendMessage({ type: 'LOG', msg: '指令执行报错: ' + (e as Error).message });
    }
  };

  setInterval(() => {
    try { reconcileVideoSync(); } catch (e) {}
  }, 500);
  window.__queryRealtimeStatus = (queryId) => {
    try {
      const player = findBestPlayerInFrame();
      if (player) {
        if (window.__isHost === true && (hostSeek || (player.element ? player.element.seeking : player.seeking))) {
          sendMessage({ type: 'MEDIA_REALTIME_STATUS', queryId, payload: null });
          return;
        }
        sendMessage({
          type: 'MEDIA_REALTIME_STATUS',
          queryId,
          payload: {
            sampledAt: Date.now(),
            paused: player.paused || Boolean(player.element && (player.element.__yiqikanBuffering || player.element.seeking || player.element.ended || player.element.readyState < 3)),
            currentTime: player.currentTime,
            duration: player.duration || 0,
            playbackRate: player.playbackRate || 1,
          }
        });
      }
    } catch(e) {}
  };


  return { reportState, hookVideoEvents, playerControlState, get lastTouchTime() { return lastUserTouchTime; } };
}

export interface PlaybackEnvironment {
  findBestPlayerInFrame: () => Player | null;
  wrapVideoElement: (video: HTMLVideoElement) => Player;
  getCleanVideoTitle: () => string;
  sendMessage: (message: NativeMessage) => void;
  applyTheaterMode: (enabled: boolean) => void;
}

interface SyncTarget {
  currentTime: number; paused: boolean; playbackRate: number; sampleAt: number;
  remote: boolean; force: boolean; controlKey?: string;
}
interface HostSeek {
  player: Player; target?: number; origin: number; startedAt: number; rate: number;
  confirmed: boolean; controlKey?: string;
}
interface SyncRecovery {
  attempts: number; cachedAttempts: number; afterLoading: boolean; nextAt: number;
  lagSince: number | null; lagClass: string | null; stableSince: number | null;
  alignedSince: number | null; position: number | null; progressAt: number;
  advanced: boolean; limited: boolean;
}
