// What each command of the plugin needs from the machine. `scripts/doctor.mjs` probes these; a contract test
// (`test/doctor-table.test.mjs`) fails when a script starts an executable this table does not name, so the table
// cannot drift from the code that uses it.

// External programs, probed by running them (or, for the Obsidian CLI, only by finding them on PATH: it talks to
// the running app, so starting it to read a version could open or focus the window).
export const TOOLS = {
  git: { command: 'git', args: ['--version'], hint: 'install Git: https://git-scm.com/downloads' },
  gh: { command: 'gh', args: ['--version'], hint: 'install the GitHub CLI: https://cli.github.com, then run `gh auth login`' },
  pandoc: { command: 'pandoc', args: ['-v'], hint: 'install pandoc: https://pandoc.org/installing.html' },
  pdftotext: { command: 'pdftotext', args: ['-v'], poppler: true, hint: 'install poppler: winget install oschwartz10612.Poppler (Windows), brew install poppler (macOS), apt install poppler-utils (Linux)' },
  pdftoppm: { command: 'pdftoppm', args: ['-v'], poppler: true, hint: 'install poppler (see pdftotext); it also provides pdftoppm' },
  tesseract: { command: 'tesseract', args: ['--version'], hint: 'install Tesseract OCR: https://github.com/tesseract-ocr/tesseract' },
  soffice: { command: 'soffice', args: ['--version'], hint: 'install LibreOffice and put its program folder on PATH' },
  obsidian: { command: 'obsidian', args: null, hint: 'enable the Obsidian command line interface in the app (Settings > General > Advanced)' },
};

// Things that are not a single program, or that are asked over HTTP or read from the vault instead of being started.
export const OTHER = {
  ollama: 'Ollama reachable with the embedding model pulled, asked over HTTP',
  'obsidian-git': 'the Obsidian Git plugin in the vault, installed and enabled with its timer on, read from the vault\'s files',
  python: 'a Python interpreter (python3, python or py)',
  'python-pptx': 'the python-pptx library in that interpreter',
  'html-runtime': 'the pinned npm packages for HTML extraction (defuddle, linkedom, turndown)',
  'playwright-core': 'playwright-core, for the rendered-page fallback: local, or fetched through npx on first use',
  browser: 'a Chromium-based browser for the rendered-page fallback',
  confluencer: 'the confluencer integration (its page.mjs)',
};

export const HINTS = {
  ollama: 'install Ollama (https://ollama.com), start it, and pull the embedding model',
  'obsidian-git': 'run setup-obsidian-git.mjs --check; the wiki-setup skill offers the install',
  python: 'install Python 3 and put it on PATH',
  'python-pptx': 'pip install python-pptx',
  'html-runtime': 'in a development checkout run `npm ci`; an installed copy runs through the pinned npm exec launcher',
  'playwright-core': 'install npm, so npx can fetch the pinned package on first use; in a development checkout run `npm ci`',
  browser: 'install Chrome or Edge, or set WIKI_MASTER_BROWSER to a browser executable',
  confluencer: 'install the confluencer plugin, or set WIKI_MASTER_CONFLUENCER_SCRIPTS',
};

// Executables the scripts start that are not requirements: node runs the scripts themselves.
export const NOT_REQUIREMENTS = ['node'];

// The rest of the poppler package, which clip-pdf's figure extraction uses when it is present.
export const POPPLER_EXTRAS = ['pdfimages', 'pdftocairo', 'pdfinfo'];

// Per command: what it cannot work without (`required`) and what only widens it (`optional`).
export const CLIPPERS = {
  'refresh-index': { summary: 'the last step of every authoring task (refresh-index.mjs)', required: ['git', 'ollama', 'obsidian-git'], optional: ['obsidian'] },
  'setup-obsidian-git': { summary: 'installing Obsidian Git in the vault (setup-obsidian-git.mjs --apply)', required: ['obsidian'], optional: [] },
  clip: { summary: 'web pages (clip.mjs)', required: ['html-runtime'], optional: ['playwright-core', 'browser'] },
  'clip-pdf': { summary: 'PDF files', required: ['pdftotext'], optional: ['pdftoppm', 'tesseract'] },
  'clip-docx': { summary: 'Word documents', required: ['pandoc'], optional: [] },
  'clip-pptx': { summary: 'PowerPoint decks', required: ['python', 'python-pptx'], optional: [] },
  'clip-xlsx': { summary: 'spreadsheets', required: ['soffice', 'pandoc'], optional: [] },
  'clip-gh': { summary: 'GitHub repositories', required: ['gh', 'git'], optional: [] },
  'clip-confluence': { summary: 'Confluence pages', required: ['confluencer'], optional: [] },
};

export const NPM_PACKAGES = ['defuddle', 'linkedom', 'turndown'];
