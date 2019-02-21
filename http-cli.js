#!/usr/bin/env node

const util = require('util');
const fs = require('fs');
const chalk = require('chalk');
const prettyjson = require('prettyjson');
const axios = require('axios');
const url = require('url') ;
const clui = require('clui');
const filesize = require('filesize');
const commander = require('commander');
const _ = require('lodash');

const cliHome = (process.env.HOME || process.env.HOMEPATH || process.env.USERPROFILE) + '/.http-cli';

const contentTypes = {
    'json': 'application/json',
    'text': 'text/plain'
};

const log = console.log;

let error = chalk.red;
let warning = chalk.yellow;
let success = chalk.green;
let verbose = chalk.blue;

//console.log(util.inspect.styles)
util.inspect.styles.name = 'green';
util.inspect.styles.string = 'white';
util.inspect.styles.boolean = 'red';
util.inspect.styles.number = 'blue';

axios.interceptors.request.use(request => {
    let headers = request.headers.common;
    _.assignIn(headers, request.headers[request.method], commander.header);
    logverbose('\nRequest headers:', headers);
    return request;
});

// ----------------
// Useful Functions
// ----------------

function props2json(props) {
    return props
        .replace(/\\\n/, ' ')
        .split('\n')
        .reduce((obj, line) => {
            let eqIdx = line.indexOf('=');
            eqIdx = eqIdx > 0 ? eqIdx : line.length;
            const key = line.substring(0, eqIdx).trim();
            const value = line.substring(eqIdx + 1).trim();
            obj[key] = value;
            return obj;
        }, {});
}

function getContentTypes(type) {
    let ctype = contentTypes[type];

    if (!ctype) {
        ctype = 'application/x-www-form-urlencoded';
    }

    return ctype;
}

function bytesToHumanReadable(size) {
    var i = Math.floor( Math.log(size) / Math.log(1024) );
    return ( size / Math.pow(1024, i) ).toFixed(2) * 1 + ' ' + ['B', 'kB', 'MB', 'GB', 'TB'][i];
}

function logverbose(msg, data) {
    if (commander.verbose) {
        log(verbose(msg));

        if (data) {
            log(prettyjson.render(data));
        }
    }
}

function logerr(msg) {
    log(error(msg));
}

function logwarn(msg) {
    log(warning(msg));
}

function logsuccess(msg) {
    log(success(msg));
}

function showData(data) {
    if (data) {
        logverbose('\nBody content:');
        if (commander.yaml) {
            log(prettyjson.render(data));
        }
        else if (typeof data === 'object') {
            //log(JSON.stringify(data, null, 2));
            log(util.inspect(data, { colors: true, depth: null, compact: false }));
        }
        else {
            log(data);
        }
    }
}

function showHeaders(headers) {
    if (commander.verbose) {
        log(verbose('\nResponse headers:'));
        log(prettyjson.render(headers));
    }
}

function sendRequest(method, url) {
    logverbose('Sending GET request to ' + chalk.underline(url));

    const options = {
        url,
        method
    };

    if (commander.output) {
        options.responseType = 'stream';
    }

    if (commander.header) {
        options.headers = commander.header;
    }

    if (commander.data) {
        try {
            options.data = JSON.parse(commander.data);
        }
        catch (err) {
            // Not a valid json, so try to convert the data as it is properties
            options.data = props2json(commander.data);
        }

        if (commander.type) {
            const type = getContentTypes(commander.type);
            options.headers['Content-Type'] = type;
        }
    }

    if (commander.cookie) {
        if (fs.existsSync(commander.cookie)) {
            let cookie = fs.readFileSync(commander.cookie, 'utf8');
            cookie = cookie
                        .split('\n')
                        .map(v => v.substring(0, v.indexOf(';') > 0 ? v.indexOf(';') : v.length))
                        .join('; ');
            options.headers['Cookie'] = cookie;
        }
    }

    axios(options)
    .then(response => {
        if (commander.output) {
            const writer = fs.createWriteStream(commander.output);
            response.data.pipe(writer);
            writer.on('finish', () => logsuccess('Response saved in ' + commander.output));
            writer.on('error', (err) => logerr('Error when saving response: ' + err));
        }
        else {
            showHeaders(response.headers);
            showData(response.data);
        }

        if (commander.cookie) {
            const cookies = response.headers['set-cookie'];
            if (cookies) {
                cookies.push('hello=world');
                fs.writeFile(commander.cookie, response.headers['set-cookie'].join('\n'), 'utf8', (err) => {
                    if (err) {
                        logerr(err);
                    }
                });
            } 
        }
    })
    .catch(err => {
        logerr(err);
    });
}

function configureMethodCommand(method) {
    commander
        .command(method.toLowerCase() + ' <url> [options]')
        .description('Send a ' + method.toUpperCase() + ' request')
        .action((url) => {
            sendRequest(method.toUpperCase(), url);
        });
}

function addHeader(header, headers) {
    const headerItems = header.split('=');
    headers[headerItems[0]] = headerItems.length > 1 ? headerItems[1] : '';
    return headers;
}

// -------------
// Let's go !!!!
// -------------

commander
    .version('0.1.0', '-V, --version')
    .option('-v, --verbose', 'Verbose mode')
    .option('--no-color', 'Monochrome display')
    .option('-o, --output <file name>', 'Save response to a file')
    .option('-y, --yaml', 'Render JSON data in a coloured YAML-style')
    .option('-H, --header <name=value>', 'Set a header', addHeader, {})
    .option('-d, --data [data]', 'Content of request')
    .option('-t, --type <content type>', 'Content type')
    .option('-c, --cookie <cookie file>', 'Cookie file');

configureMethodCommand('get');
configureMethodCommand('post');
configureMethodCommand('put');
configureMethodCommand('delete');
configureMethodCommand('patch');
configureMethodCommand('head');

commander.parse(process.argv);

if (!commander.color) {
    error = chalk.reset;
    warning = chalk.reset;
    verbose = chalk.reset;
    success = chalk.reset;
}

//TODO:
// - query data (from file)
// - query headers (from file)
// - cookies (get / set)
