/* global global, require */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { TextDecoder, TextEncoder } = require('util');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { Buffer } = require('buffer');

global.TextDecoder = TextDecoder;
global.TextEncoder = TextEncoder;
// Node Buffer fixtures and jsdom must use the same typed-array realm.
global.Uint8Array = Object.getPrototypeOf(Buffer.prototype).constructor;
