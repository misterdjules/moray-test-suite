/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2016, Joyent, Inc.
 */

/*
 * cli-sanity.test.js: very basic test suite for the moray CLI tools.  This
 * is not an exhaustive regression suite.
 */

var assertplus = require('assert-plus');
var forkexec = require('forkexec');
var helper = require('./helper');
var path = require('path');
var tape = require('tape');
var vasync = require('vasync');

var binpath, testcases;
var bucket = 'cli_sanity_test_bucket';

function main()
{
    binpath = path.join(__dirname, '..', 'run', 'client',
        'node_modules', '.bin');

    tape.test('successful sequence', runNormalSequence);

    testcases = [];
    generateFailureTests();
    testcases.forEach(defineTestCase);
}

/*
 * "tc" is a CLI tool test case, which should have:
 *
 *     name        name of the test case
 *
 *     exec        "argv" argument to node-forkexec, which describes the command
 *                 to execute (as an array)
 *
 *     statusCode  integer status code expected from the command.  (This test
 *                 runner does not support invocations that would die as a
 *                 result of a signal.  Those would produce no status code.)
 *
 *     stdout      regular expression to match against stdout contents
 *
 *     stderr      regular expression to match against stderr contents
 *
 * This function configures tape to run the command "exec" and validate the
 * status code, stdout, and stderr.
 */
function defineTestCase(tc)
{
    assertplus.string(tc.name);
    assertplus.number(tc.statusCode);
    assertplus.object(tc.stdout);
    assertplus.object(tc.stderr);
    assertplus.arrayOfString(tc.exec);

    tape.test(tc.name, function runTestCase(t) {
        runCmd(tc.exec, function (err, info) {
            t.strictEqual(tc.statusCode, info.status, 'status code');
            t.ok(tc.stdout.test(info.stdout), 'stdout matches');
            t.ok(tc.stderr.test(info.stderr), 'stderr matches');
            t.end();
        });
    });
}

function runCmd(argv, callback)
{
    var qualified_argv, forkexec_args;

    assertplus.arrayOfString(argv);
    assertplus.func(callback);

    qualified_argv = argv.slice(0);
    qualified_argv[0] = path.join(binpath, argv[0]);
    forkexec_args = {
        'env': {
            'PATH': process.env['PATH']
        },
        'timeout': 60000,
        'argv': qualified_argv,
        'includeStderr': true
    };

    if (process.env['MORAY_TEST_SERVER_REMOTE']) {
        forkexec_args.env['MORAY_URL'] = process.env[
            'MORAY_TEST_SERVER_REMOTE'];
    } else {
        forkexec_args.env['MORAY_URL'] = 'tcp://127.0.0.1:2020';
    }

    forkexec.forkExecWait(forkexec_args, callback);
}

/*
 * Runs a sequence of commands that exercises all of the command-line tools.
 * This sequence is based on the one in test/stress-client.js.  Updates here
 * should be propagated there.
 */
function runNormalSequence(t)
{
    var server, funcs;

    funcs = [
        function setupServer(_, callback) {
            helper.createServer({}, function (s) {
                server = s;
                callback();
            });
        },

        function delBucketCleanup(_, callback) {
            runCmd([ 'delbucket', bucket ], function (err) {
                /* We don't care about a "not found" error here. */
                callback();
            });
        },

        function createBucket(_, callback) {
            runCmd([ 'putbucket', bucket ], callback);
        },

        function getBucket(_, callback) {
            runCmd([ 'getbucket', bucket ], function (err, info) {
                var p, d;

                t.error(err);
                p = JSON.parse(info.stdout);
                t.equal(typeof (p), 'object');
                t.ok(p !== null);
                t.equal(p.name, bucket);
                t.deepEqual(p.index, {});
                t.deepEqual(p.pre, []);
                t.deepEqual(p.post, []);
                t.deepEqual(p.options, { 'version': 0 });
                d = Date.parse(p.mtime);
                t.ok(d > Date.parse('2016-01-01') &&
                    d < Date.parse('2038-01-19'));
                callback();
            });
        },

        function listBuckets(_, callback) {
            runCmd([ 'listbuckets' ], function (err, info) {
                var p;

                t.error(err);
                p = JSON.parse(info.stdout);
                t.ok(Array.isArray(p));
                p = p.filter(function (b) { return (b.name == bucket); });
                t.equal(p.length, 1);
                p = p[0];
                t.deepEqual(p.options, { 'version': 0 });
                callback();
            });
        },

        function putObject5(_, callback) {
            runCmd([ 'putobject', '-d',
                JSON.stringify({ 'field1': 5 }), bucket, 'key5' ], callback);
        },

        function updateBucket(_, callback) {
            runCmd([ 'putbucket', '-x', '2', '-i', 'field1:number', bucket ],
                callback);
        },

        function reindexObjects(_, callback) {
            runCmd([ 'reindexobjects', bucket ], callback);
        },

        function putObject2(_, callback) {
            runCmd([ 'putobject', '-d',
                JSON.stringify({ 'field1': 2 }), bucket, 'key2' ], callback);
        },

        function putObject3(_, callback) {
            runCmd([ 'putobject', '-d',
                JSON.stringify({ 'field1': 3 }), bucket, 'key3' ], callback);
        },

        function putObject9(_, callback) {
            runCmd([ 'putobject', '-d',
                JSON.stringify({ 'field1': 9 }), bucket, 'key9' ], callback);
        },

        function getObject(_, callback) {
            runCmd([ 'getobject', bucket, 'key5' ], function (err, info) {
                t.error(err);

                var p = JSON.parse(info.stdout);
                t.equal(p.key, 'key5');
                t.deepEqual(p.value, { 'field1': 5 });
                t.equal(p._id, 1);
                t.equal('string', typeof (p._etag));
                t.equal('number', typeof (p._mtime));
                callback();
            });
        },

        function delObject(_, callback) {
            runCmd([ 'delobject', bucket, 'key3' ], callback);
        },

        function findObjects(_, callback) {
            var filter = 'field1>=3';
            runCmd([ 'findobjects', '-H', bucket, filter ],
                function (err, info) {

                var objs, found;
                t.error(err);
                objs = parseFindobjectsResults(t, info.stdout);
                found = [];
                objs.forEach(function (o) {
                    t.equal('key' + o.value.field1, o.key);
                    found.push(o.key);
                });

                found.sort();
                t.deepEqual(found, [ 'key5', 'key9' ]);
                callback();
            });
        },

        function updateMany(_, callback) {
            var filter = 'field1>=9';
            runCmd([ 'updatemany', '-d', JSON.stringify({ 'field1': 10 }),
                bucket, filter ], callback);
        },

        function findobjectsAll(_, callback) {
            runCmd([ 'findobjects', '-H', bucket, 'field1=*' ],
                function (err, info) {

                var objs;
                t.error(err);
                objs = parseFindobjectsResults(t, info.stdout);
                objs.sort(function (o1, o2) {
                    return (o1.key.localeCompare(o2.key));
                });
                objs = objs.map(function (o) {
                    return ({ 'key': o.key, 'value': o.value });
                });
                t.deepEqual(objs, [
                    { 'key': 'key2', 'value': { 'field1': 2 } },
                    { 'key': 'key5', 'value': { 'field1': 5 } },
                    { 'key': 'key9', 'value': { 'field1': 10 } }
                ]);
                callback();
            });
        },

        function delMany(_, callback) {
            var filter = 'field1>=5';
            runCmd([ 'delmany', bucket, filter], callback);
        },

        function findobjectsDeleted(_, callback) {
            runCmd([ 'findobjects', '-H', bucket, 'field1=*' ],
                function (err, info) {

                var objs;
                t.error(err);
                objs = parseFindobjectsResults(t, info.stdout);
                t.equal(objs.length, 1);
                t.equal(objs[0].key, 'key2');
                callback();
            });
        },

        function delbucket(_, callback) {
            runCmd([ 'delbucket', bucket ], callback);
        },

        function ping(_, callback) {
            runCmd([ 'morayping' ], callback);
        },

        function version(_, callback) {
            runCmd([ 'morayversion' ], callback);
        },

        function sql(_, callback) {
            runCmd([ 'sql', 'select 8+8 as TwiceEight' ], function (err, info) {
                var joined, parsed;

                t.error(err);
                joined = info.stdout.split('\n').join(' ');
                parsed = JSON.parse(joined);
                t.deepEqual(parsed, { 'twiceeight': 16 });
                callback();
            });
        }
    ];

    vasync.pipeline({
        'funcs': funcs
    }, function (err) {
        t.error(err, 'no error');
        helper.cleanupServer(server, function () {
            t.end();
        });
    });
}

function parseFindobjectsResults(t, stdout)
{
    var lines, objs;

    assertplus.object(t, 't');
    assertplus.string(stdout, 'stdout');
    lines = stdout.split('\n');
    t.ok(lines.length > 1);
    /* Chop off trailing newline. */
    t.equal(lines[lines.length - 1], '');
    lines = lines.slice(0, lines.length - 1);

    objs = lines.map(function (l) { return (JSON.parse(l)); });
    return (objs);
}

/*
 * Generates test cases (that can be provided to defineTestCase) for each of the
 * command-line tools that exercise bad arguments for the "-h" (host) and "-p"
 * (port) arguments.
 */
function generateFailureTests()
{
    var cmds = [
        'backfill',
        'delbucket',
        'delmany',
        'delobject',
        'findobjects',
        'getbucket',
        'getobject',
        'listbuckets',
        'morayping',
        'morayversion',
        'putbucket',
        'putobject',
        'reindexobjects',
        'sql',
        'updatemany'
    ];

    cmds.forEach(function (cmdname) {
        var args = validArgsFor(cmdname);
        testcases.push({
            'name': cmdname + ': bad hostname',
            'exec': [ cmdname ].concat(
                [ '-h', 'bogus-test', '-p', '1111' ].concat(args)),
            'statusCode': 1,
            'stdout': /^$/,
            'stderr': new RegExp('^' + cmdname +
                ':.*bogus-test.*: failed to establish connection')
        });

        testcases.push({
            'name': cmdname + ': bad port',
            'exec': [ cmdname ].concat(
                [ '-h', '127.0.0.1', '-p', '1111' ].concat(args)),
            'statusCode': 1,
            'stdout': /^$/,
            'stderr': new RegExp('^' + cmdname +
                ':.*127\\.0\\.0\\.1.*: failed to establish connection')
        });
    });
}

/*
 * Given one of the Moray CLI tools, return a list of arguments that are
 * necessary for a syntactically valid command invocation.  The goal is that we
 * can combine these arguments with invalid values for "-h" and "-p" and have
 * the command fail as a result of the -h/-p arguments rather than because the
 * command had missing or incorrect arguments.
 */
function validArgsFor(cmdname)
{
    var args = [];

    if (cmdname == 'sql') {
        return ([ 'select NOW()' ]);
    }

    if (cmdname == 'backfill' || cmdname == 'delbucket' ||
        cmdname == 'delmany' || cmdname == 'delobject' ||
        cmdname == 'findobjects' || cmdname == 'getbucket' ||
        cmdname == 'getobject' || cmdname == 'putbucket' ||
        cmdname == 'putobject' || cmdname == 'reindexobjects' ||
        cmdname == 'updatemany') {
        /* add a bucket name */
        args.push(bucket);
    }

    if (cmdname == 'delobject' ||
        cmdname == 'getobject' ||
        cmdname == 'putobject') {
        /* add an object key */
        args.push('x');
    }

    if (cmdname == 'delmany' ||
        cmdname == 'findobjects' ||
        cmdname == 'updatemany') {
        /* add a filter */
        args.push('x=y');
    }

    return (args);
}

main();
