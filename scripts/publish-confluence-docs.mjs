#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { execSync } from 'node:child_process';

const SINCE_DATE = process.env.CONFLUENCE_SINCE_DATE || '2026-04-30';
const BASE_URL = (process.env.CONFLUENCE_BASE_URL || 'https://tiffanyjiang.atlassian.net/wiki').replace(/\/$/, '');
const EMAIL = process.env.CONFLUENCE_EMAIL || '';
const API_TOKEN = process.env.CONFLUENCE_API_TOKEN || '';
const SPACE_KEY = process.env.CONFLUENCE_SPACE_KEY || '';
const PARENT_PAGE_ID = process.env.CONFLUENCE_PARENT_PAGE_ID || '';
const DRY_RUN = process.argv.includes('--dry-run');

function toTitle(filePath) {
  const base = path.basename(filePath, '.md');
  return base
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeHtml(input) {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function markdownToStorageHtml(markdown) {
  const lines = markdown.split(/\r?\n/);
  const out = [];
  let inCode = false;
  let inUl = false;
  let inOl = false;

  const closeLists = () => {
    if (inUl) {
      out.push('</ul>');
      inUl = false;
    }
    if (inOl) {
      out.push('</ol>');
      inOl = false;
    }
  };

  for (const rawLine of lines) {
    const line = rawLine || '';

    if (line.startsWith('```')) {
      closeLists();
      if (!inCode) {
        inCode = true;
        out.push('<ac:structured-macro ac:name="code"><ac:plain-text-body><![CDATA[');
      } else {
        inCode = false;
        out.push(']]></ac:plain-text-body></ac:structured-macro>');
      }
      continue;
    }

    if (inCode) {
      out.push(line);
      continue;
    }

    const hMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (hMatch) {
      closeLists();
      const level = hMatch[1].length;
      out.push(`<h${level}>${escapeHtml(hMatch[2])}</h${level}>`);
      continue;
    }

    const ulMatch = line.match(/^\s*[-*]\s+(.*)$/);
    if (ulMatch) {
      if (inOl) {
        out.push('</ol>');
        inOl = false;
      }
      if (!inUl) {
        out.push('<ul>');
        inUl = true;
      }
      out.push(`<li>${escapeHtml(ulMatch[1])}</li>`);
      continue;
    }

    const olMatch = line.match(/^\s*\d+\.\s+(.*)$/);
    if (olMatch) {
      if (inUl) {
        out.push('</ul>');
        inUl = false;
      }
      if (!inOl) {
        out.push('<ol>');
        inOl = true;
      }
      out.push(`<li>${escapeHtml(olMatch[1])}</li>`);
      continue;
    }

    if (line.trim() === '') {
      closeLists();
      out.push('<p></p>');
      continue;
    }

    closeLists();
    out.push(`<p>${escapeHtml(line)}</p>`);
  }

  closeLists();
  if (inCode) {
    out.push(']]></ac:plain-text-body></ac:structured-macro>');
  }

  return out.join('\n');
}

function getChangedDocsSince(sinceDate) {
  const cmd = `git log --since='${sinceDate}' --name-status --pretty=format: -- docs '*.md'`;
  const result = execSync(cmd, { encoding: 'utf8' });
  const files = new Set();

  for (const line of result.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const parts = trimmed.split(/\s+/);
    const status = parts[0];
    const file = parts[1];

    if (!file || !file.endsWith('.md')) continue;
    if (!file.startsWith('docs/')) continue;
    if (!['A', 'M'].includes(status)) continue;

    files.add(file);
  }

  return Array.from(files).sort();
}

function buildAuthHeader(email, token) {
  return `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`;
}

async function apiRequest(url, method, auth, body) {
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: auth,
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${method} ${url} failed: ${response.status} ${response.statusText}\n${text}`);
  }

  return response.json();
}

async function findPageByTitle(auth, spaceKey, title) {
  const qs = new URLSearchParams({
    spaceKey,
    title,
    expand: 'version'
  });
  const url = `${BASE_URL}/rest/api/content?${qs.toString()}`;
  const data = await apiRequest(url, 'GET', auth);
  return data.results && data.results.length > 0 ? data.results[0] : null;
}

async function createPage(auth, spaceKey, parentPageId, title, html) {
  const payload = {
    type: 'page',
    title,
    space: { key: spaceKey },
    body: {
      storage: {
        value: html,
        representation: 'storage'
      }
    }
  };

  if (parentPageId) {
    payload.ancestors = [{ id: String(parentPageId) }];
  }

  return apiRequest(`${BASE_URL}/rest/api/content`, 'POST', auth, payload);
}

async function updatePage(auth, id, title, html, versionNumber) {
  const payload = {
    id,
    type: 'page',
    title,
    version: { number: versionNumber + 1 },
    body: {
      storage: {
        value: html,
        representation: 'storage'
      }
    }
  };

  return apiRequest(`${BASE_URL}/rest/api/content/${id}`, 'PUT', auth, payload);
}

async function main() {
  const docs = getChangedDocsSince(SINCE_DATE);

  if (docs.length === 0) {
    console.log(`No docs found in docs/ since ${SINCE_DATE}.`);
    return;
  }

  console.log(`Docs to publish since ${SINCE_DATE}:`);
  docs.forEach((d) => console.log(`- ${d}`));

  if (DRY_RUN) {
    console.log('\nDry run only. No API calls made.');
    return;
  }

  if (!EMAIL || !API_TOKEN || !SPACE_KEY) {
    throw new Error('Missing required env vars: CONFLUENCE_EMAIL, CONFLUENCE_API_TOKEN, CONFLUENCE_SPACE_KEY');
  }

  const auth = buildAuthHeader(EMAIL, API_TOKEN);

  for (const docPath of docs) {
    const md = await fs.readFile(docPath, 'utf8');
    const title = toTitle(docPath);
    const html = markdownToStorageHtml(md);

    const existing = await findPageByTitle(auth, SPACE_KEY, title);
    if (existing) {
      const currentVersion = existing.version?.number || 1;
      await updatePage(auth, existing.id, title, html, currentVersion);
      console.log(`Updated: ${title} (id=${existing.id})`);
    } else {
      const created = await createPage(auth, SPACE_KEY, PARENT_PAGE_ID, title, html);
      console.log(`Created: ${title} (id=${created.id})`);
    }
  }

  console.log('\nPublish complete.');
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
