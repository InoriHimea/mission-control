#!/usr/bin/env node

import process from 'node:process'

const args = process.argv.slice(2)

function fail(message) {
  process.stderr.write(`${message}\n`)
  process.exit(1)
}

if (args.length === 1 && args[0] === '--version') {
  process.stdout.write('opencode 1.4.3\n')
  process.exit(0)
}

if (args[0] !== 'run') {
  fail(`Unsupported arguments: ${args.join(' ')}`)
}

const runArgs = args.slice(1)
if (runArgs[0] !== '--session' || !runArgs[1]) {
  fail(`Unsupported arguments: ${args.join(' ')}`)
}

const session = runArgs[1]
let prompt
if (runArgs.length === 3 && !runArgs[2].startsWith('--')) {
  prompt = runArgs[2]
} else if (runArgs.length === 4 && runArgs[2] === '--prompt' && runArgs[3]) {
  prompt = runArgs[3]
} else {
  fail(`Unsupported arguments: ${args.join(' ')}`)
}

if (session !== 'ses_e2e_1') {
  fail(`Session not found: ${session}`)
}

if (prompt === 'say exactly CONTINUE_OK and nothing else') {
  process.stdout.write('CONTINUE_OK\n')
  process.exit(0)
}

process.stdout.write(`OpenCode session ${session} continued: ${prompt}\n`)
