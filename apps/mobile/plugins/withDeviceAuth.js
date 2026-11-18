const fs = require("node:fs/promises");
const path = require("node:path");
const {
  withDangerousMod,
  withXcodeProject,
  withMainApplication,
  IOSConfig,
} = require("expo/config-plugins");

module.exports = function withDeviceAuth(config) {
  config = withDangerousMod(config, [
    "ios",
    async (config) => {
      const name = IOSConfig.XcodeUtils.getProjectName(
        config.modRequest.projectRoot,
      );
      await fs.copyFile(
        path.join(__dirname, "ios/YiqikanDeviceAuth.m"),
        path.join(
          config.modRequest.platformProjectRoot,
          name,
          "YiqikanDeviceAuth.m",
        ),
      );
      return config;
    },
  ]);
  config = withXcodeProject(config, (config) => {
    const name = IOSConfig.XcodeUtils.getProjectName(
      config.modRequest.projectRoot,
    );
    IOSConfig.XcodeUtils.addBuildSourceFileToGroup({
      filepath: `${name}/YiqikanDeviceAuth.m`,
      groupName: name,
      project: config.modResults,
    });
    return config;
  });
  config = withDangerousMod(config, [
    "android",
    async (config) => {
      const pkg = config.android.package;
      const directory = path.join(
        config.modRequest.platformProjectRoot,
        "app/src/main/java",
        pkg.replace(/\./g, "/"),
        "security",
      );
      await fs.mkdir(directory, { recursive: true });
      for (const name of ["DeviceAuthModule.kt", "DeviceAuthPackage.kt"]) {
        const source = await fs.readFile(
          path.join(__dirname, "android", name),
          "utf8",
        );
        await fs.writeFile(
          path.join(directory, name),
          source.replace(
            "package com.yiqikan.app.security",
            `package ${pkg}.security`,
          ),
        );
      }
      return config;
    },
  ]);
  return withMainApplication(config, (config) => {
    if (config.modResults.language !== "kt")
      throw new Error(
        "Device auth requires the Kotlin MainApplication template",
      );
    let source = config.modResults.contents;
    if (
      !source.includes(
        "import " + config.android.package + ".security.DeviceAuthPackage",
      )
    )
      source = source.replace(
        /(package [^\n]+\n)/,
        `$1\nimport ${config.android.package}.security.DeviceAuthPackage\n`,
      );
    if (!source.includes("add(DeviceAuthPackage())")) {
      if (!source.includes("PackageList(this).packages.apply {"))
        throw new Error("Cannot register device authentication package");
      source = source.replace(
        "PackageList(this).packages.apply {",
        "PackageList(this).packages.apply {\n          add(DeviceAuthPackage())",
      );
    }
    config.modResults.contents = source;
    return config;
  });
};
