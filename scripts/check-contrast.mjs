#!/usr/bin/env node
/**
 * Checks the palette against WCAG AA and colour-vision deficiency.
 *
 *   node scripts/check-contrast.mjs
 *
 * Colour tokens are read straight out of assets/css/styles.css, so this cannot
 * drift from what the site actually renders: change a token and re-run.
 *
 *   text       4.5:1 for body text, 3:1 for large display text
 *   non-text   3:1 for the boundary of any interactive control, and for the
 *              map outline that marks a country as read (WCAG 1.4.11)
 *   colour     every pair of map shades stays at least 6 apart in OKLab
 *              (x100) under protanopia, deuteranopia and tritanopia, simulated
 *              with Machado-Oliveira-Fernandes 2009 at full severity
 *
 * Exits 1 if anything fails.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const css = readFileSync(join(root, 'assets/css/styles.css'), 'utf8');

/* ---- read the tokens out of the stylesheet ---- */

function tokensFrom(selector) {
  const start = css.indexOf(selector);
  if (start === -1) throw new Error(`Could not find "${selector}" in styles.css`);
  const open = css.indexOf('{', start);
  const end = css.indexOf('}', open);
  const block = css.slice(open, end);
  const tokens = {};
  for (const match of block.matchAll(/--([a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    tokens[match[1]] = match[2].toLowerCase();
  }
  return tokens;
}

const light = tokensFrom(':root {');
const dark = tokensFrom(':root[data-theme="dark"] {');

/* ---- colour maths ---- */

const channels = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

function relativeLuminance(hex) {
  const [r, g, b] = channels(hex).map(toLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const CVD = {
  protanopia: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deuteranopia: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]],
  tritanopia: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.303900]],
};

function simulate(hex, kind) {
  const linear = channels(hex).map(toLinear);
  if (kind === 'normal') return linear;
  return CVD[kind]
    .map((row) => row[0] * linear[0] + row[1] * linear[1] + row[2] * linear[2])
    .map((v) => Math.max(0, Math.min(1, v)));
}

function oklab([r, g, b]) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
  ];
}

function deltaE(a, b, kind) {
  const [l1, a1, b1] = oklab(simulate(a, kind));
  const [l2, a2, b2] = oklab(simulate(b, kind));
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2) * 100;
}

/* ---- the checks ---- */

const useColour = !process.env.NO_COLOR && process.stdout.isTTY;
const red = (s) => (useColour ? `[31m${s}[0m` : s);
const green = (s) => (useColour ? `[32m${s}[0m` : s);
const dim = (s) => (useColour ? `[2m${s}[0m` : s);

let failed = 0;
function record(ok, label, detail) {
  if (!ok) failed++;
  console.log(`  ${ok ? green('pass') : red('FAIL')}  ${label.padEnd(38)} ${dim(detail)}`);
}

const RAMP = ['q0', 'q1', 'q2', 'q3', 'q4', 'q5'];
const VISION = ['normal', 'protanopia', 'deuteranopia', 'tritanopia'];
const CVD_FLOOR = 6;

for (const [mode, t] of [['light', light], ['dark', dark]]) {
  console.log(`\n${mode} mode`);

  console.log('\n  text contrast');
  for (const [label, fg, bg, min] of [
    ['body ink on surface', t.ink, t.surface, 4.5],
    ['body ink on page', t.ink, t.plane, 4.5],
    ['secondary ink on surface', t['ink-2'], t.surface, 4.5],
    ['secondary ink on page', t['ink-2'], t.plane, 4.5],
    ['muted labels on surface', t.muted, t.surface, 4.5],
    ['muted labels on page', t.muted, t.plane, 4.5],
    ['links on surface', t.accent, t.surface, 4.5],
    ['links on page', t.accent, t.plane, 4.5],
    ['visited links on surface', t['accent-visited'], t.surface, 4.5],
    ['visited links on page', t['accent-visited'], t.plane, 4.5],
    ['tooltip text on its background', t.surface, t.ink, 4.5],
  ]) {
    record(contrast(fg, bg) >= min, label, `${contrast(fg, bg).toFixed(2)}:1 (need ${min})`);
  }

  console.log('\n  non-text contrast (1.4.11)');
  for (const [label, fg, bg] of [
    ['control border on page', t['field-border'], t.plane],
    ['control border on surface', t['field-border'], t.surface],
    ['focus ring on surface', t.accent, t.surface],
    ['focus ring on page', t.accent, t.plane],
    ['read-country outline vs palest fill', t['map-outline'], t.q1],
    ['read-country outline vs surface', t['map-outline'], t.surface],
    ['read-country outline vs unread fill', t['map-outline'], t.q0],
    ['selected-country stroke vs palest fill', t.ink, t.q1],
    ['language bar vs surface', t['data-strong'], t.surface],
  ]) {
    record(contrast(fg, bg) >= 3, label, `${contrast(fg, bg).toFixed(2)}:1 (need 3)`);
  }

  console.log('\n  link distinguishability');
  // A visited link must be tellable from an unvisited one, and neither should
  // be mistakable for ordinary body text.
  for (const [label, a, b, min] of [
    ['visited vs unvisited link', t['accent-visited'], t.accent, 8],
    ['visited link vs body ink', t['accent-visited'], t.ink, 10],
  ]) {
    const d = deltaE(a, b, 'normal');
    record(d >= min, label, `ΔE ${d.toFixed(1)} (need ${min})`);
  }

  console.log('\n  map shades, every pair, every vision type');
  for (let i = 0; i < RAMP.length; i++) {
    for (let j = i + 1; j < RAMP.length; j++) {
      const scores = VISION.map((v) => deltaE(t[RAMP[i]], t[RAMP[j]], v));
      const worst = Math.min(...scores);
      record(worst >= CVD_FLOOR, `${RAMP[i]} vs ${RAMP[j]}`,
        `worst ${worst.toFixed(1)} (need ${CVD_FLOOR}) · ` +
        VISION.map((v, k) => `${v.slice(0, 4)} ${scores[k].toFixed(1)}`).join(' '));
    }
  }
}

console.log('');
if (failed) {
  console.log(red(`${failed} contrast check${failed === 1 ? '' : 's'} failed.`));
  process.exit(1);
}
console.log(green('Every contrast and colour-vision check passes.'));
