# Sinapse UI CLI

Temporary GitHub-hosted CLI shim for testing ITpS Design System installation
without publishing packages to a registry.

```sh
pnpm dlx github:DevJanderson/sinapse-ui-cli init
pnpm dlx github:DevJanderson/sinapse-ui-cli add button
```

The CLI installs `@itps/styles` from this repo's `v0.3.0-test` release asset.
`add button` patches shadcn/ui and shadcn-vue Button files. Other documented
component slugs are accepted as `theme-only` commands and do not write files.
