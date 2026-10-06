const { withExpoPlist } = require('expo/config-plugins');

// Compile-time iOS policy. There is deliberately no server-controlled toggle.
module.exports = function withIosStoreUpdates(config) {
  return withExpoPlist(config, config => {
    for (const key of Object.keys(config.modResults)) {
      if (key.startsWith('EXUpdates')) delete config.modResults[key];
    }
    config.modResults.EXUpdatesEnabled = false;
    config.modResults.EXUpdatesCheckOnLaunch = 'NEVER';
    return config;
  });
};
