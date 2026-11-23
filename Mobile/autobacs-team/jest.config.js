/** Unit tests for the app's logic (queue, API client, forms). */
module.exports = {
  preset: 'jest-expo',
  testMatch: ['<rootDir>/tests/**/*.test.ts'],
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*)',
  ],
};
