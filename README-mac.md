# macOS (zsh) developer setup — simplehome

This file documents exact steps to reproduce the development environment for the `simplehome` project on a Mac (zsh shell).

Follow these copy-pasteable steps on your partner's MacBook (zsh is the default shell on modern macOS).

---

## 1) Prerequisites

- Homebrew (package manager)
- Git
- nvm (Node Version Manager) to manage Node versions

Open Terminal and run the commands below.

### Install Homebrew and Git
```zsh
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
brew install git
```

### Install nvm (Node Version Manager)
```zsh
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.6/install.sh | bash

# Add nvm init to your ~/.zshrc (the installer may add this automatically):
cat >> ~/.zshrc <<'ZSHRC'
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
[ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"
ZSHRC

# Reload zsh to pick up nvm
exec zsh
```

## 2) Install and use the project's Node version

This project was developed with Node 18 LTS. Install and use it with nvm:

```zsh
nvm install 18
nvm use 18
node -v
npm -v
```

If you want a specific patch version, replace `18` with e.g. `18.20.0`.

## 3) Clone repository and install dependencies

```zsh
git clone https://github.com/hliu94539/simplehome.git
cd simplehome
npm install
```

Notes:
- `npm install` will set up dev tooling (husky) and install dependencies.
- If the `prepare` hook fails due to husky, run `npm run prepare` after installing husky: `npm install husky --save-dev && npm run prepare`.

## 4) Environment variables (zsh)

Set AI provider keys and default provider. Add these lines to `~/.zshrc` or export them in the shell before running the server.

```zsh
# Choose default provider: 'gemini' or 'openai'
export DEFAULT_AI_PROVIDER=gemini

# If using Gemini (recommended):
export GEMINI_API_KEY="your_gemini_key_here"

# Or, if using OpenAI:
# export DEFAULT_AI_PROVIDER=openai
# export OPENAI_API_KEY="your_openai_key_here"

# Optional admin diagnostics token (for /api/admin/ai-diagnostics)
export ADMIN_TOKEN="some-secret-token"

# Optional: enable verbose server debug for client requests
# export DEBUG_CLIENT_REQUESTS=true

source ~/.zshrc
```

Alternative: place the gemini key in a file named `gemini.key` in the project root (single-line, no extra whitespace) — the server will read it.

## 5) Start development server (with Vite HMR)

```zsh
# Optional: enable debug logs for client requests
export DEBUG_CLIENT_REQUESTS=true

npm run dev

# open http://localhost:5000
```

The server binds to port `5000` by default. Use `PORT=3000 npm run dev` to change.

## 6) Run tests

```zsh
npm test
```

## 7) Build and run production-like bundle

```zsh
npm run build
npm start
# browse http://localhost:5000
```

## 8) Quick one-liners

Run dev with a Gemini key inline:
```zsh
DEFAULT_AI_PROVIDER=gemini GEMINI_API_KEY="sk-..." DEBUG_CLIENT_REQUESTS=true npm run dev
```

Run tests with OpenAI:
```zsh
DEFAULT_AI_PROVIDER=openai OPENAI_API_KEY="sk-..." npm test
```

## 9) Troubleshooting

- Port in use: set `PORT=3000 npm run dev`.
- Husky/prepare hook errors: run
  ```zsh
  npm install husky --save-dev
  npm run prepare
  ```
- Gemini/OpenAI key errors: ensure `GEMINI_API_KEY` or `OPENAI_API_KEY` is exported or available in a `gemini.key` file for Gemini.
- If the client shows the React `NotFound` page:
  - Enable `DEBUG_CLIENT_REQUESTS=true` then reproduce and inspect server logs for `VITE-SERVE` and `[CLIENT-DBG]` lines to see the requested path and UA.
  - Open Chrome DevTools Console and check for runtime errors and `location.pathname`.

## 10) Apple Silicon (M1/M2) notes

- Homebrew on Apple Silicon installs to `/opt/homebrew` by default — that's fine.
- If you run into native build issues for some dependency, ensure Xcode command line tools are installed:
  ```zsh
  xcode-select --install
  ```
