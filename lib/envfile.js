/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2016, Joyent, Inc.
 */

/*
 * envfile.js: manage bash-compatible environment files
 */

var mod_assertplus = require('assert-plus');
var mod_jsprim = require('jsprim');
var mod_stream = require('stream');
var mod_wordwrap = require('wordwrap');
var wrap78 = mod_wordwrap(78);

/* exported interface */
exports.Environment = Environment;

/*
 * An "Environment" instance encapsulates a collection of shell environment
 * variables so that they can be written out to a file.
 */
function Environment()
{
    this.e_vars = {};
}

/*
 * Set the given variable.  Named arguments include:
 *
 *     name      name of the environment variable
 *     (string)
 *
 *     value     value of the environment variable
 *     (string)
 *
 *     comment   optional comment to be inserted above the variable.  This
 *     [string]  string will be automatically wrapped.
 */
Environment.prototype.setVar = function envSetVar(args)
{
    mod_assertplus.object(args, 'args');
    mod_assertplus.string(args.name, 'args.name');
    mod_assertplus.string(args.value, 'args.value');
    mod_assertplus.optionalString(args.comment, 'args.comment');

    mod_assertplus.ok(/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(args.name),
        'not a valid shell identifier');
    this.e_vars[args.name] = {
        'ev_name': args.name,
        'ev_value': args.value,
        'ev_comment': args.comment || null
    };
};

/*
 * Similar to setVar(), but assumes that the given variable ("args.name")
 * represents a shell path consisting of colon-delimited values (like PATH) and
 * constructs the value by prepending "args.pathentry" to any previously-set
 * value.
 */
Environment.prototype.prependPath = function envPrependPath(args)
{
    var evar, value, comment;

    mod_assertplus.object(args, 'args');
    mod_assertplus.string(args.name, 'args.name');
    mod_assertplus.string(args.pathentry, 'args.pathentry');
    mod_assertplus.optionalString(args.comment, 'args.comment');

    if (this.e_vars.hasOwnProperty(args.name)) {
        evar = this.e_vars[args.name];
        value = args.pathentry + ':' + evar.ev_value;
        if (!comment) {
            comment = evar.ev_comment;
        }
    } else {
        value = args.pathentry;
        comment = args.comment;
    }

    this.setVar({
        'name': args.name,
        'value': value,
        'comment': comment
    });
};

/*
 * Returns a Readable stream that emits the environment variables in shell
 * format.
 */
Environment.prototype.readable = function envReadable()
{
    var stream = new mod_stream.PassThrough();

    mod_jsprim.forEachKey(this.e_vars, function (_, evar) {
        var c;
        if (evar.ev_comment !== null) {
            c = wrap78(evar.ev_comment).split(/\n/).map(
                function (line) { return ('# ' + line + '\n'); });
            if (c.length > 1) {
                c.unshift('#\n');
                c.push('#\n');
            }

            stream.write(c.join(''));
        }

        stream.write('export ' + evar.ev_name + '=\'' +
            evar.ev_value + '\'\n\n');
    });

    stream.end();
    return (stream);
};
