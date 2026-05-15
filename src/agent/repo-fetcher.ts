interface GitHubTreeItem {
  path: string;
  type: string;
  size?: number;
  url: string;
}

interface FetchedRepo {
  code: string;
  repoName: string;
  filesAnalyzed: number;
}

const EXCLUDED = ['node_modules', 'dist', 'build', '.next', 'vendor', 'coverage', '.git', '.github', 'public/'];
const EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.html', '.htm'];

function githubHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'CodeDoctor-Agent',
  };
  if (process.env['GITHUB_TOKEN']) {
    headers['Authorization'] = `Bearer ${process.env['GITHUB_TOKEN']}`;
  }
  return headers;
}

async function ghFetch<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: githubHeaders() });
  if (res.status === 404) throw new Error('Repozytorium nie istnieje lub jest prywatne');
  if (res.status === 403) throw new Error('Limit zapytań GitHub API wyczerpany — dodaj GITHUB_TOKEN do .env');
  if (!res.ok) throw new Error(`GitHub API błąd: ${res.status}`);
  return res.json() as Promise<T>;
}

function parseRepoUrl(url: string): { owner: string; repo: string } {
  const clean = url.trim().replace(/\.git$/, '').replace(/\/$/, '');
  const match = clean.match(/github\.com\/([^/]+)\/([^/]+)/);
  if (!match) throw new Error('Nieprawidłowy URL — podaj link w formacie: https://github.com/owner/repo');
  return { owner: match[1], repo: match[2] };
}

function isRelevant(path: string): boolean {
  if (EXCLUDED.some((ex) => path.includes(ex))) return false;
  if (!EXTENSIONS.some((ext) => path.endsWith(ext))) return false;
  return true;
}

function extractScriptBlocks(html: string, filePath: string): string {
  const scriptRegex = /<script(?:\s[^>]*)?>([^]*?)<\/script>/gi;
  const blocks: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = scriptRegex.exec(html)) !== null) {
    const content = match[1].trim();
    if (content) blocks.push(content);
  }

  if (blocks.length === 0) return '';
  return `// ===== ${filePath} [<script> blocks] =====\n${blocks.join('\n\n')}`;
}

function processFileContent(path: string, raw: string): string {
  if (path.endsWith('.html') || path.endsWith('.htm')) {
    return extractScriptBlocks(raw, path);
  }
  return `// ===== ${path} =====\n${raw}`;
}

export async function fetchRepoCode(repoUrl: string): Promise<FetchedRepo> {
  const { owner, repo } = parseRepoUrl(repoUrl);

  const repoInfo = await ghFetch<{ default_branch: string; full_name: string }>(
    `https://api.github.com/repos/${owner}/${repo}`,
  );

  const tree = await ghFetch<{ tree: GitHubTreeItem[]; truncated: boolean }>(
    `https://api.github.com/repos/${owner}/${repo}/git/trees/${repoInfo.default_branch}?recursive=1`,
  );

  const files = tree.tree
    .filter((f) => f.type === 'blob' && isRelevant(f.path))
    .sort((a, b) => a.path.split('/').length - b.path.split('/').length);

  if (files.length === 0) {
    throw new Error('Repozytorium nie zawiera plików TypeScript/JavaScript/HTML');
  }

  const contents = await Promise.all(
    files.map(async (f) => {
      const data = await ghFetch<{ content: string }>(
        `https://api.github.com/repos/${owner}/${repo}/contents/${f.path}`,
      );
      const raw = Buffer.from(data.content, 'base64').toString('utf-8');
      return processFileContent(f.path, raw);
    }),
  );

  const code = contents.filter(Boolean).join('\n\n');

  return { code, repoName: repoInfo.full_name, filesAnalyzed: files.length };
}
