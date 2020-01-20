#!/usr/bin/env node

process.argv.splice(2, 0, "get");

require('./http-request-cli');

// https://daniel.haxx.se/blog/2020/01/20/curl-cheat-sheet-refresh/
