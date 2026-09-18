const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// 1. 监控整个 monorepo 目录
config.watchFolders = [workspaceRoot];

// 2. 告诉 Metro 去哪里寻找 node_modules
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// 注意：这里去掉了 disableHierarchicalLookup = true
// 因为 pnpm 的幽灵依赖机制 (.pnpm 虚拟目录) 非常依赖层级查找 (Hierarchical Lookup)
// 如果禁用了层级查找，Metro 就会在 .pnpm 内部找不到 expo-modules-core 这种子依赖。

module.exports = config;
