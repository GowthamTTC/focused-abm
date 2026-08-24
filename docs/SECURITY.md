# Security baseline — Focused ABM

This document maps product controls to common **United States** and **India** expectations for a B2B SaaS handling LinkedIn network data. It is **not** a certification (SOC 2, ISO 27001, or DPDP registration). It is the engineering baseline so pilots and customers can review how data is protected.

## Regulatory orientation

| Region | Reference | How we align |
|--------|-----------|--------------|
| US | SOC 2 Trust Services (Security, Confidentiality) | Access control, audit log, encryption in transit, change management via git |
| US | NIST CSF / SP 800-63B | Password length, session integrity, rate limits |
| US | CCPA-style transparency | Org-scoped data, export, admin can remove users |
| India | DPDP Act 2023 | Purpose limitation (ABM only), org isolation, security safeguards, access control |
| India | IT Act / reasonable security practices | Encryption in transit, access logging, credential protection |
| Both | OWASP ASVS (selected) | Headers, CSRF-friendly cookies, injection-safe ORM, webhook auth |

## Controls implemented

### Access control
- Email/password auth with bcrypt (12 rounds)
- HMAC-signed httpOnly session cookie (`fabm_session`)
- Org-scoped queries (`orgId`) on people, jobs, exports, radar
- Admin routes restricted to `ADMIN_EMAIL`
- Middleware redirects unauthenticated users away from app pages

### Credential protection
- Password policy: ≥12 characters, 3 character classes, blocklist of common passwords
- Login and password-change rate limits (10 / 15 min per IP)
- Temporary admin-issued passwords force change on first login

### Transport & browser
- TLS via Railway / HTTPS
- Security headers: CSP, X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy, HSTS when HTTPS
- `poweredByHeader: false`

### Application
- Drizzle ORM parameterized queries (SQL injection resistance)
- Webhook endpoint requires `WEBHOOK_SECRET` (header `x-fabm-webhook-secret` or Bearer)
- Webhook never falls back to “any user”
- Export and auth events written to `activity_log`

### Data
- LinkedIn data stored per organization
- Workbook export audited
- No live GPS; Event Radar uses profile/post signals only

## Required production configuration

```
SESSION_SECRET=<random ≥32 chars>
WEBHOOK_SECRET=<random ≥16 chars>
APP_URL=https://your-domain
DATABASE_URL=postgres://...
```

Set Unipile hosted-auth notify URL to your `/api/webhooks/unipile` and send the same secret in `x-fabm-webhook-secret`.

## Operator responsibilities (not automated)

1. Railway Postgres access limited to need-to-know
2. Rotate `SESSION_SECRET` / `WEBHOOK_SECRET` if leaked
3. Review `activity_log` for auth anomalies
4. Execute data deletion requests from customers under DPDP timelines
5. Annual access review of admin email

## Out of scope (next phase)

- Full SOC 2 Type II evidence pack
- Customer-managed encryption keys
- SSO / SAML
- Redis-backed rate limits across many instances
- Automated DPDP consent UI for multi-tenant consumer apps (this product is B2B workforce data via LinkedIn connection)

## Incident contact

Platform admin: `ADMIN_EMAIL` env value.
