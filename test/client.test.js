/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2016, Joyent, Inc.
 */

/*
 * client.test.js: test general client behavior (not related to specific Moray
 * RPC calls).
 */

var tape = require('tape');
var uuid = require('libuuid').create;
var vasync = require('vasync');
var helper = require('./helper.js');
var VError = require('verror');

var server;

function test(name, setup) {
    tape.test(name + ' - setup', function (t) {
        helper.createServer(null, function (s) {
            server = s;
            t.end();
        });
    });

    tape.test(name + ' - main', function (t) {
        setup(t);
    });

    tape.test(name + ' - teardown', function (t) {
        helper.cleanupServer(server, function () {
            t.pass('closed');
            t.end();
        });
    });
}

/*
 * Check whether "err" is either a legacy error or has a cause of name
 * "errname".  Versions prior to node-moray2 did not provide wrapped errors.  If
 * there's no cause here, we won't bother trying to check anything other than
 * that this is a real error.  If there is a cause, it should be the one that
 * the caller expected.
 */
function checkMaybeLegacyError(t, err, errname) {
    t.ok(err instanceof Error, 'got an error');
    if (VError.cause(err) !== null) {
        err = VError.findCauseByName(err, errname);
        t.notStrictEqual(err, null, 'expect a ' + errname + ' error');
    }
}

/*
 * Tests the behavior of the "connected" property, which is part of the
 * interface.
 */
test('"connected" property', function (t) {
    var c2;

    c2 = helper.createClient();
    t.strictEqual(c2.connected, false, '"connected" property (not connected)');

    c2.on('connect', function onClientConnected() {
        t.strictEqual(c2.connected, true, '"connected" property (connected)');
        c2.once('close', function () {
            t.strictEqual(c2.connected, false, '"connected property (closed)');
            t.end();
        });
        c2.close();
    });
});

/*
 * Once connected, start a callback-based request.  Immediately close the client
 * and make sure that the request fails as expected.
 */
test('close() with outstanding callback request', function (t) {
    var c2;

    c2 = helper.createClient();
    c2.on('connect', function onClientConnected() {
        c2.getBucket('badbucket', function (err) {
            t.ok(err, '"getbucket" returned error');
            checkMaybeLegacyError(t, err, 'FastTransportError');
            t.end();
        });

        setImmediate(function () { c2.close(); });
    });
});

/*
 * This is just like the previous test, but with an event-emitter-based request.
 */
test('close() with outstanding event-emitter request', function (t) {
    var c2;

    c2 = helper.createClient();
    c2.on('connect', function onClientConnected() {
        var rq;

        rq = c2.findObjects('badbucket', 'a=*');
        rq.once('record', function () {
            t.ok(false, 'findobjects unexpectedly returned a record');
        });
        rq.once('end', function () {
            t.ok(false, 'findobjects unexpectedly completed');
        });
        rq.once('error', function (err) {
            t.ok(err, '"findobjects" returned error');
            checkMaybeLegacyError(t, err, 'FastTransportError');
            t.end();
        });

        setImmediate(function () { c2.close(); });
    });
});

/*
 * Tests that requests issued before a connection is established or after the
 * client is closed fail appropriately.
 */
test('requests issued before connected, after close', function (t) {
    var c2;
    var barrier = vasync.barrier();

    c2 = helper.createClient();
    c2.getBucket('badbucket', function (err) {
        t.ok(err);
        checkMaybeLegacyError(t, err, 'NoBackendsError');

        barrier.start('close');
        c2.once('close', function () { barrier.done('close'); });
        c2.close();

        barrier.start('getbucket');
        c2.getBucket('badbucket', function (err2) {
            t.ok(err2);
            t.ok(/has been closed/.test(err2.message) ||
                /no active connections/.test(err2.message));
            barrier.done('getbucket');
        });

        barrier.on('drain', function () { t.end(); });
    });
});
