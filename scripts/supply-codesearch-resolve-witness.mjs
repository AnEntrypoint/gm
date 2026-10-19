#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
const flags = Object.fromEntries(process.argv.slice(2).map(arg => {
    const match = /^--([a-z-]+)(?:=(.*))?$/.exec(arg)
    return match ? [match[1], match[2] ?? 'true'] : [arg, 'true']
}))
const project = flags.project ?? process.cwd()
const client = flags.client ?? path.join(os.homedir(), '.gm-tools', 'gm-mcp-server.mjs')
const NAMED_IDS = ['gm-runtime-host-hmr-activation', 'gm-sibling-dream-rsi-ticker-repair', 'gm-stale-mcp-bundle-restart']
const NESTED_DISPATCH = '1791868129586-500-e8f2275aa165577f'

function dispatch(verb, body) {
    const argv = [client, 'dispatch', verb, '--cwd', project]
    if (body !== undefined) argv.push('--body', JSON.stringify(body))
    try {
        return execFileSync(process.execPath, argv, {
            encoding: 'utf8',
            maxBuffer: 512 * 1024 * 1024,
            stdio: ['ignore', 'pipe', 'ignore'],
            timeout: 900_000,
        })
    } catch (error) {
        return String(error.stdout ?? '')
    }
}

const reply = text => text.replace(/\s+/g, ' ').slice(0, 220)
const resolves = id => {
    const text = dispatch('prd-list', { id })
    return /^ok: true$/m.test(text) && /^count: 1$/m.test(text)
}

const results = []
function check(name, ok, detail) {
    results.push(ok)
    console.log(`CHECK ${name}: ${ok ? 'PASS' : 'FAIL'} ${detail}`)
}

const instructionText = dispatch('instruction', {})
const launchBlock = /^concurrency_shortfall:\n  launch:\n((?:    - .+\n)+)/m.exec(instructionText)
const advertised = launchBlock ? [...launchBlock[1].matchAll(/^    - (\S+)$/gm)].map(match => match[1]) : null
const unresolved = (advertised ?? []).filter(id => !resolves(id))
check(
    'C1_every_advertised_candidate_resolves_via_prd_list',
    advertised !== null && unresolved.length === 0,
    `advertised=${advertised?.length ?? 'absent'} unresolved=${JSON.stringify(unresolved)}`,
)

for (const id of NAMED_IDS) {
    check(`C2_named_${id}_is_a_backed_row`, resolves(id), id)
}

const zero = dispatch('codesearch', { query: 'Freddie', mode: 'literal', path: 'AGENTS.md', k: 0 })
check(
    'C3_k_zero_literal_is_unlimited',
    /^ok: true$/m.test(zero) && !/must be a positive integer/.test(zero),
    reply(zero),
)

const zeroDual = dispatch('codesearch', { query: 'Freddie', mode: 'dual', path: 'AGENTS.md', k: 0 })
check('C4_k_zero_dual_is_refused', /^ok: false$/m.test(zeroDual), reply(zeroDual))

const filesScan = exclude => dispatch('codesearch', {
    query: 'Freddie',
    mode: 'literal',
    path: '.',
    glob: '**/*.md',
    output: 'files',
    max_matches: 5000,
    ...(exclude === undefined ? {} : { exclude }),
})
const fileCount = text => Number(/(\d+) files of/.exec(text)?.[1] ?? NaN)
const controlFiles = fileCount(filesScan(undefined))
const commaFiles = fileCount(filesScan('docs/**,.agents/**'))
const arrayFiles = fileCount(filesScan(['docs/**', '.agents/**']))
check(
    'C5_comma_exclude_equals_array_exclude_and_removes_files',
    Number.isFinite(controlFiles) && commaFiles === arrayFiles && commaFiles < controlFiles,
    `control=${controlFiles} comma=${commaFiles} array=${arrayFiles}`,
)

const pair = dispatch('codesearch', { query: 'Freddie', mode: 'literal', path: 'AGENTS.md', k: 3, max_results: 5 })
check(
    'C6_k_and_max_results_conflict_names_the_field_to_drop',
    /^ok: false$/m.test(pair) && /drop "max_results" and keep "k"/.test(pair),
    reply(pair),
)

const pairSame = dispatch('codesearch', { query: 'Freddie', mode: 'literal', path: 'AGENTS.md', k: 3, max_results: 3 })
check('C7_k_and_max_results_with_equal_values_are_accepted', /^ok: true$/m.test(pairSame), reply(pairSame))

const resolve = dispatch('prd-resolve', {
    id: 'gm-witness-missing-row-ledger-check',
    witness_dispatch_id: NESTED_DISPATCH,
    witness_evidence: 'ledger witness',
})
const holder = /ledger_holding_dispatch: (.*)$/m.exec(resolve)?.[1] ?? 'absent'
check(
    'C8_prd_resolve_names_the_searched_ledger',
    /ledger_searched/.test(resolve),
    `holder=${holder} ${reply(resolve)}`,
)

const failed = results.filter(ok => !ok).length
console.log(`SUMMARY ${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
