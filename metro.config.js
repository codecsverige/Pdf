const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Add platform-specific extensions
config.resolver.platforms = ['native', 'ios', 'android', 'web'];

module.exports = config;