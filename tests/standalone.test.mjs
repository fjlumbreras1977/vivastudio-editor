import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
test('delivered HTML includes unchanged classic JavaScript and needs no external runtime assets',()=>{const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8'),bundle=fs.readFileSync(new URL('../studio.bundle.js',import.meta.url),'utf8');const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];assert.equal(scripts.length,1);assert.equal(scripts[0][1].trim(),bundle.trim());assert.doesNotThrow(()=>new vm.Script(scripts[0][1]));assert.equal(/<script[^>]+(?:type="module"|src=)/.test(html),false);assert.equal(/<link[^>]+rel="stylesheet"/.test(html),false);assert.equal(scripts[0][1].includes('import.meta.url'),false);assert.ok(scripts[0][1].includes('getWorkletURL()'));assert.ok(scripts[0][1].includes('createMP3Worker()'));});
