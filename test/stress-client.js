/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2016, Joyent, Inc.
 */

/*
 * stress-client.js: run the client through a lot of different code paths for an
 * extended period.  The intent is to help identify memory leaks by monitoring
 * this process's memory usage over time.
 *
 * We want to exercise:
 *
 * - making RPC requests when disconnected (both never-connected and
 *   transiently-disconnected cases)
 * - repeated connection/disconnection
 * - failed RPC calls for each type of request (failure path)
 * - successful RPC calls for each type of request (success path)
 * - RPC requests that time out
 *
 * That list should include any operation with a client that programs might do a
 * large number of times over a long lifetime.
 *
 * This works as follows: there are a number of top-level commands, represented
 * with functions that execute a command (like making a particular RPC request).
 * When each function completes, it gets executed again.  This goes on until the
 * user kills the process.
 *
 * This program opens a Kang server on port 9080 for inspecting progress.
 */

var assertplus = require('assert-plus');
var bunyan = require('bunyan');
var cmdutil = require('cmdutil');
var kang = require('kang');
var moray = require('moray');
var net = require('net');
var os = require('os');
var vasync = require('vasync');
var VError = require('verror');

var helper = require('./helper');

var scTestBucketBogus = 'stress_client_bogus_bucket';
var scTestBucketInvalid = 'buckets can\'t have spaces!';
var scTestBucket = 'stress_client_bucket';
var scKangPort = 9080;
var scCommands = [];
var scLog, scServer;

/*
 * We require that each of our top-level test commands complete one iteration
 * every "scWatchdogLimit" milliseconds.  Otherwise, a call has likely hung, and
 * we'll bail out.
 */
var scWatchdogLimit = 30000;

function main()
{
    scLog = new bunyan({
        'name': 'stress-client',
        'level': process.env['LOG_LEVEL'] || 'fatal'
    });

    console.error('pid %d: setting up', process.pid);

    kang.knStartServer({
        'port': scKangPort,
        'uri_base': '/kang',
        'service_name': 'moray-client-stress',
        'version': '1.0.0',
        'ident': os.hostname(),
        'list_types': knListTypes,
        'list_objects': knListObjects,
        'get': knGetObject
    }, function () {
        /*
         * First, set up a server that all clients can use.
         */
        helper.createServer(null, function (s) {
            scServer = s;

            /*
             * Now initialize each of the commands and start them running.
             */
            vasync.forEachParallel({
                'inputs': scCommands,
                'func': scCommandStart
            }, function (err) {
                if (err) {
                    cmdutil.fail(new VError('setup'));
                }

                scLog.debug('set up all commands');
                console.error('set up all commands');
            });
        });
    });
}

function knListTypes()
{
    return ([ 'cmd' ]);
}

function knListObjects(type)
{
    assertplus.equal(type, 'cmd');
    return (scCommands.map(function (_, i) {
        return (i);
    }));
}

function knGetObject(type, which)
{
    var cmdspec;

    assertplus.equal(type, 'cmd');
    cmdspec = scCommands[which];
    return ({
        'label': cmdspec.name,
        'funcname': cmdspec.exec.name,
        'nstarted': cmdspec.ctx.nstarted,
        'lastStarted': cmdspec.ctx.lastStarted
    });
}

function scCommandStart(cmdspec, callback)
{
    cmdspec.ctx = {};
    cmdspec.ctx.nstarted = 0;
    cmdspec.ctx.lastStarted = null;
    cmdspec.ctx.setupStarted = new Date();
    cmdspec.ctx.setupDone = null;
    cmdspec.ctx.log = scLog.child({
        'cmdname': cmdspec.exec.name || cmdspec.name
    });
    cmdspec.ctx.timer = null;

    cmdspec.setup(cmdspec.ctx, function (err) {
        if (err) {
            callback(new VError(err, 'setup command "%s"', cmdspec.name));
            return;
        }

        cmdspec.ctx.setupDone = new Date();
        scCommandLoop(cmdspec);
        callback();
    });
}

function scCommandLoop(cmdspec)
{
    cmdspec.ctx.nstarted++;
    cmdspec.ctx.log.debug({
        'iteration': cmdspec.ctx.nstarted
    }, 'starting iteration');
    cmdspec.ctx.lastStarted = new Date();
    cmdspec.ctx.timer = setTimeout(scWatchdogFire, scWatchdogLimit, cmdspec);

    cmdspec.exec(cmdspec.ctx, function (err) {
        clearTimeout(cmdspec.ctx.timer);

        if (err) {
            err = new VError(err, 'exec command "%s"', cmdspec.name);
            cmdspec.ctx.log.fatal(err);
            throw (err);
        }

        setImmediate(scCommandLoop, cmdspec);
    });
}

function scWatchdogFire(cmdspec)
{
    /*
     * This is basically going to be undebuggable without a core file.  We may
     * as well abort straight away rather than hoping the user ran with
     * --abort-on-uncaught-exception.
     */
    console.error('watchdog timer expired for command: "%s"', cmdspec.name);
    console.error('aborting (to dump core)');
    process.abort();
}

function ignoreErrorTypes(err, errtypes)
{
    var i;

    assertplus.optionalObject(err);
    assertplus.arrayOfString(errtypes, 'errtypes');
    if (!err) {
        return (err);
    }

    assertplus.ok(err instanceof Error);
    for (i = 0; i < errtypes.length; i++) {
        if (VError.findCauseByName(err, errtypes[i]) !== null) {
            return (null);
        }
    }

    return (err);
}

function cbIgnoreErrorTypes(callback, errtypes)
{
    return (function (err) {
        var args = Array.prototype.slice.call(arguments, 1);
        args.unshift(ignoreErrorTypes(err, errtypes));
        callback.apply(null, args);
    });
}

/*
 * Command definitions
 */

/*
 * This loop exercises code paths associated with sending RPC requests before
 * we've ever established a connection.
 */
scCommands.push({
    'name': 'make RPC requests before ever connected',
    'setup': function cmdRpcNeverConnectedSetup(ctx, callback) {
        /*
         * Configure the client with a hostname that doesn't exist so that it
         * will never connect.
         */
        ctx.client = moray.createClient({
            'log': ctx.log.child({ 'component': 'MorayClient' }),
            'host': 'bogus_hostname',
            'port': 2020
        });

        callback();
    },
    'exec': function cmdRpcNeverConnected(ctx, callback) {
        ctx.client.listBuckets(function (err) {
            if (VError.findCauseByName(err, 'NoBackendsError') !== null) {
                err = null;
            }

            callback(err);
        });
    }
});

/*
 * This loop exercises the code paths associated with sending RPC requests while
 * we have no connection (but we previously had one).  This is largely the same
 * as the previous case, but could result in different code paths.
 */
scCommands.push({
    'name': 'make RPC requests after connection closed',
    'setup': function cmdRpcDisconnectedSetup(ctx, callback) {
        helper.createServer({ 'portOverride': 2021 }, function (s) {
            ctx.server = s;
            ctx.client = moray.createClient({
                'log': ctx.log.child({ 'component': 'MorayClient' }),
                'host': '127.0.0.1',
                'port': 2021
            });
            ctx.client.on('connect', function () {
                helper.cleanupServer(ctx.server, callback);
            });
        });
    },
    'exec': function cmdRpcDisconnected(ctx, callback) {
        ctx.client.listBuckets(function (err) {
            if (!err) {
                callback(new VError('expected error'));
            } else {
                callback();
            }
        });
    }
});

/*
 * This loop exercises connect/reconnect paths.
 */
scCommands.push({
    'name': 'disconnect/reconnect repeatedly',
    'setup': function cmdRpcReconnectSetup(ctx, callback) {
        ctx.client = moray.createClient({
            'log': ctx.log.child({ 'component': 'MorayClient' }),
            'host': '127.0.0.1',
            'port': 2022,
            'maxConnections': 1,
            'retry': {
                'minTimeout': 50,
                'maxTimeout': 50
            }
        });
        callback();
    },

    'exec': function cmdRpcReconnect(ctx, callback) {
        /*
         * Our goal is to execute this sequence:
         *
         *   - set up a server
         *   - wait for the client to connect to the server
         *   - shut down the server
         *   - wait for the client to see that the server is shutdown
         *
         * Our challenge is that the client deliberately abstracts over
         * reconnection, so it doesn't expose the events we intend to wait for.
         * So we accomplish the above using this sequence instead:
         *
         *   - set up a server
         *   - make requests in a loop using the client until one of them
         *     succeeds (meaning we've established a connection to our server)
         *   - close the server
         *   - make request using the client and verify that it fails
         *     (meaning that the server has shut down)
         *
         * Importantly, we never instantiate a new client, since we're trying to
         * make sure that a single long-lived client doesn't leak memory in
         * these conditions.
         *
         * The fact that we use a separate process server here is extremely
         * expensive, and means that we don't end up iterating very quickly on
         * this command.  However, we need at least one request to succeed,
         * which means we need a real Moray server.
         */
        ctx.server = null;
        ctx.nloops = 0;
        ctx.maxloops = 100;
        ctx.pipeline = vasync.pipeline({
            'funcs': [
                function cmdRpcReconnectSetupServer(_, subcallback) {
                    ctx.log.debug('creating server');
                    helper.createServer({
                        'portOverride': 2022
                    }, function (s) {
                        ctx.log.debug('server up');
                        ctx.server = s;
                        subcallback();
                    });
                },

                function cmdRpcReconnectClientLoop(_, subcallback) {
                    ctx.client.ping(function (err) {
                        ctx.nloops++;
                        if (err && ctx.nloops <= ctx.maxloops) {
                            ctx.log.debug(err, 'ignoring transient error',
                                { 'nloops': ctx.nloops });
                            setTimeout(cmdRpcReconnectClientLoop, 100,
                                _, subcallback);
                            return;
                        }

                        if (err) {
                            err = new VError(err, 'too many transient errors');
                        }

                        subcallback(err);
                    });
                },

                function cmdRpcReconnectShutdown(_, subcallback) {
                    ctx.log.debug('shutting down server');
                    helper.cleanupServer(ctx.server, subcallback);
                },

                function cmdRpcReconnectClientFail(_, subcallback) {
                    ctx.log.debug('making final client request');
                    ctx.client.ping({ 'timeout': 5000 }, function (err) {
                        if (err) {
                            if (VError.findCauseByName(
                                err, 'NoBackendsError') !== null ||
                                VError.findCauseByName(
                                err, 'FastTransportError') !== null ||
                                VError.findCauseByName(
                                err, 'FastProtocolError') !== null) {
                                err = null;
                            } else {
                                err = new VError(err, 'unexpected error');
                            }
                        } else {
                            err = new VError('unexpected success');
                        }

                        subcallback(err);
                    });
                }
            ]
        }, callback);
    }
});

/*
 * This loop exercises failure cases for each of the supported RPC requests.
 */
scCommands.push({
    'name': 'failed RPC requests',
    'setup': function cmdRpcFailSetup(ctx, callback) {
        ctx.client = helper.createClient();
        ctx.client.on('connect', callback);
    },
    'exec': function cmdRpcFail(ctx, callback) {
        ctx.pipeline = vasync.pipeline({
            'arg': null,
            'funcs': [

                /*
                 * There's a test function for each of the supported RPC calls
                 * that we can cause to fail reliably (and safely).  The
                 * listBuckets(), ping(), and version() RPC calls do not appear
                 * to have reliable ways to trigger failure.
                 *
                 * These test functions appear in the same order as the
                 * corresponding RPC calls are registered in the Moray server's
                 * lib/server.js.
                 */

                function cmdRpcFailCreateBucket(_, subcallback) {
                    ctx.client.createBucket(scTestBucketInvalid, {},
                        cbIgnoreErrorTypes(
                        subcallback, [ 'InvalidBucketNameError' ]));
                },

                function cmdRpcFailGetBucket(_, subcallback) {
                    ctx.client.getBucket(scTestBucketBogus,
                        cbIgnoreErrorTypes(
                        subcallback, [ 'BucketNotFoundError' ]));
                },

                function cmdRpcFailUpdateBucket(_, subcallback) {
                    ctx.client.updateBucket(scTestBucketBogus, {},
                        cbIgnoreErrorTypes(
                        subcallback, [ 'BucketNotFoundError' ]));
                },

                function cmdRpcFailDeleteBucket(_, subcallback) {
                    ctx.client.deleteBucket(scTestBucketBogus,
                        cbIgnoreErrorTypes(
                        subcallback, [ 'BucketNotFoundError' ]));
                },

                function cmdRpcFailPutObject(_, subcallback) {
                    ctx.client.putObject(scTestBucketBogus, 'key', {},
                        cbIgnoreErrorTypes(
                        subcallback, [ 'BucketNotFoundError' ]));
                },

                function cmdRpcFailBatch(_, subcallback) {
                    ctx.client.batch([ {
                        'bucket': scTestBucketBogus,
                        'operation': 'update',
                        'fields': {},
                        'filter': 'x=*'
                    } ], cbIgnoreErrorTypes(
                    subcallback, [ 'BucketNotFoundError' ]));
                },

                function cmdRpcFailGetObject(_, subcallback) {
                    ctx.client.getObject(scTestBucketBogus, 'key',
                        cbIgnoreErrorTypes(
                        subcallback, [ 'BucketNotFoundError' ]));
                },

                function cmdRpcFailDelObject(_, subcallback) {
                    ctx.client.delObject(scTestBucketBogus, 'key',
                        cbIgnoreErrorTypes(
                        subcallback, [ 'BucketNotFoundError' ]));
                },

                function cmdRpcFailFindObjects(_, subcallback) {
                    var req = ctx.client.findObjects(scTestBucketBogus,
                        'key=value');
                    req.on('error', function (err) {
                        err = ignoreErrorTypes(err, [ 'BucketNotFoundError' ]);
                        subcallback(err);
                    });
                    req.on('end', function () {
                        throw (new Error('unexpected "end"'));
                    });
                },

                function cmdRpcFailUpdateObjects(_, subcallback) {
                    ctx.client.updateObjects(scTestBucketBogus, {}, 'key=value',
                        cbIgnoreErrorTypes(subcallback,
                        [ 'FieldUpdateError' ]));
                },

                function cmdRpcFailReindexObjects(_, subcallback) {
                    ctx.client.reindexObjects(scTestBucketBogus, 3,
                        cbIgnoreErrorTypes(subcallback,
                        [ 'BucketNotFoundError' ]));
                },

                function cmdRpcFailDeleteMany(_, subcallback) {
                    ctx.client.deleteMany(scTestBucketBogus, 'x=y',
                        cbIgnoreErrorTypes(subcallback,
                        [ 'BucketNotFoundError' ]));
                },

                function cmdRpcFailGetTokens(_, subcallback) {
                    ctx.client.getTokens(function (err) {
                        assertplus.ok(err);
                        assertplus.ok(/Operation not supported$/.test(
                            err.message));
                        subcallback();
                    });
                },

                function cmdRpcFailSql(_, subcallback) {
                    var req = ctx.client.sql('SELECT ctid from bogus;');
                    req.on('error', function (err) {
                        /* JSSTYLED */
                        assertplus.ok(/relation "bogus" does not exist$/.test(
                            err.message));
                        subcallback();
                    });
                    req.on('end', function () {
                        throw (new Error('unexpected "end"'));
                    });
                }
            ]
        }, callback);
    }
});

/*
 * This loop exercises success cases for each of the supported RPC requests.
 */
scCommands.push({
    'name': 'successful RPC requests',
    'setup': function cmdRpcOkaySetup(ctx, callback) {
        ctx.client = helper.createClient();
        ctx.client.on('connect', callback);
    },
    'exec': function cmdRpcOkay(ctx, callback) {
        ctx.pipeline = vasync.pipeline({
            'arg': null,
            'funcs': [

                /*
                 * There's a test function for each of the supported RPC calls
                 * that we can use successfully.  This excludes getTokens(),
                 * which only succeeds for electric-moray.  The order is
                 * different than the failure cases above because it's simpler
                 * to create a working sequence in this order.  deleteBucket
                 * appears twice to deal with unclean exits.
                 */

                function cmdRpcOkayDeleteBucketCleanup(_, subcallback) {
                    ctx.client.deleteBucket(scTestBucket,
                        cbIgnoreErrorTypes(subcallback,
                        [ 'BucketNotFoundError' ]));
                },

                function cmdRpcOkayCreateBucket(_, subcallback) {
                    ctx.client.createBucket(scTestBucket, {}, subcallback);
                },

                function cmdRpcOkayGetBucket(_, subcallback) {
                    ctx.client.getBucket(scTestBucket, subcallback);
                },

                function cmdRpcOkayListBuckets(_, subcallback) {
                    ctx.client.listBuckets(subcallback);
                },

                function cmdRpcOkayUpdateBucket(_, subcallback) {
                    ctx.client.updateBucket(scTestBucket, {
                        'index': { 'field1': { 'type': 'number' } }
                    }, subcallback);
                },

                function cmdRpcOkayPutObject(_, subcallback) {
                    ctx.client.putObject(scTestBucket, 'key5',
                        { 'field1': 5 }, subcallback);
                },

                function cmdRpcOkayBatch(_, subcallback) {
                    ctx.client.batch([ {
                        'bucket': scTestBucket,
                        'operation': 'put',
                        'key': 'key2',
                        'value': { 'field1': 2 }
                    }, {
                        'bucket': scTestBucket,
                        'operation': 'put',
                        'key': 'key3',
                        'value': { 'field1': 3 }
                    }, {
                        'bucket': scTestBucket,
                        'operation': 'put',
                        'key': 'key7',
                        'value': { 'field1': 7 }
                    }, {
                        'bucket': scTestBucket,
                        'operation': 'put',
                        'key': 'key9',
                        'value': { 'field1': 9 }
                    } ], subcallback);
                },

                function cmdRpcOkayGetObject(_, subcallback) {
                    ctx.client.getObject(scTestBucket, 'key3', subcallback);
                },

                function cmdRpcOkayDelObject(_, subcallback) {
                    ctx.client.delObject(scTestBucket, 'key5', subcallback);
                },

                function cmdRpcOkayFindObjects(_, subcallback) {
                    var req = ctx.client.findObjects(scTestBucket, 'field1>=3');
                    req.on('error', function (err) {
                        subcallback(new VError(err, 'unexpected error'));
                    });
                    req.on('end', function () { subcallback(); });
                },

                function cmdRpcOkayUpdateObjects(_, subcallback) {
                    ctx.client.updateObjects(scTestBucket,
                        { 'field1': 10 }, 'field1>=9', subcallback);
                },

                function cmdRpcOkayReindexObjects(_, subcallback) {
                    ctx.client.reindexObjects(scTestBucket, 3, subcallback);
                },

                function cmdRpcOkayDeleteMany(_, subcallback) {
                    ctx.client.deleteMany(scTestBucket, 'field1>=7',
                        subcallback);
                },

                function cmdRpcOkayDeleteBucket(_, subcallback) {
                    ctx.client.deleteBucket(scTestBucket, subcallback);
                },

                function cmdRpcOkayPing(_, subcallback) {
                    ctx.client.ping(subcallback);
                },

                function cmdRpcOkayVersion(_, subcallback) {
                    ctx.client.versionInternal(subcallback);
                },

                function cmdRpcOkaySql(_, subcallback) {
                    var req = ctx.client.sql('SELECT NOW();');
                    req.on('error', function (err) {
                        subcallback(new VError(err, 'unexpected error'));
                    });
                    req.on('end', function () { subcallback(); });
                }
            ]
        }, callback);
    }
});



main();
