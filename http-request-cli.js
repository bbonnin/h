#!/usr/bin/env node

const { version } = require('./package.json');
const ora = require('ora');
const util = require('util');
const fs = require('fs');
const chalk = require('chalk');
const prettyjson = require('prettyjson');
const commander = require('commander');
const FormData = require('form-data');
const mime = require('mime-types');
const _ = require('lodash');

const log = console.log;

let error = chalk.red;
let warning = chalk.yellow;
let success = chalk.green;
let verbose = chalk.blue;

util.inspect.styles.name = 'green';
util.inspect.styles.string = 'white';
util.inspect.styles.boolean = 'red';
util.inspect.styles.number = 'blue';

// ----------------
// Useful Functions
// ----------------

function initInterceptors(axios) {
    axios.interceptors.request.use(request => {
        const headers = keysToLower(request.headers.common);
        _.assignIn(headers, keysToLower(request.headers[request.method]), keysToLower(commander.header));
        logverbose('\nRequest headers:', headers);
        return request;
    });
}

function keysToLower(obj) {
    return _.transform(obj, (result, val, key) => {
        result[key.toLowerCase()] = val;
    });
}

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
    let ctype = mime.contentType(type);

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
    logverbose('Sending ' + method.toUpperCase() + ' request to ' + chalk.underline(url));

    const spinner = ora().start();

    const options = {
        url,
        method
    };

    if (!options.url.startsWith('http')) {
        options.url = 'https://' + options.url;
    }

    if (commander.output) {
        options.responseType = 'stream';
    }

    if (commander.header) {
        options.headers = commander.header;
    }

    if (commander.datafile) {
        const data = fs.readFileSync(commander.datafile);
        const form = new FormData();

        form.append('file', data, {
            filepath: commander.datafile,
            contentType: mime.contentType(commander.datafile),
        });

        _.assignIn(options.headers, form.getHeaders());

        options.data = form;
    }
    else if (commander.data) {
        try {
            options.data = JSON.parse(commander.data);
        }
        catch (err) {
            // Not a valid json, so try to convert the data as it is properties
            options.data = props2json(commander.data);
        }

        if (commander.type) {
            const type = getContentTypes(commander.type);
            options.headers['content-type'] = type;
        }
    }

    if (options.data && method.toUpperCase() === 'GET') {
        logwarn('Cannot send data with GET, POST will be used');
        options.method = 'POST';
    }

    if (commander.cookie) {
        if (fs.existsSync(commander.cookie)) {
            let cookie = fs.readFileSync(commander.cookie, 'utf8');
            cookie = cookie
                        .split('\n')
                        .map(v => v.substring(0, v.indexOf(';') > 0 ? v.indexOf(';') : v.length))
                        .join('; ');
            options.headers['cookie'] = cookie;
        }
    }

    let axios = require('axios');

    if (commander.proxy) {
        const proxyUrl = new URL(commander.proxy);
        const targetUrl = new URL(url);

        if (proxyUrl.protocol === 'http:' && targetUrl.protocol === 'https:') {
            //Bug: https://github.com/axios/axios/issues/925
            logverbose('Due to a bug, use of an alternative Axios')
            axios = require('axios-https-proxy-fix');
        }

        options.proxy = {
            host: proxyUrl.hostname,
            port: proxyUrl.port
        };

        if (proxyUrl.username) {
            options.proxy.auth = {
                username: proxyUrl.username,
                password: proxyUrl.password
            };
        }

        logverbose('Proxy=' + JSON.stringify(options.proxy));
    }

    initInterceptors(axios);

    logverbose('Options=' + JSON.stringify(options));

    axios(options)
    .then(response => {
        spinner.stop();
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
        spinner.stop();
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
    .version(version, '-V, --version')
    .option('-v, --verbose', 'Verbose mode')
    .option('--no-color', 'Monochrome display')
    .option('-o, --output <file name>', 'Save response to a file')
    .option('-y, --yaml', 'Render JSON data in a coloured YAML-style')
    .option('-H, --header <name=value>', 'Set a header', addHeader, {})
    .option('-d, --data [data]', 'Content of request')
    .option('-D, --datafile <file name>')
    .option('-t, --type <content type>', 'Content type')
    .option('-p, --proxy <proxy url>', 'Proxy (format: http(s)://[username:password@]proxyhost:proxyport')
    .option('-c, --cookie <cookie file>', 'Cookie file');

configureMethodCommand('get');
configureMethodCommand('post');
configureMethodCommand('put');
configureMethodCommand('delete');
configureMethodCommand('patch');
configureMethodCommand('head');

commander.on('command:*', () => {
    console.error('Invalid command: %s\nSee --help for a list of available commands.', commander.args.join(' '));
    process.exit(1);
});

commander.parse(process.argv);

if (!commander.color) {
    error = chalk.reset;
    warning = chalk.reset;
    verbose = chalk.reset;
    success = chalk.reset;
}
