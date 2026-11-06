const fs = require('node:fs/promises');
const path = require('node:path');
const { withDangerousMod, withXcodeProject, withMainApplication, IOSConfig } = require('expo/config-plugins');

module.exports = function withPlayerDevice(config) {
  config = withDangerousMod(config, ['ios', async config => {
    const name = IOSConfig.XcodeUtils.getProjectName(config.modRequest.projectRoot);
    await fs.copyFile(path.join(__dirname, 'ios/YiqikanPlayerDevice.m'),
      path.join(config.modRequest.platformProjectRoot, name, 'YiqikanPlayerDevice.m'));
    return config;
  }]);
  config = withXcodeProject(config, config => {
    const name = IOSConfig.XcodeUtils.getProjectName(config.modRequest.projectRoot);
    IOSConfig.XcodeUtils.addBuildSourceFileToGroup({ filepath: `${name}/YiqikanPlayerDevice.m`, groupName: name, project: config.modResults });
    return config;
  });
  config = withDangerousMod(config, ['android', async config => {
    const pkg = config.android.package;
    const target = path.join(config.modRequest.platformProjectRoot, 'app/src/main/java', pkg.replace(/\./g, '/'), 'player');
    await fs.mkdir(target, { recursive: true });
    for (const name of ['PlayerDeviceModule.kt', 'PlayerDevicePackage.kt']) {
      const source = await fs.readFile(path.join(__dirname, 'android', name), 'utf8');
      await fs.writeFile(path.join(target, name), source.replace('package com.yiqikan.app.player', `package ${pkg}.player`));
    }
    return config;
  }]);
  return withMainApplication(config, config => {
    if (config.modResults.language !== 'kt') throw new Error('Player device controls require the Kotlin MainApplication template');
    let source = config.modResults.contents;
    const statement = `import ${config.android.package}.player.PlayerDevicePackage`;
    if (!source.includes(statement)) source = source.replace(/(package [^\n]+\n)/, `$1\n${statement}\n`);
    if (!source.includes('add(PlayerDevicePackage())')) {
      if (!source.includes('PackageList(this).packages.apply {')) throw new Error('Cannot register player device controls');
      source = source.replace('PackageList(this).packages.apply {', 'PackageList(this).packages.apply {\n          add(PlayerDevicePackage())');
    }
    config.modResults.contents = source;
    return config;
  });
};
