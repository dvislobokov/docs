# Go Libraries Documentation

Documentation portal for [sconf](https://github.com/dvislobokov/sconf), [sorm](https://github.com/dvislobokov/sorm) and [srog](https://github.com/dvislobokov/srog), built with [VitePress](https://vitepress.dev/).

## Development

```sh
npm install
npm run docs:dev       # local dev server with hot reload
npm run docs:build     # production build (also validates dead links)
npm run docs:preview   # preview the production build locally
```

## Deployment (GitHub Pages)

The site deploys automatically via GitHub Actions (`.github/workflows/deploy.yml`) on every push to `main`.

One-time setup:

1. Create the repository (e.g. `dvislobokov/docs`) and push this project to it.
2. In the repository settings, open **Settings → Pages** and set **Source** to **GitHub Actions**.
3. Push to `main` — the site will be published at `https://dvislobokov.github.io/docs/`.

> If the repository is named something other than `docs`, update `base` in `docs/.vitepress/config.mts` to match (`/<repo-name>/`).

All code examples in the documentation are compiled and executed against the real libraries before publication.
