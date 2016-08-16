<!--
    This Source Code Form is subject to the terms of the Mozilla Public
    License, v. 2.0. If a copy of the MPL was not distributed with this
    file, You can obtain one at http://mozilla.org/MPL/2.0/.
-->

<!--
    Copyright (c) 2016, Joyent, Inc.
-->

# Moray test suite

This repository is part of the Joyent SmartDataCenter project (SDC), and the
Joyent Manta project.  For contribution guidelines, issues, and general
documentation, visit the main [SDC](http://github.com/joyent/sdc) and
[Manta](http://github.com/joyent/manta) project pages.

This repository contains the test suite for the [Moray
client](https://github.com/joyent/node-moray) and [Moray
server](https://github.com/joyent/moray).


## Quick start

To run the tests, you typically:

1. Clone this repository.
2. Install the dependencies:

    $ npm install

3. Configure the test suite.  Start with one of the template configuration
   files.  You'll need to fill in the path to a sample Moray server
   configuration file appropriate for your environment:

    $ cp etc/moray-test-suite-stock.json etc/moray-test-suite.json
    $ vim etc/moray-test-suite.json

   and then run configure using that file:

    $ ./tools/configure etc/moray-test-suite.json

4. Run the tests:

    $ make test

To run individual tests by hand, first configure the test suite (steps 1 through
3 above), then source the generated environment file and run the test programs
by hand:

    $ source run/env.sh
    $ node test/buckets.test.js

## Configuration

The configuration file specifies:

Property          | Type   | Example         | Meaning
--------          | ------ | --------------- | -------
server            | object | (see below)     | Describes the server implementation used for the test suite and how to run the server.
server.remote     | string | `'tcp://localhost:2020'` | If specified, then use the servers at the specified URLs instead of spinning up servers using the `server.node`, `server.path`, `server.start`, and `server.configBase` properties.
server.node       | string | `node`          | Path to the node executable to use when running the server, or `node` to use executable on the path (not recommended).
server.path       | string | `../moray`      | Path to the server implementation that you want to test.  This is usually a cloned copy of the moray repository, possibly with local changes.  If this path is not absolute, then it will be interpreted relative to the root of this repository.  If this is not specified, then the stock server will be cloned and used.
server.start      | string | `$MORAY_NODE $MORAY_PATH main.js -f $MORAY_CONFIG -v 2>&1` | bash command to start the server, emitting logs to stdout.  $MORAY\_NODE expands to `server.node`, $MORAY\_PATH expands to `server.path`, and $MORAY\_CONFIG expands to the target configuration file, which will be based on the file `server.configBase`.
server.configBase | string | `../moray/config.json` | Path to the configuration file to use for servers started by the test suite.  The test suite may need to modify configuration slightly (e.g., to adjust port numbers), so it will create new configuration files based on this one.
client            | string | (see below)     | Describes the client implementation used for the test suite.
client.path       | string | `../node-moray` | Path to the client implementation that you want to test.  This is usually a cloned copy of the node-moray repository, possibly with local changes.  If this path is not absolute, then it will be interpreted relative to the root of this repository.  If this is not specified, then the stock client will be cloned and used.

The `configure` script takes this configuration file, fills in default values,
and then validates the configuration.  The script then sets up a "run" directory
that contains links to the installed client and server and a shell environment
file that contains the above configuration.

The test suite programs read the configuration out of the environment.  If you
like, you can modify the environment file or even modify your environment
directly,  but the intended workflow is that you modify the config file, re-run
configure, and then source the new configuration file.  This keeps everything in
sync and the result is repeatable.

The environment variables are documented in the generated file.


## A note on Node versions

As of this writing, the server only works with Node 0.10.  The current client
works on v0.10 and later, but imminent updates will eliminate support for v0.10.
This test suite is designed with the assumption that the client and server may
be running different versions of Node, with different dependencies (even for
dependencies of the same package and version, since binaries differ across Node
versions).  **The test suite and client always run with the version of Node on
your PATH when you run the `configure` tool.**  The server runs with the Node
version specified in the configuration file (which also defaults to the one on
your PATH).
