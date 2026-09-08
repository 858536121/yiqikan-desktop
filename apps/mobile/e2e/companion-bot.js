#!/usr/bin/env node

/**
 * 异起看 - 虚拟伴侣测试机器人 (Virtual Companion Bot)
 * 专门用于在单设备/单模拟器环境下，作为“第二位异地伴侣”参与同屏测试
 */

let io;
try {
  io = require('socket.io-client').io;
} catch {
  io = require('../node_modules/socket.io-client').io;
}

const SERVER_URL = process.env.SERVER_URL || 'http://127.0.0.1:8787';

function createCompanionBot({
  userName = '异地恋小红薯妹子',
  serverUrl = SERVER_URL,
  sessionId = 'bot_' + Math.random().toString(36).substring(2, 8),
} = {}) {
  let socket = null;
  let currentRoomId = null;

  function connect() {
    return new Promise((resolve, reject) => {
      socket = io(serverUrl, {
        transports: ['websocket'],
        auth: {
          sessionId,
          client: {
            appName: '异起看-测试伴侣Bot',
            appVersion: '1.0.0',
            protocolVersion: 1,
            platform: 'mobile',
            releaseChannel: 'stable',
          },
        },
      });

      socket.on('connect', () => {
        console.log(`[Bot] 已连接实时服务: ${serverUrl} (Socket: ${socket.id})`);
        resolve(socket);
      });

      socket.on('connect_error', (err) => {
        console.error(`[Bot] 连接失败:`, err.message);
        reject(err);
      });
    });
  }

  function joinRoom(roomId, password) {
    return new Promise((resolve, reject) => {
      if (!socket) return reject(new Error('Socket未连接'));
      currentRoomId = roomId;

      socket.emit('room:join', {
        userName,
        roomId,
        password,
      });

      socket.once('room:state_snapshot', (state) => {
        console.log(`[Bot] 成功进入房间「${roomId}」! 当前成员数: ${state.members.length}`);
        resolve(state);
      });

      socket.once('room:error', (err) => {
        console.error(`[Bot] 入房失败:`, err.message);
        reject(new Error(err.message));
      });
    });
  }

  function sendChat(message) {
    if (!socket || !currentRoomId) return;
    socket.emit('chat:message', {
      roomId: currentRoomId,
      message,
      kind: 'text',
    });
    console.log(`[Bot] 发送弹幕: "${message}"`);
  }

  function leaveRoom() {
    if (!socket || !currentRoomId) return;
    socket.emit('room:leave', { roomId: currentRoomId });
    console.log(`[Bot] 已离开房间「${currentRoomId}」`);
    currentRoomId = null;
  }

  function disconnect() {
    if (socket) {
      socket.disconnect();
      socket = null;
    }
  }

  return {
    connect,
    joinRoom,
    sendChat,
    leaveRoom,
    disconnect,
    getSocket: () => socket,
    getUserId: () => sessionId,
  };
}

// 命令行运行支持
if (require.main === module) {
  const [,, command, roomId, ...args] = process.argv;

  if (!command || !roomId) {
    console.log(`用法:
  node companion-bot.js scenario <roomId> [greetingMsg] [staySeconds]
  node companion-bot.js join <roomId> [password]
  node companion-bot.js chat <roomId> <message>
    `);
    process.exit(1);
  }

  const bot = createCompanionBot({
    userName: process.env.BOT_NAME || '异地恋小红薯妹子',
  });

  if (command === 'scenario') {
    const greeting = args[0] || '宝，我进房间啦，快放电影～❤️';
    const staySeconds = parseInt(args[1] || '12', 10);

    (async () => {
      try {
        await bot.connect();
        await bot.joinRoom(roomId);
        
        // 延迟 1.5 秒发送弹幕，让前端充分展示进房动画
        setTimeout(() => {
          bot.sendChat(greeting);
        }, 1500);

        // 持续保持连接并在指定时间后退出
        setTimeout(() => {
          console.log(`[Bot] 完成协同场景，自动安全退出...`);
          bot.leaveRoom();
          setTimeout(() => {
            bot.disconnect();
            process.exit(0);
          }, 500);
        }, staySeconds * 1000);
      } catch (e) {
        console.error('[Bot Error]', e);
        process.exit(1);
      }
    })();
  }
}

module.exports = { createCompanionBot };
