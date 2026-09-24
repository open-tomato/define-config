# Contributing to @open-tomato/define-config

Thank you for your interest in contributing to this library. This guide covers the essential workflows for proposing changes and submitting pull requests.

## Before You Start

- Read [AGENTS.md](AGENTS.md) for detailed information on style, code layout, and the gates your PR must pass.
- Review [SECURITY.md](SECURITY.md) if your change involves security or input validation.

## Proposing a Change

Use the **Spec issue template** to propose a change:

1. Go to the repository's [Issues](https://github.com/open-tomato/define-config/issues) tab
2. Click **New issue**
3. Select **Spec** from the available templates
4. Fill in the sections: what you get, starting position, design, failure modes, tasks, and definition of done

The spec template ensures your proposal has the structure a plan can be built from. This is the fastest path to approval and implementation.

## Before Opening a Pull Request

1. **Install dependencies:**
   ```bash
   bun install
   ```

2. **Run the quality gates:**
   ```bash
   bun run gates
   ```

   This runs the full suite in sequence: lint, check-types, test, build, check-pack, check-node. Your PR must pass all gates. See [AGENTS.md#gates](AGENTS.md#gates) for details on each gate.

3. **Verify your change:**
   - Tests cover your implementation (minimum 80% coverage)
   - Code follows the style enforced by ESLint (single quotes, 2-space indent, trailing commas, etc.)
   - TypeScript types pass in strict mode
   - The built package contains only the files in the allow-list

## Runtime Dependencies

This library has **zero runtime dependencies** and must stay that way. Do not add `dependencies` to `package.json`. Dev dependencies are acceptable; if you need a validator, use `uvx` to run it from a script, not via an npm package.

## Security Issues

Do not open a public issue for security vulnerabilities. Instead, use GitHub's private vulnerability reporting at https://github.com/open-tomato/define-config/security/advisories/new. See [SECURITY.md](SECURITY.md) for full details.

## Questions?

Refer to [AGENTS.md](AGENTS.md) for:
- The ESLint style rules and reserved keys in config objects
- How each gate works and what it checks
- Test coverage and TDD workflow
- Publishing and release process
