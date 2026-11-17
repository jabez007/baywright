/**
 * Runs `npm audit` and fails on any advisory that ALLOWED does not list.
 * Extra arguments, such as `--omit=dev`, go to `npm audit`.
 *
 * An allowed advisory stays allowed only while it looks as it did when we
 * allowed it, with the same vulnerable range and the same latest release of
 * its package. When either changes, a fix may exist, so the audit fails and
 * names what to check.
 */
import { execFileSync } from 'node:child_process'

const ALLOWED = [
  {
    id: 'GHSA-fc5q-39xc-vjpf',
    package: 'picomatch',
    range: '<=4.0.7',
    latest: '4.0.7',
    allowedOn: '2026-11-17',
    // No picomatch release fixes this ReDoS yet. picomatch runs only in build
    // and dev tools (vite, vitest, vue-tsc, typescript-eslint, and the build
    // plugin vue-router ships), on glob patterns this repository writes, and
    // none of it reaches the built site.
    reason: 'build-time only, on our own glob patterns, and no fixed release exists',
  },
]

/** The output of an npm command that prints JSON, whether or not it exits 0. */
function npmJson(args) {
  let stdout
  try {
    stdout = execFileSync('npm', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] })
  } catch (error) {
    // npm audit exits 1 whenever it finds anything, and still prints the report.
    if (typeof error.stdout !== 'string' || error.stdout === '') throw error
    stdout = error.stdout
  }
  return JSON.parse(stdout)
}

/** Every advisory in an audit report, once each, keyed by its GHSA id. */
function advisoriesIn(report) {
  const advisories = new Map()
  for (const vulnerability of Object.values(report.vulnerabilities ?? {})) {
    for (const via of vulnerability.via) {
      // A string names another vulnerable package. Objects are the advisories.
      if (typeof via === 'object') advisories.set(via.url.split('/').at(-1), via)
    }
  }
  return advisories
}

/** Why `advisory` fails the audit, or nothing when ALLOWED still covers it. */
function problemWith(id, advisory) {
  const allowed = ALLOWED.find((entry) => entry.id === id)
  if (!allowed) return `${id} (${advisory.severity}) in ${advisory.name} ${advisory.range}: ${advisory.title} ${advisory.url}`
  if (advisory.range !== allowed.range) {
    return `${id} now covers ${advisory.name} ${advisory.range}, not ${allowed.range}. Check for a fixed release, then upgrade or update ALLOWED`
  }
  const latest = npmJson(['view', allowed.package, 'version', '--json'])
  if (latest !== allowed.latest) {
    return `${allowed.package} ${latest} is out since ${id} was allowed. Check whether it fixes ${id}, then upgrade or update ALLOWED`
  }
  return undefined
}

const advisories = advisoriesIn(npmJson(['audit', '--json', ...process.argv.slice(2)]))
const problems = [...advisories].map(([id, advisory]) => problemWith(id, advisory)).filter(Boolean)

for (const entry of ALLOWED) {
  if (advisories.has(entry.id)) console.log(`Allowed ${entry.id} in ${entry.package} ${entry.range} since ${entry.allowedOn}: ${entry.reason}.`)
  else console.log(`${entry.id} no longer turns up. Remove it from ALLOWED in scripts/audit.mjs.`)
}
if (problems.length > 0) {
  console.error(`npm audit found ${problems.length === 1 ? 'an advisory that needs' : `${problems.length} advisories that need`} attention:`)
  for (const problem of problems) console.error(`- ${problem}`)
  process.exit(1)
}
console.log('npm audit found nothing else.')
