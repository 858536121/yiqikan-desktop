#!/usr/bin/env node

const { spawn, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
let io;
try {
  io = require('socket.io-client').io;
} catch {
  io = require('../node_modules/socket.io-client').io;
}

const SERVER_URL = process.env.SERVER_URL || 'http://127.0.0.1:8787';
const MAESTRO_BIN = process.env.MAESTRO_BIN || `${process.env.HOME}/.maestro/bin/maestro`;
const TEST_FLOW = path.join(__dirname, 'flows', 'test-room-exists.yaml');
const TARGET_ROOM_ID = 'test99';

async function main() {
  console.log('🚀 [E2E] 启动“房间号已存在友好提示与一键加入”自动化验证...');

  // 1. 创建机器人房主，预先占用 test99 房间号
  console.log(`📡 [Bot] 正在向服务器 (${SERVER_URL}) 预建房间「${TARGET_ROOM_ID}」...`);
  const botSocket = io(SERVER_URL, {
    transports: ['websocket'],
    auth: {
      sessionId: 'bot_host_' + Date.now(),
      client: {
        appName: '异起看-测试房主Bot',
        appVersion: '1.0.0',
        protocolVersion: 1,
        platform: 'mobile',
        releaseChannel: 'stable',
      },
    },
  });

  await new Promise((resolve, reject) => {
    botSocket.on('connect', () => {
      console.log(`[Bot] 房主机器人已连上服务器 (Socket: ${botSocket.id})`);
      botSocket.emit('room:create', {
        userName: '预建房主测试员',
        roomId: TARGET_ROOM_ID,
      });
    });

    botSocket.on('room:state_snapshot', (snapshot) => {
      console.log(`✅ [Bot] 房间「${snapshot.id}」预建成功！当前成员: ${snapshot.members.map(m => m.name).join(', ')}`);
      resolve(snapshot);
    });

    botSocket.on('room:error', (err) => {
      console.error(`❌ [Bot] 建房错误:`, err);
      // 如果房间本来就存在也OK
      if (err.code === 'ROOM_EXISTS') {
        console.log(`[Bot] 房间「${TARGET_ROOM_ID}」已在服务器中，继续测试`);
        resolve();
      } else {
        reject(err);
      }
    });

    setTimeout(() => {
      reject(new Error('预建房间超时'));
    }, 5000);
  });

  // 2. 运行 Maestro 测试流
  console.log(`\n📱 [Maestro] 开始执行 Maestro 脚本: ${TEST_FLOW}`);
  const maestroProcess = spawn(MAESTRO_BIN, ['test', TEST_FLOW], {
    stdio: 'inherit',
    env: {
      ...process.env,
      MAESTRO_DRIVER_STARTUP_TIMEOUT: '60000',
    },
  });

  const code = await new Promise((resolve) => {
    maestroProcess.on('close', resolve);
  });

  if (code !== 0) {
    console.error(`❌ [Maestro] 测试未通过，退出码: ${code}`);
    botSocket.emit('room:close', { roomId: TARGET_ROOM_ID });
    botSocket.disconnect();
    process.exit(code);
  }

  console.log(`🎉 [Maestro] 测试顺利通过！验证了以下核心场景：`);
  console.log(`  1. 输入已有房间号点击新建房间时，弹出明确友好的「房间已存在」弹窗。`);
  console.log(`  2. 弹窗清晰告知用户房间已被创建，并提供「换个房间号」与「直接加入」操作项。`);
  console.log(`  3. 用户点击「直接加入」后，应用无缝以成员身份进入目标房间，彻底解决无反馈卡死问题！`);

  // 截图留存
  const screenshotPath = path.join(__dirname, 'screenshots', 'room_exists_verified.png');
  spawnSync('xcrun', ['simctl', 'io', 'booted', 'screenshot', screenshotPath]);
  console.log(`📸 [Screenshot] 已保存验证结果截图: ${screenshotPath}`);

  // 清理
  botSocket.emit('room:close', { roomId: TARGET_ROOM_ID });
  botSocket.disconnect();
  console.log(`🧹 [Clean] 机器人已解散房间并退出连接。`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
