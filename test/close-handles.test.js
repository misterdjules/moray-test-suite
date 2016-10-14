/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2016, Joyent, Inc.
 */

/*
 * close-handles.test.js: test that close() does close all sockets.
 * Regrettably, this test encodes a bunch of implementation details, and may
 * turn out to be brittle.
 */

var moray = require('moray');
var net = require('net');
var tape = require('tape');
var vasync = require('vasync');
var helper = require('./helper');

tape.test('client close actually closes sockets', function (t) {
    var server, nhandles, client;

    server = net.createServer(12345);

    vasync.waterfall([
        function startServer(callback) {
            server.listen(callback);
        },

        function createClient(callback) {
            nhandles = process._getActiveHandles().length;
            client = moray.createClient({
                'log': helper.createLogger(),
                'host': server.address().address,
                'port': server.address().port,
                'maxConnections': 1
            });
            client.on('connect', callback);
        },

        function closeClient(callback) {
            t.ok(nhandles < process._getActiveHandles().length,
                'handle count increased');
            client.on('close', function () {
                /*
                 * Sockets are destroyed in the context where this event is
                 * fired, but it may take another tick for them to disappear
                 * from the list of active handles.
                 */
                setImmediate(callback);
            });
            client.close();
        },

        function closeServer(callback) {
            t.equal(nhandles, process._getActiveHandles().length,
                'handle count decreased');
            server.on('close', function () {
                /* See above. */
                setImmediate(callback);
            });
            server.close();
        }
    ], function (err) {
        t.error(err);
        t.equal(0, process._getActiveHandles().length);
        t.end();
    });
});
