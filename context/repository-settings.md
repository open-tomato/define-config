# Repository Settings

This page documents the `gh api` and npm commands to configure the GitHub repository and npm
package for the `@open-tomato/define-config` release workflow. Each setting includes the apply
command (informational; not to be run in agent sessions) and the read command to verify the
configuration. The last section covers checking the YAML files under `.github/`.

## GitHub Repository Settings

### Security and Analysis: Dependabot Security Updates

**Apply:**
```bash
gh api repos/open-tomato/define-config/security-and-analysis/dependabot_security_updates \
  -X PATCH -f enabled=true
```

**Read:**
```bash
gh api repos/open-tomato/define-config -q '.security_and_analysis.dependabot_security_updates.status'
```

**Expected output:** `"enabled"`

### Security and Analysis: Secret Scanning

**Apply:**
```bash
gh api repos/open-tomato/define-config/security-and-analysis/secret_scanning \
  -X PATCH -f enabled=true
```

**Read:**
```bash
gh api repos/open-tomato/define-config -q '.security_and_analysis.secret_scanning.status'
```

**Expected output:** `"enabled"`

### Security and Analysis: Secret Scanning Push Protection

**Apply:**
```bash
gh api repos/open-tomato/define-config/security-and-analysis/secret_scanning_push_protection \
  -X PATCH -f enabled=true
```

**Read:**
```bash
gh api repos/open-tomato/define-config -q '.security_and_analysis.secret_scanning_push_protection.status'
```

**Expected output:** `"enabled"`

### Private Vulnerability Reporting

**Apply:**
```bash
gh api repos/open-tomato/define-config/private-vulnerability-reporting \
  -X PUT -f enabled=true
```

**Read:**
```bash
gh api repos/open-tomato/define-config/private-vulnerability-reporting -q '.enabled'
```

**Expected output:** `true`

### CodeQL Default Setup

**Apply:**
```bash
gh api repos/open-tomato/define-config/code-scanning/default-setup \
  -X PATCH -f state=configured -f query_suite=default
```

**Read:**
```bash
gh api repos/open-tomato/define-config/code-scanning/default-setup \
  -q '{state: .state, query_suite: .query_suite}'
```

**Expected output:** `{"state":"configured","query_suite":"default"}`

### Branch Ruleset: `main`

Protect the `main` branch with required status checks, required squash merges, and restrictions on
deletion and force pushes.

**Apply:**
```bash
gh api repos/open-tomato/define-config/rulesets -X POST \
  -f name=main \
  -f target=branch \
  -f "enforcement=active" \
  --input - <<'EOF'
{
  "conditions": {
    "ref_name": {
      "include": ["~DEFAULT_BRANCH"],
      "exclude": []
    }
  },
  "rules": [
    {
      "type": "required_status_checks",
      "parameters": {
        "strict_required_status_checks_policy": false,
        "required_status_checks": [
          {
            "context": "gates",
            "integration_id": null
          }
        ]
      }
    },
    {
      "type": "pull_request",
      "parameters": {
        "dismiss_stale_reviews_on_push": false,
        "require_code_review_from_code_owners": false,
        "require_last_push_approval": false,
        "required_approving_review_count": 0,
        "allowed_merge_methods": ["squash"]
      }
    },
    {
      "type": "non_fast_forward"
    },
    {
      "type": "deletion"
    }
  ]
}
EOF
```

**Read:**
```bash
gh api repos/open-tomato/define-config/rulesets -q '.[] | select(.name == "main")'
```

**Expected output:** A ruleset with:
- `"name": "main"`
- `"target": "branch"`
- `"enforcement": "active"`
- Rules: `required_status_checks` (context: `gates`), `pull_request` (allowed merge methods:
  `["squash"]`, required approvals: `0`), `non_fast_forward`, `deletion`

### Tag Ruleset: `v*`

Protect release tags with restrictions on updates and deletion.

**Apply:**
```bash
gh api repos/open-tomato/define-config/rulesets -X POST \
  -f name='v*' \
  -f target=tag \
  -f "enforcement=active" \
  --input - <<'EOF'
{
  "conditions": {
    "ref_name": {
      "include": ["refs/tags/v*"],
      "exclude": []
    }
  },
  "rules": [
    {
      "type": "update"
    },
    {
      "type": "deletion"
    }
  ]
}
EOF
```

**Read:**
```bash
gh api repos/open-tomato/define-config/rulesets -q '.[] | select(.name == "v*")'
```

**Expected output:** A ruleset with:
- `"name": "v*"`
- `"target": "tag"`
- `"enforcement": "active"`
- Rules: `update`, `deletion`

### Merge Commit and Branch Deletion Settings

**Apply merge behavior:**
```bash
gh api repos/open-tomato/define-config -X PATCH \
  -f delete_branch_on_merge=true \
  -f allow_merge_commit=false
```

**Read:**
```bash
gh api repos/open-tomato/define-config \
  -q '{delete_branch_on_merge: .delete_branch_on_merge, allow_merge_commit: .allow_merge_commit}'
```

**Expected output:** `{"delete_branch_on_merge":true,"allow_merge_commit":false}`

## npm Package Settings

### Trusted Publisher: GitHub Actions

Add GitHub Actions as a trusted publisher for automated releases. This allows the `.github/workflows/publish.yml` workflow to publish without an npm token.

**Configuration (via npm web UI):**

Navigate to https://www.npmjs.com/package/@open-tomato/define-config/settings/access and add:

- **Publisher Type:** GitHub Actions
- **Organization:** `open-tomato`
- **Repository:** `define-config`
- **Workflow Filename:** `publish.yml`
- **Environment:** (leave blank for no environment requirement)

**Verify via npm API (informational, read-only):**
```bash
npm access get-publish-access-level @open-tomato/define-config 2>&1
```

This command returns the access level; trusted publishers are visible in the npm web UI under
package settings. The CLI does not currently list trusted publishers.

### Publishing Access: Disallow Tokens

**Configuration (via npm web UI):**

Navigate to https://www.npmjs.com/package/@open-tomato/define-config/settings/access and enable
the option to require trusted publishing (disallow token-based publishing for this package).

**Note:** This setting prevents accidental publishes via personal or CI tokens and ensures only
GitHub Actions (or other configured trusted publishers) can publish the package.

## Execution Order

Apply settings in this order to satisfy dependencies and guard against invalid states:

1. **Security settings** (Dependabot, secret scanning, etc.):
   - Apply all `security_and_analysis` settings
   - Apply private vulnerability reporting
   - Apply CodeQL default setup

2. **Branch and tag rulesets** (after security settings to avoid interference):
   - Create the `v*` tag ruleset first (it has no dependencies)
   - Create the `main` branch ruleset (depends on CI job name `gates` existing in `.github/workflows/ci.yml`)

3. **Merge behavior** (independent):
   - Apply `delete_branch_on_merge` and `allow_merge_commit`

4. **Dry-run and release workflow guards** (before enabling auto-publish):
   - Verify `.github/workflows/publish.yml` exists and contains the `dry-run` input defaulting to `true`
   - Verify `scripts/publish-guard.ts` validates the tag and commit before publishing

5. **npm trusted publisher** (before any non-dry-run publish):
   - Add GitHub Actions as a trusted publisher in npm package settings
   - Enable the option to require trusted publishing

6. **Verify settings** (after all apply commands):
   - Run each read command above to confirm all settings are in the expected state

This order ensures that:
- The workflow can safely dry-run before the `v*` ruleset blocks all tag updates
- The trusted publisher is in place before the first non-dry-run release
- All guards and validations are active before automation can publish

## Checking the `.github` YAML

`bun run lint` does not read YAML, so it passes whatever `.github/dependabot.yml` and
`.github/workflows/*.yml` hold. Check them by hand after editing, without adding a dev dependency:

```bash
uvx check-jsonschema --schemafile https://json.schemastore.org/dependabot-2.0.json .github/dependabot.yml
uvx --from actionlint-py actionlint .github/workflows/*.yml
```

The schemastore schema accepts options that Dependabot's `bun` ecosystem does not support:
`allow` with `dependency-type: indirect`, `commit-message.prefix-development`,
`groups.*.dependency-type`, `insecure-external-code-execution`, `vendor` and
`versioning-strategy`. A passing schema check does not clear the `bun` entry; read it with
`Bun.YAML.parse` in `bun -e` and reject each of those keys.

actionlint runs shellcheck over `run:` steps and fails on an unquoted expansion (SC2086), so
an optional flag goes into a bash array, as in `publish.yml`'s publish step.
