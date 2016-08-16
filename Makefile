#
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
#

#
# Copyright (c) 2016, Joyent, Inc. All rights reserved.
#

#
# Makefile: top-level Makefile
#
# This Makefile contains only repo-specific logic and uses included makefiles
# to supply common targets (javascriptlint, jsstyle, restdown, etc.), which are
# used by other repos as well.
#

#
# Tools
#
NPM		 = npm
FAUCET		 = ./node_modules/.bin/faucet
CONFIGURE	 = ./tools/configure

#
# We use ctrun(1) to ensure that child processes created by the test cases are
# always cleaned up.  However, on systems that don't provide ctrun(1), this
# could be commented out.
#
CTRUN		 = ctrun -o noorphan


#
# Files and other definitions
#
JSON_FILES	 = package.json \
		   etc/moray-test-suite-stock.json \
		   etc/moray-test-suite-custom-both.json
JS_FILES	:= tools/configure $(shell find lib test -name '*.js')
JSL_FILES_NODE	 = $(JS_FILES)
JSSTYLE_FILES	 = $(JS_FILES)
JSSTYLE_FLAGS    = -f ./tools/jsstyle.conf
JSL_CONF_NODE	 = tools/jsl.node.conf

MORAY_TEST_CONFIG_FILE	?= etc/moray-test-suite.json
MORAY_TEST_RUNDIR        = run
MORAY_TEST_ENV_FILE	 = $(MORAY_TEST_RUNDIR)/env.sh

#
# Targets
#

.PHONY: all
all:
	$(NPM) install
CLEAN_FILES += node_modules

.PHONY: test
test: | $(FAUCET) $(MORAY_TEST_ENV_FILE)
	(set -o pipefail; \
	source $(MORAY_TEST_ENV_FILE) && \
	$(CTRUN) node test/client.test.js | $(FAUCET) && \
	$(CTRUN) node test/buckets.test.js | $(FAUCET) && \
	$(CTRUN) node test/objects.test.js | $(FAUCET) && \
	$(CTRUN) node test/sql.test.js | $(FAUCET) && \
	$(CTRUN) node test/integ.test.js | $(FAUCET) && \
	$(CTRUN) node test/arrays.test.js | $(FAUCET) && \
	$(CTRUN) node test/version.test.js | $(FAUCET) && \
	$(CTRUN) node test/loop.test.js | bunyan -lfatal )
	@echo tests passed

$(FAUCET): all

$(MORAY_TEST_ENV_FILE): $(MORAY_TEST_CONFIG_FILE)
	$(CONFIGURE) $^

$(MORAY_TEST_CONFIG_FILE):
	@echo
	@echo You must create $(MORAY_TEST_CONFIG_FILE) first.  See README.md.
	@exit 1

CLEAN_FILES += run

include ./Makefile.targ
