/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2016, Joyent, Inc.
 */

/*
 * version.test.js: test the "version" RPC call
 */

var moray = require('moray');
var net = require('net');
var tape = require('tape');
var vasync = require('vasync');
var VError = require('verror');
var helper = require('./helper.js');

var client, server;

function test(name, setup) {
    tape.test(name + ' - setup', function (t) {
        helper.createServer(null, function (s) {
            server = s;
            client = helper.createClient();
            client.on('connect', function () { t.end(); });
        });
    });

    tape.test(name + ' - main', function (t) {
        /*
         * If we're being tested with a client that predates the
         * "versionInternal" method, then the "version" method does the same
         * thing, but fakes up a response instead of returning a timeout error,
         * so we don't bother testing it.
         */
        if (client.versionInternal === undefined) {
            t.skip('skipped (old client)');
            t.end();
        } else {
            setup(t);
        }
    });

    tape.test(name + ' - teardown', function (t) {
        client.close();
        helper.cleanupServer(server, function () {
            t.pass('closed');
            t.end();
        });
    });
}

/*
 * Tests the "version" RPC call from the current Moray server.  See the note
 * about this RPC in the source before using it.
 */
test('version RPC: current server implementation', function (t) {
    client.versionInternal(function (err, result) {
        t.ifError(err);
        t.equal(result, 2);
        t.end();
    });
});

/*
 * Tests the "version" RPC call from a Moray server that does not respond.  This
 * case is synthetic (i.e., we fake up a server that doesn't respond), but old
 * implementations actually didn't respond, so this case is important.
 */
tape('version RPC: non-responsive server (takes 20s)', function (t) {
    var c, skip = false;

    vasync.waterfall([
        function startTcpServer(callback) {
            server = net.createServer();
            server.listen(function () { callback(); });
        },

        function connectClient(callback) {
            c = moray.createClient({
                'log': helper.createLogger(),
                'host': server.address().address,
                'port': server.address().port,
                'maxConnections': 1
            });

            c.on('connect', function () { callback(); });
        },

        function makeRpc(callback) {
            /*
             * See above.
             */
            if (c.versionInternal === undefined) {
                skip = true;
                t.skip('skipped (old client)');
                callback();
            } else {
                c.versionInternal(callback);
            }
        }
    ], function (err, version) {
        if (!skip) {
            t.ok(err);
            t.ok(VError.findCauseByName(err, 'TimeoutError') !== null);
            t.ok(/note: very old Moray versions do not respond to this RPC/.
                test(err.message));
            t.ok(version === undefined || version === null);
        }
        t.end();
        c.close();
        server.close();
    });
});
