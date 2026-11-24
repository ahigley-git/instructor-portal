// Builds public/index.html (the live site) and demo/index.html (a self-contained clickable demo).
// Run: node scripts/build-page.mjs
import fs from 'node:fs';
import { build } from 'esbuild';

const tpl = fs.readFileSync('src/index.template.html', 'utf8').replace('/*BASE_CSS*/', fs.readFileSync('src/base.css', 'utf8'));
fs.writeFileSync('public/index.html', tpl.replace('<!--DEMO_BAR-->', '').replace('/*DEMO_SCRIPT*/', ''));

const out = await build({ entryPoints: ['src/demo.mjs'], bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2019', minify: true,
  plugins: [{ name: 'demo-crypto', setup(b) { b.onResolve({ filter: /crypto\.mjs$/ }, () => ({ path: new URL('../src/demo-crypto.mjs', import.meta.url).pathname })); } }] });
const js = out.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const demoBar = '<div class="demo-bar"><span id="demo-msg">Clickable demo with sample data. Nothing is saved or emailed.</span>' +
  '<button onclick="__demoLogin(\'admin@resqedu.com\')">Adam (admin)</button><button onclick="__demoLogin(\'sarah@example.com\')">Sarah (assistant)</button>' +
  '<button onclick="__demoLogin(\'jordan@example.com\')">Jordan (pending)</button><button onclick="__demoLogin(\'priya@example.com\')">Priya (patient)</button></div>';
fs.mkdirSync('demo', { recursive: true });
fs.writeFileSync('demo/index.html', tpl.replace('<!--DEMO_BAR-->', demoBar).replace('/*DEMO_SCRIPT*/', js + '\n')
  .replace("var TOKEN_KEY = 'resq_ins_token';", "var TOKEN_KEY = 'resq_ins_demo_token';"));
console.log('built public/index.html and demo/index.html', Math.round(js.length / 1024) + ' KB demo script');
