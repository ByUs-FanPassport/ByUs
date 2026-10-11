const { isAbsolute } = require("node:path");
const { globSync } = require("tinyglobby");

// Only Next ESLint's root-directory lookup uses this override; braces has no patched release.
// shortcut: supports the plugin's globSync(pattern, { onlyDirectories: true }); revisit when upgrading the plugin.
exports.globSync = (pattern, options) => globSync(pattern, {
  ...options,
  expandDirectories: false,
  absolute: isAbsolute(pattern),
}).map(directory => directory.length > 1 ? directory.replace(/\/$/, "") : directory);
