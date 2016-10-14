/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2016, Joyent, Inc.
 */

/*
 * translate-legacy.test.js: test Moray v2 function for translating v1-style
 * parameters.
 */

var assertplus = require('assert-plus');
var moray = require('moray');
var tape = require('tape');
var translateLegacyOptions = moray.Client.privateTranslateLegacyOptions;

var testcases;

function main()
{
    testcases.forEach(defineTestCase);
}

function defineTestCase(tc)
{
    assertplus.string(tc.name);
    assertplus.object(tc.input);
    assertplus.optionalObject(tc.output);
    assertplus.ok(tc.output || tc.errmsg);
    assertplus.ok(!(tc.output && tc.errmsg));

    tape.test(tc.name, function runTestCase(t) {
        var rv;

        if (tc.errmsg) {
            t.throws(function () {
                translateLegacyOptions(tc.input);
            }, tc.errmsg);
            t.end();
            return;
        }

        /*
         * There's no sense in testing all of the defaults.  We only compare
         * properties that were specified in tc.output.
         */
        rv = translateLegacyOptions(tc.input);
        assertplus.object(rv);
        checkDeepSubset(t, tc.output, rv, 'result');
        t.end();
    });
}

/*
 * This function behaves like t.deepEqual(), except that it ignores properties
 * in "actual" that are not present in "expected".  This applies recursively, so
 * that if expected.x.y exists but actual.x.y doesn't (but actual.x and
 * expected.x are otherwise equivalent), then no error is thrown.
 */
function checkDeepSubset(t, expected, actual, prefix)
{
    var k;

    for (k in expected) {
        if (typeof (expected[k]) == 'object' &&
            typeof (actual[k]) == 'object' &&
            expected[k] !== null && actual[k] !== null &&
            !Array.isArray(expected[k]) && !Array.isArray(actual[k])) {

            checkDeepSubset(t, expected[k], actual[k], prefix + '.' + k);
        } else {
            t.deepEqual(expected[k], actual[k], prefix + '.' + k + '  matches');
        }
    }
}

/*
 * For details on allowed inputs and expected behavior, see the detailed comment
 * above translateLegacyOptions().
 */
testcases = [ {
    'name': 'no arguments',
    'input': {},
    'errmsg': /is required/
},

/*
 * The behavior with respect to "host", "port", and "url" is the most
 * complicated.
 */

{
    'name': 'host specified, missing port',
    'input': { 'host': 'foobar' },
    'errmsg': /port.*is required/
}, {
    'name': 'host and port specified',
    'input': { 'host': 'foobar', 'port': 1234 },
    'output': {
        'defaultPort': 1234,
        'domain': 'foobar'
    }
}, {
    'name': 'host and port specified, wrong host type',
    'input': { 'host': [], 'port': 1234 },
    'errmsg': /host.*is required/
}, {
    'name': 'host and port specified, wrong port type',
    'input': { 'host': 'foobar', 'port': '1234' },
    'errmsg': /port.*is required/
}, {
    'name': 'url specified, bad type',
    'input': { 'url': 1234 },
    'errmsg': /is required/
}, {
    'name': 'url specified with port',
    'input': { 'url': 'tcp://foobar.a.b.c:1234/' },
    'output': {
        'defaultPort': 1234,
        'domain': 'foobar.a.b.c'
    }
}, {
    'name': 'url specified with no port',
    'input': { 'url': 'tcp://foobar.a.b.c/' },
    'output': {
        'defaultPort': 2020,
        'domain': 'foobar.a.b.c'
    }
}, {
    'name': 'url and port specified',
    'input': { 'url': 'tcp://foobar.a.b.c:1234/', 'port': 3456 },
    'output': {
        'defaultPort': 3456,
        'domain': 'foobar.a.b.c'
    }
}, {
    'name': 'host, url, and port specified',
    'input': { 'url': 'tcp://foobar.a:1234/', 'host': 'fooey', 'port': 3456 },
    'output': {
        'defaultPort': 3456,
        'domain': 'fooey'
    }
},

/*
 * Miscellaneous other parameters
 */
{
    'name': 'connectTimeout: bad',
    'input': {
        'url': 'tcp://foobar.a.b:5678',
        'connectTimeout': {}
    },
    'errmsg': /connectTimeout/
}, {
    'name': 'connectTimeout: specified',
    'input': {
        'url': 'tcp://foobar.a.b:5678',
        'connectTimeout': 4567
    },
    'output': {
        'domain': 'foobar.a.b',
        'defaultPort': 5678,
        'recovery': {
            'default': {
                'timeout': 4567,
                'maxTimeout': 4567,
                'retries': 0,
                'delay': 0,
                'maxDelay': 0
            }
        }
    }
},

{
    'name': 'maxConnections: bad',
    'input': {
        'url': 'tcp://foobar.a.b:5678',
        'maxConnections': {}
    },
    'errmsg': /maxConnections/
}, {
    'name': 'maxConnections specified',
    'input': {
        'url': 'tcp://foobar.a.b:5678',
        'maxConnections': 427
    },
    'output': {
        'domain': 'foobar.a.b',
        'defaultPort': 5678,
        'maximum': 427
    }
},

{
    'name': 'dns: bad',
    'input': {
        'url': 'tcp://foobar.a.b:5678',
        'dns': 17
    },
    'errmsg': /dns/
}, {
    'name': 'dns: specified',
    'input': {
        'url': 'tcp://foobar.a.b:5678',
        'dns': {
            /* checkInterval should not appear in the output. */
            'checkInterval': 37,
            'resolvers': [ '1.2.3.4', '5.6.7.8' ],
            'timeout': 9876
        }
    },
    'output': {
        'domain': 'foobar.a.b',
        'defaultPort': 5678,
        'resolvers': [ '1.2.3.4', '5.6.7.8' ],
        'recovery': {
            'dns': {
                'timeout': 9876,
                'maxTimeout': 9876
            },
            'dns_srv': {
                'timeout': 9876,
                'maxTimeout': 9876
            }
        }
    }
},

{
    'name': 'retry: bad',
    'input': {
        'url': 'tcp://foobar.a.b:5678',
        'retry': 37
    },
    'errmsg': /retry/
}, {
    'name': 'retry: minTimeout > maxTimeout',
    'input': {
        'url': 'tcp://foobar.a.b:5678',
        'retry': {
            'retries': 42,
            'minTimeout': 7890,
            'maxTimeout': 4567
        }
    },
    'errmsg': /maxTimeout.*minTimeout/
}, {
    'name': 'retry: specified',
    'input': {
        'url': 'tcp://foobar.a.b:5678',
        'retry': {
            'retries': 42,
            'minTimeout': 4567,
            'maxTimeout': 7890
        }
    },
    'output': {
        'resolvers': undefined,
        'recovery': {
            'dns': {},
            'dns_srv': {},
            'default': {
                'retries': 42,
                'delay': 4567,
                'maxDelay': 7890
            }
        }
    }
},

{
    'name': 'the works',
    'input': {
        'url': 'tcp://foobar.a.b:5678',
        'host': 'example.com',
        'port': 314,
        'connectTimeout': 111,
        'dns': {
            /* checkInterval should not appear in the output. */
            'checkInterval': 555,
            'resolvers': [ '1.1.1.1', '2.2.2.2' ],
            'timeout': 222
        },
        'maxConnections': 333,
        'retry': {
            'retries': 444,
            'minTimeout': 777,
            'maxTimeout': 888
        }
    },
    'output': {
        'domain': 'example.com',
        'defaultPort': 314,
        'maximum': 333,
        'resolvers': [ '1.1.1.1', '2.2.2.2' ],
        'recovery': {
            'dns': {
                'timeout': 222,
                'maxTimeout': 222
            },
            'dns_srv': {
                'retries': 0,
                'timeout': 222,
                'maxTimeout': 222
            },
            'default': {
                'timeout': 111,
                'maxTimeout': 111,
                'retries': 444,
                'delay': 777,
                'maxDelay': 888
            }
        }
    }
} ];

main();
