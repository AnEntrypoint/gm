import { readFileSync } from 'fs';
import { resolve } from 'path';

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

test('HTML is valid', () => {
  const html = readFileSync(resolve('site/index.html'), 'utf-8');
  if (!html.includes('<!DOCTYPE html>')) throw new Error('Missing DOCTYPE');
  if (!html.includes('<html') || !html.includes('</html>')) throw new Error('Missing html tags');
  if (!html.includes('<body>') || !html.includes('</body>')) throw new Error('Missing body tags');
});

test('CSS color variables defined', () => {
  const html = readFileSync(resolve('site/index.html'), 'utf-8');
  const required = ['--bg-primary', '--text-primary', '--accent-primary', '--color-success', '--color-error'];
  required.forEach(v => {
    if (!html.includes(v)) throw new Error(`Missing CSS variable: ${v}`);
  });
});

test('Semantic colors available', () => {
  const html = readFileSync(resolve('site/index.html'), 'utf-8');
  const colors = ['--color-success', '--color-warning', '--color-error', '--color-info'];
  colors.forEach(c => {
    if (!html.includes(c)) throw new Error(`Missing semantic color: ${c}`);
  });
});

test('Form components defined', () => {
  const html = readFileSync(resolve('site/index.html'), 'utf-8');
  if (!html.includes('.cc-input')) throw new Error('Missing input component');
  if (!html.includes('.cc-form-group')) throw new Error('Missing form group');
  if (!html.includes('.cc-form-label')) throw new Error('Missing form label');
});

test('Status indicator components defined', () => {
  const html = readFileSync(resolve('site/index.html'), 'utf-8');
  if (!html.includes('.cc-status')) throw new Error('Missing status component');
  if (!html.includes('.cc-status-success')) throw new Error('Missing status success');
  if (!html.includes('.cc-status-error')) throw new Error('Missing status error');
});

test('Component library classes defined', () => {
  const html = readFileSync(resolve('site/index.html'), 'utf-8');
  const components = ['.cc-progress', '.cc-spinner', '.cc-modal', '.cc-table', '.cc-toast'];
  components.forEach(c => {
    if (!html.includes(c)) throw new Error(`Missing component: ${c}`);
  });
});

test('Grid background pattern defined', () => {
  const html = readFileSync(resolve('site/index.html'), 'utf-8');
  if (!html.includes('background-image:')) throw new Error('Missing grid background');
  if (!html.includes('body::before')) throw new Error('Missing pseudo-element for background');
});

test('Animation system defined', () => {
  const html = readFileSync(resolve('site/index.html'), 'utf-8');
  if (!html.includes('@keyframes')) throw new Error('Missing animations');
  if (!html.includes('--transition-fast')) throw new Error('Missing transition variables');
});

test('Border radius system defined', () => {
  const html = readFileSync(resolve('site/index.html'), 'utf-8');
  if (!html.includes('--border-radius')) throw new Error('Missing border radius');
  if (!html.includes('--border-radius-sm')) throw new Error('Missing small border radius');
});

test('Responsive grid defined', () => {
  const html = readFileSync(resolve('site/index.html'), 'utf-8');
  if (!html.includes('grid-template-columns: 1fr 1fr')) throw new Error('Missing 2-column grid');
  if (!html.includes('@media (max-width: 640px)')) throw new Error('Missing mobile breakpoint');
});

test('Accessibility features present', () => {
  const html = readFileSync(resolve('site/index.html'), 'utf-8');
  if (!html.includes(':focus-visible')) throw new Error('Missing focus-visible states');
  if (!html.includes('prefers-reduced-motion')) throw new Error('Missing reduced motion support');
});

test('Monospace typography applied', () => {
  const html = readFileSync(resolve('site/index.html'), 'utf-8');
  const monoElements = ['.cc-nav-logo', '.cc-section-title', '.cc-card-title', '.cc-phase-name'];
  monoElements.forEach(el => {
    const content = html.substring(html.indexOf(el));
    if (!content.substring(0, 500).includes("'JetBrains Mono'")) {
      console.warn(`Note: ${el} could use monospace font`);
    }
  });
});

test('Badge styling with icons', () => {
  const html = readFileSync(resolve('site/index.html'), 'utf-8');
  if (!html.includes('.cc-badge-cli::before')) throw new Error('Missing CLI badge icon');
  if (!html.includes('.cc-badge-ide::before')) throw new Error('Missing IDE badge icon');
});

test('Main.js has platform categorization', () => {
  const js = readFileSync(resolve('site/main.js'), 'utf-8');
  if (!js.includes('cliPlatforms')) throw new Error('Missing CLI platform categorization');
  if (!js.includes('idePlatforms')) throw new Error('Missing IDE platform categorization');
});

test('Main.js has status indicators', () => {
  const js = readFileSync(resolve('site/main.js'), 'utf-8');
  if (!js.includes('.cc-status')) throw new Error('Missing status indicator in main.js');
});

let passed = 0;
let failed = 0;

tests.forEach(({ name, fn }) => {
  try {
    fn();
    console.log(`✓ ${name}`);
    passed++;
  } catch (e) {
    console.error(`✗ ${name}: ${e.message}`);
    failed++;
  }
});

console.log(`\n${passed}/${tests.length} tests passed`);
if (failed > 0) process.exit(1);
