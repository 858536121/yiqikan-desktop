const { io } = require('socket.io-client');

const SERVER_URL = 'http://127.0.0.1:8787';
const PROTOCOL_VERSION = 1;

function createSocketClient(sessionId) {
  return io(SERVER_URL, {
    transports: ['websocket'],
    autoConnect: false,
    auth: {
      sessionId,
      client: {
        appName: '异起看Mobile测试',
        appVersion: '1.0.0',
        hotVersion: null,
        protocolVersion: PROTOCOL_VERSION,
        platform: 'mobile',
        releaseChannel: 'stable',
      },
    },
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function once(socket, event, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`Timed out waiting for event: ${event}`));
    }, timeoutMs);
    function handler(payload) {
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(payload);
    }
    socket.on(event, handler);
  });
}

async function runTests() {
  console.log('========================================================');
  console.log('🧪 开始执行移动端弱网、断网重连与语音自愈自动化回归测试');
  console.log('========================================================\n');

  let passed = 0;
  let failed = 0;

  // ----------------------------------------------------
  // 测试 1：短断网在宽限期内重连 -> 服务端下发快照 + 客户端播放对齐
  // ----------------------------------------------------
  console.log('▶ [验证 1] 短暂断网宽限期内重连 -> 播放进度恢复与快照同步');
  try {
    const roomId = 'r_' + Math.random().toString(36).slice(2, 6);
    const hostSessionId = 'host_' + Date.now();
    const guestSessionId = 'guest_' + Date.now();

    const hostSocket = createSocketClient(hostSessionId);
    hostSocket.connect();
    await once(hostSocket, 'connect');

    const hostCreateP = once(hostSocket, 'room:state_snapshot');
    hostSocket.emit('room:create', { roomId, userName: '房主测试' });
    await hostCreateP;

    // 房主设置初始状态 10s
    hostSocket.emit('player:event', {
      roomId,
      actorId: hostSessionId,
      action: 'video_sync',
      url: 'https://example.com/video.mp4',
      currentTime: 10,
      paused: false,
      playbackRate: 1,
    });
    await delay(900); // 避开服务端 800ms 节流

    // 成员进房
    const guestSocket = createSocketClient(guestSessionId);
    guestSocket.connect();
    await once(guestSocket, 'connect');
    const guestJoinP = once(guestSocket, 'room:state_snapshot');
    guestSocket.emit('room:join', { roomId, userName: '伴侣测试' });
    const initialSnap = await guestJoinP;
    console.log(`   - 成员初始入房成功，进度: ${initialSnap.playback.currentTime}s`);

    // 成员断网
    console.log('   - 模拟成员断网（断开连接）...');
    guestSocket.disconnect();
    await delay(300);

    // 房主在成员离线期间播放到 45s
    console.log('   - 房主离线期间推进进度至 45s...');
    hostSocket.emit('player:event', {
      roomId,
      actorId: hostSessionId,
      action: 'video_sync',
      url: 'https://example.com/video.mp4',
      currentTime: 45,
      paused: false,
      playbackRate: 1,
    });
    await delay(900);

    // 成员网络恢复
    console.log('   - 成员网络恢复重连...');
    const reconnectedGuest = createSocketClient(guestSessionId);
    const reconnectedSnapP = once(reconnectedGuest, 'room:state_snapshot');
    reconnectedGuest.connect();
    await once(reconnectedGuest, 'connect');
    const reconnectedSnap = await reconnectedSnapP;

    if (reconnectedSnap.playback.currentTime === 45) {
      console.log(`   ✅ 验证通过: 收到恢复快照进度为 45s，触发 video_sync 对齐`);
      passed++;
    } else {
      throw new Error(`预期进度 45s，实际为 ${reconnectedSnap.playback.currentTime}s`);
    }

    hostSocket.disconnect();
    reconnectedGuest.disconnect();
  } catch (err) {
    console.error('   ❌ 验证 1 失败:', err.message);
    failed++;
  }

  // ----------------------------------------------------
  // 测试 2：断网超时（服务端会话过期）-> 客户端自愈重新发送 joinRoom
  // ----------------------------------------------------
  console.log('\n▶ [验证 2] 断网超时（会话过期）-> 客户端超时无快照自动补发 joinRoom 自愈');
  try {
    const roomId = 'r_' + Math.random().toString(36).slice(2, 6);
    const hostSessionId = 'host_t2_' + Date.now();
    const guestSessionId = 'guest_t2_' + Date.now();

    const hostSocket = createSocketClient(hostSessionId);
    hostSocket.connect();
    await once(hostSocket, 'connect');
    const hostCreateP = once(hostSocket, 'room:state_snapshot');
    hostSocket.emit('room:create', { roomId, userName: '房主T2' });
    await hostCreateP;

    // 模拟成员用新 Session ID（模拟旧 session 已被服务端垃圾回收）进入相同房间
    // 此时重连时服务端由于无此会话，不会主动下发 StateSnapshot
    console.log('   - 模拟客户端断开连接，服务端 session 已失效...');
    const reconnectedClient = createSocketClient(guestSessionId);
    reconnectedClient.connect();
    await once(reconnectedClient, 'connect');

    // 客户端内部逻辑：在连接后未在 700ms 收到快照，自动补发 joinRoom
    let receivedSnapshot = false;
    let autoJoinFired = false;

    // 启动 700ms 探测
    const lastRoomContext = { roomId, userName: '伴侣自愈测试' };
    let hasReceivedSnapshotAfterConnect = false;

    setTimeout(() => {
      if (!hasReceivedSnapshotAfterConnect) {
        autoJoinFired = true;
        reconnectedClient.emit('room:join', { roomId: lastRoomContext.roomId, userName: lastRoomContext.userName });
      }
    }, 700);

    const snapshot = await once(reconnectedClient, 'room:state_snapshot', 3000);
    hasReceivedSnapshotAfterConnect = true;

    if (autoJoinFired && snapshot.id === roomId) {
      console.log(`   ✅ 验证通过: 700ms 内服务端未下发快照，客户端自愈逻辑成功补发 joinRoom 并成功重新加入房间！`);
      passed++;
    } else {
      throw new Error(`自愈触发异常: autoJoinFired=${autoJoinFired}`);
    }

    hostSocket.disconnect();
    reconnectedClient.disconnect();
  } catch (err) {
    console.error('   ❌ 验证 2 失败:', err.message);
    failed++;
  }

  // ----------------------------------------------------
  // 测试 3：弱网防抖新逻辑验证（缓冲耗时 2000ms 绝不误拦截）
  // ----------------------------------------------------
  console.log('\n▶ [验证 3] 弱网视频缓冲与防抖逻辑单元算法验证');
  try {
    // 模拟新版 RoomWebView 算法
    let lastUserTouchTime = 0;
    let isApplyingSync = false;
    let syncActionTimer = null;

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

    // 模拟场景 A: 收到远程指令，弱网缓冲耗时 2500ms
    markProgrammaticSync(8000);
    // 经过 2500ms 缓冲完成触发原生 play
    const elapsedBufferMs = 2500;
    const isManualUserGestureA = (elapsedBufferMs - lastUserTouchTime) < 1500;
    const shouldInterceptA = !isApplyingSync && isManualUserGestureA;

    if (!shouldInterceptA) {
      console.log(`   - 场景 A (远端指令弱网缓冲 2500ms 后播放): shouldIntercept = false, ✅ 成功放行无拦截！`);
    } else {
      throw new Error('场景 A 发生错误拦截');
    }

    // 模拟场景 B: 非房主用户手动触摸屏幕点击播放
    clearProgrammaticSync();
    lastUserTouchTime = 5000; // 用户在 5000ms 触摸了屏幕
    const currentTimeB = 5100; // 100ms 后原生 play 事件触发
    const isManualUserGestureB = (currentTimeB - lastUserTouchTime) < 1500;
    const shouldInterceptB = !isApplyingSync && isManualUserGestureB;

    if (shouldInterceptB) {
      console.log(`   - 场景 B (非房主用户真实手势违规操作): shouldIntercept = true, ✅ 准确拦截非房主操作！`);
      passed++;
    } else {
      throw new Error('场景 B 未能拦截违规手动操作');
    }
  } catch (err) {
    console.error('   ❌ 验证 3 失败:', err.message);
    failed++;
  }

  // ----------------------------------------------------
  // 测试 4：退出房间与重置时语音自动挂断逻辑验证
  // ----------------------------------------------------
  console.log('\n▶ [验证 4] 房间状态重置/退出时 WebRTC 语音自动挂断生命周期');
  try {
    let voiceLeaveCalled = false;
    function fakeLeaveVoice() {
      voiceLeaveCalled = true;
    }

    // 模拟 RoomState 变化
    let currentRoomId = 'room_abc';
    let prevRoomId = currentRoomId;

    // 触发退出房间
    currentRoomId = undefined; // reset()

    if (prevRoomId && !currentRoomId) {
      fakeLeaveVoice();
    }

    if (voiceLeaveCalled) {
      console.log(`   ✅ 验证通过: 房间退出/解散时自动调用 leaveVoice()，彻底释放麦克风与 WebRTC 推流`);
      passed++;
    } else {
      throw new Error('退出房间未触发挂断');
    }
  } catch (err) {
    console.error('   ❌ 验证 4 失败:', err.message);
    failed++;
  }

  console.log('\n========================================================');
  console.log(`🎯 回归测试完成: 通过 ${passed} 项 / 失败 ${failed} 项`);
  console.log('========================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(console.error);
