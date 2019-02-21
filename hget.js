#!/usr/bin/env node

process.argv.splice(2, 0, "get");

require('./http-request-cli');
