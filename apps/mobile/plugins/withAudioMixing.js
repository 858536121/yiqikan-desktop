const fs = require('node:fs/promises');
const path = require('node:path');
const { withDangerousMod, withXcodeProject, IOSConfig } = require('expo/config-plugins');

// Compile a native module instead of patching language-specific AppDelegate text.
// The module owns the audio policy only while a voice call is requested.
module.exports = function withAudioMixing(config, { nativeRtc = false } = {}) {
  config = withDangerousMod(config, ['ios', async (config) => {
    const projectName = IOSConfig.XcodeUtils.getProjectName(config.modRequest.projectRoot);
    const source = await fs.readFile(path.join(__dirname, 'ios', 'YiQiKanAudioSession.m'), 'utf8');
    await fs.writeFile(
      path.join(config.modRequest.platformProjectRoot, projectName, 'YiQiKanAudioSession.m'),
      (nativeRtc ? '#define YIQIKAN_NATIVE_VOICE 1\n' : '') + source,
    );
    return config;
  }]);

  return withXcodeProject(config, (config) => {
    const projectName = IOSConfig.XcodeUtils.getProjectName(config.modRequest.projectRoot);
    IOSConfig.XcodeUtils.addBuildSourceFileToGroup({
      filepath: `${projectName}/YiQiKanAudioSession.m`,
      groupName: projectName,
      project: config.modResults,
    });
    return config;
  });
};
