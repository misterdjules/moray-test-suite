/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2016, Joyent, Inc.
 */

var assert = require('assert');
var child = require('child_process');
var forkexec = require('forkexec');
var fs = require('fs');
var jsprim = require('jsprim');
var path = require('path');
var stream = require('stream');
var util = require('util');

var bunyan = require('bunyan');
var moray = require('moray'); // client

var which = 0;

///--- API

function createLogger(name, logstream) {
    var log = bunyan.createLogger({
        level: (process.env.LOG_LEVEL || 'warn'),
        name: name || process.argv[1],
        stream: logstream || process.stdout,
        src: true,
        serializers: bunyan.stdSerializers
    });
    return (log);
}

function createClient(opts) {
    /*
     * It would be nice to use the mustCloseBeforeNormalProcessExit option to
     * the Moray client, which would identify client leaks, but node-tape
     * defeats that check by calling process.exit() from its own 'exit'
     * listener.
     */
    var clientparams = {};

    if (process.env['MORAY_TEST_SERVER_REMOTE']) {
        clientparams.url = process.env['MORAY_TEST_SERVER_REMOTE'];
    } else {
        clientparams.host = '127.0.0.1';
        clientparams.port = 2020;
    }

    clientparams.log = createLogger();

    if (opts && opts.unwrapErrors) {
    	clientparams.unwrapErrors = opts.unwrapErrors;
    }

    return (moray.createClient(clientparams));
}

function multipleServersSupported() {
    return (!process.env['MORAY_TEST_SERVER_REMOTE']);
}

function createServer(opts, cb) {
    var env, cp, pt, server, t, seen, ready;

    opts = opts || {};
    if (process.env['MORAY_TEST_SERVER_REMOTE']) {
        if (opts.portOverride) {
            throw (new Error('multiple servers are not supported in ' +
                'this configuration'));
        } else {
            setImmediate(cb, { 'ts_remote': true });
        }
        return;
    }

    if (!process.env['MORAY_TEST_SERVER_RUN']) {
        throw (new Error('not found in environment: MORAY_TEST_SERVER_RUN. ' +
            '(have you already run configure and sourced the env file?)'));
    }

    env = jsprim.deepCopy(process.env);
    if (opts.portOverride) {
        env['MORAY_TEST_EXTRA_ARGS'] = '-p ' + opts.portOverride;
    }

    cp = child.spawn('bash', [ '-c', process.env['MORAY_TEST_SERVER_RUN'] ], {
            'detached': true,
            'stdio': [ 'ignore', 'pipe', process.stderr ],
            'env': env
        });

    seen = '';
    ready = false;
    pt = new stream.PassThrough();
    cp.stdout.pipe(process.stdout);
    cp.stdout.pipe(pt);

    pt.on('data', function (c) {
        seen += c.toString('utf8');
        if (!ready && /moray listening on \d+/.test(seen) &&
            /manatee ready/.test(seen)) {
            cp.stdout.unpipe(pt);
            ready = true;
            clearTimeout(t);
            t = null;
            cb(server);
        }
    });

    t = setTimeout(function () {
        throw (new Error('server did not start after 10 seconds'));
    }, 10000);

    server = {
        'ts_remote': false,
        'ts_child': cp,
        'ts_cleanup_cb': null
    };

    cp.on('exit', function (code, signal) {
        var err, info;

        if (code === 0) {
            /*
             * This should never happen because the server should only exit when
             * we kill it, and that won't be a clean exit.
             */
            throw (new Error('server unexpectedly exited with status 0'));
        }

        if (server.ts_cleanup_cb === null || signal != 'SIGKILL') {
            err = new Error('child process exited');
            err.code = code;
            err.signal = signal;

            info = forkexec.interpretChildProcessResult({
                'label': 'test moray server',
                'error': err
            });

            throw (info.error);
        } else {
            server.ts_cleanup_cb();
        }
    });
}

function cleanupServer(server, cb) {
    if (server.ts_remote) {
        setImmediate(cb);
    } else {
        assert.ok(server.ts_cleanup_cb === null,
            'cannot call cleanupServer multiple times');
        server.ts_cleanup_cb = cb;

        /*
         * Kill the entire process group, since there may have been more than
         * one process created under bash.
         */
        process.kill(-server.ts_child.pid, 'SIGKILL');
    }
}

///--- Exports

module.exports = {
    multipleServersSupported: multipleServersSupported,
    createLogger: createLogger,
    createClient: createClient,
    createServer: createServer,
    cleanupServer: cleanupServer
};
