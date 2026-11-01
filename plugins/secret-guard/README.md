# secret-guard

Keeps secret values out of Claude Code. It blocks a prompt that carries a private key or a provider token
(AWS, GitHub, Slack, OpenAI, Anthropic, Stripe and more), blocks a Write, Edit or NotebookEdit that would put one
into a file, and warns when a tool's output shows one — those three match value FORMATS, not variable names, so
ordinary code passes. For shell commands it blocks the ones that would print the environment wholesale or echo or printf
a secret-named variable (`$API_KEY` and the like); it does not inspect a literal token typed into a command.

```
claude plugin marketplace add quixtop/claude-plugins && claude plugin install secret-guard@quixtop
```

Needs `jq` at `/usr/bin/jq` (macOS 15 and later ship it; on Linux install it there). Without it the guard lets
everything through, by design: it never blocks on its own errors. To turn it off, disable the plugin in `/plugin`.
